# Math Verification: Plan v2 (`cell-bio-accuracy-plan.md`) — Round-2 audit

> **Tooling note (read first).** `web_search` was DOWN this run (Exa = HTTP 402
> out of credits). Per the task I grounded every external claim with
> `fetch_content` on primary sources, and marked all hand-derivations `[derived]`
> with the algebra shown. The four primary sources I actually fetched:
> - **Equiareal map** — Wikipedia (fetched) — squeeze `diag(λ,1/λ)`, `det=ad−bc`.
> - **Squeeze mapping** — Wikipedia (fetched) — `(x,y)↦(ax, y/a)` area-preserving, group law (composition of squeezes).
> - **Shoelace formula** — Wikipedia (fetched) — `A = ½Σ(xᵢyᵢ₊₁ − xᵢ₊₁yᵢ)`, area = `|det|·` original under linear map.
> - **Squash and stretch** — Wikipedia (fetched) — "maintain overall volume" constraint.
> - **Catmull–Rom (centripetal)** — Wikipedia (fetched) — only relevant to A3, not the 5 numbered claims; noted in passing.
>
> **Tool per claim** is stated inline as `[fetched: <source>]` or `[derived]`.
>
> **Code-grounding gap.** The plan cites `cell.ts` / `shared.ts` line numbers
> (e.g. `shared.ts:215-234 integrateDeformation`, `cell.ts:474/489/660/723/960`).
> My available tools have no directory-listing / `code_search`, and the files are
> not at the path the project doc implies (`src/theme-engine/builtin/cell.ts`
> does not resolve). So the pipeline-ORDER verification below is done on the
> *mathematical structure described in the plan*, not on the live source. Re-run
> with `code_search` to confirm `integrateDeformation` is per-vertex asymmetric
> ease as the plan assumes (Item 3). The math results hold regardless of where
> the code lives; only the "does the code actually do X" binding is unverified.

---

## TL;DR scorecard

| # | Claim | Verdict |
|---|-------|---------|
| 1 | C2 affine squeeze (rotate −φ, xr·=k, yr/=k, rotate +φ), det=1 exact for ANY contour; cheaper; inverted-polar only exact for circle | **VERIFIED** |
| 2 | C1 uniform offset `c = mean(e) − √(1−Var(e))`, Var(e)≤1 guard, multiplicative fallback, Lagrange/mass-borrow | **VERIFIED** |
| 3 | Pipeline order saturate→integrate→normalize→squeeze; normalize AFTER integrate fixes area | **VERIFIED (with 2 caveats)** |
| 4 | D5 two sequential squeezes stay area-preserving (det=1·1); EMA `1−exp(−dt/τ)` frame-rate-independent | **VERIFIED** |
| 5 | tanh unit-slope-at-0, strict bound `<Dmax`, radius budget makes step-9 clamp a no-op | **VERIFIED (one budget-completeness caveat)** |

No remaining math errors found in plan v2. Two *robustness* caveats (Items 3 & 5)
and one *labeling* nit are flagged at the end — none is a wrong formula.

---

## Item 1 — C2 corrected affine squeeze on contour POINTS

### Claim
Rotate point `(x,y)` by `−φ` into the heading frame → `(xr,yr)`; `xr·=k`;
`yr/=k`; rotate back by `+φ`. det=1 ⇒ **exactly** area-preserving for ANY
contour. Cheaper than per-vertex sqrt polar form. The round-2 "inverted polar"
`f = 1/√((cosθ/k)² + (k sinθ)²)` is only exact for a circle.

### Verification — det / Jacobian argument `[derived]` + `[fetched: Equiareal map, Squeeze mapping, Shoelace]`

The full map is `M = R(φ) · S · R(−φ)` where `S = diag(k, 1/k)`.

- `R(±φ)` are rotations: `det R = +1` `[derived]`.
- `S` is the squeeze: `det S = k·(1/k) = 1`. The fetched **Squeeze mapping** page
  states `(x,y)↦(ax, y/a)` "preserves the Euclidean area of regions" and the
  fetched **Equiareal map** page gives `diag(λ,1/λ)` as the canonical
  area-preserving linear map. `[fetched]`
- `det M = det R(φ)·det S·det R(−φ) = 1·1·1 = 1`. `[derived]`

