# `headphone_v2.blend` — print-ready multi-material headphone

A clean rebuild, replacing the accumulated repair layers in `capstone.blend`. Nothing here derives
from the third-party Sketchfab asset — all geometry is generated from scratch, so there is no
licence or attribution question attached to it.

Built parametrically. Every solid comes from primitives + exact booleans, so it is manifold by
construction rather than repaired afterwards.

---

## Ear opening and internal space

The cups are **elliptical, not circular** — a human pinna is roughly 60–65 mm tall × 30–35 mm wide,
so a round opening wastes width while pinching height.

| | Value |
| --- | --- |
| Ear opening | **40 mm wide × 62 mm tall** (ellipse) |
| Opening area | **1,948 mm² ≈ 19.5 cm²** |
| Pad depth (ear-to-driver gap) | **24 mm** |
| Usable ear volume | **46.7 cm³** |
| Cup cavity | 80 × 96 mm × 32.2 mm deep |
| Cup cavity volume | **196.0 cm³** total |
| **Free for components** (behind the baffle) | **159.5 cm³**, 26.2 mm deep |

The 62 mm height clears a typical pinna; the 24 mm depth keeps the ear off the driver baffle, which
is what makes an over-ear seal comfortable rather than pressing on the ear.

### No pad ring — the foam bonds straight to the cup

A separate pad ring exists in commercial headphones for exactly one reason: to let users swap worn
pads without opening the cup. Acoustically it is a **liability** — every part-to-part interface is an
air-leak path, and leaks are what actually destroy passive isolation.

It has been removed. The foam pad now bonds directly to the cup rim, retained by a **lip moulded
into the cup shell itself** (1.5 mm proud, 3 mm tall), so pads stay replaceable without adding a
joint. The freed axial space went into the cup:

| | With pad ring | Direct-bond |
| --- | --- | --- |
| Cup cavity depth | 17.6 mm | **32.2 mm** |
| Cup cavity volume | 104.2 cm³ | **196.0 cm³** (+88%) |
| Space behind the baffle | ~55 cm³ | **159.5 cm³** |
| Printed parts | 10 | **8** |

That 159.5 cm³ behind the driver baffle is the room available for the EEG electronics.

## Overall envelope

| | v2 | old `capstone.blend` | real Surface Headphones 2 |
| --- | --- | --- | --- |
| Depth (X) | 98.0 mm | 87.2 mm | — |
| Ear-to-ear (Y) | 156.2 mm | 167.9 mm | 195 mm |
| Height (Z) | 203.5 mm | 204.0 mm | 204 mm |

Width is measured **at rest**; the spring-steel band spreads to fit a head (~150 mm wide) in use.

---

## Assembly

```
spring steel strip 14 x 1.0 mm, bent arc        NOT PRINTED
   |
   +-- Band_Shoe            printed, vertical slot + 2x M3 through the strip
         |
         +-- swivel axis (vertical, M3 + TPU washer)
               |
               +-- Gimbal_Ring     printed
                     |
                     +-- tilt axis (horizontal front-back, M3 into heat-set insert)
                           |
                           +-- Cup_Shell        printed, integral pad retention lip
                                 +-- Driver_Baffle   printed, 40 mm driver seat
                                 +-- foam ear pad    bonded straight to the rim (no ring)
```

**Both axes intersect at the cup centre** (x = 0, y = ±64 mm, z = −42 mm). That is the whole point
of the gimbal: the cup floats and self-aligns to the head under the band's clamping force instead of
levering off one edge. A rigid joint leaves a gap at the pad and passive isolation collapses — this
was the explicit requirement ("butuh fleksibilitas cup untuk peredaman suara yang lebih baik").
TPU washers at both axes add the compliance.

Tilt ±15°, swivel ±90° (folds flat for storage / around the neck).

## Parts

**Printed** — collection `Printed`, 8 objects, `_R` / `_L` pairs:

| Part | Volume | Mass (pair, PLA) | Bed footprint |
| --- | --- | --- | --- |
| `Cup_Shell` | 53.2 cm³ | 132.0 g | 91 × 34 × 103 mm |
| `Driver_Baffle` | 12.4 cm³ | 30.7 g | 79 × 2.5 × 95 mm |
| `Gimbal_Ring` | 9.6 cm³ | 23.8 g | 98 × 20 × 130 mm |
| `Band_Shoe` | 2.4 cm³ | 5.8 g | 17 × 12 × 20 mm |
| **Total printed** | | **192.3 g** | |

