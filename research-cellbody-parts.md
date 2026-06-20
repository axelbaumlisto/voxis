# Research: Biophysical pass on every NON-CILIA part of a swimming protist cell

Scope: MEMBRANE/pellicle, CYTOPLASM, NUCLEUS, NUCLEOLUS, CONTRACTILE VACUOLE,
and BODY GEOMETRY / MOTION (direction, inertia, speed). Target = the
`drifting_contour` cell renderer (`src/theme-engine/renderers/cell.ts`).

Tool legend per claim: **[fetch:Paramecium]**, **[fetch:Membrane]**,
**[fetch:CV]** (Contractile vacuole), **[fetch:Microswimmer]**,
**[code]** (read of cell.ts / CELL_MATH.md / plan), **[derived]** (my
calculation from sourced constants). web_search providers were down; all
external facts are from `fetch_content` on the named Wikipedia primary pages.

---

## Summary

A swimming ciliate (the only protist that swims with cilia, e.g. *Paramecium*)
is a **stiff-but-elastic, prolate "slipper/cigar"** ~50–300 µm long with a
**~3–4:1 aspect ratio** that swims **along its long axis with a helical roll**
**[fetch:Paramecium]**. It lives at **Reynolds number ≈ 10⁻⁴–10⁻³**, so there is
**effectively no inertia**: when propulsion stops the body halts within
**~microseconds over a sub-micron, sub-Ångström coasting distance** — no glide,
no momentum **[fetch:Microswimmer][derived]**. The renderer's biggest accuracy
gaps for the non-cilia parts are: (1) the body is rendered as a near-circular
FBM blob with **amoeboid pseudopods** (wrong organism class for a cilia-bearing
swimmer); (2) the silhouette/nucleus do **not orient to the heading**; (3) there
is **no contractile vacuole** at all; (4) the nucleus "wander/jiggle" is far
larger than any real Brownian motion of a 10–50 µm organelle. Notably,
`wanderStep` does **NOT** carry false momentum (velocity is recomputed from
heading every frame), so the low-Re "instant stop" is already structurally
satisfied — the inertia risk is in the multi-second `driftActivation` ramp, not
in the integrator.

---

## Findings

### 1. BODY GEOMETRY — silhouette, aspect ratio, rigidity, membrane wobble

1. **Real silhouette is prolate slipper/cigar, NOT a near-circle.** *Paramecium*
   cells are "typically ovoid, elongate, or foot- or cigar-shaped," 0.06–0.3 mm
   long **[fetch:Paramecium]**. Eyeballing the canonical *P. caudatum* slipper,
   length:width ≈ **3–4:1** (prolate). Our contour is a circle of radius
   `baseR·(1+deform)` sampled at 96 even angles with no axial elongation
   **[code: buildCellContour, tick loop]**. → **NEEDS-CORRECTION**: introduce a
   fixed prolate aspect (area-preserving) — exactly the plan's D4 "mild fixed
   `elong≈0.12–0.15`" via the C2 affine squeeze.
   - Corrected geometry (area-preserving prolate, heading frame):
     `rotate(p,−φ); x*=k; y/=k; rotate(p,+φ)`, with `k=√(aspect)` and
     `aspect∈[1.6,2.2]` for a *stylised* ciliate (real 3–4:1 is visually extreme
     at 160×160) **[derived from fetch:Paramecium ratio]**.
   - **TDD**: `shoelaceArea(prolateContour) ≈ shoelaceArea(circle) ±1%`; minor
     axis perpendicular to `φ`; `k=1 ⇒ identity`.

