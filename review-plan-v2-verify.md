# Verification of Plan v2 (`cell-bio-accuracy-plan.md`) against round-2 critique

Scope: confirm each of the 5 round-2 Blockers is actually fixed in plan v2, and
hunt for issues introduced by the v2 changes. Cross-checked against the live
code in `src/theme-engine/renderers/cell.ts`, `shared.ts`, and the consuming
theme `src/theme-engine/builtin/drifting_contour/index.ts`. Read-only — no code
edited.

> Process note: `plan.md` (referenced in the task) does **not** exist at the repo
> root; the plan is at `.pi/plans/cell-bio-accuracy-plan.md`. `progress.md` is an
> empty stub (status "In Progress", no tasks/files filled in). Neither blocks
> this review.

---

## Part 1 — The 5 round-2 Blockers

### Blocker 1 — missing `integrateDeformation` in the pipeline → **FIXED**
- Plan-v2 line: pipeline is now **9 steps**, with
  `5. integrateDeformation(prev,target,attack,release)   <-- EXISTING, was missing`
  inserted between tanh (step 4) and `normalizeArea` (step 7), and step 7 reads
  `normalizeArea on the INTEGRATED deform[]`. The header explicitly says
  *"Normalization MUST run on the integrated field, else the area invariant dies
  on the live path."*
- Matches live code: the renderer integrates first
  (`cell.ts:1201-1202` — `integrateDeformation(deform, targetDeform, attack, release)`)
  and only then converts to radius (`cell.ts:1229` — `baseR * (1 + deform[i])`).
  `integrateDeformation` is `shared.ts:225-242` (the plan's "215-234" is off by
  ~10 lines — see correction below). The asymmetric attack/release (0.20 vs
  0.005) confirms the critique's point that two normalized fields eased together
  are not normalized.
- **Correction (Note):** the plan cites `shared.ts:215-234` for
  `integrateDeformation`. The doc-comment starts at line 207 and the function body
  is **225-242**. Fix the citation so an implementer lands on the function.

### Blocker 2 — inverted ellipse formula → **FIXED (and improved)**
- Plan-v2 line (C2): the plan **abandons the polar-multiply formula entirely** and
  switches to an affine squeeze on the contour points in the heading frame:
  `rotate (x,y) by −φ → (xr,yr); xr·=k; yr/=k; rotate back by +φ`, with the note
  `det = k·(1/k) = 1 → EXACTLY area-preserving for ANY contour shape`.
- This is strictly better than the critique's suggested reciprocal polar form
  `f(θ)=1/sqrt((cos/k)²+(k·sin)²)`: the reciprocal form is area-preserving only on
  a circle, whereas the integrated contour is already deformed (Note 4 of the
  critique). The affine map is exact for any shape and cheaper (no per-vertex
  `sqrt`). So Blocker 2 is not merely patched — the underlying class of error is
  removed.
- Test retained: `mean(f²)=1 (1e-9); area invariant under any k,φ; k=1 → identity`.
  Caveat: with the affine map the proper test is *polygon area invariant under the
  squeeze* (shoelace before/after, det=1), not `mean(f²)=1` (which is the
  radial-multiply metric). The plan still lists `mean(f²)=1` in C2; see Part 2 / New
  issue B.

### Blocker 3 — "clamp is no-op" false under motion / radius budget → **FIXED**
- Plan-v2 line (B1): explicit joint budget
  `baseR·(1+Dmax)·k_max ≤ maxRadius` AND `baseR·(1−Dmax)/k_max ≥ floorRadius`,
  with `k_max=(1+elong)·(1+squashGain)` and the instruction to use
  `maxRadius from min(w,h) / cellReach, not height`. Step 9 is now labelled
  "(safety net)" and only "provably no-op" once the budget holds.
- This directly answers both halves of the critique: motion inflation
  (`k_max>1`) and the aspect-dependent `maxRadius`. The Containment section
  reinforces it: *"Use this same value as the aspect-aware maxRadius in B1's
  budget."*
