"""2-layer maze router (A* on a uniform grid) for the ESP-EEG board.

`copper[layer]` holds the net id of every piece of copper (pads, routed tracks,
vias); -1 = free, -2 = never usable (board border).  When routing net X a cell
is blocked if it lies within (trace/2 + clearance) of copper of any *other* net.
Cells holding X's own copper are always passable, so a trace can always escape
along its own pad - which is what makes fine-pitch QFP pins routable.

GND is never routed: the copper pours on both layers carry it.
Quality is "hobby autorouter" level - review before fabrication.
"""
import heapq
import numpy as np

GRID = 0.1          # mm per cell
W_SIG = 0.2         # signal trace width
W_PWR = 0.4         # power trace width
CLEAR = 0.2         # modelled clearance (netclass rule is 0.14 -> margin)
VIA_SIZE = 0.6
VIA_DRILL = 0.3
VIA_COST = 10       # cells

POWER_NETS = {'+5V', '+3V3', 'AVDD', 'AVSS', '-5V', '-10V', 'VBAT',
              '5V_USB', '5V_BOOST', '/power/BATT_NEG', '/power/PROT_MID'}
SKIP_NETS = {'GND'}
DIRS = [(1, 0), (-1, 0), (0, 1), (0, -1)]


_DISC = {}


def _disc(r):
    if r not in _DISC:
        _DISC[r] = [(dx, dy) for dx in range(-r, r + 1) for dy in range(-r, r + 1)
                    if dx * dx + dy * dy <= r * r and (dx or dy)]
    return _DISC[r]


def dilate(mask, r):
    """Euclidean (disc) dilation: a free cell is at least r cells away from the
    obstacle in any direction, so the real clearance matches the modelled one."""
    out = mask.copy()
    for dx, dy in _disc(r):
        sx0, sx1 = (dx, None) if dx >= 0 else (0, dx)
        dx0, dx1 = (0, -dx if dx else None) if dx >= 0 else (-dx, None)
        sy0, sy1 = (dy, None) if dy >= 0 else (0, dy)
        dy0, dy1 = (0, -dy if dy else None) if dy >= 0 else (-dy, None)
        out[sx0:sx1, sy0:sy1] |= mask[dx0:dx1, dy0:dy1]
    return out


