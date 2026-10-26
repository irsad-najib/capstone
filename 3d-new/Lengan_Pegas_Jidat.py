import bpy, bmesh, sys, math
from mathutils import Vector, Matrix

args = sys.argv[sys.argv.index("--") + 1:]
OUT_BLEND, OUT_PNG, PIR_STL = args[0], args[1], args[2]

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.unit_settings.scale_length = 0.001
sc.unit_settings.length_unit = 'MILLIMETERS'

# ---------------- parameters (mm) ----------------
HEAD_A, HEAD_B, HEAD_W = 95.0, 100.0, 75.0   # kepala (ellipsoid): depan-belakang, tinggi, kiri-kanan
BAND_W, BAND_T = 50.0, 2.8                   # bando: lebar 5 cm, tebal 2-3 mm (+clearance)
WALL = 2.5                                   # tebal dinding klip
LIP = 4.0                                    # bibir klip di bawah bando
WIDTH = 32.0                                 # lebar part (arah X) = lebar piringan
ARM_T = 2.5                                  # tebal lengan pegas
PLATE_T = 3.5                                # tebal plat dudukan piringan
PLATE_L = 34.0                               # panjang plat lurus
PHI_END = 60.0                               # sudut (dari puncak kepala) akhir lengkung
PRELOAD = 6.0                                # seberapa "masuk" ke jidat waktu bebas (= tekanan)
PIR_STACK = 4.5                              # tebal piringan TPU
PCD, HOLE_D, CENTER_D = 26.0, 1.8, 10.0

Z0 = HEAD_B                                  # bawah bando = puncak kepala


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


def rect_yz(name, y0, y1, z0, z1):
    return prism_yz(name, [(y0, z0), (y1, z0), (y1, z1), (y0, z1)], -WIDTH / 2, WIDTH / 2)


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


# ---------------- klip bando ----------------
yb = BAND_W / 2
top = Z0 + BAND_T
part = rect_yz("Lengan_Pegas_PETG", -yb - WALL, yb + WALL, top, top + WALL)
for s in (-1, 1):
    y_out, y_in = s * (yb + WALL), s * yb
    boolean(part, rect_yz("w", min(y_out, y_in), max(y_out, y_in), Z0 - WALL, top + 0.01), 'UNION')
    y_lip = s * (yb - LIP)
    boolean(part, rect_yz("l", min(y_lip, y_out), max(y_lip, y_out), Z0 - WALL, Z0), 'UNION')

# ---------------- centerline lengan ----------------
start = Vector((yb + WALL - ARM_T / 2, top + WALL - ARM_T / 2))
phi0 = math.degrees(math.asin(start.x / HEAD_A))
d0 = (start - head_pt(phi0)[0]).length
# ujung: muka piringan masuk PRELOAD mm ke kulit saat lengan bebas
d_end = ARM_T / 2 + (PLATE_T - ARM_T / 2) + PIR_STACK - PRELOAD
N = 60
cl = []
for i in range(N + 1):
    s = i / N
    phi = phi0 + (PHI_END - phi0) * s
    pt, n = head_pt(phi)
    d = d_end + (d0 - d_end) * (1 - s) ** 2
    cl.append(pt + n * d)
tan = (cl[-1] - cl[-2]).normalized()
for i in range(1, 7):
    cl.append(cl[-1] + tan * (PLATE_L / 6))


def offset(points, off):
    out = []
    for i, p in enumerate(points):
        a = points[max(i - 1, 0)]
        b = points[min(i + 1, len(points) - 1)]
        t = (b - a).normalized()
        nrm = Vector((-t.y, t.x))          # normal keluar kepala
        out.append(p + nrm * off)
    return out

outer = offset(cl, ARM_T / 2)
inner = offset(cl, -ARM_T / 2)
arm = prism_yz("arm", [(p.x, p.y) for p in outer] + [(p.x, p.y) for p in reversed(inner)],
               -WIDTH / 2, WIDTH / 2)
boolean(part, arm, 'UNION')