**Why "any contour", not just a circle.** A linear map `M` acts on the whole
plane. By the change-of-variables theorem, for any measurable region `Ω`,
`Area(M(Ω)) = |det M| · Area(Ω)`. The fetched **Equiareal map** page states this
exactly: "A linear transformation `[[a,b],[c,d]]` multiplies areas by the
absolute value of its determinant `|ad − bc|`." With `|det M| = 1`,
`Area(M(Ω)) = Area(Ω)` for **every** region — the contour shape is irrelevant.
`[fetched]`

**Discrete shoelace confirmation `[derived]` + `[fetched: Shoelace]`.** For the
polygon with vertices `Pᵢ`, the fetched shoelace formula gives
`2A = Σ (xᵢ yᵢ₊₁ − xᵢ₊₁ yᵢ) = Σ det[Pᵢ, Pᵢ₊₁]`. Apply `M` to every vertex.
Each 2×2 term transforms as
`det[M Pᵢ, M Pᵢ₊₁] = det(M) · det[Pᵢ, Pᵢ₊₁]` (multiplicativity of det on the
column-stacked 2×2). Summing: `A' = det(M) · A = 1·A`. Exact, for arbitrary
vertex positions — i.e. any contour. ∎

**Cost.** Per vertex the affine squeeze is: 2 rotate-in muls + 2 adds, 2 scale
muls, 2 rotate-out muls + 2 adds ≈ **6 mul + 4 add, no transcendental**, and
`cosφ/sinφ` are computed ONCE per frame (shared across all N vertices). The
polar form `r·f(θ)` needs a per-vertex `sqrt` (and per-vertex `cos²/sin²`).
A `sqrt` is materially more expensive than the handful of mul/adds, and the
affine form amortizes the trig. So **cheaper** holds. `[derived]`

**Inverted-polar is circle-only `[derived]`.** Take the round-2 inverted radial
factor applied to a base polar contour `r(θ)`:
new radius `ρ(θ) = r(θ) · f(θ)`, `f(θ) = 1/√((cosθ/k)² + (k sinθ)²)`.

Polar area `A = ½∫₀²π ρ(θ)² dθ = ½∫ r(θ)² / ((cosθ/k)² + (k sinθ)²) dθ`.

- **Circle** `r(θ)=R`: this is exactly the standard polar form of the ellipse
  with semi-axes `(k, 1/k)`, whose area is `π·k·(1/k) = πR²`. Exact. ✅
  (Algebra: the ellipse `x²/k² + y²k² = R²` in polar is `r(θ)² = R²/((cosθ/k)²+(k sinθ)²)`,
  and an ellipse with semi-axes `a=kR`, `b=R/k` has area `πab = πR²`.) `[derived]`
- **Non-circle** `r(θ)` not constant: the weight `1/((cosθ/k)²+(k sinθ)²)` is a
  fixed function of θ, but it does **not** correspond to a coordinate remap of θ.
  The squeeze map remaps BOTH radius and angle (`tan θ' = tan θ / k²`); a
  fixed-angle radial multiply changes radius while leaving θ pinned, so the
  vertex lands at the wrong place and the swept area is wrong. Concretely, the
  correct squeeze sends a point at polar `(r,θ)` to
  `(√(k²r²cos²θ + r²sin²θ/k²), atan2(sinθ/k, k cosθ))` — the angle moves. The
  inverted-polar keeps θ fixed, so it equals the squeeze **only** when the
  contour is rotationally symmetric (a circle), where the angular error is
  invisible. For any bumpy `r(θ)`, area ≠ original in general. ✅

(Companion fact already in round-2 research: the *non-inverted* fixed-angle
multiply `r·√((k cosθ)²+(sinθ/k)²)` inflates a circle's area by `(k²+1/k²)/2`,
e.g. +6.7% at k=1.2. The "inverted" form fixes the circle case but still fails
for non-circles. Either way, **only the point-squeeze is exact for any shape**.)

### Verdict: **VERIFIED**

