"""Floorplan + board generation for ESP-EEG v1 (2 channel, 2-layer)."""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pcb_core import Pcb, load_netlist

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BX0, BY0, BX1, BY1 = 25.0, 25.0, 140.0, 100.0     # 115 x 75 mm
R_CORNER = 4.0
EDGE = 2.0

comps, padnet, netnames = load_netlist(f'{ROOT}/eeg_v1.net')
b = Pcb(comps, padnet, netnames, title='ESP-EEG v1 rebuild - 2 channel, 2 layer')
P = b.place

# ------------------------------------------------------------ analog inputs
P('J1', 32, 45)                                    # electrode header 2x5
for ch, y in ((1, 40), (2, 52)):
    i = (2 - ch) * 2
    P(f'D{3-ch}', 45, y)
    P(f'R{i+1}', 54, y - 1.4); P(f'R{i+2}', 54, y + 1.4)
    P(f'C{i+1}', 60, y - 1.4, rot=90); P(f'C{i+2}', 60, y + 1.4, rot=90)

# bias / DRL
P('D3', 45, 62)
P('R6', 52, 62); P('R5', 58, 62); P('R7', 64, 62)
P('C6', 52, 66); P('C5', 58, 66); P('C7', 64, 66)

# ------------------------------------------------------------ ADS1299
P('U1', 80, 45)
P('C8', 69, 33, rot=90); P('C9', 69, 36, rot=90); P('C10', 69, 39, rot=90)
P('C12', 69, 42, rot=90); P('C13', 69, 51, rot=90); P('C14', 69, 54, rot=90)
P('C15', 69, 57, rot=90); P('C11', 66, 47, rot=90)          # 100uF tantalum
P('C16', 91, 33, rot=90); P('C17', 91, 36, rot=90); P('C18', 91, 39.5, rot=90)
P('C19', 91, 44, rot=90); P('C20', 91, 47, rot=90); P('C21', 91, 50.5, rot=90)
P('C22', 91, 55, rot=90); P('C23', 91, 58, rot=90)
for i, r in enumerate(['R8', 'R9', 'R10', 'R11', 'R12', 'R13']):
    P(r, 97, 33 + i * 3)

# ------------------------------------------------------------ MCU socket
P('J201', 102, 48)
P('J202', 127.4, 48)
P('C201', 109, 44); P('C202', 109, 48)
for i, (r, da, dk) in enumerate([('R201', 'D201', 'D202'),
                                 ('R202', 'D203', 'D204'),
                                 ('R203', 'D205', 'D206')]):
    y = 32 + i * 4
    P(r, 109, y); P(da, 114, y); P(dk, 119, y)

# ------------------------------------------------------------ analog rails
P('U104', 70, 72); P('C106', 63, 72, rot=90); P('C107', 63, 76, rot=90)
P('C137', 70, 77, rot=90); P('C108', 77, 72, rot=90); P('C109', 77, 76, rot=90)
P('U105', 90, 72); P('C110', 84, 76, rot=90); P('C111', 96, 76, rot=90)
P('U106', 107, 72); P('C112', 101, 76, rot=90); P('C113', 113, 76, rot=90)
P('C114', 107, 77, rot=90)
P('U107', 121, 71); P('R110', 117, 76); P('R111', 123, 76)
P('C115', 114, 71, rot=90); P('C116', 128, 71, rot=90); P('C136', 128, 76, rot=90)

# ------------------------------------------------------------ power in
P('J101', 40, 92)                                   # USB-C at bottom edge
P('R101', 33, 83); P('R102', 37, 83)
P('J102', 32, 70)                                   # Li-Po JST
P('U101', 52, 80); P('C101', 45, 76); P('C102', 60, 76, rot=90)
P('R103', 45, 84)
P('R104', 48, 90); P('D101', 52, 90); P('R105', 56.5, 90); P('D102', 60.5, 90)
P('U102', 70, 90); P('R106', 65, 85); P('R107', 76, 85); P('C103', 65, 95)
P('Q101', 82, 91)
P('U103', 90, 91); P('L101', 98, 91); P('D103', 106, 91)
P('C104', 90, 85, rot=90); P('C105', 100, 85, rot=90)
P('R108', 112, 95); P('R109', 116, 95)
P('D104', 114, 85); P('SW101', 124, 92)

# ------------------------------------------------------------ mechanical
for ref, (x, y) in zip(['H1', 'H2', 'H3', 'H4'],
                       [(31, 31), (135, 31), (31, 95), (135, 95)]):
    P(ref, x, y)

# ------------------------------------------------------------ board + pours
b.rounded_outline(BX0, BY0, BX1, BY1, R_CORNER)
pour = [(BX0 + EDGE, BY0 + EDGE), (BX1 - EDGE, BY0 + EDGE),
        (BX1 - EDGE, BY1 - EDGE), (BX0 + EDGE, BY1 - EDGE)]
b.zone(pour, 'GND', ('F.Cu',))
b.zone(pour, 'GND', ('B.Cu',))

b.text(60, 29, 'ESP-EEG v1  -  2ch EEG  (rebuild)', size=2.0)
b.text(38.5, 45, 'ELECTRODES', size=1.3, rot=90)
b.text(114, 60, 'ESP32 DEVKIT 30-PIN', size=1.3)
b.text(58, 70.5, 'ANALOG RAILS +/-2.5V', size=1.3)
b.text(80, 50, 'CC-BY-NC-SA 4.0 Cerelog Inc. - non commercial',
       layer='B.SilkS', size=1.4, thick=0.2, mirror=True)
b.text(80, 56, 'NOT A MEDICAL DEVICE - use battery power on a subject',
       layer='B.SilkS', size=1.4, thick=0.2, mirror=True)

# ------------------------------------------------------------ routing
if os.environ.get('ROUTE', '1') == '1':
    from router import Router
    r = Router(b.pads, (BX0, BY0, BX1, BY1), b.netcode.keys())
    t0 = time.time()
    r.route_all(progress=lambda k, n: print(f'  routing {k}/{n}...', flush=True))
    for (x1, y1, x2, y2, lay, net, wdt) in r.tracks:
        b.segment(x1, y1, x2, y2, 'F.Cu' if lay == 0 else 'B.Cu', net, wdt)
    for (x, y, net) in r.vias:
        b.via(x, y, net)
    print(f'routed: {len(r.tracks)} segments, {len(r.vias)} vias, '
          f'{len(r.failed)} unrouted, {time.time()-t0:.0f}s')
    for f in r.failed:
        print('   FAILED', f)

# ------------------------------------------------------------ checks
ov = b.overlaps(margin=0.01)
out = [x for x in b.outside(BX0, BY0, BX1, BY1, margin=1.0) if x != 'J101']
missing = [x for x in comps if x not in b.boxes]
if ov: print('OVERLAPS:', ov)
if out: print('OUTSIDE BOARD:', out)
if missing: print('NOT PLACED:', missing)
if not (ov or out or missing): print('placement clean:', len(b.boxes), 'footprints')

open(f'{ROOT}/eeg_v1.kicad_pcb', 'w').write(b.render())
print('wrote eeg_v1.kicad_pcb')
