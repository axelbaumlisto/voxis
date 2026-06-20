// src/theme-engine/renderers/cell.ts
/**
 * Living Cell renderer — organic membrane visualization with FBM noise,
 * amoeboid pseudopod protrusions, and iridescent hue shimmer.
 *
 * SRP: All math lives in pure exported functions (deterministic, testable).
 *      The renderer factory only handles DOM/canvas/RAF lifecycle.
 * KISS: Compact inline value-noise (no external imports) so the bundled
 *       theme.js is fully self-contained.
 * OCP: Tunables live in CellParams with defaults; callers override via spread.
 */

import type { ThemeState } from "../contract";
import type { Renderer } from "./types";
import {
  noise2D, fbm, catmullRom, catmullRomOpen, integrateDeformation, hsla, TAU, growthLevel,
  lerp, smoothstep, wrapPi, deformAt, deformDerivAt,
} from "./shared";

// Backward-compat re-exports: existing imports of these from "./cell" keep working.
export { noise2D, fbm, catmullRom, catmullRomOpen, lowpassRadii, integrateDeformation, TAU, smoothstep } from "./shared";



// ---------------------------------------------------------------------------
// Cell parameters
// ---------------------------------------------------------------------------

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
  /** D4: prolate elongation gain. Aspect k = 1 + bodyElongation*max(floor,speedNorm).
   * ~0.12-0.15 is a mild, biological ciliate prolate. Default 0.13. */
  bodyElongation?: number;
  /** D4: minimum elongation fraction even at rest (0 = round at rest, so D4
   * collapses to identity when still). Default 0. */
  bodyElongationFloor?: number;
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
}

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
};


// ---------------------------------------------------------------------------
// M15: NaN-poison guards
// ---------------------------------------------------------------------------
// External frame state (audioLevel, spectrum bins) and persistent form-memory
// (integrated deform, growth, baseline) are all sanitised at the tick boundary.
// A single NaN/Inf frame must NOT permanently poison form-memory: once a value
// becomes non-finite, every subsequent EMA/integration step would stay NaN
// forever (NaN propagates through +,*, and Math.min/max). These pure helpers
// keep the state finite and identical for normal in-range input.