- **Correction (PARTIAL on follow-through, not on the spec):** the *live* code
  still hard-codes `maxRadius = height * 0.46` at `cell.ts:1222` (and again at
  `cell.ts:738` in `buildCellContour`). The plan says to make it aspect-aware but
  does not point at these two literals. An implementer must change BOTH sites,
  and `buildCellContour` (738-739) is a second, divergent radius formula that the
  plan's B3 flags only loosely. Flag both lines explicitly.

### Blocker 4 — D4∘D5 "one ellipse" fails at bounce → **FIXED**
- Plan-v2 line (D5): *"Apply as a SECOND affine squeeze along `φ_acc=atan2(ay,ax)`
  (NOT folded into headingV — they diverge at wall bounces). Two sequential
  squeezes stay area-preserving (det=1·1)."* Plus EMA smoothing
  `aSmooth += (aMag−aSmooth)·(1−exp(−dt/τ_a))`, τ_a≈0.05-0.15, and a
  `BOUNCE-FRAME test (area in tolerance AND squash bounded, no pop)`.
- This adopts critique option (a) (two rotated affine maps) and adds the spike
  guard the critique demanded. D5 is also correctly marked OPTIONAL/skippable.
- Live-code corroboration of the bounce hazard: `wanderStep` reflects heading at
  walls (`cell.ts:1051-1062`) and recomputes `vx,vy` afterward (1065-1068), so a
  one-frame near-instant velocity reversal is real; EMA smoothing is genuinely
  needed. FIXED.

### Blocker 5 — back-compat `speedNorm=0` false due to ungated B1/C1 → **FIXED**
- Plan-v2 line (Invariants): *"B1 + C1 DELIBERATELY change the resting shape …
  So there are TWO baselines: (1) frozen pre-B/C snapshot for D-only tests with
  B1/C1 off; (2) new golden values for B1+C1. Do NOT assert byte-identical
  resting output across B1/C1."* The collapse claim is now scoped to **D2–D5**
  only, and D1 explicitly notes *"(NOTE: B1/C1 are NOT motion-gated and DO change
  the resting shape — see Invariants.)"*
- This is exactly the re-scoping the critique required. FIXED.

**Blocker scorecard:** 1 FIXED · 2 FIXED · 3 FIXED · 4 FIXED · 5 FIXED. All five
addressed; two citation/follow-through corrections noted (B1 maxRadius literals,
integrateDeformation line numbers).

---

## Part 2 — Issues introduced or left open by the v2 changes

### A. 9-step pipeline placement & "normalize after integration" — **HOLDS, with one real gap**
- Placement is correct: integrate (step 5) → optional smoothing (6) → normalize
  (7) → affine squeeze (8) → clamp (9). The renderer already integrates before
  building radius (`cell.ts:1201-1202` → `1229`), so step 5 maps onto existing
  code with no reordering.
- **Real gap (PARTIAL):** normalizing the *integrated* field fixes the invariant
  per frame, **but the integrator runs on the next frame against the normalized
  output** (`deform` is persisted: `cell.ts:1126`, `1201-1202`). Sequence per
  frame is: `prev(normalized) → integrate(prev, newTarget) → normalize → store`.
  That is internally consistent (each stored frame is normalized, and the area
  test on the stored/contour field passes). The subtle point the plan should
  state: the *target* fed to `integrateDeformation` is the tanh-saturated but
  **un-normalized** target (steps 3-4), while `prev` is normalized. Blending an
  un-normalized target with a normalized prev is fine because step 7 re-normalizes
  the result — but if an implementer "optimizes" by normalizing the target inside
  `buildTargetDeformation`, Blocker 1 silently returns. Recommend an explicit
  one-line invariant: *"normalize ONLY at step 7 on the integrated field; never
  inside buildTargetDeformation or on the target."*
- Step 6 (cyclic smoothing) sits *before* normalize — correct, since smoothing
  changes the mean and would break `mean((1+d)²)=1` if done after.

