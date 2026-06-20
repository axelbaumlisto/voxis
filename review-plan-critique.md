# Critique of `cell-bio-accuracy-plan.md`

Scope: review of the **plan itself** — ordering/coupling, back-compat claims,
test completeness, scope/risk, and review items dropped. Cross-checked against
the 4 source reviews and the live code in
`src/theme-engine/renderers/cell.ts` + `shared.ts`. Read-only; no code edited.

> **Path discrepancy (process note, not a plan bug):** the task and the plan
> header both reference the reviews at `.pi/plans/reviews/`. That directory does
> **not exist**. The four reviews actually live at the repo root:
> `review-count-placement.md`, `review-motion-vector.md`,
> `review-growth-compression.md`, `review-deformation.md`. The brief they answer
> is `.pi/plans/cell-bio-accuracy-review.md`. Fix the reference in the plan so a
> future implementer can find the sources.

---

## Review

### Correct (the plan gets these right)

- **A1 / A2 / A3 are accurately located and specified.** `ciliaAngleJitter` is
  indeed floored but not capped (`cell.ts:474`,
  `Math.max(0, params.ciliaAngleJitter ?? 0.55)`), unlike `lenVar` one line
  above (`cell.ts:473`). The misleading comment is at `cell.ts:489-491`. The
  bin step-function is at `cell.ts:660-662,673` and mirrored at
  `cell.ts:723-725,734`. Clamp-to-`[0,0.9]` matches the review's derived bound.
- **D1 motion basis is sound and the data exists.** `wanderStep` computes and
  returns `vx,vy` (cell.ts:1046-1047, recomputed post-reflection 1067-1068,
  returned 1073) and they are dropped at cell.ts:1216-1221 — exactly as
  `review-motion-vector.md` states. Threading `headingV/(tx,ty)/speedNorm` once
  is the right single-source-of-truth design.
- **C2 ellipse is the correct *concept*** (area of a (k,1/k) ellipse = π, so an
  affine squash in the heading frame is exactly area-preserving) — but the
  *formula written in the plan is not that map*. See Blocker 2.
- **The general pipeline intent** (deform → bound → conserve area → anisotropy →
  safety clamp) matches `review-growth-compression.md`'s "order of operations"
  and `review-deformation.md`'s bug2 sequencing.

---

### Blocker 1 — the pipeline omits `integrateDeformation` (form memory), which sits *between* normalize and the contour and breaks the area invariant

The plan's 7-step pipeline silently assumes `buildTargetDeformation` flows
straight into the radius. It does not. The live tick is:

```
buildTargetDeformation(...)            // cell.ts:1188  (target d[i])
integrateDeformation(deform, target,   // cell.ts:1200  (asymmetric attack/release)
                     attack, release)
... baseR*(1+deform[i]) ...            // cell.ts:1229
```

`integrateDeformation` (`shared.ts:215-234`) eases **each vertex
independently** at different rates (attack 0.20 vs release 0.005). If C1
area-normalization (step 5) is applied to the *target* inside
`buildTargetDeformation`, the per-vertex temporal ease afterward destroys the
`mean((1+d)²)=1` invariant — a normalized target blended with a normalized
previous frame is **not** normalized (verified numerically: two area-correct
fields eased together give area factor ≠ 1). So:

- The shoelace test in C1 will **pass on the pure function and fail on the live
  render path** — the same class of bug `review-deformation.md` already flags
  (its "two divergent radius formulas" note + B3 in the plan).

**Correction:** make the pipeline explicit and move normalization to **after**
form-memory integration, operating on the integrated `deform[]`, not the
target. Corrected order:

```
1. wanderStep → pos, (vx,vy), and persist prevV for accel
2. motion basis: headingV, (tx,ty), speedNorm, k_acc
3. buildTargetDeformation: FBM + pseudopod + INTERPOLATED bins + idle   [A3,B-bins]
4. soft-saturate target d (tanh)                                        [B1]
5. integrateDeformation(prev, target, attack, release)   <-- EXISTING, was missing
6. (optional) one cyclic smoothing pass                                 [B2]
7. normalizeArea on the INTEGRATED deform[]                             [C1]
8. per-vertex area-preserving ellipse f(θ) for D4∘D5                    [C2]
9. clamp [floorRadius, maxRadius] LAST                                  [7]
```