/** Clamp to [0,1]; NaN/Inf -> 0. Identity for finite in-range input. */
export function sanitizeUnit(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Pass finite values through unchanged; non-finite -> `fallback`. */
export function sanitizeFinite(x: number, fallback: number): number {
  return Number.isFinite(x) ? x : fallback;
}

/** Clamp each bin to [0,1]; bad/missing bins -> 0. Returns a new array. */
export function sanitizeBins(bins: number[] | undefined | null): number[] {
  if (!bins || bins.length === 0) return [];
  const out = new Array<number>(bins.length);
  for (let i = 0; i < bins.length; i++) out[i] = sanitizeUnit(bins[i]);
  return out;
}


// ---------------------------------------------------------------------------
// Cell geometry functions
// ---------------------------------------------------------------------------

/**
 * Energy level blending idle breathing with audio-driven activity.
 *
 * During idle: oscillates gently around `idle` using sin(t).
 * During recording: idle + audioLevel * levelGain.
 * During transcribing: faded idle + residual level.
 * During error: idle only.
 */
export function cellEnergy(
  mode: string,
  audioLevel: number,
  t: number,
  idle: number,
  levelGain: number,
): number {
  switch (mode) {
    case "idle":
      return idle * (1.0 + Math.sin(t * 0.8) * 0.25);
    case "recording":
      return Math.max(0, Math.min(1, idle + audioLevel * levelGain));
    case "transcribing":
      return Math.max(0, Math.min(1, idle * 0.72 + audioLevel * 0.12));
    case "error":
      return idle;
    default:
      return idle;
  }
}

/**
 * M6 — EMA-chase the (step-valued) energy target to kill the mode-change POP.
 * `cellEnergy` returns a different formula per mode, so at a mode flip (idle ->
 * recording -> transcribing -> idle) the raw energy jumps in one frame. We chase
 * it with a fast exponential `e += (target - e)*(1 - exp(-dt/tau))`, so the
 * change is C0 across the flip while staying responsive. tau is deliberately
 * SMALL (~0.08s) so the idle breathing sine (0.8 rad/s) passes through with <1%
 * attenuation — this smooths discontinuities, not the intended slow motion.
 * Gated by `enableEnergySmoothing` (default on); off => returns target verbatim
 * (byte-identical to pre-M6). Pure & frame-rate independent.
 */
export function smoothEnergy(
  prev: number,
  target: number,
  dt: number,
  params: CellParams,
): number {
  if (params.enableEnergySmoothing === false) return target;
  const tau = params.energySmoothTau ?? 0.08;
  if (tau <= 0) return target;
  const alpha = 1 - Math.exp(-Math.max(0, dt) / tau);
  return prev + (target - prev) * alpha;
}

/**
 * G1 — master ACTIVITY scalar `a ∈ [0,1]`. ONE coherent drive so that
 * audio → ciliary beat → swimming all share a single envelope. As of 8a it
 * drives the swim speed + beat frequency + curl; pseudopod/nucleus amplitude
 * are moved onto `a` in a later sub-commit (8c), after which raw `audioLevel`
 * is used for COLOR (iridescentHue) only. Weighted blend of instantaneous energy
 * (fast) and the smoothed growth accumulator (slow, asymmetric attack/release)
 * so the cell ramps up promptly but winds down gracefully. (plan G1.)
 *
 * Pure & deterministic.
 */
export function cellActivity(
  energy: number,
  growth: number,
  params?: Pick<CellParams, "activityEnergyWeight" | "activityGrowthWeight">,
): number {
  const we = params?.activityEnergyWeight ?? 0.6;
  const wg = params?.activityGrowthWeight ?? 0.4;
  const a = we * energy + wg * growth;
  return a < 0 ? 0 : a > 1 ? 1 : a;
}

/**
 * G2 — propulsion speed law. Low-Reynolds swimming is Stokes-linear: the swim
 * speed is proportional to the ciliary beat, which we drive by activity `a`
 * (U_norm = a). There is NO inertia — silence (a→0) means the cell stops in the
 * SAME frame (memoryless; no coasting). Returns px/sec. (plan G2; low-Re:
 * research-fluid-medium-motion.md, research-ciliate-propulsion-coupling.md.)
 */
export function swimSpeed(
  activity: number,
  width: number,
  height: number,
  params: CellParams,
): number {
  const a = activity < 0 ? 0 : activity > 1 ? 1 : activity;
  const frac = params.swimSpeedMaxFrac ?? 0.06;
  return a * frac * Math.min(width, height);
}

/**
 * G2 — effective ciliary beat frequency: ramps from the resting `ciliaBeatHz`
 * (f0) to `ciliaBeatHzActive` (f1) linearly with activity. A louder voice beats
 * faster, which (Stokes-linear) drives a faster swim — so sign(dU/da) ==
 * sign(dBeatHz/da). Pure.
 */
export function ciliaBeatHzEff(activity: number, params: CellParams): number {
  const a = activity < 0 ? 0 : activity > 1 ? 1 : activity;
  const f0 = params.ciliaBeatHz ?? 0.9;
  const f1 = params.ciliaBeatHzActive ?? 1.6;
  return f0 + (f1 - f0) * a;
}

/**
 * G4 — smoothed body heading. EMA-chase the instantaneous velocity heading so
 * the body's long axis turns gracefully (Lipschitz: per-step rotation is bounded
 * by the shortest-arc error times the EMA factor). When the cell is essentially
 * still the heading is HELD (a stopped low-Re swimmer has no defined travel
 * direction, so we keep the last one rather than snapping). Pure; frame-rate
 * independent via `1 - exp(-dt/tau)`. (plan G4.)
 */
export function bodyHeadingStep(
  prev: number,
  vx: number,
  vy: number,
  dt: number,
  params: CellParams,
): number {
  const sp = Math.hypot(vx, vy);
  if (sp < 1e-6) return prev; // hold heading when still
  const target = Math.atan2(vy, vx);
  const tau = params.bodyHeadingTau ?? 0.4;
  const alpha = 1 - Math.exp(-dt / Math.max(1e-6, tau));
  // Rotate prev toward target along the SHORTEST arc (wrap to [-pi, pi]).
  let d = target - prev;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return prev + d * alpha;
}

/**
 * D4 — body prolate aspect ratio `k` for the area-preserving affine squeeze.
 * A swimming ciliate is a mild prolate spheroid aligned to travel. `k` rises
 * with normalized speed: `k = 1 + elong * max(floor, speedNorm)`. With the
 * default floor=0 the body is ROUND at rest (speedNorm=0 -> k=1, so D4 collapses
 * to identity and the resting shape is unchanged) and elongates only while
 * swimming. (A nonzero floor yields a permanently-prolate "rigid pellicle" look.)
 * Pure. (plan D4; SCOPE 2.)
 */
export function prolateAspect(speedNorm: number, params: CellParams): number {
  const s = speedNorm < 0 ? 0 : speedNorm > 1 ? 1 : speedNorm;
  const elong = params.bodyElongation ?? 0.13;
  const floor = params.bodyElongationFloor ?? 0;
  return 1 + elong * Math.max(floor, s);
}

/**
 * Compute the cell membrane radius at a given angle.
 *
 * @param angle  Angle in radians (any value; it's periodic).
 * @param t      Continuous time in seconds.
 * @param energy Energy level (0..1), from cellEnergy().
 * @param params Active cell parameters.
 * @returns Radius in canvas-space pixels (non-negative).
 */
export function cellRadius(
  angle: number,
  t: number,
  energy: number,
  params: CellParams,
): number {
  // Sample FBM along a circle direction, drifted by time
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const noiseVal = fbm(
    dx * params.noiseScale + t * params.timeScale * 0.3,
    dy * params.noiseScale + t * params.timeScale * 0.2,
    params.octaves,
    params.lacunarity,
    params.gain,
  );

  // Amplitude blends idle floor with energy-driven deformation.
  // idle ~5% wobble alone; recording ~25-40% (with membraneAmplitude ≈ 0.28).
  const amp = params.idle + energy * params.energyDrive;
  return 1.0 + noiseVal * params.membraneAmplitude * amp;
}

/**
 * Pseudopod protrusion offset at a given angle.
 *
 * Creates one or more amoeboid protrusions that drift slowly via noise.
 * The intent direction θ(t) moves continuously; the offset at a given
 * angle is a bell-shaped lobe peaking near θ.
 *
 * @returns Protrusion amount in canvas-space pixels (≥0).
 */
export function pseudopodOffset(
  angle: number,
  t: number,
  audioLevel: number,
  energy: number,
  params: CellParams,
): number {
  let total = 0;

  // Two intent directions for multi-lobe appearance
  const numLobes = 2;
  for (let i = 0; i < numLobes; i++) {
    const seed = (i + 1) * 1000;
    // Drifting intent direction
    const theta = TAU * noise2D(seed, t * params.intentDrift);
    // Angular distance from this lobe center
    let delta = angle - theta;
    // Wrap to [-π, π]
    delta = ((delta + Math.PI) % TAU + TAU) % TAU - Math.PI;
    // Bell-shaped lobe: cos(delta)^sharpness, clamped to positive. The exponent
    // is clamped to >=2 so the lobe is C1 at its edge (cos(delta)^1 has a
    // non-zero one-sided slope where the max(0,...) clips it, which would put a
    // kink in the contour); >=2 guarantees a smooth, differentiable shoulder.
    const sharp = Math.max(2, params.sharpness);
    const lobe = Math.pow(Math.max(0, Math.cos(delta)), sharp);
    // Amplitude grows with audio level and energy; idle gives tiny twitches
    const audioDrive = params.idle + audioLevel * params.levelGain;
    const amp = params.push * audioDrive * energy;
    total += lobe * amp;
  }

  return total;
}

export interface Cilium {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Quadratic Bezier control point — bent sideways off the base->tip chord
   * so the cilium bows like a living flagellum instead of a rigid spike. */
  cpx: number;
  cpy: number;
}

/**
 * Hair-like cilia around the membrane. Each cilium base sits on the cell
 * radius at its angle; the tip extends outward by (ciliaLength + growth*
 * ciliaGrowthBoost)*baseR and sways laterally via a per-cilium noise wave.
 * Energy makes them a touch longer/livelier. Pure & deterministic given t.
 *
 * @param cx,cy   Cell center (already including any startle offset).
 * @param baseR   Base cell radius in pixels.
 * @param t       Continuous time (seconds).
 * @param energy  Cell energy [0,1].
 * @param growth  Growth level [0,1].
 */
export function ciliaEndpoints(
  cx: number,
  cy: number,
  baseR: number,
  t: number,
  energy: number,
  growth: number,
  params: CellParams,
): Cilium[] {
  const out: Cilium[] = [];
  const n = Math.max(1, params.ciliaCount);
  const lenPx = baseR * (params.ciliaLength + growth * params.ciliaGrowthBoost) * (0.7 + energy * 0.6);
  for (let k = 0; k < n; k++) {
    const baseAngle = (k / n) * TAU;
    // per-cilium lateral sway via noise (each hair waves slightly differently)
    const sway = noise2D(k * 5.3, t * params.ciliaWaveSpeed) * params.ciliaWave;
    const tipAngle = baseAngle + sway;
    const x1 = cx + baseR * Math.cos(baseAngle);
    const y1 = cy + baseR * Math.sin(baseAngle);
    const x2 = cx + (baseR + lenPx) * Math.cos(tipAngle);
    const y2 = cy + (baseR + lenPx) * Math.sin(tipAngle);

    // Bow the hair sideways: place a quadratic Bezier control point at the
    // chord midpoint, displaced PERPENDICULAR to the base->tip direction by
    // a noise-driven amount that differs per hair (k) and drifts over time.
    // This makes each cilium curve organically and chaotically rather than
    // standing as a straight needle.
    const dx = x2 - x1;
    const dy = y2 - y1;
    const segLen = Math.hypot(dx, dy) || 1;
    // unit perpendicular to the chord
    const px = -dy / segLen;
    const py = dx / segLen;
    // bend amount: each hair always bows to one side (deterministic sign per
    // hair, so no cilium is ever a straight needle), modulated by drifting
    // noise for a living, chaotic wobble. Scaled by hair length so longer
    // hairs bow more (∝ flagellar flexibility).
    const bias = ((k * 2654435761) % 2 === 0 ? 1 : -1); // stable per-hair side
    const wobble = noise2D(k * 9.7 + 0.5, t * params.ciliaWaveSpeed * 0.6 + k * 1.7); // [-1,1]
    // base bow (always present) + noise wobble; keep within ~[0.4,1.4]*curl
    const bendMag = (0.7 + 0.5 * wobble) * params.ciliaCurl;
    const bend = bias * bendMag * lenPx;
    const midx = (x1 + x2) / 2;
    const midy = (y1 + y2) / 2;
    const cpx = midx + px * bend;
    const cpy = midy + py * bend;
    out.push({ x1, y1, x2, y2, cpx, cpy });
  }
  return out;
}

/**
 * Asymmetric two-phase ciliary beat clock.
 *
 * Real motile cilia spend LESS time in the fast power stroke and MORE in the
 * slow recovery stroke (Gompper/Elgeti et al.). We model the beat as a phase
 * in [0,1) that advances NON-uniformly in time: fast through the power band,
 * slow through recovery. `ciliaAsymmetry` in [0,1) controls the skew
 * (0 = symmetric). `index` applies a metachronal phase lag so neighbouring
 * cilia are offset, producing a wave that travels around the crown.
 *
 * Pure & deterministic.
 */
export function ciliaBeatPhase(
  t: number,
  index: number,
  params: CellParams,
): number {
  const hz = params.ciliaBeatHz ?? 0.9;
  const lag = (params.ciliaMetachronal ?? 0) * index;
  // Linear phase advance + metachronal offset, wrapped to [0,1).
  const lin = (t * hz + lag / TAU) % 1;
  const u = ((lin % 1) + 1) % 1; // guard negatives
  const a = Math.max(0, Math.min(0.95, params.ciliaAsymmetry ?? 0));
  if (a === 0) return u;
  // F3 (C1 beat clock): warp the uniform clock u -> phase with a SMOOTH,
  // PERIODIC velocity profile instead of a piecewise-linear ramp. We want the
  // power stroke (early phase) to pass quickly and the recovery (late phase) to
  // dwell. Define a positive periodic phase velocity
  //     dphase/du = g(u) = 1 + A*sin(2*pi*u),   A = a (< 1 keeps g > 0)
  // which is fastest near u=0.25 (power) and slowest near u=0.75 (recovery).
  // Integrating from 0 (so phase(0)=0, phase(1)=1) gives a closed form:
  //     phase(u) = u + (A / 2pi) * (1 - cos(2*pi*u)).
  // g is C-infinity AND periodic, so dphase/du is continuous across the period
  // wrap u: 1->0 (the old piecewise map had a slope jump there). The map is
  // monotone for A<1 and reduces to the identity at A=0 (symmetric beat).
  const A = a; // a is already clamped to [0, 0.95]
  const phase = u + (A / TAU) * (1 - Math.cos(TAU * u));
  return ((phase % 1) + 1) % 1; // keep in [0,1) against FP drift
}

/**
 * D2 motion basis for cilia drag-lean. When the cell swims, viscous drag bends
 * the whole crown REARWARD (opposite the travel tangent), more on the leading
 * face than the trailing one. (plan D2.)
 */
export interface CiliaMotion {
  /** Unit travel tangent x (direction of motion). */
  tx: number;
  /** Unit travel tangent y. */
  ty: number;
  /** Normalized swim speed [0,1]; 0 => no lean (identity). */
  speedNorm: number;
  /** F4/G3: global stroke-axis coherence weight [0,1] (= strokeAxisStrength(a)).
   * 0 => per-hair local azimuth (identity). Optional; defaults to 0. */
  axisStrength?: number;
  /** Commit 21c: the live membrane contour the cilia should anchor on. When
   * present AND params.enableCiliaOnContour, each hair base sits on the deformed
   * (deform[]) + affine-squeezed (squeezeK,squeezePhi) contour and grows along
   * its true outward normal. Absent => the legacy bare-circle base (identity). */
  contour?: { deform: number[]; squeezeK: number; squeezePhi: number };
}

/**
 * G3 — idle/active stroke-axis vigour. Maps the master activity scalar to a
 * coherence weight in [0,1] via a smoothstep knee, so an idle crown is
 * near-isotropic (weight≈0, R<0.2, no "rowing in place") and an active crown is
 * coherent (weight≈1, R>0.4) driving propulsion. Pure & monotone in activity.
 */
export function strokeAxisStrength(activity: number, params: CellParams): number {
  const a = activity < 0 ? 0 : activity > 1 ? 1 : activity;
  const knee = params.strokeAxisKnee ?? 0.5;
  return smoothstep(a / (knee > 0 ? knee : 1e-6));
}

/**
 * D3 — metachronal index on the MOTION axis. The metachronal wave's phase lag
 * runs around the crown by hair index `k` at rest, but while swimming the wave
 * should organise along the travel direction. We blend the integer crown index
 * with an AXIAL index `wrapPi(baseAngle − axis)/gap` by `speedNorm`:
 *   metaIdx = (1−speedNorm)·k + speedNorm·(wrapPi(baseAngle−axis)/gap)
 * At speedNorm=0 (or gate off) this is exactly `k` (today's behaviour); at
 * speedNorm=1 the wave is anchored to the heading, so the argmax-phase hair
 * rotates WITH the heading. Fractional index is fine — ciliaBeatPhase accepts it.
 * Pure & deterministic.
 */
export function metachronalIndex(
  baseAngle: number,
  k: number,
  speedNorm: number,
  axis: number,
  gap: number,
  engaged: boolean,
): number {
  if (!engaged) return k;
  const s = speedNorm < 0 ? 0 : speedNorm > 1 ? 1 : speedNorm;
  if (s === 0) return k;
  const axial = wrapPi(baseAngle - axis) / (gap > 0 ? gap : 1e-6);
  return (1 - s) * k + s * axial;
}

/**
 * F4 — shared global stroke axis. Each hair beats in a plane; at rest that plane
 * is the LOCAL perpendicular `baseAngle + π/2` (per-hair azimuth, today's look).
 * While swimming we rotate every hair's beat plane TOWARD one global axis LINE
 * (the body heading), weighted by `strength` in [0,1]. We align to the nearest
 * orientation of the axis (mod π, since a beat plane is a line, not a ray), so a
 * hair never rotates more than π/2. strength=0 => identity. Pure.
 */
export function ciliaStrokeAngle(
  baseAngle: number,
  axis: number,
  strength: number,
): number {
  const local = baseAngle + Math.PI / 2;
  const s = strength < 0 ? 0 : strength > 1 ? 1 : strength;
  if (s === 0) return local;
  // Nearest axis orientation to `local` modulo π (beat plane is a line).
  const delta = wrapPi(2 * (axis - local)) / 2; // in (-π/2, π/2]
  return local + s * delta;
}

/**
 * Commit 22a — somatic ciliature ("mex") parameter override. When
 * `enableSomaticCilia` is on, the crown becomes MANY SHORT hairs (a dense
 * fringe) instead of the few long flagella: ciliaCount -> somaticCiliaCount and
 * ciliaLength -> somaticCiliaLength. Off (default) returns `params` unchanged
 * (referential identity), so the legacy crown is byte-identical. Pure.
 */
export function somaticCiliaParams(params: CellParams): CellParams {
  if (!params.enableSomaticCilia) return params;
  return {
    ...params,
    ciliaCount: params.somaticCiliaCount ?? 72,
    ciliaLength: params.somaticCiliaLength ?? 0.15,
  };
}

/** A cilium rendered as a multi-point spine plus its stroke width. */
export interface CiliumPath {
  /** Polyline points base->tip. */
  points: Array<[number, number]>;
  /** Stroke width in px for this hair (thicker hairs read as nearer/stronger). */
  width: number;
}

/**
 * Biologically-motivated cilium: a multi-segment spine with a bending wave
 * that travels from base to tip, beating with an asymmetric power/recovery
 * cycle and a metachronal phase lag between neighbours.
 *
 * Construction (per cilium, per segment s in [0,1] along arclength):
 *  - spine goes radially outward from the membrane (base at radius baseR);
 *  - a transverse bend offset is applied perpendicular to the radial axis;
 *  - the bend is a travelling sine: sin(2pi*(waves*s - phase)), so the hump
 *    moves outward along the hair over time (base->tip propagation);
 *  - amplitude tapers toward the base (anchored) and grows toward the tip,
 *    and scales with the beat envelope so the power stroke is straighter and
 *    the recovery stroke more curled.
 *
 * Pure & deterministic given t.
 */
export function ciliaPath(
  cx: number,
  cy: number,
  baseR: number,
  t: number,
  energy: number,
  growth: number,
  params: CellParams,
  motion?: CiliaMotion,
): CiliumPath[] {
  // D2: drag-lean strength. Zero when there is no motion basis or speedNorm=0,
  // so the crown is identical to the pre-D2 output at rest (back-compat).
  const dragCoeff = params.dragCoeff ?? 0.5;
  const mTx = motion?.tx ?? 0;
  const mTy = motion?.ty ?? 0;
  const mSpeed = motion ? Math.max(0, Math.min(1, motion.speedNorm)) : 0;
  // Commit 21c: anchor hair bases on the deformed+squeezed contour. Engaged ONLY
  // when the gate is on AND a contour is supplied; otherwise the legacy
  // bare-circle base path runs byte-for-byte (commit-21b frozen golden).
  const anchored = params.enableCiliaOnContour === true && motion?.contour !== undefined;
  // F4/G3: global stroke-axis coherence weight. Zero (or gate off, or no motion)
  // => per-hair local azimuth + integer metachronal index (identical to commit 11).
  const axisEngaged = (params.enableStrokeAxis ?? true) && motion !== undefined;
  const axisStrength = axisEngaged
    ? Math.max(0, Math.min(1, (motion?.axisStrength ?? 0) * (params.strokeAxisAlign ?? 1)))
    : 0;
  // Global stroke axis = the travel heading (atan2 of the motion tangent).
  const strokeAxis = Math.atan2(mTy, mTx);
  const out: CiliumPath[] = [];
  const n = Math.max(1, params.ciliaCount);
  const seg = Math.max(2, params.ciliaSegments ?? 6);
  const curl = params.ciliaCurl;
  const lenVar = Math.max(0, Math.min(0.95, params.ciliaLengthVar ?? 0.5));
  // A1: clamp jitter to [0, 0.9] (mirrors lenVar's [0, 0.95] clamp). The base
  // angular offset below is angleJit*gap*0.5, so capping at 0.9 keeps each hair
  // within <0.45*gap of its grid slot — strictly less than the half-gap that
  // would let neighbours swap order.
  const angleJit = Math.max(0, Math.min(0.9, params.ciliaAngleJitter ?? 0.55));
  const baseWidth = params.ciliaWidth ?? 1.6;
  // Number of spatial wavelengths along the hair (a flagellum shows ~1 wave).
  const waves = 1.1;
  const gap = TAU / n; // mean angular spacing between hairs

  // Mean hair length. CRITICAL: drive length by the SMOOTHED `growth`
  // accumulator (asymmetric attack/release) plus the resting `ciliaLength`,
  // NOT by the instantaneous `energy`. This makes the crown shrink GRADUALLY
  // when speech stops (growth releases slowly) instead of snapping shut.
  const lenMean =
    baseR * (params.ciliaLength + growth * params.ciliaGrowthBoost) * (0.55 + 0.45 * energy);

  for (let k = 0; k < n; k++) {
    // --- Aperiodic placement: jitter each hair off the even grid by a stable
    // per-hair noise offset, so spacing is irregular (biological crowns are
    // aperiodic, not perfectly hexagonal). A2: |angOff| <= angleJit*gap*0.5 and
    // angleJit<=0.9, so each hair stays within <0.45*gap of its slot. That bounds
    // the ADJACENT-hair angular DIFFERENCE to gap*(1 - 0.45 - 0.45) = 0.1*gap > 0,
    // i.e. neighbours can never cross / reorder.
    const angOff = noise2D(k * 12.9898, 7.2) * angleJit * gap * 0.5;
    const baseAngle = k * gap + angOff;
    const ux = Math.cos(baseAngle); // radial unit (outward)
    const uy = Math.sin(baseAngle);
    // F4: the transverse BEND plane. At rest this is the local perpendicular
    // (baseAngle + pi/2). While swimming it rotates toward the global stroke
    // axis (the heading), weighted by axisStrength, so the crown rows coherently.
    // When axisStrength==0 take the EXACT legacy vectors (-uy, ux) rather than
    // cos/sin(baseAngle+pi/2): trig of (ba+pi/2) differs from (-sin,cos) at ~1e-15
    // (IEEE-754), so this fast-path keeps the gate-off / at-rest crown BYTE-
    // identical to commit 11, not just visually identical.
    // NOTE (partial-strength seam): ciliaStrokeAngle rotates a LINE toward the
    // nearest axis orientation; for 0<axisStrength<1 the fore/aft hair pair
    // straddling baseAngle≡strokeAxis (mod pi) can fan apart by up to ~axisStrength*pi
    // before reconciling at axisStrength=1. It is one transient neighbour-pair
    // during the activity ramp, bounded and gone at sustained activity.
    let pxn: number;
    let pyn: number;
    if (axisStrength === 0) {
      pxn = -uy; // legacy perpendicular unit (exact)
      pyn = ux;
    } else {
      const strokeAngle = ciliaStrokeAngle(baseAngle, strokeAxis, axisStrength);
      pxn = Math.cos(strokeAngle); // bend-plane unit
      pyn = Math.sin(strokeAngle);
    }

    // Commit 21c: per-hair base anchored on the deformed+squeezed contour, plus
    // its true outward unit normal. Only on the anchored path; the off path keeps
    // the bare-circle base (cx+ux*baseR) and the (pxn,pyn) above untouched.
    let bx = 0;
    let by = 0;
    let anx = 0; // anchored outward unit normal x
    let any = 0; // anchored outward unit normal y
    if (anchored) {
      const contour = motion!.contour!;
      const d = deformAt(baseAngle, contour.deform);
      const dp = deformDerivAt(baseAngle, contour.deform);
      // Anchor radius on the deformed circle r(theta)=baseR*(1+d).
      const rTheta = baseR * (1 + d);
      const bx0 = cx + ux * rTheta;
      const by0 = cy + uy * rTheta;
      // One affine squeeze of the single base point (reuses the exact map;
      // identity when !enableAffine || k===1).
      const sq = affineSqueezePoints(
        [[bx0, by0]],
        contour.squeezeK,
        contour.squeezePhi,
        cx,
        cy,
        params,
      )[0];
      bx = sq[0];
      by = sq[1];
      // Outward normal of the polar curve r(theta)=baseR*(1+d) BEFORE squeeze:
      // n0 = normalize( cosθ*(1+d) + sinθ*d', sinθ*(1+d) - cosθ*d' ).
      let n0x = ux * (1 + d) + uy * dp;
      let n0y = uy * (1 + d) - ux * dp;
      const n0len = Math.hypot(n0x, n0y) || 1;
      n0x /= n0len;
      n0y /= n0len;
      // Transform the normal CONTRAVARIANTLY for the squeeze (reciprocal diagonal):
      // n' = R(phi) . diag(1/k, k) . R(-phi) . n0. NOT affineSqueezePoints (which
      // applies diag(k,1/k) and is WRONG for a normal). Same engaged condition as
      // affineSqueezePoints so base point and normal stay consistent.
      if (params.enableAffine && contour.squeezeK !== 1) {
        const cphi = Math.cos(contour.squeezePhi);
        const sphi = Math.sin(contour.squeezePhi);
        const xr = n0x * cphi + n0y * sphi;
        const yr = -n0x * sphi + n0y * cphi;
        const xs = xr / contour.squeezeK; // diag(1/k, k) — reciprocal of the point map
        const ys = yr * contour.squeezeK;
        const nx = xs * cphi - ys * sphi;
        const ny = xs * sphi + ys * cphi;
        const nlen = Math.hypot(nx, ny) || 1;
        anx = nx / nlen;
        any = ny / nlen;
      } else {
        anx = n0x;
        any = n0y;
      }
      // Local bend-plane perpendicular = 90° rotation of the outward normal.
      pxn = -any;
      pyn = anx;
    }

    // --- Per-hair size diversity: a stable [0,1] random scalar per hair. ---
    const r01 = noise2D(k * 3.7 + 0.3, 1.3) * 0.5 + 0.5; // [0,1]
    // Length spans [1-lenVar, 1+lenVar] around the mean.
    const lenK = lenMean * (1 - lenVar + 2 * lenVar * r01);
    // Thickness correlates loosely with length (longer ~ slightly thicker),
    // plus its own variation so it doesn't look mechanical.
    const r01b = noise2D(k * 5.1 + 2.7, 4.9) * 0.5 + 0.5;
    const hairWidth = baseWidth * (0.55 + 0.9 * (0.5 * r01 + 0.5 * r01b));

    // Beat phase for this hair (asymmetric + metachronal). Per-hair phase
    // seed so even neighbours at the same metachronal index aren't identical.
    // D3: while swimming, the metachronal wave organises along the MOTION axis
    // (metaIdx blends the crown index k -> axial index by speedNorm); at rest it
    // is exactly k (today's around-the-crown wave).
    const metaIdx = metachronalIndex(baseAngle, k, mSpeed, strokeAxis, gap, axisEngaged);
    const phase = ciliaBeatPhase(t + r01 * 0.6, metaIdx, params);
    // F3: smooth the recovery envelope instead of a hard {0.35,1} step at
    // phase=0.5. smoothstep((phase-0.35)/0.3) ramps 0->1 over phase in
    // [0.35,0.65], Lipschitz and C1, so the bend amplitude no longer jumps.
    const recovery = smoothstep((phase - 0.35) / 0.3);
    // F1: the old `beat = sin(phase*TAU)` drove a uniform `beat*0.3` tip sway and
    // is no longer used — the travelling `wave` below carries all bend.

    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= seg; i++) {
      const sFrac = i / seg; // 0 at base, 1 at tip
      const along = baseR + lenK * sFrac;
      // travelling bend wave (base->tip): the hump moves outward over time
      const wave = Math.sin(TAU * (waves * sFrac - phase));
      // F1: a cilium is a clamped-base / FREE-TIP elastic rod (9+2 axoneme).
      // The bending moment -> 0 at the free tip, so curvature must VANISH there
      // (kappa(L)=0). Use an INTERIOR-peaked envelope sin(pi*sFrac): exactly 0 at
      // the base (sFrac=0, anchored) AND 0 at the tip (sFrac=1, free), peaking
      // mid-shaft. The old tip-peaked pow(sFrac,1.2) flung the tip sideways,
      // which is biologically wrong.
      const amp = curl * lenK * 0.6 * Math.sin(Math.PI * sFrac) * (0.4 + 0.6 * recovery);
      // F1: drop the uniform `beat*0.3` term — it added a constant (sFrac-flat)
      // sway that did not vanish at the tip. The travelling wave alone keeps the
      // tip free.
      const rawBend = wave * 0.7 * amp;
      // F2: cap the transverse offset so a hair's angular sweep at radius `along`
      // stays under half the angular gap to its neighbour. The transverse offset
      // `bend` subtends angle ~bend/along; capping |bend| <= 0.5*gap*along keeps
      // that under half a gap, so beating hairs never cross / reorder.
      const bendCap = 0.5 * gap * along;
      const bend = Math.max(-bendCap, Math.min(bendCap, rawBend));
      // D2: viscous drag-lean. While swimming, each hair leans REARWARD (along
      // -tangent), growing toward the tip (pow(sFrac,1.3)) and stronger on the
      // LEADING face (lead = radial . tangent): dragGain = dragCoeff*speedNorm*
      // (0.6 + 0.4*lead). Zero at speedNorm=0 => identity (back-compat). The lean
      // is a fraction of hair length, so longer hairs sweep more.
      const lead = ux * mTx + uy * mTy;
      const dragGain = dragCoeff * mSpeed * (0.6 + 0.4 * lead);
      const dragPx = dragGain * lenK * Math.pow(sFrac, 1.3);
      // Commit 21c: on the anchored path the base is (bx,by) on the real contour
      // and the shaft grows outward along the true unit normal (anx,any); the
      // outward extent is (along - baseR) = lenK*sFrac. The off path is unchanged.
      const x = anchored
        ? bx + anx * (along - baseR) + pxn * bend - mTx * dragPx
        : cx + ux * along + pxn * bend - mTx * dragPx;
      const y = anchored
        ? by + any * (along - baseR) + pyn * bend - mTy * dragPx
        : cy + uy * along + pyn * bend - mTy * dragPx;
      pts.push([x, y]);
    }
    out.push({ points: pts, width: hairWidth });
  }
  return out;
}

