# Lengan pegas jidat (adjustable) — jalankan:
# Blender -b --factory-startup --python Lengan_Pegas_Adjust.py -- out.blend preview_prefix TPU_PIRINGAN_x3.stl [shift_mm]
import bpy, bmesh, sys, math
from mathutils import Vector, Matrix

args = sys.argv[sys.argv.index("--") + 1:]
OUT_BLEND, OUT_PNG, PIR_STL = args[0], args[1], args[2]
SHIFT = float(args[3]) if len(args) > 3 else 0.0   # posisi geser lengan (+ = maju)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.unit_settings.scale_length = 0.001
sc.unit_settings.length_unit = 'MILLIMETERS'

# ---------------- parameters (mm) ----------------
HEAD_A, HEAD_B, HEAD_W = 95.0, 100.0, 75.0   # kepala referensi: depan-belakang, tinggi, kiri-kanan
BAND_W, BAND_T = 12.0, 2.5                   # bando: lebar 1.2 cm, tebal 2-3 mm
BASE_L = 36.0                                # panjang dudukan (nongol di depan/belakang bando)
LOCATE = 1.0                                 # dalam alur pengunci bando di bawah dudukan
WIDTH = 32.0                                 # lebar lengan (arah X) = lebar piringan
CLR = 0.3                                    # celah lengan di antara dinding pemandu
GUIDE_W = 6.0                                # lebar dinding pemandu dudukan
FLOOR_T = 4.0                                # tebal lantai dudukan
FLAT_T = 3.0                                 # tebal bagian lurus lengan (yang digeser)
FLAT_L = 56.0                                # panjang bagian lurus lengan
ARM_T = 2.5                                  # tebal lengan pegas
PLATE_T = 3.5                                # tebal plat dudukan piringan
PLATE_L = 34.0
PHI_END = 60.0                               # sudut (dari puncak kepala) akhir lengkung
PRELOAD = 6.0                                # tekanan ke jidat di posisi tengah (mm masuk)
PIR_STACK = 4.5                              # tebal piringan TPU
PCD, HOLE_D, CENTER_D = 26.0, 1.8, 10.0
M3, M3_NUT = 3.4, 5.8                        # lubang M3, mur M3 (lebar kunci 5.5 + celah)
BOLT_Y = (-8.0, 8.0)                         # 2 baut kunci di dudukan
TRAVEL = 12.5                                # geser ±12.5 mm (total 25 mm)
MOUNT_D = 3.4                                # lubang baut ke bando (di dinding pemandu)

Z0 = HEAD_B
ZT = Z0 + BAND_T                             # atas bando
ZF = ZT + FLOOR_T                            # lantai dudukan
XI = WIDTH / 2 + CLR
XO = XI + GUIDE_W
YB = BAND_W / 2
YL = BASE_L / 2


def link(name, me):
    ob = bpy.data.objects.new(name, me)
    sc.collection.objects.link(ob)
    return ob


def prism_yz(name, pts, x0, x1):
    """polygon in YZ extruded along X"""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    vs = [bm.verts.new((x0, y, z)) for y, z in pts]
    f = bm.faces.new(vs)
    r = bmesh.ops.extrude_face_region(bm, geom=[f])
    for v in [e for e in r["geom"] if isinstance(e, bmesh.types.BMVert)]:
        v.co.x = x1
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    return link(name, me)


def box(name, x0, x1, y0, y1, z0, z1):
    return prism_yz(name, [(y0, z0), (y1, z0), (y1, z1), (y0, z1)], x0, x1)


def cyl(name, r, depth, loc, seg=32):
    bpy.ops.mesh.primitive_cylinder_add(vertices=seg, radius=r, depth=depth, location=loc)
    ob = bpy.context.active_object
    ob.name = name
    return ob


def boolean(target, tool, op):
    m = target.modifiers.new("b", 'BOOLEAN')
    m.operation = op
    m.solver = 'EXACT'
    m.object = tool
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.data.objects.remove(tool, do_unlink=True)


def head_pt(phi):
    """titik di kepala (bidang YZ) dan normal keluar; phi = sudut dari puncak"""
    p = math.radians(phi)
    pt = Vector((HEAD_A * math.sin(p), HEAD_B * math.cos(p)))
    n = Vector((math.sin(p) / HEAD_A, math.cos(p) / HEAD_B)).normalized()
    return pt, n