### B. Affine-squeeze C2 spec — **AMBIGUOUS in one place (PARTIAL)**
- C2 itself is unambiguous (rotate/scale/rotate, det=1). But the spec is
  **inconsistent about the test metric and about whether it is point-based or
  radial**:
  - C2 test says `mean(f²)=1` — that is the *radial-multiply* invariant, not the
    affine one. With the affine map there is no `f(θ)`; the correct guard is
    "polygon shoelace area unchanged (±1e-9) for any k,φ; k=1 → identity". Keep
    `mean(f²)=1` only if a radial `f` is still computed somewhere; otherwise it
    tests a quantity the code no longer produces.
  - D4 says "Body prolate via C2 affine squeeze" (point-based) ✓.
  - B1's budget is written in **radial** terms (`baseR·(1+Dmax)·k_max`). That is a
    fine conservative bound for the affine map too (max stretch factor = k_max
    along φ), but the plan should state that `k_max` here is the affine scale, so
    the budget and C2 use the same `k`.
  - Containment adds `(k_max−1)·baseR` ellipse headroom — consistent with the
    affine interpretation. ✓
- **Correction:** unify on one statement: "C2/D4/D5 are affine squeezes (det=1);
  area verified by shoelace on the contour polygon; `k_max=(1+elong)(1+squashGain)`
  is the worst-case linear stretch used by B1's budget and Containment headroom."
  Drop or re-label the `mean(f²)=1` test.

### C. Two-baseline back-compat & D-only tests runnable — **PARTIAL (toggle not specified)**
- The plan names two baselines (frozen pre-B/C snapshot; new B1+C1 golden) — good.
  But it does **not specify the mechanism to toggle B1/C1 off** so the D-only
  tests can run against the frozen baseline. The live code has no feature flags;
  B1 (tanh) and C1 (normalize) would be unconditional new steps. Without a
  param/flag (e.g. `enableSaturation`/`enableAreaNorm`, defaulting on) the
  "D-only with B1/C1 off" baseline is not actually runnable — you'd have to test
  D's pure functions in isolation rather than through the pipeline.
- **Correction:** either (a) add explicit gate params for B1/C1 so the pure
  pipeline can be exercised with them off (recommended; also lets C1 land dark),
  or (b) restate the D-only baseline as "unit tests on D2-D5 pure functions in
  isolation (speedNorm=0 ⇒ identity), NOT a full-pipeline snapshot." Pick one;
  right now the plan implies a full-pipeline snapshot that the code can't produce
  cleanly.

### D. Radius budget self-consistency across 160×160 and 172×36 — **PARTIAL / under-specified**
- Live reality: the only shipping consumer is `drifting_contour` at **160×160**
  with `baseRadiusPx: 16`, `driftMargin: 30` (`index.ts:52-54`,
  `manifest.json` 160×160). The wide-thin **172×36** geometry is the *harness
  default* (`HarnessApp.tsx:45`) and the historical pill size, not a cell overlay.
  So the budget must hold at 160×160 for production and *should* hold at 172×36 so
  the harness/E2E screenshots don't clip.
- 160×160 with `baseRadiusPx:16`: `maxRadius=min(w,h)*0.46=73.6`. `cellReach`
  (`cell.ts:911-921`) at baseR=16, growth swell up to ×(1+0.2): membraneOuter
  =1.4·baseR, ciliaOuter=baseR·(1+(0.4+0.55)·1.3)=baseR·2.235 ≈ dominant. The
  plan tells you to *add* drag-lean + (k_max−1)·baseR to cellReach and reuse it as
  maxRadius — but **cellReach is already much larger than baseR (≈2.2× via cilia)**,
  while B1's budget compares **membrane radius** `baseR·(1+Dmax)·k_max` to
  maxRadius. Conflating "the cilia-dominated reach" with "the maxRadius the
  membrane clamp uses" will make maxRadius huge and the clamp will never fire
  (effectively disabling the safety net) — the opposite failure from the
  critique, but still a failure.
- **Correction:** keep TWO distinct radii: (1) **membrane maxRadius** for the
  step-9 clamp = aspect-aware `min(w,h)*k` (or a budget-derived cap), used in the
  B1 inequality; (2) **cellReach** (membrane + cilia + drag + ellipse headroom)
  for *containment/inset* only. Do NOT set the membrane clamp's maxRadius equal to
  cellReach. The plan currently says "Use this same value as the aspect-aware
  maxRadius in B1's budget" — that is wrong if "this value" includes cilia reach.
