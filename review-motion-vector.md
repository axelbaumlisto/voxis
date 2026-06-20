# Review — Motion‑Vector Coupling (aspect 2)

Scope: how the wander **velocity** vector should drive cilia bend, the
metachronal‑wave orientation, and membrane elongation. Read‑only review of
`src/theme-engine/renderers/cell.ts`, `renderers/shared.ts`, `docs/CELL_MATH.md`,
against `.pi/plans/cell-bio-accuracy-review.md`. No code edited.

References use `cell.ts` line numbers as read at review time.

---

## Review

### Correct (already good)
- **Velocity is actually computed and exposed.** `WanderState` carries
  `vx, vy` (cell.ts:1005–1011); `wanderStep` computes them
  (cell.ts:1046–1047), recomputes them after any wall reflection
  (cell.ts:1067–1068) and returns them (cell.ts:1073). So the renderer has a
  clean, physically meaningful velocity vector every frame — the data needed
  for all three couplings already exists.
- **Heading is well‑conditioned.** It is normalized to [−π, π]
  (cell.ts:1071) and velocity is recomputed *after* reflection, so
  `atan2(vy, vx)` is a trustworthy travel direction.
- **A motion‑gating signal already exists**: `drift01` (cell.ts:1222) ramps
  0→1 only while recording, and the rendered centre is a blend
  `driftedX/Y = centre + (wander − centre)·drift01` (cell.ts:1218–1219). This
  is the right scalar to also gate all velocity coupling (no spurious lean
  while the cell rests centred).

### Blocker — velocity is dropped before rendering
At cell.ts:1216–1221 only **position** survives:
```ts
wander = wanderStep(wander, dt, width, height, baseR, params);
const driftedX = width / 2 + (wander.x - width / 2) * drift01;
const driftedY = height / 2 + (wander.y - height / 2) * drift01;
const cx = driftedX + sdx;
const cy = driftedY + sdy;
```
`wander.vx` / `wander.vy` are **never read again** anywhere in the file
(confirmed by grep: the only reads of `vx`/`vy` are inside `wanderStep`). The
travel direction is computed, returned, and discarded one line later. As a
result:

1. **`ciliaPath` has no velocity parameter at all** (signature cell.ts:460:
   `ciliaPath(cx, cy, baseR, t, energy, growth, params)`). Each hair is built
   purely radially from its own `baseAngle` (cell.ts:494–497) and the only
   transverse offset is the intrinsic beat wave (cell.ts:519–525). Cilia
   therefore ignore which way the organism swims — biologically wrong: motile
   cilia/flagella **lean and bend downstream (opposite travel)** from viscous
   drag, and the leading edge differs from the trailing edge.
2. **The metachronal wave is keyed to array index, not the motion axis.**
   `ciliaBeatPhase` derives its lag as `ciliaMetachronal * index`
   (cell.ts:419) and is called with the raw loop counter `k` (cell.ts:510).
   The wave sweeps in hair‑emission order regardless of swimming direction. A
   real ciliate's metachronal wave has a **defined orientation relative to the
   swimming axis** (symplectic/antiplectic).
3. **The membrane is isotropic.** The render loop uses
   `rawRadius = baseR * (1 + deform[i])` (cell.ts:1229) with no directional
   term; `buildCellContour` is the same (cell.ts:~726). A swimming cell
   **elongates along its velocity (prolate)**; here it stays a blob that
   wobbles identically in all directions while moving.

This is the single root cause for aspect 2: the velocity vector exists but is
severed at cell.ts:1216–1221.

---

## Recommended math (minimal, pure, testable)

### 0. Derive the motion basis once, in the tick (after cell.ts:1221)
```
vmag      = hypot(wander.vx, wander.vy)
headingV  = atan2(wander.vy, wander.vx)          // travel direction
tx, ty    = vmag > eps ? (vx/vmag, vy/vmag) : (0,0)   // unit travel
speedNorm = drift01 * clamp(vmag / vRef, 0, 1)   // 0 at rest, 1 at full swim
```
Notes:
- `vRef = (params.driftSpeed ?? 0.03) · min(w,h) · 1.2` — the same constant
  `wanderStep` uses for `speed` (cell.ts:1034). Because the wander speed is
  near‑constant when swimming, `vmag/vRef ≈ 1`, so in practice
  `speedNorm ≈ drift01`. Folding `drift01` in is what makes all coupling fade
  out smoothly when the cell rests centred — keep it.
