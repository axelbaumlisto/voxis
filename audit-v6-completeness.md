# COMPLETENESS AUDIT — Did consolidated Plan v6 lose any MATH from the 16 source audit files?

**Method:** Read `.pi/plans/cell-bio-accuracy-plan.md` (v6) in full, then all 16
audit/research files. Extracted every quantitative item (formulas, closed-form
derivations, numeric constants/ranges, scaling laws, boundary conditions, TDD
thresholds, physical justifications). Each is classified **PRESENT** (carried,
possibly compressed), **COMPRESSED** (present but numeric detail thinned),
**MISSING** (absent from v6), or **ALTERED** (changed in a way that affects math
meaning). Prose/labeling losses are ignored unless they change math meaning.

**Verdict in one line:** v6 is a remarkably faithful *index* of the source math —
every formula's NAME/shape survives. The losses are almost entirely **the
quantitative backing**: closed-form derivations, the actual numeric constants
(η, kT, Re, D_r, τ_relax, EI, drag formulas), and several explicit numeric TDD
thresholds are compressed to references or dropped. A handful of derived
quantities and one or two guard inequalities are genuinely MISSING.

Legend in "In v6?" column: P=present, C=compressed, M=missing, A=altered.

---

## TABLE 1 — AREA / DEFORMATION MATH (C1, C2, B1, B2, pipeline)
Sources: research-membrane-areacons.md, research-math-verify-v2.md,
review-growth-compression.md, review-deformation.md, review-plan-critique.md,
review-plan-v2-verify.md

