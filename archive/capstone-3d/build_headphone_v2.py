"""headphone_v2 -- print-ready multi-material headphone, built parametrically.

Coordinates: millimetres, converted to metres on creation.
  X = depth (front <-> back)   Y = ear-to-ear   Z = height
Origin = assembly centre. Right cup is +Y.

Everything is built for the RIGHT side, then mirrored. Symmetry is therefore
correct by construction, not by measurement.
"""
import bpy, bmesh, math
from mathutils import Vector, Matrix

MM = 0.001

# ---------------------------------------------------------------- parameters
# Ellipse semi-axes. A human pinna is ~60-65 mm tall x 30-35 mm wide, so the
# opening is taller than it is wide; a round cup wastes width and pinches height.
CUP_RX         = 42.0     # cup half-depth  (front-back)
CUP_RZ         = 50.0     # cup half-height (top-bottom)
CUP_Y0, CUP_Y1 = 44.0, 78.0   # cup shell inner/outer faces
LIP_T          = 3.0      # pad retention lip, integral to the cup rim
LIP_P          = 1.5      # how far the lip stands proud
WALL           = 1.8      # 4-5 perimeters at 0.4 mm; the shell is not structural
AXIS_Y         = 64.0     # gimbal axes intersect here
AXIS_Z         = -42.0

PAD_Y0, PAD_Y1 = 24.0, 48.0   # foam pad; wraps OVER the cup lip
PAD_RX_OUT     = 44.0
PAD_RZ_OUT     = 52.0
PAD_RX_IN      = 20.0     # ear opening 40 mm wide
PAD_RZ_IN      = 31.0     # ear opening 62 mm tall

RING_RX_IN     = 45.0
RING_RZ_IN     = 53.0
RING_RX_OUT    = 49.0
RING_RZ_OUT    = 57.0
RING_W         = 6.0      # thickness along Y

STRIP_W        = 14.0     # metal strip width (X) -- sets the shoe width
STRIP_T        = 1.0      # metal strip thickness
CROWN_Z        = 104.0

RING_TOP       = -42.0 + 57.0   # AXIS_Z + RING_RZ_OUT
POST_R         = 6.5
SHOE_W         = STRIP_W + 3.0   # just enough wall either side of the slot
SHOE_D         = 12.0
SHOE_Z0        = RING_TOP + 2.0
SHOE_Z1        = SHOE_Z0 + 20.0

M3_FREE        = 3.2      # through-hole
M3_INSERT      = 4.0      # heat-set boss bore
INSERT_DEPTH   = 5.7
CLEAR          = 0.25     # rotating fit clearance

SEG            = 64

D = bpy.data
scn = bpy.context.scene
vl = bpy.context.view_layer


# ---------------------------------------------------------------- helpers
def new_mesh_obj(name, bm):
    me = D.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.update()
    o = D.objects.new(name, me)
    scn.collection.objects.link(o)
    return o


def cylinder(name, r, length, centre, axis='Y', segments=SEG):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments,
                          radius1=r * MM, radius2=r * MM, depth=length * MM)
    if axis == 'Y':
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0),
                         matrix=Matrix.Rotation(math.radians(90), 3, 'X'))
    elif axis == 'X':
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0),
                         matrix=Matrix.Rotation(math.radians(90), 3, 'Y'))
    bmesh.ops.translate(bm, verts=bm.verts,
                        vec=Vector(centre) * MM)
    return new_mesh_obj(name, bm)


