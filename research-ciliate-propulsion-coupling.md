# Research: Quantitative coupling between ciliary beating and whole-cell swimming (for the `cell` visualizer)

> Sources & tools per claim are tagged inline:
> **[G&J]** = `fetch_content` Guirao & Joanny 2007 (PMC1861806);
> **[MS]** = `fetch_content` Wikipedia *Microswimmer*;
> **[MR]** = `fetch_content` Wikipedia *Metachronal rhythm*;
> **[SF]** = `fetch_content` Wikipedia *Stokes flow* (core physics drawn from MS, which embeds the Stokes equation);
> **[code]** = `read` of `src/theme-engine/renderers/cell.ts`;
> **[derived]** = my synthesis/algebra from the above. Not separately sourced.

## Summary

For a ciliate at Reynolds number Re≈10⁻⁴ the fluid obeys the **time-independent Stokes equation**, so whole-cell swim speed `U` is **instantaneously slaved to the cilia motion**: stop beating → `U→0` within ~1 µs (no coasting), beat faster → `U` rises **linearly with beat frequency** **[MS]**. The single physically-honest "louder voice" story is therefore: **audio → activity `a` → beat frequency `f` (linear) → swim speed `U` (linear in `f`)**, with beat amplitude, body elongation and cilia length as **mild secondary** responses. Per-cilium thrust scales as `f·(ξ⊥−ξ‖)·𝒜` (linear in `f`, linear in tip amplitude 𝒜) **[G&J]**; the envelope/squirmer view gives whole-cell `U ∝ f·A²·N/R` where the viscosity μ cancels in the force balance **[derived]**. Metachronal coordination's *quantified* benefits in the primary source are: lower ATP/oscillation threshold, **higher** beat frequency, and a far **steadier** (less oscillatory) flow — the direct energetic gain is "rather small" **[G&J]**.

The current code **breaks every link of this chain**: `ciliaBeatHz` is a fixed constant, swim speed (`wanderStep`) is a fixed function of window size, and energy/growth drive only cilia *length* — never beat frequency or swim speed **[code]**.

---

## Findings

### 1. PROPULSION LAW — U(f, A, N)

1. **Per-cilium average thrust is linear in frequency and in tip amplitude.** Guirao & Joanny replace each beating cilium by a time-averaged point force (stokeslet) `f` parallel to the surface, and derive (their α / force estimate, Appendix I) that the effective hydrodynamic force obeys `f ∝ (ξ⊥ − ξ‖)·𝒜·ω`, where `ξ⊥, ξ‖` are the perpendicular/parallel drag coefficients per unit length, `𝒜` is the tip-movement amplitude and `ω = 2πf` the beat angular frequency. They state explicitly: *"Increasing the amplitude 𝒜 or the frequency ω of the beating favors..."* and `α ≈ ξ⊥·𝒜²`, with the force `∝ (ξ⊥−ξ‖)`. **The asymmetry `ξ⊥ ≠ ξ‖` (drag larger broadside than edgewise) is the entire origin of net thrust** — a symmetric beat produces zero average force. **[G&J]**

2. **Whole-cell force balance → usable U(f, A, N).** At Re≪1 the cell is force-free: total cilia thrust = body drag. Body drag on a prolate cell of size `R` is `F_drag = C_body·μ·R·U` (Stokes drag, `F_sphere = 6πμrU`) **[MS]**. Total thrust from `N` aligned active cilia each contributing `f ∝ μ·𝒜·ω·g` (with `g` the asymmetry/shape factor `∝(ξ⊥−ξ‖)/ξ⊥`, and `ξ ∝ μ`): `F_thrust ≈ N·k·μ·𝒜·ω·g`. Equate and **μ cancels**:

   ```
   U  ≈  K · N · f · 𝒜² · g / R              [derived from G&J force + MS Stokes drag]
   ```

   - `f`  beat frequency (Hz) — **U linear in f** (the dominant, cleanest knob).
   - `𝒜`  tip stroke amplitude. One power of 𝒜 is the per-cilium velocity `𝒜·ω`; the second comes from the swept-area asymmetry that converts oscillation into net drift (squirmer/envelope models give `U ∝ (amplitude)²`). So the envelope guess `U ∝ f·amplitude²` in the task prompt is **correct** **[derived]**.
   - `N`  number of *aligned, coordinated* cilia — thrust is additive only when beating directions align (uncoordinated → cancels, see Finding 4) **[G&J]**.
   - `R`  body radius (drag). Larger body ⇒ slower for the same crown.
   - `g`  asymmetry/efficiency factor (power-vs-recovery stroke difference); `g=0` for symmetric beat ⇒ `U=0`.
   - `K`  O(1) geometric constant.

