# Research: Real-time 2D deformable closed-contour membranes (cell/blob/amoeba) — cheap deterministic math

> **Search-availability note (read first):** All web-search providers were
> unavailable during this run — **Exa = out of credits (HTTP 402)**, **Perplexity
> = no API key**, **Gemini API = disabled for the project (403)**. I could NOT run
> `web_search`. I *was* able to use `fetch_content` to pull primary sources
> directly from Wikipedia (Centripetal Catmull–Rom, Squash and stretch, Equiareal
> map). Everything else below (polar-area integral, uniform-offset closed form,
> tanh saturation, frame-rate independence) is **derived analytically from first
> principles** and cross-checked against those primary sources. Where a claim
> rests on derivation rather than a fetched citation, it is marked **[derived]**.
> Re-run `web_search` once a provider is back to harden the citations flagged in
> Gaps.

## Summary
The area-preserving "ellipse" (semi-axes `k`, `1/k`) is a **squeeze map** with
determinant `k·(1/k)=1`, so it preserves area **exactly — but only when applied
as a coordinate transform on the contour points**, not as a fixed-angle radial
multiplier. As a fixed-angle multiplier `r(θ)·√(k²cos²+sin²/k²)` it *inflates*
area by `(k²+1/k²)/2` (≈+6.7% at k=1.2) — this is the one real bug in the plan's
Phase C. The uniform-offset normalization `mean((1+d)²)=1` is correct and has a
clean quadratic closed form, with the pitfall that a real root requires
`Var(1+d) ≤ 1` (so you must soft-saturate *before* normalizing — which the plan
already orders correctly). For squash-and-stretch, the 2D volume-conserving rule
is exactly the squeeze: stretch `k` along motion ⇒ `1/k` perpendicular. Use
centripetal Catmull–Rom (α=0.5) or band-limited trig interpolation for seamless
periodic radial reconstruction, and `Dmax·tanh(d/Dmax)` for soft bounding.

---

## Findings

### 1. Area / volume conservation

**1a. Polar enclosed-area identity (the basis of everything). [derived]**
For a closed polar contour `r(θ) = baseR·(1 + d(θ))`, the enclosed area is
```
A = ½ ∫₀²π r(θ)² dθ = ½ · baseR² · ∫₀²π (1 + d(θ))² dθ.
```
Setting `A` equal to the undeformed disk area `π·baseR²` gives
```
∫₀²π (1+d)² dθ = 2π   ⇔   mean_θ[(1+d)²] = 1.
```
Discrete N-vertex form: **`mean_i[(1 + d_i)²] = 1`**. ✅ The plan's normalization
target (Phase C1) is **correct**.

**1b. Uniform-offset (Lagrange-multiplier) normalization — exact closed form. [derived]**
Let `e_i = 1 + d_i`. Subtract a single constant `c` from every `d_i` (equivalently
from `e_i`) so that `mean[(e_i − c)²] = 1`:
```
c² − 2c·mean(e) + (mean(e²) − 1) = 0
⇒ c = mean(e) ± √( mean(e)² − mean(e²) + 1 )
     = mean(e) ± √( 1 − Var(e) )            // Var(e)=mean(e²)−mean(e)²
```
Pick the root that keeps the membrane outward and near the input:
**`c = mean(e) − √(1 − Var(e))`** (the smaller offset). New factor
`e_i − c = 1 + d_i − c`. This is the discrete Lagrange-multiplier (uniform normal
offset) solution: one scalar `c` shifts the whole contour so a one-sided bulge
"borrows mass" from the rest. ✅ The plan's C1 ("subtract constant c, closed-form
quadratic root") is **correct**.

  - **Pitfall 1 — discriminant:** a real root needs **`Var(e) ≤ 1`**. If audio
    drives the deformation variance past 1 there is *no real `c`*. This is exactly
    why **soft-saturation must run before normalization** — the plan's pipeline
    order (saturate at step 4, normalize at step 5) is the right fix. Add an
    explicit guard: if `Var(e) > 1`, fall back to the multiplicative scale below.
  - **Pitfall 2 — root choice & positivity:** ensure `e_i − c > 0` for all i
    (no inside-out vertices). The smaller-offset root normally guarantees this;
    assert it in the test.

