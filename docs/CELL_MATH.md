# The Living Cell — Motion & Math Reference

How the `cell` renderer family (`drifting_contour`, `duo_aquarium`,
`euglena_drift`, `didinium_drift`, and related themes) turns a stream of
`ThemeState` (mode + audioLevel + spectrum) into an organism that looks
**alive**: a wobbling membrane, a roaming body, a drifting nucleus, and a crown
of beating cilia.

This is the plain-language companion to the code. The public compatibility
barrel is `src/theme-engine/renderers/cell.ts`, which re-exports the split
implementation under `src/theme-engine/renderers/cell/`. The formulas below map
to exported, unit-tested pure functions; tests live in files such as
`src/theme-engine/renderers/__tests__/cell-cilia.test.ts`,
`cell-contour.test.ts`, `cell-interior.test.ts`, `cell-organelles.test.ts`, and
`cell-public-api.test.ts`.

> **Design rule:** all visual functions are PURE and DETERMINISTIC given their
> inputs (time `t`, audio, params). No `Math.random()`, no `Date.now()` inside
> them — "randomness" comes from sampling **value-noise** (`noise2D`) at stable
> per-element seeds. This makes everything testable and reproducible.

---

## 0. The two clocks and the energy inputs

| Symbol | Meaning | Source |
|--------|---------|--------|
| `t` | continuous time in seconds | `(performance.now() - startedAt)/1000`, monotonic |
| `dt` | real frame delta (clamped 1–50 ms) | between ticks; keeps motion frame-rate independent |
| `audioLevel` | instantaneous loudness 0..1 | backend FFT |
| `energy` | smoothed "liveliness" 0..1 | `cellEnergy()` |
| `growth` | slow accumulator 0..1 | `growthLevel()` — the key to gradual decay |
| `startle` | spike reflex 0..1 | `startleOffset()` |

### energy — `cellEnergy(mode, audioLevel, t, idle, levelGain)`
- idle: `idle·(1 + 0.25·sin(0.8t))` — a faint breathing baseline.
- recording: `clamp(idle + audioLevel·levelGain)` — reacts to voice.
- transcribing: `clamp(0.72·idle + 0.12·audioLevel)` — calmer.

### growth — `growthLevel(prev, audioLevel, mode, attack, release)`
A leaky integrator with **asymmetric rates**:
```
target = recording ? audioLevel : 0
rate   = (target >= prev) ? attack : release      // attack≈0.05, release≈0.012
next   = clamp(prev + (target - prev)·rate)
```
Because `release ≪ attack`, growth **rises fast** when you speak and **falls
slowly** when you stop. This is what makes the cilia/body **shrink gradually**
instead of snapping shut on silence. **Cilia length is driven by `growth`, not
by `audioLevel`, precisely for this smooth decay.**

### activity `a` — `cellActivity(energy, growth)` — the master drive
```
a = clamp(0.6·energy + 0.4·growth, 0, 1)
```
ONE scalar that couples sound to behaviour, so audio → beat → swimming all share
a single envelope (raw `audioLevel` is used for COLOR only). It blends the fast
`energy` with the slow `growth` so the cell reacts promptly but winds down
gracefully. Everything motion-related routes through `a`.

---

## 0.5 Swimming — the low-Reynolds coupling (the biophysical core)

A microscopic swimmer lives at **Reynolds number ≈ 1e-4**: no inertia, no
coasting. Velocity is proportional to the instantaneous ciliary beat, and the
instant the beat stops the cell stops **in the same frame**. The whole chain is:

```
audio → energy/growth → activity a → { beat frequency, swim speed, body prolate }
```

**Beat frequency** rises with activity (`ciliaBeatHzEff`):
```
f_eff = f0 + (f1 - f0)·a            // 0.9 Hz at rest → 1.6 Hz at full voice
curl_eff = curl·(1 + 0.3·a)         // louder = curlier beat
```

