# Review — Membrane Deformation Quality (aspect 4)

Scope: membrane bumps, pseudopods, idle morph, form-memory easing. Continuity
at the closed-loop seam, self-intersection, bounded amplitude, audio/energy
coupling, pseudopod lobe interaction. Read-only; no code edits.

Files inspected: `src/theme-engine/renderers/cell.ts`,
`src/theme-engine/renderers/shared.ts`,
`src/theme-engine/renderers/__tests__/cell.test.ts`, `docs/CELL_MATH.md`,
`.pi/plans/cell-bio-accuracy-review.md`. (`plan.md` / `progress.md` do not exist.)

---

## Review

### Correct (verified, keep as-is)

- **The FBM membrane term is genuinely 2π-periodic and smooth across the seam.**
  `cellRadius` samples FBM on `(cos θ·noiseScale + const, sin θ·noiseScale + const)`
  (`cell.ts:271-285`). Because the sample point is a function of `cos θ / sin θ`,
  vertex `0` (θ=0) and the wrap target θ=2π map to the *identical* noise
  coordinate, and `noise2D` uses `smoothstep` (C1) interpolation
  (`shared.ts:62-86`). So the FBM contribution is **C1-continuous around the
  whole loop, including the seam** — no kink. The unit test
  `cellRadius "is periodic — same at angle 0 and 2π"` (`cell.test.ts:169`)
  confirms `r(0) ≈ r(2π)`.

- **Pseudopod lobes are periodic and cannot incorrectly cancel.** In
  `pseudopodOffset` the lobe center `θ_lobe = TAU·noise2D(seed, t·intentDrift)`
  is constant across the loop (depends on `t`, not `angle`); the angular
  distance is wrapped to `[-π,π]` (`cell.ts:313-315`) and the lobe is
  `max(0,cos Δ)^sharpness ≥ 0` (`cell.ts:317`). Two lobes are summed
  (`total += lobe·amp`, `cell.ts:322`). Since each term is ≥0 they can only
  **reinforce**, never cancel — overlapping intents merge into one larger
  pseudopod (biologically fine). Periodic in θ, so seam-continuous. With the
  default `sharpness=4` the lobe is C1 even at its `cos Δ = 0` shoulders.

- **idle morph is periodic AND non-repeating in time.** `idleMorph` samples
  `noise2D(cos a·k + travel, sin a·k ± travel·c)` (`cell.ts:581-583`). The
  `cos a / sin a` factors guarantee periodicity in `a` (seam-continuous); the
  additive `travel = t·idleMorphSpeed` is identical for every vertex in a
  frame, so it only *translates* the noise field over time and does **not**
  break the loop closure. Output is hard-capped to `±idleMorphAmplitude`
  (`cell.ts:586-588`), and the envelope is a slow noise-free `cos`-lifted
  breathing term (`cell.ts:575-576`). Confirmed bounded by test
  `idleMorph "stays within a gentle bound"` (`cell.test.ts:1466`).

- **The membrane cannot self-intersect by construction.** The contour is a
  single-valued polar function `r(θ)` about a fixed center sampled at strictly
  increasing angles (`cell.ts:1227-1234` live path; `cell.ts:715-742` legacy).
  A star-shaped polar curve with `r(θ) > 0` and monotonic θ is always a simple
  (non-self-crossing) polygon — there is **no chord crossing / inner loop**
  possible at the control-point level. This is a real strength of the design.

- **`r(θ) > 0` is guaranteed.** Both render paths clamp radius to
  `Math.max(baseR·0.35, …)` (`cell.ts:1230` live, `cell.ts:739` legacy), so the
  rendered radius is never ≤0 regardless of how negative `deform[i]` is.
  Stress-tested in `buildCellContour "clamps radius to [baseR*0.35, height*0.46]
  even at extreme energy"` (`cell.test.ts`, membraneAmplitude=2.0, push=20).

- **Audio/energy coupling is wired correctly.** FBM amp = `idle + energy·energyDrive`
  (`cell.ts:284`, energy already folds in audioLevel); pseudopod amp =
  `push·(idle + audioLevel·levelGain)·energy` (`cell.ts:319-320`, double-coupled);
  bins scale by `energy` (`cell.ts:673`); idle morph is gated *down* as audio
  rises via `idleFactor = max(0, 1 − audioLevel·3)·recordingFade`
  (`cell.ts:1186`) so it never fights speech-driven bumps.