# ================= PART 1: dudukan (dibaut / dilem ke bando) =================
base = box("Dudukan_Bando_PETG", -XO, XO, -YL, YL, ZT - LOCATE, ZF)
boolean(base, box("alur", -XO - 1, XO + 1, -YB - 0.2, YB + 0.2, ZT - LOCATE - 1, ZT), 'DIFFERENCE')
for s in (-1, 1):
    boolean(base, box("g", min(s * XI, s * XO), max(s * XI, s * XO), -YL, YL, ZF - 0.01, ZF + FLAT_T), 'UNION')
    # baut ke bando (opsional kalau dilem), di tengah lebar bando
    boolean(base, cyl("m", MOUNT_D / 2, 30, (s * (XI + GUIDE_W / 2), 0, ZF)), 'DIFFERENCE')
for y in BOLT_Y:                                 # baut kunci + kantong mur dari bawah
    boolean(base, cyl("b", M3 / 2, 30, (0, y, ZF)), 'DIFFERENCE')
    nut = cyl("n", M3_NUT / math.sqrt(3), 2.6 * 2, (0, y, ZT - LOCATE), seg=6)
    boolean(base, nut, 'DIFFERENCE')

# ================= PART 2: lengan pegas (digeser & dikunci baut) =================
y0, y1 = -FLAT_L / 2 + SHIFT, FLAT_L / 2 + SHIFT
arm = box("Lengan_Pegas_PETG", -WIDTH / 2, WIDTH / 2, y0, y1, ZF, ZF + FLAT_T)

# centerline lengkung
start = Vector((y1, ZF + FLAT_T - ARM_T / 2))
phi0 = math.degrees(math.asin(start.x / HEAD_A))
d0 = (start - head_pt(phi0)[0]).length
d_end = ARM_T / 2 + (PLATE_T - ARM_T / 2) + PIR_STACK - PRELOAD
# lengkung dihitung di posisi tengah (SHIFT=0) lalu digeser utuh bersama bagian lurus
start0 = Vector((FLAT_L / 2, start.y))
phi00 = math.degrees(math.asin(start0.x / HEAD_A))
d00 = (start0 - head_pt(phi00)[0]).length
N = 60
cl = []
for i in range(N + 1):
    s = i / N
    pt, n = head_pt(phi00 + (PHI_END - phi00) * s)
    p = pt + n * (d_end + (d00 - d_end) * (1 - s) ** 2)
    if i == 0:
        p = start0.copy()
    cl.append(p + Vector((SHIFT, 0)))
tan = (cl[-1] - cl[-2]).normalized()
for i in range(1, 7):
    cl.append(cl[-1] + tan * (PLATE_L / 6))


def offset(points, off):
    out = []
    for i, p in enumerate(points):
        a = points[max(i - 1, 0)]
        b = points[min(i + 1, len(points) - 1)]
        t = (b - a).normalized()
        out.append(p + Vector((-t.y, t.x)) * off)      # normal keluar kepala
    return out

outer, inner = offset(cl, ARM_T / 2), offset(cl, -ARM_T / 2)
boolean(arm, prism_yz("curve", [(p.x, p.y) for p in outer] + [(p.x, p.y) for p in reversed(inner)],
                      -WIDTH / 2, WIDTH / 2), 'UNION')
# isi sudut antara bagian lurus dan lengkung
boolean(arm, prism_yz("fil", [(y1 - 6, ZF), (y1 + 0.5, ZF), (cl[3].x, cl[3].y - ARM_T / 2), (y1 - 6, ZF + FLAT_T)],
                      -WIDTH / 2, WIDTH / 2), 'UNION')

# slot geser di bagian lurus
sl0, sl1 = BOLT_Y[0] - TRAVEL + SHIFT, BOLT_Y[1] + TRAVEL + SHIFT
boolean(arm, box("slot", -M3 / 2, M3 / 2, sl0, sl1, ZF - 1, ZF + FLAT_T + 1), 'DIFFERENCE')
for y in (sl0, sl1):
    boolean(arm, cyl("se", M3 / 2, 10, (0, y, ZF + FLAT_T / 2)), 'DIFFERENCE')

# plat dudukan piringan
p0 = cl[N]
pc = p0 + tan * (PLATE_L / 2)
nout = Vector((-tan.y, tan.x))
pl = [p0 + nout * (ARM_T / 2), p0 + tan * PLATE_L + nout * (ARM_T / 2),
      p0 + tan * PLATE_L - nout * (PLATE_T - ARM_T / 2), p0 - nout * (PLATE_T - ARM_T / 2)]
boolean(arm, prism_yz("plate", [(p.x, p.y) for p in pl], -WIDTH / 2, WIDTH / 2), 'UNION')

u3 = Vector((0, tan.x, tan.y)); w3 = Vector((0, nout.x, nout.y)); v3 = Vector((1, 0, 0))
c3 = Vector((0, pc.x, pc.y))
rot = Matrix((u3, v3, w3)).transposed().to_4x4()