3. **Real ciliate calibration.** *Paramecium*: ~4000 cilia, beat frequency ~30 Hz in water, swims ~1 mm/s ≈ **10 body-lengths/s** **[G&J intro]**. *Tetrahymena* >500 µm/s, *Chlamydomonas* 150 µm/s (2 flagella) **[MS table]**. Re for these is 10⁻⁴–10⁻² **[MS]**. Cilium length ≈ 10–12 µm; *Paramecium* cilium `L=12 µm` used in G&J's numerics; effective stroke 9 ms, recovery 26 ms ⇒ **power:recovery ≈ 1:2.9** **[G&J]**.

### 2. COORDINATION — metachrony vs synchrony

4. **What the primary source *quantifies*.** Guirao & Joanny show metachronal coordination (constant phase lag φ between neighbours) emerges from hydrodynamic coupling as a local minimum of the oscillation threshold Ω_c, and its concrete effects are: (a) **lowers the ATP/oscillation threshold** so cilia can beat at lower drive; (b) **increases the critical beat frequency f_c** vs an isolated cilium; (c) produces a **"rather stationary flow"** — the *oscillating* component of the velocity is far smaller with metachrony. They state the oscillating velocity amplitude `g(φ)` is "much smaller when metachronism exists" than when all cilia beat in synchrony, and conclude **"the energetic gain being rather small"** — the major advantage is flow *steadiness*, not raw thrust. **[G&J]**

5. **Magnitude numbers.** Metachronal wavelength λ ≈ 5 cilia (G&J model) to 7 cilia (Machemer 1972 experiment), i.e. phase lag φ giving `λ ≈ 4.2d` **[G&J]**. Synchronous beating gives a strongly *pulsatile* flow (large oscillating component `g≈g(0)`, the maximum); metachrony drives that oscillating component toward zero (steady swim). **A clean "thrust multiplier vs uncoordinated" single number is NOT given by this source** — the paper's framing is threshold/frequency/steadiness, and explicitly "small" direct energetic gain. Larger multiplicative transport gains (often quoted as up to ~an order of magnitude) come from later simulation literature (Gueron & Levit-Gurevich 1999, ref 50 in G&J) and are **[needs verification]** here. For the visualizer, treat metachrony as: **enables a higher sustainable `f` + makes `U` steady (low ripple)**, a ~10–30% effective-thrust framing is defensible; do not assert a large factor without the sim source. **[G&J + derived]**

### 3. STOPPING & LINEARITY — Stokes regime

6. **Stop is instantaneous (no coasting).** The Stokes equation `μ∇²u − ∇p = 0` has **no explicit time dependence** **[MS/SF]**. Purcell: inertial coasting time of a micron object is ~1 µs and the coasting distance ~0.1 Å — negligible vs body size **[MS]**. Therefore when cilia stop, `U→0` essentially within the same frame. The code already respects this: `wanderStep` recomputes velocity from heading every frame with **no `v += a·dt` integration**, so there is no momentum/coasting (plan Phase F5 confirms this is correct) **[code]**.