| Item | Source file | In v6? | Note |
|---|---|---|---|
| Polar area identity `A=½∫r²dθ`, baseR²∫(1+d)²dθ ⇒ `mean((1+d)²)=1` | areacons, math-verify (1a) | C | v6 C1 states target `mean((1+d)²)=1` but DROPS the derivation from `A=½∫r²dθ`. Justification lost; formula kept. |
| C1 closed form `c = mean(e) − √(1−Var(e))`, e=1+d | areacons (1b), math-verify (2), growth-compression | P | Carried verbatim in C1. |
| C1 full quadratic `c²−2·mean(e)·c+(mean(e²)−1)=0` and ± root choice (smaller/− root) | math-verify (2), areacons | C | v6 gives only the solved `c=`; the quadratic + why the − root is dropped. |
| Alt quadratic form `Nc²−(2N+2S1)c+(2S1+S2)=0` w/ S1=Σd,S2=Σd² | growth-compression | M | The Σ-based form (drop-in pseudocode) is gone; only mean/Var form survives. Equivalent math, but the implementation-ready version is lost. |
| First-order approx `c ≈ mean(d)+½·mean(d²)` | growth-compression | M | Dropped. (critique recommends dropping it too, so intentional — but it IS a lost item.) |
| Var(e)≤1 real-root guard (discriminant ≥0) | areacons, math-verify (2), growth-compression | P | C1: "Var(e)>1 → multiplicative fallback". |
| Why Var(e)>1 has no real c: `min_c mean((e−c)²)=Var(e)` | math-verify (2) | M | The proof that the residual floor = Var(e) is dropped. |
| Multiplicative fallback `s = 1/√mean(e²)` | areacons (1c), math-verify, growth-compression | P | C1 carries it. |
| Lagrange derivation `d'ᵢ=(dᵢ+λ)/(1−λ)` (offset = pure-shift special case) | math-verify (2) | M | The Lagrange-multiplier proof that uniform offset is the correct projection is gone. |
| Assert `1+dᵢ−c>0` (no inside-out vertex) | areacons, math-verify, plan-critique | P | C1 guard list. |
| Mass-borrow proof (bulge pulls opposite side inward, with N=4 example) | math-verify (2c), growth-compression | C | v6 states "one-sided bulge borrows from opposite side" as a TEST; the derivation/counterexample dropped. |
| C2 affine squeeze `R(φ)·diag(k,1/k)·R(−φ)`, det=1 exact for ANY contour | areacons (1d), math-verify (1), critique, v2-verify | P | C2 carries the rotate/scale/rotate + det=1. |
| det proof `det M = detR·detS·detR = 1·1·1` | math-verify (1) | C | v6 states det=1; the multiplicativity proof compressed to assertion. |
| Shoelace transform `det[MPᵢ,MPᵢ₊₁]=detM·det[Pᵢ,Pᵢ₊₁]` ⇒ A'=detM·A | math-verify (1), areacons | M | The discrete shoelace proof that area scales by |det| is dropped. |
| Inverted-polar form circle-only; area err `(k²+1/k²)/2` (k=1.2→+6.7%) | areacons (1d), math-verify (1), critique (Bl.2) | C | v6 says "polar-multiply form was inverted AND circle-only — dropped." The numeric inflation table (k=1.05→+0.1%…k=1.3→+12%) and the `(k²+1/k²)/2` formula are GONE. |
| Correct reciprocal polar `f(θ)=1/√((cosθ/k)²+(k sinθ)²)`, mean(f²)=1 | critique (Bl.2), v2-verify | M | v6 abandons polar entirely for affine (better), so reciprocal form not needed — but the formula + its `mean(f²)=1` is no longer recorded anywhere. |
| Angle remap under squeeze `tanθ'=tanθ/k²` (why fixed-angle multiply is wrong) | math-verify (1) | M | The angle-moves argument dropped. |
| Cost analysis: affine ≈6 mul+4 add, no sqrt vs polar per-vertex sqrt | math-verify (1), critique perf | M | Performance/flops accounting dropped from v6. |
| tanh `d←Dmax·tanh(d/Dmax)`, unit slope at 0 (`g'(0)=sech²0=1`), strict bound <Dmax | areacons (4a), math-verify (5), deformation bug2 | P | B1 carries "unit slope at 0, strict bound <Dmax". |
| tanh Taylor `tanh x≈x−x³/3` (no dead zone) | areacons (4a), math-verify (5) | M | The series justification dropped. |
| Knee-gain variant `Dmax·tanh(g·d/Dmax)` | areacons (4a) | M | Exposed-gain option dropped. |
| Cheaper soft-clip `d/√(1+(d/Dmax)²)·Dmax` (algebraic sigmoid) | areacons (4c) | M | Transcendental-free alternative dropped. |
| Radius budget `baseR·(1+Dmax)·k_max ≤ maxRadius` + `baseR·(1−Dmax)/k_max ≥ floorRadius`, k_max=(1+elong)(1+squashGain) | math-verify (5), critique (Bl.3), areacons | P | B1 carries it, with the airtight `+|c|_max` refinement. |
| Airtight budget `baseR·(1+Dmax+|c|_max)·k_max ≤ maxRadius` | math-verify (5 caveat), v2-verify | P | B1: "baseR·(1+Dmax+|c|_max)·k_max ≤ maxRadius". |
| maxRadius = `min(w,h)·0.46`; 160×160 → baseRadiusPx16→maxRadius73.6 | critique (Bl.3), v2-verify, deformation | P | B1 + Containment carry the numbers. |
| 172×36 budget unsatisfiable (maxRadius≈16.6 < baseR·(1+Dmax)·k_max) | v2-verify (D), critique | C | v6 says "172×36 is harness, NOT a cell overlay" — scopes it out; the explicit 16.6px arithmetic dropped. |
| B2 cyclic Laplacian `d_i += λ(d_{i−1}+d_{i+1}−2d_i)/2`, λ≤0.5 | areacons (3a/B2), deformation bug3, math-verify (3) | P | B2 carries formula + λ≤0.5. |
| Convex-blend boundedness proof: integrate preserves |d|<Dmax (induction needs bounded seed) | math-verify (3) | C | v6 invariants mention bounded; the convex-combination proof + initialization-induction caveat dropped. |
| Area BROKEN by per-vertex ease (cross terms `αᵢ(1−αᵢ)(Δe)²`) → normalize-after-integrate | math-verify (3), critique (Bl.1) | C | v6 pipeline puts normalize after integrate (step 7 on integrated field) but drops the cross-term proof. |
| Pipeline 9-step order (saturate→integrate→smooth→normalize→squeeze→clamp) | critique, v2-verify, math-verify (3) | P | v6 RENDER PIPELINE section carries all 9 steps. |
| Frame-convergence: holding constant target K frames → fixed normalized deform, area=π·baseR² | v2-verify (E1) | P | C1 test "frame-convergence" + invariants. |

---

## TABLE 2 — SQUASH/STRETCH & EMA (D5, accel)
Sources: research-membrane-areacons.md, research-math-verify-v2.md, review-growth-compression.md, review-plan-critique.md

