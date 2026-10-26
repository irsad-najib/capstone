"""Emit a KiCad 10 .kicad_pcb from the schematic netlist + a floorplan table."""
import os, sys, math, copy, hashlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sexp import parse, unq
from gen_core import ser, q, U

FPDIR = '/Applications/KiCad/KiCad.app/Contents/SharedSupport/footprints'

LAYERS = """	(layers
		(0 "F.Cu" signal)
		(2 "B.Cu" signal)
		(9 "F.Adhes" user "F.Adhesive")
		(11 "B.Adhes" user "B.Adhesive")
		(13 "F.Paste" user)
		(15 "B.Paste" user)
		(5 "F.SilkS" user "F.Silkscreen")
		(7 "B.SilkS" user "B.Silkscreen")
		(1 "F.Mask" user)
		(3 "B.Mask" user)
		(17 "Dwgs.User" user "User.Drawings")
		(19 "Cmts.User" user "User.Comments")
		(21 "Eco1.User" user "User.Eco1")
		(23 "Eco2.User" user "User.Eco2")
		(25 "Edge.Cuts" user)
		(27 "Margin" user)
		(31 "F.CrtYd" user "F.Courtyard")
		(29 "B.CrtYd" user "B.Courtyard")
		(35 "F.Fab" user)
		(33 "B.Fab" user)
	)"""

SETUP = """	(setup
		(stackup
			(layer "F.SilkS" (type "Top Silk Screen"))
			(layer "F.Paste" (type "Top Solder Paste"))
			(layer "F.Mask" (type "Top Solder Mask") (thickness 0.01))
			(layer "F.Cu" (type "copper") (thickness 0.035))
			(layer "dielectric 1" (type "core") (thickness 1.51) (material "FR4")
				(epsilon_r 4.5) (loss_tangent 0.02))
			(layer "B.Cu" (type "copper") (thickness 0.035))
			(layer "B.Mask" (type "Bottom Solder Mask") (thickness 0.01))
			(layer "B.Paste" (type "Bottom Solder Paste"))
			(layer "B.SilkS" (type "Bottom Silk Screen"))
			(copper_finish "HAL lead-free")
			(dielectric_constraints no)
		)
		(pad_to_mask_clearance 0.05)
		(allow_soldermask_bridges_in_footprints no)
		(tenting front back)
		(pcbplotparams
			(layerselection 0x00010fc_ffffffff)
			(plot_on_all_layers_selection 0x0000000_00000000)
			(disableapertmacros no) (usegerberextensions no) (usegerberattributes yes)
			(usegerberadvancedattributes yes) (creategerberjobfile yes)
			(dashed_line_dash_ratio 12.000000) (dashed_line_gap_ratio 3.000000)
			(svgprecision 4) (plotframeref no) (mode 1) (useauxorigin no)
			(dxfpolygonmode yes) (dxfimperialunits yes) (dxfusepcbnewfont yes)
			(psnegative no) (psa4output no) (plot_black_and_white yes)
			(sketchpadsonfab no) (plotpadnumbers no) (hidednponfab no)
			(sketchdnponfab yes) (crossoutdnponfab yes) (subtractmaskfromsilk no)
			(outputformat 1) (mirror no) (drillshape 1) (scaleselection 1)
			(outputdirectory "gerbers/")
		)
	)"""


def load_netlist(path):
    t = parse(open(path).read())[0]
    f = lambda e, tag: [c for c in e if isinstance(c, list) and c[0] == tag]
    comps = {}
    for blk in f(t, 'components'):
        for c in f(blk, 'comp'):
            ref = unq(f(c, 'ref')[0][1])
            val = unq(f(c, 'value')[0][1])
            fp = f(c, 'footprint')
            comps[ref] = (val, unq(fp[0][1]) if fp else '')
    padnet, netnames = {}, []
    for blk in f(t, 'nets'):
        for n in f(blk, 'net'):
            name = unq(f(n, 'name')[0][1])
            netnames.append(name)
            for nd in f(n, 'node'):
                padnet[(unq(f(nd, 'ref')[0][1]), unq(f(nd, 'pin')[0][1]))] = name
    return comps, padnet, netnames