7. **Speed scales ~linearly with beat rate; rate-invariance of *pattern*.** Stokes linearity: *"changing the rate of motion will change the scale of the velocities of the fluid and of the microswimmer, but it will not change the pattern of fluid flow"* **[MS]**. So doubling beat frequency doubles `U` (linear), while the *shape* of the stroke is unchanged. This validates `U ∝ f` exactly. Reversing the beat reverses `U` (ciliary reversal in *Paramecium* via Ca²⁺) **[MS, G&J]**.

8. **Scallop theorem caveat (story-level).** Net displacement requires a **non-reciprocal** stroke (the power/recovery asymmetry). A purely symmetric back-and-forth produces zero net swim **[MS]**. The visualizer's asymmetric `ciliaBeatPhase` (fast power, slow recovery) is the right ingredient — but it currently feeds only the *hair shape*, not the body velocity **[code]**.

---

## 4. ENERGY STORY — single coherent mapping for the visualizer

Define one master scalar **activity `a ∈ [0,1]`** as the smoothed driver, then make every visual quantity a deterministic function of `a` so the organism moves as one. **[derived, anchored to G&J linear-f law + MS Stokes linearity]**

**Master activity (reuse existing energy/growth machinery):**
```
a = clamp( w_e·energy + w_g·growth , 0, 1 )      // e.g. w_e=0.6, w_g=0.4
```
`energy` already blends idle + audioLevel·levelGain **[code: cellEnergy]**; `growth` is the slow attack/release accumulator **[code: growthLevel]**. Using both gives a fast component (energy) and a hysteretic body component (growth).

**Couplings (all monotonic in `a`; ranges chosen for the 160×160 overlay):**

| Quantity | Formula | Range (a:0→1) | Physical basis |
|---|---|---|---|
| Beat frequency `f` | `f = f0 + (f1−f0)·a` | 0.6 → 1.6 Hz (artistic; real ~30 Hz) | linear-in-drive, metachrony raises f **[G&J]** |
| Beat amplitude (curl) `A` | `A = A0·(1 + κ_A·a)` | curl 0.7 → ~0.9 (κ_A≈0.3) | 𝒜 rises mildly with drive **[G&J]** |
| Swim speed `U` | `U = U_floor + C·a·(0.5+0.5·A_norm)` ⇒ **U ∝ f·A²** | ~0.1 → 1.0 (norm.) | force balance `U∝f·𝒜²·N/R` **[derived]** |
| Metachronal tightness | `φ = φ0 + (φ1−φ0)·a` | lag 0.8 → 1.1 rad (λ≈5–7 cilia) | tighter wave at high drive **[G&J]** |
| Body elongation `k` | `k = 1 + elong·max(U_norm, drift_floor)` | 1.0 → ~1.15 | prolate ciliate, mild & near-fixed **[plan D4]** |
| Cilia length `L` | `L = baseR·(ciliaLen + growth·boost)·(0.55+0.45·a)` | as today | length tracks growth (slow) **[code]** |
| Nucleus/contractile pulse | `r_pulse = r0·(1 + p·a)` | small | cosmetic; not propulsive |

**The single invariant that ties it together (the "one organism" law):**
```
U_norm  = a · A_norm                 // speed = activity × normalized amplitude  (U ∝ f·A²)
f       = lerp(f0, f1, a)            // beat frequency linear in activity
wanderSpeed_px = U_norm · U_max_px   // body velocity DRIVEN BY the same U_norm
ciliaBeatHz    = f                   // crown beats at the SAME f that sets U
```
So: **louder → `a`↑ → `f`↑ (beat faster) → `U`↑ (swim faster, linearly) → mild elongation↑ → mild amplitude/length↑**, and when audio stops, `a→0`, `f→f0`, `U→U_floor≈0` *in the same frame* (Stokes, no coasting). Every part is a pure function of one `a`. **[derived]**

**Parameter notes:**
- Keep `f` an artistic ~30× slow-down of real 30 Hz (plan already labels `ciliaBeatHz 0.9` as artistic) **[plan]**.
- `U ∝ f·A²` but since `A` only varies ~30%, in practice **`U` is dominated by `f` and reads as linear in `a`** — which is exactly the Stokes prediction and the easiest "louder=faster" story. Don't over-couple amplitude; the second power of A is a gentle garnish.
- `U_floor` ≈ a few % so an idle cell still drifts gently (biological resting beat), not frozen.