| Item | Source file | In v6? | Note |
|---|---|---|---|
| 2D volume-conserving stretch = squeeze `diag(k,1/k)`, stretch k → perp 1/k | areacons (2a), growth-compression | P | D5 / C2 carry it. |
| 3D analog: stretch s axis → 1/√s on each perp axis (`s·(1/√s)²=1`) | areacons (2a) | M | The 3D reference form dropped. |
| `aMag=|v−vPrev|/dt` (frame-rate-correct accel) | areacons (2b), growth-compression, math-verify (4) | P | D5: `aMag=|Δv|/dt`. |
| `aHat=clamp(aMag/aRef,0,1)`, `k_acc=1+squashGain·aHat` | areacons (2b), growth-compression | P | D5 carries it. |
| Two sequential squeezes det=1·1=1 (different axes φ_v, φ_acc) | math-verify (4), critique (Bl.4), v2-verify | P | D5 "Second sequential squeeze (det=1·1)". |
| Why NOT fold into k=k_v·k_acc one axis (axes diverge at bounce) | critique (Bl.4), math-verify (4), areacons (2b) | C | v6 D5 notes "on OWN axis φ_acc"; the bounce-divergence reasoning compressed. |
| EMA exact solution `x(t+dt)=x+(u−x)(1−exp(−dt/τ))` from `dx/dt=(u−x)/τ` | math-verify (4), areacons (2c) | C | v6 invariants cite `1−exp(−dt/τ)`; the ODE derivation dropped. |
| Semigroup proof: `exp(−dt₁/τ)·exp(−dt₂/τ)=exp(−(dt₁+dt₂)/τ)` (2 half-steps==1 full) | math-verify (4) | M | The frame-rate-independence proof dropped. |
| Fixed-lerp fails: effective τ = `−dt/ln(1−α)` scales with dt | math-verify (4) | M | The counter-derivation (why plain lerp is fps-dependent) dropped. |
| `aMag=|Δv|/dt` amplifies noise as dt→0; EMA+clamp handles it; bounce spike `~2·speed/dt` | areacons (2c), math-verify (4), critique (Bl.4) | C | v6 D5 says EMA-smoothed + "bounce-frame bounded (no pop)"; the spike magnitude `2·speed/dt` dropped. |
| τ_a ≈ 0.05–0.15 s; squashGain≈0.10–0.25; elong 0.10–0.30 | areacons (2c), growth-compression | C | v6 uses squashGain≈0.12, elong≈0.12–0.15 (narrower picks); the broader sourced RANGES dropped. |
| Typical k stays in [1.05,1.3] | areacons (2c) | C | Implied by v6's elong/squashGain picks; explicit band dropped. |

---

## TABLE 3 — CILIA HYDRODYNAMICS / PROPULSION (D2, D3, G1–G4, F1–F5)
Sources: research-cilia-hydrodynamics.md, research-cilia-structure-inertia.md, research-ciliate-propulsion-coupling.md, research-bio-verify-v2.md, review-motion-vector.md, review-fullpass-geometry-inertia.md