**1c. Multiplicative normalization (always-real alternative). [derived]**
```
s = 1 / √( mean_i[(1+d_i)²] )     →     r_i = baseR · s · (1+d_i)
```
Always real (only needs `mean>0`), exactly area-preserving. Trade-off: a
one-sided bulge shrinks the **whole** cell uniformly instead of locally borrowing
from the opposite side — less "squeezed-balloon" plausible than the additive
offset. **Recommendation:** keep the additive offset (C1) for plausibility, but
guard with the multiplicative `s` as the fallback when `Var > 1`.

**1d. Area-preserving ellipse / squeeze map — CONFIRMED, with a sharp caveat.**
A linear map multiplies areas by `|det|`; the squeeze `diag(λ, 1/λ)` has
`det = λ·(1/λ) = 1`, so it is **equiareal (area-preserving) exactly**
([Equiareal map, Wikipedia](https://en.wikipedia.org/wiki/Equiareal_map) — the
page explicitly gives the squeeze `diag(λ,1/λ)` as the canonical area-preserving
linear map and states areas scale by `|ad−bc|`). So semi-axes `(k, 1/k)` ⇒ exact
area preservation **iff applied as a coordinate transform** on the contour points:
```
(x, y)  →  ( k·x', (1/k)·y' )      in the frame rotated by φ=heading
```
  - **⚠ BUG / caveat [derived]:** the plan's C2 uses it as a *fixed-angle radial
    multiplier* `r(θ) · √((k cosθ)² + ((1/k) sinθ)²)`. That is **NOT** area
    preserving, because it lengthens the radius at angle θ *without* remapping θ.
    For a circle of radius R the resulting area is
    ```
    A = ½ ∫ R²(k²cos²θ + sin²θ/k²) dθ = πR² · (k² + 1/k²)/2  >  πR² for k≠1.
    ```
    Inflation factor `(k²+1/k²)/2`: k=1.05 → +0.1%, k=1.1 → +0.5%, k=1.2 → **+6.7%**,
    k=1.3 → +12%. It is only *second-order* accurate (`≈1+(k−1)²`), so it's
    invisible for tiny k but will **fail a ±2% shoelace test above k≈1.14**.
    **Fix:** apply the ellipse as the coordinate squeeze on the built points
    (2 multiplies/vertex, exactly det=1) — then it preserves the already-normalized
    area `π·baseR²` exactly and the order "normalize → ellipse" is safe.

---

### 2. Squash-and-stretch from acceleration

**2a. Volume-conserving stretch is exactly the squeeze. [derived + Equiareal map]**
Stretch by `k` along the motion axis ⇒ compress by `1/k` perpendicular (2D area
conservation). This is identical to finding 1d: `diag(k, 1/k)`, det=1.
(3D analog for reference: stretch `s` along axis ⇒ `1/√s` on each of the two
perpendicular axes, so `s·(1/√s)²=1`.) The plan's D5 2D rule is **correct**.

**2b. Mapping |dv/dt| → stretch. [derived]**
```
aMag   = |v − vPrev| / dt                       // frame-rate-correct magnitude
aHat   = clamp(aMag / aRef, 0, 1)               // normalize & cap
k_acc  = 1 + squashGain · aHat                  // ≥1 stretch along accel/heading
```
Compose with motion-prolate (D4) **only if the axes coincide**: `k = k_v · k_acc`
along a single φ. Caveat: acceleration during a *turn* is perpendicular to
velocity, so a single-axis composition is an approximation; for a forward-swimming
cell accel≈heading and it's fine — but note it, and if you ever see lateral accel,
either pick the dominant axis or apply two squeezes sequentially.

**2c. Typical gains & stability.**
  - Subtle organic cell: `squashGain ≈ 0.10–0.25`, elongation `elong ≈ 0.10–0.30`,
    so `k` stays in ~`[1.05, 1.3]`. (Classic hand-animation exaggerates far more,
    but "maintain overall volume" is the hard rule —
    [Squash and stretch, Wikipedia](https://en.wikipedia.org/wiki/Squash_and_stretch):
    Disney animators pushed it "ever more extreme" *but had to maintain the overall
    volume so it did not appear to change volume as well as shape.* Keep k modest
    given the area-error caveat in 1d.)
  - **dt stability:** `aMag = |Δv|/dt` *amplifies noise as dt→0*. Smooth the
    acceleration estimate with an EMA and clamp:
    ```
    aSmooth += (aMag − aSmooth) · (1 − exp(−dt/τ_a))     // τ_a ≈ 0.05–0.15 s
    aHat = clamp(aSmooth / aRef, 0, 1)
    ```
    Use the `1 − exp(−dt/τ)` form (not a fixed lerp factor) for true frame-rate
    independence. [derived] Always keep the final `min(…,1)` cap so a single huge
    frame spike can't blow `k` up.

---

### 3. Smooth periodic deformation (no C0/C1 seam on the closed loop)

**3a. Wraparound is mandatory.** Index bins/vertices modulo N
(`bin[(i±1+N)%N]`) so the curve is genuinely periodic; the plan's A3 test
(`binDeform(0)==binDeform(2π)`) is the right invariant.

**3b. Centripetal Catmull–Rom (α=0.5) — recommended cheap interpolant.**
Catmull–Rom interpolates its control points (passes through every bin), is C1, and
is cheap. **Use centripetal parameterization (α=0.5)**: knot spacing
`tᵢ₊₁ = tᵢ + |Pᵢ₊₁−Pᵢ|^α`. Per
[Centripetal Catmull–Rom spline, Wikipedia](https://en.wikipedia.org/wiki/Centripetal_Catmull%E2%80%93Rom_spline)
(citing Yuksel, Schaefer, Keyser, *CAD* 2011): centripetal (α=0.5) **never produces
cusps or self-intersections within a segment** and follows control points more
tightly than uniform (α=0) or chordal (α=1). Uniform CR is the one that overshoots
/ loops; chordal under-fits. For a periodic radial signal, build the four-point
window with wraparound indices.

**3c. Overshoot mitigation (Cardinal tension).** Catmull–Rom = Cardinal spline
with tension `0.5` (tangent `mᵢ = (1−tension)·(Pᵢ₊₁−Pᵢ₋₁)`... i.e. scale the
tangents). Raising tension toward 1 shortens tangents → less overshoot
(tension=1 ⇒ piecewise-linear, zero overshoot but C0 corners). For a radial
function the only *hard* requirement is `1 + d(θ) > 0`; centripetal α=0.5 plus the
soft-saturation in §4 keeps overshoot bounded, and the final positivity is
guaranteed by clamping `1+d`. [derived from the CR/Cardinal definitions]

**3d. Band-limited trig interpolation — the "spectrum" cleanest option. [derived]**
You literally have 32 bins of a *spectrum*. The mathematically exact periodic,
C∞, overshoot-free reconstruction is trigonometric (DFT) interpolation: treat the
32 samples as Fourier coefficients / or take the real FFT and evaluate
`d(θ) = Σ_{m=0}^{N/2} (aₘ cos mθ + bₘ sin mθ)`. Exactly periodic, infinitely
smooth, no seam, no parameterization choice. Cost: precompute N/2 harmonics once
per frame, then each vertex is a sum — still cheap at N=32, M=16. **If you want
fewer wiggles, just truncate the harmonic count (low-pass), which also kills any
overshoot.** This is arguably *more* appropriate than Catmull–Rom precisely
because the data already is a spectrum. Either is defensible; trig is smoother,
CR is simpler to drop in.

**3e. Overshoot-free fallback:** smoothstep interpolation between adjacent bins
`d = lerp(d_i, d_{i+1}, smoothstep(f))` stays strictly within `[d_i, d_{i+1}]`
(no overshoot ever), C1 if you match derivatives — adequate at 32 bins / 160px.

---

### 4. Soft saturation (tanh) vs hard clamp

**4a. Recommended form. [derived]**
```
d_sat = Dmax · tanh(d / Dmax)
```
  - Near origin `tanh(x)≈x − x³/3`, so `d_sat ≈ d` with **unit slope at 0** — no
    dead zone, full sensitivity to small audio. (Add a knee/gain `g`:
    `Dmax·tanh(g·d/Dmax)`; g=1 = unit slope, larger g = harder knee → closer to
    clamp, smaller g = more compression.)
  - **Strictly bounded:** `|d_sat| < Dmax` for all finite input (asymptote only),
    so if you choose `Dmax` such that `baseR·(1±Dmax) ∈ [floorRadius, maxRadius]`,
    the final safety clamp (pipeline step 7) is provably a **no-op** under all
    audio. This is exactly the plan's B1 goal — **correct**.
  - C∞, monotonic, odd-symmetric → no kink, no flat region.

**4b. Why not hard clamp.** `clamp(d, −Dmax, Dmax)` has **zero derivative beyond
±Dmax** (the "flat dead-zone" the task warns about): all variation above the
threshold is destroyed (visible flattening/clipping), and it introduces a C0 kink
(curvature discontinuity) at ±Dmax that can show as a crease on the membrane.
tanh compresses gracefully and keeps derivative > 0 everywhere. [derived]

**4c. Cheaper soft-clip alternatives (if `exp`/`tanh` cost matters):**
`d/√(1+(d/Dmax)²)·Dmax` (algebraic sigmoid, no transcendental) or a rational
soft-clip. Same unit-slope-at-0, smooth-saturation properties; slightly different
knee shape. tanh is the standard, fine on a 160×160 overlay at N=32.

---

## Critique of the plan's Phase B / C math

| Plan item | Verdict | Note |
|---|---|---|
| **B1** `d ← Dmax·tanh(d/Dmax)` | ✅ Correct | Strict bound `<Dmax` makes the render clamp a true no-op. Optionally expose knee gain `g`. |
| **B2** one cyclic smoothing pass | ✅ Fine | Use periodic Laplacian `d_i += λ·(d_{i−1}+d_{i+1}−2d_i)/2`, keep `λ ≤ 0.5` for stability; wraparound indices. |
| **B3** align tested path to live | ✅ Good practice | No math issue. |
| **C1** uniform-offset `mean((1+d)²)=1`, quadratic root | ✅ Correct, **add guards** | Closed form `c = mean(e) − √(1−Var(e))`, `e=1+d`. **Must guard `Var(e) ≤ 1`** (else no real root → fall back to multiplicative `s=1/√mean(e²)`). Assert `1+d_i−c > 0`. Saturate-before-normalize ordering already handles the common case. |
| **C2** ellipse `√((k cos)²+((1/k) sin)²)` "exactly area-preserving" | ⚠ **Bug if used as fixed-angle radial multiply** | `diag(k,1/k)` is area-preserving (det=1) **only as a coordinate squeeze on points**. As a radial multiplier at fixed θ it inflates area by `(k²+1/k²)/2` (≈+6.7% at k=1.2 → fails a 2% shoelace test). **Fix:** apply as point squeeze `(x,y)→(k·x', y'/k)` in the heading frame, after normalization; or renormalize after the multiply. |
| **C2/D4+D5** compose motion-prolate & accel-squash via "same ellipse" | ⚠ Approx | Valid only when the two axes coincide (`k=k_v·k_acc`, one φ). Acceleration during a turn is ⊥ velocity; for forward swimming it's fine — document the assumption or apply two squeezes. |

**Net:** Phase B is sound. Phase C's normalization is correct (add the variance
guard); Phase C's ellipse is the one place to fix — switch from fixed-angle radial
multiply to a coordinate squeeze so "exactly area-preserving" becomes literally
true and your normalized `π·baseR²` survives the squash/prolate stages.

---

## Prioritized formulas (drop-in)

```text
# 1. Build raw deformation d_i  (FBM + pseudopod + interpolated bins + idle)

# 2. SOFT-SATURATE  (no dead zone, strict bound)
d_i = Dmax * tanh(d_i / Dmax)                 # Dmax: baseR*(1±Dmax) in [floor,max]; ~0.3–0.5

# 3. AREA-NORMALIZE  (uniform offset, mass-borrow)
e_i = 1 + d_i
m1 = mean(e); v = mean(e*e) - m1*m1           # Var
if v <= 1:  c = m1 - sqrt(1 - v); f_i = e_i - c          # additive (preferred)
else:       c = 0;               f_i = e_i / sqrt(mean(e*e))   # multiplicative fallback
# assert all f_i > 0;  area = π·baseR² exactly

# 4. POINTS
x_i = baseR * f_i * cos(θ_i);  y_i = baseR * f_i * sin(θ_i)

# 5. AREA-PRESERVING ELLIPSE as COORDINATE SQUEEZE (motion-prolate × accel-squash)
k = (1 + elong*speedNorm) * (1 + squashGain*aHat)         # along heading φ
# rotate into heading frame, squeeze, rotate back:
xr =  cosφ*x_i + sinφ*y_i;  yr = -sinφ*x_i + cosφ*y_i
xr *= k;  yr /= k                                          # det = 1, area EXACT
x_i = cosφ*xr - sinφ*yr;  y_i = sinφ*xr + cosφ*yr

# 6. SAFETY CLAMP radius to [floor, max]  (should be a no-op given step 2)
```

Acceleration estimate (frame-rate independent):
```text
aMag = |v - vPrev| / dt
aSmooth += (aMag - aSmooth) * (1 - exp(-dt/τ_a))    # τ_a ≈ 0.05–0.15 s
aHat   = clamp(aSmooth / aRef, 0, 1)
```

**Parameter ranges:** `Dmax 0.3–0.5` · `elong 0.10–0.30` · `squashGain 0.10–0.25`
(keeps k≈1.05–1.3) · Catmull–Rom `α=0.5` (centripetal) · smoothing `λ≤0.5` ·
EMA `τ_a 0.05–0.15 s` · `aRef,vRef` tuned in px/s.

---

## Sources
- **Kept:** *Equiareal map* — Wikipedia
  (https://en.wikipedia.org/wiki/Equiareal_map) — gives the squeeze `diag(λ,1/λ)`
  as the canonical area-preserving linear map and the `|det|=|ad−bc|` area-scaling
  rule; the formal basis for the "(k,1/k) ellipse" claim and the bug caveat.
- **Kept:** *Centripetal Catmull–Rom spline* — Wikipedia
  (https://en.wikipedia.org/wiki/Centripetal_Catmull%E2%80%93Rom_spline) — α=0.5
  parameterization, "no cusps/self-intersections," tighter fit; cites Yuksel et al.
  *CAD* 2011 (http://www.cemyuksel.com/research/catmullrom_param/) for overshoot
  behavior across α. Includes ready Python/C# implementations.
- **Kept:** *Squash and stretch* — Wikipedia
  (https://en.wikipedia.org/wiki/Squash_and_stretch) — the "maintain overall
  volume" constraint (Thomas & Johnston, *The Illusion of Life*) underpinning the
  volume-conserving stretch rule.
- **Dropped:** generic SEO tutorials / blog posts — excluded; the math above is
  derivable from primary sources and basic calculus, no commentary needed.

## Gaps
- **Could not run `web_search`** (all providers down — see top note). The
  following would benefit from a fetched primary citation rather than derivation:
  1. Physically-based squash-and-stretch gain mappings from accel (e.g. game-dev /
     SIGGRAPH course notes giving typical `squashGain`/`aRef` numbers).
  2. Peer-reviewed cell-mechanics "area/volume constraint" forms (Cellular Potts
     model area-elasticity `λ(A−A₀)²`, vertex models, phase-field membranes) to
     cross-check the soft-constraint vs hard-projection choice.
  3. Trigonometric/DFT periodic interpolation overshoot bounds (Gibbs) for the
     32-bin spectrum reconstruction.
- **Suggested next steps:** top up Exa **or** set a Perplexity key **or** enable
  the Gemini API for project 604892668232, then re-run:
  `["Cellular Potts model area constraint energy lambda biologically plausible",
    "physically based squash stretch acceleration game animation gain",
    "trigonometric interpolation periodic overshoot band-limited"]`.
- **Action item independent of search:** implement the C2 ellipse as a coordinate
  squeeze (not a fixed-angle radial multiply) and add a shoelace test at k=1.25 to
  catch the area-inflation regression; add the `Var(e)≤1` guard to C1.