---

## 5. WHERE THE CURRENT CODE BREAKS THE COUPLING  **[code]**

| # | Breakage | Location | Why it's wrong |
|---|---|---|---|
| B1 | **Beat frequency is a hard constant.** `ciliaBeatHz ?? 0.9` is never a function of energy/audio. | `ciliaBeatPhase` (cell.ts ~409); `CELL_DEFAULTS.ciliaBeatHz=0.9` | "Louder" never makes the crown beat faster. Breaks `f∝a`, the primary knob. |
| B2 | **Swim speed decoupled from cilia.** `speed = (driftSpeed??0.03)·min(w,h)·1.2` — a constant set by window size, independent of beat freq/energy. | `wanderStep` (cell.ts ~1057) | Body velocity has no link to `U∝f·A²`. The cell roams at the same pace whether silent or shouting. Violates the Stokes slaving `U∝f`. |
| B3 | **Growth drives length only, not beat or speed.** `lenMean = baseR·(ciliaLength + growth·boost)·(0.55+0.45·energy)`. | `ciliaPath` (cell.ts ~497) | Activity changes hair *length* and a little liveliness, but neither beat frequency nor propulsion. Length is the *weakest* physical lever; frequency is the strongest and is ignored. |
| B4 | **Amplitude (curl) is fixed.** `ciliaCurl` is a constant param; `amp = curl·lenK·0.6·…` has no `a`/energy term. | `ciliaPath` (cell.ts ~525) | `𝒜` should rise with drive (`f·𝒜²` thrust). Currently only length scales, so the `A²` term is dead. |
| B5 | **No propulsion link at all.** Nothing computes `U` from `f`. `wanderStep` and `ciliaPath` are independent subsystems; cilia beat "in place" and the body drifts on an unrelated noise walk. | whole renderer tick | The entire `audio→f→U` chain is absent. Metachronal phase exists (`ciliaMetachronal`) but feeds only hair rendering, never thrust/steadiness. |

**Secondary:** the per-hair beat is in each hair's *local* azimuth (`pxn=(-uy,ux)`) so strokes point every which way and cancel — no shared stroke axis means no net thrust direction even conceptually (plan F4 flags this). Aligning the crown to one axis is a prerequisite before `N·f·𝒜²` thrust is meaningful. **[code + plan]**

---

## TDD assertions (for the new energy/propulsion-coupling phase)

Pure-function tests (deterministic, no RNG/Date):

```
// A. Activity master is monotone & bounded
assert activity(audio=0, growth=0) ≈ idle_floor
assert activity is non-decreasing in audioLevel and in growth
assert 0 ≤ activity ≤ 1 for all inputs

// B. Beat frequency rises with activity (B1 fix)
f_lo = beatHz(a=0); f_hi = beatHz(a=1)
assert f_hi > f_lo                          // louder => faster beat
assert beatHz monotone non-decreasing in a
assert beatHz(a=0) ≈ f0 (resting, > 0)      // never freezes

// C. Swim speed slaved to beat (B2/B5 fix) — U ∝ f, linear
U0 = swimSpeed(a=0); U1 = swimSpeed(a=1)
assert U1 > U0
assert swimSpeed monotone in a
assert |swimSpeed(2a)/swimSpeed(a) − 2| small for a in linear band   // linear-in-f (Stokes) [MS]
assert swimSpeed(a=0) ≤ small_floor          // STOP: U→0 when silent, same frame (no coast) [MS]

// D. One-organism consistency: same activity drives both
assert sign(d wanderSpeed/d a) == sign(d ciliaBeatHz/d a)   // move together
assert wanderSpeed == U_norm(a)·U_max  (within tol)         // body speed IS the propulsion law

// E. Amplitude couples mildly (B4 fix), U has the A² garnish
assert curlEffective(a=1) > curlEffective(a=0)
assert swimSpeed includes amplitude factor: dU/dA > 0

// F. No coasting / Stokes (regression guard on existing correct behaviour)
assert wanderStep has no velocity integration term (v recomputed from heading each frame) [code F5]

// G. Elongation mild & area-preserving, tracks speed not amplitude
assert 1.0 ≤ k_elong(a) ≤ 1.15
assert area(contour) preserved under elongation (affine squeeze, det=1) [plan C2]

// H. Metachrony tightens with activity but stays in biological band
assert metachronalLag(a=1) ≥ metachronalLag(a=0)
assert λ in [4d, 8d]  (≈ 5–7 cilia) [G&J/Machemer]
```