/**
 * Startle reflex magnitude (the cell "darts" on a sharp audio onset).
 *
 * Detects a rising edge as (level - baseline) scaled by `sensitivity`; the new
 * magnitude is the MAX of the decayed previous magnitude and this fresh edge,
 * so a jolt rises instantly and then springs back via `decay` (per-frame factor
 * in [0,1], e.g. 0.85). Clamped to [0,1]. Pure & deterministic.
 *
 * The renderer converts magnitude → a small (dx,dy) using a noise-chosen angle.
 */
export function startleOffset(
  prevMag: number,
  level: number,
  baseline: number,
  sensitivity: number,
  decay: number,
): number {
  const edge = Math.max(0, (level - baseline) * sensitivity);
  const decayed = prevMag * Math.max(0, Math.min(1, decay));
  return Math.max(0, Math.min(1, Math.max(decayed, edge)));
}

/**
 * H1/M8 — startle as a low-Reynolds ESCAPE DART, not a mass-spring shove.
 * A real ciliate startled by a stimulus performs an avoidance reaction: it
 * changes direction and darts away. We model that as (1) a HEADING KICK on the
 * fresh onset of startle (a rising edge), and (2) a transient SPEED BURST while
 * startled (see `startleBurstSpeed`). This replaces the old positional (dx,dy)
 * centre offset, which implied inertia (dart-and-spring-back) and wrongly shoved
 * the cell even when idle/centred (M8).
 *
 * Returns the heading delta (radians) to apply THIS frame: a noise-chosen escape
 * angle on a rising edge (`startle - prevStartle > threshold`), else 0. Pure.
 */
export function startleHeadingKick(
  startle: number,
  prevStartle: number,
  t: number,
  params: CellParams,
): number {
  const rising = startle - prevStartle;
  if (rising <= (params.startleKickThreshold ?? 0.12)) return 0;
  // Escape angle in [-kickMax, +kickMax], chosen by slow noise so successive
  // darts pick different but deterministic directions.
  return noise2D(811.3, t * 1.7) * (params.startleKickMax ?? 1.2);
}

/**
 * H1 — transient swim-speed burst while startled (px/sec). Memoryless: it scales
 * with the current startle magnitude, so as startle decays the burst fades with
 * it (no coasting). Added on top of the activity-driven swim speed. Pure.
 */
export function startleBurstSpeed(
  startle: number,
  baseR: number,
  params: CellParams,
): number {
  const s = startle < 0 ? 0 : startle > 1 ? 1 : startle;
  return s * (params.startleBurstFrac ?? 0.5) * baseR;
}

/**
 * Resting-state membrane morphing. Returns per-vertex deformation fractions
 * (added to baseR) that slowly travel around the cell and wax/wane on a
 * periodic envelope, so an idle cell keeps gently reshaping instead of
 * freezing. Pure & deterministic given t.
 *
 * - Two traveling lobes via noise on (angle ± moving phase) give an organic,
 *   non-repeating bump pattern.
 * - A cosine envelope over `idleMorphPeriod` seconds, lifted to a floor in
 *   [idleMorphFloor, 1], modulates overall magnitude (gentle breathing of the
 *   reshape itself).
 * - Output is clamped to ±idleMorphAmplitude.
 */
export function idleMorph(
  sampleCount: number,
  t: number,
  params: CellParams,
): number[] {
  const out: number[] = [];
  // envelope in [floor, 1]
  const phase = (Math.cos((TAU * t) / Math.max(0.01, params.idleMorphPeriod)) + 1) / 2; // 0..1
  const env = params.idleMorphFloor + (1 - params.idleMorphFloor) * phase;
  const travel = t * params.idleMorphSpeed;
  for (let i = 0; i < sampleCount; i++) {
    const a = (i / sampleCount) * TAU;
    // two slowly traveling lobes for an organic, evolving outline
    const n1 = noise2D(Math.cos(a) * 1.6 + travel, Math.sin(a) * 1.6 - travel * 0.7);
    const n2 = noise2D(Math.cos(a) * 3.1 - travel * 0.5, Math.sin(a) * 3.1 + travel * 0.9);
    const raw = (n1 * 0.65 + n2 * 0.35); // in ~[-1,1]
    let d = raw * params.idleMorphAmplitude * env;
    // clamp to amplitude
    const cap = params.idleMorphAmplitude;
    if (d > cap) d = cap; else if (d < -cap) d = -cap;
    out.push(d);
  }
  return out;
}

/**
 * Iridescent hue at a given angle and time.
 *
 * Hue shifts around the contour (angle-dependent), drifts subtly with time
 * (shimmer), and deepens with audio level. Result is wrapped to [0, 360).
 *
 * @param baseHue Base hue in degrees (e.g. 34 for warm amber).
 */
export function iridescentHue(
  angle: number,
  t: number,
  audioLevel: number,
  baseHue: number,
  params: CellParams,
): number {
  // Normalize angle to [0, 1)
  const norm = (((angle % TAU) + TAU) % TAU) / TAU;
  let hue = baseHue + norm * params.hueSpread + t * params.shimmerSpeed + audioLevel * params.hueBoost;
  // Wrap to [0, 360)
  hue = ((hue % 360) + 360) % 360;
  return hue;
}