**Swim speed** is Stokes-linear in activity (`swimSpeed`):
```
U = a · swimSpeedMaxFrac · min(w,h)   // px/sec; U(0)=0 exactly (no coasting)
```
This `U` replaces the old free `driftSpeed` and drives `wanderStep`. Because
`wanderStep` sets velocity from `heading×speed` **every step** (never `v += a·dt`),
the motion is **memoryless** — silence → `a`→0 → `U`→0 → the cell halts at once,
exactly like a real low-Re swimmer.

**Body prolate** — a swimming ciliate stretches mildly along travel
(`prolateAspect` + the area-preserving affine squeeze):
```
k = 1 + bodyElongation·max(floor, speedNorm)   // floor=0 → ROUND at rest
φ = bodyHeading                                 // long axis aligned to travel
```
The squeeze has **det = 1**, so it elongates the body without changing its area
(it preserves the area that area-conservation §1 holds). `speedNorm` is the swim
speed normalized to its peak; at rest `speedNorm=0` → `k=1` → the body is round
and the squeeze is the identity (back-compatible). `bodyHeading` EMA-chases the
velocity heading along the shortest arc, so the long axis turns gracefully and
is held (not snapped) when the cell is still.

**Cilia drag-lean** — while swimming, viscous drag bends the crown **rearward**
(`ciliaPath` with a motion basis):
```
lean(point) = -tangent · dragCoeff·speedNorm·(0.6 + 0.4·lead) · lenK · sFrac^1.3
```
where `lead = radial·tangent` (leading-face hairs lean more than trailing). The
base is anchored (`sFrac^1.3 = 0` at the base) and the lean vanishes at
`speedNorm = 0`.

All of these collapse to the resting shape when `a = 0` / `speedNorm = 0`, so a
silent cell looks calm and round; a speaking cell swims, elongates, beats faster,
and trails its cilia.

---

## 1. Body shape — the membrane

The outline is a closed loop of `sampleCount` vertices. Radius at angle `θ`:

```
r(θ) = baseR · (1 + deform(θ))
```

- **`resolveBaseRadius(w,h,params,growth)`** — base size. Either an absolute
  `baseRadiusPx` (e.g. 16) or `min(w,h)·radiusFraction`, swollen by growth
  (`·(1 + growthSwell·growth)`).
- **`buildTargetDeformation(...)`** → per-vertex target bumps from: FBM noise
  (organic lumps), audio-driven pseudopods (`pseudopodOffset`), and idle morph.
- **`pseudopodOffset(angle,t,audioLevel,energy,params)`** — amoeboid arms:
  bell-shaped lobes `max(0,cos(θ−θ_lobe))^sharpness` whose direction `θ_lobe`
  drifts slowly via noise (`intentDrift`) and whose height grows with audio.
- **`idleMorph(sampleCount,t,params)`** — at rest, two slowly **travelling**
  noise lobes keep the outline evolving (never frozen). NOT a `cos`-cycle, so
  it never visibly repeats/blinks.
- **Form memory** — `integrateDeformation(prev,target,attack,release)`: the
  shown deformation eases toward the target with fast attack / slow release, so
  shapes hold briefly and melt back instead of jittering.
- **Deformation pipeline** (`integrateDeformPipeline`, 9 ordered steps) wraps the
  form memory with two physically-motivated stages, each behind a default-ON
  gate:
  - **Saturation (B1)** — `d ← Dmax·tanh(d/Dmax)` softly bounds every bump
    (`|d| < Dmax ≈ 0.6`). tanh has unit slope at 0, so small motion is unchanged;
    it just prevents extreme spikes, keeping the radius within the membrane
    budget so the final clamp never fires.
  - **Area conservation (C1)** — after integration, a uniform radial offset
    `c = mean(e) − √(1−Var(e))` (with `e = 1+d`) holds the enclosed area at
    `π·baseR²`. So a bulge on one side **borrows** from the opposite side
    instead of ballooning the whole cell on loud speech (which it used to do,
    +34% at full voice).
