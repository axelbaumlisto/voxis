# Review — Growth, Compression & Area Conservation (aspect 3)

Scope: **volume/area behaviour only**. Does the membrane conserve area on short
timescales? Does growth swell plausibly? Is there any area normalization across
the deformation field? Is there squash/stretch under acceleration?

Read: `.pi/plans/cell-bio-accuracy-review.md`, `docs/CELL_MATH.md`,
`src/theme-engine/renderers/cell.ts`, `src/theme-engine/renderers/shared.ts`,
`src/theme-engine/renderers/__tests__/cell.test.ts`.

Read-only review — no code was edited. (Note: requested `plan.md` / `progress.md`
do not exist at the repo root; only the `.pi/plans` review brief was present.)

---

## Review

### Correct (already good, with evidence)

- **Growth swell is bounded — it does NOT "blow up unbounded".**
  `resolveBaseRadius` (`cell.ts:880-889`) returns
  `rawBaseR · (1 + growth · growthSwell)`. The task hypothesis was that this
  might be unbounded, but `growth` is hard-clamped to `[0,1]` in
  `growthLevel` (`shared.ts:285-296`, `return Math.max(0, Math.min(1, raw))`).
  With `growthSwell = 0.22` (`cell.ts:209`), radius scales in `[1.00×, 1.22×]`,
  so **area scales in `[1.0×, 1.49×]`** (1.22² ≈ 1.49). Bounded and finite.
  The decay is also smooth/asymmetric (`growthRelease = 0.012 ≪ growthAttack`),
  so the swell breathes in/out rather than snapping. This part is fine.

- **Hard clamps prevent runaway radii.** Both the renderer
  (`cell.ts:1222-1230`) and `buildCellContour` (`cell.ts:738-739`) clamp the
  final radius to `[baseR·0.35, height·0.46]`. So even with no area
  conservation, the contour can't escape the tank. (This masks the area
  problem visually at large amplitude — it clips rather than redistributes.)

### Blocker — there is no area/volume conservation anywhere in the deformation field

Real cells are roughly area/volume-conserving on short (sub-second) timescales:
a pseudopod bulging out pulls cytoplasm from elsewhere; elongation along one
axis thins the perpendicular axis. **None of that exists here.** Every
deformation source is summed independently and most are strictly additive
(outward-only), so total enclosed area grows monotonically with audio with no
compensating retraction.

Evidence — `buildTargetDeformation` (`cell.ts:639-678`):

```
deform[i] = fbmDeform + pseudoDeform + binDeform + idle      // cell.ts:676
```

Sign analysis of each term:

| Term | Source | Sign | Effect on area |
|------|--------|------|----------------|
| `fbmDeform` | `cellRadius` FBM, `cell.ts:666` | ± (zero-mean) | ~area-neutral |
| `pseudoDeform` | `pseudopodOffset`, `cell.ts:670` | **≥ 0 only** | **inflates** |
| `binDeform = binLevel·0.15·energy` | `cell.ts:673` | **≥ 0 only** | **inflates** |
| `idle` | `idleMorph`, `cell.ts:676` | ± (clamped ±cap) | ~area-neutral |

`pseudopodOffset` is structurally outward-only: the lobe is
`max(0, cos δ)^sharpness` (`cell.ts:318`) and the running total only ever
adds positive contributions (`total += lobe * amp`, `cell.ts:322`;
`return total`, `cell.ts:324`). A pseudopod therefore adds area instead of
**borrowing** it from the rest of the membrane.

Quantifying the spurious inflation (defaults, `baseR ≈ 16px`, recording at
`audioLevel = 1`, `energy ≈ 0.8`):

- Pseudopod mean over the circle: `⟨max(0,cosδ)^4⟩ = 3/16 ≈ 0.1875` per lobe;
  `amp = push·audioDrive·energy = 3·0.8·0.8 ≈ 1.92px`; × 2 lobes
  → mean ≈ `0.72px` → fraction `≈ 0.045`.
- Spectrum bins (avg bin ≈ 0.5): `0.5·0.15·0.8 = 0.06`.
- Mean deformation `d̄ ≈ 0.045 + 0.06 ≈ 0.10`.

Enclosed polar area `A = ½∫ r² dθ = π·baseR²·(1 + 2d̄ + ⟨d²⟩)`. With
`d̄ ≈ 0.10`, that is **~20%+ spurious area gain from the additive terms alone**,
*on top of* the intended 49% growth swell — and it is uncompensated. The body
just inflates like a balloon when you speak; nothing thins.

`buildCellContour` (`cell.ts:704-742`) has the same problem independently — it
sums `baseR·rFbm + rPseudo + binLevel·baseR·0.15·energy` (`cell.ts:731-735`)
with no normalization.

**Corrected formula — uniform-offset area normalization (KISS, O(N), TDD-able).**
After building the per-vertex deformation `d[i]` (which excludes the intended
growth swell, since that lives in `baseR`), subtract a single constant `c` so
the enclosed area returns to the rest target `π·baseR²` (i.e. mean of
`(1+d)²` → 1). Closed form (exact):