| Item | Source file | In v6? | Note |
|---|---|---|---|
| Per-cilium thrust `f ∝ (ξ⊥−ξ∥)·𝒜·ω` (linear in f, linear in amplitude) | propulsion-coupling (1), G&J | C | v6 G header cites "per-cilium thrust ∝(ξ⊥−ξ∥)·𝒜·ω, linear in f". Kept as citation, no derivation. |
| Whole-cell `U ≈ K·N·f·𝒜²·g/R` (μ cancels in force balance) | propulsion-coupling (2) | C | v6 G2 uses `U∝f·𝒜²` (Stokes-linear); the full N,g,R force-balance form + "μ cancels" dropped. |
| Tip-lean cantilever `δ_tip ≈ ξ⊥·U·L⁴/(8κ)`, normalized `δ/L ∝ U` | cilia-hydro (1b), cilia-structure | M | The closed-form cantilever-under-uniform-load formula is GONE. v6 D2 only keeps "linear in speed VERIFIED" + tanh saturation. |
| Saturation `δ_tip=δ_max·tanh(k·U)` from ξ⊥→ξ∥ alignment | cilia-hydro (1b), bio-verify (2c) | C | v6 keeps tanh (B1) labelled "physically-motivated soft clamp"; the ξ⊥→ξ∥ mechanism reasoning compressed. |
| Drag anisotropy `ξ⊥/ξ∥≈2`; slender RFT | cilia-hydro (1c), cellbody, propulsion | C | v6 mentions "(ξ⊥−ξ∥)"; the numeric ≈2 ratio dropped. |
| Spheroid drag `F_⊥=6π((3+2a/b)/5)μU`, `F_∥=6π((4+a/b)/5)μU` | cilia-hydro (1c) | M | The exact spheroid drag formulas dropped. |
| Drag-lean D2: `lead=ux·tx+uy·ty`; `dragGain=dragCoeff·speedNorm·(0.6+0.4·lead)`; `−(tx,ty)·dragGain·lenK·pow(sFrac,1.3)` | motion-vector (a) | P | v6 D2 carries the full formula. |
| dragCoeff ≈ 0.4–0.6 default range | motion-vector (a) | M | Numeric default range dropped from v6. |
| Metachronal D3: `metaIdx=(1−speedNorm)·k+speedNorm·(wrapPi(baseAngle−headingV)/gap)` | motion-vector (b), critique | P | v6 D3 carries it. |
| λ_metachronal: 5 cilia (Guirao, λ=4.2d) to 7 (Machemer); `φ=2π/λ≈0.9–1.26 rad` | bio-verify (3d), cilia-hydro (2c), cilia-structure | C | v6 sets ciliaMetachronal 0.8→1.1, mentions "λ≈5-7 cilia"; the φ=2π/λ mapping and the 0.8→λ7.85 arithmetic dropped. |
| ciliaMetachronal 0.8 ⇒ λ=2π/0.8≈7.85 cilia; 1.1 ⇒ λ≈5.7 | bio-verify (3d), cilia-hydro | M | The explicit λ-per-value arithmetic dropped (only the param change survives). |
| Power:recovery 9ms:26ms = 1:2.9, power fraction 0.257 | bio-verify (4a), cilia-structure (15), cilia-hydro (1d) | P | v6 SCOPE §5 + G header cite 9:26≈1:2.9. |
| `powerTime=(1−ciliaAsymmetry)/2`; 0.6⇒0.20 (1:4); solve (1−a)/2=0.257 ⇒ a≈0.49 | bio-verify (4b), cilia-structure (5,15) | P | v6 SCOPE §5 + D3: "ciliaAsymmetry 0.6→0.49 (real power:recovery=9:26≈1:2.9, not 1:4)". |
| Beat freq 30 Hz real; model 28 Hz; ciliaBeatHz 0.9 = ~30× artistic | bio-verify (4c), cilia-hydro, cilia-structure | C | v6 SCOPE §4 "ciliaBeatHz≈0.9 is ~30× slow-down of real 30 Hz". Model 28 Hz dropped. |
| Freq vs viscosity `28→19→14 Hz` at η_w,2η_w,3η_w (≈linear in log η) | cilia-hydro (1e), bio-verify (4c) | M | The viscosity–frequency table is GONE from v6. |
| ξ⊥/ξ∥ as origin of thrust; symmetric beat → zero net force | propulsion (1), cilia-hydro | C | v6 SCOPE §3 "Net propulsion needs NON-reciprocal stroke"; the ξ⊥≠ξ∥ specific origin compressed. |
| Curvature wave `κ(s,t)=κ0(s)+A(s)sin(2π(s/λ−ft))` | cilia-structure (2) | M | The canonical travelling-curvature-wave model dropped. v6 F1 keeps only `amp=curl·lenK·k·sin(π·sFrac)·(0.4+0.6·recovery)`. |
| Boundary conditions: base clamped θ(0)=θ0, tip free κ(L)=0, κ'(L)=0 | cilia-structure (3,7) | C | v6 F1 keeps "κ(L)=0 (free tip; 9+2 clamped base)"; the κ'(L)=0 zero-shear BC dropped. |
| F1 amp interior-peaked `sin(π·sFrac)` replacing `pow(sFrac,1.2)`; drop `beat·0.3`; waves≈0.6–1.0 | cilia-structure (1-5), motion-vector | P | v6 F1 carries the corrected envelope + waves≈0.6-1.0. |
| F2 bend cap `|bend| ≤ 0.5·gap·along` | fullpass (§1) | P | v6 F2 carries it. |
| F3 C¹ phase: slope jump `1/(1−a)`→`1/(1+a)`; `recovery=smoothstep((phase−0.35)/0.3)` | fullpass (§2) | P | v6 F3 carries recovery smoothstep + C¹ warp; the 1/(1−a)/1/(1+a) slope-jump values compressed to "dphase/dt jump". |
| Shared-axis F4: mean-resultant R>0.4 active | cilia-structure (Topic3), propulsion, motion-vector | P | v6 F4 test "R>0.4 at active". |
| G2 `U_norm=a·A_norm`; `ciliaBeatHz_eff=f0+(f1−f0)·a` (0.6→1.6); `curl_eff=curl·(1+0.3·a)` | propulsion (4) | P | v6 G2 carries all three. |
| Activity master `a=clamp(w_e·energy+w_g·growth,0,1)`, w_e≈0.6,w_g≈0.4 | propulsion (4), model-deficiencies (M1/M2) | P | v6 G1 carries it. |
| Couplings table: A=A0(1+κ_A·a) κ_A≈0.3; L=baseR(ciliaLen+growth·boost)(0.55+0.45·a); U_floor few % | propulsion (4 table) | C | v6 G2/G1 keep curl(1+0.3·a) and U_floor≈0; the per-quantity range table compressed. |
| Metachrony benefits: lowers threshold Ω_c, raises f_c, steady flow (energetic gain "small") | propulsion (4), G&J | M | The threshold/frequency/steadiness quantification dropped; v6 G just couples φ to a. |
| Stokes linearity: U∝f exact, rate changes scale not pattern; reverse beat reverses U | propulsion (6,7), fluid-medium | C | v6 SCOPE §3 + G2 capture U∝f and instant stop; rate-invariance-of-pattern statement dropped. |

---

## TABLE 4 — LOW-Re FLUID MEDIUM / INERTIA / BROWNIAN (H1–H4, F5, F6, F8)
Sources: research-fluid-medium-motion.md, research-cellbody-parts.md, research-cilia-structure-inertia.md, research-ciliate-propulsion-coupling.md

