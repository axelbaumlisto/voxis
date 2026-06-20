# Research: Motion in a Fluid Medium for a Single-Celled Swimmer (Low-Reynolds 2D Visualizer)

Scope: the **fluid-medium physics of motion** for the `cell` renderer
(`src/theme-engine/renderers/cell.ts`) — what a low-Reynolds water swimmer can,
cannot, and should-not do, and how our `wanderStep`, `cellDrift`,
`driftActivation`, `startleOffset`, `cellReach` models hold up.

Tooling note: `web_search` providers were DOWN. All citations are from
`fetch_content` on primary Wikipedia/PMC pages (Scallop theorem, Stokes flow,
Rotational diffusion, Brownian motion, Microswimmer, Chemotaxis). Numeric values
for r=50 µm and r=5 µm are **[derived]** by me from the cited closed-form
formulas (shown with inputs). Where a claim is my own reasoning about our code I
mark it **[derived]**.

---

## Summary

Our cell lives at Reynolds number ~10⁻⁴–10⁻², where **viscosity dominates and
inertia is absent**: velocity is proportional to instantaneous force, there is
**no coasting, no wake, no momentum/history**, and reciprocal (back-and-forth)
deformations produce **zero net displacement** (scallop theorem). Our integrated
`wanderStep` (memoryless `v` recomputed from heading each frame) is *correct* for
this regime; but three behaviours **contradict** fluid-medium physics and should
be fixed or explicitly labelled artistic: (a) the **specular wall bounce** is an
elastic/inertial metaphor, (b) the **startle dart + spring-back** injects
momentum and a restoring "memory", and (c) the **~3 s `driftActivation`
re-centring** reads as inertial coasting. Brownian rotational diffusion is real
but **small for a big cell** (≈0.1°/s RMS at r=50 µm, ≈3°/s at r=5 µm), so a
roaming path is mostly *active* steering — our `wanderTurnRate` is fine as the
active term; an optional tiny Brownian jitter would add realism. A real cell is
near-neutrally buoyant (slow downward sedimentation), so a faint persistent
downward bias is *optional* and must be labelled. The flow field a swimmer drags
around itself (puller/pusher stresslet, decaying ~1/r²) is **entirely missing** —
that is an *enhancement opportunity*, not an error.

---

## Background numbers (used throughout) [derived]

Constants: k_B T ≈ 4.11×10⁻²¹ J at 298 K; water dynamic viscosity
η ≈ 1.0×10⁻³ Pa·s (Brownian motion / Rotational diffusion pages give
η = 8.9×10⁻⁴ at 25 °C — I use 1×10⁻³ for round numbers, within 12%).

**Reynolds number** Re = ρ u l / μ (Scallop theorem; Microswimmer). For a
ciliate u ≈ 0.5–2 mm/s, l ≈ 10–200 µm, ρ=1000, μ=1e-3:
- r=50 µm (l≈1e-4 m), u≈1e-3 m/s → Re ≈ 1000·1e-3·1e-4/1e-3 = **1×10⁻¹** … for
  slower/smaller cells Re drops to 1e-4. Microswimmer page states bacteria
  Re ≈ 10⁻⁴; Tetrahymena (25×50 µm, >500 µm/s) sits around Re~1e-2. So our
  band **Re ≈ 10⁻⁴–10⁻¹** is correct: firmly viscous-dominated.

**Stokes drag** (translational): F = 6πηr·u (Microswimmer, sphere).
**Stokes rotational drag**: ζ_r = 8πηr³ (Rotational diffusion).
**Einstein relations**: D_t = kT/6πηr, D_r = kT/8πηr³ (Rotational diffusion page
gives D_r = kT/f_r with f_r = 8πηr³).

| quantity | formula | r = 50 µm | r = 5 µm |
|---|---|---|---|
| D_t (translational) | kT/6πηr | ≈ 4.4×10⁻¹⁵ m²/s | ≈ 4.4×10⁻¹⁴ m²/s |
| RMS Brownian drift/s | √(4 D_t·1s) (2-D) | ≈ 0.13 µm/s | ≈ 0.42 µm/s |
| D_r (rotational) | kT/8πηr³ | ≈ 1.3×10⁻⁶ rad²/s | ≈ 1.3×10⁻³ rad²/s |
| RMS reorient/s | √(2 D_r·1s) | ≈ 1.6×10⁻³ rad ≈ **0.09°/s** | ≈ 0.051 rad ≈ **2.9°/s** |
| inertial stop time τ | m/6πηr ~ (2/9)ρr²/η | ~0.5 µs | ~5 ns |
| coast distance | u·τ | ≪ 1 Å | ≪ 1 Å |
| sedimentation v (Δρ=50 kg/m³) | (2/9)Δρ·g·r²/η | ≈ 270 µm/s | ≈ 2.7 µm/s |