- Guard `vmag > eps` so a stationary/degenerate tank yields `speedNorm = 0`
  and every formula below collapses to today's behaviour (back‑compat).

Then thread `headingV`, `tx, ty`, `speedNorm` into `ciliaPath(...)` and into
the membrane loop. Prefer one new pure helper per concern so each gets a unit
test (see below). Keep the existing signatures back‑compatible by treating
absent motion as `speedNorm = 0`.

---

### (a) Velocity‑aligned bend bias on each cilium
Add a **drag lean**: a downstream displacement that grows toward the tip and
is stronger on the leading edge (hairs whose root faces into the flow).

Per hair, with radial unit `(ux,uy)` (cell.ts:494–495):
```
lead     = ux*tx + uy*ty            // +1 leading edge, -1 trailing edge
dragGain = dragCoeff * speedNorm * (0.6 + 0.4*lead)   // leading bends more
```
Per spine point at arclength `sFrac` (inside the loop at cell.ts:514–525),
add to the existing `(x,y)` a world‑space downstream offset:
```
lean   = dragGain * lenK * pow(sFrac, 1.3)   // anchored at base, max at tip
x     += -tx * lean
y     += -ty * lean
```
- `-tx,-ty` = opposite to travel → hairs trail behind, matching drag.
- `pow(sFrac, 1.3)` keeps the base anchored (consistent with the existing
  `s^1.2` amplitude taper at cell.ts:523) so a hair never detaches.