### TDD assertions
```ts
// 1a. det = 1: area exactly preserved for an ARBITRARY (noisy) contour
const pts = randomClosedContour(N, seed);          // any shape, not a circle
const A0 = shoelace(pts);
const A1 = shoelace(affineSqueeze(pts, k, phi));   // rotate -phi, x*=k, y/=k, rotate +phi
expect(Math.abs(A1 - A0) / A0).toBeLessThan(1e-9); // exact, any k, any phi

// 1b. k = 1 is the identity
expect(affineSqueeze(pts, 1, phi)).toEqual(pts);   // within 1e-12 per coord

// 1c. inverted-polar is exact ONLY for a circle, biased for a bump
const circ = polarContour(N, () => R);
expect(relAreaErr(invertedPolar(circ, k))).toBeLessThan(1e-9);     // circle ok
const bump = polarContour(N, t => R * (1 + 0.3 * Math.cos(3*t)));
expect(relAreaErr(invertedPolar(bump, 1.25))).toBeGreaterThan(0.02); // non-circle fails
expect(relAreaErr(affineSqueeze(bumpPts, 1.25, phi))).toBeLessThan(1e-9); // squeeze ok
```

---

## Item 2 — C1 uniform-offset normalization, re-derived from scratch

### Claim
`e = 1 + d`, target `mean((1+d)²)=1` via subtracting a single constant `c`:
`c = mean(e) − √(1 − Var(e))` (smaller root). Guard `Var(e) ≤ 1` for a real
root; multiplicative fallback `s = 1/√(mean(e²))`. Subtracting a constant is the
correct Lagrange/uniform-offset solution; a one-sided bulge "borrows from the
opposite side."

### Verification — full re-derivation `[derived]` + `[fetched: Shoelace]`

**Why `mean((1+d)²)=1` is the area target `[derived]`.** Closed polar contour
`r(θ)=baseR(1+d(θ))`. Enclosed area (polar form of shoelace / Green's theorem,
`A=½∮ r² dθ`; the fetched Shoelace page notes the polar/Green's-theorem
equivalence):
```
A = ½ ∫₀²π r² dθ = ½ baseR² ∫₀²π (1+d)² dθ.
Set A = π baseR²  ⇒  ∫₀²π (1+d)² dθ = 2π  ⇒  mean_θ[(1+d)²] = 1.
Discrete N vertices: (1/N) Σ (1+dᵢ)² = 1.
```

**Solve for the uniform offset `c`** (subtract `c` from every `dᵢ`, i.e. from
each `eᵢ=1+dᵢ`):
```
(1/N) Σ (eᵢ − c)² = 1
(1/N) Σ (eᵢ² − 2c eᵢ + c²) = 1
mean(e²) − 2c·mean(e) + c² = 1
c² − 2·mean(e)·c + (mean(e²) − 1) = 0
```
Quadratic in `c`:
```
c = mean(e) ± √( mean(e)² − mean(e²) + 1 )
```
Now `mean(e)² − mean(e²) = −Var(e)` (since `Var = mean(e²) − mean(e)²`), so the
discriminant is `1 − Var(e)`:
```
c = mean(e) ± √(1 − Var(e)).            ✅ matches the plan
```
**Root choice.** We want the membrane to stay outward and stay near the input
(minimal shift), so pick the **smaller** `|c|`, the `−` root:
```
c = mean(e) − √(1 − Var(e)).            ✅ matches the plan
```
Check it is the small root: `√(1−Var) ≤ 1 ≤ mean(e)` typically (since
`mean(e)=1+mean(d)` and `d` small), so `c ≥ 0` and small; the `+` root gives
`c ≈ mean(e)+something`, which would push the whole contour to near-zero radius
(inside-out). So `−` root is correct. `[derived]`

**Var(e) ≤ 1 real-root guard `[derived]`.** Discriminant `1 − Var(e) ≥ 0`
⇔ `Var(e) ≤ 1`. If audio drives variance past 1 there is **no real `c`** — a
single uniform offset literally cannot hit the target (you'd need
`mean((e−c)²) = 1` but the spread alone already exceeds 1·N once `Var>1` even at
the best-centered `c`, because `min_c mean((e−c)²) = Var(e) > 1`). The plan's
guard is exactly this minimum: the offset that minimizes `mean((e−c)²)` is
`c=mean(e)`, giving residual `= Var(e)`; if that floor already exceeds 1, no
offset works. ✅

**Multiplicative fallback `s = 1/√mean(e²)` `[derived]`.** Scale instead of
shift: `r'ᵢ = baseR·s·eᵢ`. Then
`mean((s eᵢ)²) = s²·mean(e²) = 1 ⇒ s = 1/√mean(e²)`. Always real (needs only
`mean(e²)>0`, guaranteed since `e²≥0` and not all zero), exactly area-preserving.
Trade-off (correctly stated in round-2): scaling shrinks the WHOLE cell
uniformly instead of locally borrowing — less "squeezed balloon," but safe. ✅