| Item | Source file | In v6? | Note |
|---|---|---|---|
| Stokes eqns `0=−∇p+η∇²u, ∇·u=0`, no time deriv → quasi-static | fluid-medium (1,5), propulsion (6) | M | The Stokes equation itself is not in v6; only the consequence "Re≈1e-4–1e-2: NO inertia" (SCOPE §3) survives. |
| Re = ρul/μ; band Re≈1e-4–1e-1; per-scale (diam 4e-4, length 2e-2, whole 0.2) | fluid-medium, cellbody (6), cilia-structure (11) | C | v6 SCOPE §3 gives "Re≈1e-4–1e-2"; the ρul/μ formula and per-scale Re values dropped. |
| Stokes drag `F=6πηru` | fluid-medium, cellbody (7), propulsion | M | Drag law dropped from v6. |
| Stop time `τ=m/(6πηr)=(2/9)ρr²/η`; bacterium ~56ns, Paramecium ~0.5ms | cellbody (7), fluid-medium, cilia-structure (12) | M | The Stokes stop-time closed form + numeric values GONE. v6 just says "instant stop / same frame". |
| Coasting distance `d=v·τ` ~0.017–0.1 Å (bacterium), 0.6µm (Paramecium <0.3% body) | cellbody (7), fluid-medium, propulsion | M | Purcell coasting numbers dropped from v6. |
| Inertial relaxation `τ_in=m/γ≈10ns`, τ_in/T~3e-7 (~7 orders below relevance) | cilia-structure (12) | M | The 7-orders-of-magnitude inertia argument dropped. |
| Elastohydrodynamic `τ_relax=ξ⊥L⁴/(κ_B·a₁⁴)`, a₁≈1.875, ≈0.1–1ms < 33ms beat | cilia-structure (13) | M | The elastic relaxation timescale formula + value GONE. |
| Transverse drag `ξ⊥≈4πμ/ln(L/r)≈2.7e-3` | cilia-structure (12) | M | Dropped. |
| Axonemal bending stiffness `EI≈0.4–2×10⁻²¹ N·m²`; κ≈4×10⁻²² | cilia-structure (gaps), cilia-hydro (1b) | M | EI/κ values dropped. |
| Stokes–Einstein `D_t=kT/6πηr`; nucleus D≈9e-3 µm²/s; RMS √(4Dt)≈0.19µm/s | cellbody (11), fluid-medium (2) | C | v6 F10 keeps "Brownian D~0.01µm²/s" + "nucleusWander→≤0.03·baseR"; the Stokes-Einstein formula + RMS calc dropped. |
| Rotational `D_r=kT/8πηr³`, ζ_r=8πηr³, ⟨θ²⟩=2D_r·t; ∝1/r³ | fluid-medium (2) | C | v6 H2 keeps "D_r∝1/r³" + test "RMS/s=√(2D_r)∝1/r³"; the D_r=kT/8πηr³ closed form dropped. |
| D_r numeric: r=50µm→1.3e-6 rad²/s (0.09°/s); r=5µm→1.3e-3 (2.9°/s); 1µm→33°/s | fluid-medium (2), cellbody | M | All numeric D_r / reorientation-rate values dropped. |
| wanderTurnRate=1.1 rad/s as ACTIVE steering (not thermal) | fluid-medium (2), cellbody (8) | P | v6 SCOPE §4: "wanderTurnRate = ACTIVE steering, not thermal Brownian." |
| Brownian add `heading += √(2·D_r·dt)·gauss()` | fluid-medium (2), cellbody | P | v6 H2 carries it. |
| Sedimentation `v=(2/9)(ρ−ρw)g r²/η`; Δρ=50 → 270µm/s (r=50µm), 2.7µm/s (r=5µm) | fluid-medium (3), cellbody | M | The terminal-velocity formula + values dropped. v6 H3 keeps only "<15% swim speed" qualitative bias. |
| H3 sedimentation bias <15% swim speed; time-avg velocity≈0 default | fluid-medium (3) | P | v6 H3 carries the threshold + test. |
| Flow field: stresslet/force-dipole decays ~1/r² (vs 1/r Stokeslet); pusher/puller | fluid-medium (4) | P | v6 H4 carries "DIPOLAR field ~1/r²" + tests. |
| Tracer `u≈A·(swimdir·stencil)/r²`; reverse heading reverses flow; net momentum≈0 | fluid-medium (4) | P | v6 H4 tests carry all three. |
| Scallop theorem: reciprocal motion → zero net displacement | fluid-medium (1,5), propulsion (8) | P | v6 SCOPE §3 "NON-reciprocal stroke (asymmetric power/recovery)". |
| F5 memoryless velocity (no v+=a·dt); speed=driftSpeed·min(w,h)·1.2 | cellbody (8), fluid-medium (1), fullpass (§4), motion-vector | P | v6 F5 carries it. |
| F6 decoupled wander clock `jitter=noise2D(wanderClock·wanderFreq,31.7)` | fullpass (§4), fluid-medium (F-5), motion-vector | P | v6 F6 carries the exact formula. |
| F8 dt-consistency `1−exp(−dt/τ)` for driftActivation/growth/startle | fluid-medium (F-3), fullpass, model-def (M6,M11) | P | v6 F8 carries it. |
| Wall avoidance F7 `heading+=π±rand·0.6` (back-up+reorient, not specular) | fluid-medium (1,F-1), cellbody (5), fullpass | P | v6 F7 carries the formula. |
| H1 startle = heading kick (not mass-spring dart+recoil) | fluid-medium (5,F-2), cellbody, model-def (M8) | P | v6 H1 carries it. |
| Run-and-tumble vs eukaryotic continuous; persistence L_p=v·τ_r; helical ~1–2 Hz roll | fluid-medium (6), cellbody (9) | C | v6 G4 mentions "opt slow roll"; the persistence-length formula + 1–2 Hz roll-rate + run-and-tumble math dropped. |
| Swim speed table: Tetrahymena >500µm/s, Chlamy 150µm/s, Paramecium ~1mm/s≈10 BL/s | cellbody (8), propulsion (3), cilia-hydro | M | The calibration speed table dropped (artistic px speed used instead — acceptable, but the bio anchors are gone). |