def hole(r, a_deg, rad):
    a = math.radians(a_deg)
    loc = c3 + u3 * (rad * math.sin(a)) + v3 * (rad * math.cos(a))
    ob = cyl("h", r, 20, (0, 0, 0), seg=32 if r > 2 else 16)
    ob.matrix_world = Matrix.Translation(loc) @ rot
    bpy.ops.object.transform_apply(location=True, rotation=True)
    return ob

boolean(arm, hole(CENTER_D / 2, 0, 0), 'DIFFERENCE')
for k in range(6):
    boolean(arm, hole(HOLE_D / 2, 30 + 60 * k, PCD / 2), 'DIFFERENCE')

# ---------------- referensi: piringan TPU ----------------
bpy.ops.wm.stl_import(filepath=PIR_STL)
pir = bpy.context.selected_objects[0]
pir.name = "REF_Piringan_TPU"
bpy.context.view_layer.objects.active = pir
bpy.ops.object.mode_set(mode='EDIT')
bm = bmesh.from_edit_mesh(pir.data)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.x > 16], context='VERTS')   # ambil 1 dari 3
bmesh.update_edit_mesh(pir.data)
bpy.ops.object.mode_set(mode='OBJECT')
face = c3 - w3 * (PLATE_T - ARM_T / 2)
pir.matrix_world = Matrix.Translation(face) @ rot @ Matrix.Rotation(math.pi, 4, 'X')

# ---------------- referensi: baut M3 ----------------
bolts = []
for y in BOLT_Y:
    b = cyl("REF_Baut_M3", 1.5, 12, (0, y, ZF + FLAT_T - 6 + 1))
    boolean(b, cyl("hd", 2.75, 2, (0, y, ZF + FLAT_T + 1)), 'UNION')
    bolts.append(b)

# ---------------- referensi: kepala & bando ----------------
bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=32, radius=1)
headob = bpy.context.active_object
headob.name = "REF_Kepala"
headob.scale = (HEAD_W, HEAD_A, HEAD_B)
bpy.ops.object.transform_apply(scale=True)

band_pts = [(HEAD_W * math.sin(math.radians(-100 + 200 * i / 60)),
             HEAD_B * math.cos(math.radians(-100 + 200 * i / 60))) for i in range(61)]
me = bpy.data.meshes.new("band"); bm = bmesh.new()
rows = []
for y in (-YB, YB):
    for off in (0, BAND_T):
        rows.append([bm.verts.new((x * (1 + off / HEAD_W), y, z + off)) for x, z in band_pts])
def strip(a, b):
    for i in range(len(a) - 1):
        bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]))
strip(rows[0], rows[2]); strip(rows[3], rows[1]); strip(rows[1], rows[0]); strip(rows[2], rows[3])
bm.to_mesh(me); bm.free()
band = link("REF_Bando_PETG", me)

# ---------------- materials ----------------
def mat(name, rgba):
    m = bpy.data.materials.new(name); m.diffuse_color = rgba; return m
base.data.materials.append(mat("PETG_dudukan", (0.95, 0.55, 0.1, 1)))
arm.data.materials.append(mat("PETG_lengan", (0.15, 0.45, 0.85, 1)))
pir.data.materials.append(mat("TPU", (0.1, 0.1, 0.1, 1)))
mb = mat("Baut", (0.7, 0.7, 0.7, 1))
for b in bolts:
    b.data.materials.append(mb)
headob.data.materials.append(mat("Kepala", (0.9, 0.75, 0.6, 1)))
band.data.materials.append(mat("Bando", (0.05, 0.05, 0.05, 1)))

print("INFO shift=%.1f  electrode center (y,z)=(%.1f, %.1f)" % (SHIFT, pc.x, pc.y))

# ---------------- preview ----------------
sc.render.engine = 'BLENDER_WORKBENCH'
sh = sc.display.shading
sh.color_type = 'MATERIAL'; sh.show_cavity = True
sc.render.resolution_x, sc.render.resolution_y = 1200, 1000
cam = link("Cam", bpy.data.cameras.new("Cam")); sc.camera = cam
cam.data.clip_end = 5000
views = {"side": (Vector((420, 40, 70)), Vector((0, 50, 70)), 50),
         "persp": (Vector((260, 240, 220)), Vector((0, 50, 70)), 50),
         "detail": (Vector((140, -60, 200)), Vector((0, 10, 105)), 50)}
for k, (loc, tgt, lens) in views.items():
    cam.location = loc
    cam.rotation_euler = (tgt - loc).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = lens
    sc.render.filepath = OUT_PNG + "_" + k + ".png"
    bpy.ops.render.render(write_still=True)

bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