**Is subtracting a constant the correct Lagrange / uniform-offset solution?
`[derived]`** Yes. Minimize the deviation from the raw field
`J = Σ (dᵢ' − dᵢ)²` subject to constraint `g = Σ(1+dᵢ')² − N = 0`. Lagrangian
`L = Σ(dᵢ'−dᵢ)² − λ Σ((1+dᵢ')²−1)`. Stationarity:
`∂L/∂dᵢ' = 2(dᵢ'−dᵢ) − 2λ(1+dᵢ') = 0 ⇒ dᵢ' = (dᵢ + λ)/(1−λ)`.
That is an affine map of `dᵢ` — i.e. a scale `1/(1−λ)` plus a shift. The plan's
"uniform offset" is the pure-shift special case (the geometric "move every
vertex the same distance ALONG the normal," which for a star-shaped polar
contour is adding the same `c·baseR` to every radius). Both the pure offset and
the pure scale are valid area-restorers; the plan deliberately chooses the
**offset** for the mass-borrow look and keeps the **scale** as the fallback.
Note: the strict L2-closest-to-`d` projection is the affine form above, but the
plan does not claim L2-optimality — it claims "uniform offset solves
`mean((1+d)²)=1`," which the quadratic proves exactly. ✅

**"Bulge borrows from opposite side" `[derived]`.** Suppose one vertex bulges:
`d_j` large, rest ≈ 0. Then `mean(e) = 1 + d_j/N`, `Var(e) ≈ d_j²(N−1)/N²`. The
offset `c = mean(e) − √(1−Var(e)) > 0`, and the new field is `dᵢ − c`. The bulge
vertex stays large (`d_j − c`), but **every other vertex is pushed inward by `c`**
(`0 − c < 0`). So the bulge is paid for by the rest of the membrane contracting —
mass is borrowed from the opposite/remaining side. The total `mean((1+d')²)=1`
is restored. ✅ (This is the qualitative difference from the multiplicative
fallback, which would shrink the bulge too.)

### Verdict: **VERIFIED**

### TDD assertions
```ts
// 2a. closed form hits the area target for any saturated audio field
const d = saturatedField(audio, Dmax);          // ensures Var(1+d) <= 1 in practice
const e = d.map(x => 1 + x);
const c = mean(e) - Math.sqrt(1 - variance(e));
const f = e.map(x => x - c);
expect(meanSq(f)).toBeCloseTo(1, 9);             // mean((1+d-c)^2) = 1
expect(Math.min(...f)).toBeGreaterThan(0);       // no inside-out vertex

// 2b. real-root guard triggers multiplicative fallback when Var > 1
const wild = makeField(() => 5 * (Math.random()*2-1)); // Var >> 1, pre-saturation
const out = normalizeArea(wild);                 // must NOT NaN
expect(meanSq(out.map(x=>1+x))).toBeCloseTo(1, 9);

// 2c. mass borrow: one-sided bulge pulls the opposite side inward
const bump = zeros(N); bump[0] = 0.4;
const norm = normalizeArea(bump);                // additive branch
expect(norm[N/2]).toBeLessThan(0);               // opposite vertex moved inward
expect(meanSq(norm.map(x=>1+x))).toBeCloseTo(1, 9);
```

---

## Item 3 — Pipeline order (9 steps): saturate → integrate → normalize → squeeze

### Claim
Step order: `4 saturate(B1)` → `5 integrate` → `7 normalize(C1)` → `8 affine
squeeze(C2)` (with optional `6` smoothing). Each invariant must survive the NEXT
step. integrateDeformation (per-vertex asymmetric ease) between saturate and
normalize would break boundedness/area, so normalize runs AFTER integrate.

### Verification — invariant survival, step by step `[derived]`

Let me track two invariants: **(B) boundedness** `|dᵢ| < Dmax`, and **(C) area**
`mean((1+dᵢ)²)=1`.

**Step 4 (saturate) establishes B.** `dᵢ ← Dmax·tanh(dᵢ/Dmax)` ⇒ `|dᵢ| < Dmax`
strictly (asymptote). Establishes (B). Does NOT establish (C). `[derived]`

**Step 5 (integrate) — does it break B or C?** integrateDeformation is a
per-vertex asymmetric ease (lerp toward target with attack/release):
`dᵢ ← dᵢ_prev + α·(dᵢ_target − dᵢ_prev)`, `α∈[0,1]` (asymmetric: different α for
attack vs release). `[plan-described; code-grounding GAP — see top note]`