Steps 4 and 5 also interact (see Blocker 3). The plan must state where tanh and
the integrator compose; today it lists tanh (step 4) and normalize (step 5)
with no integrator at all.

---

### Blocker 2 — the C2 ellipse formula is written *inverted*; as written it is NOT area-preserving (the plan's central conservation claim is false)

Plan C2 / D4 / D5:
```
ellipseRadius(θ,φ,k) = sqrt((k·cos)² + ((1/k)·sin)²)
```
This is the formula for the **support/again-stretched** radius, not the polar
radius of an ellipse with semi-axes (k, 1/k). Numerically (verified):

| k | plan `sqrt((k·cos)²+((1/k)·sin)²)` area factor | along-axis | perp-axis |
|---|---|---|---|
| 1.2 | **1.067** (≠1) | 1.20 | 0.833 |
| 1.5 | **1.347** (≠1) | 1.50 | 0.667 |
| 2.0 | **2.125** (≠1) | 2.00 | 0.500 |

The radii at θ=0 / θ=π/2 *look* right (k and 1/k), which is why it's seductive,
but `mean(f²) ≠ 1`, so it **inflates** area by 7–35% at modest k — directly
re-introducing the bug C1 is meant to remove, and making D4+D5 *worse* than
today's isotropic blob under motion. The correct polar radius of an ellipse
with semi-axes (a,b)=(k,1/k) is:

```
f(θ) = 1 / sqrt( (cos(θ−φ)/k)² + (k·sin(θ−φ))² )
```
(verified: `mean(f²)=1` for all k). Note this is exactly the **reciprocal**
of the plan's expression. `review-growth-compression.md` wrote the same
inverted form, so the error is inherited from the source review — the plan did
not catch it.

**Correction:** replace the C2 formula with the reciprocal form above, and add
a TDD guard `assert |mean(f²) − 1| < 1e-9` (the plan's D4/D5 tests say "area
invariant" but never pin the radial-multiply mean to 1, so they would not have
caught this — see Blocker 5).

---

### Blocker 3 — applying tanh (B1) *before* area-normalize (C1) is fine, but the plan's stated reason and the Dmax→clamp back-compat claim don't hold together

The plan orders tanh (step 4) before normalize (step 5) and asserts the render
clamp becomes "a no-op under defaults." Two problems:

1. **Order is actually correct, but for an unstated reason.** tanh must precede
   normalize because normalize solves a quadratic for `c` assuming a fixed
   `d[]`; if you saturate *after* subtracting `c`, you change the mean again and
   `mean((1+d)²)=1` no longer holds. Keep tanh→normalize, but say *why*, and
   note that **the C2 ellipse multiply (step 8) re-breaks the bound** — a tanh
   bound of `Dmax` on `d` does not bound `(1+d)·f(θ)` once `f` can reach `k`.
   So the "clamp is a no-op" claim is only true for `speedNorm=0 ∧ accel=0`.
   Under motion, peak radius ≈ `baseR·(1+Dmax)·k_max`, which can exceed
   `maxRadius`. The clamp **will** fire while swimming unless `Dmax`, `elong`,
   `squashGain`, and `maxRadius` are jointly budgeted.

2. **Numerical headroom is never derived.** `maxRadius = height·0.46`,
   `floorRadius = baseR·0.35` (cell.ts:1222-1223 / live loop). B1 says "choose
   Dmax so baseR·(1±Dmax) within [floor,max]" but on the **wide-thin overlay**
   (`review-deformation.md` bug2 cites 172×36) `maxRadius = 0.46·36 ≈ 16.6px`
   while a `radiusFraction`-derived `baseR` on a 160×160 cell is ~54px — the
   clamp is geometry-dependent and cannot be a global no-op. The plan inherits
   bug2's claim without re-deriving it per overlay aspect ratio.