### Blocker

*(none — geometry is sound; the items below are quality bugs/risks, not crashes)*

### Note — bug 1: spectrum-bin deformation is a step function (the real seam/continuity defect)

`binDeform` is **piecewise-constant** across the 32 bins:

```
normalized = ((angle % TAU)+TAU)%TAU / TAU          // [0,1)
binIdx     = min(floor(normalized·bins.length), 31) // 32 buckets
binLevel   = bins[binIdx]
binDeform  = binLevel · 0.15 · energy               // ≥ 0
```

(`cell.ts:660-662, 673` in `buildTargetDeformation`; mirrored at
`cell.ts:723-725, 734` in `buildCellContour`.)

This is the **one source of C0 discontinuity** in the membrane: the radius
*jumps* at every one of the 32 bin boundaries (with 96 vertices, exactly every
3rd vertex), including at the seam (bin 31 → bin 0). Consequences:

1. **Faceting / banding** when adjacent bins differ — the otherwise-smooth
   amoeba gets 32 angular stair-steps.
2. **Catmull-Rom overshoot → local self-intersection of the *smoothed* spline.**
   The polygon itself can't self-cross (see Correct), but the closed
   Catmull-Rom in `shared.ts:128-181` overshoots on large adjacent-radius
   jumps and can produce small loops/cusps near a bin boundary. This is the
   only realistic self-intersection path in the whole renderer.

Recommended fix (keep it cheap, pure): make the bin contribution a *continuous,
periodic* function of θ by interpolating between adjacent bin centers with
wraparound, e.g.

```
u      = normalized · N            // N = bins.length
i0     = floor(u) % N
i1     = (i0 + 1) % N              // wraps 31→0, so seam matches
f      = u - floor(u)
binLvl = lerp(bins[i0], bins[i1], smoothstep(f))
binDeform = binLvl · 0.15 · energy
```

TDD-able properties:
- **Periodic:** `binDeform(0) == binDeform(2π)` (the `i1` wrap guarantees it).
- **Continuous:** `max_i |deform[i+1] − deform[i]|` (cyclic) stays below a small
  bound for any `bins` (no jumps > one inter-vertex slope).
- **Star-shaped after smoothing:** for the Catmull-Rom output, `atan2(y−cy, x−cx)`
  is monotonic increasing mod 2π — i.e. the spline never folds back. This is
  the assertable guard against bin-jump overshoot loops.

### Note — bug 2: amplitude is bounded only at render, so large deformation produces flat clamp dead-zones with C1 kinks

`integrateDeformation` (`shared.ts:215-234`) accumulates `deform` with no
magnitude cap, and `pseudopodOffset` (`cell.ts:319-322`) and FBM are unbounded
in principle (cranking `push`, `membraneAmplitude`, or `energyDrive` grows them
freely). The *only* bound is the render clamp
`Math.max(floorRadius, Math.min(maxRadius, rawRadius))` (`cell.ts:1229-1230`,
also `cell.ts:738-739`).

Problems:
- When the clamp engages (common under loud audio or the swelled `baseR`
  approaching `maxRadius = height·0.46`), the membrane is **flattened onto a
  circular arc**, introducing two **C1 kinks** where the curve enters/leaves the
  clamp and a non-organic flat segment. `maxRadius` is computed from `height`
  only (`cell.ts:1222`), so on the wide-thin overlay (172×36) the cell clamps to
  a ~`0.46·height` circle and clips easily.
- Because the clamp acts on the *displayed* radius but the stored `deform`
  keeps integrating uncapped, a vertex can sit "pinned" against the clamp for
  many frames and then release abruptly — a visible pop.

Recommended fix: bound the deformation *analytically before* it reaches the
contour (e.g. a soft saturation `d ← Dmax·tanh(d/Dmax)` applied to the summed
fraction inside `buildTargetDeformation`, with `Dmax` chosen so
`baseR·(1+Dmax) ≤ maxRadius` and `baseR·(1−Dmax) ≥ floorRadius`). Then the
render clamp becomes a never-hit safety net and the membrane stays smooth.

TDD-able properties:
- **Bounded:** `−Dmin ≤ deform[i] ≤ Dmax` for all inputs (no reliance on the
  render clamp).