def load_fp(lib_id):
    lib, name = lib_id.split(':', 1)
    path = f'{FPDIR}/{lib}.pretty/{name}.kicad_mod'
    return parse(open(path, encoding='utf8').read())[0]


def fp_extent(el):
    """courtyard bounding box in local coords (falls back to pads)"""
    xs, ys = [], []
    def walk(e, in_crtyd=False):
        if not isinstance(e, list):
            return
        tag = e[0]
        lay = [c for c in e if isinstance(c, list) and c[0] == 'layer']
        crt = in_crtyd or (lay and 'CrtYd' in unq(lay[0][1]))
        if tag in ('fp_line', 'fp_rect', 'fp_poly', 'fp_circle') and crt:
            for c in e:
                if isinstance(c, list) and c[0] in ('start', 'end', 'center', 'xy'):
                    xs.append(float(c[1])); ys.append(float(c[2]))
                if isinstance(c, list) and c[0] == 'pts':
                    for p in c[1:]:
                        if isinstance(p, list) and p[0] == 'xy':
                            xs.append(float(p[1])); ys.append(float(p[2]))
        for c in e:
            if isinstance(c, list):
                walk(c, crt)
    walk(el)
    if not xs:
        for e in el:
            if isinstance(e, list) and e[0] == 'pad':
                at = [c for c in e if isinstance(c, list) and c[0] == 'at'][0]
                sz = [c for c in e if isinstance(c, list) and c[0] == 'size'][0]
                x, y = float(at[1]), float(at[2])
                w, h = float(sz[1]) / 2, float(sz[2]) / 2
                xs += [x - w, x + w]; ys += [y - h, y + h]
    return min(xs), min(ys), max(xs), max(ys)


