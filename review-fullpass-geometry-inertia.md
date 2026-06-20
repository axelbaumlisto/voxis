# Full-Pass Geometric + Physical Consistency Review — `cell.ts` / `shared.ts`

**Scope:** GEOMETRY, DIRECTION, INERTIA, SPEED, STRUCTURE of every part (cilia,
body, nucleus, motion). Read-only CODE+MATH pass. No edits made.

**Inputs read:** `.pi/plans/cell-bio-accuracy-plan.md` (v3), `docs/CELL_MATH.md`,
`src/theme-engine/renderers/cell.ts` (full), `src/theme-engine/renderers/shared.ts`
(full), `research-cilia-hydrodynamics.md` / `research-membrane-areacons.md` cross-ref.

**⚠ Cross-check caveat:** The round-3 outputs named in the task —
`research-cilia-structure-inertia.md` and `research-cellbody-parts.md` — are
**NOT present in cwd**. Only the round-2 files exist. The plan v3 references a
"round 3 against primary sources" verification that is folded *into the plan text
itself*, not into standalone files. So my round-3 cross-check is against the plan's
embedded round-3 notes + round-2 research only. Findings below that depend on
round-3 biology (e.g. λ band, power:recovery ratio) are cited from the plan's own
round-3 annotations.

**Important framing:** Phases A–E in the plan are **not yet implemented** — the
live code is the *pre-B/C baseline*. There is no `normalizeArea`, no `tanh`
saturation, no affine squeeze, no motion-vector coupling, no bin interpolation,
no `ciliaAngleJitter` clamp in `ciliaPath`. So most "BUG/SMELL" items below are
either (a) confirmations the plan's targeted line is genuinely wrong/missing, or
(b) NEW issues the plan does not cover.

---

## Checklist (summary)

| # | Part | Verdict | One-line |
|---|------|---------|----------|
| 1 | CILIA geometry (`ciliaPath`) | **SMELL** | Spine math self-consistent & base-anchored, but `bend` is unbounded in px and can cross the membrane inward at large `curl·lenK`; `ciliaWave/ciliaWaveSpeed` params are dead in this path. |
| 2 | CILIA timing (`ciliaBeatPhase`) | **BUG** | Phase is continuous & in [0,1) but has a **velocity discontinuity at `u=powerTime`** (slope jump) → non-physical angular-velocity kink; also `recovery` is a hard 0.35/1 step (instant inertia jump). |
| 3 | DIRECTION (cilia vs normal) | **VERIFIED (today) / RISK (post-D2/D3)** | Today radial = membrane normal of the *base circle*, not the deformed contour — small mismatch; D2/D3 coupling is sound in plan but needs the deformed-normal fix to stay consistent. |
| 4 | INERTIA / MOTION | **BUG** | `wanderStep` bounce is energy-consistent & frame-rate independent, BUT heading random-walk uses `noise2D(...,(x+y)*0.01+heading)` giving **position-coupled jitter that is NOT a true random walk** and can lock/stall; `cellDrift` (legacy) still oscillates about centre. Speed is fps-independent. ✓ |
| 5 | NUCLEUS (`nucleusTransform`) | **BUG** | Containment uses fixed `baseR*0.55` but the membrane can pinch **inward** to `baseR*0.35` (floor) on the nucleus side → nucleus **can exit** the membrane under one-sided deformation. |
| 6 | Cross-part units/bounds | **BUG** | Two separate `maxRadius=height*0.46` literals (cell.ts:738, :1222) are **height-only, not aspect-aware** → on wide canvases the clamp is looser than the plan's `min(w,h)*0.46`; `cellReach` and the membrane clamp disagree (expected per plan), but `pseudopodOffset` adds **px** to a **fraction** pipeline inconsistently between the two contour builders. |

---

## 1. CILIA geometry — `ciliaPath` (cell.ts:460–531)

**Spine construction.** Per hair: radial unit `(ux,uy)=(cos,sin)(baseAngle)`,
perpendicular `(pxn,pyn)=(-uy,ux)`. Point `= center + radial·along + perp·bend`
with `along = baseR + lenK·sFrac` (cell.ts:516–524). This is geometrically
self-consistent: `along` is monotonic in `sFrac`, `(ux,uy)⊥(pxn,pyn)` exactly,
so the spine is a well-defined curve in the local Frenet-like frame. **VERIFIED.**