---

## TABLE 5 — CILIA COUNT / PLACEMENT / DENSITY (A1, E1, F12)
Sources: review-count-placement.md, research-bio-verify-v2.md, research-cilia-hydrodynamics.md, research-cilia-structure-inertia.md, review-fullpass-geometry-inertia.md

| Item | Source file | In v6? | Note |
|---|---|---|---|
| A1 clamp ciliaAngleJitter [0,0.9] (mirror lenVar) | count-placement (Blocker), fullpass, critique | P | v6 A1 carries it. |
| Adjacent diff ≤ angleJit·gap; reorder threshold ≳1.15; |noise|≤0.87 | count-placement (Blocker) | C | v6 A1 keeps the clamp + ordering test; the derivation (why 1.15, the ±0.87 noise bound) dropped. |
| E1 perimeter count `n=round(TAU·baseR/ciliaSpacingPx)` | count-placement (Note), cilia-hydro (4b), bio-verify (5) | P | v6 E1 carries it. |
| Count ∝ surface area (R²) 3D ⇒ perimeter (R) in 2D rim | cilia-hydro (4b), bio-verify (5), cellbody | C | v6 E1 implies it; the R²→R projection reasoning compressed. |
| Density spacing table: baseR12.24→4.27px, 14.93→5.21px; growth swell +22% | count-placement (Note) | M | The measured spacing-vs-size table dropped. |
| ~4000 cilia, one per pellicle polygon, d≈1–3µm < L≈10–12µm | bio-verify (5), cilia-hydro (4a), cilia-structure | M | The biological count/spacing anchors dropped from v6 (only "λ≈5-7 cilia" survives). |
| E1 precondition seed fix `noise2D(k*12.9898, 7.2+k*0.123)` if n>150 | count-placement (Note), critique, v2-verify, model-def (M10) | P | v6 E1 carries the precondition. |
| F12 cellReach factor: live worst (ciliaLength+boost)(1+lenVar)=1.5 vs code 1.3 | fullpass (§6) | P | v6 F12 carries 1.5 vs 1.3 + headroom. |
| cellReach ≈ 2.2×baseR; membrane≠cellReach separation | fullpass (§6), v2-verify (D), critique | P | v6 Containment section carries both radii + the "never conflate" rule. |
| lag-1 autocorr 0.030; cross-corr test <0.2 (M10) | count-placement, model-def (M10) | P | v6 M10 test "cross-corr <0.2". |

---

## TABLE 6 — MODEL ROBUSTNESS / GEOMETRY (A3, B3, F9, F10, F11, F13, M-items)
Sources: review-deformation.md, review-fullpass-geometry-inertia.md, review-model-deficiencies.md, research-cellbody-parts.md