Derivation notes:
- D_r at r=50 µm: 4.11e-21 / (8π·1e-3·(5e-5)³) = 4.11e-21 / (8π·1e-3·1.25e-13)
  = 4.11e-21 / 3.14e-15 ≈ 1.31×10⁻⁶ rad²/s. RMS over 1 s = √(2·1.31e-6) ≈ 1.6e-3 rad. **[derived]**
- D_r scales as 1/r³, so r=5 µm is 10³× larger → 1.31×10⁻³ rad²/s, RMS ≈ 0.051 rad/s. **[derived]**
- Coast distance ~0.1 Å and stop time ~1 µs match Purcell's own figures quoted on
  the Microswimmer page ("inertial coasting time ... on the order of 1 µs ...
  coasting distance ... about 0.1 ångströms"). [Microswimmer](https://en.wikipedia.org/wiki/Microswimmer)
- Sedimentation uses Stokes terminal velocity v = (2/9)(ρ_cell−ρ_water) g r²/η.
  Cytoplasm excess density ~10–70 kg/m³; I used 50. r=50 µm gives a *large* drift
  (~270 µm/s) — comparable to swim speed — while r=5 µm is small (~2.7 µm/s). **[derived]**

---

## Findings (per topic): VERIFIED / NEEDS-CORRECTION

### 1. STOKES FLOW / DRAG — velocity ∝ force, no coasting, time-reversibility (scallop theorem)

**Physics.** At low Re the Navier–Stokes inertial term vanishes, leaving the
**Stokes equations** `0 = −∇p + η∇²u, ∇·u = 0`, which are **linear and contain
no explicit time dependence**. Consequences (quoted): the swimmer experiences
"virtually no net force or torque"; "velocity is linearly proportional to the
force (same for angular velocity and torque)"; motion is "independent of time"
and "kinematically reversible". A reciprocal (one-degree-of-freedom)
deformation therefore yields **zero net displacement** — the scallop theorem.
[Scallop theorem](https://en.wikipedia.org/wiki/Scallop_theorem),
[Stokes flow](https://en.wikipedia.org/wiki/Stokes_flow),
[Microswimmer](https://en.wikipedia.org/wiki/Microswimmer)

**What this forbids in our renderer:**
- No ballistic/inertial motion: position must follow from current velocity, not
  accumulated momentum. **[derived]**
- No net propulsion from a symmetric, time-reversible body wobble — only from a
  non-reciprocal cycle (our metachronal cilia D2/D3 are the propulsion proxy; the
  FBM membrane wobble is decorative and must NOT be claimed to propel). **[derived]**
- Rate-independence: speeding the animation up/down should not change the *path
  shape* a real swimmer takes (it scales velocities, not trajectory). **[derived]**

**Our model — `wanderStep`: VERIFIED (core).** It recomputes
`vx = cos(heading)·speed; vy = sin(heading)·speed` and integrates
`x += vx·dt` each frame, with **no `v += a·dt`**. This is exactly the
overdamped, memoryless "velocity ∝ driving" behaviour Stokes flow demands. The
plan's F5 ("preserve memoryless velocity") is correct and should be guarded by a
test.

**Wall bounce — NEEDS-CORRECTION (or label).** `heading = π − heading` / `−heading`
is **specular elastic reflection**, an inertial-collision metaphor. A real
low-Re cell does not bounce off a wall; it backs up and reorients (ciliate
"avoidance reaction"). Recommend the plan's F7: on wall contact set
`heading += π ± rand·0.6` (back-up + random reorient) rather than mirror-reflect.
**[derived]**

**TDD assertions.**
- `wanderStep` is overdamped: with `driftSpeed=0`, position is invariant for any
  dt and any heading (no residual velocity). `expect(next.x).toBe(s.x)`.
- Rate-independence of path *shape*: running N steps at dt and 2N steps at dt/2
  with the same wander clock yields the same trajectory polyline within tol.
- (After F7) post-wall-contact heading differs from the incoming heading by
  **> 90°** and is not exactly the specular value `π − heading`.

---

### 2. ROTATIONAL & TRANSLATIONAL BROWNIAN MOTION — random reorientation rate

**Physics.** Rotational diffusion randomises orientation; for a sphere
`D_r = kT / (8πηr³)`, mean-square angle `⟨θ²⟩ = 2 D_r t` (2-D).
Translational `D_t = kT/(6πηr)`, `⟨x²⟩ = 4 D_t t` (2-D). Larger objects reorient
**much** more slowly (1/r³). [Rotational diffusion](https://en.wikipedia.org/wiki/Rotational_diffusion),
[Brownian motion](https://en.wikipedia.org/wiki/Brownian_motion)

**Quantified [derived]** (see table):
- r = 50 µm: D_r ≈ 1.3×10⁻⁶ rad²/s → RMS reorientation ≈ **0.09°/s**
  (essentially fixed heading over a frame). Translational D_t gives ≈0.13 µm/s —
  negligible vs swim speeds of 100s of µm/s.
- r = 5 µm: D_r ≈ 1.3×10⁻³ rad²/s → RMS ≈ **2.9°/s**. Still gentle, but visible
  over seconds. (For a 1 µm bacterium D_r ≈ 0.16 rad²/s → ~33°/s — that is why
  E. coli's run direction decorrelates in ~1–10 s purely from Brownian rotation.)

**Should the swim DIRECTION drift from Brownian rotation?** Yes, but for a
*large* cell the effect is tiny; the dominant heading change is **active**
(ciliary steering), not thermal. So our `wanderTurnRate` should be read as the
**active reorientation** term, and Brownian rotation is a small additive jitter
that scales with 1/r³. **[derived]**

**Our model — `wanderTurnRate`: VERIFIED as the active term; Brownian term MISSING (optional).**
Default `wanderTurnRate = 1.1 rad/s`. Compared to physics:
- As *active* steering this is realistic — eukaryotic swimmers curve on the order
  of ~1 rad/s. KEEP.
- It is **far larger** than the *Brownian* rotational rate for r≥5 µm
  (0.05 rad/s), so it should NOT be presented as "thermal noise". The label in
  `CELL_MATH.md` ("random walk of direction") is fine if understood as active.
- Note (plan F6): the current jitter seed is **position-coupled**
  `noise2D(s.heading*0.5+13, (s.x+s.y)*0.01 + s.heading)`, so it is not a true
  time random walk and can stall/limit-cycle. The plan's decoupled `wanderClock`
  fix is the right move and also makes a Brownian-scaled term insertable:
  optional `heading += sqrt(2·D_r_scene·dt)·gaussian()`. **[derived]**

**TDD assertions.**
- Heading autocorrelation decays over ~10⁴ steps (no lock / limit cycle);
  path statistics invariant to initial (x,y) offset (plan F6 test).
- If a Brownian term is added: with `wanderTurnRate=0`, the per-second RMS
  heading change equals `√(2·D_r·1)` for the configured scene `D_r` within tol,
  and **scales ∝ 1/r³** when the modelled radius is changed.

---

### 3. DRIFT / SEDIMENTATION / BUOYANCY — does the cell sink?

**Physics.** A cell denser than water sinks at Stokes terminal velocity
`v = (2/9)(ρ_cell − ρ_water) g r² / η`; if neutrally buoyant it does not. Many
protists are *near* neutrally buoyant (regulated by ions / contractile vacuole)
but slightly denser, so they sediment slowly when not swimming. The general
microswimmer literature treats gravity as one of several weak persistent biases
(gravitaxis). [Microswimmer](https://en.wikipedia.org/wiki/Microswimmer) (gravitaxis,
sedimentation); terminal-velocity formula is standard Stokes drag **[derived]**.

**Quantified [derived]** (Δρ = 50 kg/m³): r=50 µm → ~270 µm/s (significant — same
order as swimming!); r=5 µm → ~2.7 µm/s (slow). So sedimentation matters more for
*larger* cells. A real organism counteracts it by swimming, so net vertical bias
is small but nonzero.

**Our model — no sedimentation: ACCEPTABLE / OPTIONAL.** `wanderStep` has **no
gravity term**; the cell is treated as neutrally buoyant and roams isotropically.
This is a *defensible* stylisation (an actively swimming, near-neutrally-buoyant
ciliate). If we want extra realism, add a *small, declared* downward bias only
when "resting" (not swimming):
`heading_bias_y += k_grav` with `k_grav` tuned so the visual drift ≪ active
speed. Must be labelled non-quantitative (we are not simulating true ρ). **[derived]**

**TDD assertions.**
- Default (no-gravity) build: over a long run with isotropic wander, the
  time-averaged velocity is ≈0 in both axes within tol (no hidden directional bias).
- If gravity enabled: resting cell's mean vertical velocity is downward and its
  magnitude ≤ a small fraction (e.g. <15%) of swim speed (so it never looks like
  falling).

---

### 4. FLOW FIELD AROUND THE SWIMMER — puller/pusher, stresslet ~1/r²

**Physics.** A force-free swimmer's far field is a **stresslet** (force dipole),
whose velocity decays as **1/r²** (vs 1/r for a towed sphere / Stokeslet).
Swimmers are classed **pushers** (thrust behind, e.g. flagellated bacteria/sperm)
and **pullers** (thrust in front, e.g. *Chlamydomonas* breaststroke); ciliates
like *Paramecium/Tetrahymena* are near "neutral squirmers" but still drag a
characteristic dipolar flow that advects nearby tracer particles. The microswimmer
literature explicitly treats these "long-ranged fluid-mediated hydrodynamic
interactions" as defining features. [Microswimmer](https://en.wikipedia.org/wiki/Microswimmer)
(pusher/puller, squirmer, hydrodynamic interactions); 1/r² dipole decay is
standard Stokes-flow multipole theory **[derived]**.

**Our model — flow field MISSING: ENHANCEMENT, not an error.** We render the
organism but **no surrounding-fluid response**: no advected particles, no
streamlines. This is fine for a minimal overlay. If we add ambient "motes" for
life, they should be **advected by a dipolar field** that decays ~1/r² and
reverses front/back (puller-style for a ciliate), NOT pushed radially outward
like an explosion. Even a cheap approximation: tracer velocity
`u_tracer ≈ A·(swimdir·stencil)/r²` oriented along the heading axis. **[derived]**

**TDD assertions (only if particles are added).**
- A tracer's induced speed falls off ≈ 1/r² with distance from the cell centre
  (fit exponent within tol), not 1/r and not constant.
- Reversing the cell's heading reverses the local tracer flow direction
  (kinematic reversibility, topic 1).
- Net momentum imparted to the tracer field over one full beat cycle ≈ 0
  (force-free swimmer).

---

### 5. WAKE / MEMORY — low-Re flow is instantaneous (no trailing, no history)

**Physics.** Because the Stokes equations have **no time derivative**, the flow
is **quasi-static**: it is fully determined by the *instantaneous* boundary
motion. There is **no wake, no shed vortices, no momentum memory** — stop moving
and the surrounding flow stops "immediately" (within the ~µs inertial time).
Purcell: only forces exerted *in the present moment* contribute to propulsion.
[Microswimmer](https://en.wikipedia.org/wiki/Microswimmer),
[Stokes flow](https://en.wikipedia.org/wiki/Stokes_flow)

**Our model — two pseudo-inertia offenders NEEDS-CORRECTION (or label):**
1. **`startleOffset`**: detects an audio edge, **darts** the whole cell by up to
   `startleMaxPx`, then **springs back via `decay`**. The dart-and-return is a
   damped-spring (mass-on-a-spring) behaviour — i.e. inertia + restoring memory —
   which low-Re flow forbids. A real cell can *jump* (escape reaction) but it does
   **not elastically recoil**; it would simply reorient and swim off. Recommend:
   keep the fast displacement as an "escape" but **drop the spring-back**, or
   explicitly label startle as artistic. **[derived]**
2. **`driftActivation` (~3 s ramp)**: smoothly re-centres the cell over ~3 s when
   recording stops. That slow glide reads as **coasting to a stop** — inertial.
   Plan F8 already flags this: convert per-frame ramps to `1−exp(−dt/τ)` form and
   *shorten or declare non-physical*. **[derived]**
3. **`cellDrift` (legacy)**: `position = noise(t·speed)` oscillates about the
   centre (the very "always comes back" bug `wanderStep` replaced). It encodes a
   restoring pull toward the middle = a spring/potential, not free low-Re roaming.
   Keep it deprecated; do not use on the live path. **[derived]**

`wanderStep` itself is **memoryless and correct** here (no trailing state beyond
heading, which is a legitimate orientation, not stored momentum).

**TDD assertions.**
- No spring-back: after a startle impulse with audio returning to baseline, the
  cell's position does **not** oscillate around its pre-startle location (no
  overshoot/undershoot signature); displacement is monotone-decaying *toward
  wherever it is now*, or (preferred) the dart simply offsets the swim path.
- `driftActivation` ramp is `dt`-consistent: same elapsed-time response at 30 fps
  and 60 fps (1−exp(−dt/τ) form), per plan F8.
- Frame-rate independence: total path length over T seconds is invariant to fps.

---

### 6. TUMBLING / RUN-AND-TUMBLE / HELICAL — how real cells change direction

**Physics.**
- **Bacteria (run-and-tumble):** runs (CCW flagellar bundle, ~straight) punctuated
  by **tumbles** (CW, bundle flies apart, near-random reorientation). The
  trajectory is a **biased random walk**: in a gradient, favourable direction →
  longer runs, fewer tumbles (temporal sensing). Discrete, abrupt reorientation
  events. [Chemotaxis](https://en.wikipedia.org/wiki/Chemotaxis),
  [Microswimmer](https://en.wikipedia.org/wiki/Microswimmer)
- **Eukaryotic ciliates/flagellates:** **continuous** steering — *Chlamydomonas*
  breaststroke, *Paramecium/Tetrahymena* ciliary turning, often **helical
  swimming** (the cell spins about its long axis tracing a helix). Reorientation
  is smooth + Brownian, not the bacterial tumble. Path **persistence length**
  L_p ≈ v·τ_r where τ_r is the reorientation time (Brownian τ_r = 1/D_r, or
  shorter if active). [Microswimmer](https://en.wikipedia.org/wiki/Microswimmer),
  [Chemotaxis](https://en.wikipedia.org/wiki/Chemotaxis) (eukaryotic cilia, 9+2 beat)
- Realistic curvature: for a large ciliate, purely-Brownian persistence length is
  long (τ_r = 1/D_r ≈ 8×10⁵ s at r=50 µm → effectively straight unless actively
  steering), so visible curvature must come from **active turning**, on the order
  of our `wanderTurnRate`. **[derived]**

**Our model — `wanderStep` continuous random walk: VERIFIED for a eukaryote.**
The smooth, continuously-curving heading walk matches a **ciliate/flagellate**
(our organism), NOT a tumbling bacterium. That is the right call for a cell with a
cilia crown. Two optional realism upgrades:
- **Discrete tumbles** (only if we want a bacterial flavour): occasionally inject
  a large random heading jump (Δθ from a broad distribution) between long
  near-straight runs. Default OFF; our organism is a ciliate. **[derived]**
- **Helical bias:** superimpose a slow constant curvature (small steady
  `heading += ω·dt`) so the path gently coils — visually reads as 3-D helical
  swimming projected to 2-D. Optional, mild, declared stylisation. **[derived]**
- **Chemotaxis** (toward audio energy?): a *biased* walk (lengthen runs when
  "improving") is the biologically correct way to bias motion toward a stimulus —
  more accurate than a hard attractor. Optional future feature. **[derived]**

**TDD assertions.**
- Default build: heading is C⁰/C¹-continuous across steps (no instantaneous jumps
  > a small cap) — i.e. ciliate-style smooth steering, not tumbling.
- Persistence: mean run "straightness" (velocity autocorrelation time) scales
  inversely with `wanderTurnRate` (higher turn rate → shorter persistence length).
- If tumble mode enabled: inter-tumble run-length distribution is broad
  (exponential-like) and tumble reorientation angles span a wide range; with a
  bias input, "favourable" runs are statistically longer.

---

## Contradiction flags (where our motion model fights fluid-medium physics)

| # | Location | Issue | Verdict | Fix |
|---|---|---|---|---|
| F-1 | `wanderStep` wall bounce | specular elastic reflection = inertial collision | NEEDS-CORRECTION | back-up + random reorient (plan F7) |
| F-2 | `startleOffset` | dart + **spring-back** = mass-spring inertia + restoring memory | NEEDS-CORRECTION / label | drop recoil; treat as one-shot escape, OR declare artistic |
| F-3 | `driftActivation` (~3 s) | slow re-centring reads as coasting/inertia; per-frame (not dt) | NEEDS-CORRECTION | `1−exp(−dt/τ)`, shorten or declare (plan F8) |
| F-4 | `cellDrift` (legacy) | `pos=noise(t)` = restoring spring toward centre | KEEP DEPRECATED | do not use live (already replaced by wanderStep) |
| F-5 | `wanderStep` jitter seed | position-coupled, not a true temporal random walk; can stall | NEEDS-CORRECTION | decoupled `wanderClock` (plan F6) |
| F-6 | flow field | no advected fluid / streamlines (puller/pusher 1/r² dipole) | MISSING (enhancement) | optional dipolar tracer advection |
| F-7 | Brownian rotation | not modelled (small but real, ∝1/r³) | OPTIONAL | add tiny `√(2 D_r dt)` heading jitter |
| F-8 | sedimentation | none (assumes neutral buoyancy) | ACCEPTABLE / OPTIONAL | optional small declared downward bias at rest |

**VERIFIED-correct (keep):** memoryless velocity recompute in `wanderStep` (F5 of
plan), `wanderTurnRate` as active steering, continuous (non-tumbling) eukaryotic
path, `cellReach` containment concept (separate issue from physics).

---

## Sources

Kept (primary, load-bearing):
- **Scallop theorem** (en.wikipedia.org/wiki/Scallop_theorem) — Stokes-equation
  derivation, time-independence, kinematic reversibility, zero net displacement
  for reciprocal motion; topic 1 + 5.
- **Stokes flow** (en.wikipedia.org/wiki/Stokes_flow) — creeping-flow equations,
  no time derivative → quasi-static/no-wake; topics 1, 5.
- **Microswimmer** (en.wikipedia.org/wiki/Microswimmer) — Re≈10⁻⁴, coast
  time ~1 µs / 0.1 Å, F=6πηru, pusher/puller, hydrodynamic interactions, run-and-
  tumble vs eukaryotic gaits, swimmer speed/size table (Tetrahymena, Chlamydomonas);
  topics 1–6. Most comprehensive single source.
- **Rotational diffusion** (en.wikipedia.org/wiki/Rotational_diffusion) — D_r =
  kT/8πηr³, ζ_r=8πηr³, ⟨θ²⟩=2D_r t, Einstein relation; topic 2 quantification.
- **Brownian motion** (en.wikipedia.org/wiki/Brownian_motion) — D_t=kT/6πηr,
  thermal origin, η value; topic 2/3.
- **Chemotaxis** (en.wikipedia.org/wiki/Chemotaxis) — run-and-tumble biased random
  walk, temporal sensing, eukaryotic continuous (cilia 9+2) steering; topic 6.

Dropped / not fetched:
- PMC1861806 (Guirao & Joanny metachronal-wave paper) — already covered by the
  plan for *cilia* hydrodynamics; this brief is about *whole-cell motion*, so it
  added nothing here.
- Purcell's three-swimmer page — redundant; the scallop-theorem + microswimmer
  pages cover non-reciprocity and the 2-hinge/3-sphere swimmers already.
- The bulk of the Microswimmer page on synthetic/biohybrid/drug-delivery robots —
  off-topic for our natural-cell motion model.

---

## Gaps / next steps

1. **Quantitative buoyancy:** I assumed cytoplasm excess density Δρ≈50 kg/m³ to
   compute sedimentation; the true value for our stylised cell is undefined.
   Sedimentation only matters if we add a gravity bias — decide first whether the
   cell is "actively swimming" (ignore) or "resting/dead" (sink slowly).
2. **Scene-scale mapping for Brownian D_r:** to add a *physically scaled* Brownian
   jitter we must fix what real radius the on-screen `baseR` represents (5 µm vs
   50 µm changes D_r by 1000×). Pick a canonical size and document it.
3. **Flow-field cost/benefit:** a dipolar tracer field is the single biggest
   *accuracy* upgrade (it's the visible signature of low-Re swimming) but also the
   most code; needs a perf budget decision before implementing.
4. **Helical vs planar:** real ciliate paths are 3-D helices; our 2-D projection
   choice (gentle constant curvature vs straight runs) is an aesthetic call not
   resolved by physics alone.
5. Could not run code tests here (research-only role) — the TDD assertions above
   are specifications for the implementer, not executed.