**Base clamp / tip free.** At `sFrac=0`: `along=baseR`, and `amp = curl·lenK·0.6·
pow(0,1.2)·(...) = 0` (cell.ts:522) → `bend=0`. So `points[0]` sits exactly on the
base circle regardless of phase/curl. Base is clamped, tip is free. **VERIFIED.**
The `pow(sFrac,1.2)` taper is monotonic increasing on [0,1], anchored at 0,
=1 at tip — correct taper. **VERIFIED.**

**Travelling sine.** `wave = sin(2π·(waves·sFrac − phase))` (cell.ts:519): increasing
`phase` over time moves the hump outward in `sFrac`. With `waves=1.1` the hair shows
~1 wavelength. Direction of travel is base→tip (phase subtracted), matching the
doc. **VERIFIED.**

**SMELL — bend amplitude is unbounded in px and can cross the membrane.**
`amp = curl·lenK·0.6·pow(sFrac,1.2)·(0.4+0.6·recovery)` (cell.ts:522),
`bend = (wave·0.7+beat·0.3)·amp` (cell.ts:523). Max `|wave·0.7+beat·0.3| = 1.0`,
`recovery=1` → `amp_max = curl·lenK·0.6`. With defaults `curl=0.7` and `lenK`
up to `lenMean·(1+lenVar)=lenMean·1.5`, and `lenMean ≈ baseR·(0.45+0.6)·(0.55+0.45)
= baseR·1.05`, we get `lenK_max ≈ 1.575·baseR`, so `amp_max ≈ 0.7·1.575·baseR·0.6
≈ 0.66·baseR`. The transverse offset near the tip can be **~0.66·baseR**, purely
perpendicular to the radial axis. Two consequences:

1. **Self/neighbor crossing:** mean angular gap `gap=2π/18≈0.35 rad`; tangential
   neighbour spacing at radius `~baseR` is `~0.35·baseR`. A transverse swing of
   0.66·baseR is ~1.9× the neighbour spacing, so adjacent hairs **can visibly
   cross** at high curl/length. Not catastrophic (it's stylized) but it is a
   geometric-consistency smell the plan does not bound.
2. **Membrane crossing:** the bend is purely transverse so it does not pull the
   tip *radially* inward (the radial component stays `≥ baseR`), so a hair tip
   never goes *inside* `baseR`. **So it does NOT cross the membrane inward** —
   good. But the *base segment* (`points[1]`, `sFrac=1/seg`) has `along≈baseR+
   lenK/6` with small but nonzero `amp`; still radially outward. **VERIFIED no
   inward membrane crossing.** The crossing risk is hair-vs-hair only.

**Corrected formula (bound the transverse swing to a fraction of arc spacing):**
```
const bendCap = 0.5 * gap * along;        // half the local tangential spacing
let bend = (wave*0.7 + beat*0.3) * amp;
bend = Math.max(-bendCap, Math.min(bendCap, bend));
```
This guarantees `|bend| < ½·(neighbour tangential spacing)` so hairs keep their
visual order at every arclength. (Plan A1 clamps `ciliaAngleJitter` for the BASE
order; this is the complementary clamp for the BENT body — **NEW correction not
in the plan**.)

**TDD property:** for `curl ∈ {0.7, 2, 5}`, `lenVar ∈ {0,0.5,0.95}`, all `t`:
for every hair and every segment `i`, the angular order of segment-i points
across hairs equals the base-angle order (no inversions) → no crossing.

**Units.** Everything in `ciliaPath` is in **px** (`baseR`, `lenK`, `along`,
`bend` all px). Internally consistent. **VERIFIED.** (Contrast with the contour
pipeline which mixes fractions — see §6.)

**SMELL — dead params.** `ciliaWave` (lateral angular sway) and `ciliaWaveSpeed`
are read only by the **legacy `ciliaEndpoints`** (cell.ts:~330, Bezier version),
which the renderer no longer calls — the live path uses `ciliaPath` (cell.ts:1244).
So `ciliaWave`/`ciliaWaveSpeed`/`CELL_DEFAULTS.ciliaWave=0.5` are dead in the
shipping render. Harmless but a maintenance smell; the cheat-sheet in CELL_MATH.md
still lists them as if active. **Note for cleanup**, not a blocker.

**BUG (latent, plan A1) — `ciliaAngleJitter` is NOT clamped in `ciliaPath`.**
cell.ts:474 uses `Math.max(0, …)` only (no upper bound), whereas `lenVar`
cell.ts:473 is clamped `[0,0.95]`. `angOff = noise·angleJit·gap·0.5`
(cell.ts:492); with `angleJit>1` the offset exceeds `±0.5·gap` → hairs cross the
even-grid order. Plan A1 already flags this (clamp to `[0,0.9]`). **Confirmed the
target line is correct; fix still pending.**

---

## 2. CILIA timing — `ciliaBeatPhase` (cell.ts:413–434)

**Continuity & range.** `lin = (t·hz + lag/τ) % 1`, `u = ((lin%1)+1)%1` → `u∈[0,1)`.
For `a=0` returns `u`. For `a>0`: `u<powerTime → 0.5·(u/powerTime) ∈ [0,0.5)`;
else `0.5 + 0.5·((u−powerTime)/(1−powerTime)) ∈ [0.5,1)`. The map is continuous at
`u=powerTime` (both branches give 0.5) and at the wrap `u→1⁻` gives `→1⁻`, wrapping
to 0 next cycle. **Output is continuous and in [0,1). VERIFIED.**

**Monotonic.** Each branch is linear-increasing in `u`; the join is continuous →
phase is monotonic non-decreasing within a period. **VERIFIED.**

**BUG — velocity (angular-rate) discontinuity at the power/recovery join.**
The phase *value* is continuous, but its **time-derivative is not.**
- power branch slope: `dphase/du = 0.5/powerTime = 0.5/((1−a)/2) = 1/(1−a)`.
- recovery branch slope: `0.5/(1−powerTime) = 0.5/(1−(1−a)/2) = 1/(1+a)`.
At `a=0.6`: power slope `=2.5`, recovery slope `=0.625` → a **4× instant jump in
dphase/dt** at `u=powerTime`. Because the rendered bend (`wave`, `beat`) is a
function of `phase`, the hair's transverse velocity jumps discontinuously at the
stroke transition — a non-physical "kink" in cilium kinematics (real cilia have
continuous velocity; the slowdown is smooth). This is exactly the kind of
"instant velocity jump" the task asks about. The plan's D3 proposes tuning
`ciliaAsymmetry` 0.6→0.49 but does **not** address the slope discontinuity.

**Aggravating BUG — `recovery` is a hard step.** cell.ts:511:
`const recovery = phase >= 0.5 ? 1 : 0.35;` — the amplitude envelope `(0.4+0.6·
recovery)` jumps from `0.61` to `1.0` instantly at `phase=0.5`. Combined with the
slope kink, the hair's *amplitude* also steps discontinuously → a visible "pop"
in curl at mid-beat. **Non-physical inertia jump.**

**Corrected formula (C¹-continuous skew + smooth recovery envelope):**
Replace the piecewise-linear skew with a smooth monotonic warp that has matching
slopes, e.g. a smoothstep-blended rate, and make `recovery` continuous:
```
// smooth recovery envelope (no step at 0.5)
const recovery = smoothstep((phase - 0.35) / 0.3);   // 0→1 across phase∈[0.35,0.65]
```
and for the clock, use a C¹ time-warp (e.g. integrate a smooth speed profile, or
a single `pow`/`smoothstep` reparam of `u`) so `dphase/du` has no jump. Minimal
option keeping the two-phase feel:
```
// blend the two linear slopes over a small window around powerTime
```
**TDD property:** numerically estimate `dphase/dt` via finite differences across
a full period at `a∈{0,0.49,0.6,0.95}`; assert `max|Δ(dphase/dt)|` between
adjacent samples is bounded (no >2× single-step jump). Also assert `recovery(t)`
is Lipschitz-bounded across the period (no step).

---

## 3. DIRECTION — cilia vs membrane normal (cell.ts:489–524, renderer :1244)

**Today.** Each hair's radial axis is the **base-circle** normal at `baseAngle`
(`ux=cos, uy=sin`). The membrane that's actually drawn is the *deformed* contour
`baseR·(1+deform[i])` (renderer :1216–1223). So the cilium base sits at radius
`baseR` along `baseAngle`, but the membrane surface at that angle is at
`baseR·(1+deform)`. Two mismatches:
1. **Radial gap:** when `deform>0` the membrane bulges past the cilium base → the
   hair appears to start *inside* the membrane; when `deform<0` (pinch) the hair
   base floats *outside* it. Visually masked because cilia are drawn *under* the
   fill, but geometrically the base is NOT on the surface.
2. **Normal direction:** on a deformed contour the true outward normal is not
   radial (it tilts by `atan(dr/dθ / r)`). Cilia ignore this and always point
   radially. For the mild default deformation this is a small angular error
   (a few degrees) — **acceptable today, SMELL not BUG.**

**VERIFIED (today, within tolerance).** Cilia are consistently radial; all hairs
use the same convention; no per-hair inconsistency.

**RISK after D2/D3.** The plan's drag-lean (D2) adds a downstream offset
`-(tx,ty)·dragGain·…` and metachronal orientation (D3) keys `metaIdx` off
`wrapPi(baseAngle − headingV)`. Both are defined relative to the **base radial
direction**, which is fine *as long as the base stays on the base circle*. But if
a future step puts the cilium base on the **deformed** contour (more correct),
the radial axis must become the **local contour normal**, else drag-lean and the
metachronal phase reference diverge from the actual surface. **NEW correction not
in the plan:** define the cilium frame from the *deformed-contour normal* (sample
`deform[i]` at the nearest vertex, compute `dr/dθ` for the tilt) and anchor the
base at `baseR·(1+deform)` — then D2/D3 stay consistent with the visible surface.

**Corrected base + normal:**
```
const rSurf = baseR * (1 + deformAt(baseAngle));        // anchor on real surface
const drdθ  = (deformNext - deformPrev)/(2*dθ) * baseR;  // contour slope
const nx = cos(baseAngle) - (drdθ/rSurf)*(-sin)...       // normalized contour normal
```
**TDD property:** with non-zero `deform`, assert each cilium base point lies on
the rendered contour polyline (distance < 1e-6·baseR) and the radial axis equals
the contour outward normal (dot with tangent ≈ 0).

---

## 4. INERTIA / MOTION — `wanderStep`, `cellDrift`, `driftActivation` (cell.ts:935–1110)

**Frame-rate independence (SPEED).** `speed = driftSpeed·min(w,h)·1.2` px/s;
`x += cos(heading)·speed·dt` (cell.ts:1044, :1052). `dt` clamped `[0.001,0.05]`
(renderer :~1140). Position update is explicit-Euler with real `dt` → speed is
fps-independent and tank-scaled. **VERIFIED.** `driftActivation` is a per-frame
lerp `prev+(target−prev)·rate` — note this is **NOT** dt-corrected (rate is
per-frame, not per-second). At 30 vs 120 fps the ramp time differs ~4×. Plan
Invariants demand fps-independence via `1−exp(−dt/τ)`. **SMELL** (minor, cosmetic
ramp), flagged: `driftActivation` and `growthLevel` and the startle decay are all
per-frame, not per-second — inconsistent with the dt-based wander. **NEW note.**

**Low-Re inertia (the core physics question).** Real microswimmers live at
Reynolds ≪ 1: **no coasting** — velocity is proportional to instantaneous force;
stop forcing → stop instantly (no momentum). `wanderStep` integrates a *heading*
random-walk and moves at constant `speed` along it. There is **no momentum term**
(no `v += a·dt` with carried velocity) — velocity is recomputed each frame from
heading (cell.ts:1044, :1059). So the integrator does **not** imply Newtonian
coasting; it's a kinematic steering model. **VERIFIED: no non-physical momentum.**
Caveat: the heading itself has "memory" (random walk), which reads as smooth
turning — that's a stylistic choice, acceptable and not coasting in the
translational sense.

**Wall bounce energy consistency.** `x<minX → heading = π−heading`; `y<minY →
heading = −heading` (cell.ts:1056–1066). These are exact specular reflections
about the wall normal (vertical wall flips x-component, horizontal flips
y-component). `speed` is unchanged across the bounce → **|v| conserved →
energy-consistent specular reflection. VERIFIED.** Position is clamped to the wall
before reflecting (no tunnelling). **VERIFIED.**

**BUG — heading random-walk is position-coupled, not a true random walk.**
cell.ts:1049: `jitter = noise2D(s.heading·0.5+13.0, (s.x+s.y)·0.01 + s.heading)`.
The jitter source depends on **both** `heading` and **position** `(x+y)`. Two
problems:
1. **Determinism degeneracy / stalls:** the increment `heading += jitter·turnRate
   ·dt`. If the noise field has a near-zero contour that the trajectory tracks,
   `jitter≈0` persistently → heading stops turning → the cell runs dead-straight
   into a wall, bounces, and can fall into a **limit cycle** (ping-pong between
   two walls) because the same `(heading, x+y)` neighbourhood is revisited. A
   genuine Reynolds wander perturbs heading by an *independent* small random
   displacement each step; coupling it to `(x+y)` makes the "randomness"
   spatially periodic and can lock.
2. **Speed of turning depends on absolute position** (`x+y` term) — moving the
   tank origin changes the path statistics. Not translation-invariant.

**Corrected formula (decoupled wander clock, Reynolds-style):**
```
// advance an internal wander phase, independent of position
s.wanderClock += dt;
const jitter = noise2D(s.wanderClock * wanderFreq, 31.7);  // 1-D random walk source
heading += jitter * turnRate * dt;
```
Carry `wanderClock` in `WanderState`. This gives a true temporal random walk of
heading, translation-invariant, no position lock. **NEW correction not in plan.**
(The plan's D-phases assume `wanderStep` produces `(vx,vy)` cleanly; this bug
feeds D2/D3/D4 a heading that can stall — worth fixing before motion-coupling.)

**TDD property:** over a long run (N=10⁴ steps) the heading autocorrelation
decays (no permanent lock); the visited-position set covers >X% of the tank
(no 2-wall limit cycle) for a sweep of start headings; path statistics are
invariant to a constant offset added to initial `(x,y)`.

**`cellDrift` (legacy, cell.ts:951–1010).** Still `position = mapTo(noise2D(t·
speed,0))` — oscillates about centre (the very bug the wander rewrite fixed).
It's **no longer used by the renderer** (renderer uses `wanderStep`) but remains
exported and tested (cell.test.ts:1611). The CELL_MATH doc §2 explicitly calls
this out as the old behavior. **Note:** dead-but-tested code; either delete or
document as deprecated to avoid future misuse. Not a live bug.

---

## 5. NUCLEUS — `nucleusTransform` (cell.ts:771–814)

**Geometry.** Offset `(rawCx,rawCy) = baseR·nucleusWander·noise(...)`, radius
`r = baseR·(nucleusRadius + audio·nucleusPulse + idleBreath)`, floored at 2.5px
(cell.ts:778–785). Containment: `safeInner = baseR·0.55`, `maxOffsetMag =
max(0, safeInner − r)`, offset radially clamped to `maxOffsetMag` (cell.ts:793–
812). So `|offset| + r ≤ safeInner = 0.55·baseR`. **The nucleus stays within a
circle of radius 0.55·baseR of the (drifted) cell centre. VERIFIED against a
circle of radius 0.55·baseR.**

**BUG — containment is against a FIXED `0.55·baseR`, but the membrane can pinch
inward to `0.35·baseR` on the nucleus side.** The membrane contour radius is
`max(floorRadius, …)` with `floorRadius = baseR·0.35` (renderer :1223), and
`deform[i]` can be **negative** (FBM, idle morph clamp ±amplitude, pseudopods are
≥0 but FBM/idle are signed). So on one side the membrane wall can sit at
`0.35·baseR` while the nucleus is allowed to push its *far edge* out to
`0.55·baseR` on that same side. **The nucleus can poke through a pinched
membrane.** The `0.55` "conservative" margin assumes the wall never goes below
`~0.55`, but the floor is `0.35` and even un-floored deformation routinely dips
below `0.55` (`1+deform < 0.55` ⇔ `deform < −0.45`, reachable on a strong
pinch/negative-FBM frame at high energy: `membraneAmplitude·amp` with
`amp=idle+energy·energyDrive` up to `0.1+1·0.8=0.9`, `noiseVal·0.35·0.9≈±0.31`,
plus negative idle/pseudopod-borrow — marginal but reachable, and *guaranteed*
once C1 area-normalization lands, which deliberately pulls one side inward when
the opposite bulges).

**Corrected formula — containment must track the LOCAL membrane radius, not a
constant.** Make `safeInner` the *minimum membrane radius over the nucleus's
angular neighbourhood*, or simply the global floor with margin:
```
const wallFloor = baseR * 0.35;            // matches renderer floorRadius
const safeInner = Math.min(baseR * 0.55, wallFloor - 0); // never exceed the floor
// better: pass the actual min(1+deform[i])·baseR into nucleusTransform
const safeInner = minMembraneR * 0.85;     // 15% clearance from the nearest wall
```
Cleanest: thread the current `deform[]` (or its min) into `nucleusTransform` and
clamp `|offset| + r ≤ minMembraneRadius·(1−clearance)`. **This is a NEW
correction the plan does not cover** — the plan's Containment section only
separates *membrane maxRadius* vs *cellReach* (outward), and never addresses the
*inward* nucleus-vs-pinch case. With C1 (one-sided inward borrow) this becomes a
guaranteed escape, so it must be fixed *before or with* C1.

**TDD property:** for a deformation field with a deep one-sided pinch
(`deform` reaching the floor on the nucleus side) and max `nucleusPulse`+drift,
assert the nucleus disk (centre `cx+offset`, radius `r`) is fully inside the
rendered contour polygon (point-in-polygon for the full disk, sampled).

**Minor SMELL — `idleBreath` can make `r` negative pre-floor.**
`idleBreath = sin(t·1.3)·nucleusPulse·0.25` is signed; `nucleusRadius`(0.28)
dominates so `r>0` always at defaults, and the 2.5px floor saves it regardless.
**VERIFIED safe at defaults**, but the floor is doing the work — fine.

---

## 6. Cross-part consistency — units & bounds (`cellReach`, `resolveBaseRadius`, deformation pipeline)

**`resolveBaseRadius` (cell.ts:880–890).** Returns px: `(baseRadiusPx ?? min(w,h)
·radiusFraction)·(1+growth·growthSwell)`. Pure, monotonic in growth. **VERIFIED.**

**BUG — `maxRadius = height*0.46` is height-only, not aspect-aware (two
literals).** cell.ts:738 (`buildCellContour`) and cell.ts:1222 (live renderer).
On a wide overlay (w≫h) `height*0.46` is correct-ish, but the plan B1 mandates
`min(w,h)*0.46` so the clamp protects the **narrow** dimension. On the shipping
160×160 they're equal, but `buildCellContour` is tested at 400×100 and 300×200
(cell.test.ts:717,765) where `height*0.46` lets the contour exceed the width
budget. **Confirmed the plan's targeted lines (738, 1222) are both wrong; fix
pending.** Corrected: `const maxRadius = Math.min(width, height) * 0.46;` in both.

**BUG/SMELL — unit inconsistency between the two contour builders.**
- `buildTargetDeformation` (cell.ts:~690) works in **fractions**: converts
  pseudopod px → fraction via `invBaseR` (`pseudoDeform = rPseudo·invBaseR`), sums
  `fbmDeform + pseudoDeform + binDeform + idle` → all fractional. ✓ This is the
  **live** path (renderer integrates this). Internally consistent. **VERIFIED.**
- `buildCellContour` (cell.ts:712–760) works in **px**: `rawRadius = baseR·rFbm +
  rPseudo + binLevel·baseR·0.15·energy`. Here `rPseudo` is added as **raw px** and
  the bin term as px. This is a **different formula** than the live path (which
  scales pseudopod by `invBaseR` then re-multiplies by baseR — algebraically the
  same for pseudopod, BUT the bin term differs: live uses `binLevel·0.15·energy`
  as a fraction of baseR identically, so those match). The real divergence:
  `buildCellContour` does **not** apply `idleMorph`, `integrateDeformation`, or the
  same clamp floor (`0.35` both, ok). So `buildCellContour` is a **stale parallel
  implementation** of the contour that no longer matches the live renderer path.
  The plan B3 explicitly flags this ("Fold `buildCellContour` to share the live
  fraction model or test live directly"). **Confirmed: the two are out of sync;
  any area test run on `buildCellContour` does NOT validate the live contour.**

**`cellReach` vs membrane `maxRadius` (cell.ts:911–921).** `cellReach =
max(baseR·1.4, baseR+baseR·(ciliaLen+boost)·1.3) + startleMaxPx`. With defaults
`≈ max(1.4, 1+1.05·1.3)·baseR + 5 = max(1.4,2.365)·baseR+5 ≈ 2.37·baseR+5`. Used
only for **containment/inset** (wander/drift) so the whole organism stays off the
walls. The membrane `maxRadius=height·0.46` is the **per-vertex clamp**. The plan
correctly says these MUST stay separate (don't set membrane clamp to cellReach).
**VERIFIED the separation is intact today.** One inconsistency: `cellReach`'s
cilia term uses the legacy `ciliaEndpoints` length factor `·1.3` (`0.7+energy·0.6`
worst case = 1.3), but the **live** `ciliaPath` uses `(0.55+0.45·energy)` worst
case = **1.0**, plus per-hair `lenVar` up to `·1.5` → worst `lenK ≈ lenMean·1.5`
with `lenMean = baseR·(ciliaLen+boost)·1.0`. So live worst cilia reach ≈
`baseR + baseR·(ciliaLen+boost)·1.5`, i.e. factor **1.5 not 1.3**. **`cellReach`
UNDER-estimates the live cilia reach** (1.3 vs 1.5) → at max `lenVar` the longest
hair can extend ~0.2·baseR beyond the computed reach and **clip the wall**.
**NEW correction not in plan:** update `cellReach`'s cilia term to match
`ciliaPath`: `baseR + baseR·(ciliaLength+ciliaGrowthBoost)·(1 + ciliaLengthVar)`
(=1.5 at defaults), and drop the stale `·1.3` energy assumption. Plus add the
drag-lean headroom the plan mentions for D2.

**TDD property:** assert `cellReach(baseR,p) ≥ max over all hairs,segments,t of
|ciliaPath point − center|` for an audio/energy/growth sweep at `lenVar` max.
Currently this FAILS at `lenVar=0.95`.

---

## NEW corrections not in the plan (consolidated)

1. **Cilia bend transverse cap** (§1): bound `|bend| < ½·gap·along` to prevent
   neighbour-hair crossing at high curl/length. Plan A1 only fixes base order.
2. **`ciliaBeatPhase` C¹ discontinuity** (§2): the slope jump at `powerTime`
   (1/(1−a) → 1/(1+a)) and the hard `recovery` step (0.35→1 at phase 0.5) are
   non-physical velocity/inertia jumps. Plan D3 only retunes the asymmetry value.
3. **Nucleus inward-pinch escape** (§5): containment vs fixed `0.55·baseR` fails
   when the membrane floors to `0.35·baseR` (and is *guaranteed* to fail after
   C1's one-sided inward borrow). Thread `min(deform)` into `nucleusTransform`.
   Plan's Containment section never covers the inward case.
4. **`wanderStep` position-coupled jitter** (§4): replace `(x+y)`-coupled noise
   with a decoupled temporal wander clock to avoid stalls/limit-cycles and gain
   translation invariance. Plan assumes `wanderStep` is clean.
5. **`cellReach` under-estimates live cilia** (§6): uses 1.3 factor vs live 1.5
   (incl. `lenVar`); longest hair can clip the wall. Fix the factor and add D2
   drag-lean headroom.
6. **dt-inconsistent ramps** (§4 note): `driftActivation`, `growthLevel`, startle
   decay are per-frame, not per-second — inconsistent with the dt-based wander and
   the plan's own fps-independence invariant.

## Confirmations of plan-targeted issues (already in plan, verified correct target)

- **A1** `ciliaAngleJitter` unclamped at cell.ts:474 — confirmed (only `max(0,…)`).
- **A3** bin lookup is nearest-bin step (cell.ts:~675, 723) — confirmed
  discontinuous (no interpolation/wraparound).
- **B1** two `height*0.46` literals at cell.ts:738 and :1222 — confirmed, and
  height-only (not aspect-aware). §6 BUG.
- **B3** `buildCellContour` is a stale parallel path — confirmed divergent from
  the live integrated pipeline. §6.
- **C1/C2** no area normalization or affine squeeze exists yet — confirmed absent;
  resting shape is additive-inflation (mean radius > baseR), matching the plan's
  "pre-B/C baseline" framing.

## What is solid (VERIFIED, no action)

- Cilia spine frame orthogonality, base anchoring, taper, travelling-wave
  direction (§1).
- Beat phase range/continuity/monotonicity of the *value* (§2) — only its
  derivative is the problem.
- Wander: no translational momentum (low-Re consistent), specular energy-
  conserving wall bounce, frame-rate-independent translational speed (§4).
- Nucleus radial containment math against a circle is exact (§5) — the bug is the
  *choice* of that circle's radius vs the deformable wall.
- Live deformation pipeline (`buildTargetDeformation` → `integrateDeformation`)
  is unit-consistent in fractions (§6).

---

### Process note (review-only vs progress-writing)
Per instructions, this is a read-only CODE+MATH pass; no source edits were made.
`progress.md` exists and is an allowed scratch file — left untouched (review-only
wins over progress-writing). Findings delivered to
`review-fullpass-geometry-inertia.md` as requested.