- `dragCoeff` ~0.4–0.6 as a new tunable (default chosen so worst‑case lean ≤
  existing curl amplitude; also fold into `cellReach` headroom, cell.ts:932,
  so leaning hairs can't clip the wall).

**TDD properties** (extend `describe("ciliaPath")`):
- *No motion ⇒ no change.* `speedNorm=0` reproduces current output exactly
  (deterministic equality vs today).
- *Downstream lean.* With `tx=1,ty=0` (moving +x), the mean tip‑x over all
  hairs is **less** than at `speedNorm=0` (crown sweeps to −x).
- *Leading > trailing.* The hair nearest `baseAngle≈0` (leading, `lead≈+1`)
  has a larger downstream tip displacement than the hair near `baseAngle≈π`
  (trailing, `lead≈−1`).
- *Monotone in speed.* Downstream displacement is non‑decreasing in
  `speedNorm`.
- *Base still anchored.* `points[0]` stays on the membrane circle (distance to
  centre ≈ `baseR`) for all `speedNorm` — preserves the existing anchor test.

---

### (b) Orient & strengthen the metachronal wave along the motion axis
Replace the index‑keyed lag with one keyed to each hair's angular position
**relative to the travel direction**, blended in by `speedNorm` so it degrades
gracefully to today's behaviour at rest.

In `ciliaPath`, per hair compute a fractional metachronal index:
```
rel       = wrapToPi(baseAngle - headingV)       // [-π, π] about travel axis
metaIdxV  = rel / gap                              // hairs ordered along motion axis
metaIdx   = (1 - speedNorm)*k + speedNorm*metaIdxV
```
Pass `metaIdx` (a real number) to `ciliaBeatPhase(t + r01*0.6, metaIdx, params)`
instead of integer `k` (cell.ts:510). `ciliaBeatPhase` already multiplies the
index by `ciliaMetachronal` (cell.ts:419), so a fractional index just shifts
where the wave's crest sits — the wave now **starts at the leading edge and
sweeps around the body** with a defined orientation relative to swimming.

Optional strength term: scale `ciliaMetachronal` by `(1 + metaBoost*speedNorm)`
so the wave is crisper while swimming (metachrony is most pronounced during
coordinated propulsion).

**TDD properties:**
- *Back‑compat.* `speedNorm=0` ⇒ `metaIdx=k` ⇒ identical phases to today
  (the existing metachronal test at index 0 vs 1 still passes).
- *Wave rotates with travel.* The hair with the maximum (leading) beat phase
  rotates as `headingV` rotates: for `headingV=0` vs `headingV=π/2` the
  argmax‑phase hair's angle differs by ≈ π/2.
- *Fractional index is well‑defined.* `ciliaBeatPhase` returns a value in
  [0,1) for non‑integer `index` (already true — it only uses `index` linearly,
  cell.ts:419–421; add an explicit test).

---

### (c) Elongate the membrane along velocity (prolate, ~area‑conserving)
Apply an anisotropic radial scale aligned to `headingV`. Add a pure helper and
use it both in the render loop (cell.ts:1229) and `buildCellContour`
(cell.ts:~726) so visuals and tests agree:
```
applyMotionElongation(radius, angle, headingV, speedNorm, elong):
    d   = angle - headingV
    // cos(2d): +1 along travel, -1 perpendicular; zero‑mean over a circle
    return radius * (1 + 0.5 * elong * speedNorm * cos(2*d))
```
So at cell.ts:1229:
```
rawRadius = applyMotionElongation(baseR*(1+deform[i]), angle, headingV, speedNorm, params.motionElongation)
```
- `cos(2d)` has zero angular mean ⇒ to **first order the area is conserved**
  (stretch along travel is paid for by an equal compress perpendicular). This
  cooperates with the area‑conservation concern (aspect 3) instead of
  fighting it. (A stricter equal‑area map is
  `r·(1+a)` along, `r/√(1+a)` perpendicular, but the `cos(2d)` form is cheaper
  and good enough at overlay scale; flag if aspect‑3 reviewer wants exact.)
- `elong = params.motionElongation` new tunable, default ~0.25–0.35.
- Keep the existing clamps (`floorRadius`, `maxRadius`, cell.ts:1230) **after**
  elongation so the prolate body still can't clip the window.

**TDD properties:**
- *No motion ⇒ identity.* `speedNorm=0` returns `radius` unchanged.
- *Prolate.* `applyMotionElongation` at `angle=headingV` > base radius; at
  `angle=headingV+π/2` < base radius, for `speedNorm>0, elong>0`.
- *Aspect ratio.* For a built contour with `speedNorm>0`, the radius along the
  travel axis / radius perpendicular > 1, and **increases** with `speedNorm`.
- *Approx area conservation.* Mean over `angle∈[0,2π)` of
  `applyMotionElongation(1, angle, h, s, e)` equals 1 within tolerance (since
  `mean(cos(2d))=0`). Assert `|mean − 1| < 1e‑9`.
- *Determinism.* Same inputs → same output.

---

## Notes / sequencing
- **Single source of truth for the motion basis.** Compute `headingV`,
  `(tx,ty)`, `speedNorm` once in the tick and pass down; don't re‑derive inside
  each helper. This keeps the three couplings consistent (same axis) and cheap.
- **Containment.** Both the drag lean (a) and the elongation (c) push pixels
  outward beyond today's worst case. Update `cellReach` (cell.ts:932) to add
  the max lean (`dragCoeff·maxCiliaLen`) and the elongation headroom
  (`0.5·elong·baseR`) or the swimming cell can clip the aquarium wall.
- **Frame‑rate independence.** All three are instantaneous functions of the
  current `(vx,vy)` (no integration), so they are inherently dt‑independent —
  good. The only dt‑dependent input is `drift01`/`vmag`, which are already
  handled.
- **Scope guard.** Area conservation correctness (c's mean‑1 claim) overlaps
  aspect 3; I assert only first‑order neutrality here and defer the exact
  equal‑area map to that reviewer.
- **`ciliaEndpoints` (legacy, cell.ts:~330)** is unused by the render path
  (the tick calls `ciliaPath`). No motion coupling needed there; leave as‑is
  to avoid touching dead code.