class Pcb:
    def __init__(self, comps, padnet, netnames, title=''):
        self.comps, self.padnet = comps, padnet
        self.nets = ['']+[n for n in netnames]
        self.netcode = {n: i for i, n in enumerate(self.nets)}
        self.items = []
        self.title = title
        self.boxes = {}   # ref -> (x0,y0,x1,y1) world courtyard
        self.pads = []    # dicts: ref,num,net,x,y,w,h,rot,tht

    # ---------- primitives ----------
    def line(self, x1, y1, x2, y2, layer='Edge.Cuts', width=0.1):
        self.items.append(f'''	(gr_line (start {x1:g} {y1:g}) (end {x2:g} {y2:g})
		(stroke (width {width}) (type solid)) (layer "{layer}")
		(uuid {q(U(f"gl{x1}{y1}{x2}{y2}{layer}"))}))''')

    def arc(self, sx, sy, mx, my, ex, ey, layer='Edge.Cuts', width=0.1):
        self.items.append(f'''	(gr_arc (start {sx:g} {sy:g}) (mid {mx:g} {my:g}) (end {ex:g} {ey:g})
		(stroke (width {width}) (type solid)) (layer "{layer}")
		(uuid {q(U(f"ga{sx}{sy}{ex}{ey}{layer}"))}))''')

    def text(self, x, y, s, layer='F.SilkS', size=1.5, thick=0.25, rot=0, mirror=False):
        just = ' (justify mirror)' if mirror else ''
        self.items.append(f'''	(gr_text {q(s)} (at {x:g} {y:g} {rot:g}) (layer "{layer}")
		(uuid {q(U(f"gt{x}{y}{s}{layer}"))})
		(effects (font (size {size} {size}) (thickness {thick})){just}))''')

    def rounded_outline(self, x0, y0, x1, y1, r):
        self.line(x0 + r, y0, x1 - r, y0)
        self.line(x1, y0 + r, x1, y1 - r)
        self.line(x1 - r, y1, x0 + r, y1)
        self.line(x0, y1 - r, x0, y0 + r)
        k = r - r * 0.70710678
        self.arc(x0 + r, y0, x0 + k, y0 + k, x0, y0 + r)
        self.arc(x1 - r, y0, x1 - k, y0 + k, x1, y0 + r)
        self.arc(x1, y1 - r, x1 - k, y1 - k, x1 - r, y1)
        self.arc(x0, y1 - r, x0 + k, y1 - k, x0 + r, y1)

    def zone(self, pts, net='GND', layers=('F.Cu', 'B.Cu'), clearance=0.3, thermal=True):
        code = self.netcode.get(net, 0)
        ptstr = ' '.join(f'(xy {x:g} {y:g})' for x, y in pts)
        lay = ' '.join(f'"{l}"' for l in layers)
        conn = 'thermal_reliefs' if thermal else 'solid'
        self.items.append(f'''	(zone (net {code}) (net_name {q(net)}) (layers {lay})
		(uuid {q(U("zone"+str(pts)+str(layers)))}) (name "GND pour") (hatch edge 0.5)
		(connect_pads {"" if thermal else "yes "}(clearance {clearance}))
		(min_thickness 0.25) (filled_areas_thickness no)
		(fill yes (thermal_gap 0.3) (thermal_bridge_width 0.5)
			(smoothing chamfer) (radius 0.5))
		(polygon (pts {ptstr})))''')

    # ---------- footprints ----------
    def place(self, ref, x, y, rot=0, back=False, center=True):
        """(x,y) is the centre of the courtyard when center=True."""
        val, lib_id = self.comps[ref]
        if not lib_id:
            raise ValueError(f'{ref} has no footprint')
        el = copy.deepcopy(load_fp(lib_id))
        if center:
            bx0, by0, bx1, by1 = fp_extent(el)
            for _ in range(int((rot % 360) / 90)):
                bx0, by0, bx1, by1 = by0, -bx1, by1, -bx0
            x -= (bx0 + bx1) / 2
            y -= (by0 + by1) / 2
        el[1] = '"' + lib_id + '"'
        side = 'B.Cu' if back else 'F.Cu'
        out = [el[0], el[1]]
        out.append(parse(f'(layer "{side}")')[0])
        out.append(parse(f'(uuid "{U("fp"+ref)}")')[0])
        out.append(parse(f'(at {x:g} {y:g}{" "+str(rot) if rot else ""})')[0])
        skip = {'version', 'generator', 'generator_version', 'layer', 'at', 'uuid',
                'embedded_fonts'}
        for c in el[2:]:
            if not isinstance(c, list) or c[0] in skip:
                continue
            if c[0] == 'property':
                pname = unq(c[1])
                if pname == 'Reference':
                    c[2] = '"' + ref + '"'
                elif pname == 'Value':
                    c[2] = '"' + val + '"'
                elif pname in ('Datasheet', 'Description'):
                    continue
                self._rot_at(c, rot)
                if back:
                    self._flip_layer(c)
            elif c[0] == 'pad':
                num = unq(c[1])
                net = self.padnet.get((ref, num))
                lat = [k for k in c if isinstance(k, list) and k[0] == 'at'][0]
                lsz = [k for k in c if isinstance(k, list) and k[0] == 'size'][0]
                lx, ly = float(lat[1]), float(lat[2])
                th = math.radians(rot)
                wx = x + lx * math.cos(th) + ly * math.sin(th)
                wy = y - lx * math.sin(th) + ly * math.cos(th)
                pw, ph = float(lsz[1]), float(lsz[2])
                if rot % 180 == 90:
                    pw, ph = ph, pw
                lays = [unq(k) for k in
                        [j for j in c if isinstance(j, list) and j[0] == 'layers'][0][1:]]
                tht = unq(c[2]) in ('thru_hole', 'np_thru_hole')
                dr = [k for k in c if isinstance(k, list) and k[0] == 'drill']
                drill = 0.0
                if dr:
                    vals = [v for v in dr[0][1:] if not isinstance(v, list)]
                    nums = [float(v) for v in vals if v.replace('.', '', 1).isdigit()]
                    drill = max(nums) if nums else 0.0
                self.pads.append(dict(ref=ref, num=num, net=net, x=wx, y=wy,
                                      w=pw, h=ph, tht=tht, drill=drill,
                                      front=tht or any('F.Cu' in l or '*.Cu' in l for l in lays),
                                      back=tht or any('B.Cu' in l or '*.Cu' in l for l in lays)))
                self._rot_at(c, rot)
                if net is not None:
                    c.append(parse(f'(net {self.netcode[net]} {q(net)})')[0])
                c.append(parse(f'(uuid "{U("pad"+ref+num)}")')[0])
                if back:
                    self._flip_layer(c)
            elif back:
                self._flip_layer(c)
            out.append(c)
        self.items.append(ser(out, 1))
        x0, y0, x1, y1 = fp_extent(el)
        for _ in range(int((rot % 360) / 90)):
            x0, y0, x1, y1 = y0, -x1, y1, -x0
        self.boxes[ref] = (x + x0, y + y0, x + x1, y + y1)

    @staticmethod
    def _rot_at(node, rot):
        if not rot:
            return
        for c in node:
            if isinstance(c, list) and c[0] == 'at':
                if len(c) >= 4:
                    c[3] = f'{(float(c[3]) + rot) % 360:g}'
                else:
                    c.append(f'{rot % 360:g}')

    @staticmethod
    def _flip_layer(node):
        m = {'F.Cu': 'B.Cu', 'B.Cu': 'F.Cu', 'F.SilkS': 'B.SilkS', 'B.SilkS': 'F.SilkS',
             'F.Mask': 'B.Mask', 'B.Mask': 'F.Mask', 'F.Paste': 'B.Paste',
             'B.Paste': 'F.Paste', 'F.CrtYd': 'B.CrtYd', 'B.CrtYd': 'F.CrtYd',
             'F.Fab': 'B.Fab', 'B.Fab': 'F.Fab'}
        for c in node:
            if isinstance(c, list) and c[0] in ('layer', 'layers'):
                for i in range(1, len(c)):
                    c[i] = '"' + m.get(unq(c[i]), unq(c[i])) + '"'

    def segment(self, x1, y1, x2, y2, layer, net, width=0.25):
        self.items.append(f'''	(segment (start {x1:.4f} {y1:.4f}) (end {x2:.4f} {y2:.4f})
		(width {width}) (layer "{layer}") (net {self.netcode[net]})
		(uuid {q(U(f"sg{x1}{y1}{x2}{y2}{layer}{net}"))}))''')

    def via(self, x, y, net, size=0.6, drill=0.3):
        self.items.append(f'''	(via (at {x:.4f} {y:.4f}) (size {size}) (drill {drill})
		(layers "F.Cu" "B.Cu") (net {self.netcode[net]})
		(uuid {q(U(f"vi{x}{y}{net}"))}))''')

    # ---------- checks ----------
    def overlaps(self, margin=0.0):
        bad = []
        refs = list(self.boxes)
        for i in range(len(refs)):
            for j in range(i + 1, len(refs)):
                a, b = self.boxes[refs[i]], self.boxes[refs[j]]
                if (a[0] < b[2] - margin and b[0] < a[2] - margin
                        and a[1] < b[3] - margin and b[1] < a[3] - margin):
                    bad.append((refs[i], refs[j]))
        return bad

    def outside(self, x0, y0, x1, y1, margin=0.5):
        return [r for r, b in self.boxes.items()
                if b[0] < x0 + margin or b[1] < y0 + margin
                or b[2] > x1 - margin or b[3] > y1 - margin]

    # ---------- render ----------
    def render(self):
        nets = '\n'.join(f'	(net {i} {q(n)})' for i, n in enumerate(self.nets))
        return f'''(kicad_pcb
	(version 20241229)
	(generator "pcbnew")
	(generator_version "9.0")
	(general (thickness 1.6) (legacy_teardrops no))
	(paper "A3")
	(title_block (title {q(self.title)}))
{LAYERS}
{SETUP}
{nets}
''' + '\n'.join(self.items) + '\n)\n'