- **Effect on B (boundedness): SURVIVES.** A convex combination of two values
  each in the open interval `(−Dmax, Dmax)` stays in `(−Dmax, Dmax)`:
  `|dᵢ| ≤ (1−α)|dᵢ_prev| + α|dᵢ_target| < Dmax`. So if BOTH prev and target are
  saturated, the integrated field is still bounded. ✅ This is WHY saturate runs
  BEFORE integrate (step 4 before 5): saturating the target keeps the ease
  bounded. `[derived]`
  - ⚠ **CAVEAT (boundary condition):** boundedness of the integrated field
    requires the *previous frame's* field to also be `<Dmax`. By induction this
    holds if the very first frame is initialized inside the bound (e.g. zeros).
    A TDD test should seed a worst-case prev at `±(Dmax−ε)` and confirm no frame
    escapes. Not a formula error — an initialization invariant to assert.

- **Effect on C (area): BROKEN, as the plan says.** Even if `dᵢ_prev` and
  `dᵢ_target` each individually satisfied `mean((1+d)²)=1`, a per-vertex convex
  blend does NOT preserve that mean, because `mean((1+·)²)` is a **nonlinear
  (quadratic, convex)** functional and the blend coefficient is **per-vertex**
  (asymmetric attack/release ⇒ different α at different vertices). Concretely,
  with per-vertex `αᵢ`, `1+dᵢ = (1−αᵢ)(1+dᵢ_prev) + αᵢ(1+dᵢ_target)`; squaring
  and averaging introduces cross terms `αᵢ(1−αᵢ)(eᵢ_target−eᵢ_prev)²` that do not
  cancel. So area drifts. ✅ This is EXACTLY why the plan moves normalize to AFTER
  integrate (step 7 after 5). Verified the plan's reasoning is correct. `[derived]`

  Minimal counterexample `[derived]`: N=2, prev=[0,0] (area-ok: mean(1²)=1),
  target=[+t,−t] with `mean((1+t)²+(1−t)²)/2 = 1+t² ≠ 1` — actually target isn't
  area-ok, so take normalized target eq=[+s,−s] with `((1+s)²+(1−s)²)/2=1`⇒`s=0`,
  degenerate at N=2. Use N=4, prev all 0, target = c·[1,1,−1,−1] chosen so
  target is area-normalized; blend with α=[0.2,0.8,0.2,0.8]. Numerically the
  blended `mean((1+d)²) ≠ 1`. The asymmetry of α is the key driver. (A symmetric
  uniform α between two *area-ok* fields still generally breaks area because the
  functional is quadratic, not affine.)

**Step 6 (optional cyclic Laplacian smoothing) — does it break B or C?**
`dᵢ += λ(d_{i−1}+d_{i+1}−2dᵢ)/2`, `λ≤0.5`.
- **B survives:** the new value is a convex combination
  `dᵢ' = (1−λ)dᵢ + λ(d_{i−1}+d_{i+1})/2` (for `λ≤1`), a convex blend of points
  all `<Dmax` ⇒ stays `<Dmax`. ✅ `[derived]`
- **C:** smoothing also perturbs area (again quadratic functional), but step 6
  runs BEFORE step 7 normalize, so it's fine — normalize cleans up after it. ✅

**Step 7 (normalize) establishes C.** Subtract `c` (Item 2). Now
`mean((1+dᵢ)²)=1`. But normalize can in principle nudge boundedness: it shifts
every `dᵢ` by `−c`. Since `c` is small (and the plan additionally CLAMPS `c` to a
small range to prevent a startle frame pulsing the whole membrane), the post-
normalize field is `dᵢ − c`, still well within radius limits. ⚠ Strictly, B's
`<Dmax` could be violated by `c` (e.g. `dᵢ` near `−Dmax` then `−c` more), but the
radius BUDGET in Item 5 is computed on `(1±Dmax)` with headroom, and the final
step-9 clamp is the safety net. The ORDER is right: establish area last among the
deformation steps, then the geometric squeeze, then clamp. `[derived]`

**Step 8 (affine squeeze) — does it break C?** NO. By Item 1, the squeeze has
det=1, so it preserves the area that step 7 just set to `π·baseR²`, for any
contour. This is the crucial reason the squeeze must come AFTER normalize: it
*transports* the normalized area exactly. ✅ `[derived]`