- Smoothed into a curve with **`catmullRom`** (Catmull–Rom spline), then a
  **det=1 affine squeeze** (the prolate, §0.5) elongates it along travel without
  changing area, and it is filled with a translucent radial gradient
  ("cytoplasm").
- **Safety** — all external/persistent state is sanitised each frame
  (`sanitizeUnit/Finite/Bins`) so a single NaN/Inf can never permanently poison
  the form memory.

---

## 2. Where the body goes — wander (NOT oscillation)

The cell roams its square aquarium. The motion model is **Craig Reynolds'
"wander" steering behaviour** (`red3d.com/cwr/steer`), implemented in
**`wanderStep(state, dt, w, h, baseR, params)`**.

```
heading += smallRandomDisplacement(noise, dt)   // random walk of direction
vx,vy    = dir(heading) · speed
x,y     += vx,vy · dt                            // INTEGRATE position
on wall: reflect heading (bounce), clamp inside
```

Key point — **why it used to "always come back":** the old code set
`position = noise(t·speed)`, i.e. the coordinate *oscillated about the centre*,
so the cell perpetually returned to the middle. Integrating position along a
slowly-turning heading removes that center-pull: the cell genuinely wanders and
only turns away at the walls.

- `speed = driftSpeed · min(w,h) · 1.2` (px/s, scaled to tank).
- `wanderTurnRate` — how curvy/restless the path is (rad/s of the random walk).
- Containment uses **`cellReach(baseR,params)`** = how far the whole organism
  extends (membrane + longest cilia + startle), so nothing clips the wall.
- `driftActivation()` ramps drift 0→1 while recording, so the cell rests
  centered and only roams when active.

---

## 3. The nucleus

**`nucleusTransform(t, audioLevel, baseR, params)`** — a denser organelle that
slowly wanders inside the body (2-D noise offset, `nucleusDrift`) and pulses
its radius with audio (`nucleusPulse`). Drawn as a warm radial gradient,
clamped so it never pokes through the membrane.

---

## 4. The cilia (the crown of "усики") — the biologically-modelled part

Sources: Gompper/Elgeti, *Multi-Ciliated Microswimmers* (Eur. Phys. J. E
2021); Cass & Bloomfield-Gadêlha, *Reaction-diffusion basis of flagellar
beating* (Nat. Commun. 2023); CiliaQ / "Intrinsic Diversity in Primary Cilia"
for natural length variation; CiliaSim for **aperiodic** placement.

Each cilium is a **multi-segment spine** (polyline of `ciliaSegments+1` points),
produced by **`ciliaPath(cx,cy,baseR,t,energy,growth,params)`**, returning
`{ points, width }` per hair.

### 4.1 How many and where — count & aperiodic spacing
- Count = `ciliaCount`. Mean angular gap `gap = 2π/n`.
- **Irregular placement:** each hair is offset from the even grid by a stable
  per-hair noise jitter:
  ```
  baseAngle(k) = k·gap + noise2D(k·12.9898, 7.2)·ciliaAngleJitter·gap·0.5
  ```
  `ciliaAngleJitter=0` → perfectly even (mechanical); `~0.55` → aperiodic crown
  like a real organism. Bounded < half-gap so hairs keep their order.

### 4.2 How big — diverse length & thickness
Real cilia are **not** uniform. Per hair `k`, a stable random scalar
`r01 = noise2D(k·3.7+0.3, 1.3)·0.5+0.5 ∈ [0,1]` drives:
```
lenMean = baseR · (ciliaLength + growth·ciliaGrowthBoost) · (0.55 + 0.45·energy)
lenK    = lenMean · (1 − ciliaLengthVar + 2·ciliaLengthVar·r01)
```
- `ciliaLengthVar≈0.5` → hairs span roughly ±50% around the mean (diverse).
- **`lenMean` uses `growth` (smoothed) → cilia recede gradually on silence.**
- Thickness `width = ciliaWidth·(0.55 + 0.9·mix(r01, r01b))` — its own variation,
  loosely correlated with length, drawn per-hair via `ctx.lineWidth`.