# ---------------- plat dudukan piringan ----------------
p0 = cl[N]
pc = p0 + tan * (PLATE_L / 2)                 # pusat piringan
nout = Vector((-tan.y, tan.x))
pl = [p0 + nout * (ARM_T / 2), p0 + tan * PLATE_L + nout * (ARM_T / 2),
      p0 + tan * PLATE_L - nout * (PLATE_T - ARM_T / 2), p0 - nout * (PLATE_T - ARM_T / 2)]
boolean(part, prism_yz("plate", [(p.x, p.y) for p in pl], -WIDTH / 2, WIDTH / 2), 'UNION')

# frame lokal plat: u = sepanjang lengan, v = X, w = normal keluar
u3 = Vector((0, tan.x, tan.y)); w3 = Vector((0, nout.x, nout.y)); v3 = Vector((1, 0, 0))
c3 = Vector((0, pc.x, pc.y))
rot = Matrix((u3, v3, w3)).transposed().to_4x4()


def hole(r, a_deg, rad):
    a = math.radians(a_deg)
    loc = c3 + u3 * (rad * math.sin(a)) + v3 * (rad * math.cos(a))
    bpy.ops.mesh.primitive_cylinder_add(vertices=32 if r > 2 else 16, radius=r, depth=20, location=(0, 0, 0))
    ob = bpy.context.active_object
    ob.matrix_world = Matrix.Translation(loc) @ rot
    bpy.ops.object.transform_apply(location=True, rotation=True)
    return ob

boolean(part, hole(CENTER_D / 2, 0, 0), 'DIFFERENCE')
for k in range(6):
    boolean(part, hole(HOLE_D / 2, 30 + 60 * k, PCD / 2), 'DIFFERENCE')

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
face = c3 - w3 * (PLATE_T - ARM_T / 2)        # muka dalam plat
flip = Matrix.Rotation(math.pi, 4, 'X')        # hub piringan menghadap kulit
pir.matrix_world = Matrix.Translation(face) @ rot @ flip

# ---------------- referensi: kepala & bando ----------------
bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=32, radius=1)
headob = bpy.context.active_object
headob.name = "REF_Kepala"
headob.scale = (HEAD_W, HEAD_A, HEAD_B)
bpy.ops.object.transform_apply(scale=True)

band_pts = []
for i in range(61):
    a = math.radians(-100 + 200 * i / 60)
    band_pts.append((HEAD_W * math.sin(a), HEAD_B * math.cos(a)))
me = bpy.data.meshes.new("band"); bm = bmesh.new()
rows = []
for y in (-yb, yb):
    for off in (0, BAND_T - 0.3):
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
part.data.materials.append(mat("PETG", (0.15, 0.45, 0.85, 1)))
pir.data.materials.append(mat("TPU", (0.1, 0.1, 0.1, 1)))
headob.data.materials.append(mat("Kepala", (0.9, 0.75, 0.6, 0.35)))
band.data.materials.append(mat("Bando", (0.05, 0.05, 0.05, 1)))
headob.display_type = 'WIRE'

# ---------------- info ----------------
skin_face = (face - w3 * PIR_STACK)
hp, hn = head_pt(math.degrees(math.atan2(skin_face.y * HEAD_B / HEAD_A, skin_face.z)))
print("INFO plat center (y,z)=(%.1f, %.1f)" % (pc.x, pc.y))
print("INFO arc phi0=%.1f d0=%.1f d_end=%.1f" % (phi0, d0, d_end))
print("INFO electrode angle from vertex = %.1f deg" % math.degrees(math.atan2(pc.x, pc.y)))

# ---------------- preview ----------------
sc.render.engine = 'BLENDER_WORKBENCH'
sh = sc.display.shading
sh.color_type = 'MATERIAL'; sh.show_cavity = True
sh.show_xray = False
sc.render.resolution_x, sc.render.resolution_y = 1200, 1000
cam = link("Cam", bpy.data.cameras.new("Cam")); sc.camera = cam
cam.data.clip_end = 5000
views = {"side": Vector((420, 40, 70)), "persp": Vector((260, 240, 220))}
for k, loc in views.items():
    cam.location = loc
    tgt = Vector((0, 50, 70))
    cam.rotation_euler = (tgt - loc).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = 50
    sc.render.filepath = OUT_PNG + "_" + k + ".png"
    bpy.ops.render.render(write_still=True)

bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