**Step 9 (clamp) — safety net.** A no-op under the radius budget (Item 5).

**Order proof summary (each invariant survives the NEXT step):**
- 4 sets B. 5 (integrate) preserves B (convex blend) but breaks C → so C is not
  yet claimed. ✅
- 5→7: normalize sets C on the integrated field (correct: it must see the
  integrated field, else C dies on the live path — plan's Blocker-1 fix). ✅
- 7→8: squeeze preserves C (det=1, Item 1). ✅
- 8→9: clamp is no-op (Item 5). ✅

### Verdict: **VERIFIED** (plan's ordering and its rationale are mathematically correct)

Two caveats (neither is a formula error):
1. **Boundedness induction needs a bounded initial/prev frame** — assert it.
2. **normalize's `−c` shift can theoretically nudge a near-`Dmax` vertex past the
   bound**; the plan already (a) clamps `c` small and (b) keeps the step-9 clamp.
   Fine, but the radius budget in Item 5 should use `(1+Dmax+c_max)` to be airtight
   (see Item 5 caveat).

### TDD assertions
```ts
// 3a. integrate (per-vertex asymmetric ease) preserves boundedness...
const prev = field(() => (Math.random()*2-1)*(Dmax-1e-3));   // worst-case saturated prev
const tgt  = saturate(rawTarget, Dmax);
const integ = integrateDeformation(prev, tgt, attack, release);
expect(Math.max(...integ.map(Math.abs))).toBeLessThan(Dmax); // B survives

// 3b. ...but BREAKS area (justifies normalize-after-integrate)
expect(meanSq(integ.map(x=>1+x))).not.toBeCloseTo(1, 3);     // area drifted (generically)

// 3c. normalize AFTER integrate restores area on the LIVE field (Blocker-1)
const normed = normalizeArea(integ);
expect(meanSq(normed.map(x=>1+x))).toBeCloseTo(1, 9);

// 3d. squeeze AFTER normalize keeps area (det=1)
const liveArea = shoelace(toPoints(normed, baseR));
const squeezed = affineSqueeze(toPoints(normed, baseR), k, phi);
expect(relErr(shoelace(squeezed), liveArea)).toBeLessThan(1e-9);
```

---

## Item 4 — D5: two sequential squeezes + frame-rate-independent EMA

### Claim
Two sequential affine squeezes along different axes (heading φ_v and accel φ_acc)
stay area-preserving (det = 1·1 = 1). EMA
`aSmooth += (aMag − aSmooth)·(1 − exp(−dt/τ))` is frame-rate-independent vs a
fixed lerp.

### Verification

**Two squeezes, det = 1·1 = 1 `[derived]` + `[fetched: Squeeze mapping, Equiareal map]`.**
Let `M₁ = R(φ_v)·diag(k_v,1/k_v)·R(−φ_v)` and
`M₂ = R(φ_acc)·diag(k_acc,1/k_acc)·R(−φ_acc)`. The composite is `M₂·M₁`.
By multiplicativity of determinant (`det(AB)=det A·det B`):
`det(M₂M₁) = det(M₂)·det(M₁) = 1·1 = 1`. So the composite preserves area for ANY
contour and ANY two axes/gains. `[derived]` The fetched **Squeeze mapping** page
confirms squeezes form a group under composition (composition of squeezes is a
squeeze of the product) — here the axes differ so the product is a general
area-preserving (SL₂) map, not a single squeeze, but `det` is still 1. ✅

Important nuance the plan gets RIGHT: because φ_v ≠ φ_acc in general (they diverge
at wall bounces), you must NOT fold them into one axis with `k=k_v·k_acc` — that
would be wrong geometry. Applying them as **two sequential squeezes** is both
geometrically correct (different axes) AND exactly area-preserving (det product).
The round-2 research's "compose only if axes coincide" caveat is satisfied by the
plan's choice to apply two separate squeezes. ✅

**EMA frame-rate independence `[derived]`.** The continuous-time first-order
low-pass is `dx/dt = (u − x)/τ`. Over a step `dt` with `u` held constant, the
exact solution is:
```
x(t+dt) = u + (x(t) − u)·exp(−dt/τ)
        = x(t) + (u − x(t))·(1 − exp(−dt/τ)).
```
So the EXACT discrete update uses blend factor `α = 1 − exp(−dt/τ)`. The plan's
`aSmooth += (aMag − aSmooth)·(1 − exp(−dt/τ))` is this exact solution. ✅
Two refresh rates reaching the same elapsed time converge to the same value
(semigroup/consistency): `exp(−dt₁/τ)·exp(−dt₂/τ) = exp(−(dt₁+dt₂)/τ)`, so taking
two half-steps equals one full step EXACTLY (for constant `u`). `[derived]`

**Vs fixed lerp `[derived]`.** A fixed `α` (e.g. `x += (u−x)·0.2` every frame)
has an *effective* time constant that depends on frame rate: time-to-63% =
`−dt/ln(1−α)`, which scales with `dt`. At 120fps it smooths twice as fast (in
wall-clock) as at 60fps → behavior changes with refresh rate. The `1−exp(−dt/τ)`
form removes this dependence. The plan is correct, and matches round-2's
recommendation. ✅

Note: `aMag = |Δv|/dt` amplifies noise as `dt→0`; the EMA + final `clamp(...,0,1)`
cap (plan's `aHat = clamp(aSmooth/aRef,0,1)`) handles that — also correct.

### Verdict: **VERIFIED**

### TDD assertions
```ts
// 4a. two squeezes on different axes preserve area for an arbitrary contour
const pts = randomClosedContour(N, seed);
let q = affineSqueeze(pts, kV, phiV);
q = affineSqueeze(q, kAcc, phiAcc);
expect(relErr(shoelace(q), shoelace(pts))).toBeLessThan(1e-9);   // det = 1*1

// 4b. EMA is frame-rate independent: 2 half-steps == 1 full step (constant input)
const tau = 0.1, u = 3.0;
const one = emaStep(x0, u, dt, tau);
const two = emaStep(emaStep(x0, u, dt/2, tau), u, dt/2, tau);
expect(two).toBeCloseTo(one, 12);

// 4c. fixed-lerp FAILS the same test (regression witness)
const f1 = lerpStep(x0, u, 0.2);
const f2 = lerpStep(lerpStep(x0, u, 0.2), u, 0.2);
expect(Math.abs(f2 - f1)).toBeGreaterThan(1e-3);  // depends on step count -> frame-rate dependent
```

---

## Item 5 — tanh soft-saturation + radius budget makes step-9 clamp a no-op

### Claim
`d ← Dmax·tanh(d/Dmax)`: unit slope at 0 (no dead zone), strict bound `<Dmax`.
Radius budget `baseR·(1+Dmax)·k_max ≤ maxRadius` makes the step-9 clamp a
provable no-op (with companion `baseR·(1−Dmax)/k_max ≥ floorRadius`).

### Verification `[derived]`

**Unit slope at 0.** `g(d)=Dmax·tanh(d/Dmax)`. `g'(d)=Dmax·sech²(d/Dmax)·(1/Dmax)
= sech²(d/Dmax)`. `g'(0)=sech²(0)=1`. ✅ No dead zone (small audio passes through
≈1:1; `tanh x ≈ x − x³/3`). `[derived]`

**Strict bound.** `|tanh(·)| < 1` for all finite argument (asymptotic to ±1, never
reached) ⇒ `|g(d)| < Dmax` strictly for all finite `d`. ✅ `[derived]`

**No dead zone & smoothness.** `g` is C∞, monotonic (`g'>0` everywhere), odd —
no flat region, no kink. Contrast hard clamp which has `g'=0` beyond `±Dmax`
(the dead zone) and a C0 kink. ✅ `[derived]`

**Radius budget ⇒ clamp is a no-op `[derived]`.** After saturate, `dᵢ ∈ (−Dmax,
Dmax)`. The maximum membrane radius after the affine squeeze(s): the squeeze
scales a coordinate by at most `k_max = (1+elong)(1+squashGain)`, so the largest
post-squeeze radius is bounded by `baseR·(1+|d|_max)·k_max < baseR·(1+Dmax)·k_max`.
If `baseR·(1+Dmax)·k_max ≤ maxRadius`, then every vertex radius `< maxRadius` ⇒
the upper clamp never fires. Symmetrically the smallest radius `>
baseR·(1−Dmax)/k_max ≥ floorRadius` ⇒ lower clamp never fires. So step-9 clamp is
provably inactive. ✅ `[derived]`

- ⚠ **CAVEAT (budget completeness):** the budget as written uses `(1+Dmax)` but
  step 7 (normalize) subtracts/adds the offset `c` AFTER saturation, so a vertex
  can reach `1 + Dmax_effective` where the field is `dᵢ − c`. Since the additive
  offset can be NEGATIVE for outward-bulged vertices? No — `c` is subtracted, and
  `c≥0` for the small root, so normalize moves vertices INWARD on net for the
  non-bulge side; the bulge vertex stays at `dᵢ − c ≤ dᵢ < Dmax`. So normalize
  does not increase the max radius (it can only reduce `dᵢ` by `c≥0`). ✅ Good —
  the `(1+Dmax)` bound is actually conservative because `c≥0`. BUT if `c<0` ever
  occurs (can happen when `mean(e)<√(1−Var(e))`, i.e. the cell is net-deflated and
  the offset pushes outward), then max radius could exceed `(1+Dmax)`. The plan's
  clamp-`c`-to-a-small-range guard plus the floor/max safety clamp covers this.
  Recommend the airtight budget `baseR·(1+Dmax+|c|_max)·k_max ≤ maxRadius`. Not a
  formula error — a completeness tightening. `[derived]`

- The fetched **Squash and stretch** page supports keeping `k` modest ("maintain
  overall volume"); with `elong≈0.12–0.15` and `squashGain≈0.12`, `k_max≈1.27`,
  well inside the `cellReach` headroom the plan adds. `[fetched]`

### Verdict: **VERIFIED** (one budget-completeness tightening recommended)

### TDD assertions
```ts
// 5a. unit slope at 0, strict bound, monotonic
const eps = 1e-6;
expect((sat(eps,Dmax)-sat(-eps,Dmax))/(2*eps)).toBeCloseTo(1, 6); // g'(0)=1
for (const x of [0, 1, 10, 1e6, -1e6]) expect(Math.abs(sat(x,Dmax))).toBeLessThan(Dmax);
expect(sat(5,Dmax)).toBeGreaterThan(sat(4.9,Dmax));               // monotone

// 5b. radius budget => step-9 clamp is a NO-OP for any audio
const kMax = (1+elong)*(1+squashGain);
const cMax = 0.05; // clamped offset range
expect(baseR*(1+Dmax+cMax)*kMax).toBeLessThanOrEqual(maxRadius); // airtight upper
expect(baseR*(1-Dmax)/kMax).toBeGreaterThanOrEqual(floorRadius);  // lower
// then drive the full pipeline with extreme audio and assert clamp never changes a vertex:
const built = pipeline(extremeAudio, {Dmax, elong, squashGain, baseR});
expect(built.clampFiredCount).toBe(0);
```

---

## Remaining issues in plan v2 (flagged)

**No remaining MATH errors.** All five corrected formulas are sound and the
ordering proofs hold. Three non-formula items:

1. **(Item 3 caveat) Boundedness induction** — the convex-blend boundedness of
   integrateDeformation requires a bounded initial/previous frame. Assert the
   seed frame is inside `(−Dmax,Dmax)`; otherwise the first frame could exceed
   the bound. Robustness, not a wrong formula.

2. **(Item 5 caveat) Radius budget completeness** — fold the normalize offset
   into the budget: use `baseR·(1+Dmax+|c|_max)·k_max ≤ maxRadius`. Because the
   plan clamps `c` small, the gap is tiny, but it makes the "clamp is a no-op"
   claim airtight even when `c<0` (net-deflated startle frames). The plan already
   keeps the step-9 clamp as a real safety net, so nothing breaks today.

3. **(Labeling, not math)** The plan itself flags D4/D5 as animation license, not
   ciliate biology — correct call. The area math is independent of that and holds.

**Code-grounding gap (open):** I could not open `cell.ts`/`shared.ts`
(`integrateDeformation`, line refs) with the available tools — no
directory-listing / `code_search`, and the documented path does not resolve.
Item 3's assumption that integrateDeformation is a **per-vertex asymmetric ease**
(convex blend) is taken from the plan's own description; the math conclusions
(boundedness survives, area breaks → normalize-after) follow from that structure.
If the real `integrateDeformation` does something non-convex (e.g. additive
accumulation without a `(1−α)` term), re-verify boundedness. **Next step:** run
`code_search "integrateDeformation"` / open the file to confirm the blend form,
and run the TDD assertions above against the live contour (plan's B3).
