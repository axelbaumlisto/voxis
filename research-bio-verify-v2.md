# Bio Verification of Plan v2 (`cell-bio-accuracy-plan.md`)

Round-3 independent verification of the biology in **plan v2** and the round-2 brief
`research-cilia-hydrodynamics.md`, checked against directly-fetched **primary sources**.

## Tooling used (per the task constraint: web_search providers are DOWN)
- **`fetch_content`** on the **Guirao & Joanny 2007 full text** — succeeded via the
  mirror **`https://pmc.ncbi.nlm.nih.gov/articles/PMC1861806/`** (126 KB of text incl.
  abstract, intro, "Axonemal beating", "Left-right symmetry breaking & metachronal
  coordination", Table 1, appendices, references). The originally-suggested
  `https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1861806/` was **reCAPTCHA-blocked**
  (returned a challenge page); the `pmc.` host returned the full article.
- **`fetch_content`** on **`https://en.wikipedia.org/wiki/Paramecium`** (full text).
- **`fetch_content`** on **`https://en.wikipedia.org/wiki/Metachronal_rhythm`** (full text).
- **`fetch_content`** on **`https://en.wikipedia.org/wiki/Cilium`** (fetched; length
  scales corroborated, but Guirao gives the cleaner numbers so I rely on it).
- I did **not** re-fetch Microswimmer/Lauga-Powers this run; the ξ⊥/ξ∥≈2 ratio is
  standard slender-body theory and is noted as such below.

> Net: every quantitative claim below that I mark VERIFIED is backed by a verbatim
> passage I read in the Guirao full text or the Wikipedia articles this run. Where the
> round-2 brief cited a number that those two sources do **not** actually contain
> (e.g. the "dexioplectic" label, d≈1–3 µm, the 3–4:1 aspect ratio, the tanh
> saturation), I downgrade it and flag it as a sourcing gap.

---

## ITEM 1 — Scope dichotomy (ciliate rigid pellicle vs deformable amoeba)

**Verdict: VERIFIED (broad framing correct) — with 3 nuances to soften the wording.**

What the primary source confirms (Wikipedia *Paramecium*, verbatim):
- **Rigid-but-not-perfectly-rigid pellicle:** "The body of the cell is enclosed by a
  **stiff but elastic** structure called the pellicle… an outer cell membrane, a layer
  of flattened membrane-bound sacs called alveoli, and an inner membrane called the
  epiplasm." → The plan's word **"rigid pellicle" is a slight overstatement**; the
  correct phrase is **"stiff but elastic."** It holds a fixed shape on swimming
  timescales but is not a rigid shell.
  [Source](https://en.wikipedia.org/wiki/Paramecium)
- **Fixed cigar/slipper body:** "Cells are typically ovoid, elongate, or foot- or
  cigar-shaped," size "0.06 mm to 0.3 mm." → fixed prolate body, confirmed. **But the
  exact 3–4:1 aspect ratio is NOT stated** in the article — it is *inferred* from
  *P. caudatum* ≈115×35 µm. Treat 3–4:1 as a reasonable estimate, not a sourced fact
  (Gap 1). [Source](https://en.wikipedia.org/wiki/Paramecium)
- **One organism type, not both:** *Paramecium* "propels itself by whip-like movements
  of the cilia, arranged in tightly spaced rows around the outside of the body." It is
  a ciliate; it does **not** crawl with pseudopods. Amoebae (deformable, pseudopod
  crawlers) have **no motile-cilia crown**. The dichotomy is correct.

Nuances the plan should acknowledge (so D4/D5 "amoeba/animation license" framing stays
honest, and so the scope claim isn't overstated):
1. **Pellicle is elastic, not rigid** (above). Ciliates *do* deform slightly/elastically
   and can flex; they just don't stretch with swim speed.
2. **Contractile vacuole** — VERIFIED: "Osmoregulation is carried out by **contractile
   vacuoles, which actively expel water** from the cell to compensate for fluid absorbed
   by osmosis." This is a genuine *volume-changing* organelle, but it is **osmotic
   housekeeping**, periodic, and does **not** make the body elongate with speed — it
   does not rescue D4/D5 as biology. [Source](https://en.wikipedia.org/wiki/Paramecium)
3. **Trichocysts** — VERIFIED: "closely spaced spindle-shaped trichocysts, **explosive
   organelles that discharge thin… filaments**, often used for defensive purposes."
   A real fast-deformation-like event, but defensive discharge, not locomotion.
   [Source](https://en.wikipedia.org/wiki/Paramecium)
- Also confirmed and worth noting: **ciliary reversal / avoidance reaction** ("the
  effective stroke is reversed and the organism swims backward"), and **spiral
  swimming** ("The Paramecium spirals through the water as it progresses"). The spiral
  is the macroscopic signature of the oblique (dexioplectic) metachrony — relevant to
  Item 3.

**Conclusion for Item 1:** the ciliate-vs-amoeba split, volume conservation, and the
"D4/D5 = animation license, not ciliate biology" decision are all **biologically
sound**. Only fix: change **"rigid pellicle" → "stiff but elastic pellicle"**, and
optionally footnote that contractile vacuole + trichocysts exist but justify neither
speed-elongation (D4) nor acceleration-squash (D5).

---

## ITEM 2 — Drag-lean D2 (sign, linear-in-speed, saturation, leading>trailing)

**Sign of lean: VERIFIED.** Guirao, "Left-right beating symmetry breaking" + Fig. 6
caption (verbatim): "The cilium tends to **beat faster and quite straight in the
direction of the flow, whereas it comes back slower and more curved against the flow**,"
and "**Average position of a cilium that is curved in the direction of the flow.**"
For a cell translating at velocity **v**, the relative flow over the body is **−v**, so
each cilium's average position curves **toward the rear (downstream of −v)**. The plan's
downstream offset `−(tx,ty)·dragGain` has the **correct sign**.
[Source](https://pmc.ncbi.nlm.nih.gov/articles/PMC1861806/)

**Linear-in-speed: VERIFIED.** The paper explicitly works "in the **limit of vanishingly
small flows**," keeping terms to first order and stating "we have neglected terms of
order Ū²." So the induced average curvature (lean) is **linear in U** at this order. The
plan's `dragGain ∝ speedNorm` matches the low-Re / Stokes (force ∝ velocity) regime.
[Source](https://pmc.ncbi.nlm.nih.gov/articles/PMC1861806/)

**Saturating (tanh): NEEDS-CORRECTION / DOWNGRADE (not biologically sourced).**
The Guirao analysis is a *small-amplitude, small-U linear theory* — it shows the
**onset** of lean, **not** a saturating curve. The round-2 brief's "tanh is
biologically motivated because drag drops ξ⊥→ξ∥ as the cilium aligns with the flow" is a
**physically reasonable extrapolation**, but it is **not stated in the primary source**.
Saturation is also defensible on pure geometry (a cilium cannot lean past flow-alignment,
and at large U the cilium presents its low-drag edge). **Keep tanh as a bounding/safety
device, but do not label it a sourced biological law** — call it "physically motivated
soft clamp." (Verdict: keep the implementation; correct the justification wording.)

**Leading > trailing `(0.6 + 0.4·lead)`: NEEDS-CORRECTION (artistic, not biological).**
The primary source treats a **uniform external flow** across the array. For a body in
**pure translation**, the relative flow `−v` is essentially **uniform over the cell**, so
**all cilia lean ≈ equally** — there is no hydrodynamic law making the leading face bend
more than the trailing face. The `0.6+0.4·lead` modulation is a **rendering/visibility
stylization** (which face you see), and is fine to keep, but **must not be presented as
quantitative biology**. The round-2 brief already says this; plan v2's D2 wording is
acceptable but should explicitly tag this term "artistic."

**Bonus VERIFIED (relevant to D2's "power sweeps rearward"):** the effective stroke is
what propels the fluid; the base-to-tip deformation wave + curved average position make
the cilium "exert a finite average force in the fluid in the direction of the flow." So
to read as forward propulsion, the **power stroke must sweep rearward (−headingV)** —
plan D2/D3's requirement is correct.
[Source](https://pmc.ncbi.nlm.nih.gov/articles/PMC1861806/)

**ξ⊥/ξ∥ anisotropy:** Guirao confirms two friction coefficients ξ⊥ (normal) and ξ∥
(tangential) and that **"the difference between the two local drag coefficients ξ⊥ and
ξ∥ is the key to an efficient beating"** — i.e. the oar effect. It does **not** state the
numeric ratio ≈2 in the text I read (that value is standard slender-body theory, Lauga &
Powers / Microswimmer). VERIFIED qualitatively; the "≈2" remains textbook, not from this
paper. [Source](https://pmc.ncbi.nlm.nih.gov/articles/PMC1861806/)

---

## ITEM 3 — Metachronal D3 (on-axis vs dexioplectic, offset angle, λ / `ciliaMetachronal`)

**Classification definitions: VERIFIED.** Guirao (Intro, verbatim): metachronal waves
propagate "in the direction of the effective stroke (**symplectic**), in the opposite
direction (**antiplectic**), or even in a perpendicular (**laeoplectic or
dexioplectic**) or oblique direction."
[Source](https://pmc.ncbi.nlm.nih.gov/articles/PMC1861806/)

**Plan keeps wave on the motion axis = symplectic/antiplectic: VERIFIED as the
tractable/modeled choice.** Guirao explicitly **models only on-axis metachrony**: "We
only consider those cases (and not laeoplectic or dexioplectic metachronism) here…
for *Opalina* (symplectic) and *Pleurobrachia* (antiplectic) that both have planar
beatings, no metachronal wave in the transverse direction can be seen, which justifies
our choice." So the plan's on-axis 2-D wave is exactly what the standard analytic model
uses — **acceptable**. [Source](https://pmc.ncbi.nlm.nih.gov/articles/PMC1861806/)

**"Paramecium is dexioplectic": PARTIALLY VERIFIED — re-attribute the citation.**
This is the one place the round-2 brief **over-cited**. The Guirao full text does **NOT**
call *Paramecium* dexioplectic; it lists the categories and then **excludes**
dexioplectic from its own model. What the reachable sources *do* support:
- Guirao: *Paramecium*'s beating "is three-dimensional" and "the recovery stroke is
  **not in the plane of the effective stroke**" → consistent with oblique/3-D metachrony.
- Wikipedia *Paramecium*: "The *Paramecium* **spirals through the water** as it
  progresses" + "waves of activity moving across the **ciliary carpet**… like the wind
  blowing across a field of grain" → the macroscopic spiral is the hallmark of oblique
  (dexioplectic) metachrony. [Source](https://en.wikipedia.org/wiki/Paramecium)
- The specific **"dexioplectic" label for *Paramecium*** comes from **Machemer 1972**
  (J. Exp. Biol. 57:239), which I could **not** fetch this run. So: the dexioplectic
  claim is well-established in the literature but **not present in the two sources I
  reached** — flag as Gap 2. The plan's note "true Paramecium is dexioplectic… acceptable
  for 2D" is **correct in substance**; just don't attribute it to Guirao.

**Dexioplectic OFFSET ANGLE: NOT FOUND (Gap 3).** Neither Guirao nor Wikipedia
*Paramecium* gives a numeric wave-axis offset for *Paramecium*. The only angle in
reachable sources is the generic **recovery-stroke-at-90°-to-power-stroke** anti-collision
geometry (Wikipedia *Metachronal rhythm*: "the recovery stroke is at **90 degrees** to
the power stroke, so that the cilia avoid hitting each other") — that is the *individual
beat plane*, **not** the metachronal-wave obliquity. By definition laeo/dexioplectic are
"perpendicular," but *Paramecium* is usually described as *oblique* (between symplectic
and dexioplectic), and the precise degrees are in Machemer/Tamm (unreached). **No clean
number available.** [Source](https://en.wikipedia.org/wiki/Metachronal_rhythm)

**`ciliaMetachronal` 0.8 → ~1.1 (λ≈5–6 cilia): VERIFIED biologically supported.**
Guirao (verbatim): "This value corresponds to a wavelength **λ = 4.2d ∼ 4d** for the
metachronal waves or **approximately five cilia**… (the wavelength is **seven cilia in
Machemer**)." So biological λ ≈ **5 (Guirao model) to 7 (Machemer) cilia**.
- Phase lag per cilium φ = 2π/λ ⇒ **φ ≈ 1.26 rad (λ=5)** to **0.90 rad (λ=7)**.
- Plan default **0.8 rad ⇒ λ = 2π/0.8 ≈ 7.85 cilia** — slightly *longer* than even
  Machemer's 7. **Tightening to 1.1 rad ⇒ λ = 2π/1.1 ≈ 5.7 cilia**, squarely inside the
  5–7 biological band. **The plan's proposed 0.8 → ~1.1 is correct and well-supported.**
  (Equivalently 0.9–1.26 rad is the fully-defensible range.)
  [Source](https://pmc.ncbi.nlm.nih.gov/articles/PMC1861806/)

---

## ITEM 4 — Power:recovery ratio, `ciliaAsymmetry` mapping, beat frequency

**Power:recovery ≈ 1:3 — VERIFIED (more precisely 9:26 ≈ 1:2.9).** Guirao (Intro,
verbatim): "In the example of *Paramecium* in water, the **effective stroke lasts
typically 9 ms whereas the recovery stroke lasts 26 ms**." → power fraction =
9/(9+26) = **0.257**; ratio 9:26 = **1:2.9** (the plan's "~1:3" is correct).
[Source](https://pmc.ncbi.nlm.nih.gov/articles/PMC1861806/)

**`ciliaAsymmetry = 0.6` mapping — NEEDS minor correction.**
CELL_MATH defines `powerTime = (1 − ciliaAsymmetry)/2`. With **0.6 ⇒ powerTime = 0.20**,
i.e. power:recovery = **1:4** — *more extreme* than biology's 0.257 (1:2.9).
To hit the biological power fraction **0.257**, set **(1−a)/2 = 0.257 ⇒ a ≈ 0.49**
(round to **0.49–0.50**). The round-2 brief's "0.6 → powerTime 0.2, close to 0.25" is in
the right ballpark but slightly overshoots; **a ≈ 0.49 is the biologically exact value.**
Keeping 0.6 is acceptable artistically (snappier oar) but is **not** the 9:26 number.

**Beat frequency — VERIFIED bio value; plan default is artistic.** Guirao: "The typical
beating frequency in water is **30 Hz**," and the numerical model gives **f_c ≈ 28 Hz**
(Table 1), dropping with viscosity (**28 → 19 → 14 Hz** at η_w, 2η_w, 3η_w). CELL_MATH's
`ciliaBeatHz = 0.9` is therefore a **~30× artistic slow-down** — fine for a calm
visualizer, but **not biological**; neither the plan nor CELL_MATH should imply 0.9 Hz is
realistic. (No correction required to behaviour; just label it artistic.)
[Source](https://pmc.ncbi.nlm.nih.gov/articles/PMC1861806/)

---

## ITEM 5 — Density E1 (count ∝ perimeter, one cilium per pellicle unit)

**VERIFIED.** Wikipedia *Paramecium* (verbatim): "The pellicle is… textured with
hexagonal or rectangular depressions. **Each of these polygons is perforated by a central
aperture through which a single cilium projects.**" Guirao: *Paramecium* "is covered by
**∼4000 cilia**," in "a beautiful and very regular array," with "for many ciliated cells,
**d < L**" (inter-ciliary spacing < cilium length; Guirao uses L = 12 µm and d/L = 2 in
calc but notes real d<L).
[Source](https://en.wikipedia.org/wiki/Paramecium) /
[Source](https://pmc.ncbi.nlm.nih.gov/articles/PMC1861806/)

Therefore **count ∝ surface area ∝ R²** for the 3-D cell, and in a **2-D rim/silhouette
projection** the visible crown scales with **perimeter ∝ R**. Plan E1's
`n = round(TAU·baseR / ciliaSpacingPx)` is the **correct 2-D analog** of "one cilium per
constant-size pellicle unit." VERIFIED.
- Caveat (not an error): biologically the true scaling is area (R²); perimeter (R) is the
  right *2-D outline* stand-in, so E1 is correct **for this renderer's geometry**.
- Exact **inter-ciliary spacing in µm (the round-2 "1–3 µm")** is **not** in the reachable
  sources — Guirao only gives the **dimensionless d/L** and L = 12 µm (Gap 4). The
  *relation* d < L is confirmed; the absolute 1–3 µm is not.

---

## Summary table (plan v2 items)

| Item | Verdict | Correction / note |
|------|---------|-------------------|
| 1. Ciliate(rigid) vs amoeba(deformable) dichotomy; D4/D5 = license | **VERIFIED** | Reword "rigid" → **"stiff but elastic"** pellicle. Footnote contractile vacuole + trichocysts exist but don't justify D4/D5. |
| 2a. Drag-lean sign (downstream) | **VERIFIED** | Verbatim "curved in the direction of the flow." |
| 2b. Linear in speed | **VERIFIED** | Paper is explicit small-U linear regime. |
| 2c. tanh saturation | **DOWNGRADE** | Reasonable physical extrapolation, **not** in primary source. Keep as bounding clamp; relabel. |
| 2d. leading>trailing (0.6+0.4·lead) | **NEEDS-CORRECTION** | Artistic only; uniform translation ⇒ ~equal lean. Tag "not quantitative." |
| 3a. On-axis (symplectic) 2-D wave | **VERIFIED (acceptable)** | This is exactly the analytic model's choice. |
| 3b. "Paramecium is dexioplectic" | **PARTIAL** | True in literature (Machemer), **but not in Guirao/Wikipedia reached**; re-attribute. 3-D/spiral confirmed. |
| 3c. Dexioplectic offset angle | **GAP** | No numeric angle in reachable sources. |
| 3d. ciliaMetachronal 0.8 → ~1.1 (λ≈5–6) | **VERIFIED** | Biological λ = 5 (Guirao) – 7 (Machemer); φ ≈ 0.9–1.26 rad. 1.1 rad → λ≈5.7. |
| 4a. Power:recovery ~1:3 | **VERIFIED** | 9 ms : 26 ms = 1:2.9, power fraction 0.257. |
| 4b. asymmetry = 0.6 mapping | **NEEDS minor correction** | 0.6 ⇒ powerTime 0.20 (1:4). For 9:26 use **a ≈ 0.49**. |
| 4c. beat freq | **VERIFIED bio (30 Hz)** | `ciliaBeatHz 0.9` is ~30× artistic slow-down — label as such. |
| 5. Density E1 perimeter scaling | **VERIFIED** | One cilium per pellicle polygon; count ∝ area (3-D) ∝ perimeter (2-D rim). |

---

## Anything in plan v2 that still contradicts biology?

1. **Wording "rigid pellicle"** — should be **"stiff but elastic."** Ciliates *do*
   deform elastically; the plan's own conclusion (fixed shape, volume-conserved) is right,
   but the adjective overstates rigidity. (Minor, wording only.)
2. **tanh saturation framed as biology** — it is a sensible bound, but the cited primary
   source is a *linear* theory and does not demonstrate saturation. Relabel as
   "physically-motivated soft clamp," not "biologically accurate."
3. **`0.6+0.4·lead` leading/trailing modulation** — not a hydrodynamic law for pure
   translation; keep but explicitly mark artistic. (Plan already half-concedes this.)
4. **asymmetry default 0.6** gives 1:4, not the biological 1:2.9 — use **≈0.49** if you
   want the 9:26 number; otherwise label 0.6 as a stylized snappier stroke.
5. **D3's "dexioplectic" attribution** — substance is correct, but cite Machemer 1972,
   not Guirao (Guirao explicitly does *not* model dexioplectic).

No **hard** biological contradictions remain in plan v2's *decisions* (the D4/D5
"animation license, not ciliate biology" call is exactly right, and C1/C2 area
conservation is correct — incompressible cytoplasm + fixed-area pellicle). The issues
above are wording/attribution/parameter-tuning, not structural errors.

---

## Gaps (sources unreachable this run)

1. **Aspect ratio 3–4:1** — *inferred* from P. caudatum 115×35 µm; the Wikipedia article
   gives only the size range (0.06–0.3 mm), not an explicit ratio. Confirm via Wichterman
   *Biology of Paramecium* or Machemer morphometry.
2. **"Paramecium is dexioplectic" primary attribution** — established via **Machemer 1972
   (J. Exp. Biol. 57:239)**, which is paywalled/unreached (only cited within Guirao). The
   reachable sources confirm 3-D beating + spiral swim but not the explicit label.
3. **Dexioplectic obliquity ANGLE (degrees)** for *Paramecium* — not in any reachable
   source. Needed only if true oblique metachrony is implemented; Machemer/Tamm 1972 are
   the place to look.
4. **Absolute inter-ciliary spacing (1–3 µm)** — Guirao gives only dimensionless d/L (with
   d/L = 2 in its calc) and L = 12 µm; the µm value of d is from other morphometry
   (Tamm/Sleigh SEM), unreached. The *relation d < L* IS confirmed.
5. **`www.ncbi.nlm.nih.gov/pmc/...` was reCAPTCHA-blocked**; I succeeded only via the
   **`pmc.ncbi.nlm.nih.gov`** host. All web_search providers remained down, as flagged.

**Suggested next steps when search/credentials return:** fetch Machemer 1972 (DOI
10.1242/jeb.57.1.239) for the dexioplectic angle + λ=7-cilia morphometry; Tamm/Sleigh SEM
for d in µm and aspect ratio; and Gompper/Elgeti 2021 (EPJE, cited in CELL_MATH) for
modern metachrony parameter ranges.

---

## Sources
- **Kept — Guirao & Joanny 2007, *Biophys. J.* 92(6):1900–1917**
  (https://pmc.ncbi.nlm.nih.gov/articles/PMC1861806/) — full text read this run.
  Confirms verbatim: 9 ms/26 ms strokes, 30 Hz (model 28 Hz), viscosity–frequency table,
  ~4000 cilia, regular array, d<L, L=12 µm, "curved in the direction of the flow,"
  faster-along/slower-against, symplectic/antiplectic/laeo/dexioplectic definitions,
  models only on-axis metachrony, λ=4.2d≈5 cilia (Machemer 7), ξ⊥/ξ∥ as the key, linear
  small-U regime, base-to-tip deformation wave, power stroke propels fluid.
- **Kept — Wikipedia *Paramecium*** (https://en.wikipedia.org/wiki/Paramecium) — "stiff
  but elastic pellicle," one cilium per hexagonal/rectangular polygon, effective/recovery
  stroke, ciliary carpet, spiral swimming, avoidance reaction/ciliary reversal,
  contractile vacuoles, trichocysts, size 0.06–0.3 mm.
- **Kept — Wikipedia *Metachronal rhythm*** (https://en.wikipedia.org/wiki/Metachronal_rhythm)
  — recovery stroke at 90° to power stroke (anti-collision); travelling-wave concept;
  cites Guirao & Joanny and Aiello & Sleigh 1972.
- **Consulted — Wikipedia *Cilium*** (https://en.wikipedia.org/wiki/Cilium) — cilium
  length scales / 9+2 axoneme (corroborative; Guirao gives the cleaner numbers).
- **Dropped this run — `www.ncbi.nlm.nih.gov/pmc/...`** (reCAPTCHA challenge page, no
  content) and broad keyword search (all web_search providers down).