/**
 * A3: sample the spectrum bins at a continuous normalized angle [0,1) with
 * LINEAR interpolation and WRAPAROUND.
 *
 * The old code did `floor(normalized * nBins)` — a hard staircase, so the
 * radius jumped between adjacent vertices that fell in different bins, and the
 * value at angle 0 (bin 0) did not match angle 2pi (bin nBins-1), leaving a
 * seam at the contour's closure. Interpolating bin centres with a smoothstep
 * weight, wrapping bin nBins-1 -> bin 0, removes both artifacts (binDeform is
 * periodic: value(0) == value(1)).
 *
 * @param bins        Spectrum bins (each [0,1]); any length, 0 -> returns 0.
 * @param normalized  Angle as a fraction of the full circle, in [0,1).
 */
export function sampleBinLevel(bins: number[], normalized: number): number {
  const nBins = bins.length;
  if (nBins === 0) return 0;
  if (nBins === 1) return bins[0];
  // Bin centres sit at (i + 0.5)/nBins. Position the sample relative to them so
  // the interpolation is symmetric and wraps cleanly across the 0/1 seam.
  const u = (((normalized % 1) + 1) % 1) * nBins - 0.5;
  const i0 = Math.floor(u);
  const frac = u - i0;
  const a = bins[((i0 % nBins) + nBins) % nBins];
  const b = bins[(((i0 + 1) % nBins) + nBins) % nBins];
  return lerp(a, b, smoothstep(frac));
}

/**
 * Per-vertex target deformation fractions for the cell membrane.
 *
 * Returns `sampleCount` values where each `deform[i]` is the fractional
 * deformation beyond the base circle — i.e. `radius = baseR * (1 + deform[i])`
 * before clamping. Combines FBM noise, pseudopod protrusions, and spectrum
 * bin modulation into a single per-vertex scalar.
 *
 * This separates "instantaneous target" from persistent state:
 * the renderer feeds these targets into integrateDeformation() which
 * accumulates them asymmetrically (fast attack, slow release).
 *
 * @param width      Canvas width.
 * @param height     Canvas height.
 * @param bins       32 spectrum bins, each in [0, 1].
 * @param t          Continuous time (seconds).
 * @param audioLevel Smoothed audio level [0, 1].
 * @param energy     Pre-computed energy from cellEnergy().
 * @param params     Cell parameters.
 * @returns Array of `sampleCount` deformation fractions.
 */
// ---------------------------------------------------------------------------
// Deformation pipeline (see .pi/plans/cell-bio-accuracy-plan.md RENDER PIPELINE)
// ---------------------------------------------------------------------------
// The membrane radius at vertex i is `baseR * (1 + deform[i])`. The plan lays
// out a fixed 9-step order so each stage preserves the next stage's invariant:
//
//   3. buildTargetDeformation  (FBM + pseudopod + interpolated bins + idle)
//   4. [gate enableSaturation] soft-saturate target  d <- Dmax*tanh(d/Dmax)
//   5. integrateDeformation    (EXISTING shared.ts; fast attack, slow release)
//   6. [gate ...]              (optional cyclic Laplacian smoothing)
//   7. [gate enableAreaNorm]   normalize area on the INTEGRATED field
//   8. [gate enableAffine]     area-preserving affine squeeze (render-loop, on POINTS)
//   9. clamp radius            [floorRadius, maxRadius]  (safety net, render-loop)
//
// THIS COMMIT IS A NO-VISIBLE-CHANGE SCAFFOLD. Steps 4, 6, 7 below are present
// only as transparent identity SEAMS, gated off by default. The real math lands
// in later commits (B1=6, C1=7). With every gate off the output of
// `integrateDeformPipeline` is byte-identical to a bare `integrateDeformation`.

/**
 * Step 4 — soft-saturation [B1]. `d <- Dmax*tanh(d/Dmax)`.
 *
 * tanh is the canonical soft clamp:
 *   - g(0)=0 and g'(0)=1, so small deformations (|d| << Dmax) pass through
 *     essentially unchanged — normal motion is NOT crushed;
 *   - g is odd and strictly monotone increasing;
 *   - |g(d)| < Dmax for all finite d (strict bound — the asymptote is never
 *     reached), which feeds the radius budget so the step-9 clamp is a no-op.
 * Identity when the gate is off.
 */
export function saturateTargetDeform(target: number[], params: CellParams): number[] {
  if (!params.enableSaturation) return target;
  const Dmax = params.deformMax ?? 0.6;
  if (!(Dmax > 0)) return target; // defensive: a non-positive ceiling disables it
  return target.map((d) => Dmax * Math.tanh(d / Dmax));
}

/**
 * Step 7 — area normalization [C1]. Holds the cell's enclosed AREA at
 * `pi*baseR^2` by a UNIFORM radial offset on the INTEGRATED deform field.
 *
 * The polygon area is `pi*baseR^2 * mean((1+d)^2)` (mean over equiangular
 * samples), so "area == pi*baseR^2" is exactly `mean((1+d)^2) = 1`. Let
 * `e_i = 1 + d_i`, `m1 = mean(e)`, `Var = mean(e^2) - m1^2`. Subtracting a
 * uniform `c` from every `d_i` (i.e. `e_i -> e_i - c`) gives
 * `mean((e-c)^2) = mean(e^2) - 2c*m1 + c^2`. Setting that to 1 and solving the
 * quadratic `c^2 - 2*m1*c + (mean(e^2) - 1) = 0` yields
 * `c = m1 - sqrt(m1^2 - (mean(e^2) - 1)) = m1 - sqrt(1 - Var)` (smaller root, so
 * |c| is minimal). This is real iff `Var <= 1`.
 *
 * When `Var > 1` (a very high-variance field — rare in practice) no uniform
 * offset can reach area 1, so fall back to a MULTIPLICATIVE rescale
 * `s = 1/sqrt(mean(e^2))`, `e_i -> e_i * s`, which also gives `mean((e*s)^2)=1`.
 *
 * Guard: clamp `c` so `1 + d_i - c > 0` for every vertex (no inside-out
 * contour), i.e. `c <= min(e) - EPS`. Identity when the gate is off.
 *
 * Anti-balloon: today's pseudopod/bin terms are outward-only, so resting/driven
 * area over-inflates; C1 makes a one-sided bulge BORROW from the opposite side
 * instead of growing the whole cell. (research-membrane-areacons.md; plan C1.)
 */
export function normalizeAreaDeform(integrated: number[], params: CellParams): number[] {
  if (!params.enableAreaNorm) return integrated;
  const n = integrated.length;
  if (n === 0) return integrated;

  let sum = 0;
  let sumSq = 0;
  let minE = Infinity;
  for (const d of integrated) {
    const e = 1 + d;
    sum += e;
    sumSq += e * e;
    if (e < minE) minE = e;
  }
  const m1 = sum / n;
  const m2 = sumSq / n;
  const variance = m2 - m1 * m1;

  // Var > 1: no uniform offset reaches area 1 -> multiplicative fallback.
  if (variance > 1 || !(m2 > 0)) {
    const s = m2 > 0 ? 1 / Math.sqrt(m2) : 1;
    return integrated.map((d) => (1 + d) * s - 1);
  }

  // Smaller root keeps |c| minimal. (1 - Var) >= 0 here.
  let c = m1 - Math.sqrt(1 - variance);
  // No-inside-out guard: every (1 + d_i - c) must stay strictly positive.
  const EPS = 1e-4;
  const cMax = minE - EPS;
  if (c > cMax) c = cMax;

  return integrated.map((d) => d - c);
}

/**
 * Steps 4–7 of the pipeline as one named, ordered transform on the deformation
 * ARRAY: saturate(4) -> integrate(5, EXISTING) -> [smooth(6)] -> normalizeArea(7).
 * Step 6 (cyclic Laplacian smoothing) has no seam yet — it is an unconditional
 * optional polish [B2] with no gate; it will slot between 5 and 7 when added.
 *
 * @param prev    Prior integrated field, or null on the first frame / after a
 *                NaN-poison reset (then the saturated target seeds it directly).
 * @param target  Fresh per-vertex target from buildTargetDeformation (step 3).
 * @param params  Cell parameters (gates + attack/release).
 * @returns The new integrated deformation field.
 */
export function integrateDeformPipeline(
  prev: number[] | null,
  target: number[],
  params: CellParams,
): number[] {
  // Step 4: soft-saturate the target (gated; identity when off).
  const satTarget = saturateTargetDeform(target, params);
  // Step 5: integrate with form memory (EXISTING shared.ts helper). On the first
  // frame (or after a NaN reset) there is no prior field to blend from, so the
  // saturated target seeds the memory directly — mirrors the pre-pipeline path.
  const integrated = prev
    ? integrateDeformation(prev, satTarget, params.attack, params.release)
    : satTarget.slice();
  // Step 7: area-normalize the INTEGRATED field (gated; identity when off).
  return normalizeAreaDeform(integrated, params);
}

/**
 * Step 8 — area-preserving AFFINE SQUEEZE on contour POINTS [C2]. Identity until
 * `enableAffine` (Commit 5 ships the math; Commit 8/D4 wires motion-driven k,phi).
 *
 * The map about centre `(cx,cy)` is `M = R(+phi) . diag(k, 1/k) . R(-phi)`:
 * rotate into the heading frame by `-phi`, stretch x by `k` and y by `1/k`,
 * rotate back by `+phi`. Because `det M = det R(phi) . det diag(k,1/k) . det R(-phi)
 * = 1 . (k . 1/k) . 1 = 1`, the shoelace area is preserved EXACTLY for ANY
 * contour shape (change-of-variables: `Area(M(Omega)) = |det M| . Area(Omega)`).
 * See research-math-verify-v2.md item 1. This is why we use the point-squeeze and
 * NOT a fixed-angle polar/radial multiply, which inflates a circle's area by
 * `(k^2 + 1/k^2)/2` and is exact only for a circle.
 *
 * @param k   stretch factor along the heading axis (`phi`); `k=1` is identity.
 * @param phi heading angle (radians) of the stretch axis.
 */
export function affineSqueezePoints(
  points: Array<[number, number]>,
  k: number,
  phi: number,
  cx: number,
  cy: number,
  params: CellParams,
): Array<[number, number]> {
  if (!params.enableAffine || k === 1) return points;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const invK = 1 / k;
  return points.map(([x, y]) => {
    // Translate to centre, rotate by -phi into the heading frame.
    const dx = x - cx;
    const dy = y - cy;
    const xr = dx * cos + dy * sin;
    const yr = -dx * sin + dy * cos;
    // Squeeze: diag(k, 1/k) (det = 1, exactly area-preserving).
    const xs = xr * k;
    const ys = yr * invK;
    // Rotate back by +phi and translate to absolute coords.
    return [cx + xs * cos - ys * sin, cy + xs * sin + ys * cos] as [number, number];
  });
}

export function buildTargetDeformation(
  width: number,
  height: number,
  bins: number[],
  t: number,
  audioLevel: number,
  energy: number,
  params: CellParams,
  idleFactor: number = 0,
): number[] {
  const sampleCount = 96;
  const baseR = resolveBaseRadius(width, height, params, 0);
  const invBaseR = baseR > 0 ? 1 / baseR : 1;

  const morph = idleFactor > 0 ? idleMorph(sampleCount, t, params) : null;

  const out: number[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const angle = (i / sampleCount) * TAU;

    // Spectrum bin under this angle modulates local radius slightly (A3:
    // interpolated + wraparound so there is no staircase or 0/2pi seam).
    const normalized = ((angle % TAU) + TAU) % TAU / TAU;
    const binLevel = sampleBinLevel(bins, normalized);

    // FBM deformation (rFbm = 1.0 + noise * amp, so deformation = rFbm - 1)
    const rFbm = cellRadius(angle, t, energy, params);
    const fbmDeform = rFbm - 1.0;

    // Pseudopod protrusion (in pixels, convert to fraction of baseR)
    const rPseudo = pseudopodOffset(angle, t, audioLevel, energy, params);
    const pseudoDeform = rPseudo * invBaseR;

    // Spectrum bin contribution (fractional)
    const binDeform = binLevel * 0.15 * energy;

    const idle = morph ? morph[i] * idleFactor : 0;
    out.push(fbmDeform + pseudoDeform + binDeform + idle);
  }

  return out;
}





/**
 * Build the closed cell contour as an array of (x, y) points.
 *
 * Samples N points around the full circle (0..2π). The radius at each angle
 * combines a base radius modulated by FBM deformation and pseudopod
 * protrusion, with spectrum bins contributing local amplitude.
 *
 * Mirrors buildRingPoints in structure: N samples, cartesian output, closed loop.
 *
 * @param width         Canvas width.
 * @param height        Canvas height.
 * @param bins          32 spectrum bins, each in [0, 1].
 * @param t             Continuous time (seconds).
 * @param audioLevel    Smoothed audio level [0, 1].
 * @param energy        Pre-computed energy from cellEnergy().
 * @param params        Cell parameters.
 * @returns Array of [x, y] points forming a closed loop.
 */
