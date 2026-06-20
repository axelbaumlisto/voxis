# Research: Biophysics of a Beating Cilium/Flagellum for a Real-Time 2D Renderer

Scope: full pass on the "усики"/vibrissae (cilia/flagella) of the `cell`
renderer — geometry, structure, direction, inertia, speed — checked against
`src/theme-engine/renderers/cell.ts` (`ciliaPath`, `ciliaBeatPhase`,
`ciliaEndpoints`).

**Tooling note (per task):** web_search providers were down. All external
claims come from `fetch_content` on PRIMARY sources:
- Guirao & Joanny 2007, *Biophys. J.* — `pmc.ncbi.nlm.nih.gov/articles/PMC1861806/`
- Wikipedia *Cilium*, *Flagellum*, *Axoneme* (each fetched; cited inline).
- Wikipedia *Elastica (mathematics)* **does not exist** under that title
  (fetch returned a "no such article" page) — the Euler-elastica / travelling-
  curvature-wave math below is therefore a hand-derivation from standard
  elasticity + slender-body theory and is tagged **[derived]**.
- Numerical estimates (Reynolds number, inertial and elastohydrodynamic
  timescales) are tagged **[derived]** with the input numbers shown.

Each topic ends with VERIFIED / NEEDS-CORRECTION, a corrected formula + ranges +
citation, and a TDD-able assertion.

---

## Summary

A beating cilium is a **clamped-base, free-tip elastic rod** (9+2 axoneme,
~0.2 µm diameter, ~10 µm long) whose live shape is a **base→tip travelling
curvature wave**, not a fixed circular arc and not a static Euler elastica
(the instantaneous *recovery* shape merely *resembles* an elastica). Its motion
is **overdamped** at Reynolds number ~10⁻⁴–10⁻²: inertia is negligible by ~7
orders of magnitude, so there is **no ballistic overshoot** — when the motor
stops the rod relaxes (does not ring) on an elastohydrodynamic timescale of
~0.1–1 ms, far shorter than the ~33 ms beat period. The beat is **asymmetric
and two-phase**: a fast, near-straight **power stroke** (~9 ms) and a slow,
strongly-curved **recovery stroke** (~26 ms), ≈1:2.9, at ~30 Hz, propelling
fluid at ~1 mm/s. The current renderer gets the *asymmetric two-phase clock*
and the *clamped base* roughly right, but **(a)** puts maximum bend at the free
tip (curvature should vanish there), **(b)** gives every hair its own local
azimuthal beat plane instead of a shared global stroke direction, and **(c)**
uses an asymmetry constant (0.6 → 1:4) instead of the biological ~0.49 (1:2.9).
No part of the renderer wrongly implies inertia — kinematic position-of-time is
the correct model for an overdamped system.

---

## Findings

### TOPIC 1 — GEOMETRY (shape, curvature(s,t), tip envelope, L/diameter/taper)