| Item | Source file | In v6? | Note |
|---|---|---|---|
| A3 bin interp `u=norm·N; i0=floor(u)%N; i1=(i0+1)%N; lerp(bins[i0],bins[i1],smoothstep(f))` | deformation (bug1), fullpass, critique | P | v6 A3 carries smoothstep-lerp + wraparound; the explicit index math compressed to "smoothstep-lerp, KISS". |
| binDeform = binLevel·0.15·energy | deformation (bug1), growth-compression | C | v6 A3 references bins; the 0.15 coefficient dropped. |
| Spurious area inflation quantified: pseudopod ⟨cos⁴⟩=3/16≈0.1875; d̄≈0.10 → ~20%+ | growth-compression (Blocker) | M | The quantified ~20% inflation derivation GONE (motivates C1 but not recorded). |
| Growth swell bounded: radius [1.0,1.22]×, area [1.0,1.49]× (1.22²); growthSwell 0.22 | growth-compression (Correct) | M | The growth-area bound arithmetic dropped. |
| F9 nucleus pinch: containment `|offset|+r ≤ minMembraneR·(1−0.15)`; thread min(1+deform)·baseR | fullpass (§5), model-def (M14) | P | v6 F9 carries it. |
| Old containment fails: fixed 0.55·baseR vs floor 0.35·baseR | fullpass (§5) | C | v6 F9 mentions "fixed 0.55·baseR fails when membrane floors to 0.35"; the deform<−0.45 reachability calc dropped. |
| F10 nucleus immobile: nucleusWander 0.14→≤0.03·baseR; RMS≤0.03·baseR/s | cellbody (11), fullpass, model-def | P | v6 F10 carries it. |
| F11 contractile vacuole: `u=(t/Tcv)mod1`, Tcv∈[5,10]s, `r_cv=R_max·smoothstep(0,0.85,u)`, R_max≈0.18·baseR | cellbody (13) | P | v6 F11 carries the full model. |
| CV diameters: Paramecium 13µm, Amoeba 45µm, Chlamy 1.5µm; R_max scaled from 13µm/120µm | cellbody (13) | M | The CV-diameter source anchors dropped (R_max≈0.18·baseR survives). |
| F13 band-limit: modes |n|≤4, amp ≤0.08, FBM 4→1-2 octaves; >90% power in |n|≤4 | cellbody (1,2), fullpass, model-def | P | v6 F13 carries all thresholds. |
| Membrane wobble spectrum n≈2–4, amp ≲5–8% (bending+tension stiffness) | cellbody (1.2) | C | v6 F13 keeps |n|≤4, ≤0.08; the bending/tension physical justification dropped. |
| M12 open Catmull-Rom (clamped ends) vs closed wrap forcing tip curvature | model-def (M12), fullpass | P | v6 M12 carries it. |
| M14 nucleus affine squeeze (k,φ) + contain in squeezed frame | model-def (M14), fullpass, cellbody | P | v6 M14 carries it. |
| M15 NaN guard: `audioLevel=clamp(finite?x:0,0,1)`, bad bins→0; one NaN poisons form-memory | model-def (M15) | P | v6 M15 carries it. |
| M4 persist {x,y,heading,growth,elapsed}, drop driftPhase; first frame <1px | model-def (M4) | P | v6 M4 carries it. |
| M5 store pos as FRACTION of tank; namespace PERSIST_KEY; 160→320 stays ±1% | model-def (M5) | P | v6 M5 carries it. |
| M6 cellEnergy EMA-chase (4 branches step-change); mode-flip |Δenergy|≤within-mode max | model-def (M6) | P | v6 M6 carries it. |
| M9 idleFactor from smoothed (1−a)+smoothstep; partition of unity | model-def (M9), deformation | P | v6 M9 carries it. |
| M11 single `simTime+=dt` accumulator (two-clock desync); 500ms gap test | model-def (M11), fullpass | P | v6 M11 carries it. |
| M16 bin count: math assumes 32; resample/assert; 16/32/64 periodic-continuous | model-def (M16) | P | v6 M16 carries it. |
| M10 distinct 2-D walk / irrational offset per organ | model-def (M10), count-placement | P | v6 M10 carries it. |
| M13 growthLevel transcribing target consistent w/ cellEnergy | model-def (M13) | P | v6 G1 "Give growthLevel a transcribing target consistent w/ cellEnergy (fixes M13)". |
| M7 bodyHeading EMA-chase; aspect→1 at a=0; Lipschitz | model-def (M7) | P | v6 G4 carries it. |
| M8 startle heading kick not centre-shove | model-def (M8), fluid-medium | P | v6 H1 "(+M8)". |
| Star-shaped guard: atan2 about centre monotonic mod 2π (Catmull-Rom overshoot) | deformation (bug1) | M | This self-intersection guard test is not explicitly in v6 (M12 covers tip, not the membrane overshoot monotonicity). |
| Pseudopod base kink: `max(0,cosΔ)^sharpness` C¹ only if sharpness≥2 | deformation (bug4) | M | The sharpness≥2 C¹ constraint dropped from v6. |
| D4 fixed prolate k≈1.15 / k_motion=1+elong·max(driftFloor,speedNorm), elong≈0.12–0.15 | cilia-hydro (3), cellbody, propulsion, motion-vector | P | v6 D4 carries it (fixed, not speed-ramped — matches bio correction). |
| Aspect ratio 3–4:1 (real) vs stylized 1.6–2.2; k=√aspect | cellbody (1), cilia-hydro (3b) | C | v6 SCOPE §2 keeps k≈1.15 mild prolate; the 3–4:1 real ratio + k=√aspect mapping dropped. |

---

## SEVERITY-RANKED LIST OF GENUINE LOSSES TO RESTORE

Ranked by impact on the plan's usefulness as an implementation+TDD spec. Note:
v6 is explicitly a *consolidated working plan* and most "losses" are derivations
that back claims already present — so severity reflects whether an implementer
could go wrong without the missing math.

### SEV-1 (HIGH — could cause an implementation error or untestable claim)
1. **C2 inverted-polar inflation formula `(k²+1/k²)/2` and the k→area-error table
   (k=1.2→+6.7%, k=1.3→+12%).** v6 says the polar form "was inverted AND
   circle-only — dropped," but a future maintainer tempted to reintroduce a
   radial-multiply has NO recorded warning of the magnitude. Restore one line:
   the inflation factor + the "affine is exact for any shape" contrast.
   (Sources: areacons 1d, math-verify 1, critique Bl.2.)
