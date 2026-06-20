# Systematic Model-Deficiency Hunt — `cell` Organism (all parts, not just motion)

**Scope:** model-level gaps, missing couplings, energy/scale/temporal
inconsistencies, and inter-phase contradictions across EVERY exported function in
`src/theme-engine/renderers/cell.ts` + `shared.ts`, cross-read against plan v4
(phases A–F), `docs/CELL_MATH.md`, and the prior research/review files.

**Method:** read-only. Code line numbers verified against the live file. Each item
is tagged **[NEW]** (not in plan v4) or **[IN-PLAN]** (already covered — listed only
to anchor a contradiction or to show where a NEW item collides with it).

**Note on a missing input:** the task lists `research-fluid-medium-motion.md` as a
file to cross-read. **It does not exist in cwd** (only `research-cilia-hydrodynamics.md`,
`research-cilia-structure-inertia.md`, `research-cellbody-parts.md`,
`research-membrane-areacons.md`, and the round-1/2 reviews are present). The
"fluid medium / surrounding-water" physics it would have covered is therefore the
single largest **un-researched** area, and several NEW findings below (M1, M2, M7)
live exactly in that gap. Flagging so the parent can decide whether to commission it.

---

## Executive summary of the headline NEW deficiencies

The plan v4 is exhaustive on **per-part geometry** (Phase F) and **per-part area/
deformation math** (Phases B/C/D). But it has a **systemic blind spot: there is no
single "activity" state variable that physically couples the parts.** Audio energy
is wired into ~6 places by *independent, differently-shaped* formulas, and the one
coupling that matters most biologically — **cilia beating ⇒ propulsion** — does not
exist in either the code OR the plan. The cilia are decorative; the swim speed is a
constant unrelated to them; and "louder" means different things to different parts.
That is the core model-level deficiency (M1–M3 below).

---

## Prioritized deficiency list

### M1 — [NEW] Cilia beat is fully DECOUPLED from body propulsion (no drive, no feedback)

- **Where:** `wanderStep` (cell.ts:1014–1074) `speed = (driftSpeed ?? 0.03)·min(w,h)·1.2`
  (cell.ts:1034) is a **constant**; it never reads `energy`, `growth`, `audioLevel`,
  or any cilia state. `ciliaPath` (cell.ts:446–536) never returns a thrust vector.
  Confirmed by grep: nothing feeds energy/audio into `speed` or vice-versa.
- **Why it's wrong/missing:** the entire biological premise (CELL_MATH §4, the cilia
  research files) is that the metachronal-beating crown *is the propulsion engine*.
  In the model the cilia and the wander are two unrelated animations sharing a
  centre. Plan D2/D3/F4 make the cilia *lean with* the velocity (kinematic
  follower), but **the causal arrow is still backwards/absent**: velocity is set by
  `driftSpeed`, cilia merely decorate it. There is no "more beating → faster swim"
  and no "stopped beating → drift to halt." This is the missing master coupling the
  task asks about (#1).
- **Severity:** High (model-level — it's the defining physics of a ciliate, and
  plan v4 never states the causal direction). Also a *contradiction risk*: F5
  ("preserve memoryless velocity") + D2 (cilia lean ∝ speedNorm) together imply
  cilia *follow* speed, but at speedNorm=0 the crown is inert while the plan also
  wants idle "breathing" — see M3.
- **Concrete fix:** introduce one **activity scalar** `act ∈ [0,1]` (drive it from
  `growth`, the already-smoothed accumulator — NOT raw audioLevel, see M2) and make
  it the *single* driver of: (a) `ciliaBeatHz_eff = beatHz·(0.4+0.6·act)`,
  (b) swim `speed_eff = baseSpeed·act` (so no beat ⇒ no swim, satisfying low-Re
  instant-stop, research-cellbody Finding 7), and (c) optionally drag-lean gain.
  Velocity then *emerges from* activity rather than from a free `driftSpeed`
  constant. Keep `drift01` as the separate rest-centre gate.
- **TDD property:** `speed(act=0)=0` and `speed` monotonic in `act`; with the
  activity wiring, a step of `audioLevel` 0→1 produces a *delayed* speed rise whose
  time-constant equals `growth`'s release τ (proves the beat drives the swim, not
  instantaneous audio).