class Router:
    def __init__(self, pads, bbox, netnames, border=1.5):
        self.x0, self.y0, self.x1, self.y1 = bbox
        self.nx = int((self.x1 - self.x0) / GRID) + 1
        self.ny = int((self.y1 - self.y0) / GRID) + 1
        self.copper = np.full((2, self.nx, self.ny), -1, dtype=np.int32)
        self.padcu = np.full((2, self.nx, self.ny), -1, dtype=np.int32)
        self.netids = {n: i for i, n in enumerate(sorted(netnames))}
        self.pads = [p for p in pads if p['net']]
        self.deadpads = [p for p in pads if not p['net']]
        self.tracks, self.vias, self.failed = [], [], []
        m = int(border / GRID)
        self.copper[:, :m, :] = -2; self.copper[:, -m:, :] = -2
        self.copper[:, :, :m] = -2; self.copper[:, :, -m:] = -2
        for p in self.pads:
            nid = self.netids[p['net']]
            for lay, on in ((0, p['front']), (1, p['back'])):
                if on:
                    self._rect(lay, p['x'], p['y'], p['w'] / 2, p['h'] / 2, nid)
                    self._rect(lay, p['x'], p['y'], p['w'] / 2, p['h'] / 2, nid,
                               grid=self.padcu)
        for p in self.deadpads:          # mechanical / unconnected pads are obstacles
            for lay, on in ((0, p['front']), (1, p['back'])):
                if on:
                    self._rect(lay, p['x'], p['y'], p['w'] / 2, p['h'] / 2, -2)
        # vias must keep away from through-holes (hole-to-hole rule)
        self.noviahole = np.zeros((self.nx, self.ny), dtype=bool)
        for p in self.pads + self.deadpads:
            if not p['tht']:
                continue
            rr = p.get('drill', 0.8) / 2 + VIA_DRILL / 2 + 0.5
            i0 = max(0, self.gi(p['x'] - rr)); i1 = min(self.nx - 1, self.gi(p['x'] + rr))
            j0 = max(0, self.gj(p['y'] - rr)); j1 = min(self.ny - 1, self.gj(p['y'] + rr))
            self.noviahole[i0:i1 + 1, j0:j1 + 1] = True

    # ---------- geometry ----------
    def gi(self, x): return int(round((x - self.x0) / GRID))
    def gj(self, y): return int(round((y - self.y0) / GRID))
    def wx(self, i): return self.x0 + i * GRID
    def wy(self, j): return self.y0 + j * GRID

    def _rect(self, lay, cx, cy, hw, hh, nid, force=False, grid=None):
        i0 = max(0, self.gi(cx - hw)); i1 = min(self.nx - 1, self.gi(cx + hw))
        j0 = max(0, self.gj(cy - hh)); j1 = min(self.ny - 1, self.gj(cy + hh))
        if i1 < i0 or j1 < j0:
            return
        g = self.copper if grid is None else grid
        blk = g[lay, i0:i1 + 1, j0:j1 + 1]
        if force:
            blk[blk == -1] = nid
        else:
            blk[blk == -1] = nid          # never overwrite another net's copper

    def pad_cells(self, p):
        """cells safely inside the pad copper - round pads are not their bbox,
        so a route must not finish in a bbox corner"""
        i0 = max(0, self.gi(p['x'] - p['w'] / 2)); i1 = min(self.nx - 1, self.gi(p['x'] + p['w'] / 2))
        j0 = max(0, self.gj(p['y'] - p['h'] / 2)); j1 = min(self.ny - 1, self.gj(p['y'] + p['h'] / 2))
        hw, hh = max(p['w'] / 2, 1e-6), max(p['h'] / 2, 1e-6)
        cells = []
        for lay, on in ((0, p['front']), (1, p['back'])):
            if not on:
                continue
            for i in range(i0, i1 + 1):
                for j in range(j0, j1 + 1):
                    dx = (self.wx(i) - p['x']) / hw
                    dy = (self.wy(j) - p['y']) / hh
                    if dx * dx + dy * dy <= 0.55:
                        cells.append((lay, i, j))
        return cells or [(lay, self.gi(p['x']), self.gj(p['y']))
                         for lay, on in ((0, p['front']), (1, p['back'])) if on]

    # ---------- driver ----------
    def route_all(self, progress=None):
        bynet = {}
        for p in self.pads:
            if p['net'] in SKIP_NETS:
                continue
            bynet.setdefault(p['net'], []).append(p)
        # flatten every net's MST into single connections, shortest first: short
        # escapes around fine-pitch parts get the free space before long hauls
        conns = []
        for net, pads in bynet.items():
            if len(pads) < 2:
                continue
            for a, b in self._mst(pads):
                d = abs(a['x'] - b['x']) + abs(a['y'] - b['y'])
                conns.append((d, net, a, b))
        conns.sort(key=lambda c: c[0])
        for k, (_, net, a, b) in enumerate(conns):
            ok = any(self._route_one(net, a, b, w) for w in (50, 150, 500))
            if not ok:   # last resort: thinner trace squeezes through tight gaps
                ok = any(self._route_one(net, a, b, w, wover=0.15) for w in (150, 500))
            if not ok:
                self.failed.append((net, f"{a['ref']}.{a['num']}", f"{b['ref']}.{b['num']}"))
            if progress and k % 100 == 0:
                progress(k, len(conns))

    @staticmethod
    def _span(pads):
        xs = [p['x'] for p in pads]; ys = [p['y'] for p in pads]
        return (max(xs) - min(xs)) + (max(ys) - min(ys))

    @staticmethod
    def _mst(pads):
        used, rest, edges = [pads[0]], list(pads[1:]), []
        while rest:
            _, iu, iv = min((abs(u['x'] - v['x']) + abs(u['y'] - v['y']), i, j)
                            for i, u in enumerate(used) for j, v in enumerate(rest))
            u, v = used[iu], rest[iv]
            edges.append((u, v)); used.append(v); rest.pop(iv)
        return edges

    # ---------- one connection ----------
    def _route_one(self, net, pa, pb, win, wover=None):
        nid = self.netids[net]
        width = wover or (W_PWR if net in POWER_NETS else W_SIG)
        rt = max(1, int(np.ceil((width / 2 + CLEAR) / GRID)))
        rv = max(1, int(np.ceil((VIA_SIZE / 2 + CLEAR) / GRID)))

        starts, goals = self.pad_cells(pa), self.pad_cells(pb)
        ii = [c[1] for c in starts + goals]; jj = [c[2] for c in starts + goals]
        i0 = max(0, min(ii) - win); i1 = min(self.nx - 1, max(ii) + win)
        j0 = max(0, min(jj) - win); j1 = min(self.ny - 1, max(jj) + win)

        # slice wider than the search box so obstacles just outside still dilate in
        M = max(rt, rv) + 2
        a0 = max(0, i0 - M); a1 = min(self.nx - 1, i1 + M)
        b0 = max(0, j0 - M); b1 = min(self.ny - 1, j1 + M)
        sub = self.copper[:, a0:a1 + 1, b0:b1 + 1]
        own = sub == nid
        other = (sub != -1) & ~own
        # only the net's own PAD copper excuses the clearance rule: a trace may run
        # inside a pad it belongs to, but may not hug the edge of its own track
        own_pad = self.padcu[:, a0:a1 + 1, b0:b1 + 1] == nid
        pass_t = ~np.stack([dilate(other[0], rt), dilate(other[1], rt)]) | own_pad
        # a via needs real clearance on both layers - own copper does NOT excuse it
        blocked_v = np.stack([dilate(other[0], rv), dilate(other[1], rv)])
        via_ok = (~blocked_v[0]) & (~blocked_v[1]) & ~self.noviahole[a0:a1 + 1, b0:b1 + 1]
        # confine the search itself to the requested box
        keep = np.zeros(pass_t.shape[1:], dtype=bool)
        keep[i0 - a0:i1 - a0 + 1, j0 - b0:j1 - b0 + 1] = True
        pass_t &= keep
        via_ok &= keep
        i0, j0 = a0, b0

        S = [(l, i - i0, j - j0) for l, i, j in starts
             if 0 <= i - i0 < pass_t.shape[1] and 0 <= j - j0 < pass_t.shape[2]
             and pass_t[l, i - i0, j - j0]]
        G = {(l, i - i0, j - j0) for l, i, j in goals
             if 0 <= i - i0 < pass_t.shape[1] and 0 <= j - j0 < pass_t.shape[2]
             and pass_t[l, i - i0, j - j0]}
        if not S or not G:
            return False
        gci = sum(c[1] for c in G) / len(G); gcj = sum(c[2] for c in G) / len(G)
        h = lambda c: abs(c[1] - gci) + abs(c[2] - gcj)

        nx_, ny_ = pass_t.shape[1], pass_t.shape[2]
        dist, prev, pq = {}, {}, []
        for s in S:
            dist[s] = 0
            heapq.heappush(pq, (h(s), 0, s))
        found = None
        while pq:
            _, d, cur = heapq.heappop(pq)
            if d > dist.get(cur, 1 << 30):
                continue
            if cur in G:
                found = cur
                break
            l, i, j = cur
            for di, dj in DIRS:
                ni, nj = i + di, j + dj
                if not (0 <= ni < nx_ and 0 <= nj < ny_) or not pass_t[l, ni, nj]:
                    continue
                k = (l, ni, nj); nd = d + 1
                if nd < dist.get(k, 1 << 30):
                    dist[k] = nd; prev[k] = cur
                    heapq.heappush(pq, (nd + h(k), nd, k))
            if via_ok[i, j]:
                k = (1 - l, i, j); nd = d + VIA_COST
                if nd < dist.get(k, 1 << 30):
                    dist[k] = nd; prev[k] = cur
                    heapq.heappush(pq, (nd + h(k), nd, k))
        if found is None:
            return False
        path = [found]
        while path[-1] in prev:
            path.append(prev[path[-1]])
        path.reverse()
        self._emit([(l, i + i0, j + j0) for l, i, j in path], net, nid, width)
        return True

    # ---------- output ----------
    def _emit(self, path, net, nid, width):
        run = [path[0]]
        for cur in path[1:]:
            if cur[0] != run[-1][0]:
                self._flush(run, net, nid, width)
                x, y = self.wx(run[-1][1]), self.wy(run[-1][2])
                self.vias.append((x, y, net))
                for lay in (0, 1):
                    self._rect(lay, x, y, VIA_SIZE / 2, VIA_SIZE / 2, nid)
                run = [cur]
            else:
                run.append(cur)
        self._flush(run, net, nid, width)

    def _flush(self, run, net, nid, width):
        if len(run) < 2:
            return
        lay = run[0][0]
        keep = [run[0]]
        for k in range(1, len(run)):
            if k + 1 < len(run):
                d1 = (run[k][1] - run[k - 1][1], run[k][2] - run[k - 1][2])
                d2 = (run[k + 1][1] - run[k][1], run[k + 1][2] - run[k][2])
                if d1 == d2:
                    continue
            keep.append(run[k])
            a, b = keep[-2], keep[-1]
            x1, y1 = self.wx(a[1]), self.wy(a[2])
            x2, y2 = self.wx(b[1]), self.wy(b[2])
            self.tracks.append((x1, y1, x2, y2, lay, net, width))
            cx0, cx1 = sorted((x1, x2)); cy0, cy1 = sorted((y1, y2))
            self._rect(lay, (cx0 + cx1) / 2, (cy0 + cy1) / 2,
                       (cx1 - cx0) / 2 + width / 2, (cy1 - cy0) / 2 + width / 2, nid)