- At 172×36: `min(w,h)=36`, so a budget maxRadius ≈ `0.46·36 ≈ 16.6px`. With
  `baseRadiusPx:16` the membrane alone (baseR·(1+Dmax)·k_max) blows the budget
  immediately. The plan must either (a) acknowledge cell never ships at 172×36 and
  scope the budget to `min(w,h) ≥ ~120`, or (b) make baseRadiusPx aspect-aware.
  As written the budget is unsatisfiable at 172×36 with the shipping baseRadiusPx.

### E. Missing TDD properties to catch regressions — **PARTIAL**
The plan's test list (mean(f²), live-path shoelace, bounce-frame, base-angle A1)
is much improved, but three regression nets are still absent:
1. **No frame-to-frame stability / convergence test** for the integrate→normalize
   loop (item A above): assert that holding a constant target for K frames
   converges to a fixed normalized `deform[]` whose area = π·baseR² (no slow
   drift or limit-cycle from re-normalizing a normalized field each frame).
2. **No clamp-never-fires assertion** tied to the B1 budget: a property test that,
   for the shipping 160×160 params across an audio sweep + max speedNorm + max
   accel, `rawRadius ∈ [floorRadius, maxRadius]` for all 96 vertices (i.e. step 9
   is provably a no-op). This is the only test that actually proves Blocker 3 is
   closed on the live path.
3. **No `normalizeArea` real-root guard test**: C1 specifies the `Var(e)>1`
   multiplicative fallback and `1+d_i−c>0` assertion — add explicit tests for the
   degenerate one-sided-bulge case that triggers the fallback, else the fallback
   ships untested.

### F. A→B→C→D risk order safety — **PARTIAL: C1 lands a visibly smaller resting cell mid-sequence**
- The plan's risk ranking is A → B → C → D, and the Invariants section is honest
  that C1 *removes the ~20% additive inflation*, so the resting cell becomes
  **visibly smaller** the moment C1 lands — before any D motion payoff. The
  ordering is "safe" for correctness but **not** for "never visibly broken": there
  is an intermediate commit (after C1, before D) where the overlay looks smaller/
  different with no compensating benefit, and a reviewer eyeballing that commit
  could reasonably call it a regression.
- This is inherent to area-normalization (it's a deliberate shape change), but it
  can be sequenced to avoid a bad-looking intermediate:
  - Land C1 **behind a default-off gate** (ties to issue C), or
  - Re-tune `baseRadiusPx`/`radiusFraction` **in the same commit as C1** so the
    *normalized* resting radius matches today's apparent size (compensate the ~20%
    area loss by bumping baseR ≈ +10% so π·baseR² lands where the eye expects).
    The plan mentions clamping `c` but never mentions re-tuning baseR to preserve
    apparent size — add it as a C1 sub-step.

---

## Recommended commit sequence (never leaves the overlay visibly broken)

Each commit below is independently shippable and visually neutral-or-better.

1. **A1 + A2** (clamp `ciliaAngleJitter` to `[0,0.9]` at `cell.ts:474`; fix comment
   `cell.ts:489-491`). Pure, no visible change. Test: base-angle ordering at
   speedNorm=0.
2. **A3** (bin interpolation with wraparound, `cell.ts:660-662,673` +
   `723-725,734`). Removes a C0 seam; only smoother. Test: `binDeform(0)==binDeform(2π)`.
3. **Pipeline scaffolding + tests, no behavior change.** Add gate params
   (`enableSaturation`, `enableAreaNorm`, `enableAffine`, motion terms) **all
   default OFF**, and add `integrateDeformation` explicitly as step 5 (already the
   live behavior). Land the live-path shoelace test + frame-convergence test
   against TODAY's output (this is the frozen pre-B/C baseline). Visually identical.
