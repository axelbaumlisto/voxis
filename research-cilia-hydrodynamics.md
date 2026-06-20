# Research: Biophysics of Ciliary/Flagellar Motion for Accurate 2D Cell-Swimmer Visualization

**Scope:** Concrete, implementable math + parameter ranges for the `cell` renderer
(`src/theme-engine/renderers/cell.ts`), cross-checked against
`.pi/plans/cell-bio-accuracy-plan.md` and `docs/CELL_MATH.md`.

> **Tooling note (read this):** All AI web-search providers were unavailable at run
> time — **Exa returned `NO_MORE_CREDITS`, no Perplexity API key, Gemini API disabled
> (403)**. I therefore could **not** run `web_search`. Instead I fetched primary
> sources directly with `fetch_content` (Wikipedia + NCBI PMC full text), which
> worked. Coverage is good but I could not do broad keyword discovery; a few
> quantitative claims (exact Paramecium aspect ratio, exact inter-ciliary spacing)
> rest on one or two sources and are flagged in **Gaps**.

---

## Summary

At low Reynolds number a motile cilium **bends downstream** (toward the rear,
opposite the swimming direction), with tip lean **linear in swimming speed** and
saturating once the cilium aligns with the flow. The effective (power) stroke must
point **opposite to the swim direction** to drive the cell forward. Neighboring
cilia beat with a constant phase lag producing a **metachronal wave**; the wave's
direction relative to the effective stroke defines its type (symplectic = same
direction, antiplectic = opposite, dexioplectic/laeoplectic = perpendicular). Real
**Paramecium is dexioplectic** with wavelength **≈ 4–7 cilia (~10–30 µm)**. Its body
is a **fixed, rigid, prolate "cigar/slipper" (~3–4 : 1)** that does **not** elongate
with speed; volume is conserved. Cilia number ≈ **4000**, one per pellicle polygon,
spacing **d ≈ 1–3 µm < cilium length L ≈ 10–12 µm**; count scales with **surface area
(∝ R²)**, i.e. with **perimeter (∝ R)** in a 2-D rim projection.

---

## Findings (prioritized formulas + parameters)

### 1 — DRAG / VISCOUS LEAN (validates plan D2, B1)

**1a. Direction of lean.** Under an external flow `V` (which, for a translating cell,
is just the relative flow `−v_swim` over the body), a cilium's *average* position is
**curved in the direction of the flow**; it beats **faster and straighter along the
flow** and **slower and more curved against it**. So in the cell frame, every cilium
**leans toward the rear** (downstream of `−v_swim`). The plan's downstream offset
`−(tx,ty)·dragGain` is correct in sign.
[Guirao & Joanny, *Biophys. J.* 2007 (PMC1861806), "Left-right beating symmetry breaking"](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1861806/)

**1b. Tip displacement vs speed — usable formula.** The static balance of viscous
drag (per length `w = ξ⊥·U`) against elastic restoring of a clamped slender filament
(bending rigidity `κ`) is a cantilever under uniform load:

```
δ_tip ≈ (ξ⊥ · U · L⁴) / (8κ)            # transverse tip lean, low-Re, small angle
δ_tip / L ≈ (ξ⊥ L³ / 8κ) · U           # normalized: lean fraction LINEAR in speed U
```

- **Linear in U** is the defining low-Re behavior (Stokes flow has no inertia; force
  ∝ velocity). This is the biological justification for `dragGain ∝ speedNorm`.
- **Saturation at high U:** as the cilium aligns with the flow it presents its
  *edge*, so drag drops from `ξ⊥` to `ξ∥` (≈ half, see 1c). Lean therefore
  **saturates** — a `tanh`/soft-clamp is biologically motivated, **validating plan B1
  / D2's bounded offset**. Use `δ_tip = δ_max·tanh(k·U)`.
- Parameters for intuition (Paramecium cilium): `L ≈ 12 µm`, `κ ≈ 4×10⁻²² N·m²`
  (≈20 microtubules), `ξ⊥ ≈ 10–35 × η_water`.
[Guirao & Joanny 2007, "Axonemal beating" numerical section (PMC1861806)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1861806/)

**1c. Drag anisotropy (why the oar works).** Resistive-force theory for a slender
body gives perpendicular drag ≈ **2×** tangential drag:

```
ξ⊥ / ξ∥ ≈ 2          # slender filament; exact value is log-dependent on aspect ratio
F_⊥ = 6π·((3 + 2·a/b)/5)·μ·U ,  F_∥ = 6π·((4 + a/b)/5)·μ·U   # spheroid, axes a,b
```

This anisotropy is the *entire* reason a power stroke (broadside, high drag) nets
more thrust than the recovery stroke (edgewise, low drag) — the basis of the plan's
`ciliaAsymmetry` two-phase beat.
[Wikipedia, *Microswimmer* — drag on spheroids/slender bodies](https://en.wikipedia.org/wiki/Microswimmer);
[Lauga & Powers 2009, *Rep. Prog. Phys.* 72:096601](https://arxiv.org/abs/0812.2887)

**1d. Leading vs trailing asymmetry.** Effective stroke ≈ **9 ms** (fast, stiff),
recovery ≈ **26 ms** (slow, curled) in *Paramecium* — a **~1 : 3 time ratio** (power :
recovery). This maps directly to `ciliaAsymmetry`: power fraction ≈ 0.25.
Beat frequency **≈ 30 Hz** in water (the plan's default `ciliaBeatHz = 0.9` is an
artistic slow-down, fine for a visualizer — see Gaps).
[Guirao & Joanny 2007, Introduction (PMC1861806)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1861806/)

**1e. Frequency drops with viscosity** (if you ever couple beat rate to a "thickness"
param): `f ≈ 28 Hz (η_w) → 19 Hz (2η_w) → 14 Hz (3η_w)`, roughly linear in
`log(η/η_w)`.
[Guirao & Joanny 2007, Table 1 (PMC1861806)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1861806/); Machemer 1972, *J. Exp. Biol.* 57:239.

---

### 2 — METACHRONAL WAVES (refines plan D3)

**2a. Classification by wave direction relative to the EFFECTIVE STROKE:**

| Type | Wave propagation vs effective-stroke direction |
|------|-----------------------------------------------|
| **Symplectic** | **same** direction as effective stroke (and forward swim) |
| **Antiplectic** | **opposite** to effective stroke |
| **Laeoplectic** | perpendicular, to the **left** of effective stroke |
| **Dexioplectic** | perpendicular, to the **right** of effective stroke |

[Guirao & Joanny 2007, Introduction + "Beating pattern and metachronal waves" (PMC1861806)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1861806/)

**2b. Paramecium is DEXIOPLECTIC** — the wave runs **obliquely/perpendicular** to the
effective stroke (not along the swim axis). Combined with the effective stroke
pointing rearward-and-to-one-side, this is *why Paramecium swims in a left-handed
helix while rotating about its long axis* ("spirals through the water"). Planar-beat
organisms used in theory (Opalina = symplectic, Pleurobrachia = antiplectic) keep the
wave on the swim axis.
[Wikipedia, *Paramecium* (spiraling + ciliary carpet)](https://en.wikipedia.org/wiki/Paramecium);
[Guirao & Joanny 2007 (PMC1861806)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1861806/)

**2c. Wavelength & phase lag — usable numbers:**

```
λ_metachronal ≈ 4–7 cilia spacings      # Machemer (Paramecium): 7;  Guirao model: ~5 (λ≈4.2d)
λ_absolute    ≈ 10–30 µm                 # = λ_cilia × d, with d ≈ 2 µm
φ_per_cilium  = 2π / λ_cilia ≈ 0.9–1.6 rad   # 2π/7 ≈ 0.90 ;  2π/5 ≈ 1.26
```

The plan default `ciliaMetachronal = 0.8 rad` corresponds to λ ≈ 7.9 cilia — slightly
longer than biology but **in the right ballpark**; tightening to **~1.0–1.3 rad**
(λ ≈ 5–6 cilia) would be more Paramecium-accurate.
[Machemer 1972, *J. Exp. Biol.* 57:239 (λ≈7 cilia)](https://doi.org/10.1242/jeb.57.1.239);
[Guirao & Joanny 2007 (λ≈4.2d≈5 cilia) (PMC1861806)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1861806/)

**2d. How to orient the wave on the body (for the 2-D crown):**
- The **effective/power stroke must sweep toward the REAR** (`−headingV`); that is
  what propels the cell forward.
- The plan's D3 maps wave phase to **angular position relative to `headingV`** — i.e.
  the wave travels around the rim along the swim axis. **This is a symplectic/
  antiplectic (on-axis) choice, not the true dexioplectic Paramecium pattern.** For a
  stylized 2-D rim crown this is acceptable and visually legible; if you want
  Paramecium realism, offset the wave axis by ~60–90° from `headingV` (oblique) and
  add slow body roll. **Flagged below.**

---

### 3 — BODY SHAPE UNDER SWIMMING (contradicts plan D4 for ciliates)

**3a. Ciliates do NOT elongate dynamically.** *Paramecium* is enclosed by a **stiff
but elastic pellicle** (plasma membrane + alveoli + epiplasm) — its **prolate
"cigar/slipper" shape is essentially fixed** on swimming timescales. It swims **along
its long axis** but does not stretch/squash with speed.
[Wikipedia, *Paramecium* — pellicle, "stiff but elastic"](https://en.wikipedia.org/wiki/Paramecium)

**3b. Aspect ratio.** Length 0.06–0.3 mm; typical *P. caudatum* ≈ 115 µm long × ~35 µm
wide → **aspect ratio ≈ 3–4 : 1** (cigar). (Amoebae, by contrast, are deformable and
have no fixed ratio — but amoebae are NOT ciliated swimmers; don't merge the two
behaviors.)
[Wikipedia, *Paramecium* — size range, "ovoid, elongate, foot- or cigar-shaped"](https://en.wikipedia.org/wiki/Paramecium)

**3c. Area/volume conservation.** Cytoplasm is effectively incompressible and the
pellicle is fixed-area → **volume conserved on short timescales**. **Plan C1/C2
(area-preserving deformation) is biologically correct.** **Plan D4 (prolate scaling
`k = 1 + elong·speedNorm`) is the part that conflicts:** the *orientation* (prolate
aligned to `headingV`) is right, but the *speed dependence* is not how a rigid
ciliate works — its elongation is constant, not velocity-driven. Keep a **fixed**
`k ≈ 1.3` (→ ~1.7:1 rendered, or higher for cigar realism) aligned to heading rather
than ramping it with speed. (As a purely artistic squash-and-stretch it's harmless,
but it is not biology.)

---

### 4 — CILIA DENSITY & SCALING (validates plan E1)

**4a. Count & spacing.** *Paramecium* carries **≈ 4000 cilia**, arranged in **tightly
spaced regular rows**, with **exactly one cilium projecting through each pellicle
polygon** (hexagonal/rectangular depression). Inter-ciliary spacing **d ≈ 1–3 µm**,
which is **< cilium length L ≈ 10–12 µm** (i.e. `d < L`, the regime where
hydrodynamic coupling aligns the array).
[Guirao & Joanny 2007 — "~4000 cilia", "d < L", regular array (PMC1861806)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1861806/);
[Wikipedia, *Paramecium* — one cilium per pellicle polygon](https://en.wikipedia.org/wiki/Paramecium)

**4b. Scaling with cell size.** One cilium per (roughly constant-size) pellicle unit
⇒ **count ∝ surface area ∝ R²** for the 3-D cell. In a **2-D rim projection** the
visible crown scales with **perimeter ∝ R**:

```
n_visible ≈ 2π·R_body / d            # cilia along the rendered rim (d ≈ inter-ciliary spacing)
```

**Plan E1 (`n = round(TAU·baseR / ciliaSpacingPx)`) is the biologically correct
scaling for a 2-D outline.** Note CELL_MATH §4.1 currently states "cilia COUNT
independent of energy/audio (only length responds)" — that invariant is fine
(count shouldn't track loudness), but count *should* track **size** if `baseR`
changes, which E1 handles.

**4c. Beat-direction order.** Mature cilia all beat in one preferred direction set by
the basal-foot/rootlet anchoring; only nascent cilia are randomly oriented. So a
coherent crown (not random per-hair beat axes) is correct; the plan's small per-hair
desync (`+r01·0.6`) for visual life is a fine artistic deviation.
[Guirao & Joanny 2007 — basal foot points in effective-stroke direction (PMC1861806)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1861806/)

---

## Contradictions / corrections vs the current plan

| Plan item | Verdict | Action |
|-----------|---------|--------|
| **D2** drag-lean downstream offset `−(tx,ty)·dragGain`, `dragGain ∝ speedNorm` | ✅ Correct sign & **linear-in-speed** scaling matches low-Re (Finding 1b) | Keep |
| **B1** soft-saturate (`tanh`) the lean | ✅ Biologically motivated (lean saturates as cilium aligns with flow, drag `ξ⊥→ξ∥`) | Keep |
| **D2** `dragGain·(0.6+0.4·lead)` leading>trailing | ⚠️ Defensible as a stylization, but for *pure translation* the relative flow `−v` is ~uniform over the body, so all cilia lean ≈ equally. The leading/trailing modulation is more about which face you see than a strong hydrodynamic law. | Keep but don't claim it's quantitative |
| **D3** metachronal wave **along motion axis** | ⚠️ That is **symplectic/antiplectic** orientation; real *Paramecium* is **dexioplectic** (wave oblique/perpendicular to effective stroke). | Acceptable for stylized 2-D; for realism offset wave axis 60–90° from heading + add slow roll |
| **D3** effective stroke should drive forward | ✅ Ensure power-stroke sweep points **rearward** (`−headingV`) | Verify sign in `ciliaBeatPhase`/crown sweep |
| **`ciliaMetachronal = 0.8 rad`** (λ≈7.9 cilia) | ⚠️ Slightly long vs biology | Optional: tighten to **1.0–1.3 rad** (λ≈5–6 cilia) |
| **`ciliaAsymmetry`** two-phase, power<recovery time | ✅ Matches 9 ms : 26 ms (~1:3). Power fraction ≈ 0.25 | Keep; default 0.6 → powerTime 0.2, close to 0.25 |
| **D4** prolate `k = 1 + elong·speedNorm` (speed-driven elongation) | ❌ **Contradicts biology**: rigid-pellicle ciliates have a **fixed** ~3–4:1 cigar; they don't stretch with speed | Use **fixed** `k` aligned to heading; drop speed dependence (or keep only as mild artistic squash, not labeled biological) |
| **D5** acceleration squash/stretch | ❌ Same issue — rigid pellicle doesn't squash; **only deformable amoebae do**, and amoebae aren't cilia-swimmers | Treat as pure artistic license; don't justify biologically |
| **C1/C2** area preservation | ✅ Correct — incompressible cytoplasm + fixed pellicle conserve volume | Keep |
| **E1** count from perimeter `n = TAU·baseR/spacing` | ✅ Correct 2-D scaling (one cilium per pellicle unit ⇒ count ∝ area ∝ perimeter in 2-D) | Enable if rendering multiple sizes |
| CELL_MATH "count independent of energy" | ✅ Correct (count shouldn't track loudness) — but count *should* track `baseR` (size), which E1 gives | No change to invariant; just note size-coupling is OK |

**Headline conflict:** the plan treats the organism as simultaneously a *ciliate*
(crown of beating cilia, metachronal waves) **and** a *deformable amoeba*
(speed-prolate body D4, acceleration squash D5, pseudopods). **Real organisms are one
or the other:** ciliates have rigid pellicles and beat cilia; amoebae crawl/extend
pseudopods and have **no** motile-cilia crown. The cilia physics (Findings 1–2,4) and
the dynamic body deformation (D4/D5/pseudopods) describe **different creatures**.
This is fine for a stylized "alive" visualizer, but D4/D5 should not be presented as
biologically accurate for a ciliate.

---

## Quick-reference parameter table (for tuning)

| Quantity | Biological value | Source |
|----------|-----------------|--------|
| Cilium length L | 10–12 µm (cilia); flagella up to ~100× | Guirao 2007; Wikipedia *Cilium* (1–5 µm epithelial, longer in protists) |
| Beat frequency | ~30 Hz (water), ↓ with viscosity | Guirao 2007 |
| Power : recovery time | ~9 ms : 26 ms (≈1:3) | Guirao 2007 |
| Drag anisotropy ξ⊥/ξ∥ | ≈ 2 | Lauga & Powers 2009; Wikipedia *Microswimmer* |
| Tip lean | δ_tip ≈ ξ⊥·U·L⁴/(8κ), linear in U, saturating | derived from Guirao 2007 elastic model |
| Metachronal λ | 4–7 cilia (~10–30 µm) | Machemer 1972; Guirao 2007 |
| Phase lag/cilium φ | 0.9–1.6 rad | derived (2π/λ) |
| Paramecium type | dexioplectic (oblique wave) | Guirao 2007; Wikipedia *Paramecium* |
| Body aspect ratio | ~3–4 : 1, fixed | Wikipedia *Paramecium* |
| Cilia count | ~4000, one per pellicle unit | Guirao 2007; Wikipedia *Paramecium* |
| Inter-ciliary spacing d | 1–3 µm (< L) | Guirao 2007 |
| Swim speed | ~1 mm/s ≈ 10 body-lengths/s | Guirao 2007 |

---

## Sources

**Kept (primary / authoritative):**
- **Guirao & Joanny, *Biophysical Journal* 92(6):1900–1917, 2007** —
  https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1861806/ — *the* quantitative source:
  cilia drag asymmetry under flow, ξ⊥/ξ∥, two-phase 9/26 ms strokes, 30 Hz, ~4000
  cilia, d<L, symplectic/antiplectic/dexioplectic definitions, λ≈5 cilia,
  viscosity–frequency table, elastic-filament beating model.
- **Machemer 1972, *J. Exp. Biol.* 57:239** (via Guirao citations) — metachronal
  wavelength ≈ 7 cilia in *Paramecium*; viscosity effects on metachrony.
- **Wikipedia, *Paramecium*** — https://en.wikipedia.org/wiki/Paramecium — body shape
  (cigar/slipper), rigid pellicle, one cilium per polygon, effective/recovery stroke
  description, spiral swimming, size range.
- **Wikipedia, *Metachronal rhythm*** — https://en.wikipedia.org/wiki/Metachronal_rhythm
  — recovery stroke at 90° to power stroke (anti-collision); travelling-wave concept.
- **Wikipedia, *Cilium*** — https://en.wikipedia.org/wiki/Cilium — cilium length
  scales, 9+2 axoneme, ~200 cilia/cell (respiratory) for cross-organism context.
- **Wikipedia, *Microswimmer*** — https://en.wikipedia.org/wiki/Microswimmer — low-Re
  / Stokes flow, scallop theorem, slender-body and spheroid drag formulas, ξ⊥/ξ∥;
  Lauga & Powers 2009 and Purcell 1977 as deeper refs.

**Dropped / not used:**
- *Purcell's three-link swimmer* (Wikipedia) — fetched but tangential (artificial
  swimmer kinematics, not cilia bending).
- General microswimmer biomedical/robotics content (most of the *Microswimmer*
  article) — out of scope.

---

## Gaps

1. **Could not run keyword web search** (all providers down — see top note). Findings
   rest on directly-fetched primary sources; broad discovery (e.g. recent 2020s
   high-speed-imaging metachrony papers, Gompper/Elgeti *Multi-Ciliated
   Microswimmers* 2021 cited in CELL_MATH) was not retrievable this run.
2. **Exact inter-ciliary spacing** (1–3 µm) and **exact aspect ratio** (3–4:1) each
   rest on a single source; worth confirming against Tamm/Sleigh SEM data or
   Machemer's morphometry if precision matters.
3. **Dexioplectic obliquity angle** for *Paramecium* (degrees of wave-axis offset from
   the effective-stroke axis) — qualitatively "to the right / oblique", but I did not
   find a clean numeric angle. Needed if you implement true dexioplectic orientation.
4. **Tip-lean formula (1b)** is my derivation from the Guirao elastic-filament model
   (cantilever-under-uniform-load); it is dimensionally correct and captures the right
   scaling (linear-then-saturating), but I did not find it stated verbatim as a
   closed-form "δ vs U" in the literature fetched. Treat the prefactor as approximate.

**Suggested next steps:** when search credits return, pull (a) Gompper/Elgeti 2021
EPJE review for modern metachrony parameters, (b) Tamm 1972 / Machemer 1972 for
Paramecium ciliary-row geometry and the dexioplectic angle, and (c) a high-speed
imaging paper for the actual tip-trajectory envelope to calibrate `ciliaCurl` /
`dragCoeff`.