export function buildCellContour(
  width: number,
  height: number,
  bins: number[],
  t: number,
  audioLevel: number,
  energy: number,
  params: CellParams,
): Array<[number, number]> {
  const sampleCount = 96;
  const cx = width / 2;
  const cy = height / 2;
  const baseR = resolveBaseRadius(width, height, params, 0);

  const out: Array<[number, number]> = [];
  for (let i = 0; i < sampleCount; i++) {
    const angle = (i / sampleCount) * TAU;

    // Spectrum bin under this angle modulates local radius slightly (A3:
    // interpolated + wraparound so there is no staircase or 0/2pi seam).
    const normalized = ((angle % TAU) + TAU) % TAU / TAU;
    const binLevel = sampleBinLevel(bins, normalized);

    const rFbm = cellRadius(angle, t, energy, params);
    const rPseudo = pseudopodOffset(angle, t, audioLevel, energy, params);

    // Combine: base radius * deformation + pseudopod + bin modulation
    const rawRadius =
      baseR * rFbm +
      rPseudo +
      binLevel * baseR * 0.15 * energy;

    // Clamp: keep membrane fully visible within the window.
    // Floor prevents pinching to a dot; ceiling respects the window (B1 radius
    // budget): use the SHORTER side so a non-square overlay never clips.
    const maxRadius = membraneMaxRadius(width, height);
    const radius = Math.max(baseR * 0.35, Math.min(maxRadius, rawRadius));

    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    out.push([x, y]);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Nucleus — drifting, pulsing organelle inside the membrane
// ---------------------------------------------------------------------------

/**
 * Compute the nucleus position and radius for the living cell.
 *
 * **SRP**: All nucleus math lives here; renderer only draws.
 * **Deterministic**: same inputs always produce the same output.
 *
 * The nucleus drifts slowly via 2D value-noise (two orthogonal seeds),
 * pulses its radius with audio level, and breathes gently during silence.
 * The offset (and, if needed, the radius) is clamped so the organelle always
 * stays inside the membrane. When the caller passes the LIVE minimum membrane
 * radius (`minMembraneR`), containment uses `minMembraneR * (1 - 0.15)` (F9
 * pinch-escape); otherwise it falls back to the legacy fixed `baseR * 0.55`.
 *
 * @param t          Continuous time in seconds.
 * @param audioLevel Smoothed audio level [0, 1].
 * @param baseR      Base cell radius in pixels.
 * @param params     Cell parameters (nucleus tunables are read from this).
 * @returns `{ cx, cy }` — offset **from cell center** in pixels.
 *          `{ r }` — nucleus radius in pixels, never below a safe floor.
 */
export function nucleusTransform(
  t: number,
  audioLevel: number,
  baseR: number,
  params: CellParams,
  minMembraneR?: number,
): { cx: number; cy: number; r: number } {
  // --- Drift: slow noise-driven offset inside the cell ---
  // M10: give x and y DISTINCT 2-D walks. Sharing the same second coord
  // `t*nucleusDrift` on adjacent first-coord rows (137 vs 241) made the two
  // streams cross-correlate (~0.26 over the test window; the nucleus drifted
  // diagonally). The y-walk uses a different rate (1.3x) and a large phase
  // offset (555.5) so the streams decorrelate to |r|<0.2 (measured ~0.10) while
  // staying smooth & deterministic. (xcorr of slow noise is window-sensitive;
  // <0.2 is the contractual bound, not the exact finite-sample value.)
  // SEED MAP (noise2D first coords): 137=nucleus-x, 241=nucleus-y, 811.3=startle
  // angle, 900.5=legacy startle, 7.1=wander init, k*12.9898=cilia angle jitter,
  // k*3.7/k*5.1=cilia size, k*5.3/k*9.7=cilia sway/wobble.
  const rawCx = baseR * params.nucleusWander * noise2D(137, t * params.nucleusDrift);
  const rawCy = baseR * params.nucleusWander * noise2D(241, t * params.nucleusDrift * 1.3 + 555.5);

  // --- Radius: base size + audio-driven pulse + idle breathing ---
  const idleBreath = Math.sin(t * 1.3) * params.nucleusPulse * 0.25;
  let r = baseR * (params.nucleusRadius + audioLevel * params.nucleusPulse + idleBreath);

  // Enforce a minimum pixel radius so the nucleus is never sub-pixel.
  const MIN_PX_RADIUS = 2.5;
  r = Math.max(MIN_PX_RADIUS, r);

  // --- Safety clamp: nucleus must stay well inside the membrane ---
  // F9 (pinch-escape): when the caller knows the LIVE minimum membrane radius
  // (which can floor near baseR*0.35 under a deep inward pinch), contain the
  // nucleus inside `minMembraneR * (1 - 0.15)`. Without it, fall back to the
  // legacy fixed inner-safe radius baseR*0.55, which assumes an undeformed wall.
  const PINCH_MARGIN = 0.15;
  const safeInner =
    minMembraneR !== undefined && Number.isFinite(minMembraneR)
      ? Math.max(0, minMembraneR) * (1 - PINCH_MARGIN)
      : baseR * 0.55;
  // F9: the nucleus radius itself must fit the safe zone, else it would poke out
  // through a tightly-pinched wall. Shrink it (above the sub-pixel floor) so
  // r + |offset| can satisfy the containment bound.
  if (r > safeInner) r = Math.max(MIN_PX_RADIUS, safeInner);
  const offsetMag = Math.sqrt(rawCx * rawCx + rawCy * rawCy);
  const maxOffsetMag = Math.max(0, safeInner - r);

  if (maxOffsetMag <= 0) {
    // Nucleus radius alone fills the safe zone — pin to centre.
    return { cx: 0, cy: 0, r: Math.max(0, safeInner) };
  }

  let cx: number;
  let cy: number;
  if (offsetMag <= maxOffsetMag) {
    cx = rawCx;
    cy = rawCy;
  } else {
    const scale = maxOffsetMag / offsetMag;
    cx = rawCx * scale;
    cy = rawCy * scale;
  }

  return { cx, cy, r };
}

// ---------------------------------------------------------------------------
// Cell persistence state + serialization
// ---------------------------------------------------------------------------

export interface CellPersistState {
  driftPhase: number;
  growth: number;
  elapsed: number;
  /** M4/M5: persisted wander pose. Position is stored as a FRACTION of the tank
   * (fx=x/width, fy=y/height) so it stays meaningful across resizes (M5). All
   * three are optional for back-compat with legacy v1 payloads (no pose). */
  fx?: number;
  fy?: number;
  heading?: number;
}

export function serializeCellState(s: CellPersistState): string {
  return JSON.stringify(s);
}

export function parseCellState(raw: string | null): CellPersistState | null {
  if (raw === null) return null;
  try {
    const obj = JSON.parse(raw);
    if (
      typeof obj !== "object" ||
      obj === null ||
      typeof obj.driftPhase !== "number" ||
      !Number.isFinite(obj.driftPhase) ||
      typeof obj.growth !== "number" ||
      !Number.isFinite(obj.growth) ||
      typeof obj.elapsed !== "number" ||
      !Number.isFinite(obj.elapsed)
    ) {
      return null;
    }
    // Reject absurd-but-finite values that could freeze/break animation
    if (obj.elapsed < 0 || obj.elapsed >= 1e7) return null;
    if (obj.driftPhase < -1e7 || obj.driftPhase > 1e7) return null;
    const base: CellPersistState = { driftPhase: obj.driftPhase, growth: obj.growth, elapsed: obj.elapsed };
    // M4/M5: attach the pose ONLY if all three fields are present, finite and in
    // range. A corrupt/partial pose is dropped (base state still restores), so a
    // bad fraction can never teleport the cell out of bounds.
    if (
      typeof obj.fx === "number" && Number.isFinite(obj.fx) && obj.fx >= 0 && obj.fx <= 1 &&
      typeof obj.fy === "number" && Number.isFinite(obj.fy) && obj.fy >= 0 && obj.fy <= 1 &&
      typeof obj.heading === "number" && Number.isFinite(obj.heading) &&
      obj.heading > -1e4 && obj.heading < 1e4
    ) {
      base.fx = obj.fx;
      base.fy = obj.fy;
      base.heading = obj.heading;
    }
    return base;
  } catch {
    return null;
  }
}

/**
 * Compute initial `startedAt` and `driftPhaseOffset` from a persisted
 * cell state so that the first rendered frame's drift-phase argument
 * (`t + driftPhaseOffset`) continues seamlessly from the saved phase.
 *
 * Pure & exported for testability.
 *
 * @param saved  Parsed persistence state from localStorage.
 * @param now    Current `performance.now()` value at restore time (ms).
 */
export function restoreSeed(
  saved: CellPersistState,
  now: number,
): { startedAt: number; driftPhaseOffset: number } {
  const elapsed = saved.elapsed > 0 ? saved.elapsed : 0;
  return {
    startedAt: now - elapsed * 1000,
    driftPhaseOffset: saved.driftPhase - elapsed,
  };
}

/**
 * M4/M5 — reconstruct a wander pose (pixel x/y + heading) from a persisted
 * state. Position is stored as a FRACTION of the tank, so we re-derive it
 * against the CURRENT width/height (resize-safe) and clamp it into the wander
 * inset (same `max(driftMargin, cellReach)` the wander itself uses) so a saved
 * near-wall fraction can never start the cell out of bounds. Returns null when
 * the saved state carries no pose (legacy payload). Pure & deterministic.
 */
export function wanderPoseFromState(
  saved: CellPersistState,
  width: number,
  height: number,
  baseR: number,
  params: CellParams,
): { x: number; y: number; heading: number } | null {
  if (saved.fx === undefined || saved.fy === undefined || saved.heading === undefined) {
    return null;
  }
  const reach = cellReach(baseR, params);
  const inset = Math.max(params.driftMargin ?? 4, reach);
  const clamp = (v: number, lo: number, hi: number) =>
    lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v));
  return {
    x: clamp(saved.fx * width, inset, width - inset),
    y: clamp(saved.fy * height, inset, height - inset),
    heading: saved.heading,
  };
}

/**
 * M5 — persistence key namespaced by tank size so a state saved for one overlay
 * geometry (e.g. the 160x160 square overlay) is never loaded into another (e.g.
 * the 172x36 harness strip), which would restore a nonsensical pose.
 */
export function cellPersistKey(width: number, height: number): string {
  return `talri.cell.state.v2.${Math.round(width)}x${Math.round(height)}`;
}

// ---------------------------------------------------------------------------
// Base radius resolution (absolute + growth swell)
// ---------------------------------------------------------------------------

/**
 * Membrane clamp ceiling (step-9 safety net) [B1 radius budget].
 *
 * The membrane is contained by the SHORTER window side so a non-square overlay
 * never clips the cell on its narrow axis: `maxRadius = min(w,h)*0.46`. This is
 * the MEMBRANE radius only — distinct from {@link cellReach}, which also budgets
 * cilia + drag-lean for whole-organism wall containment. With B1 saturation the
 * deformation is bounded by Dmax, so `baseR*(1+Dmax) <= maxRadius` and this
 * clamp is provably a no-op under normal audio (the saturation, not the clamp,
 * keeps the radius in budget).
 */
export function membraneMaxRadius(width: number, height: number): number {
  return Math.min(width, height) * 0.46;
}

export function resolveBaseRadius(
  width: number,
  height: number,
  params: CellParams,
  growth: number,
): number {
  const fallbackR = Math.min(width, height) * params.radiusFraction;
  const rawBaseR = params.baseRadiusPx ?? fallbackR;
  return rawBaseR * (1 + growth * params.growthSwell);
}

/**
 * E1 (OPT) — perimeter-driven cilia count. A bigger cell should carry more
 * hairs at roughly constant arc spacing, not a fixed number. Returns
 * `round(2*pi*baseR / ciliaSpacingPx)`, at least 1 and capped by `ciliaCount`
 * (so it never explodes on a huge overlay). Pure & deterministic.
 */
export function perimeterCiliaCount(baseR: number, params: CellParams): number {
  const spacing = Math.max(0.5, params.ciliaSpacingPx ?? 8);
  const n = Math.round((TAU * Math.max(0, baseR)) / spacing);
  const cap = Math.max(1, params.ciliaCount);
  return Math.max(1, Math.min(cap, n));
}

/**
 * F13 (OPT) — band-limit the membrane deformation for a smooth ciliate look.
 * Keeps only low spatial modes (|n| <= bandLimitMode) via a cyclic DFT
 * truncation, then caps the amplitude to bandLimitAmp. Length-preserving, pure
 * & deterministic. (Reconstruction uses the real cyclic DFT; O(N*K) with small K.)
 */
export function bandLimitDeform(deform: number[], params: CellParams): number[] {
  const N = deform.length;
  if (N === 0) return [];
  const K = Math.max(0, Math.floor(params.bandLimitMode ?? 4));
  const cap = params.bandLimitAmp ?? 0.08;
  // Forward DFT coefficients for modes 0..K, reconstruct keeping only those.
  const a: number[] = new Array(K + 1).fill(0);
  const b: number[] = new Array(K + 1).fill(0);
  for (let k = 0; k <= K; k++) {
    let re = 0, im = 0;
    for (let i = 0; i < N; i++) {
      const ang = (k * i / N) * TAU;
      re += deform[i] * Math.cos(ang);
      im += deform[i] * Math.sin(ang);
    }
    a[k] = re / N;
    b[k] = im / N;
  }
  const out = new Array<number>(N);
  for (let i = 0; i < N; i++) {
    let v = a[0]; // DC term
    for (let k = 1; k <= K; k++) {
      const ang = (k * i / N) * TAU;
      // real cyclic reconstruction: 2*(a*cos + b*sin) for modes 1..K
      v += 2 * (a[k] * Math.cos(ang) + b[k] * Math.sin(ang));
    }
    out[i] = v < -cap ? -cap : v > cap ? cap : v;
  }
  return out;
}

/**
 * F11 (OPT) — contractile vacuole. A peripheral vesicle that slowly FILLS
 * (diastole) then rapidly COLLAPSES (systole) each `vacuolePeriod`. Phase
 * `u = (t/period) mod 1`; radius `R_max * smoothstep(0, 0.85, u)` rising to a
 * peak near u=0.85, then dropping to ~0 by u=1. R_max = vacuoleMaxFrac*baseR.
 * Returns `{ r }` (px). Pure & deterministic.
 */