1. **The live spine is a travelling curvature wave, not a circular arc and not
   a static elastica.** Eukaryotic cilia/flagella bend because dynein drives
   sliding between doublets that is converted to bending by the nexin
   constraint; "this sliding motion induces the bending of the cilium and its
   beating," and the bend **propagates** base→tip.
   [Guirao & Joanny 2007](https://pmc.ncbi.nlm.nih.gov/articles/PMC1861806/),
   [Cilium (Wikipedia)](https://en.wikipedia.org/wiki/Cilium). Flagellar motion
   is "often planar and wave-like"; cilia perform "a more complicated
   three-dimensional motion with a power and recovery stroke."
   [Flagellum (Wikipedia)](https://en.wikipedia.org/wiki/Flagellum).

2. **Curvature function (canonical model)** — the standard kinematic description
   is a **propagating curvature wave** [derived, from slender-body/flagellar
   waveform theory]:
   ```
   κ(s,t) = κ0(s) + A(s)·sin(2π( s/λ − f·t ))
   ```
   where `s` = arclength from base, `λ` = wavelength, `f` = beat frequency,
   `A(s)` the local curvature amplitude. For **flagella** ~1–2 wavelengths fit
   along the filament (snake-like). For **cilia** the beat is *oar-like and
   asymmetric*: the curvature is **low during the power stroke** (the rod is
   near-straight, like a rigid oar) and **concentrated into a single
   propagating bend during the recovery stroke** (a C-shape rolling base→tip).
   That instantaneous recovery shape *resembles an Euler elastica* (the
   minimum-bending-energy shape of an end-loaded inextensible rod, governed by
   the pendulum equation `EI·θ''(s) = −F·sinθ(s)`), but the cilium is **not**
   statically sitting in an elastica — it is being actively driven, so use the
   travelling-wave `κ(s,t)` above for animation. **[derived]**

3. **Boundary conditions fix where curvature lives** (this is the single most
   important geometric constraint for rendering) **[derived from clamped-free
   beam theory; structure cited below in Topic 2]:**
   - **Base = clamped:** position fixed AND tangent angle fixed →
     `displacement(0)=0`, `θ(0)=θ0`. The hair leaves the membrane at a fixed
     emergence angle.
   - **Tip = free:** zero bending moment → **`κ(L,t)=0`**, and zero shear →
     `κ'(L,t)=0`. **Curvature must vanish at the free tip.** Peak curvature sits
     in the proximal/middle region, never at the very tip.

4. **Tip trajectory is an asymmetric loop, not a circle or symmetric figure-8.**
   "The fluid is efficiently propelled during the effective stroke. During the
   recovery stroke, the cilium comes back close to the surface, minimizing the
   viscous effects." The tip swings out in a tall wide arc (power) and returns
   low and close to the cell surface (recovery) — an asymmetric crescent/loop.
   [Guirao & Joanny 2007, Fig. 1a](https://pmc.ncbi.nlm.nih.gov/articles/PMC1861806/).

5. **Dimensions: L, diameter, taper.** Axoneme radius ≈ **0.1 µm** (diameter
   ~0.2 µm). Cilia are ~**10 µm** long; flagella up to ~100× longer (50–150 µm).
   [Guirao & Joanny 2007](https://pmc.ncbi.nlm.nih.gov/articles/PMC1861806/);
   "Cilia can be between one and five micrometers" (motile respiratory) up to
   5–10 µm, [Cilium (Wikipedia)](https://en.wikipedia.org/wiki/Cilium);
   "basal body … about 500 nanometers long,"
   [Flagellum (Wikipedia)](https://en.wikipedia.org/wiki/Flagellum). The
   axoneme is a **constant-diameter** bundle (9+2) along essentially its whole
   length — **little to no taper** until the extreme distal tip where the
   central pair terminates. Aspect ratio L/d ≈ 50 (very slender). So a
   near-constant-width stroke is *more* accurate than a strong base→tip taper.

**VERDICT — GEOMETRY: NEEDS-CORRECTION.**
Current `ciliaPath` bend amplitude is
`amp = curl·lenK·0.6·pow(sFrac,1.2)·(0.4+0.6·recovery)` — it **grows toward the
tip** and combines a travelling `sin(2π(1.1·sFrac − phase))` with a uniform
`beat·0.3` term. Two problems:
- **Max bend/curvature lands at the free tip**, violating `κ(L)=0`. The tip
  should be the *straightest* part.
- The uniform `beat·0.3` adds curvature everywhere (no spatial structure).

**Corrected amplitude envelope** so curvature is anchored at base AND vanishes
at the tip — a smooth interior-peaked window, e.g. `W(s)=sFrac·(1−sFrac)` (or
`sin(π·sFrac)`):
```
// position still anchored at base; CURVATURE peaks mid-span and → 0 at tip
amp(sFrac) = curl · lenK · k · sin(Math.PI * sFrac) · (0.4 + 0.6*recovery)
bend       = amp(sFrac) * Math.sin(TAU * (waves*sFrac - phase))   // drop uniform beat term
// waves ≈ 0.6–1.0 for an oar-like cilium (<1 full wave in recovery)
```
Parameter ranges: `L = 5–10 µm` (cilium), diameter `0.2 µm` (≈constant), L/d≈50,
~1 propagating bend, `waves≈0.6–1.1`.

**TDD assertion (geometry):**
```
// Tip is the straightest point: discrete curvature at the last spine vertex
// must be ≤ curvature at the mid vertex, for any t, any hair.
const curv = (a,b,c) => Math.abs(angleBetween(b-a, c-b));
expect(curv(p[n-2],p[n-1],p[n])).toBeLessThanOrEqual(curv(p[mid-1],p[mid],p[mid+1]) + 1e-9);
// Base displacement anchored:
expect(dist(p[0], membranePoint)).toBeLessThan(0.05*baseR);
```

---

### TOPIC 2 — STRUCTURE (9+2 axoneme, base anchoring → boundary conditions)

6. **9+2 axoneme.** Motile cilia/flagella have "nine sets of doublet
   microtubules … in a ring around a central pair of singlet microtubules …
   a 9+2 axoneme," conferring mechanical strength; dynein arms walk on adjacent
   doublets, nexin links convert sliding to bending.
   [Axoneme (Wikipedia)](https://en.wikipedia.org/wiki/Axoneme),
   [Cilium (Wikipedia)](https://en.wikipedia.org/wiki/Cilium). (Non-motile
   primary cilia are 9+0 and don't beat — not our case.)

7. **Base anchoring = a true clamp.** "The cilium/flagellum is attached to the
   cell membrane by a **basal body** … attached … by **anchoring fibers**." The
   **striated rootlet** sinks into the cytoplasm and the **basal foot** points
   in the effective-stroke direction, defining the beat orientation *before*
   motion. [Guirao & Joanny 2007](https://pmc.ncbi.nlm.nih.gov/articles/PMC1861806/);
   rootlets "80–100 nm in diameter … cross striae … 55–70 nm,"
   [Cilium (Wikipedia)](https://en.wikipedia.org/wiki/Cilium). Physically this
   is a **clamped (fixed-position, fixed-tangent) boundary** at the base; the
   distal end is **free**. → `θ(0)` fixed, `κ(L)=0` (Topic 1, finding 3).

**VERDICT — STRUCTURE: PARTIALLY VERIFIED.** The renderer correctly anchors
**position** at the base (`pow(sFrac,1.2)` and the wave both →0 as sFrac→0, and
the spine starts on the membrane radius). It does **not** enforce a fixed
emergence tangent (the hair can leave at a wandering angle) nor `κ(L)=0` (see
Topic 1). The clamp *position* is fine; the clamp *tangent* and free-tip
*zero-curvature* are missing.

**Corrected boundary handling:** (i) emit the first two spine points along a
fixed radial (or fixed basal-foot) direction so the base tangent is clamped;
(ii) use the interior-peaked window from Topic 1 so curvature → 0 at the tip.

**TDD assertion (structure):**
```
// Clamped base tangent: angle of (p[1]-p[0]) stays within a tight band of the
// rest emergence angle across the whole beat cycle.
for (const t of sampleCycle) {
  const emerge = atan2(p[1].y-p[0].y, p[1].x-p[0].x);
  expect(angularDist(emerge, baseAngle)).toBeLessThan(0.2); // radians
}
```

---

### TOPIC 3 — DIRECTION (beat plane, power vs recovery 3-D-ness, pointing)

8. **Each cilium has one beat plane, and an array shares ONE global stroke
   direction.** "All cilia … beat in the same direction: the surrounding fluid
   can only be propelled efficiently if all the beatings have the same
   orientation." The beat plane angle `φ_i` is set by the basal foot; mature
   arrays align. [Guirao & Joanny 2007](https://pmc.ncbi.nlm.nih.gov/articles/PMC1861806/).

9. **Planar vs 3-D.** Beating "is three-dimensional [for *Paramecium*] but for
   some species like *Opalina* or *Chlamydomonas* it remains essentially
   planar." In *Paramecium* "the recovery stroke is not in the plane of the
   effective stroke." [Guirao & Joanny 2007](https://pmc.ncbi.nlm.nih.gov/articles/PMC1861806/).
   For a **2-D renderer the correct simplification is a single planar beat
   plane with an asymmetric in-plane stroke** (the *Opalina*/planar case); the
   3-D recovery is an out-of-plane detail not representable in 2-D.

10. **At rest the hair points along the membrane normal (radially out)** from
    its clamped base, and through the beat it sweeps **within its beat plane**
    about that rest direction — the power stroke sweeping toward the global
    effective-stroke direction, the recovery folding back low over the surface.
    [Guirao & Joanny 2007](https://pmc.ncbi.nlm.nih.gov/articles/PMC1861806/).

**VERDICT — DIRECTION: NEEDS-CORRECTION.** Current `ciliaPath` beats each hair
in its **own local azimuthal frame** `pxn=(-uy, ux)` — i.e. every hair sways
around its own radius with no shared stroke direction. Crown therefore looks
like independent twitching, not coordinated propulsion. (The plan's **D2**
drag-lean toward `−headingV` and **D3** metachronal wave on the motion axis are
exactly the fix; this report confirms they are biologically warranted: a shared
global stroke direction is required for propulsion.)

**Corrected direction model:** bias every hair's stroke toward a single global
axis `ŝ` (the cell's effective-stroke/anti-travel direction), modulating its
per-hair plane only by metachronal phase, instead of an independent local
azimuth.

**TDD assertion (direction):**
```
// At a fixed beat phase, the population of tip-displacement vectors must have a
// dominant shared direction (resultant length high), not cancel out.
const disp = hairs.map(h => sub(tip(h), base(h)));
const R = norm(mean(disp)) / mean(disp.map(norm)); // mean resultant length
expect(R).toBeGreaterThan(0.4); // shared stroke axis, not isotropic twitch
```

---

### TOPIC 4 — INERTIA (low Re, overdamped, relaxation timescale)

11. **Low Reynolds number — confirmed and quantified.** Microswimmers "operate
    at a low Reynolds number, where the viscosity of the surrounding water is
    much more important than its mass or inertia."
    [Flagellum (Wikipedia)](https://en.wikipedia.org/wiki/Flagellum) (citing
    Purcell, *Life at Low Reynolds Number*, AJP 1977 — listed in that article's
    references).
    **[derived] numbers** (water: ρ=1000 kg/m³, μ=1e-3 Pa·s):
    - Cilium tip speed `U ≈ amplitude·2πf ≈ (1e-5 m)(2π·30 Hz) ≈ 2 mm/s`.
    - On cilium **diameter** `d=0.2 µm`:
      `Re = ρUd/μ = 1000·2e-3·2e-7/1e-3 ≈ 4×10⁻⁴`.
    - On cilium **length** `L=10 µm`: `Re ≈ 2×10⁻²`.
    - Whole *Paramecium* (L≈200 µm, U≈1 mm/s): `Re ≈ 0.2`.
    So the task's `Re ~ 1e-4` is right at the cilium-diameter scale; **Re ≪ 1**
    on every relevant scale → **inertia negligible, viscosity dominates.**

12. **No ballistic overshoot — motion is overdamped. [derived]** Compare the
    *inertial* relaxation time `τ_in = m/γ` to the beat period:
    - cilium mass `m = ρ·πr²L ≈ 1000·π(1e-7)²(1e-5) ≈ 3×10⁻¹⁶ kg`;
    - transverse drag/length `ξ⊥ ≈ 4πμ/ln(L/r) ≈ 4π·1e-3/ln(100) ≈ 2.7×10⁻³`
      kg·m⁻¹s⁻¹; total `γ ≈ ξ⊥L ≈ 2.7×10⁻⁸ kg/s`;
    - `τ_in = m/γ ≈ 3e-16/2.7e-8 ≈ 1×10⁻⁸ s` (10 ns).
    Beat period ≈ 33 ms, so `τ_in/T ≈ 3×10⁻⁷` — inertia is **~7 orders of
    magnitude** below relevance. The filament cannot coast; when forcing stops
    it does not ring or overshoot.

13. **The meaningful timescale is elastohydrodynamic (elastic restoring vs
    drag), not inertial. [derived]** For a clamped-free rod of bending
    stiffness `κ_B = EI` the fundamental passive relaxation time is
    `τ_relax = ξ⊥·L⁴ / (κ_B·a₁⁴)` with `a₁≈1.875` (clamped-free) — order
    `ξ⊥L⁴/(κ_B π⁴)`:
    - axonemal `EI ≈ 1×10⁻²¹ N·m²` (literature range ~4e-22–2e-21);
    - `τ_relax ≈ 2.7e-3·(1e-5)⁴ / (1e-21·97) ≈ 2.8×10⁻⁴ s ≈ 0.3 ms`.
    Range **~0.1–1 ms**, an order or two **shorter** than the 33 ms beat
    period → the rod follows the motor quasi-statically and relaxes smoothly
    (overdamped, no oscillatory recoil).

**VERDICT — INERTIA: VERIFIED (renderer does NOT wrongly imply inertia).**
`ciliaPath`/`ciliaBeatPhase`/`ciliaEndpoints` are pure **kinematic functions of
time** (position = f(t)); there is no velocity/acceleration integrator on the
hairs, hence no spurious momentum or overshoot — which is the *correct* model
for an overdamped Re≪1 filament. `startleOffset` returns via exponential decay
`max(decayed, edge)` (monotone relaxation, no overshoot) and `wanderStep` is a
heading random-walk (no translational momentum). **One caution for future work:**
the plan's optional **D5 acceleration-squash** would introduce an
inertia-*looking* effect (body deforming from `aMag=|Δv|/dt`); that is explicitly
labelled *artistic, non-biological* in the plan and must stay that way — a real
cell at Re≪1 has no inertial squash.

**TDD assertion (inertia / overdamping):**
```
// After forcing is frozen, hair geometry must RELAX MONOTONICALLY toward rest
// (no overshoot/ringing). Freeze phase, step a decaying envelope, check the
// max tip-offset sequence is non-increasing.
let prev = Infinity;
for (const tipOff of relaxationSequence) { expect(tipOff).toBeLessThanOrEqual(prev + 1e-9); prev = tipOff; }
```

---

### TOPIC 5 — SPEED (frequency, power:recovery ratio, tip speed, propulsion)

14. **Beat frequency ≈ 30 Hz** in water (*Paramecium*).
    [Guirao & Joanny 2007](https://pmc.ncbi.nlm.nih.gov/articles/PMC1861806/).
    Frequency drops as medium viscosity rises (Machemer).

15. **Power:recovery duration ≈ 9 ms : 26 ms = 1 : 2.9** — "the effective
    stroke lasts typically 9 ms whereas the recovery stroke lasts 26 ms."
    [Guirao & Joanny 2007](https://pmc.ncbi.nlm.nih.gov/articles/PMC1861806/).
    The **power stroke is the SHORT, FAST phase**; recovery is the long, slow
    one. (9+26 = 35 ms ⇒ ~28.6 Hz, consistent with finding 14.)

16. **Tip speed: power ≫ recovery.** Same total angular sweep covered in 9 ms
    (power) vs 26 ms (recovery) ⇒ tip moves ~**2.9× faster during the power
    stroke**, and does so far from the wall (high drag, high thrust); recovery
    is slow and hugs the surface (low drag). [Guirao & Joanny 2007, Fig. 1a]
    (https://pmc.ncbi.nlm.nih.gov/articles/PMC1861806/). **[derived]** absolute
    tip speed `U ≈ amplitude·2πf ≈ 1e-5·2π·30 ≈ 2 mm/s` (order of magnitude).

17. **Propulsion velocity ≈ 1 mm/s** — *Paramecium* "produces a very efficient
    motion with a velocity of order 1 mm/s … 10× the *Paramecium* size per
    second." [Guirao & Joanny 2007](https://pmc.ncbi.nlm.nih.gov/articles/PMC1861806/).

**VERDICT — SPEED: PARTIALLY VERIFIED.**
- `ciliaBeatPhase` **correctly** makes the power stroke fast/short and recovery
  slow/long (`powerTime=(1−a)/2` of the period spent in power), and amplitude is
  larger in recovery (more curved) — directionally biological. ✔
- **`ciliaAsymmetry=0.6` gives power:recovery = 0.2:0.8 = 1:4**, snappier than
  the biological **1:2.9**. To match 9:26 use `powerTime = 9/35 = 0.257 ⇒
  a = 1−2·0.257 ≈ 0.49`.
- **`ciliaBeatHz=0.9` is a deliberate ~30–33× artistic slow-down** of the real
  ~30 Hz (33 ms beat would be a strobing blur at overlay scale). Keep, but label
  it artistic, not biological.

**Corrected params:** `ciliaAsymmetry ≈ 0.49` (1:2.9 power:recovery);
`ciliaBeatHz`: real ≈ 30 Hz, render ≈ 0.6–1.2 Hz (artistic); tip should visibly
move faster in the power half than the recovery half.

**TDD assertion (speed):**
```
// Power stroke is the shorter, faster phase: time in phase[0,0.5) < time in [0.5,1)
// and mean tip speed in power > mean tip speed in recovery.
const a = 0.49;
expect((1-a)/2).toBeCloseTo(0.257, 2);                 // 9:26 ratio
expect(meanTipSpeedPower).toBeGreaterThan(meanTipSpeedRecovery);
```

---

## Per-function red-flags in the current code

`ciliaPath` (cell.ts):
- **WRONG:** `amp ∝ pow(sFrac,1.2)` ⇒ bend/curvature **maximal at the free
  tip**; biology requires `κ(L)=0` (free end). Replace with an interior-peaked
  window (`sin(π·sFrac)`). [Topic 1]
- **WRONG (direction):** beats in per-hair local azimuth `pxn=(-uy,ux)`; no
  shared global stroke axis ⇒ no coordinated propulsion. [Topic 3]
- **WEAK:** uniform `beat·0.3` term adds spatially-unstructured curvature; drop
  it and let the travelling wave carry the bend. [Topic 1]
- **PARAM:** `waves=1.1` is fine for flagella, a touch high for an oar-like
  cilium (recovery shows <1 wave). [Topic 1]
- **PARAM:** `ciliaAsymmetry=0.6` ⇒ 1:4, not biological 1:2.9 (use ~0.49).
  [Topic 5]
- **MISSING:** base **tangent** not clamped (only base position). [Topic 2]

`ciliaBeatPhase` (cell.ts):
- **CORRECT in spirit:** fast power / slow recovery via `powerTime=(1−a)/2`. ✔
- **PARAM:** asymmetry default mis-tuned (see above).
- **OK:** metachronal `lag = ciliaMetachronal·index` produces a travelling
  phase — biologically real (metachronal waves), though current on-crown
  orientation is arbitrary; plan D3 ties it to the motion axis. ✔

`ciliaEndpoints` (cell.ts, the older quadratic-Bezier hairs):
- **Single control point ⇒ a single circular-arc-like bow.** A real beating
  cilium is a *travelling curvature wave* with `κ(L)=0`, not a fixed arc. This
  function is the less accurate of the two; prefer `ciliaPath`’s polyline.
  [Topic 1]
- **Taper:** strong base→tip width taper is *less* accurate than a near-constant
  diameter (axoneme is uniform ~0.2 µm). [Topic 1, finding 5]

**Inertia:** no function wrongly implies inertia — kinematic `f(t)` is the
correct overdamped model. Keep the optional D5 accel-squash flagged artistic.
[Topic 4]

---

## Sources

- **Kept: Guirao & Joanny 2007, *Biophys. J.* (PMC1861806)** —
  https://pmc.ncbi.nlm.nih.gov/articles/PMC1861806/ — primary quantitative
  source: 9+2 structure, basal body/rootlet clamp, axoneme r=0.1 µm, L≈10 µm,
  power 9 ms / recovery 26 ms, 30 Hz, v≈1 mm/s, planar vs 3-D beat, shared
  stroke direction, tip-near-surface recovery, drag anisotropy ξ⊥/ξ∥.
- **Kept: Axoneme (Wikipedia)** — https://en.wikipedia.org/wiki/Axoneme —
  9+2 microtubule architecture, dynein sliding→bending, oar-like cilia vs
  snake-like flagella, lengths (cilia 5–10 µm; flagella 50–150 µm).
- **Kept: Cilium (Wikipedia)** — https://en.wikipedia.org/wiki/Cilium —
  dimensions (1–5 µm motile; basal body; rootlet 80–100 nm), motile 9+2 vs
  primary 9+0, metachronal coordination, dynein/nexin bending mechanism.
- **Kept: Flagellum (Wikipedia)** — https://en.wikipedia.org/wiki/Flagellum —
  explicit **low-Reynolds-number** statement (cites Purcell 1977), planar
  wave-like flagella vs 3-D power/recovery cilia, basal body ~500 nm.
- **Dropped: Elastica (mathematics) (Wikipedia)** — article **does not exist**
  under that title; fetch returned the "no such article" page. Euler-elastica
  math reconstructed from standard elasticity theory and tagged [derived].
- **Dropped: bacterial-flagellum sections of the Flagellum article** — rotary
  proton-motor prokaryote mechanism is irrelevant to a eukaryotic ciliated cell.

---

## Gaps

- **Exact axonemal bending stiffness EI** was not in the fetched primary
  sources; I used the widely-cited `EI ≈ 0.4–2 ×10⁻²¹ N·m²`. The
  elastohydrodynamic `τ_relax ≈ 0.1–1 ms` scales as `1/EI`, so a firmer EI would
  tighten that number. *Next step:* fetch Howard, *Mechanics of Motor Proteins
  and the Cytoskeleton*, or Riedel-Kruse/Hilfinger/Howard/Jülicher 2007
  (referenced inside Guirao & Joanny) for measured flagellar `EI` and the
  curvature-wave amplitude `A(s)`.
- **Quantitative tip-loop shape** (the exact crescent) is described
  qualitatively (Fig. 1a) but not parameterized in the fetched text. *Next
  step:* digitize Machemer 1972 or Brokaw waveform traces for an explicit
  tip(x,y) envelope to validate the renderer's loop.
- **Metachronal wavelength** for the on-screen crown: plan cites Guirao λ≈5
  cilia, Machemer λ≈7; I did not independently re-derive the 2-D mapping. The
  plan's D3 default (`ciliaMetachronal≈1.1` rad) sits in-band — acceptable.
- **Curvature reversal at the base** (real axonemes initiate a *new,
  opposite-sign* bend at the base each half-cycle) is a finer effect than the
  single travelling window proposed here; only worth adding if the overlay scale
  ever shows it.