---

## Sources

**Kept:**
- **Guirao & Joanny 2007, *Biophys. J.* (PMC1861806)** — primary source for per-cilium thrust `f∝(ξ⊥−ξ‖)·𝒜·ω`, asymmetry-as-thrust-origin, metachrony lowering threshold / raising f / steadying flow, λ≈5 cilia, ES 9ms : RS 26ms, Paramecium 4000 cilia / 30 Hz / 1 mm/s. The quantitative backbone.
- **Wikipedia *Microswimmer*** — Stokes equation time-independence, Re≈10⁻⁴, ~1µs/0.1Å coasting (instant stop), rate-changes-scale-not-pattern (U∝f linearity), Stokes drag `6πμrU`, scallop theorem (non-reciprocity needed), ciliate speed table (Tetrahymena, Chlamydomonas).
- **Wikipedia *Stokes flow* / *Metachronal rhythm*** — corroborating low-Re linearity and metachronal-wave definition (symplectic/antiplectic). Core numbers came via Microswimmer + G&J.
- **`src/theme-engine/renderers/cell.ts`** — current implementation; basis for the 5 breakage findings.
- **`.pi/plans/cell-bio-accuracy-plan.md`** — existing model decisions (D4 elongation, F4 shared stroke axis, F5 no-coast, C2 affine area-preservation) that the new phase must stay consistent with.

**Dropped:**
- The hundreds of Microswimmer references on *synthetic/biohybrid* microrobots (magnetic/catalytic/acoustic propulsion) — irrelevant to a biological ciliate's beat→swim coupling.
- Gueron & Levit-Gurevich 1999 energetic-gain simulation (cited only second-hand in G&J) — would be the source for a *large* metachronal transport multiplier, but not fetched here.

## Gaps

1. **Exact metachronal thrust multiplier vs uncoordinated.** The primary source quantifies threshold/frequency/steadiness and calls the direct energetic gain "small"; it does **not** give a clean "synchrony→metachrony" thrust factor. A larger transport multiplier (~order of magnitude, sometimes quoted) needs Gueron & Levit-Gurevich 1999 (PNAS 96:12240) or Elgeti/Gompper reviews — **[needs verification]**. For the visualizer, model metachrony as "higher sustainable f + steady (low-ripple) U", which is fully supported.
2. **Amplitude exponent.** `U ∝ 𝒜²` is the standard envelope/squirmer scaling and matches the prompt, but G&J's small-amplitude theory only derives thrust `∝ 𝒜` (force) explicitly; the second power comes from area-asymmetry / Taylor-sheet (`U∝(kb)²`) arguments not fully fetched. Safe for a stylized mapping; flag if exact exponent matters.
3. **Absolute calibration of `U_max_px`.** No source ties beat-Hz to on-screen px/s for a 160×160 overlay — this is an artistic tuning constant; pick so the cell crosses the tank in a few seconds at full activity.

**Suggested next steps:** (a) write the `activity → {f, U, A, k, φ}` pure module + the TDD assertions above, gated OFF by default per the plan's commit discipline; (b) wire `wanderStep` speed to `U_norm(a)` and `ciliaBeatHz` to `f(a)` in the same commit so the chain lands atomically; (c) if a metachronal thrust multiplier is wanted, fetch Gueron & Levit-Gurevich 1999 to source the number.