export function contractileVacuole(t: number, baseR: number, params: CellParams): { r: number } {
  const period = Math.max(0.1, params.vacuolePeriod ?? 7);
  const Rmax = Math.max(0, params.vacuoleMaxFrac ?? 0.18) * Math.max(0, baseR);
  const u = ((t / period) % 1 + 1) % 1;
  let fill: number;
  if (u <= 0.85) {
    // diastole: smoothstep fill 0 -> 1 over [0, 0.85]
    fill = smoothstep(u / 0.85);
  } else {
    // systole: rapid collapse 1 -> 0 over (0.85, 1]
    fill = 1 - smoothstep((u - 0.85) / 0.15);
  }
  return { r: Rmax * fill };
}

/**
 * H4 (OPT) — ambient flow field from the body's swimming wake. A low-Reynolds
 * swimmer drags fluid; we model the far field as a 2-D SOURCE DIPOLE (doublet),
 * the potential-flow signature of a translating body:
 *
 *   u(r) = (S / r^2) * [ 2 (e·r̂) r̂ - e ]
 *
 * where `e = (cos heading, sin heading)` is the swim direction and `r = (dx,dy)`
 * is the offset from the cell centre to the sample point. Properties (all
 * exercised by tests): decays as 1/r^2 for a fixed bearing; LINEAR in `e` so it
 * reverses when heading reverses and scales with `strength`; frame-covariant
 * (rotating point+heading rotates the velocity). The r->0 singularity is clamped
 * to a small core so the field stays finite. Pure & deterministic.
 */
export function dipoleFlowAt(
  dx: number,
  dy: number,
  heading: number,
  strength: number,
): { vx: number; vy: number } {
  if (strength === 0) return { vx: 0, vy: 0 };
  const CORE2 = 4; // clamp r^2 to >= 2px core so the doublet stays bounded
  const r2 = Math.max(CORE2, dx * dx + dy * dy);
  const r = Math.sqrt(r2);
  const rxh = dx / r, ryh = dy / r;          // r̂
  const ex = Math.cos(heading), ey = Math.sin(heading); // e
  const edotr = ex * rxh + ey * ryh;         // e·r̂
  const k = strength / r2;
  return {
    vx: k * (2 * edotr * rxh - ex),
    vy: k * (2 * edotr * ryh - ey),
  };
}

/**
 * H4 (OPT) — advance one ambient mote by the local dipole flow for `dt`
 * (memoryless, low-Re: position += velocity*dt, no inertia). Motes that leave
 * the tank wrap toroidally so the field never depletes. Pure & deterministic.
 */
export function advectMote(
  mote: { x: number; y: number },
  cx: number,
  cy: number,
  heading: number,
  strength: number,
  dt: number,
  width: number,
  height: number,
  params: CellParams,
): { x: number; y: number } {
  const v = dipoleFlowAt(mote.x - cx, mote.y - cy, heading, strength * (params.flowStrength ?? 1));
  const wrap = (val: number, span: number) => {
    if (span <= 0) return 0;
    return ((val % span) + span) % span;
  };
  return {
    x: wrap(mote.x + v.vx * dt, width),
    y: wrap(mote.y + v.vy * dt, height),
  };
}

/**
 * H4 (OPT) — deterministic initial scatter of `flowMoteCount` motes across the
 * tank (value-noise seeded, so the same geometry always reproduces the same
 * field). Returns [] when the count is 0. Pure.
 */