**Correction:** state a single radius budget:
`baseR·(1+Dmax)·k_max ≤ maxRadius` and `baseR·(1−Dmax)/k_max ≥ floorRadius`,
solved jointly for `Dmax` given `k_max = (1+elong·1)·(1+squashGain·1)`. Make
`maxRadius` aspect-aware (use `min(width,height)`, not `height`, or the existing
`cellReach`) so the no-op claim is testable on **both** overlay geometries.

---

### Blocker 4 — D4 (motion elongation) and D5 (accel squash) are claimed to compose into "ONE ellipse" but the plan never says how, and the two reviews give *different* elongation models

- `review-motion-vector.md` (c) proposes `r·(1 + 0.5·elong·speedNorm·cos(2d))`
  — a `cos(2θ)` modulation, *first-order* area-neutral only (mean of cos2θ = 0,
  but `mean(f²) = 1 + ⅛(0.5·elong·speedNorm)² ≠ 1`).
- `review-growth-compression.md` (and plan C2) proposes the exact ellipse.

These are **two different shapes**. The plan adopts the ellipse for D4 (good,
stricter) but must explicitly **drop** the `cos(2d)` form, otherwise an
implementer reading the motion-vector review will apply both and double-count.

**Composition:** D4 gives `k_motion = 1 + elong·speedNorm` along `φ=headingV`;
D5 gives `k_acc = 1 + squashGain·min(aMag/aRef,1)` along `φ=atan2(vy,vx)`. When
swimming steadily these axes coincide (`headingV == atan2(vy,vx)`), so the
plan's "compose via same ellipse" works by **multiplying the factors**:
`k = k_motion · k_acc`, single `φ`. But **decelerating into a wall bounce**
makes acceleration anti-parallel to velocity — `wanderStep` reflects heading
(cell.ts:1057-1065) so `headingV` flips while `prevV→V` accel points
*outward*. The two ellipse axes can be ~perpendicular for one frame, and
`k_motion·k_acc` on a single `φ` is then wrong (it should be a product of two
rotated ellipses, i.e. a general affine). The plan's "ONE ellipse" assumption
silently fails at every wall bounce — exactly when accel is largest.

**Correction:** either (a) define accel squash along its **own** axis
`φ_acc = atan2(ay,ax)` and apply two sequential affine maps in the heading
frame (still area-preserving: det = 1·1 = 1), or (b) explicitly clamp accel
coupling to the velocity axis and accept that bounce-frame squash is
approximate — and add a test for the bounce frame. Right now neither is stated.
Also: D5 needs `prevVx/prevVy` persisted **across frames in renderer closure**
(like `growth`/`startle`), and `aMag = |dv|/dt` — at a wall bounce `dv` is a
near-instant reversal, so `aMag` spikes to `~2·speed/dt`. Without smoothing the
squash will *pop* on every bounce. Plan D5 has no accel smoothing or spike
guard.

---

### Blocker 5 — back-compat (`speedNorm=0 ⇒ identical to today`) is FALSE for the pipeline as a whole, even though each motion term is individually neutral

The plan's invariant "All new behaviour collapses to current output when
speedNorm=0 / accel=0" is **not** true, because Phases B and C run
*unconditionally* (they are not gated by motion):

- **C1 area-normalize changes the resting shape even at `speedNorm=0`.** Today
  the additive pseudopod/bin terms inflate area ~20% (`review-growth-compression`
  quantifies this). C1 *removes* that inflation — by design. So a silent,
  resting cell will be **visibly smaller / differently shaped** than today. That
  is the intended behaviour, but it directly contradicts the plan's stated
  back-compat invariant. The invariant must be scoped: *"D2–D5 collapse to
  today when speedNorm=0; B1/C1 deliberately change resting shape."*
- **B1 tanh changes the shape whenever `|d|` is non-trivial**, independent of
  motion. Under loud speech today's values reach the clamp; tanh reshapes them
  before motion is involved.