2. **Pellicle is "stiff but elastic" — low wobble, NOT amoeboid pseudopods.**
   The body is enclosed by a **pellicle** = outer plasma membrane + alveolar
   sacs + inner epiplasm, "a stiff but elastic structure … textured with
   hexagonal or rectangular depressions," one cilium per polygon
   **[fetch:Membrane via Paramecium; fetch:Paramecium]**. A ciliate does **not**
   throw pseudopods; pseudopods are an **amoeba** trait (no motile cilia). Our
   `pseudopodOffset` injects two amoeboid lobes, and `cellRadius` adds
   multi-octave FBM lumps (`octaves:4, lacunarity:2.3`) → **high spatial-frequency
   membrane noise** **[code: pseudopodOffset, cellRadius, CELL_DEFAULTS]**.
   → **NEEDS-CORRECTION for a ciliate**; acceptable only as declared "stylised
   alive" license (the plan already flags pseudopods + D4/D5 as amoeba/animation
   license).
   - Membrane mechanics: a lipid-bilayer/pellicle resists **bending** (curvature)
     and **area dilation (tension)**. Physically, a tense, bending-stiff shell
     suppresses short-wavelength undulations and permits only **low-mode,
     low-amplitude** shape fluctuations (long-wavelength, small bumps)
     **[fetch:Membrane (bending/tension concept)][derived]**. Plausible wobble
     spectrum: **modes n≈2–4, amplitude ≲5–8 % of radius**; the current FBM with
     4 octaves and `membraneAmplitude:0.35` over-weights high-n detail.
   - Corrected wobble: band-limit the deformation to low angular modes and cap
     amplitude. Practically: drop FBM octaves to **1–2** for a ciliate skin, or
     low-pass the 96-vertex `deform[]` (the repo already exposes `lowpassRadii`),
     and set membrane wobble amplitude ≤0.08 at rest.
   - **TDD**: FFT of resting `deform[]` has **>90 % power in modes |n|≤4**;
     `max|deform| ≤ 0.08` at `energy=idle`.