---

### M2 — [NEW] "Louder audio" maps to FOUR different, inconsistent physical stories

- **Where (the divergent couplings):**
  1. Membrane FBM amp = `idle + energy·energyDrive` (cell.ts:330–331) — driven by
     **smoothed `energy`** (cellEnergy).
  2. Pseudopod amp = `push·(idle + audioLevel·levelGain)·energy` (cell.ts:382–383) —
     driven by **raw `audioLevel` AND `energy`** (double-coupled, instantaneous).
  3. Cilia length `lenMean = baseR·(ciliaLength + growth·ciliaGrowthBoost)·(0.55+0.45·energy)`
     (cell.ts:484–485) — driven by **`growth` (slow) AND `energy` (fast)** mixed.
  4. Nucleus radius `r = baseR·(nucleusRadius + audioLevel·nucleusPulse + idleBreath)`
     (cell.ts:783) — driven by **raw `audioLevel`** (instantaneous).
  5. Cilia stroke alpha `0.35 + 0.35·energy` (cell.ts:1248) — **`energy`**.
  6. Hue depth `+ audioLevel·hueBoost` (cell.ts:610) — **raw `audioLevel`**.
- **Why it's wrong/missing:** there are **three different temporal responses to the
  same sound**: raw `audioLevel` (instant, used by pseudopod/nucleus/hue), `energy`
  (lightly smoothed, used by FBM/cilia-alpha), and `growth` (heavily
  asymmetric-smoothed, used by cilia-length). So on a sudden syllable the nucleus
  pulses and pseudopods shoot *instantly*, the membrane FBM swells *slightly later*,
  and the cilia lengthen *much later* — and on silence they all decay on different
  curves. There is no coherent "the cell got more active" gestalt; parts visibly lead
  and lag each other inconsistently. CELL_MATH explicitly designed `growth` to be the
  smooth driver "precisely for this smooth decay," yet 4 of 6 couplings bypass it.
- **Severity:** High (this is exactly task #2 — energy/activity consistency — and the
  plan never audits cross-part energy routing; it treats each part's formula in
  isolation).
- **Concrete fix:** define the activity hierarchy explicitly and route every
  amplitude through it: **fast reflex** = `startle` (already exists, for darts only);
  **steady activity** = `growth` (length, swim, FBM swell); **instant shimmer** =
  raw `audioLevel` for *color only* (hue). Move nucleus pulse and pseudopod height
  onto `growth` (or `energy`) so the body parts share ONE envelope. Document the
  rule in CELL_MATH §0.
- **TDD property:** feed an impulse `audioLevel: 0→1→0` over N frames; assert the
  *peak-time ordering* of (pseudopod amp, FBM amp, cilia length, nucleus r) is
  monotone-consistent (all share the same envelope τ within tolerance) rather than
  three different peak times.

---

### M3 — [NEW] No idle ↔ active beating story; cilia are kinematically "alive" even at silence with no propulsive meaning

- **Where:** `ciliaBeatPhase` advances purely on `t·hz` (cell.ts:421) regardless of
  mode/energy. At idle the crown beats at full `ciliaBeatHz` forever, but the body
  does not move (drift01≈0). During recording the body wanders but (per M1) not
  *because* of the beat.
- **Why it's wrong/missing:** biologically, a resting ciliate either holds station
  (cilia idling/arrested) or cruises (coordinated beat → propulsion). The model has
  the crown beating identically in all modes while the *propulsion* is gated
  separately by `drift01`. So beat-energy and swim-energy are independent knobs that
  happen to look plausible but encode contradictory states (full beat + zero motion =
  "rowing in place with no thrust"). Plan F4 (shared stroke axis, R>0.4) will make
  this *worse*: once all hairs row coherently toward one axis, a stationary body that
  is visibly rowing reads as a bug.