If the test suite asserts byte-identical output at `speedNorm=0` (as D1/D2/D3
back-compat tests imply), it will **fail** against B1+C1. The plan needs two
distinct baselines: (1) a *frozen* pre-B/C snapshot for D-only tests with
B1/C1 disabled, and (2) new golden values for the B1+C1 world.

The individually-correct neutral claims:
- D2 `speedNorm=0 ⇒ dragGain=0 ⇒ identity` ✓ (formula is multiplicative in
  speedNorm).
- D3 `metaIdx = (1-speedNorm)·k + speedNorm·metaIdxV` ⇒ `=k` at speedNorm=0 ✓,
  **but** `ciliaBeatPhase` must accept a fractional index. It currently does
  (`lag = metachronal·index`, cell.ts:419, linear in index) — verify the
  asymmetry branch (cell.ts:430-440) is also continuous in fractional index; it
  is (only `u` depends on index via `lag`, and the piecewise map is continuous
  in `u`). Add the explicit test the plan mentions.
- D4 ellipse with `k=1+elong·speedNorm` ⇒ `k=1 ⇒ f≡1` ✓ (with the corrected
  reciprocal formula).
- D5 `k_acc=1 ⇒ f≡1` ✓.

So the per-term claims hold; the **aggregate** claim does not. Fix the wording.

---

### Note — test completeness gaps

1. **No test pins the radial-multiply area mean to 1.** D4/D5 say "area
   invariant" but the only way that catches Blocker 2 is an explicit
   `|mean over θ of f(θ)²| == 1 ± 1e-9` unit test on `ellipseRadius`. Add it as
   the *first* C2 test — it fails immediately against the plan's inverted
   formula.
