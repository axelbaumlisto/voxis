import type { CellParams } from "./types";

/** Sensible defaults — lively amber cell with visible pseudopods + iridescence. */
export const CELL_DEFAULTS: CellParams = {
  noiseScale: 0.9,
  octaves: 4,
  lacunarity: 2.3,
  gain: 0.55,
  timeScale: 0.3,
  membraneAmplitude: 0.35,
  energyDrive: 0.8,
  push: 3.0,
  sharpness: 4,
  intentDrift: 0.08,
  idle: 0.10,
  levelGain: 0.7,
  hueSpread: 40,
  shimmerSpeed: 0.5,
  hueBoost: 20,
  fillAlpha: 0.18,
  tension: 0.15,
  radiusFraction: 0.34,
  attack: 0.20,
  release: 0.005,
  nucleusRadius: 0.28,
  nucleusPulse: 0.10,
  nucleusWander: 0.14,
  nucleusDrift: 0.12,
  nucleusAlpha: 0.55,
  ciliaCount: 18,
  ciliaLength: 0.45,
  ciliaGrowthBoost: 0.6,
  ciliaWave: 0.5,
  ciliaWaveSpeed: 1.6,
  ciliaCurl: 0.7,
  ciliaBeatHz: 0.9,
  ciliaBeatHzActive: 1.6,
  // Biology (D3): real power:recovery time ratio ~9ms:26ms = 1:2.9. We bump the
  // asymmetry from 0.6 toward that target; under the F3 sine-warp clock
  // (g(u)=1+a*sin(2pi*u)) a=0.49 yields recovery:power ~1.7:1 (more recovery
  // than power, correct direction; asymmetry is an artistic-but-motivated param,
  // SCOPE 4). A literal 2.9:1 would need a different clock model (future D3).
  ciliaAsymmetry: 0.49,
  // Metachronal wavelength lambda ~ 5-7 cilia: lag=2pi/lambda ~ 1.1 rad.
  ciliaMetachronal: 1.1,
  dragCoeff: 0.5,
  ciliaSegments: 6,
  ciliaLengthVar: 0.5,
  ciliaAngleJitter: 0.55,
  ciliaWidth: 1.6,
  growthAttack: 0.05,
  growthRelease: 0.012,
  growthSwell: 0.22,
  startleSensitivity: 2.2,
  startleDecay: 0.86,
  startleMaxPx: 5,
  startleBaselineRate: 0.08,
  enableStartleKick: true,
  startleKickThreshold: 0.12,
  startleKickMax: 1.2,
  startleBurstFrac: 0.5,
  idleMorphAmplitude: 0.18,
  idleMorphSpeed: 0.25,
  idleMorphPeriod: 7,
  idleMorphFloor: 0.25,
  driftActivationRate: 0.02,
  wanderTurnRate: 1.1,
  wanderFreq: 0.6,
  swimSpeedMaxFrac: 0.06,
  activityEnergyWeight: 0.6,
  activityGrowthWeight: 0.4,
  bodyHeadingTau: 0.4,
  bodyElongation: 0.13,
  bodyElongationFloor: 0,
  enableRestingProlate: false,
  prolateRestAspect: 1.7,
  enableAxialSpin: false,
  axialSpinMax: 3.5,
  enableStrokeAxis: true,
  strokeAxisKnee: 0.5,
  strokeAxisAlign: 1,
  enableEnergySmoothing: true,
  energySmoothTau: 0.08,
  // Pipeline gates. B1 (commit 6) flips enableSaturation ON; C1 (commit 7) flips
  // enableAreaNorm ON (area held at pi*baseR^2). G (commit 8a) flips
  // enableActivity ON. D4 (commit 8b) flips enableAffine ON (body prolate along
  // travel; round at rest since bodyElongationFloor=0).
  enableSaturation: true,
  deformMax: 0.6,
  enableAreaNorm: true,
  enableAffine: true,
  enableActivity: true,
  // Micro-aquarium companions: OFF by default (Phase 0 API/defaults only; no
  // renderer wiring/drawing yet). Counts stay 0 so the accepted Paramecium look
  // remains unchanged until A/B approval.
  enableAquarium: false,
  aquariumSeed: 1,
  aquariumAlpha: 0.35,
  aquariumActivityBoost: 0.4,
  diatomCount: 0,
  diatomAlpha: 0.35,
  diatomDriftSpeed: 1.0,
  euglenaCount: 0,
  euglenaSpeed: 1.0,
  euglenaSpeedActive: 2.0,
  euglenaScale: 1.0,
  euglenaFlagellumRateScale: 1.0,
  euglenaHueOffset: 42,
  euglenaGravitaxis: 0,
  euglenaPhototaxis: 0,
  euglenaPhotoIntent: 0,
  euglenaSeparation: 0,
  euglenaRotDiffusion: 0,
  vorticellaCount: 0,
  vorticellaContractRate: 1.0,
  vorticellaScale: 1.0,
  vorticellaAlongFrac: 0.5,
  didiniumCount: 0,
  didiniumSpeed: 1.0,
  didiniumSpeedActive: 2.0,
  didiniumScale: 1.0,
  didiniumHueOffset: 0,
  // H4 ambient flow field: OFF by default (dark-launch). flowStrength folds the
  // body-size^2 doublet length scale so the render path passes raw swim speed.
  enableFlowField: false,
  flowMoteCount: 0,
  flowStrength: 300,
  // Commit 21c: cilia anchored on the deformed+squeezed contour. OFF (dark-launch)
  // so the default crown stays byte-identical to the commit-21b frozen golden.
  enableCiliaOnContour: false,
  // Commit 22a: somatic mex (many short hairs). OFF (dark-launch) so the default
  // crown stays the legacy 18 long flagella; somaticCiliaParams swaps the count
  // and length only when the gate is on.
  enableSomaticCilia: false,
  somaticCiliaCount: 72,
  somaticCiliaLength: 0.15,
  // Commit 23: ciliature structure (oral-groove dip + caudal tuft). OFF
  // (dark-launch) so the default mex/crown stays byte-identical to commit 22.
  enableCiliaStructure: false,
  oralGapCenter: 1.2,
  oralGapWidth: 0.75,
  oralGapDip: 0.3,
  caudalTuftWidth: 0.6,
  caudalTuftLength: 1.7,
  // Commit 29: smooth rigid membrane. OFF (dark-launch) so the default deform[]
  // stays byte-identical to the frozen GATES_OFF golden. When on, every vertex
  // deform is a flat 0 -> perfect circle pre-affine -> smooth firm spindle.
  enableRigidMembrane: false,
  // Commit 31a: authentic asymmetric slipper body profile. OFF (dark-launch);
  // helpers are pure math with no render-loop caller yet.
  enableBodyProfile: false,
  bodyProfileType: "egg",
  bodyProfileTaper: 0.27,
  bodyAspect: 3,
  bodyVentralBend: 0,
  // v3.7B: oral groove contour indent. OFF (dark-launch) so deform[] stays
  // byte-identical to the frozen golden.
  enableOralGroove: false,
  oralGrooveDepth: 0.04,
  oralGrooveAngle: 1.2,
  oralGrooveWidth: 0.6,
  // v3.7D: ectoplasm boundary. OFF (dark-launch) so no extra stroke
  // is drawn -> all goldens stay byte-identical.
  enableEctoplasm: false,
  ectoplasmFrac: 0.85,
  ectoplasmAlpha: 0.15,
  // v3.8E: trichocyst discharge on startle. OFF (dark-launch) so no radial
  // needles are drawn -> all goldens stay byte-identical.
  enableTrichocysts: false,
  trichocystCount: 30,
  trichocystLengthMul: 3.0,
  trichocystDecay: 1.0,
  trichocystLineWidth: 1.5,
  // Commit 26: PLURAL pair of asynchronous contractile vacuoles. OFF
  // (dark-launch) so contractileVacuolePair returns [] and the gated draw
  // block is skipped -> all goldens stay byte-identical.
  enableVacuoles: false,
  vacuoleAnteriorBearing: 1.9,
  vacuolePosteriorBearing: -1.9,
  vacuoleAnteriorPeriod: 9,
  vacuolePosteriorPeriod: 13,
  vacuolePairMaxFrac: 0.16,
  vacuolePosteriorPhase: 0.5,
  // Commit 27: cytoplasmic streaming (cyclosis) granules. OFF (dark-launch) so
  // seedGranules returns [] / the gated draw block is skipped -> all goldens
  // stay byte-identical.
  enableCyclosis: false,
  // Commit 32b: body-coord interior rewrite. OFF (dark-launch) so the legacy
  // disc granule path runs verbatim -> all goldens stay byte-identical.
  enableInteriorField: false,
  cyclosisGranuleCount: 14,
  cyclosisPeriod: 45,
  cyclosisSense: 1,
  granuleMaxRadiusFrac: 0.75,
  granuleSizePx: 1.3,
  // Commit 28: food vacuoles + micronucleus. OFF (dark-launch) so
  // seedFoodVacuoles returns [] / the gated draw blocks are skipped -> all
  // goldens stay byte-identical.
  enableOrganelles: false,
  foodVacuoleCount: 5,
  foodVacuolePeriod: 55,
  foodVacuoleMaxRadiusFrac: 0.62,
  foodVacuoleSizePx: 3.0,
  foodVacuoleDigestPeriod: 30,
  foodVacuoleSizeMul: 1.0,
  micronucleusSizeFrac: 0.20,
  micronucleusOffsetFrac: 1.15,
  // Commit 32e: body-normalised (u, s) anchors for the macronucleus + the two
  // contractile vacuoles. Used ONLY on the interior-field path so the organelles
  // ride the elongated deforming wall via interiorPoint; the legacy path ignores
  // them, so all goldens stay byte-identical.
  macronucleusU: -0.05,
  macronucleusS: 0.10,
  cvAnteriorU: 0.55,
  cvAnteriorS: 0.62,
  cvPosteriorU: -0.55,
  cvPosteriorS: 0.62,
};