- **Severity:** Medium-High (a model contradiction Phase F will surface, task #6).
- **Concrete fix:** gate beat *vigour* (Hz and/or amplitude), not just lean, by the
  same `act` scalar from M1, so idle = slow gentle beat, recording = fast coherent
  beat that *also* drives `speed`. Tie F4's shared-axis strength to `act` so a
  near-still cell shows near-isotropic gentle motion (no false rowing).
- **TDD property:** at `act=0`, mean-resultant-length of tip-displacement R < 0.2
  (no coherent thrust); at `act=1`, R > 0.4 (F4) AND `speed>0` — beat coherence and
  swim co-vary.

---

### M4 — [NEW] Persistence restores `growth` + phase but NOT wander position/heading or `deform` → visible pop on reload

- **Where:** restore block cell.ts:1144–1153 sets `growth` and the drift-phase
  offset only. `wander` is re-initialised to tank centre with a fresh
  `noise2D(7.1,3.3)·TAU` heading every reload (cell.ts:1214); `deform` starts `null`
  → first frame is the raw target with no form-memory (cell.ts:1201–1203).
  `CellPersistState` (cell.ts:826–830) only carries `{driftPhase, growth, elapsed}`.
- **Why it's wrong/missing:** CELL_MATH §6 claims the cell "resumes its phase and
  size seamlessly … rather than popping back to a cold start." Size (growth) and the
  drift-*phase* are restored, but **position jumps back to centre** and the
  **membrane shape resets** to an un-integrated target. After an overlay reload the
  cell teleports to the middle and its outline snaps. The seam the doc promises to
  remove is only half-removed. Note: `driftPhase`/`driftPhaseOffset` is now **dead
  state** — `cellDrift` (the only consumer of a noise-phase) is no longer called by
  the renderer (wander replaced it), so persisting `driftPhase` restores a value
  nothing reads, while the thing that *does* need restoring (wander x/y/heading) is
  not saved.
- **Severity:** Medium (temporal-coherence/seam bug, task #5; also a latent
  contradiction — plan v4 never reconciles persistence with the wander rewrite).
- **Concrete fix:** persist `{x, y, heading, growth, elapsed}` (drop the now-unused
  `driftPhase`, or keep for back-compat but stop reading it); on restore seed
  `wander` from saved x/y/heading and let `deform` rebuild over a few frames (or
  persist a coarse deform summary). Clamp restored x/y into current tank bounds (M5).
- **TDD property:** `parseCellState` round-trips x/y/heading; `restoreSeed`-equivalent
  for wander yields a first-frame centre within `<1px` of the saved position (no
  teleport); reject out-of-tank saved coords.

---

### M5 — [NEW] No overlay-resize handling: persisted/derived px state breaks when size changes

- **Where:** `createCellRenderer` reads `opts.width/height` once (cell.ts:1126);
  canvas size fixed at construction. `baseRadiusPx` is absolute px; persisted state
  (M4) and `wander.x/y` are absolute px. There is no resize observer or
  fraction-normalisation of stored position.
- **Why it's wrong/missing:** task #3 (dimensional/scale). If the overlay is created
  at one size and later state restored under a different size (or the same key reused
  across overlays of different dimensions — the shipping 160×160 cell vs the 172×36
  harness), a saved px position can land **outside the tank**, and `baseRadiusPx`
  gives a wildly different *relative* cell size. The plan's containment math assumes a
  fixed tank; resize is unmodelled. (The plan flags 160×160 vs 172×36 only for the
  *radius budget*, not for *state portability*.)
- **Severity:** Medium (degenerate/edge + scale, tasks #3/#4).
- **Concrete fix:** store position as a **fraction of tank** in persistence; on
  restore (and on any resize) re-derive px from current w/h and re-clamp into
  `[inset, size−inset]`. Namespace `PERSIST_KEY` by overlay role/size so a 160×160
  cell never inherits a 172×36 harness state.
- **TDD property:** restoring a state saved at 160×160 into a 320×320 tank keeps the
  cell inside bounds and at the same *relative* position (±1%).

---

### M6 — [NEW] `cellEnergy` idle term is unbounded-by-mode and the four mode branches are mutually discontinuous → pop at every mode change

- **Where:** `cellEnergy` (cell.ts:312–331): idle = `idle·(1+0.25·sin(0.8t))`;
  recording = `clamp(idle + audioLevel·levelGain)`; transcribing =
  `clamp(0.72·idle + 0.12·audioLevel)`; error = `idle`.
- **Why it's wrong/missing:** these are **instantaneous switches with different
  baselines and gains**. At the idle→recording transition energy jumps from
  `idle·(1±0.25)` to `idle + audioLevel·levelGain`; at recording→transcribing it
  drops from `idle+audioLevel·0.7` to `0.72·idle+0.12·audioLevel` — a step change in
  the *same frame* the mode flips. Because energy drives FBM amp, cilia alpha, and
  (mixed) cilia length, **every mode change produces a visible pop** in membrane
  wobble and cilia brightness/length. CELL_MATH presents these as separate stories
  but never requires continuity across the switch. The plan's two-baseline invariant
  covers B1/C1 resting-shape change, not mode-transition continuity.
- **Severity:** Medium (temporal coherence at mode changes, task #5).
- **Concrete fix:** make `cellEnergy` a *target* that an EMA chases (like `growth`/
  `driftActivation`), so mode flips ramp instead of step; OR ensure the branch values
  agree at the boundary (e.g. transcribing starts from the last recording energy and
  decays). Route through one smoothed activity (M2) and the discontinuity disappears.
- **TDD property:** simulate `idle→recording→transcribing→idle` with fixed
  audioLevel; assert `|Δenergy|` per frame across each mode flip is ≤ the
  within-mode max |Δenergy| (no step).

---

### M7 — [NEW] Wander is purely translational: no body roll/heading-rotation state, so D4 prolate + F4 stroke axis have an underspecified orientation at low speed

- **Where:** `WanderState` (cell.ts:1004–1011) carries `{x,y,heading,vx,vy}` — there
  is no angular/orientation state for the *body* independent of velocity direction.
  At `speedNorm→0`, `headingV = atan2(vy,vx)` is still defined (speed constant) but
  the *physical* orientation of a near-stationary cell is undefined/noisy.
- **Why it's wrong/missing:** research-cellbody Finding 4 + research-cilia Finding 2b
  say a real ciliate **rolls about its long axis (~1–2 Hz)** while cruising and its
  prolate axis = swim axis. The plan's D4 sets `φ=headingV` and F4 uses the
  anti-travel axis `ŝ`, but **both degenerate when the cell is barely moving**: with
  constant `speed`, `headingV` never goes to "undefined," so a resting cell still has
  a sharp prolate axis pointing along whatever its frozen heading is — it will look
  like a stationary cigar rigidly pointing one way, then snap to a new axis when it
  starts moving. There's no smoothing of body orientation and no roll. Two phases
  fight: D1 says "collapse to isotropic at speedNorm=0," but `speedNorm = drift01·
  clamp(vmag/vRef)` — and `vmag≈vRef` always (constant speed), so `speedNorm≈drift01`,
  meaning the prolate axis is governed by `drift01` (recording gate), not by actual
  motion. The "collapse to isotropic when not moving" invariant is only satisfied
  *because recording stopped*, not because the cell is stationary — a coincidence
  that breaks if speed is ever gated by activity (M1).
- **Severity:** Medium (model contradiction surfaced by D4/F4 vs the constant-speed
  wander; tasks #1/#6).
- **Concrete fix:** carry a smoothed `bodyHeading` (EMA-chase of `headingV`) and
  optionally a slow `roll` phase; drive D4 `φ` and F4 `ŝ` from `bodyHeading` so
  orientation changes smoothly and is well-defined when nearly still. If M1 lands
  (speed ∝ activity), `speedNorm` becomes a true speed signal and the
  collapse-to-isotropic invariant becomes physically meaningful instead of
  coincidental.
- **TDD property:** body major-axis angle is Lipschitz in time (no snap) across a
  start-from-rest transient; at sustained `act=0`, prolate aspect → 1 (isotropic).

---

### M8 — [NEW] `startle` direction is a global noise angle, not aligned to motion, and stacks on top of (not into) the wander → can shove the cell toward/through a wall

- **Where:** `startleAngle = TAU·noise2D(900.5, t·0.7)` (cell.ts:1179);
  `cx = driftedX + sdx` (cell.ts add of `sdx,sdy`, cell.ts:1180–1181). The startle
  offset is added to the centre *after* wander containment, and `cellReach` includes
  `+startleMaxPx` headroom — but only as a *radius* bound, not directional.
- **Why it's wrong/missing:** task #4/#6. The dart direction is independent of
  heading and of walls. Containment (`inset = max(driftMargin, cellReach)`) reserves
  `startleMaxPx` of slack, so the *membrane* won't clip — but the startle is a pure
  positional shove unrelated to any propulsive event, and it is applied even while
  `drift01≈0` (idle/transcribing), so an idle, centred cell can jump several px in a
  random direction on a loud transient with no swimming context. Biologically a
  startle in a ciliate is the *avoidance reaction* (reverse + reorient, research-
  cellbody Finding 5), i.e. it should perturb *heading*, not teleport the centre.
- **Severity:** Low-Medium (model fidelity + edge interaction with walls).
- **Concrete fix:** convert startle into a transient heading kick + brief speed
  burst on `wander` (so containment naturally handles it), rather than a post-hoc
  centre offset; or at minimum bias the dart direction to `-headingV` (back-up).
- **TDD property:** a startle never moves the centre outside `[inset, size−inset]`;
  startle perturbs heading (post-startle heading differs) rather than only x/y.

---

### M9 — [NEW] `idleFactor` cross-fade is keyed to raw `audioLevel`, not energy/mode → idle morph flickers on noisy-but-quiet input

- **Where:** `idleFactor = max(0, 1 − audioLevel·3)·recordingFade` (cell.ts:1186),
  `recordingFade = mode==="recording" ? 0.3 : 1`.
- **Why it's wrong/missing:** task #4 (degenerate) + #5 (temporal). The `·3` makes
  idle morph vanish entirely above `audioLevel=0.33`, with a **hard linear knee**. On
  a fluctuating quiet signal (audioLevel jittering around 0.2–0.4 during
  transcribing/idle), the idle-morph contribution flickers on/off frame-to-frame —
  the membrane's "resting breathing" stutters. There is no smoothing of this gate
  (unlike growth/driftActivation). Also it is keyed to instantaneous audioLevel while
  the *competing* speech deformation is keyed to `energy` — so the cross-fade and the
  thing it fades against run on different clocks (a sub-case of M2).
- **Severity:** Low-Medium.
- **Concrete fix:** drive `idleFactor` from a smoothed signal (energy or `1−act`) and
  use `smoothstep` for the knee; ensure idle and active deformation share a single
  partition-of-unity so they can't both spike or both vanish.
- **TDD property:** with audioLevel a noisy 0.3-mean signal, frame-to-frame
  `|ΔidleFactor|` is bounded (smoothed gate); `idleFactor + activeFactor` ≈ const.

---

### M10 — [NEW] `noise2D`-derived "random" seeds collide across parts → hidden correlations (determinism is fine, independence is not)

- **Where:** startle uses `noise2D(900.5, t·0.7)`; wander init `noise2D(7.1,3.3)`;
  pseudopod lobes `noise2D((i+1)·1000, t·intentDrift)`; nucleus
  `noise2D(137,…)/noise2D(241,…)`; cilia placement `noise2D(k·12.9898,7.2)`; cilia
  length `noise2D(k·3.7+0.3,1.3)`. All share ONE 256-entry `PERM` table (shared.ts).
- **Why it's wrong/missing:** task #4 (determinism/independence). These are
  deterministic (good) but several sample the **same lattice rows** at slow-moving
  second coordinates, so different organs can drift in lock-step phases (e.g. nucleus
  drift `noise2D(137, t·0.12)` and pseudopod intent `noise2D(1000, t·0.08)` can share
  near-identical low-frequency structure because the value-noise has only 256 distinct
  gradients). The plan's E1 precondition fixes ONLY the cilia-count aliasing
  (`noise2D(k·12.9898, 7.2 + k·0.123)`), not the cross-organ phase correlation. Not a
  crash, but a subtle "everything bulges/drifts together" artifact that undercuts the
  "independent living parts" goal.
- **Severity:** Low.
- **Concrete fix:** give each organ a distinct, well-separated 2-D walk (vary BOTH
  coordinates per organ), or add a small per-organ irrational offset on the second
  axis. Document the seed map in CELL_MATH so future organs don't collide.
- **TDD property:** cross-correlation between any two organ noise streams over 10⁴
  samples < 0.2.

---

### M11 — [NEW] `dt` is clamped per-frame but the clamp **silently drops time** → cumulative time desync between `t` and integrated state after a stall

- **Where:** `t = (nowMs − startedAt)/1000` (continuous, cell.ts:1159) but
  `dt = clamp((nowMs−lastTickMs)/1000, 0.001, 0.05)` (cell.ts:1163). Wander integrates
  with the *clamped* `dt`, while everything keyed to `t` (FBM drift, cilia phase,
  idleMorph, nucleus) uses the *true* elapsed.
- **Why it's wrong/missing:** task #3/#5. After a backgrounded tab or a long frame
  (>50ms), `t` jumps by the real gap but `wander` only advanced by the clamped 50ms.
  So the *position* lags the *phase*: the membrane/cilia animation is at time `t`, but
  the cell is positioned as if much less time passed. Over repeated stalls these
  diverge unboundedly. The clamp protects against teleport (good) but creates a
  silent two-clock inconsistency the plan's "dt-based, fps-independent" invariant
  doesn't acknowledge (the plan assumes one consistent clock).
- **Severity:** Low-Medium (coherence after stalls; also interacts with F8's
  dt-consistency push).
- **Concrete fix:** either drive ALL animation from accumulated clamped-dt time
  (one clock), or accept the divergence explicitly and document it. Cleanest: keep a
  `simTime += dt` accumulator and feed *that* to the phase functions instead of raw
  `t`, so position and phase share the clamped clock.
- **TDD property:** inject one 500ms frame gap; assert position-time and phase-time
  stay equal (single accumulator) — currently they diverge by ~450ms.

---

### M12 — [NEW] Cilia are stroked as a Catmull-Rom through the spine but the FIRST segment is dropped on render → base detaches visually from membrane

- **Where:** render loop cell.ts:1250–1256: `moveTo(hair.points[0])` then
  `spline = catmullRom(hair.points,4)` and `for i=1…` `lineTo(spline[i])`. It moves to
  the raw base point, then immediately draws to `spline[1]` — but `spline[0]` (the
  Catmull-Rom-resampled base) is skipped, and `catmullRom` on an OPEN polyline treated
  as closed (shared.ts wraps indices `% n`) **connects tip back toward base**,
  producing a spurious wrap segment.
- **Why it's wrong/missing:** `catmullRom` (shared.ts:158–178) is a **closed-loop**
  spline (it wraps `(i+1)%n`, `(i-1+n)%n`) — designed for the membrane, not for an
  open hair. Feeding an open cilium polyline makes the last span interpolate from tip
  back to base, and the renderer's `moveTo(points[0])`→`lineTo(spline[1..])` mix of
  raw-base + closed-spline can leave a small gap or hook at the base/tip. The plan
  (F1/F2/F3) reworks the bend math but assumes the *stroke* is faithful; it never
  flags that the hair is drawn with a closed-curve smoother. This undermines F1's
  `κ(L)=0` tip property — a closed spline forces nonzero curvature at the tip to
  meet the wrap.
- **Severity:** Medium (geometry fidelity; directly fights F1's tip-curvature goal).
- **Concrete fix:** add an OPEN Catmull-Rom variant (clamp end tangents, no wrap) for
  cilia, or draw the spine as-is with enough segments. Then F1's tip property is
  actually visible.
- **TDD property:** the rendered (splined) cilium's last vertex equals the spine tip
  (no wrap-back); discrete curvature at the rendered tip ≤ mid (consistent with F1).

---

### M13 — [NEW] `growthLevel` reads `mode==="recording"` only → growth (hence cilia length & any activity coupling) collapses during `transcribing`, contradicting cellEnergy

- **Where:** `growthLevel` target = `recording ? clamp(audioLevel) : 0`
  (shared.ts:289). But `cellEnergy` keeps a `transcribing` activity floor
  (`0.72·idle + 0.12·audioLevel`, cell.ts:325).
- **Why it's wrong/missing:** task #2/#6. During transcribing the cell should look
  "calmer but still working" (CELL_MATH). `energy` honours that, but `growth` snaps
  its target to **0** the instant recording stops, so cilia length (driven by growth)
  begins its slow release immediately at transcribe-start while `energy`-driven parts
  stay elevated. The two activity signals **disagree about whether transcribing is
  active**. If M1/M2 unify activity, this contradiction must be resolved first.
- **Severity:** Low-Medium (cross-part energy contradiction).
- **Concrete fix:** give `growthLevel` a transcribing target (e.g. a fraction of the
  last recording level, or a small floor) consistent with `cellEnergy`'s transcribing
  branch; better, derive both from one mode→activity map.
- **TDD property:** at `transcribing`, steady-state growth and energy imply the same
  "active fraction" (within tolerance), not growth→0 while energy>idle.

---

### M14 — [NEW] Nucleus does not share body prolate/elongation OR position drift, so under D4 it will sit as a circle in an ellipse and clip on one axis

- **Where:** `nucleusTransform` (cell.ts:760–814) returns an isotropic disk;
  containment is a fixed circle `safeInner = 0.55·baseR`. Plan F9 fixes the *inward-
  pinch escape* (radial), and research-cellbody Finding 10 notes "if prolate, nucleus
  should share elongation," but **plan v4's F9/F10 do not make the nucleus elliptical
  nor tie its containment to the prolate body** — F9 only threads `min(1+deform)·baseR`.
- **Why it's wrong/missing:** task #6. Once D4 makes the body a prolate ellipse via
  the C2 affine squeeze on the *contour points*, the nucleus disk is NOT squeezed (it
  is drawn as `arc(nx,ny,nr)` cell.ts in the render). A round nucleus inside a thin
  ellipse will touch/cross the minor-axis wall even though its radial containment
  (against a *circle*) passes. F9's clearance is computed against `min(deform)`, not
  against the squeezed minor axis — so D4 + F9 can still let the nucleus poke through
  the *thinned* side. Two phases fight: C2 squeezes the membrane but not the nucleus
  containment frame.
- **Severity:** Medium (D4↔F9 contradiction the plan hasn't caught).
- **Concrete fix:** apply the same affine squeeze to the nucleus centre+radius (make
  it an ellipse with the body's `k,φ`), and compute containment in the squeezed frame
  (clamp in heading-frame coords, not radius). Land with D4/F9.
- **TDD property:** with body prolate `k`, the nucleus ellipse stays inside the
  membrane along BOTH axes (point-in-polygon for the full nucleus boundary), not just
  radially.

---

### M15 — [NEW] No NaN/Inf guards at the boundaries where bad inputs enter (audioLevel/spectrum/dt)

- **Where:** `latestState` is set from external `update(state)` (cell.ts:1361–1363)
  with no validation; `s.audioLevel`, `s.spectrumBins[i]` flow directly into
  `cellEnergy`, `pseudopodOffset`, `buildTargetDeformation`. `noise2D` does
  `Math.floor(x)&255` — a NaN `x` → `NaN&255 = 0` (silently wrong, not crash); an Inf
  `t` → NaN propagates into positions. `parseCellState` validates persisted finite
  values (good) but live state is unguarded.
- **Why it's wrong/missing:** task #4 (NaN/Inf risk, determinism break). A single bad
  frame (NaN audioLevel from a backend hiccup) silently corrupts `deform`
  (integrated → persists across frames via form memory), `growth`, and `baseline` —
  and because `integrateDeformation` carries state, ONE NaN poisons the membrane
  permanently until reload. The plan asserts "pure/deterministic (noise2D only)" but
  never adds input sanitisation at the trust boundary.
- **Severity:** Medium (a poisoned-state hazard, not just a one-frame glitch).
- **Concrete fix:** sanitise at `update()`/tick entry: coerce `audioLevel` to
  `clamp(Number.isFinite(x)?x:0, 0,1)`, replace non-finite bins with 0, and guard the
  integrated `deform` against non-finite (reset to target if poisoned).
- **TDD property:** feeding `audioLevel: NaN` / `spectrumBins:[Infinity,…]` for one
  frame leaves `deform`, `growth`, `baseline` finite and the next clean frame renders
  normally (no permanent poison).

---

### M16 — [NEW] Spectrum bin count is hard-assumed 32 in math but `update()` accepts any length → silent angular misalignment

- **Where:** `buildTargetDeformation`/`buildCellContour` compute
  `binIdx = min(floor(normalized·bins.length), bins.length−1)` (cell.ts:706, 770) —
  works for any length. But CELL_MATH and the default state both assume **32 bins**
  (`new Array(32).fill(0)`, cell.ts:1133). A3's interpolation fix is specified for the
  32-bin case.
- **Why it's wrong/missing:** task #3/#4. If the backend ever sends a different bin
  count, the angular mapping silently rescales (bins still wrap the full circle) but
  the A3 wraparound-interpolation and the "every 3rd vertex" reasoning in the
  deformation review break. No assertion ties the math to the contract.
- **Severity:** Low.
- **Concrete fix:** assert/normalise `bins.length` (resample to a fixed N) at entry,
  or make the contract explicit and validate it.
- **TDD property:** `buildTargetDeformation` with 16, 32, 64 bins yields a continuous
  periodic deform (binDeform(0)==binDeform(2π)) for each.

---

## Inter-phase contradictions the plan v4 has NOT caught (consolidated, task #6)

1. **M1 vs F5/D2:** F5 "preserve memoryless velocity" + D2 "cilia lean ∝ speedNorm"
   together make cilia *followers* of a velocity that is a free constant (`driftSpeed`).
   Nothing closes the loop "beat → thrust → velocity." The plan never states the
   causal direction, so D2/D3/F4 polish a decoupled decoration.
2. **M3 vs F4:** F4's shared stroke axis (R>0.4) makes a stationary-but-beating cell
   visibly "row in place," a new artifact F4 itself creates.
3. **M7 vs D1/D4:** D1's "collapse to isotropic at speedNorm=0" is satisfied only
   because `speedNorm≈drift01` (constant speed makes `vmag/vRef≈1`), i.e. by the
   recording gate, NOT by actual stillness. If speed is ever gated by activity (M1),
   the invariant's justification evaporates.
4. **M13 vs cellEnergy:** `growth` says transcribing is inactive (target 0);
   `cellEnergy` says it's calmly active. Cilia length and FBM swell therefore disagree
   during transcribing.
5. **M14 vs C2/F9:** C2 squeezes the membrane contour; F9 contains the nucleus against
   a radial `min(deform)`. Neither squeezes the nucleus, so a prolate body can clip the
   round nucleus on the minor axis despite F9 passing.
6. **M4 vs the wander rewrite:** persistence still serialises `driftPhase` (consumed
   only by the now-dead `cellDrift`) and omits `wander.x/y/heading` — the persistence
   model was never updated when wander replaced cellDrift.

---

## Items already in plan v4 (anchors only — not re-reported as NEW)

- ciliaAngleJitter clamp (A1), bin interpolation (A3), tanh saturation (B1), area
  normalize/affine squeeze (C1/C2), motion coupling (D1–D5), tip-curvature/bend-cap/
  C¹-beat/shared-axis/decoupled-wander/nucleus-pinch/Brownian-nucleus/contractile-
  vacuole/membrane-band-limit/cellReach (F1–F13), perimeter count (E1), dt-consistent
  ramps (F8). These are confirmed correctly targeted by the prior reviews; M-items
  above are the gaps *between and around* them.

---

## Suggested priority order for the parent

1. **M1 + M2 + M3 + M13 (the activity-coupling cluster)** — define one `act` scalar,
   route all amplitudes + swim speed through it, resolve the recording/transcribing
   disagreement. This is the single biggest model-coherence win and is a *precondition*
   for D1's invariant (M7) to mean anything.
2. **M15 (NaN poison)** — cheap, prevents permanent corruption; do early.
3. **M4 + M5 (persistence/resize seams)** — fix the teleport/snap on reload.
4. **M6 + M9 + M11 (temporal continuity)** — smooth mode/idle/clock transitions.
5. **M12 + M14 (geometry fidelity that fights F1/F9/C2)** — land with the matching F/C
   commits.
6. **M7 + M8 + M10 + M16 (lower-severity polish)**.

## Research gap to flag
`research-fluid-medium-motion.md` (named in the task) is **absent**. The
fluid-medium coupling (drag → speed, beat → thrust, M1/M2/M7) is the least-researched
and most model-critical area. Recommend commissioning it before implementing the M1
activity-coupling cluster, so the beat→thrust mapping rests on sourced low-Re
hydrodynamics rather than eyeballed gains.

---

### Process note
Read-only pass; no source files edited. `progress.md` left untouched (allowed scratch
file; review-only wins over progress-writing). Findings written to
`review-model-deficiencies.md` as instructed.