- **Clamp rarely active:** for `audioLevel ∈ [0,1]` and default params, the
  render clamp is a no-op (i.e. `floorRadius ≤ rawRadius ≤ maxRadius` already),
  so no flat dead-zones appear in normal use.

### Note — bug 3: form-memory easing has no spatial coupling, so neighbours can diverge

`integrateDeformation` eases each vertex **independently**, choosing attack vs
release per vertex via `|target| ≥ |prev|` (`shared.ts:228-231`). Two adjacent
vertices can therefore land on opposite branches in the same frame (one rising
at `attack≈0.20`, its neighbour relaxing at `release≈0.005`). Over many frames
this can build **high-frequency spatial roughness** between control points
(a local cusp / "comet tail" edge as a drifting pseudopod's trailing vertices
linger while leading ones grow). Catmull-Rom hides mild cases, but the control
polygon itself is no longer guaranteed spatially smooth, which compounds bug 1's
overshoot risk. The per-vertex branch switch at `|tgt| == |prev|` is also a
velocity discontinuity in time (rate jumps 0.005↔0.20), a minor C1-in-time pop.

Recommended (optional, cheap): after integration, apply one light cyclic
smoothing pass on `deform` (e.g. `d[i] ← 0.5·d[i] + 0.25·(d[i−1]+d[i+1])`,
indices mod N) so neighbours stay coherent, or drive attack/release from the
*aggregate* push direction rather than per-vertex sign. Property:
cyclic second difference `|d[i−1] − 2d[i] + d[i+1]|` stays bounded frame-to-frame.

### Note — bug 4 (minor): pseudopod base kinks if `sharpness < 2`

`max(0, cos Δ)^sharpness` is only C1 at the `cos Δ = 0` shoulders when
`sharpness ≥ 2`. The default `4` is fine, but `sharpness = 1` (allowed via
params, and exercised in `pseudopodOffset "different sharpness…"` test) yields a
slope discontinuity (kink) where each lobe meets the base membrane. If arbitrary
`sharpness` is to be supported, clamp it to `≥ 2` or document the constraint.
Property: for `sharpness ≥ 2`, the per-vertex pseudopod slope `dPseudo/dθ` is
continuous at the lobe edges.

### Note — consistency: two divergent radius formulas

`buildCellContour` (`cell.ts:715-742`) adds the pseudopod in **pixels**
(`baseR·rFbm + rPseudo + …`) and is what the unit tests exercise, while the
**live renderer** uses `buildTargetDeformation` → `integrateDeformation` →
`baseR·(1+deform)` (`cell.ts:1188-1234`), where the pseudopod was converted to a
*fraction* via `invBaseR` computed at `growth = 0` (`cell.ts:651, 670`). When
`growth > 0` these two paths produce different pseudopod magnitudes (the
fraction was normalized by the unswollen `baseR` but re-multiplied by the
swollen one). Not a continuity bug, but the tested function is not the rendered
one — worth aligning so tests guard the real path, or folding `buildCellContour`
out as dead/legacy.

---

## Summary of TDD-able properties to add

1. `r(θ) > 0` for all θ and all params — already enforced by clamp; assert it
   on the *pre-clamp* deformation once bug 2 is fixed.
2. `binDeform(0) == binDeform(2π)` and cyclic `max|Δdeform|` bounded (bug 1).
3. Smoothed contour is star-shaped: `atan2` about center monotonic mod 2π
   (guards Catmull-Rom overshoot / self-intersection — bug 1).
4. `−Dmin ≤ deform[i] ≤ Dmax`; render clamp is a no-op for `audioLevel ∈ [0,1]`
   under defaults (bug 2).
5. Cyclic second difference of `deform` bounded frame-to-frame (bug 3).
6. Pseudopod angular derivative continuous for `sharpness ≥ 2` (bug 4).

Bottom line: the **closed loop is C1-continuous and self-intersection-free for
FBM + pseudopod + idle-morph** — those are correct. The deformation-quality
defects are (1) the **piecewise-constant spectrum-bin term** breaking C0 around
the loop and risking Catmull-Rom overshoot loops, (2) **unbounded deformation**
relying on a hard render clamp that flattens the membrane into kinked arcs, and
(3) **per-vertex form-memory easing** with no spatial coupling. None crash; all
are visual-fidelity fixes with cheap, pure, testable formulas above.