### 4.3 How they beat — asymmetric two-phase cycle
**`ciliaBeatPhase(t, index, params)`** returns a phase ∈ [0,1) that advances
**non-uniformly** in time, mirroring real cilia:
- **power stroke** (phase 0→0.5): fast, hair is straighter (a quick "oar pull");
- **recovery stroke** (phase 0.5→1): slow, hair is strongly curved (folds back).
```
powerTime = (1 − ciliaAsymmetry)/2     // fraction of the period in power
phase = u<powerTime ? 0.5·(u/powerTime)        // quick
                    : 0.5 + 0.5·((u−powerTime)/(1−powerTime))  // slow
```
`ciliaAsymmetry=0` → symmetric sine; `0.6` → biological. Beat rate is
`ciliaBeatHz` (Hz).

### 4.4 How the crown moves together — metachronal wave
Neighbouring cilia are phase-shifted by `ciliaMetachronal` (radians per index),
so a wave sweeps around the crown ("like a Mexican wave"), instead of every
hair beating in unison. A small per-hair seed (`+r01·0.6`) further desyncs
neighbours so it never looks lock-step.

### 4.5 The bend wave along each hair (base → tip)
Along arclength `s ∈ [0,1]` (0 = base on membrane, 1 = tip):
```
along = baseR + lenK·s
wave  = sin(2π·(waves·s − phase))          // hump travels outward over time
amp   = ciliaCurl·lenK·0.6·s^1.2·(0.4+0.6·recovery)   // anchored at base, grows to tip
bend  = (wave·0.7 + beat·0.3)·amp          // transverse offset (⊥ to radial axis)
point = center + radial·along + perp·bend
```
`s^1.2` taper keeps the base anchored (a hair can't detach); curvature peaks
shift outward over time → the spine visibly **beats**. The polyline is then
Catmull-Rom-smoothed when stroked.

---

## 5. Reflex — startle

**`startleOffset(prev, level, baseline, sensitivity, decay)`** detects a sharp
audio onset (rising edge over a slow `baseline`) and makes the whole cell
**dart** a few px in a noise-chosen direction, springing back via `decay`.
Adds life on sudden loud syllables.

---

## 6. Persistence (continuity across restarts)

`serializeCellState` / `parseCellState` / `restoreSeed` save `{driftPhase,
growth, elapsed}` to `localStorage` so the cell resumes its phase and size
seamlessly after an overlay reload, rather than popping back to a cold start.

---

## 7. Parameter cheat-sheet (cilia)

| Param | Effect | Default |
|-------|--------|---------|
| `ciliaCount` | number of hairs | 18 |
| `ciliaLength` | resting length (×baseR) | ~0.4 |
| `ciliaGrowthBoost` | extra length from growth | ~0.55 |
| `ciliaLengthVar` | per-hair length diversity (0=uniform, .5=±50%) | 0.5 |
| `ciliaAngleJitter` | irregular spacing (0=even, ~.55=aperiodic) | 0.55 |
| `ciliaWidth` | base stroke width (px) | 1.6 |
| `ciliaCurl` | how strongly hairs bow | 0.7 |
| `ciliaBeatHz` | beat frequency (cycles/s) | 0.9 |
| `ciliaAsymmetry` | power/recovery skew (0=sine, →1=biological) | 0.6 |
| `ciliaMetachronal` | phase lag between neighbours (rad) | 0.8 |
| `ciliaSegments` | spine points per hair (smoothness) | 6 |

Body/motion: `baseRadiusPx`, `radiusFraction`, `growthAttack`,
`growthRelease` (↓ = slower decay), `driftSpeed`, `wanderTurnRate`,
`driftMargin`, `startleSensitivity/Decay/MaxPx`, `idleMorph*`.

Tune any of these live in the **Visual Harness** (`bun run harness` →
`/harness.html`, Params JSON box). See [`THEME_EDITING.md`](./THEME_EDITING.md).