```
S1 = Σ d_i ;  S2 = Σ d_i²     (i = 0..N-1)
N c² − (2N + 2S1) c + (2S1 + S2) = 0
c  = [ (2N + 2S1) − sqrt((2N + 2S1)² − 4N(2S1 + S2)) ] / (2N)   // take smaller root
d_i ← d_i − c
```

A first-order cheaper approximation that is fine at these amplitudes:
`c ≈ mean(d) + ½·mean(d²)`. Either way the **intended** growth swell is
preserved (it is in `baseR`, untouched), while spurious inflation from
additive pseudopods/bins is removed and a bulge in one direction now pulls the
rest of the membrane inward — i.e. pseudopods conserve mass.

TDD property:
```
area(contour) = 0.5 * Σ_i (r_i × r_{i+1} cross-product)   // shoelace
// For any audio/energy/spectrum input, after normalization:
expect(area).toBeCloseTo(Math.PI * baseR**2, withinPercent(2))
// And monotonic borrow: increasing one pseudopod lobe must DECREASE
// the radius on the opposite side (currently it does not change it).
```

### Blocker — elongation does not thin; no area-preserving anisotropy

Aspect-2 work wants the body to go prolate along the velocity vector. As soon
as that lands, the area problem compounds: stretching one axis with the current
additive model just makes the cell *bigger*, not *longer-and-thinner*. There is
no mechanism that shrinks the minor axis when the major axis grows.

**Corrected formula — area-preserving elliptical modulation.** Given a stretch
factor `k ≥ 1` along direction `φ` (velocity heading), scale each contour
radius by the radius of a unit ellipse with semi-axes `(k, 1/k)`:

```
f(θ) = sqrt( (k·cos(θ−φ))² + ((1/k)·sin(θ−φ))² )
r_i ← r_i · f(θ_i)
```

This is **exactly area-preserving** because the ellipse area is `π·k·(1/k) = π`
regardless of `k`. Elongation along motion automatically thins the
perpendicular axis. TDD: `area` is invariant under any `k`, `φ`.

### Blocker — no compression / squash-&-stretch tied to acceleration

The task explicitly asks for a compression term tied to `|dv/dt|`. There is
none. `wanderStep` already computes velocity `vx, vy` every frame
(`cell.ts:1046, 1067`) and stores it on `WanderState`, but the renderer never
differentiates it. Acceleration is never computed and never feeds shape.
Biologically and in classic squash-and-stretch animation, a body compresses
along its motion direction when decelerating (and stretches when accelerating),
conserving volume.

**Corrected formula.** Persist previous velocity; per frame:

```
ax = (wander.vx − prevVx) / dt ;  ay = (wander.vy − prevVy) / dt
aMag = hypot(ax, ay)
stretch = 1 + squashGain * min(aMag / aRef, 1)        // squashGain ~0.15, aRef ~tank-scaled
φ = atan2(wander.vy, wander.vx)
// feed k = stretch into the area-preserving ellipse f(θ) above
```

Because it reuses the area-preserving ellipse, squash/stretch is volume-neutral
by construction. Reuse existing state (`wander.vx/vy`, `dt`) — no new inputs
beyond two scalar params. TDD: area invariant under any `aMag`; major axis
aligns with `φ`; zero acceleration → `k = 1` → no shape change.

### Note — `cellReach` headroom is a fixed multiplier, not area-aware

`cellReach` uses `membraneOuter = baseR · 1.4` (`cell.ts:~960`). The `1.4`
encodes "membrane can push ~40% outward". If area normalization + the
area-preserving ellipse are added, peak outward radius is bounded by the
ellipse stretch `k` and the (now zero-mean) deformation, so this constant
should be re-derived from `max k` rather than left at the empirical 1.4 — minor
follow-up, not a correctness blocker.

### Note — order of operations

Apply in this order so each stage's invariant holds:
1. Build `d[i]` (FBM + pseudopod + bins + idle) — as today.
2. **Area-normalize** `d[i]` (uniform-offset `c`) → enclosed area = `π·baseR²`.
3. Multiply by **area-preserving ellipse** `f(θ)` for motion-prolate + squash.
4. Clamp to `[floorRadius, maxRadius]` **last** (it is a safety net, not the
   shape model). Heavy clamping today (`cell.ts:1230`, `cell.ts:739`) is what
   currently hides the missing conservation; with steps 2–3 it should rarely
   trigger.

---

## Summary

- Growth swell: **bounded and fine** (clamped `growth∈[0,1]`, area ≤ ~1.49×).
  The "unbounded" concern does not hold — evidence in `growthLevel`
  (`shared.ts:285-296`).
- **No area normalization exists** (`cell.ts:676`, `cell.ts:731-735`);
  pseudopods (`cell.ts:318-324`) and spectrum bins (`cell.ts:673`) are
  outward-only, giving ~20%+ uncompensated area inflation under speech.
- **No elongation→thinning** and **no acceleration-driven squash/stretch**,
  despite `wander.vx/vy` already being available (`cell.ts:1046,1067`).
- All three gaps are fixable with pure, deterministic, area-preserving formulas
  (uniform-offset normalization + ellipse modulation), each with a clear
  shoelace-area invariant test.