2. **Spurious ~20% additive-area inflation derivation** (pseudopod ⟨cos⁴⟩=3/16,
   d̄≈0.10). This is the entire *motivation* for C1. v6 states C1 conserves area
   but never records WHY today's cell over-inflates — the quantified problem
   statement is gone. Restore the 2–3 line estimate. (growth-compression.)
3. **Star-shaped/Catmull-Rom overshoot guard** (atan2 monotonic mod 2π) and the
   **pseudopod sharpness≥2 C¹** constraint. These are concrete self-intersection
   / kink TDD properties not covered by v6's M12 (which only guards the cilium
   tip). Without them, A3+B2 can still ship overshoot loops. (deformation bug1, bug4.)

### SEV-2 (MEDIUM — weakens the bio-faithfulness backing / parameter justification)
4. **Tip-lean cantilever closed form `δ_tip≈ξ⊥·U·L⁴/(8κ)`.** The only sourced
   closed form linking swim speed to cilia lean. v6 keeps "linear in speed" but
   loses the formula that justifies the scaling and the saturation. (cilia-hydro 1b.)
5. **Viscosity–frequency table `28→19→14 Hz`** and **freq/30Hz/28-model anchors.**
   If ciliaBeatHz is ever coupled to a "medium thickness" param (G2 leaves room),
   this is the only sourced mapping. (cilia-hydro 1e, bio-verify 4c.)
6. **λ↔ciliaMetachronal arithmetic** (`φ=2π/λ`; 0.8→λ7.85, 1.1→λ5.7). v6 changes
   the param but drops the math proving 1.1 lands in the 5–7 cilia band — the
   tuning is now an unexplained constant. (bio-verify 3d, cilia-hydro 2c.)
7. **Full propulsion law `U≈K·N·f·𝒜²·g/R` + "μ cancels".** v6 keeps `U∝f·𝒜²`
   but loses the N (count), g (asymmetry), R (size) dependence — relevant if E1
   ever changes N or baseR changes. (propulsion-coupling 2.)
8. **dragCoeff 0.4–0.6 default range** and **D5 squashGain/elong/τ_a broader
   ranges.** v6 picks single values; the sourced ranges that bound them are gone,
   making future re-tuning blind. (motion-vector a, areacons 2c.)

### SEV-3 (LOW — physics context / proofs that back already-present claims)
9. **Low-Re quantitative backbone**: Stokes drag `F=6πηru`, stop time
   `τ=(2/9)ρr²/η` (~56ns/0.5ms), coasting `~0.1Å`, τ_relax `≈0.1–1ms`,
   D_r/D_t closed forms + numeric reorientation rates, sedimentation terminal
   velocity. v6 correctly keeps every *consequence* (instant stop, ∝1/r³,
   <15% bias) but drops all the closed forms and numbers. Low risk because the
   behaviors are captured; restore as an appendix if the plan must be
   self-justifying. (cellbody 6-11, fluid-medium 2-3, cilia-structure 12-13.)
10. **Closed-form proofs** that back present formulas: C1 Lagrange derivation,
    shoelace det-multiplicativity, EMA semigroup proof, convex-blend boundedness,
    quadratic root-choice. All conclusions are in v6; only the proofs are gone.
    (math-verify 1-5.) Lowest risk — these were verification artifacts.
11. **Biological calibration anchors**: ~4000 cilia, d 1–3µm, L 10–12µm, swim-speed
    table, CV diameters (13/45/1.5µm), aspect 3–4:1. v6 keeps the stylized derived
    values; the source anchors that justify them are dropped. (Multiple files.)

---

## BOTTOM LINE

- **No formula that v6 ACTIVELY USES was altered into incorrectness.** Every
  live formula (C1 offset, C2 affine det=1, B1 tanh+budget, D2/D3, G1/G2,
  F1-F13, M4-M16, H1-H4) is present and matches its source. No ALTERED-to-wrong
  items found.
- **The dominant loss class is QUANTITATIVE BACKING, not formulas:** ~40 numeric
  constants/closed-forms/derivations (Re, η, kT, drag laws, stop times, D_r,
  τ_relax, EI, viscosity-freq table, inflation factors, λ arithmetic, calibration
  anchors) were compressed to references or dropped. This is consistent with v6
  being a *consolidated working plan* rather than a research dossier.
- **Genuinely MISSING items an implementer could trip on** are few: the C2
  inflation warning (SEV-1.1), the ~20% inflation motivation (SEV-1.2), and two
  geometry TDD guards — star-shaped monotonicity + pseudopod sharpness≥2
  (SEV-1.3). Recommend restoring those three to v6; the rest can live in an
  appendix or the source files (which remain at repo root and are referenced by
  v6's provenance header).