2. **No end-to-end area test on the LIVE path after integrateDeformation.** C1's
   shoelace test must run on the integrated+normalized+ellipse contour the
   renderer actually draws, not just on `buildTargetDeformation`. Otherwise
   Blocker 1 ships green. (This is B3 generalized — the plan scopes B3 to "align
   tested path" but doesn't connect it to the C1 invariant.)
3. **No bounce-frame test.** Per Blocker 4, add: at a simulated wall reflection,
   (a) area stays within tolerance, (b) squash magnitude is bounded (no pop).
4. **No "radial ellipse on a non-circular contour" caveat/test.** Multiplying
   each polar radius by `f(θ)` is exactly area-preserving **only for a circle**.
   On an already-deformed contour the radial-scale area error is ~5% for a
   one-sided bulge at k=1.35 (verified numerically); the *affine* map
   `(x,y)→(k·x_φ, y_φ/k)` is exact for any shape (det=1). The plan should either
   (a) switch D4/D5 to the affine map in the heading frame (recommended; same
   cost, shape-independent exactness, and it composes cleanly with Blocker 4's
   two-axis case), or (b) document that area conservation is first-order on the
   deformed contour and widen the C1 tolerance from ±2% accordingly.
5. **Missing monotone-borrow test wiring.** C1's "bulge pulls opposite side
   inward" property is good but only meaningful post-integration; specify it on
   the integrated field.
6. **A1 test as written may be brittle.** The proposed test sorts tip angles and
   asserts strictly increasing gaps. After D2/D4 land, tip positions also depend
   on drag-lean and elongation; the ordering test should read **base** angles
   (`points[0]`), not tip angles, and run with `speedNorm=0` to isolate
   placement. The plan's snippet uses `h.points[0]` — good — keep it explicitly
   motion-free.

---

### Note — scope / risk ranking (the plan does not rank phases)

- **Safe, do first:** A1 (one-line clamp), A2 (comment), A3 (bin interpolation —
  pure, well-tested, removes a real C0 seam). Low regression risk.
- **Medium:** B1 tanh and B2 smoothing — they change resting look; gate behind
  the radius budget (Blocker 3) and snapshot review.
- **High risk / most likely to make the live overlay look *worse*:**
  - **C1 area-normalize**, because it shrinks the resting cell and couples to
    `integrateDeformation` (Blocker 1). If `c` is computed from a transiently
    extreme target (e.g. startle frame), the whole membrane can pulse inward —
    a global breathing artifact that did not exist before. Recommend computing
    `c` from the **integrated** field and clamping `c` to a small range.
  - **C2/D4/D5** with the inverted formula (Blocker 2) — ships visible
    inflation. Must not land before the formula fix + mean(f²) test.
- **Behavioural, gate off by default:** E1 (perimeter-driven count). The plan
  already says keep 18 for the 160×160 overlay — good. But note the count-driven
  path can push `n>150`, reviving the seed-aliasing latent issue
  (`review-count-placement.md`); the plan drops the recommended 2-D seed
  mitigation (`noise2D(k*12.9898, 7.2 + k*0.123)`) — add it as a precondition of
  enabling E1.

---

### Note — performance (the plan claims "cheap" but never budgets it)

- **Area-normalize C1:** O(N), two passes over 96 vertices for `S1,S2` + one
  subtract = ~300 flops/frame. Negligible. ✓ The closed-form quadratic root is
  fine; the first-order `c ≈ mean(d) + ½·mean(d²)` fallback the review offers is
  not needed at N=96 — drop it to avoid two code paths.
- **Per-vertex ellipse C2:** one `sqrt` + `sin/cos(θ−φ)` per vertex × 96 =
  ~96 transcendentals/frame, plus the Catmull-Rom (4× = 384 pts). At 60fps that
  is ~5.7k trig calls/sec — trivial on any overlay. ✓ But note the **affine
  alternative** (Note 4) replaces the per-vertex `sqrt` with two multiplies in
  the rotated frame and is *cheaper* as well as exact — another reason to prefer
  it.
- **D2 drag-lean:** `pow(sFrac,1.3)` per spine point (seg≈6) × n hairs (18) =
  ~108 `pow` calls/frame. Fine, but `pow` is ~10× a multiply; if E1 ever raises
  n, precompute the `sFrac^1.3` ramp once (it's the same for every hair) — the
  plan recomputes it per hair per point.

---

## Summary of required plan corrections

| # | Severity | Plan location | Correction |
|---|----------|---------------|------------|
| 1 | Blocker | Pipeline steps 4–5 | Insert `integrateDeformation` between target-build and normalize; normalize the **integrated** field, not the target. Renumber to 9 steps. |
| 2 | Blocker | C2 / D4 / D5 | Ellipse formula is inverted. Use `f(θ)=1/sqrt((cos/k)²+(k·sin)²)`. Add `mean(f²)=1` test. |
| 3 | Blocker | B1 + step 7 | "Clamp is no-op" is false under motion and on wide-thin overlay. Derive joint radius budget `baseR·(1+Dmax)·k_max ≤ maxRadius`; make `maxRadius` aspect-aware. |
| 4 | Blocker | D4∘D5 "one ellipse" | Define accel squash on its own axis (two affine maps) or document bounce-frame approximation; persist prevV; smooth `aMag` to avoid bounce pops. |
| 5 | Blocker | "Invariants" / back-compat | `speedNorm=0 ⇒ identical` is false because B1/C1 are ungated. Scope the invariant to D2–D5; create a separate baseline for the B/C resting-shape change. |
| 6 | Note | Tests | Add: mean(f²)=1; live-path shoelace after integration; bounce-frame area+pop; affine-vs-radial caveat; base-angle (not tip) ordering test for A1. |
| 7 | Note | E1 | Add the 2-D seed fix (`7.2 + k·0.123`) as a precondition before perimeter-driven count can raise n>150. |
| 8 | Note | Header | Fix review path: reviews are at repo root, not `.pi/plans/reviews/`. |

**Bottom line:** Phase A is solid and ready. Phases B–D have the *right
intent* but three hard math/sequencing errors that would each individually make
the live overlay look worse than today: the missing form-memory step in the
pipeline (Blocker 1), the inverted ellipse that re-inflates area (Blocker 2),
and the ungated B1/C1 breaking the back-compat invariant (Blocker 5). Fix the
ellipse formula, pin the pipeline order around `integrateDeformation`, switch to
the affine area-preserving map, and re-scope the back-compat claim before any
implementation starts.