### Weight

PLA at 1.24 g/cm³, solid walls. A real Surface Headphones 2 weighs **290 g complete**, so the
plastic alone has to stay well under that — the drivers, EEG electronics, steel strip and foam all
still have to fit in the budget.

First pass came out at **260 g**, which was too heavy. Trimmed to **192 g** by:

| Change | Saved |
| --- | --- |
| Band shoe: solid block → vertical-slot clamp, and a 14 mm strip instead of 20 mm | 18.2 g |
| Driver baffle: 4 mm → 2.5 mm plate | 17.4 g |
| Gimbal ring: 9 mm → 6 mm wide | 19.2 g |
| Wall thickness 2.4 → 1.8 mm (still 4+ perimeters at 0.4 mm) | 14.0 g |

`Cup_Shell` at 132 g is now 69 % of the printed mass and the obvious next target — but cutting it
means either thinner walls or a shallower cup, and a shallower cup costs component space. That is a
direct trade-off, not a free win.

Note the figures assume solid material. Thick parts print with infill, so the real baffle and shoe
will come out lighter than listed; the thin-walled cup shell will not.

Everything fits a 180 × 180 × 180 mm bed — nothing needs splitting.

**Not printed** — collection `Non_Printed`, modelled as reference so fit can be checked:
`Band_Strip` (spring steel), `Ear_Pad_R/L` (foam + leather), `Head_Cushion` (foam).

## Hardware BOM

| Item | Qty | Where |
| --- | --- | --- |
| M3 × 12 socket screw | 4 | tilt axis, 2 per cup |
| M3 × 16 socket screw | 2 | swivel axis, 1 per cup |
| M3 × 10 screw + nut | 4 | band shoe strip clamp, 2 per shoe |
| M3 heat-set insert | 4 | tilt axis, in the cup shell |
| TPU washer 8 × 3.2 × 1 mm | 6 | compliance at both axes |
| Spring steel strip 14 × 1.0 mm | 1 | ~330 mm developed length |
| 40 mm driver | 2 | seats in `Driver_Baffle` |

## Print settings baked into the geometry

- Wall **1.8 mm** = 4+ perimeters at a 0.4 mm nozzle.
- Every part has a flat face for the bed; **no supports needed**.
- Clearance **0.25 mm** on rotating fits, 0.15 mm on press fits.
- M3 through-holes 3.2 mm; heat-set bosses 4.0 mm bore × 5.7 mm deep.

## Assembly order

1. Heat-set 4 inserts into the `Cup_Shell` tilt bosses.
2. Drop `Driver_Baffle` + driver into the cup, wire out through the rear vent.
3. Bond the foam pad to the cup rim, stretched over the integral retention lip.
4. `Gimbal_Ring` over the cup, M3 × 12 + TPU washer each side into the inserts — snug, not tight;
   the cup must still tilt.
5. `Band_Shoe` onto the gimbal post, M3 × 16 + TPU washer through the swivel bore.
6. Drop the steel strip into each shoe's vertical slot; 2× M3 × 10 + nut pass through both
   shoe walls **and holes in the strip**, locking it positively rather than by friction.

---

## Build and verification

Regenerate the whole file from the parametric script:

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
  --python scratchpad/build_v2.py
```

Four gates run on every build, and all currently pass:

| Gate | Result |
| --- | --- |
| Watertight — 0 non-manifold, 0 boundary edges, positive volume | **8/8 parts pass** |
| Mirror symmetry, left vs right, from vertex data | **0.00000 mm** on all 4 pairs |
| Envelope | 98.0 × 156.2 × 203.5 mm |
| Print-bed fit, 180 mm cube | all parts pass |

Symmetry is exact because the right side is built once and the left is a mirrored copy — correct by
construction, not by measurement. That removes the entire class of left/right bugs that dominated
the old file.

**Measurement rule:** every check reads **vertex data**. `object.bound_box` is cached and goes stale
after direct `matrix_world` edits — in the old file it produced three confident but wrong
conclusions (a phantom 21 mm cup asymmetry, a phantom 33 mm mesh defect, and an unnecessary removal
of five meshes). Objects in an excluded collection are worse still: they are never evaluated, so
their `matrix_world` is identity and measurements come out absurd.

## Not done yet

- **EEG sensor mounts.** Deferred by choice — body first. The band shoe and the crown are the
  natural mounting points; electrode bosses and cable channels come next.
- Cosmetic surface detail (slider marks, panel splits) — the parts are functional shapes for now.