4. **C2 affine squeeze function + tests (gated OFF).** Land the rotate/scale/rotate
   map with shoelace-area-invariant and k=1-identity tests. Not wired into the
   tick yet → no visible change. (Do C2 before C1 so the area machinery is proven
   before it changes resting shape.)
5. **B1 tanh saturation (gate ON) + radius budget.** Derive Dmax/k_max for the
   160×160 shipping params; add the clamp-never-fires property test. Only reshapes
   loud-audio peaks; resting cell unchanged. Review snapshot.
6. **C1 area-normalize (gate ON) + baseR re-tune in the SAME commit.** Compute `c`
   from the integrated field, clamp `c`, multiplicative fallback for `Var(e)>1`,
   and bump `baseRadiusPx` so apparent resting size matches today. This is the one
   risky shape change — keeping size constant in the same commit prevents a
   "shrunk cell" intermediate. New golden baseline committed here.
7. **D1 + D2 + D3** (motion basis, drag-lean cilia, metachronal wave). The visible
   win; each multiplicative in speedNorm so speedNorm=0 ⇒ identity. Wire D4 affine
   prolate (mild fixed elong) via the already-proven C2 map.
8. **D5 (optional)** accel squash on its own axis with EMA smoothing + bounce-frame
   test. Skip if bounce complexity isn't worth it (plan already allows this).
9. **E1 (optional, gate OFF)** perimeter-driven count **with** the 2-D seed fix
   `noise2D(k*12.9898, 7.2 + k*0.123)` as a precondition (the live seed at
   `cell.ts:492` is `noise2D(k*12.9898, 7.2)` — 1-D in k, so >150 hairs would
   alias; the plan's E1 precondition is correct and necessary).

Rationale: gates (commit 3) make C/D individually dark-launchable and make the
two-baseline test story real (issue C); C2-before-C1 proves area math before it
changes the look; C1+baseR-retune in one commit removes the only visibly-worse
intermediate (issue F).

---

## Review

- **Correct:** All 5 round-2 Blockers are genuinely addressed in v2. Blocker 2 is
  not just patched but upgraded to the shape-independent affine map (better than
  the critique's reciprocal polar form). Blocker 1's pipeline order matches the
  live integrate→radius flow. Blocker 5's invariant is correctly re-scoped to
  D2–D5. Evidence cited per blocker above.
- **Note (citation):** plan says `integrateDeformation` is `shared.ts:215-234`;
  actual function body is **225-242** (doc-comment from 207). Minor — fix for the
  implementer.
- **Blocker (follow-through):** the aspect-aware maxRadius is specified but the two
  live literals (`cell.ts:738` and `cell.ts:1222`, both `height*0.46`) are not
  called out, and **`buildCellContour` (704-742) is a second divergent radius
  path** that must be reconciled or it will ship the old behavior.
- **Blocker (self-consistency):** "reuse cellReach as the membrane maxRadius"
  (Containment) conflicts with B1's membrane-only budget — cellReach is
  cilia-dominated (~2.2×baseR) and would effectively disable the clamp. Keep
  membrane-clamp maxRadius and containment cellReach as two separate radii.
- **Blocker (unsatisfiable budget at 172×36):** with shipping `baseRadiusPx:16`
  and `min(w,h)=36`, `maxRadius≈16.6px` < `baseR·(1+Dmax)·k_max`. Scope the budget
  to the 160×160 overlay (the only shipping cell consumer) or make baseR
  aspect-aware. The 172×36 geometry is the harness default, not a cell overlay.
- **Note (toggle/baseline):** no mechanism specified to disable B1/C1 for the
  "D-only frozen baseline"; add default-off gates or restate D tests as pure-fn
  unit tests.
- **Note (tests):** add (1) integrate→normalize frame-convergence/stability test,
  (2) clamp-never-fires property test under max motion (the only real proof
  Blocker 3 is closed live), (3) `normalizeArea` `Var(e)>1` fallback test.
- **Note (risk order):** C1 shrinks the resting cell ~20% mid-sequence — re-tune
  baseR in the same commit (or gate C1 off) to avoid a visibly-worse intermediate.
</content>
</invoke>