def ecyl(name, rx, rz, length, centre, segments=SEG):
    """Elliptical cylinder, axis along Y, semi-axes rx (depth) and rz (height)."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments,
                          radius1=1.0, radius2=1.0, depth=length * MM)
    # cone is built along Z with its section in XY; scale the section first,
    # then rotate so the section lands in XZ and the axis in Y
    bmesh.ops.scale(bm, verts=bm.verts, vec=(rx * MM, rz * MM, 1.0))
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0),
                     matrix=Matrix.Rotation(math.radians(90), 3, 'X'))
    bmesh.ops.translate(bm, verts=bm.verts, vec=Vector(centre) * MM)
    return new_mesh_obj(name, bm)


def cube(name, size, centre):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, verts=bm.verts, vec=Vector(size) * MM)
    bmesh.ops.translate(bm, verts=bm.verts, vec=Vector(centre) * MM)
    return new_mesh_obj(name, bm)


def boolean(target, tool, op='DIFFERENCE'):
    m = target.modifiers.new("bool", 'BOOLEAN')
    m.operation = op
    m.object = tool
    m.solver = 'EXACT'
    vl.objects.active = target
    bpy.ops.object.modifier_apply(modifier=m.name)
    D.objects.remove(tool, do_unlink=True)
    return target


def bevel_edges(o, width=0.6, segments=2):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.bevel(bm, geom=list(bm.edges) + list(bm.verts), offset=width * MM,
                    segments=segments, affect='EDGES', profile=0.5,
                    clamp_overlap=True)
    bm.to_mesh(o.data)
    bm.free()
    o.data.update()
    return o


def shade_smooth(o, angle=35.0):
    for p in o.data.polygons:
        p.use_smooth = True
    m = o.modifiers.new("smooth", 'SMOOTH_BY_ANGLE') if 'SMOOTH_BY_ANGLE' in \
        [i.identifier for i in bpy.types.Modifier.bl_rna.properties['type'].enum_items] else None
    return o


# ---------------------------------------------------------------- wipe scene
bpy.ops.wm.read_factory_settings(use_empty=True)
D = bpy.data
scn = bpy.context.scene
vl = bpy.context.view_layer
scn.unit_settings.system = 'METRIC'
scn.unit_settings.length_unit = 'MILLIMETERS'

parts = {}

# ---------------------------------------------------------------- CUP SHELL
print("building cup shell")
cup = ecyl("Cup_Shell_R", CUP_RX, CUP_RZ, CUP_Y1 - CUP_Y0,
           (0, (CUP_Y0 + CUP_Y1) / 2, AXIS_Z))
cav = ecyl("_cav", CUP_RX - WALL, CUP_RZ - WALL, (CUP_Y1 - WALL) - CUP_Y0 + 1,
           (0, (CUP_Y0 + (CUP_Y1 - WALL)) / 2 - 0.5, AXIS_Z))
boolean(cup, cav)

# tilt-axis bosses, left and right of the cup on the X axis
for sx in (-1, 1):
    b = cylinder("_boss", 7.0, 10.0, (sx * (CUP_RX - 3), AXIS_Y, AXIS_Z), axis='X')
    boolean(cup, b, 'UNION')
for sx in (-1, 1):
    h = cylinder("_ih", M3_INSERT / 2, INSERT_DEPTH + 1,
                 (sx * (CUP_RX + 4 - (INSERT_DEPTH + 1) / 2), AXIS_Y, AXIS_Z), axis='X')
    boolean(cup, h)

# pad retention lip on the inner rim: the foam pad stretches over this, so
# pads stay replaceable without a separate ring part (one less joint = one
# less air-leak path, which is what actually costs you passive isolation)
lipr = ecyl("_liprim", CUP_RX + LIP_P, CUP_RZ + LIP_P, LIP_T,
            (0, CUP_Y0 + LIP_T / 2, AXIS_Z))
boolean(cup, lipr, 'UNION')

# recessed outer face -- breaks up the plain cylinder
rec = ecyl("_rec", CUP_RX - 9, CUP_RZ - 9, 3.0, (0, CUP_Y1 - 0.8, AXIS_Z))
boolean(cup, rec)
lip = ecyl("_lip", CUP_RX - 12, CUP_RZ - 12, 3.0, (0, CUP_Y1 - 1.4, AXIS_Z))
boolean(cup, lip, 'UNION')
# rear vent
v = cylinder("_vent", 3.0, 20.0, (0, CUP_Y1 - 5, AXIS_Z + 30))
boolean(cup, v)
bevel_edges(cup, 0.5)
parts["Cup_Shell_R"] = cup

# PAD RING removed by design: the foam pad now bonds straight to the cup rim
# and is retained by the integral lip above. Fewer part interfaces means fewer
# air-leak paths, and the freed axial space goes into the cup cavity.

# ---------------------------------------------------------------- GIMBAL RING
print("building gimbal ring")
gr = ecyl("Gimbal_Ring_R", RING_RX_OUT, RING_RZ_OUT, RING_W, (0, AXIS_Y, AXIS_Z))
gi = ecyl("_gi", RING_RX_IN, RING_RZ_IN, RING_W + 2, (0, AXIS_Y, AXIS_Z))
boolean(gr, gi)
# swivel post on top
post = cylinder("_post", POST_R, 14.0, (0, AXIS_Y, AXIS_Z + RING_RZ_OUT + 5))
boolean(gr, post, 'UNION')
join = cube("_join", (13, RING_W, 10), (0, AXIS_Y, AXIS_Z + RING_RZ_OUT - 2))
boolean(gr, join, 'UNION')
# swivel bore
sb = cylinder("_sb", M3_FREE / 2, 40.0, (0, AXIS_Y, AXIS_Z + RING_RZ_OUT + 10))
boolean(gr, sb)
# tilt-axis through holes
for sx in (-1, 1):
    h = cylinder("_th", M3_FREE / 2, 20.0, (sx * RING_RX_OUT, AXIS_Y, AXIS_Z), axis='X')
    boolean(gr, h)
bevel_edges(gr, 0.5)
parts["Gimbal_Ring_R"] = gr

# ---------------------------------------------------------------- BAND SHOE
# Compact clamp: the strip drops into a vertical slot from the top and two M3
# screws pass through both shoe walls AND holes in the strip, so it is locked
# positively rather than by friction. Much less material than a solid block.
print("building band shoe")
shoe = cube("Band_Shoe_R", (SHOE_W, SHOE_D, SHOE_Z1 - SHOE_Z0),
            (0, AXIS_Y, (SHOE_Z0 + SHOE_Z1) / 2))
slot = cube("_slot", (STRIP_W + 2 * CLEAR, STRIP_T + 2 * CLEAR, 14),
            (0, AXIS_Y, SHOE_Z1 - 4))
boolean(shoe, slot)
for sz in (0, 1):
    h = cylinder("_ch", M3_FREE / 2, SHOE_D + 4,
                 (0, AXIS_Y, SHOE_Z1 - 9 + sz * 5), axis='Y')
    boolean(shoe, h)
# swivel bore + pocket that swallows the gimbal post
sb = cylinder("_sb2", M3_FREE / 2, 40.0, (0, AXIS_Y, SHOE_Z0 + 8))
boolean(shoe, sb)
pocket = cylinder("_pk", POST_R + CLEAR, 12.0, (0, AXIS_Y, SHOE_Z0 + 3))
boolean(shoe, pocket)
bevel_edges(shoe, 0.6)
parts["Band_Shoe_R"] = shoe

# ---------------------------------------------------------------- DRIVER BAFFLE
print("building driver baffle")
BAFFLE_T = 2.5
baf = ecyl("Driver_Baffle_R", CUP_RX - WALL - CLEAR, CUP_RZ - WALL - CLEAR, BAFFLE_T,
           (0, CUP_Y0 + 4, AXIS_Z))
seat = cylinder("_seat", 20.5, 1.4, (0, CUP_Y0 + 3.6, AXIS_Z))
boolean(baf, seat)
sound = cylinder("_sh", 15.0, 10.0, (0, CUP_Y0 + 4, AXIS_Z))
boolean(baf, sound)
bevel_edges(baf, 0.4)
parts["Driver_Baffle_R"] = baf

# ---------------------------------------------------------------- mirror to left
print("mirroring to the left side")
M = Matrix.Diagonal((1, -1, 1, 1))
left = {}
for name, o in list(parts.items()):
    assert name.endswith("_R"), name
    ln = name[:-2] + "_L"   # NOT .replace("_R","_L") -- that also hits "_Ring"
    me = o.data.copy()
    me.name = ln
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.transform(M)
    bmesh.ops.reverse_faces(bm, faces=bm.faces)   # reflection inverts winding
    bm.to_mesh(me)
    bm.free()
    me.update()
    lo = D.objects.new(ln, me)
    scn.collection.objects.link(lo)
    left[ln] = lo
parts.update(left)

# ---------------------------------------------------------------- NON-PRINTED
print("building non-printed reference parts")
nonprinted = {}

cu = D.curves.new("Band_Strip", 'CURVE')
cu.dimensions = '3D'
cu.resolution_u = 48
prof = D.curves.new("_stripprof", 'CURVE')
prof.dimensions = '2D'
ps = prof.splines.new('POLY')
ps.points.add(3)
hw, ht = STRIP_W / 2 * MM, STRIP_T / 2 * MM
for i, (px, py) in enumerate([(-hw, -ht), (hw, -ht), (hw, ht), (-hw, ht)]):
    ps.points[i].co = (px, py, 0, 1)
ps.use_cyclic_u = True
prof_obj = D.objects.new("_stripprof", prof)
scn.collection.objects.link(prof_obj)
cu.bevel_mode = 'OBJECT'
cu.bevel_object = prof_obj
cu.use_fill_caps = True
s = cu.splines.new('BEZIER')
s.bezier_points.add(2)
KN = [((0, -AXIS_Y, SHOE_Z1 + 4), (0, -AXIS_Y, SHOE_Z1 - 10), (0, -AXIS_Y - 10, CROWN_Z - 40)),
      ((0, 0, CROWN_Z), (0, -46, CROWN_Z), (0, 46, CROWN_Z)),
      ((0, AXIS_Y, SHOE_Z1 + 4), (0, AXIS_Y + 10, CROWN_Z - 40), (0, AXIS_Y, SHOE_Z1 - 10))]
for i, (co, hl, hr) in enumerate(KN):
    bp = s.bezier_points[i]
    bp.co = Vector(co) * MM
    bp.handle_left = Vector(hl) * MM
    bp.handle_right = Vector(hr) * MM
    bp.handle_left_type = bp.handle_right_type = 'FREE'
strip = D.objects.new("Band_Strip", cu)
scn.collection.objects.link(strip)
prof_obj.hide_render = True
nonprinted["Band_Strip"] = strip
nonprinted["_stripprof"] = prof_obj

for sy in (1, -1):
    tag = "R" if sy > 0 else "L"
    pad = ecyl("Ear_Pad_" + tag, PAD_RX_OUT, PAD_RZ_OUT, PAD_Y1 - PAD_Y0,
               (0, sy * ((PAD_Y0 + PAD_Y1) / 2), AXIS_Z))
    hole = ecyl("_ph", PAD_RX_IN, PAD_RZ_IN, PAD_Y1 - PAD_Y0 + 8,
                (0, sy * ((PAD_Y0 + PAD_Y1) / 2), AXIS_Z))
    boolean(pad, hole)
    bevel_edges(pad, 3.0, 4)
    nonprinted["Ear_Pad_" + tag] = pad

cush = cube("Head_Cushion", (STRIP_W + 6, 74, 9), (0, 0, CROWN_Z - 7))
bevel_edges(cush, 3.0, 4)
nonprinted["Head_Cushion"] = cush

# ---------------------------------------------------------------- collections
print("organising collections")
for cn in ("Printed", "Non_Printed"):
    c = D.collections.new(cn)
    scn.collection.children.link(c)
for n, o in parts.items():
    for c in list(o.users_collection):
        c.objects.unlink(o)
    D.collections["Printed"].objects.link(o)
for n, o in nonprinted.items():
    for c in list(o.users_collection):
        c.objects.unlink(o)
    D.collections["Non_Printed"].objects.link(o)

# origins onto each part's own geometry
bpy.ops.object.select_all(action='DESELECT')
for o in list(parts.values()):
    o.select_set(True)
    vl.objects.active = o
    bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')
    o.select_set(False)

# materials
def mat(name, rgba, rough=0.45, metal=0.0):
    m = D.materials.get(name) or D.materials.new(name)
    m.use_nodes = True
    b = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if b:
        b.inputs["Base Color"].default_value = rgba
        b.inputs["Roughness"].default_value = rough
        b.inputs["Metallic"].default_value = metal
    return m

m_print = mat("PLA_Printed", (0.16, 0.17, 0.19, 1), 0.55)
m_metal = mat("Spring_Steel", (0.72, 0.73, 0.75, 1), 0.28, 1.0)
m_foam = mat("Foam_Leather", (0.09, 0.09, 0.10, 1), 0.78)
def assign(o, m):
    """Applying a boolean modifier leaves an EMPTY slot 0, and faces keep
    material_index 0 -- so a plain .append() lands in slot 1 and renders as
    default white. Clear the slots, then put the material in slot 0."""
    o.data.materials.clear()
    o.data.materials.append(m)
    if o.type == 'MESH':
        for p in o.data.polygons:
            p.material_index = 0


for o in parts.values():
    assign(o, m_print)
for n, o in nonprinted.items():
    if o.type not in ('MESH', 'CURVE'):
        continue
    assign(o, m_metal if n == "Band_Strip" else m_foam)

vl.update()
print("BUILD COMPLETE:", len(parts), "printed,", len(nonprinted), "non-printed")

# ---------------------------------------------------------------- verification
OUT = "/Users/irsad-najib/File/belajar_program/capstone/capstone-3d/headphone_v2.blend"
fails = []


def vbounds(objs):
    """From vertices -- never bound_box (it goes stale after matrix edits)."""
    lo = Vector((1e18,) * 3)
    hi = Vector((-1e18,) * 3)
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        if me is None:
            continue
        for v in me.vertices:
            w = o.matrix_world @ v.co
            for i in range(3):
                lo[i] = min(lo[i], w[i])
                hi[i] = max(hi[i], w[i])
        ev.to_mesh_clear()
    return lo / MM, hi / MM


print("")
print("=== GATE 1: WATERTIGHT (printed parts) ===")
for name in sorted(parts):
    o = parts[name]
    bm = bmesh.new()
    bm.from_mesh(o.data)
    nm = sum(1 for e in bm.edges if not e.is_manifold)
    bd = sum(1 for e in bm.edges if e.is_boundary)
    vol = bm.calc_volume(signed=True) / (MM ** 3)
    bm.free()
    ok = (nm == 0 and bd == 0 and vol > 0)
    if not ok:
        fails.append("%s not watertight (nonmanif=%d boundary=%d vol=%.1f)" % (name, nm, bd, vol))
    print("  %-18s nonmanif=%3d boundary=%3d vol=%9.1f mm3  %s"
          % (name, nm, bd, vol, "OK" if ok else "FAIL"))

print("=== GATE 2: MIRROR SYMMETRY ===")
for name in sorted(n for n in parts if n.endswith("_R")):
    assert name.endswith("_R"), name
    ln = name[:-2] + "_L"   # NOT .replace("_R","_L") -- that also hits "_Ring"
    rlo, rhi = vbounds([parts[name]])
    llo, lhi = vbounds([parts[ln]])
    err = max(abs(rhi.y - (-llo.y)), abs(rlo.y - (-lhi.y)),
              abs(rlo.x - llo.x), abs(rhi.x - lhi.x),
              abs(rlo.z - llo.z), abs(rhi.z - lhi.z))
    if err > 0.01:
        fails.append("%s/%s mirror err %.4f mm" % (name, ln, err))
    print("  %-18s mirror err %.5f mm  %s" % (name, err, "OK" if err <= 0.01 else "FAIL"))

print("=== GATE 3: ENVELOPE ===")
allobj = [o for o in list(parts.values()) + list(nonprinted.values())
          if o.type in ('MESH', 'CURVE') and not o.hide_render]
lo, hi = vbounds(allobj)
d = hi - lo
print("  overall %.1f x %.1f x %.1f mm  (target ~90 x ~150 x ~204)" % (d.x, d.y, d.z))
print("  cup axis at y=+-%.1f  z=%.1f" % (AXIS_Y, AXIS_Z))
if abs(d.z - 204) > 12:
    fails.append("height %.1f mm off target 204" % d.z)

print("=== GATE 4: PRINT-BED FIT (180 x 180 x 180) ===")
for name in sorted(parts):
    plo, phi = vbounds([parts[name]])
    pd = phi - plo
    fit = max(pd) <= 180.0
    if not fit:
        fails.append("%s does not fit the bed (%.1f mm)" % (name, max(pd)))
    print("  %-18s %6.1f x %6.1f x %6.1f mm  %s" % (name, pd.x, pd.y, pd.z, "OK" if fit else "FAIL"))

print("")
print("=== EAR OPENING / INTERNAL SPACE ===")
_a, _b = PAD_RX_IN, PAD_RZ_IN
print("  opening (ellipse)   %.0f mm wide x %.0f mm tall" % (2 * _a, 2 * _b))
print("  opening area        %.0f mm2  (%.1f cm2)" % (math.pi * _a * _b, math.pi * _a * _b / 100))
print("  pad depth (ear gap) %.0f mm" % (PAD_Y1 - PAD_Y0))
print("  usable ear volume   %.1f cm3" % (math.pi * _a * _b * (PAD_Y1 - PAD_Y0) / 1000))
_cd = (CUP_Y1 - WALL) - CUP_Y0
_cv = math.pi * (CUP_RX - WALL) * (CUP_RZ - WALL) * _cd / 1000
_bafy = CUP_Y0 + 4 + 2
_elec = math.pi * (CUP_RX - WALL) * (CUP_RZ - WALL) * ((CUP_Y1 - WALL) - _bafy) / 1000
print("  cup cavity          %.0f x %.0f mm x %.1f mm deep" %
      (2 * (CUP_RX - WALL), 2 * (CUP_RZ - WALL), _cd))
print("  cup cavity volume   %.1f cm3  (total, driver + electronics)" % _cv)
print("  behind the baffle   %.1f mm deep -> %.1f cm3 free for components" %
      ((CUP_Y1 - WALL) - _bafy, _elec))
print("  human pinna is typically 60-65 mm tall x 30-35 mm wide")
print("")
print("=== MASS BUDGET (PLA 1.24 g/cm3, solid walls) ===")
_tot = 0.0
for _n in sorted(n for n in parts if n.endswith("_R")):
    _bm = bmesh.new(); _bm.from_mesh(parts[_n].data)
    _v = _bm.calc_volume(signed=True) / (MM ** 3) / 1000.0
    _bm.free()
    _m = _v * 1.24
    _tot += _m * 2
    print("  %-18s %6.1f cm3   %5.1f g each   %5.1f g pair" % (_n[:-2], _v, _m, _m * 2))
print("  %-18s %27s %5.1f g" % ("TOTAL PRINTED", "", _tot))
print("  (a real Surface Headphones 2 weighs 290 g complete)")
print("")
print("=== HARDWARE BOM ===")
print("  M3 x 12 socket screw      x4   tilt axis (2 per cup)")
print("  M3 x 16 socket screw      x2   swivel axis (1 per cup)")
print("  M3 x 10 screw + nut       x4   band shoe strip clamp (2 per shoe)")
print("  M3 heat-set insert        x4   tilt axis, in cup shell")
print("  TPU washer 8x3.2x1        x6   compliance at both axes")
print("  spring steel strip 20 x 1.0 mm, ~330 mm developed length")
print("")
if fails:
    print("=== %d GATE FAILURE(S) ===" % len(fails))
    for f in fails:
        print("  ! " + f)
else:
    print("=== ALL GATES PASSED ===")

bpy.ops.wm.save_as_mainfile(filepath=OUT)
print("SAVED", OUT)