export function seedMotes(width: number, height: number, params: CellParams): { x: number; y: number }[] {
  const n = Math.max(0, Math.floor(params.flowMoteCount ?? 0));
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    // two decorrelated seeds per mote -> uniform-ish coverage, fully deterministic.
    const ux = (noise2D(i * 12.9898 + 3.1, 78.233) + 1) * 0.5;
    const uy = (noise2D(i * 39.346 + 7.7, 11.135) + 1) * 0.5;
    out.push({ x: ux * width, y: uy * height });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cell containment — full organism reach (membrane + cilia + startle)
// ---------------------------------------------------------------------------

/**
 * Worst-case distance from cell centre to any drawn pixel.
 *
 * Accounts for three stacked effects:
 *  1. Membrane deformation (FBM + pseudopods) can push the contour outward
 *     ~40% beyond baseR.
 *  2. Cilia tips extend beyond the base circle: at max growth and energy they
 *     reach baseR + baseR * (ciliaLength + ciliaGrowthBoost) * 1.3.
 *  3. Startle jolts the entire cell by up to `startleMaxPx` pixels.
 *
 * The return value is the radius of the bounding circle around the centre
 * within which the whole organism fits.
 *
 * @param baseR  Current base cell radius (with growth swell already applied).
 * @param params Cell parameters (ciliaLength, ciliaGrowthBoost, startleMaxPx).
 */
export function cellReach(baseR: number, params: CellParams): number {
  const ciliaLength = params.ciliaLength ?? 0;
  const ciliaGrowthBoost = params.ciliaGrowthBoost ?? 0;
  const startleMaxPx = params.startleMaxPx ?? 0;

  const membraneOuter = baseR * 1.4; // baseR + 40% membrane headroom
  // F12: match the ACTUAL worst-case cilium in ciliaPath, which the old 1.3
  // factor underestimated (so the longest hairs clipped the wall).
  //  lenMean = baseR*(ciliaLength + growth*boost)*(0.55 + 0.45*energy)
  //          ≤ baseR*(ciliaLength + boost)            (growth=1, energy=1)
  //  longest hair: lenK = lenMean*(1 - lenVar + 2*lenVar*r01), max at r01=1
  //          → lenMean*(1 + lenVar)
  //  so the tip sits at radial distance `along` = baseR + lenK_max.
  const lenVar = Math.max(0, Math.min(0.95, params.ciliaLengthVar ?? 0));
  const longestAlong = baseR + baseR * (ciliaLength + ciliaGrowthBoost) * (1 + lenVar);
  // The transverse bend is capped (F2) at 0.5*gap*along, so the tip's distance
  // from centre is along*sqrt(1 + (0.5*gap)^2); include that headroom too.
  const ciliaCount = params.ciliaCount ?? 0;
  const gap = ciliaCount > 0 ? TAU / ciliaCount : 0;
  const ciliaOuter = longestAlong * Math.sqrt(1 + 0.25 * gap * gap);

  return Math.max(membraneOuter, ciliaOuter) + startleMaxPx;
}

/**
 * Smoothed drift-activation ramp.
 *
 * Moves `prev` toward a target of 1 (when `recording` is true) or 0
 * (when idle/transcribing/error) by a per-frame `rate`, then clamps to
 * [0, 1]. This gives a visually smooth transition between centered rest
 * and full-drift recording, without instant jumps.
 *
 * At the default rate of 0.02 and 60 fps, it takes about 3 seconds to
 * reach 90% of the target.  rate=1 jumps instantly; rate=0 never moves.
 */
export function driftActivation(
  prev: number,
  recording: boolean,
  rate: number,
  dt?: number,
): number {
  const target = recording ? 1 : 0;
  // F8: frame-rate independence. `rate` is the historical per-frame (1/60 s) lerp
  // factor. Generalize to any dt by compounding it: alpha = 1 - (1-rate)^(dt*60),
  // which equals `rate` exactly at dt=1/60 (back-compat) and keeps the time
  // constant fixed regardless of frame rate. When dt is omitted, fall back to
  // the legacy per-frame factor.
  const r = rate < 0 ? 0 : rate > 1 ? 1 : rate;
  const alpha = dt === undefined ? r : 1 - Math.pow(1 - r, dt * 60);
  const raw = prev + (target - prev) * alpha;
  if (raw > 1) return 1;
  if (raw < 0) return 0;
  return raw;
}

// ---------------------------------------------------------------------------
// Cell drift (slow travel within aquarium bounds)
// ---------------------------------------------------------------------------

export function cellDrift(
  t: number,
  width: number,
  height: number,
  baseR: number,
  params: CellParams,
): { cx: number; cy: number } {
  // Contain the WHOLE organism (membrane + cilia + startle), not just the
  // base circle.  `inset` is the min distance from wall that the centre must
  // respect so that no part of the living cell clips the aquarium edge.
  const reach = cellReach(baseR, params);
  const inset = Math.max(params.driftMargin ?? 4, reach);
  const speed = params.driftSpeed ?? 0.03;

  const travelRangeX = width - 2 * inset;
  const travelRangeY = height - 2 * inset;

  const phaseX = t * speed + 1000;
  const phaseY = t * speed + 2000;

  const noiseX = noise2D(phaseX, 0);
  const noiseY = noise2D(phaseY, 0);

  // Map [-1, 1] → [lo, hi]; clamp degenerate axis to center
  const mapTo = (noise: number, lo: number, hi: number) =>
    lo + (noise * 0.5 + 0.5) * (hi - lo);

  const cx = travelRangeX > 0
    ? mapTo(noiseX, inset, width - inset)
    : width / 2;
  const cy = travelRangeY > 0
    ? mapTo(noiseY, inset, height - inset)
    : height / 2;

  return { cx, cy };
}

// ---------------------------------------------------------------------------
// Wander — Reynolds steering-style integrated wander (the natural, non-
// returning motion). Unlike `cellDrift` (position = noise(t), which merely
// oscillates the centre about the middle and so always "comes back"), this
// INTEGRATES position along a slowly turning heading:
//
//   heading += smallRandomDisplacement      (random walk — Reynolds wander)
//   velocity  = dir(heading) * speed
//   position += velocity * dt
//   on wall contact: reflect heading (bounce) and clamp inside
//
// Result: the cell roams the tank organically and does not gravitate to the
// centre. The random displacement is small per frame, so turns are smooth
// (no twitching). Deterministic given the input state (the "randomness" is
// value-noise sampled on the heading itself, so no RNG/Date needed).
// ---------------------------------------------------------------------------

export interface WanderState {
  x: number;
  y: number;
  heading: number; // radians
  vx: number;
  vy: number;
  /** Monotonic wander clock (seconds). F6: the heading jitter is sampled on
   * this clock, NOT on position (x+y). Sampling on (x+y) made the random walk
   * couple to where the cell happens to be, which produced stalls and limit
   * cycles (the noise argument stops advancing when the cell slows or circles).
   * A dedicated clock keeps the heading a genuine, position-independent walk. */
  clock?: number;
}

/**
 * F7 (OPT) — wall-avoidance reorientation. Instead of a specular reflection
 * (which keeps the cell skimming the wall), a startled microswimmer backs up and
 * turns around: reorient to roughly the REVERSE of the incoming heading plus a
 * deterministic noise jitter, so it heads back into the tank and successive
 * contacts differ. Pure. Returns the new heading (radians).
 */
export function wallReorientHeading(incoming: number, t: number, params: CellParams): number {
  const jitter = (params.wallReorientJitter ?? 0.6) * noise2D(517.3, t * 1.9);
  return incoming + Math.PI + jitter;
}

/**
 * H2 (OPT) — rotational Brownian motion. A microswimmer's heading diffuses with
 * RMS angular step `sqrt(2*D_r*dt)` per frame. We synthesise a deterministic,
 * approximately-gaussian, zero-mean unit sample from value-noise (sum of a few
 * decorrelated noise taps → central-limit) and scale it. Returns the heading
 * delta (radians) for this frame; 0 when D_r=0. Pure.
 */
export function rotationalBrownianStep(t: number, dt: number, params: CellParams): number {
  const Dr = params.rotationalDiffusion ?? 0;
  if (Dr <= 0) return 0;
  // Approx N(0,1): a sum of 3 decorrelated value-noise taps. NOTE: noise2D is
  // SMOOTHED value-noise, not uniform, so a tap's variance is ~0.21 (not 1/3);
  // the empirical std of this 3-tap SUM is ~0.795 (measured over 4e5 samples).
  // Divide by that std (NOT sqrt(3)) so `g` truly has ~unit variance and the
  // realized RMS angular step matches the labelled sqrt(2*Dr*dt) — keeping the
  // rotationalDiffusion knob physically honest. Zero-mean, deterministic in t.
  const TAP_SUM_STD = 0.795;
  const g = (noise2D(211.7, t * 7.3) + noise2D(389.1, t * 11.9 + 5.5) + noise2D(53.9, t * 17.1 + 1.3)) / TAP_SUM_STD;
  return g * Math.sqrt(2 * Dr * Math.max(0, dt));
}

/**
 * H3 (OPT) — sedimentation. A dense cell settles slowly under gravity. Returns a
 * small DOWNWARD (+y in canvas) velocity bias as a fraction (<0.15) of the swim
 * speed; 0 by default. Pure.
 */
export function sedimentationBias(speed: number, params: CellParams): { dvx: number; dvy: number } {
  const frac = Math.max(0, Math.min(0.15, params.sedimentationFrac ?? 0));
  return { dvx: 0, dvy: frac * speed };
}

export function wanderStep(
  s: WanderState,
  dt: number,
  width: number,
  height: number,
  baseR: number,
  params: CellParams,
  speedOverride?: number,
): WanderState {
  const reach = cellReach(baseR, params);
  const inset = Math.max(params.driftMargin ?? 4, reach);
  const minX = inset, maxX = width - inset;
  const minY = inset, maxY = height - inset;

  // Degenerate tank (organism doesn't fit): pin to centre.
  if (maxX <= minX || maxY <= minY) {
    return { x: width / 2, y: height / 2, heading: s.heading, vx: 0, vy: 0, clock: (s.clock ?? 0) + dt };
  }

  // Speed in px/sec. G2: when an activity-driven swim speed is supplied it
  // REPLACES the free driftSpeed, so a louder voice (higher beat) swims faster
  // and silence stops the cell in the SAME frame (memoryless, no coasting — the
  // velocity is set from the current heading×speed every step; F5: there is no
  // `v += a*dt` momentum accumulation). The legacy driftSpeed remains the
  // fallback when no override is given (enableActivity off).
  const speed =
    speedOverride !== undefined
      ? speedOverride
      : (params.driftSpeed ?? 0.03) * Math.min(width, height) * 1.2;

  // --- Reynolds wander: small random displacement of the heading. ---
  // Use value-noise sampled along the *current heading + a wander clock*
  // so the turn is smooth and deterministic but never periodic in (x,y).
  // turnRate scales the per-second angular wander (radians/sec).
  const turnRate = params.wanderTurnRate ?? 1.1;
  // F6: advance a dedicated wander clock and sample the heading jitter on it,
  // decoupled from position. noise2D in [-1,1]; the two args are the heading
  // (so the walk still varies smoothly with current direction) and the clock
  // scaled by wanderFreq (so the walk keeps evolving regardless of where the
  // cell is or how fast it moves).
  const wanderFreq = params.wanderFreq ?? 0.6;
  const clock = (s.clock ?? 0) + dt;
  const jitter = noise2D(s.heading * 0.5 + 13.0, clock * wanderFreq);
  let heading = s.heading + jitter * turnRate * dt;
  // H2 (opt, default off): add rotational Brownian diffusion to the heading.
  if (params.enableRotationalBrownian) {
    heading += rotationalBrownianStep(clock, dt, params);
  }

  // Integrate position.
  let vx = Math.cos(heading) * speed;
  let vy = Math.sin(heading) * speed;
  let x = s.x + vx * dt;
  let y = s.y + vy * dt;

  // --- Wall handling. Default: specular reflection off the wall normal. F7
  // (opt, default off): back-up + reorient (~pi turn) instead, an avoidance
  // reaction so the cell doesn't skim the wall. ---
  const hitWall = x < minX || x > maxX || y < minY || y > maxY;
  if (params.enableWallReorient && hitWall) {
    x = Math.max(minX, Math.min(maxX, x));
    y = Math.max(minY, Math.min(maxY, y));
    heading = wallReorientHeading(heading, clock, params);
  } else {
    if (x < minX) {
      x = minX;
      heading = Math.PI - heading; // reflect about vertical wall
    } else if (x > maxX) {
      x = maxX;
      heading = Math.PI - heading;
    }
    if (y < minY) {
      y = minY;
      heading = -heading; // reflect about horizontal wall
    } else if (y > maxY) {
      y = maxY;
      heading = -heading;
    }
  }
  // Recompute velocity after any reflection so callers see the true heading.
  vx = Math.cos(heading) * speed;
  vy = Math.sin(heading) * speed;
  // H3 (opt, default off): small downward sedimentation bias on the velocity.
  if (params.enableSedimentation) {
    const sed = sedimentationBias(speed, params);
    vx += sed.dvx;
    vy += sed.dvy;
    x = Math.max(minX, Math.min(maxX, x + sed.dvx * dt));
    y = Math.max(minY, Math.min(maxY, y + sed.dvy * dt));
  }

  // Normalize heading to [-PI, PI] to keep noise sampling well-conditioned.
  heading = Math.atan2(Math.sin(heading), Math.cos(heading));

  return { x, y, heading, vx, vy, clock };
}

// ---------------------------------------------------------------------------
// Canvas helper
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// Renderer factory
// ---------------------------------------------------------------------------

export interface CellOptions {
  width: number;
  height: number;
  params?: Partial<CellParams>;
  /** Warm amber base hue in degrees. */
  baseHue?: number;
}

/**
 * Create a living-cell renderer inside `container`.
 *
 * Lifecycle mirrors createRingRenderer exactly:
 * - Creates a full-container <canvas>
 * - Runs its own rAF loop with continuous time `t`
 * - Exposes { update(state), destroy() } via the Renderer contract
 */
export function createCellRenderer(
  container: HTMLElement,
  opts: CellOptions,
): Renderer {
  const params: CellParams = { ...CELL_DEFAULTS, ...(opts.params ?? {}) };
  const baseHue = opts.baseHue ?? 34; // warm amber
  const { width, height } = opts;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.style.display = "block";
  container.appendChild(canvas);

  const ctx = canvas.getContext("2d");

  let latestState: ThemeState = {
    mode: "idle",
    audioLevel: 0,
    spectrumBins: new Array(32).fill(0),
  };

  // Persistent form-memory buffer: per-vertex deformation fractions
  // accumulated across frames with asymmetric attack/release.
  let deform: number[] | null = null;
  let growth = 0;
  let energySmoothed = -1; // M6: EMA-chased energy (lazy seed on first frame)
  let startle = 0;
  let baseline = 0; // slow-tracking audio baseline for startle edge detection
  let drift01 = 0; // smoothed drift activation (0=centered, 1=full drift)

  // Reynolds-style integrated wander state (replaces position=noise(t), which
  // oscillated about the centre and kept "returning"). Lazily initialised at
  // the tank centre on the first tick (width/height are stable per renderer).
  let wander: WanderState | null = null;
  let bodyHeading = 0; // G4: smoothed body long-axis heading (radians)
  // H4 (gate OFF): ambient tracer motes advected by the body's dipolar wake.
  // Lazily seeded on first tick when enableFlowField is on; [] otherwise so the
  // default path allocates nothing and the shipped look is unchanged.
  let motes: { x: number; y: number }[] | null = null;
  // H4: previous-frame flow source (centre, heading, swim speed) so motes can be
  // advected + drawn BEHIND the cell at the top of the tick without a forward
  // dependency on this frame's not-yet-computed centre.
  let flowCx = width / 2, flowCy = height / 2, flowHeading = 0, flowSpeed = 0;
  let lastTickMs = performance.now();
  // M11: single simulation clock. Accumulates the SAME clamped per-frame dt that
  // drives position integration, and feeds ALL phase formulas. This unifies the
  // two former clocks (position used clamped dt; phases used true wall-elapsed),
  // so a backgrounded tab resuming with one huge frame can no longer desync
  // position from phase. Clamp only the per-frame dt, never this accumulator.
  let simTime = 0;

  // Persistence: restore state from localStorage for continuity across restarts.
  // M5: key is namespaced by tank size so a pose saved for one overlay geometry
  // never loads into another.
  const PERSIST_KEY = cellPersistKey(width, height);
  let driftPhaseOffset = 0;
  let lastPersist = 0;
  // M4: a wander pose restored from persistence, consumed at lazy wander-init so
  // the cell resumes where it left off instead of teleporting to centre.
  let restoredPose: { x: number; y: number; heading: number } | null = null;

  if (typeof localStorage !== "undefined") {
    try {
      // M5: remove the orphaned pre-v2 key once so it doesn't linger forever.
      localStorage.removeItem("talri.cell.state.v1");
      const saved = parseCellState(localStorage.getItem(PERSIST_KEY));
      if (saved) {
        growth = saved.growth;
        const seed = restoreSeed(saved, performance.now());
        // M11: seed the single clock from the saved elapsed so phases continue
        // seamlessly. driftPhaseOffset is still derived via restoreSeed, so the
        // first frame's driftPhase = saved.driftPhase + dt (one-frame advance) —
        // exactly what the old wall-clock formula produced, so the seam is
        // equivalent to pre-M11 behaviour.
        simTime = saved.elapsed > 0 ? saved.elapsed : 0;
        driftPhaseOffset = seed.driftPhaseOffset;
        // baseR depends on growth (resolveBaseRadius); use the restored growth so
        // the inset clamp matches the cell's actual size.
        restoredPose = wanderPoseFromState(saved, width, height, resolveBaseRadius(width, height, params, growth), params);
      }
    } catch {
      // Silently ignore localStorage errors
    }
  }

  let rafId: number | null = null;

  const tick = () => {
    const nowMs = performance.now();
    // Real frame delta (clamped) so wander speed is frame-rate independent
    // and a backgrounded tab resuming doesn't teleport the cell.
    const dt = Math.min(0.05, Math.max(0.001, (nowMs - lastTickMs) / 1000));
    lastTickMs = nowMs;
    // M11: advance the single clock by the SAME clamped dt used for position.
    // `t` (formerly true wall-elapsed) is now this accumulator so phases and
    // position stay locked together.
    simTime += dt;
    const t = simTime;
    const s = latestState;

    // M15: sanitise external frame state so a NaN/Inf audioLevel or bad spectrum
    // bin can never enter the form-memory accumulators below.
    const audioLevel = sanitizeUnit(s.audioLevel);
    const spectrumBins = sanitizeBins(s.spectrumBins);

    if (ctx) {
      ctx.clearRect(0, 0, width, height);

      // H4 (gate OFF): advect + draw ambient motes behind the cell using the
      // PREVIOUS frame's flow source. Default path (enableFlowField false) does
      // nothing and allocates nothing, so the shipped look is byte-unchanged.
      if (params.enableFlowField && (params.flowMoteCount ?? 0) > 0) {
        if (!motes) motes = seedMotes(width, height, params);
        ctx.save();
        ctx.fillStyle = "rgba(255,255,255,0.18)";
        for (let i = 0; i < motes.length; i++) {
          motes[i] = advectMote(motes[i], flowCx, flowCy, flowHeading, flowSpeed, dt, width, height, params);
          ctx.beginPath();
          ctx.arc(motes[i].x, motes[i].y, 0.8, 0, TAU);
          ctx.fill();
        }
        ctx.restore();
      }

      // M6: EMA-chase the per-mode energy target so a mode flip (which changes
      // the cellEnergy formula) no longer steps discontinuously. Seed to the
      // raw target on the very first frame so there is no startup ramp.
      const energyTarget = cellEnergy(s.mode, audioLevel, t, params.idle, params.levelGain);
      if (energySmoothed < 0) energySmoothed = energyTarget;
      energySmoothed = sanitizeUnit(smoothEnergy(energySmoothed, energyTarget, dt, params));
      const energy = energySmoothed;

      // Biological growth (shared accumulator) + startle reflex.
      // M15: guard the persistent accumulators against a poisoned prior value
      // so they self-heal to a finite state on the next clean frame.
      growth = sanitizeUnit(growthLevel(sanitizeUnit(growth), audioLevel, s.mode, params.growthAttack, params.growthRelease));
      // G1: one master activity scalar drives swimming + beat (and later D/F4).
      // Gated: when enableActivity is off, `activity` is unused and motion falls
      // back to the legacy driftSpeed path (byte-identical to pre-8a).
      const activity = cellActivity(energy, growth, params);
      baseline = sanitizeFinite(baseline + (audioLevel - sanitizeFinite(baseline, 0)) * params.startleBaselineRate, 0);
      const prevStartle = startle;
      startle = sanitizeUnit(startleOffset(sanitizeUnit(startle), audioLevel, baseline, params.startleSensitivity, params.startleDecay));
      // H1/M8: startle is a low-Re ESCAPE DART (heading kick + speed burst on the
      // wander), not a positional centre shove. The legacy (sdx,sdy) offset is
      // only used when the kick is disabled (back-compat).
      const useKick = params.enableStartleKick !== false;
      let sdx = 0;
      let sdy = 0;
      if (!useKick) {
        const startleAngle = TAU * noise2D(900.5, t * 0.7);
        sdx = Math.cos(startleAngle) * startle * params.startleMaxPx;
        sdy = Math.sin(startleAngle) * startle * params.startleMaxPx;
      }

      // Idle morphing only when at rest: full at idle/silence, fades as the cell
      // becomes active. M9: drive the fade from the SMOOTHED activity scalar
      // (energy+growth EMA) via a smoothstep knee instead of a hard linear knee
      // on RAW audioLevel, so noisy audio around the threshold no longer makes
      // the idle morph flicker on/off. idle + active form a partition of unity:
      // idleFactor = (1 - smoothstep(activity)) so the two never both spike.
      const recordingFade = s.mode === "recording" ? 0.3 : 1;
      const idleFactor = (1 - smoothstep(activity / 0.33)) * recordingFade;

      // Build per-vertex target deformation fractions
      const targetDeform = buildTargetDeformation(
        width,
        height,
        spectrumBins,
        t,
        audioLevel,
        energy,
        params,
        idleFactor,
      );

      // Deformation pipeline steps 4–7: [saturate] -> integrate(EXISTING) ->
      // [smooth] -> [normalizeArea]. With all gates off this is byte-identical
      // to a bare integrateDeformation (the no-visible-change scaffold).
      // M15: if the prior integrated field was poisoned (a non-finite slipped in
      // on some earlier frame), drop it and re-seed from the (sanitised) target
      // so a single bad frame cannot stick in form-memory forever.
      const safePrev = deform && deform.every((v) => Number.isFinite(v)) ? deform : null;
      deform = integrateDeformPipeline(safePrev, targetDeform, params);
      // F13 (gate OFF): band-limit the membrane to low modes + low amplitude for
      // a smooth ciliate look. Identity when the gate is off (deform untouched).
      if (params.enableBandLimit) {
        deform = bandLimitDeform(deform, params);
      }

      // Drift activation ramp: cell stays centered at rest, drifts while recording.
      // setPointerCapture keeps the recording session even if the cell wanders
      // off the finger, so visual drift during recording is fine.
      drift01 = driftActivation(drift01, s.mode === "recording", params.driftActivationRate ?? 0.02, dt);

      // Hoisted cell centre + radius: includes drift blend, startle jolt (sdx,sdy) and growth swell.
      const baseR = resolveBaseRadius(width, height, params, growth);
      // Integrated wander (natural roaming that never gravitates to centre).
      if (!wander) {
        // M4: resume the persisted pose if present (no teleport to centre).
        wander = restoredPose
          ? { x: restoredPose.x, y: restoredPose.y, heading: restoredPose.heading, vx: 0, vy: 0, clock: 0 }
          : { x: width / 2, y: height / 2, heading: noise2D(7.1, 3.3) * TAU, vx: 0, vy: 0, clock: 0 };
      }
      // H1: apply the startle heading kick to the wander BEFORE integrating, so
      // the cell darts off in a new direction on a sharp onset.
      if (useKick) {
        const kick = startleHeadingKick(startle, prevStartle, t, params);
        if (kick !== 0) wander = { ...wander, heading: wander.heading + kick };
      }
      // G2: activity-driven swim speed (Stokes-linear, memoryless). When the
      // activity gate is off, pass undefined so wanderStep uses legacy driftSpeed.
      // H1: add the transient startle speed burst on top (fades with startle).
      const baseSwim = params.enableActivity ? swimSpeed(activity, width, height, params) : undefined;
      const burst = useKick ? startleBurstSpeed(startle, baseR, params) : 0;
      const swimPx = baseSwim !== undefined ? baseSwim + burst : burst > 0 ? burst : undefined;
      wander = wanderStep(wander, dt, width, height, baseR, params, swimPx);
      // Blend between rest center (width/2, height/2) and full-wander position
      const driftedX = width / 2 + (wander.x - width / 2) * drift01;
      const driftedY = height / 2 + (wander.y - height / 2) * drift01;
      const cx = driftedX + sdx;
      const cy = driftedY + sdy;
      const maxRadius = membraneMaxRadius(width, height);
      const floorRadius = baseR * 0.35;
      const sampleCount = deform.length;

      const smoothedPoints: Array<[number, number]> = [];
      for (let i = 0; i < sampleCount; i++) {
        const angle = (i / sampleCount) * TAU;
        const rawRadius = baseR * (1 + deform[i]);
        // Step 9: clamp radius LAST [floorRadius, maxRadius] (safety net).
        const radius = Math.max(floorRadius, Math.min(maxRadius, rawRadius));
        const x = cx + radius * Math.cos(angle);
        const y = cy + radius * Math.sin(angle);
        smoothedPoints.push([x, y]);
      }
      // D1: motion basis. Normalize the wander speed to [0,1] against the peak
      // swim speed so the prolate (D4) and (later 8c) cilia drag read a single
      // speedNorm. G4: chase the body heading toward the velocity heading.
      // speedNorm is the activity-driven swim speed normalized to its peak. Only
      // meaningful when activity drives the speed; with the activity gate off the
      // legacy constant driftSpeed would read as a permanent (non-motion) prolate,
      // so force speedNorm=0 there (D4 then stays identity, matching back-compat).
      const swimPeak = swimSpeed(1, width, height, params);
      const curSpeed = Math.hypot(wander.vx, wander.vy);
      const speedNorm = params.enableActivity && swimPeak > 0 ? Math.min(1, curSpeed / swimPeak) : 0;
      bodyHeading = bodyHeadingStep(bodyHeading, wander.vx, wander.vy, dt, params);
      // H4: record this frame's flow source for the NEXT frame's mote advection.
      flowCx = cx; flowCy = cy; flowHeading = bodyHeading; flowSpeed = curSpeed;
      // Step 8: D4 area-preserving affine squeeze on the contour POINTS in the
      // body-heading frame. k=prolateAspect(speedNorm) (round at rest -> identity
      // when still), phi=bodyHeading; det=1 keeps the C1 area. Gated by
      // enableAffine; identity (k=1) when off OR when speedNorm=0.
      const squeezeK = params.enableAffine ? prolateAspect(speedNorm, params) : 1;
      const squeezePhi = bodyHeading;
      const contourPoints = affineSqueezePoints(smoothedPoints, squeezeK, squeezePhi, cx, cy, params);

      // Smooth via Catmull-Rom (4 segments per span for smoothness)
      const splinePoints = catmullRom(contourPoints, 4);

      if (splinePoints.length >= 3) {
        // --- Cilia (under the membrane) ---
        // Multi-segment flagella with an asymmetric power/recovery beat and a
        // metachronal wave travelling round the crown (biologically motivated).
        {
          // G2: scale the beat clock + curl by activity so a louder voice beats
          // faster and curls more (Stokes-linear). Gated: identity when off.
          // E1 (gate OFF): drive the hair count from the perimeter so a bigger
          // cell grows proportionally more cilia at ~constant arc spacing. When
          // the gate is off this is identity (keeps params.ciliaCount).
          const effectiveCount = params.enablePerimeterCount
            ? perimeterCiliaCount(baseR, params)
            : params.ciliaCount;
          const ciliaParams = params.enableActivity
            ? {
                ...params,
                ciliaCount: effectiveCount,
                ciliaBeatHz: ciliaBeatHzEff(activity, params),
                ciliaCurl: params.ciliaCurl * (1 + 0.3 * activity),
              }
            : (params.enablePerimeterCount ? { ...params, ciliaCount: effectiveCount } : params);
          // D2: motion basis so the crown leans rearward while swimming. Tangent
          // is the body heading; speedNorm gates it (0 at rest => identity).
          const ciliaMotion: CiliaMotion = {
            tx: Math.cos(bodyHeading),
            ty: Math.sin(bodyHeading),
            speedNorm,
            // F4/G3: how coherently the crown rows toward the heading, gated by
            // activity (idle ~isotropic, active coherent). 0 when activity off.
            axisStrength: params.enableActivity ? strokeAxisStrength(activity, params) : 0,
          };
          const cilia = ciliaPath(cx, cy, baseR, t, energy, growth, ciliaParams, ciliaMotion);
          ctx.lineCap = "round";
          for (const hair of cilia) {
            ctx.lineWidth = hair.width; // per-hair thickness (diverse)
            ctx.strokeStyle = hsla(baseHue, 0.6, 0.6, 0.35 + 0.35 * energy);
            ctx.beginPath();
            ctx.moveTo(hair.points[0][0], hair.points[0][1]);
            // M12: smooth the spine with an OPEN (non-wrapping) Catmull-Rom so
            // the curve ends AT the tip. A closed catmullRom would wrap tip->base
            // and re-introduce a spurious tip bend, fighting F1's kappa(L)=0.
            const spline = catmullRomOpen(hair.points, 4);
            for (let i = 1; i < spline.length; i++) {
              ctx.lineTo(spline[i][0], spline[i][1]);
            }
            ctx.stroke();
          }
        }

        // --- Fill: translucent cytoplasm ---
        ctx.fillStyle = hsla(baseHue, 0.7, 0.55, params.fillAlpha);
        ctx.beginPath();
        ctx.moveTo(splinePoints[0][0], splinePoints[0][1]);
        for (let i = 1; i < splinePoints.length; i++) {
          ctx.lineTo(splinePoints[i][0], splinePoints[i][1]);
        }
        ctx.closePath();

        // Soft radial gradient fill — overlay lighter center
        const grad = ctx.createRadialGradient(
          cx, cy, 0,
          cx, cy, Math.max(1, baseR * 0.9),
        );
        grad.addColorStop(0, hsla(baseHue + 10, 0.5, 0.7, params.fillAlpha * 0.5));
        grad.addColorStop(1, hsla(baseHue, 0.7, 0.45, params.fillAlpha));
        ctx.fillStyle = grad;
        ctx.fill();

        // --- Nucleus: denser organelle drifting/pulsing inside the cell ---
        // F9: thread the LIVE minimum membrane radius so a deep inward pinch
        // cannot let the nucleus poke through the wall.
        let minMembraneR = Infinity;
        for (const dv of deform) minMembraneR = Math.min(minMembraneR, baseR * (1 + dv));
        const nucleus = nucleusTransform(t, audioLevel, baseR, params, minMembraneR);
        if (nucleus.r >= 2.5) {
          // M14: the nucleus rides the same body affine squeeze (k, phi) as the
          // membrane, so when the body becomes prolate (Commit 8/D4) the nucleus
          // stays inside on both axes. While enableAffine is off (k=1) this is a
          // no-op; the squeeze maps the CENTRE (the disk gains an elliptical
          // draw when D4 lands).
          const [nx, ny] = affineSqueezePoints(
            [[cx + nucleus.cx, cy + nucleus.cy]], squeezeK, squeezePhi, cx, cy, params,
          )[0];
          const nr = nucleus.r;

          // Soft radial gradient: denser warmer core → darker rim
          const nucGrad = ctx.createRadialGradient(nx, ny, 0, nx, ny, nr);
          // Hue shifted slightly warmer/darker vs the amber cytoplasm base
          nucGrad.addColorStop(0, hsla(baseHue - 5, 0.80, 0.48, params.nucleusAlpha));
          nucGrad.addColorStop(0.4, hsla(baseHue - 8, 0.75, 0.40, params.nucleusAlpha));
          nucGrad.addColorStop(1, hsla(baseHue - 10, 0.65, 0.30, params.nucleusAlpha * 0.7));

          ctx.fillStyle = nucGrad;
          ctx.beginPath();
          ctx.arc(nx, ny, nr, 0, TAU);
          ctx.fill();

          // Nucleolus — tiny brighter dot at the centre for organelle detail
          ctx.fillStyle = hsla(baseHue + 5, 0.55, 0.72, params.nucleusAlpha * 0.8);
          ctx.beginPath();
          ctx.arc(nx, ny, nr * 0.22, 0, TAU);
          ctx.fill();
        }

        // F11 (gate OFF): contractile vacuole — a peripheral vesicle that slowly
        // fills then rapidly collapses each vacuolePeriod. Drawn near the membrane
        // at a fixed bearing, scaled to stay inside the (possibly pinched) wall.
        // Skipped entirely (no allocation/draw) unless enableVacuole is on.
        if (params.enableVacuole) {
          const vac = contractileVacuole(t, baseR, params);
          if (vac.r >= 0.5) {
            // Place its centre toward a fixed bearing, then ride the same body
            // affine squeeze as the nucleus so it tracks a prolate body. Clamp the
            // placement radius so the WHOLE vesicle (centre + vac.r) stays inside
            // the live minimum membrane radius — a deep inward pinch can bring the
            // wall in to baseR*0.35, so without this the vesicle could poke out.
            const bearing = 2.3; // radians, an arbitrary but stable peripheral spot
            const placeR = Math.max(0, Math.min(baseR * 0.6, minMembraneR - vac.r));
            const vcx0 = cx + Math.cos(bearing) * placeR;
            const vcy0 = cy + Math.sin(bearing) * placeR;
            const [vx, vy] = affineSqueezePoints(
              [[vcx0, vcy0]], squeezeK, squeezePhi, cx, cy, params,
            )[0];
            ctx.fillStyle = hsla(baseHue + 20, 0.45, 0.70, params.nucleusAlpha * 0.45);
            ctx.beginPath();
            ctx.arc(vx, vy, vac.r, 0, TAU);
            ctx.fill();
          }
        }

        // --- Stroke: iridescent outline ---
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.strokeStyle = hsla(baseHue, 0.8, 0.6, 0.9);
        ctx.lineWidth = 1.8;
        ctx.stroke();

        // Second pass: segment-by-segment with iridescent hue
        // Split the spline into segments matching the original control-point count
        const segments = contourPoints.length;
        const pointsPerSegment = splinePoints.length / segments;

        for (let seg = 0; seg < segments; seg++) {
          const segStart = Math.floor(seg * pointsPerSegment);
          const segEnd = seg === segments - 1
            ? splinePoints.length
            : Math.floor((seg + 1) * pointsPerSegment);

          if (segEnd - segStart < 2) continue;

          // Midpoint angle for this segment's hue lookup
          const midPt = splinePoints[Math.floor((segStart + segEnd) / 2) % splinePoints.length];
          const midAngle = Math.atan2(midPt[1] - cy, midPt[0] - cx);
          const hue = iridescentHue(midAngle, t, audioLevel, baseHue, params);

          ctx.strokeStyle = hsla(hue, 0.85, 0.6, 0.85);
          ctx.lineWidth = 2.0;
          ctx.beginPath();
          ctx.moveTo(splinePoints[segStart][0], splinePoints[segStart][1]);
          for (let i = segStart + 1; i < segEnd; i++) {
            ctx.lineTo(splinePoints[i][0], splinePoints[i][1]);
          }
          ctx.stroke();
        }
      }
    }

    // Persist state every 500ms for continuity across restarts
    const now = performance.now();
    if (now - lastPersist > 500 && typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(PERSIST_KEY, serializeCellState({
          driftPhase: t + driftPhaseOffset,
          growth,
          elapsed: t,
          // M4/M5: store the wander pose as a fraction of the tank (resize-safe).
          ...(wander
            ? { fx: wander.x / width, fy: wander.y / height, heading: wander.heading }
            : {}),
        }));
        lastPersist = now;
      } catch {
        // Silently ignore storage errors
      }
    }

    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);

  return {
    update(state: ThemeState): void {
      latestState = state;
    },
    destroy(): void {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      container.innerHTML = "";
    },
  };
}