3. **Amoeba contrast (for the "amoeba mode" answer).** True amoebae are
   deformable, crawl by pseudopods, and have **no motile cilia**
   **[fetch:Microswimmer: protist locomotion]**. So our FBM+pseudopod model is
   **realistic for an amoeba but contradicts the cilia crown** the same renderer
   draws. The cell is a chimera; pick a lane per theme or keep it explicitly
   stylised. (Matches the plan's "CRITICAL biology finding".)

### 2. DIRECTION & MOTION — orientation vs velocity, helical roll, turning

4. **Swims along the long axis with a helical roll; body axis tracks velocity.**
   "A *Paramecium* spirals through the water as it progresses"; cilia beat in
   metachronal waves "like wind across a field of grain" **[fetch:Paramecium]**.
   The long (prolate) axis is the **swimming axis** and is aligned with the
   velocity vector. Our prolate axis is absent and the body never rotates toward
   `wander.heading` **[code: tick draws circle at (cx,cy)]**. → **NEEDS-CORRECTION**:
   set the D4 prolate axis `φ = atan2(vy,vx) = wander.heading` so the cigar points
   where it travels.
   - **TDD**: with `wander.vx,vy` fixed, the contour's major-axis angle equals
     `atan2(vy,vx) ±1e-3`; at `speedNorm=0`, body returns to isotropic (no
     preferred axis), so resting frames are unchanged.

5. **Turning / "tumbling" analog = the avoidance reaction.** On hitting an
   obstacle the cilia reverse the effective stroke, the cell **swims backward
   briefly, then turns and resumes** **[fetch:Paramecium]**. This is the ciliate
   equivalent of bacterial run-and-tumble (run-and-reverse-and-turn). Our wall
   handling is a **specular heading reflection** (`heading = π−heading` / `−heading`)
   **[code: wanderStep wall bounce]**. → **PARTIALLY VERIFIED**: a direction
   change at the boundary is biologically correct in spirit, but a mirror bounce
   is an elastic-collision metaphor (inertial). A more faithful avoidance is
   "stop → reverse a little → pick a new heading offset," not a specular bounce.
   - Corrected (optional): on wall contact, set `heading += π ± rand·0.6` (back-up
     + reorient) rather than reflecting about the wall normal.
   - **TDD**: post-contact heading differs from pre-contact by **>90°**; cell
     does not penetrate the wall inset.

### 3. INERTIA — Re≪1, no coasting, Stokes stop time (the headline physics)

6. **Reynolds number ≈ 10⁻⁴ (bacteria) to ~10⁻³–10⁻² (ciliate); viscosity
   dominates, inertia is negligible.** "Inertia is important for … fish (Re=100)
   while viscosity dominates the motion of microscale swimmers like bacteria
   (Re=10⁻⁴)" **[fetch:Microswimmer]**. → For any cell we render, **Re≪1**.

7. **No coasting: stop time ~1 µs, coasting distance ~0.1 Å (bacterium).**
   Purcell, quoted verbatim: "the inertial coasting time of a micron-sized object
   is on the order of **1 µs**. The coasting distance of a microorganism moving at
   a typical speed is about **0.1 Ångström**" **[fetch:Microswimmer]**. When the
   cilia stop, the body stops **in the same instant** at rendering timescales.
   - **Quantified Stokes drag stop time** (velocity relaxation of a sphere):
     `τ = m/(6πηr) = (2 ρ r²)/(9 η)` **[derived; Stokes drag F=6πηru from
     fetch:Microswimmer]**.
     - Bacterium r=0.5 µm, ρ=1000 kg/m³, η=10⁻³ Pa·s → `τ ≈ 5.6×10⁻⁸ s` (≈56 ns;
       Purcell's "~µs" order). Coasting `d=v·τ`: at v=30 µm/s → **d≈1.7×10⁻¹² m
       ≈0.017 Å** (matches Purcell's ~0.1 Å order) **[derived]**.
     - *Paramecium* r≈50 µm → `τ ≈ 5.6×10⁻⁴ s` (~0.5 ms); at v=1 mm/s →
       **d≈0.6 µm**, i.e. **<0.3 % of a 200 µm body length** **[derived]**.
   - Conclusion: **decel must be effectively instant**; any glide longer than a
     frame is unphysical.

8. **Does `wanderStep` wrongly imply inertia/momentum? — Mostly NO (VERIFIED),
   with one caveat.** `wanderStep` recomputes `vx=cos(heading)·speed`,
   `vy=sin(heading)·speed` **every frame** and does `x+=vx·dt`. It never does
   `v += a·dt`; there is **no momentum state**, so velocity is memoryless and
   tied to instantaneous propulsion — exactly the overdamped low-Re behaviour
   **[code: wanderStep]**. If `speed→0` the cell stops the same frame. → **This is
   correct and should be preserved.** The `vx,vy` fields are outputs, not
   integrated momentum.
   - **CAVEAT / FLAG (NEEDS-CORRECTION, but it's not in `wanderStep`):** the
     **`driftActivation`** ramp blends the whole organism between centre and
     wander position at `rate=0.02` (~3 s to 90 %) **[code: driftActivation, tick
     blend `driftedX/Y`]**. When recording stops, the cell **slides back to centre
     over ~3 s** — that reads as **coasting/inertia**, which is exactly what low-Re
     forbids. It's an artistic "rest-centring," not physics. Keep it only if
     declared non-physical; otherwise a real cell would simply stop wherever it
     is.
   - **Wall bounce caveat:** specular reflection is an elastic (inertial)
     metaphor (see Finding 5); low-Re reorientation is drag-limited, not a
     rebound. Minor.
   - **TDD**: (a) feeding `speed=0` (or `driftSpeed=0`) ⇒ `wanderStep` returns
     `vx=vy=0` and `x,y` unchanged within `dt` (no residual drift) — proves no
     momentum. (b) No persisted velocity field is integrated across frames
     (assert the function is a pure map of `heading→v`, not `v→v`).

### 4. SPEED — magnitudes and turn rates

9. **Typical swim speeds (body-lengths/s).** From the microswimmer table
   **[fetch:Microswimmer]**: *Tetrahymena* (25×50 µm) **>500 µm/s**;
   *Chlamydomonas* (10×10 µm) **150 µm/s**; bovine sperm 100 µm/s; *E. coli*
   30 µm/s. *Paramecium* (not in the table) swims ~**1–3 mm/s** in the classic
   literature; with body length ~200 µm that is **~5–15 body-lengths/s**
   **[derived from fetch:Paramecium body size + standard speed]**. Useful
   normalisation: **Tetrahymena ≈ 10 body-lengths/s; Chlamydomonas ≈ 15 BL/s.**
   - Our `speed = driftSpeed·min(w,h)·1.2` is a tank-relative artistic speed,
     decoupled from real µm/s **[code: wanderStep]** — fine for a visualiser, but
     it should be **continuous and small** (a cell cruises, it doesn't sprint),
     and ideally **gated by ciliary activity/energy** so "more beating ⇒ faster,"
     "no beating ⇒ stopped" (Finding 7).
   - **Turn / roll rate:** helical roll is on the order of **~1–2 Hz** body
     rotation while cruising **[derived from fetch:Paramecium "spirals through the
     water"]**. `wanderTurnRate:1.1 rad/s` is in a believable band for slow
     heading change.
   - **TDD**: path speed scales linearly with `driftSpeed`; with energy gating,
     `speed(energy=0)=0` and `speed` monotonic in energy.

### 5. NUCLEUS, NUCLEOLUS, CONTRACTILE VACUOLE, CYTOPLASM

10. **Nucleus size & position.** Ciliates have a **dual nuclear apparatus**: a
    large **macronucleus** (vegetative, often kidney/ellipsoid, centrally placed)
    plus one or more small **micronuclei** **[fetch:Paramecium]**. The macronucleus
    is a **substantial, roughly central** body. Our `nucleusRadius:0.28·baseR`
    (diameter ≈0.56·baseR) drawn near centre is **plausible in size**
    **[code: nucleusTransform, CELL_DEFAULTS]**. → **VERIFIED (size/position)**,
    with a shape note: the real macronucleus is **ellipsoidal**, not a perfect
    disc; if D4 makes the body prolate, the nucleus should share that elongation.
    - **TDD**: nucleus stays within membrane (`offsetMag ≤ baseR·0.55 − r`,
      already enforced); if prolate, nucleus aspect tracks body aspect.

11. **Does the nucleus move / jiggle (Brownian)? — Largely NO for a big nucleus
    (NEEDS-CORRECTION).** Brownian displacement is set by Stokes–Einstein
    `D = kT/(6πηr)` **[fetch:Brownian motion (Einstein relation)]**. For a 50 µm
    macronucleus: `D ≈ (1.38e-23·300)/(6π·1e-3·2.5e-5) ≈ 8.8×10⁻¹⁵ m²/s ≈
    9×10⁻³ µm²/s` **[derived]** → RMS drift `√(4Dt) ≈ 0.19 µm in 1 s`: visually
    **immobile**. Even a 5 µm organelle gives `D≈0.09 µm²/s` (sub-µm/s). So a
    large nucleus essentially **does not jiggle**; what *does* move in a ciliate is
    **cytoplasmic streaming (cyclosis)** carrying **food vacuoles** around the
    cell **[fetch:Paramecium: "cyclosis / cytoplasmic streaming"]**, not the
    macronucleus. Our `nucleusWander:0.14·baseR` + `nucleusDrift` noise gives the
    nucleus a **large, non-Brownian wander** **[code: nucleusTransform]**.
    → **NEEDS-CORRECTION**: shrink nuclear drift to a near-zero, slow micro-jiggle
    (a few % of `baseR` at most), or re-task the "wandering blob" as a streaming
    **food vacuole**, not the nucleus.
    - Corrected: `nucleusWander ≲ 0.03`, very slow; reserve visible intracellular
      motion for vacuole/streaming particles.
    - **TDD**: nuclear centre RMS displacement per second ≤ `0.03·baseR`;
      nucleus does not visibly orbit.

12. **Nucleolus.** Our nucleolus = bright dot at `0.22·nucleus_r` at the nuclear
    centre **[code: tick nucleolus draw]**. A nucleolus is an internal sub-body
    ~20–30 % of nuclear diameter — **plausible** as a generic eukaryote cue.
    Caveat: *Paramecium*'s macronucleus does not present a single tidy nucleolus
    (nucleoli are numerous/dispersed) **[fetch:Paramecium][derived]**; for a
    generic "alive cell" it's acceptable. → **VERIFIED as stylised**; consider
    off-centring it slightly for realism.
    - **TDD**: nucleolus radius ∈ [0.18,0.3]·nucleus_r; fully inside nucleus.

13. **CONTRACTILE VACUOLE — periodic fill/expel; currently MISSING (GAP →
    NEEDS-ADD).** The CV "expels water by contracting; growth (water gathering)
    and contraction (expulsion) are **periodical**. **One cycle takes several
    seconds**, depending on species and osmolarity." Fill phase = **diastole**,
    expel = **systole** **[fetch:CV]**. *Paramecium* CV **average diameter ≈
    13 µm** (Amoeba ≈45 µm; Chlamydomonas ≈1.5 µm); *P. aurelia* has **2 CVs**,
    Amoeba has 1 **[fetch:CV]**. In *Paramecium* the CV sits at a fixed position,
    surrounded by radial canals; it **rounds up as it fills then collapses to a
    pore** at systole **[fetch:CV, fetch:Paramecium]**. Our renderer draws **no
    CV** **[code: tick — only membrane, cilia, nucleus, nucleolus]**.
    → **GAP**: add 1–2 small vesicles near the periphery that **swell over a
    ~5–10 s diastole then snap to ~0 at systole**.
    - Suggested model (pure/deterministic): with phase `u=(t/Tcv) mod 1`,
      `Tcv∈[5,10] s`; `r_cv = R_max·smoothstep(0,0.85,u)` during diastole then a
      fast collapse `r_cv→0` over `u∈[0.85,1]`. `R_max ≈ 0.18·baseR`
      (scaled from 13 µm CV in a ~120 µm-wide *Paramecium*) **[derived from
      fetch:CV diameters]**. Place at a fixed sub-membrane point (not centre).
    - **TDD**: `r_cv(u=0⁺)=0`, monotonic rise to `R_max` near `u≈0.85`, then
      `r_cv(u→1⁻)→0` (systole); period within ±5 % of `Tcv`; CV stays inside
      membrane; count = `cvCount` (default 1–2).

14. **CYTOPLASM.** Rendered as a translucent radial gradient fill
    **[code: tick cytoplasm grad]** — qualitatively fine. The one biology cue
    missing is **cyclosis**: slow circulation of granules/food vacuoles
    **[fetch:Paramecium]**. Optional: a few faint particles advecting along a slow
    closed loop. → **VERIFIED (adequate)**; cyclosis is a nice-to-have.

---

## Direct contradiction flags (wanderStep / nucleusTransform / buildTargetDeformation vs low-Re biophysics)

- **`buildTargetDeformation` / `cellRadius` / `pseudopodOffset`** — inject
  **amoeboid pseudopods + high-spatial-frequency FBM** onto a body that
  simultaneously wears a **motile-cilia crown**. Biologically a swimmer with cilia
  is a **ciliate** with a **stiff pellicle**: it should show **low-mode,
  low-amplitude** wobble and **no pseudopods**. *(Contradiction: organism class +
  membrane stiffness.)* → band-limit deformation, drop/zero pseudopods for the
  ciliate theme. **[code][fetch:Paramecium][fetch:Membrane]**
- **`buildCellContour` / contour build** — **isotropic circle**, no prolate axis,
  no heading alignment. A real swimmer is **prolate and points along velocity**.
  *(Contradiction: shape + orientation.)* → D4 fixed prolate with `φ=heading`.
  **[code][fetch:Paramecium]**
- **`nucleusTransform`** — nuclear `nucleusWander:0.14·baseR` + noise drift is
  **orders of magnitude larger than Brownian motion** of a 10–50 µm nucleus
  (`D~0.01 µm²/s`). *(Contradiction: organelle should be ~immobile.)* → shrink to
  ≤0.03·baseR micro-jiggle, or relabel as a streaming food vacuole.
  **[code][fetch:Brownian motion][derived]**
- **`wanderStep` — NO momentum bug (this one is CORRECT).** Velocity is recomputed
  from heading each frame; there is no `v+=a·dt`, so the cell cannot coast. Keep
  it. The inertia-like artifact lives in **`driftActivation`** (multi-second
  re-centring) and in the **specular wall bounce**, both of which read as inertia
  and should be re-cast as drag-limited (instant) behaviours if physical accuracy
  is wanted. **[code]**

---

## Verified-vs-correction scorecard

| Topic | Verdict | Key correction |
|---|---|---|
| Body silhouette (prolate) | NEEDS-CORRECTION | fixed area-preserving prolate, aspect ~1.6–2.2 (stylised; real 3–4:1) |
| Membrane stiffness / wobble | NEEDS-CORRECTION | band-limit to modes |n|≤4, amp ≤0.08; drop pseudopods for ciliate |
| Orientation tracks velocity | NEEDS-CORRECTION | prolate axis `φ=heading` |
| Turning / avoidance | PARTIAL | back-up+reorient instead of specular bounce |
| No inertia / instant stop | VERIFIED (in `wanderStep`) | preserve memoryless v; fix `driftActivation` ramp + bounce metaphor |
| Stokes stop time | QUANTIFIED | τ≈µs–0.5 ms, d≈0.02 Å–0.6 µm (≪ body) |
| Swim speed | VERIFIED-as-stylised | gate speed by energy; keep continuous & small |
| Nucleus size/position | VERIFIED | make ellipsoidal if body prolate |
| Nucleus Brownian jiggle | NEEDS-CORRECTION | shrink wander ≤0.03·baseR (big nucleus ≈ immobile) |
| Nucleolus | VERIFIED-as-stylised | optional off-centre |
| Contractile vacuole | GAP / NEEDS-ADD | 1–2 peripheral vesicles, ~5–10 s diastole→systole cycle, R_max≈0.18·baseR |
| Cytoplasm | VERIFIED | optional cyclosis particles |

---

## Sources

- **Kept: *Paramecium* — Wikipedia** (https://en.wikipedia.org/wiki/Paramecium)
  — primary source for silhouette (ovoid/cigar/slipper, 0.06–0.3 mm), stiff-but-
  elastic pellicle + alveoli + epiplasm, one cilium per pellicle polygon,
  helical/spiral swimming, two-phase ciliary beat, avoidance reaction, dual
  nuclear apparatus (macro/micronucleus), cyclosis, CV osmoregulation.
- **Kept: Microswimmer — Wikipedia** (https://en.wikipedia.org/wiki/Microswimmer)
  — Re≈10⁻⁴ for microbes, Purcell coasting time ~1 µs / distance ~0.1 Å, Stokes
  drag `F=6πηru` and spheroid drag, scallop theorem, speed/size table
  (Tetrahymena >500 µm/s, Chlamydomonas 150 µm/s). Stands in for "Life at Low
  Reynolds Number" (Purcell 1977 is its cited core).
- **Kept: Contractile vacuole — Wikipedia**
  (https://en.wikipedia.org/wiki/Contractile_vacuole) — periodic diastole/systole
  cycle "several seconds," CV diameters (Paramecium 13 µm, Amoeba 45 µm,
  Chlamydomonas 1.5 µm), CV counts per species, fixed-position pore in Paramecium.
- **Kept: Cell membrane — Wikipedia** (https://en.wikipedia.org/wiki/Cell_membrane)
  — bilayer/tension/bending context for the pellicle's low-amplitude wobble.
- **Kept: Brownian motion — Wikipedia**
  (https://en.wikipedia.org/wiki/Brownian_motion) — Stokes–Einstein `D=kT/6πηr`
  used to show a 10–50 µm nucleus is effectively non-diffusing.
- **Kept (code): `src/theme-engine/renderers/cell.ts`, `docs/CELL_MATH.md`,
  `.pi/plans/cell-bio-accuracy-plan.md`** — the model under audit.
- **Dropped: Cell nucleus — Wikipedia** — fetched but not needed beyond N:C
  generalities; Paramecium page covered the ciliate macronucleus directly.
- **Dropped: the huge synthetic-microswimmer / biohybrid sections of the
  Microswimmer page** — irrelevant to a natural protist visual.

---

## Gaps / next steps

- **No exact Paramecium swim-speed citation in the fetched pages.** I used the
  well-known ~1–3 mm/s figure as [derived] from body size; a primary
  measurement (Machemer; Jung et al.) would firm up the body-lengths/s number.
- **No exact CV period number** beyond "several seconds" **[fetch:CV]**; species-
  and osmolarity-specific periods (e.g. Paramecium ~6–10 s in freshwater) would
  let us pin `Tcv` precisely. Allen 2000 (BioEssays) and Stock et al. 2002 (cited
  on the CV page) are the primary follow-ups.
- **Membrane bending stiffness / fluctuation spectrum** is argued qualitatively
  from tension+bending; a quantitative undulation-mode amplitude for a pellicle
  (vs a bare bilayer κ≈20 kT) would let us set the wobble cap from first
  principles rather than by eye.
- **Macronucleus exact volume fraction** not pinned; "substantial, central" is
  from the diagram. A morphometric source would refine `nucleusRadius`.
- All corrections above are pure/deterministic and map cleanly onto the plan's
  existing C2 (affine squeeze) and gating scaffolding; the only genuinely new
  asset is the **contractile vacuole** (Finding 13).
