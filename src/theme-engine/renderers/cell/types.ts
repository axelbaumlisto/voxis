export interface CellParams {
  /** FBM noise scale factor applied to the angular sample direction. */
  noiseScale: number;
  /** Number of FBM octaves. */
  octaves: number;
  /** FBM lacunarity (frequency multiplier). */
  lacunarity: number;
  /** FBM gain (amplitude multiplier). */
  gain: number;
  /** Time scaling factor for drifting the noise domain. */
  timeScale: number;
  /** Amplitude multiplier for FBM membrane deformation (was hardcoded 0.28). */
  membraneAmplitude: number;
  /** How much energy (beyond idle) drives FBM deformation amplitude. */
  energyDrive: number;
  /** Base pseudopod push amplitude. */
  push: number;
  /** Sharpness exponent for pseudopod directionality. */
  sharpness: number;
  /** Drift rate for the pseudopod intent direction. */
  intentDrift: number;
  /** Idle energy floor (keeps subtle movement during silence). */
  idle: number;
  /** How much audio level amplifies the deformation. */
  levelGain: number;
  /** Total hue spread across the contour (degrees). */
  hueSpread: number;
  /** Hue shimmer speed factor. */
  shimmerSpeed: number;
  /** Extra hue boost from audio level. */
  hueBoost: number;
  /** Fill alpha (cytoplasm opacity). */
  fillAlpha: number;
  /** Lowpass tension for temporal smoothing of radii (0=no smoothing, 1=full).
   * @deprecated Replaced by persistent form memory (attack/release).
   * Kept for backward-compat; not used by the default renderer tick path. */
  tension: number;
  /** Base cell radius as fraction of min(width, height). */
  radiusFraction: number;
  /** Absolute base radius in pixels. When set, overrides radiusFraction. */
  baseRadiusPx?: number;
  /** Drift travel speed factor (multiplier on time for noise phase). */
  driftSpeed?: number;
  /** Margin in pixels from window edges the cell centre must respect. */
  driftMargin?: number;
  /** Wander heading turn rate (radians/sec scale for the random walk of the
   * travel direction). Larger = curvier, more restless path; smaller = long
   * sweeping arcs. Used by `wanderStep`. */
  wanderTurnRate?: number;
  /** Wander-clock frequency (Hz-like) at which the heading-jitter noise is
   * sampled. F6: decouples the random walk from position so it never stalls.
   * ~0.6 keeps turns gentle and aperiodic. Used by `wanderStep`. */
  wanderFreq?: number;
  /** Per-frame blend factor when deformation is being pushed further.
   * ~0.20 reaches ~90% of a new shape within ~0.2s at 60fps. */
  attack: number;
  /** Per-frame blend factor when deformation is relaxing back to idle.
   * ~0.005 gives a time constant τ ≈ 3.3s (relaxation half-life ~2.3s). */
  release: number;
  /** Nucleus radius as fraction of baseR — determines the resting size of the
   * organelle. At the 172×36 window this yields ~3.4 px (well above 2.5 px
   * minimum). */
  nucleusRadius: number;
  /** Audio-driven pulse amplitude for the nucleus radius (fraction of baseR).
   * During loud recording the nucleus visibly expands. */
  nucleusPulse: number;
  /** Nuclear drift amplitude — max offset from cell center as fraction of
   * baseR. The nucleus wanders slowly via deterministic 2D noise.
   * F10: a real nucleus is near-immobile (Brownian D~0.01 um^2/s). Set this low
   * (<=0.03) for a still nucleus; the default 0.14 keeps a gentle visible drift
   * for the stylized look. Per-axis |offset| <= nucleusWander*baseR (|noise|<=1),
   * so |offset| <= sqrt(2)*nucleusWander*baseR overall (the hard bound); long-run
   * RMS is ~0.66*nucleusWander*baseR (expectation), not a hard cap. */
  nucleusWander: number;
  /** Drift speed — rate at which the nucleus noise seed advances (Hz-like).
   * Higher values produce a more restless organelle. */
  nucleusDrift: number;
  /** Nucleus fill opacity — deliberately higher than `fillAlpha` so the
   * organelle reads as a *denser* body inside the translucent cytoplasm. */
  nucleusAlpha: number;
  /** Membrane stroke saturation (0-1). Default 0.85 (vivid). Lower for DIC look. */
  membraneSat?: number;
  /** Nucleus saturation multiplier (0-1). Default 1.0. Set <1 for gray nucleus. */
  nucleusSatMul?: number;
  /** Override hue for food vacuoles (degrees). Default baseHue-30. */
  foodVacuoleHue?: number;
  /** Override hue for contractile vacuoles (degrees). Default baseHue+20. */
  cvHue?: number;
  /** Cytoplasm fill saturation (0-1). Default 0.70. Lower for DIC look. */
  cytoplasmSat?: number;
  /** Cilia stroke saturation (0-1). Default 0.60. Lower for transparent protein. */
  ciliaSat?: number;
  /** Membrane stroke lightness (0-1). Default 0.60. Higher for silvery edge. */
  membraneLightness?: number;
  /** fillAlpha at full activity. Default = fillAlpha (no change). Lerps with activity. */
  fillAlphaActive?: number;
  /** membraneLightness at full activity. Default = membraneLightness (no change). Lerps with activity. */
  membraneLightnessActive?: number;
  /** Granule fill saturation (0-1). Default 0.60. Lower for refractile dots. */
  granuleSat?: number;
  /** Minimum swim speed fraction even at activity=0 (0-1). Default 0. Non-zero = cell drifts at idle. */
  idleSwimFrac?: number;
  /** Minimum drift activation floor (0-1). Default 0. Non-zero = wander position visible at idle. */
  idleDriftMin?: number;
  /** Helical swimming: lateral sinusoidal offset as fraction of baseRadiusPx.
    * In 2D the 3D helical path projects as a sinusoidal oscillation perpendicular
    * to the swim direction. Phase = axial spin phase (left-handed). Default 0. */
  helicalAmplitude?: number;
  /** Number of cilia (hair-like tentacles) around the membrane. */
  ciliaCount: number;
  /** Resting cilium length as fraction of baseR. */
  ciliaLength: number;
  /** Extra cilium length from growth (fraction of baseR). */
  ciliaGrowthBoost: number;
  /** Lateral wave amplitude of cilia tips (radians of angular sway). */
  ciliaWave: number;
  /** Cilia wave speed. */
  ciliaWaveSpeed: number;
  /** Sideways bow of each cilium as a fraction of its length (Bezier control
   * point perpendicular offset). 0 = straight needle, ~0.4 = clearly bowed
   * flagellum. Drives the organic curved look. */
  ciliaCurl: number;
  // --- Biologically-motivated ciliary beat (Gompper/Elgeti et al.; Nature
  // Commun. 2023 flagella waveform). Real motile cilia have a two-phase
  // ASYMMETRIC beat: a fast near-straight POWER stroke and a slow strongly-
  // curved RECOVERY stroke; the bending wave travels base->tip; neighbouring
  // cilia beat with a phase lag so a METACHRONAL wave sweeps round the cell. ---
  /** Beat frequency in Hz (cycles/sec) of a single cilium at REST (activity 0).
   * ~0.6–1.2 reads as lively but not buzzing at overlay scale. */
  ciliaBeatHz?: number;
  /** G2: beat frequency in Hz at FULL activity (a=1). The effective beat Hz
   * ramps f0=ciliaBeatHz -> f1=ciliaBeatHzActive linearly with activity, so a
   * louder voice beats faster (Stokes-linear U ∝ f). */
  ciliaBeatHzActive?: number;
  /** Power/recovery time asymmetry in [0,1). 0 = symmetric sine; 0.6 = fast
   * power stroke, slow recovery (more biological). */
  ciliaAsymmetry?: number;
  /** Metachronal phase lag between adjacent cilia, in radians. Non-zero makes
   * a wave travel around the crown instead of all hairs beating in unison. */
  ciliaMetachronal?: number;
  /** Number of segments per cilium polyline (>=2). More = smoother bend wave. */
  ciliaSegments?: number;
  /** Per-hair length variation, fraction in [0,1). 0 = all equal length;
   * 0.5 = lengths span roughly ±50% around the mean (biologically diverse). */
  ciliaLengthVar?: number;
  /** Per-hair angular jitter as a fraction of the mean gap between hairs.
   * 0 = perfectly even spacing; ~0.6 = clearly irregular, aperiodic crown. */
  ciliaAngleJitter?: number;
  /** D2: viscous drag-lean coefficient. How far (as a fraction of hair length)
   * the crown leans rearward at full swim speed. Default 0.5. */
  dragCoeff?: number;
  /** Base stroke width (px) at the thickest hair; thinner hairs taper from
   * this. Each hair also tapers base->tip. */
  ciliaWidth?: number;
  /** Growth attack per-frame (fast rise during speech). */
  growthAttack: number;
  /** Growth release per-frame (slow shrink in silence). */
  growthRelease: number;
  /** How much growth swells the cell radius (fraction). */
  growthSwell: number;
  /** Startle sensitivity (edge gain). */
  startleSensitivity: number;
  /** Startle decay per-frame [0,1]. */
  startleDecay: number;
  /** Startle max displacement in px. (Legacy positional shove; only used when
   * `enableStartleKick` is false.) */
  startleMaxPx: number;
  /** Baseline tracking rate for startle edge detection. */
  startleBaselineRate: number;
  /** H1/M8: model startle as a low-Re escape dart (heading kick + speed burst)
   * instead of the legacy positional centre shove. Default true. */
  enableStartleKick?: boolean;
  /** H1: minimum rising edge in startle magnitude to trigger a heading kick. */
  startleKickThreshold?: number;
  /** H1: max heading kick magnitude (radians) on a startle onset. */
  startleKickMax?: number;
  /** H1: transient swim-speed burst while startled, as a fraction of baseR/sec. */
  startleBurstFrac?: number;
  /** Idle resting morph amplitude (deformation fraction of baseR). */
  idleMorphAmplitude: number;
  /** Idle morph traveling speed (how fast bumps move around the membrane). */
  idleMorphSpeed: number;
  /** Idle morph envelope period in seconds (wax/wane cycle). */
  idleMorphPeriod: number;
  /** Idle morph minimum envelope (0..1): residual morph at the trough. */
  idleMorphFloor: number;
  /** Per-frame rate at which the cell blends between centered (rest) and
   * cellDrift-positioned (recording). 0=never move, 1=instant jump.
   * Default ~0.02 → the cell ramps from centered to fully drifting in
   * about 3 seconds at 60 fps. */
  driftActivationRate?: number;

  // --- Pipeline gates (see .pi/plans/cell-bio-accuracy-plan.md RENDER PIPELINE).
  // Each gate dark-launches a later-commit stage. ALL DEFAULT FALSE: with every
  // gate off the deformation pipeline is byte-identical to the pre-pipeline
  // behavior. The actual stage math lands in the noted commits; until then each
  // gated stage is a transparent identity seam. ---
  /** Step 4 — soft-saturate target deformation `d ← Dmax·tanh(d/Dmax)` [B1, commit 6]. */
  enableSaturation?: boolean;
  /** B1 saturation ceiling Dmax: the soft bound on |deformation| (strict: |out| < Dmax).
   * tanh has unit slope at 0 so deformations well below Dmax are nearly unchanged.
   * Sized with the radius budget: baseR·(1+Dmax) ≤ maxRadius = min(w,h)·0.46. */
  deformMax?: number;
  /** Step 7 — area normalization on the integrated field `mean((1+d)²)=1` [C1, commit 7]. */
  enableAreaNorm?: boolean;
  /** Step 8 — area-preserving affine squeeze in the heading frame [C2/D4, commit 7/8]. */
  enableAffine?: boolean;
  /** Step 2 — single activity scalar `a` driving amplitudes/propulsion [G1, commit 8]. */
  enableActivity?: boolean;
  /** G2: peak swim speed at a=1 as a fraction of min(w,h) (px/sec = frac·min(w,h)·a).
   * Replaces the free driftSpeed when enableActivity is on. */
  swimSpeedMaxFrac?: number;
  /** G1: weight of instantaneous energy in the activity scalar (default 0.6). */
  activityEnergyWeight?: number;
  /** G1: weight of the smoothed growth accumulator in the activity scalar (default 0.4). */
  activityGrowthWeight?: number;
  /** G4: EMA time-constant (seconds) for the body heading chasing the velocity
   * heading. Larger = lazier turning of the long axis. Default 0.4. */
  bodyHeadingTau?: number;
  /** Interior heading tau — slower EMA for interior organelle projection.
   * When set, interiorPoint uses a separate heading that lags bodyHeading,
   * so organelles don't jitter when the body turns quickly.
   * Default 0 = use bodyHeading directly (legacy). */
  interiorHeadingTau?: number;
  /** D4: prolate elongation gain. Aspect k = 1 + bodyElongation*max(floor,speedNorm).
   * ~0.12-0.15 is a mild, biological ciliate prolate. Default 0.13. */
  bodyElongation?: number;
  /** D4: minimum elongation fraction even at rest (0 = round at rest, so D4
   * collapses to identity when still). Default 0. */
  bodyElongationFloor?: number;
  /** Commit 30: when true the resting body is a prolate spindle (~3:1) even at
   * speedNorm=0, like a real Paramecium, instead of a circle. Gates a resting
   * floor on prolateAspect; swimming can still elongate further above it.
   * Default false (byte-identical legacy circle-at-rest behavior). */
  enableRestingProlate?: boolean;
  /** Commit 30: resting affine k for the spindle. The affine applies diag(k,1/k)
   * so the major/minor axis ratio = k^2; k=1.7 => ~2.9:1 (~3:1). Default 1.7. */
  prolateRestAspect?: number;
  /** Commit 24: when true the cell SPINS about its long axis as it swims. A real
   * Paramecium is a near-rigid spindle; the apparent breathe is the 2D
   * foreshortening of that rotating spindle. Modelled as a pure body-frame
   * rotation of the area-preserving affine squeeze (det=1 => area invariant),
   * adding `-rate*simTime` to squeezePhi where rate = axialSpinMax*speedNorm.
   * Default false (spinPhi=0 => squeezePhi=bodyHeading, byte-identical). */
  enableAxialSpin?: boolean;
  /** Commit 24: max axial spin rate (rad/s) at full speed. Paramecium spins
   * ~0.5-2 rev/s; 3.5 rad/s ~= 0.56 rev/s is a calm default. Rate scales with
   * speedNorm so a resting cell does not spin. Default 3.5. */
  axialSpinMax?: number;
  /** F4/G3: bias every hair's beat plane toward ONE global stroke axis (the body
   * heading) so the crown ROWS coherently while swimming, weighted by activity
   * (G3). Default true; when false the crown uses per-hair local azimuth
   * (byte-identical to commit 11). */
  enableStrokeAxis?: boolean;
  /** G3: stroke-axis vigour curve. axisStrength = smoothstep(activity/knee), so
   * idle is near-isotropic (R<0.2) and active is coherent (R>0.4). Default 0.5. */
  strokeAxisKnee?: number;
  /** F4: max fraction [0,1] a fully-engaged hair rotates its beat plane from its
   * local azimuth toward the global axis. Default 1 (full alignment). */
  strokeAxisAlign?: number;
  /** M6: EMA-chase the per-mode energy target to remove the mode-change pop.
   * Default true; when false energy is the raw step value (pre-M6). */
  enableEnergySmoothing?: boolean;
  /** M6: energy EMA time-constant (seconds). Small (~0.08) so it smooths mode
   * flips without flattening the idle breathing sine. Default 0.08. */
  energySmoothTau?: number;
  /** F7 (OPT, default off): on a wall hit, back up + reorient by ~pi instead of a
   * specular reflection (an avoidance reaction). */
  enableWallReorient?: boolean;
  /** F7: jitter (radians) added to the pi turn so successive reorients differ. */
  wallReorientJitter?: number;
  /** H2 (OPT, default off): add rotational Brownian motion to the heading. */
  enableRotationalBrownian?: boolean;
  /** H2: rotational diffusion coefficient D_r (rad^2/s). Heading RMS/step = sqrt(2*Dr*dt). */
  rotationalDiffusion?: number;
  /** H3 (OPT, default off): small declared downward sedimentation bias at rest. */
  enableSedimentation?: boolean;
  /** H3: sedimentation speed as a fraction (<0.15) of the swim speed. Default 0. */
  sedimentationFrac?: number;
  /** E1 (OPT): target arc-spacing (px) between hairs. When enablePerimeterCount
   * is on, the count tracks perimeter (n=round(2*pi*baseR/spacing)) capped by
   * ciliaCount. Default 8. */
  ciliaSpacingPx?: number;
  /** E1 (OPT, default off): drive cilia count from perimeter (size) not a fixed
   * number, so a bigger cell grows proportionally more hairs. */
  enablePerimeterCount?: boolean;
  /** F13 (OPT, default off): band-limit the membrane (low-mode, low-amp) for a
   * smoother ciliate look. */
  enableBandLimit?: boolean;
  /** F13: highest spatial mode (|n|) kept when band-limiting. Default 4. */
  bandLimitMode?: number;
  /** F13: max |deform| after band-limiting. Default 0.08. */
  bandLimitAmp?: number;
  /** F11 (OPT, default off): render a contractile vacuole that fills + collapses. */
  enableVacuole?: boolean;
  /** F11: vacuole systole period (seconds). Default 7. */
  vacuolePeriod?: number;
  /** F11: vacuole max radius as a fraction of baseR. Default 0.18. */
  vacuoleMaxFrac?: number;
  /** Commit 26 (OPT, default off): render the PLURAL pair of contractile
   * vacuoles (anterior + posterior), each on its own asynchronous clock. */
  enableVacuoles?: boolean;
  /** Commit 26: body-frame bearing (rad, relative to anterior=squeezePhi) of
   * the anterior contractile vacuole. Default 1.9. */
  vacuoleAnteriorBearing?: number;
  /** Commit 26: body-frame bearing of the posterior contractile vacuole
   * (opposite flank, rear). Default -1.9. */
  vacuolePosteriorBearing?: number;
  /** Commit 26: anterior CV cycle period (seconds). Default 9. */
  vacuoleAnteriorPeriod?: number;
  /** Commit 26: posterior CV cycle period (seconds). DIFFERENT from anterior
   * so the two pulse asynchronously. Default 13. */
  vacuolePosteriorPeriod?: number;
  /** Commit 26: R_max as a fraction of baseR for the pair. Default 0.16. */
  vacuolePairMaxFrac?: number;
  /** Commit 26: posterior phase offset (fraction of a cycle) so the two CVs
   * do not start together. Default 0.5. */
  vacuolePosteriorPhase?: number;
  /** Draw radial canals on contractile vacuoles (star shape). Default false. */
  enableCVCanals?: boolean;
  /** CV canal length multiplier relative to vesicle radius. Default 2.0. */
  canalLenMul?: number;
  /** CV canal line width in pixels. Default 0.5. */
  canalLineWidth?: number;
  /** CV canal alpha multiplier (applied to base nucleusAlpha×0.45). Default 0.3. */
  canalAlphaMul?: number;
  /** Commit 27 (OPT, default off): cytoplasmic streaming (cyclosis) — a field of
   * small granules circulates on a divergence-free closed loop inside the body.
   * Draw-only; when off nothing is seeded/advected/drawn. */
  enableCyclosis?: boolean;
  /** Commit 32b (OPT, default off): master gate for the body-coord interior
   * rewrite. When on, the granule field is seeded area-uniformly in
   * body-normalised (u, s) coords and drawn via `interiorPoint` (coupled to the
   * live wall) so it fills the whole slipper instead of a central disc.
   * ORTHOGONAL to enableCyclosis; when off the legacy disc path runs verbatim. */
  enableInteriorField?: boolean;
  /** Commit 27: number of granules that circulate. Default 14. */
  cyclosisGranuleCount?: number;
  /** Commit 27: seconds for a granule near mid-radius to complete the loop
   * (~30-60s). Default 45. */
  cyclosisPeriod?: number;
  /** Commit 32c: direction of cyclosis circulation (+1 or -1). Default +1. */
  cyclosisSense?: number;
  /** v3.7C: fractional boost to cyclosis speed at full activity (default 0 =
   * legacy, no modulation). At boost=0.4 and activity=1.0 the effective
   * period = cyclosisPeriod / 1.4 (~28% faster streaming). */
  cyclosisActivityBoost?: number;
  /** Commit 27: granules live within this fraction of baseR (inside the wall).
   * Default 0.75. */
  granuleMaxRadiusFrac?: number;
  /** Commit 27: draw radius (px) of a granule dot. Default 1.3. */
  granuleSizePx?: number;
  /** Commit 28 (OPT, default off): FOOD VACUOLES + MICRONUCLEUS — bigger digesting
   * spheres that ride the cyclosis loop plus a small micronucleus beside the
   * macronucleus. Draw-only; when off nothing is seeded/advected/drawn. */
  enableOrganelles?: boolean;
  /** Commit 28: number of food vacuoles (3-8). Default 5. */
  foodVacuoleCount?: number;
  /** Commit 28: seconds for a food vacuole to circulate (rides cyclosis).
   * Default 55. */
  foodVacuolePeriod?: number;
  /** Commit 28: food vacuoles circulate within this fraction of baseR (a bit
   * deeper than granules). Default 0.62. */
  foodVacuoleMaxRadiusFrac?: number;
  /** Commit 28: base draw radius (px) of a food vacuole (bigger than a granule).
   * Default 3.0. */
  foodVacuoleSizePx?: number;
  /** Commit 28: seconds over which a vacuole shrinks from full to small then
   * resets (digest cycle). Default 30. */
  foodVacuoleDigestPeriod?: number;
  /** v3.8D: food vacuole radius multiplier relative to base foodVacuoleSizePx.
   * Makes food vacuoles visually distinct from granules at overlay scale.
   * Default 1.0 = legacy (same size). */
  foodVacuoleSizeMul?: number;
  /** Max cyclosis loop amplitude for food vacuole centres. Large vacuoles should
   * stay in endoplasm, not ride exactly on the pellicle. Default 0.82. */
  foodVacuoleLoopMaxAmp?: number;
  /** v3.9E: saturation override for food vacuole fill/stroke.
   * Default 0.4 = legacy hardcoded value. Higher values (e.g. 0.25 from theme)
   * help food vacuoles stand out from grey granules. */
  foodVacuoleSat?: number;
  /** Commit v3.5F: macronucleus major/minor axis ratio. Default 1.8 (bean-shaped).
   * 1.0 = circle. Only applies when enableInteriorField is on. */
  nucleusAspect?: number;
  /** Commit v4.0D: kidney/bean-shaped macronucleus concavity depth as a fraction
   * of the minor radius. 0 = pure ellipse (legacy). 0.3 = visible indent on one
   * flank where the micronucleus nestles. Only applies when enableInteriorField
   * is on and nucleusAspect > 1. */
  nucleusIndent?: number;
  /** Commit 28: micronucleus radius as a fraction of the macronucleus radius.
   * Default 0.20. */
  micronucleusSizeFrac?: number;
  /** Commit 28: micronucleus centre offset from the macronucleus centre, in
   * units of macronucleus radius (just outside it). Default 1.15. */
  micronucleusOffsetFrac?: number;
  /** Commit 32e: body-normalised axial anchor of the macronucleus (u in [-1, 1],
   * +1 anterior). On the interior-field path the macronucleus is placed via
   * interiorPoint at (macronucleusU, macronucleusS) so it rides the elongated
   * deforming wall. Default -0.05 (central, slightly posterior). */
  macronucleusU?: number;
  /** Commit 32e: body-normalised transverse anchor of the macronucleus (s in
   * [-1, 1], fraction of the local half-width). Default 0.10 (slightly dorsal). */
  macronucleusS?: number;
  /** Commit 32e: body-normalised axial anchor of the anterior contractile
   * vacuole. Default 0.55. */
  cvAnteriorU?: number;
  /** Commit 32e: body-normalised transverse anchor of the anterior contractile
   * vacuole. Default 0.62. */
  cvAnteriorS?: number;
  /** Commit 32e: body-normalised axial anchor of the posterior contractile
   * vacuole. Default -0.55. */
  cvPosteriorU?: number;
  /** Commit 32e: body-normalised transverse anchor of the posterior contractile
   * vacuole. Default 0.62. */
  cvPosteriorS?: number;
  /** Draws the paramecium hero. Default true (undefined = true) so existing
   * themes and goldens are unchanged. Set false for themes where an aquarium
   * companion (e.g. euglena) is the sole organism. */
  enableHero?: boolean;
  /** Micro-aquarium companions master gate. Default false; Phase 0 API only,
   * with no renderer wiring/drawing until the A/B-approved aquarium phase. */
  enableAquarium?: boolean;
  /** Deterministic seed for future aquarium companion placement. */
  aquariumSeed?: number;
  /** Global companion layer alpha multiplier. */
  aquariumAlpha?: number;
  /** Activity-to-motion boost for future companions. */
  aquariumActivityBoost?: number;
  /** Number of diatom companions. Default 0 = none. */
  diatomCount?: number;
  /** Diatom alpha multiplier. */
  diatomAlpha?: number;
  /** Diatom drift speed scalar. */
  diatomDriftSpeed?: number;
  /** Number of euglena companions. Default 0 = none. */
  euglenaCount?: number;
  /** Euglena idle swim speed scalar. */
  euglenaSpeed?: number;
  /** Euglena active swim speed scalar. */
  euglenaSpeedActive?: number;
  /** Euglena size scalar. */
  euglenaScale?: number;
  /** Euglena palette offset from baseHue in degrees. Default 42 = chlorophyll green. */
  euglenaHueOffset?: number;
  /** Euglena negative-gravitaxis up-bias weight (0 = off). */
  euglenaGravitaxis?: number;
  /** Euglena phototaxis weight toward the virtual light (0 = off). */
  euglenaPhototaxis?: number;
  /** Euglena same-species soft separation weight (0 = off). */
  euglenaSeparation?: number;
  /** Euglena cosmetic rotational jitter, rad/sqrt(s) (0 = off). */
  euglenaRotDiffusion?: number;
  /** Number of vorticella companions. Default 0 = none. */
  vorticellaCount?: number;
  /** Horizontal floor placement of a single vorticella (0=left..1=right). Default 0.5. */
  vorticellaAlongFrac?: number;
  /** Vorticella contraction cadence scalar (metabolic; not audio-coupled). */
  vorticellaContractRate?: number;
  /** Vorticella size scalar. */
  vorticellaScale?: number;
  /** Number of didinium (predator ciliate) companions. Default 0 = none. */
  didiniumCount?: number;
  /** Didinium idle swim speed (body-lengths/sec). Default 1.0. */
  didiniumSpeed?: number;
  /** Didinium active swim speed (body-lengths/sec). Default 2.0. */
  didiniumSpeedActive?: number;
  /** Didinium size scalar. Default 1.0. */
  didiniumScale?: number;
  /** Didinium palette offset from its cool darkfield base hue (degrees). Default 0. */
  didiniumHueOffset?: number;
  /** H4 (OPT, default off): advect ambient motes by the body's dipolar wake so a
   * swimming cell visibly drags the surrounding fluid. */
  enableFlowField?: boolean;
  /** H4: number of ambient tracer motes. Default 0 (none drawn). */
  flowMoteCount?: number;
  /** H4: dipole strength multiplier. Folds in the body-size^2 length scale of a
   * physical doublet (u = U*a^2/r^2), so the render wiring can pass the raw swim
   * speed (px/s) as `strength` and get a px/s field at body-scale distances.
   * Default 300 (~a^2 for baseR~17). */
  flowStrength?: number;
  /** Commit 21c (OPT, default off): anchor each cilium base on the DEFORMED +
   * affine-squeezed membrane contour (via motion.contour) instead of the bare
   * circle, and grow the shaft along the true contour outward normal. OFF keeps
   * the crown byte-identical to the commit-21b frozen golden. */
  enableCiliaOnContour?: boolean;
  /** Commit 22a (OPT, default off): "somatic mex" — when on, the crown becomes
   * MANY SHORT hairs (a dense fringe over the whole perimeter) instead of the
   * few long flagella, by overriding ciliaCount -> somaticCiliaCount and
   * ciliaLength -> somaticCiliaLength (see somaticCiliaParams). OFF keeps the
   * legacy 18-hair crown byte-identical. */
  enableSomaticCilia?: boolean;
  /** Commit 22a: hair count when enableSomaticCilia is on. Default 72. */
  somaticCiliaCount?: number;
  /** Commit 22a: resting hair length (fraction of baseR) when enableSomaticCilia
   * is on. Default 0.15 (short stubs). */
  somaticCiliaLength?: number;
  /** Commit 23 (OPT, default off): CILIATURE STRUCTURE. A real Paramecium's
   * somatic mex is NOT uniform: a ventral oral-groove region where the cilia
   * THIN OUT (a density dip, not a bald gap), and a slightly LONGER caudal tuft
   * at the posterior pole. When on, ciliaStructureMod applies both as body-frame
   * localised modifiers to the ciliaPath hair loop. OFF keeps the mex/crown
   * byte-identical to commit 22. */
  enableCiliaStructure?: boolean;
  /** Commit 23: body-frame angle (rad) of the oral-groove centre, one ventral
   * flank, anterior-of-mid (relative to anterior = strokeAxis). Default 1.2. */
  oralGapCenter?: number;
  /** Commit 23: half-window (rad) of the oral region; hairs within
   * |psi - oralGapCenter| < this are in the oral region. Default 0.75. */
  oralGapWidth?: number;
  /** Commit 23: fraction of hairs to thin out at the oral-groove centre
   * (0.3 = 30% density dip, NOT a bald gap). Default 0.3. */
  oralGapDip?: number;
  /** Commit 23: half-window (rad) around the posterior pole (psi = ±π) for the
   * caudal tuft. Default 0.6. */
  caudalTuftWidth?: number;
  /** Commit 23: length multiplier for caudal-tuft hairs at the posterior pole
   * (1.7 = 1.7x longer). Default 1.7. */
  caudalTuftLength?: number;
  /** Commit 29 (OPT, default off): SMOOTH RIGID membrane. A real Paramecium is a
   * rigid smooth spindle, not a wobbling amoeboid blob. When on,
   * buildTargetDeformation suppresses the per-vertex deform to a flat 0 (no FBM
   * wobble, no pseudopods, no audio-bin deformation, no idle morph), so the
   * pre-affine body is a perfect circle that the downstream affine squeeze turns
   * into a smooth firm spindle. OFF keeps the deform[] byte-identical to today
   * (frozen GATES_OFF golden). */
  enableRigidMembrane?: boolean;
  /** Commit 31a (OPT, default off): authentic asymmetric "slipper" body profile.
   * A real Paramecium is NOT a symmetric ellipse but an asymmetric slipper —
   * rounded blunt WIDER anterior, tapered narrower posterior. These params drive
   * the pure body-profile helpers (bodyHalfWidth / bodyProfilePoint / ...). DARK:
   * no caller in the render loop yet (buildTargetDeformation is untouched). */
  enableBodyProfile?: boolean;
  /** Commit 31a: which profile formula. Default "taperedEllipse". */
  bodyProfileType?: "taperedEllipse" | "egg" | "piriform";
  /** Commit 31a: fore-aft taper coefficient c (>=0). Anterior (u=+1) wider.
   * Default 0.3. For "egg" treated as d/a in [0,1). */
  bodyProfileTaper?: number;
  /** Commit 31a: length:width aspect of the body. Default 3 (~3:1). */
  bodyAspect?: number;
  /** Commit 31a: optional small ventral oral-groove bend. Default 0 (no-op). */
  bodyVentralBend?: number;
  /** v3.7B (OPT, default off): ORAL GROOVE CONTOUR INDENT. Adds a visible
   * concavity on the ventral side at the oral-groove region. The oral groove
   * (vestibulum/peristome) is Paramecium's defining external feature — a
   * concavity running from anterior to mid-body. When off, deform[] is
   * untouched (golden frozen). */
  enableOralGroove?: boolean;
  /** v3.7B: depth of the oral groove as a fraction of baseR (inward).
   * Default 0.04 (4%). */
  oralGrooveDepth?: number;
  /** v3.7B: centre of the groove in body-frame angle (rad, 0 = anterior,
   * positive = ventral). Default 1.2 (matches oralGapCenter for cilia). */
  oralGrooveAngle?: number;
  /** v3.7B: angular half-width of the groove in radians. Default 0.6. */
  oralGrooveWidth?: number;

  /** v3.7D (OPT, default off): ECTOPLASM BOUNDARY. Draws a thin inner contour
   * representing the cortex/endoplasm boundary visible in DIC micrographs as a
   * clear rim between the membrane and the granular interior. When off, no
   * extra stroke is drawn (golden frozen). */
  enableEctoplasm?: boolean;
  /** v3.7D: inner contour radius as fraction of membrane radius.
   * Default 0.85 (ectoplasm ~15% of cell radius). */
  ectoplasmFrac?: number;
  /** v3.7D: stroke alpha for the ectoplasm boundary line.
   * Default 0.15. */
  ectoplasmAlpha?: number;

  /** v3.9D (OPT, default off): METACHRONAL LENGTH WAVE. When on, a visible
   * traveling wave modulates cilia LENGTH along the contour — crests are at
   * full length, troughs at ~60%. Creates the shimmering ripple that is the
   * single most recognizable visual signature of Paramecium under DIC.
   * Independent of the existing `ciliaMetachronal` beat-PHASE lag. When off,
   * the length multiplier is 1.0 everywhere (golden frozen). */
  enableMetachronal?: boolean;
  /** v3.9D: wavelength of the length wave as a number of cilia. One full
   * cosine cycle spans this many adjacent hairs. Default 20. */
  metachronalWavelength?: number;
  /** v3.9D: wave propagation speed in radians per second. Positive → wave
   * travels in the direction of increasing contour index. Default 4.0. */
  metachronalSpeed?: number;
  /** v4.0C: modulation depth of the metachronal length wave. 0 = no
   * modulation (all multipliers 1.0), 0.4 = legacy range [0.6, 1.0],
   * 0.6 = deeper range [0.4, 1.0]. Default 0.4. */
  metachronalDepth?: number;
  /** v3.8E (OPT, default off): TRICHOCYST DISCHARGE. Paramecium's most
   * dramatic defense — explosive radial crystalline needles projecting from
   * the pellicle on startle. When off, no trichocyst drawing occurs (golden
   * frozen). */
  enableTrichocysts?: boolean;
  /** v3.8E: number of radial needles on discharge. Default 30. */
  trichocystCount?: number;
  /** v3.8E: needle length as a multiple of average cilia length (baseR *
   * ciliaLength). Default 3.0. */
  trichocystLengthMul?: number;
  /** v3.8E: alpha decay rate per second — controls how quickly the needles
   * fade after a startle fires. Default 2.0 (~500ms visible). */
  trichocystDecay?: number;
  /** v3.9B: trichocyst needle stroke width in CSS px. Default 1.0. */
  trichocystLineWidth?: number;
}

export interface CellOptions {
  width: number;
  height: number;
  params?: Partial<CellParams>;
  /** Warm amber base hue in degrees. */
  baseHue?: number;
}
