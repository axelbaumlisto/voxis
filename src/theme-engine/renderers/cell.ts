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
  noise2D, fbm, catmullRom, integrateDeformation, hsla, TAU, growthLevel,
  lerp, smoothstep,
} from "./shared";

// Backward-compat re-exports: existing imports of these from "./cell" keep working.
export { noise2D, fbm, catmullRom, lowpassRadii, integrateDeformation, TAU, smoothstep } from "./shared";



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
   * baseR. The nucleus wanders slowly via deterministic 2D noise. */
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
  /** Beat frequency in Hz (cycles/sec) of a single cilium. ~0.6–1.2 reads as
   * lively but not buzzing at overlay scale. */
  ciliaBeatHz?: number;
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
  /** Startle max displacement in px. */
  startleMaxPx: number;
  /** Baseline tracking rate for startle edge detection. */
  startleBaselineRate: number;
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
  ciliaAsymmetry: 0.6,
  ciliaMetachronal: 0.8,
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
  idleMorphAmplitude: 0.18,
  idleMorphSpeed: 0.25,
  idleMorphPeriod: 7,
  idleMorphFloor: 0.25,
  driftActivationRate: 0.02,
  wanderTurnRate: 1.1,
  wanderFreq: 0.6,
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
): CiliumPath[] {
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
    const pxn = -uy; // perpendicular unit
    const pyn = ux;

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
    const phase = ciliaBeatPhase(t + r01 * 0.6, k, params);
    // F3: smooth the recovery envelope instead of a hard {0.35,1} step at
    // phase=0.5. smoothstep((phase-0.35)/0.3) ramps 0->1 over phase in
    // [0.35,0.65], Lipschitz and C1, so the bend amplitude no longer jumps.
    const recovery = smoothstep((phase - 0.35) / 0.3);
    const beat = Math.sin(phase * TAU); // overall sway sign/strength [-1,1]

    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= seg; i++) {
      const sFrac = i / seg; // 0 at base, 1 at tip
      const along = baseR + lenK * sFrac;
      // travelling bend wave (base->tip): the hump moves outward over time
      const wave = Math.sin(TAU * (waves * sFrac - phase));
      // amplitude: anchored at base (taper), grows to tip, stronger during
      // recovery, scaled by curl and this hair's length.
      const amp = curl * lenK * 0.6 * Math.pow(sFrac, 1.2) * (0.4 + 0.6 * recovery);
      const rawBend = (wave * 0.7 + beat * 0.3) * amp;
      // F2: cap the transverse offset so a hair's angular sweep at radius `along`
      // stays under half the angular gap to its neighbour. The transverse offset
      // `bend` subtends angle ~bend/along; capping |bend| <= 0.5*gap*along keeps
      // that under half a gap, so beating hairs never cross / reorder.
      const bendCap = 0.5 * gap * along;
      const bend = Math.max(-bendCap, Math.min(bendCap, rawBend));
      const x = cx + ux * along + pxn * bend;
      const y = cy + uy * along + pyn * bend;
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
    // Floor prevents pinching to a dot; ceiling respects window height.
    const maxRadius = height * 0.46;
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
 * The offset is clamped so the organelle always stays well inside the
 * membrane wall (within `baseR * 0.55` from center).
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
): { cx: number; cy: number; r: number } {
  // --- Drift: slow noise-driven offset inside the cell ---
  const rawCx = baseR * params.nucleusWander * noise2D(137, t * params.nucleusDrift);
  const rawCy = baseR * params.nucleusWander * noise2D(241, t * params.nucleusDrift);

  // --- Radius: base size + audio-driven pulse + idle breathing ---
  const idleBreath = Math.sin(t * 1.3) * params.nucleusPulse * 0.25;
  let r = baseR * (params.nucleusRadius + audioLevel * params.nucleusPulse + idleBreath);

  // Enforce a minimum pixel radius so the nucleus is never sub-pixel.
  const MIN_PX_RADIUS = 2.5;
  r = Math.max(MIN_PX_RADIUS, r);

  // --- Safety clamp: nucleus must stay well inside the membrane ---
  // The floor of the membrane contour is baseR * 0.35, but we use a more
  // conservative inner-safe radius of baseR * 0.55 so the nucleus is
  // always clearly separated from the wall.
  const safeInner = baseR * 0.55;
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
    return { driftPhase: obj.driftPhase, growth: obj.growth, elapsed: obj.elapsed };
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

// ---------------------------------------------------------------------------
// Base radius resolution (absolute + growth swell)
// ---------------------------------------------------------------------------

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
): number {
  const target = recording ? 1 : 0;
  const raw = prev + (target - prev) * rate;
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

export function wanderStep(
  s: WanderState,
  dt: number,
  width: number,
  height: number,
  baseR: number,
  params: CellParams,
): WanderState {
  const reach = cellReach(baseR, params);
  const inset = Math.max(params.driftMargin ?? 4, reach);
  const minX = inset, maxX = width - inset;
  const minY = inset, maxY = height - inset;

  // Degenerate tank (organism doesn't fit): pin to centre.
  if (maxX <= minX || maxY <= minY) {
    return { x: width / 2, y: height / 2, heading: s.heading, vx: 0, vy: 0, clock: (s.clock ?? 0) + dt };
  }

  // Speed in px/sec. driftSpeed historically was a noise-phase rate (~0.03);
  // reinterpret as a gentle linear speed scaled to the tank so motion reads
  // the same regardless of window size.
  const speed = (params.driftSpeed ?? 0.03) * Math.min(width, height) * 1.2;

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

  // Integrate position.
  let vx = Math.cos(heading) * speed;
  let vy = Math.sin(heading) * speed;
  let x = s.x + vx * dt;
  let y = s.y + vy * dt;

  // --- Wall bounce: reflect heading off the wall normal, clamp inside. ---
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
  // Recompute velocity after any reflection so callers see the true heading.
  vx = Math.cos(heading) * speed;
  vy = Math.sin(heading) * speed;

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
  let startle = 0;
  let baseline = 0; // slow-tracking audio baseline for startle edge detection
  let drift01 = 0; // smoothed drift activation (0=centered, 1=full drift)

  // Reynolds-style integrated wander state (replaces position=noise(t), which
  // oscillated about the centre and kept "returning"). Lazily initialised at
  // the tank centre on the first tick (width/height are stable per renderer).
  let wander: WanderState | null = null;
  let lastTickMs = performance.now();

  // Persistence: restore state from localStorage for continuity across restarts
  const PERSIST_KEY = "talri.cell.state.v1";
  let driftPhaseOffset = 0;
  let lastPersist = 0;
  let startedAt = performance.now();

  if (typeof localStorage !== "undefined") {
    try {
      const saved = parseCellState(localStorage.getItem(PERSIST_KEY));
      if (saved) {
        growth = saved.growth;
        const seed = restoreSeed(saved, performance.now());
        startedAt = seed.startedAt;
        driftPhaseOffset = seed.driftPhaseOffset;
      }
    } catch {
      // Silently ignore localStorage errors
    }
  }

  let rafId: number | null = null;

  const tick = () => {
    const nowMs = performance.now();
    const t = (nowMs - startedAt) / 1000;
    // Real frame delta (clamped) so wander speed is frame-rate independent
    // and a backgrounded tab resuming doesn't teleport the cell.
    const dt = Math.min(0.05, Math.max(0.001, (nowMs - lastTickMs) / 1000));
    lastTickMs = nowMs;
    const s = latestState;

    // M15: sanitise external frame state so a NaN/Inf audioLevel or bad spectrum
    // bin can never enter the form-memory accumulators below.
    const audioLevel = sanitizeUnit(s.audioLevel);
    const spectrumBins = sanitizeBins(s.spectrumBins);

    if (ctx) {
      ctx.clearRect(0, 0, width, height);

      const energy = cellEnergy(s.mode, audioLevel, t, params.idle, params.levelGain);

      // Biological growth (shared accumulator) + startle reflex.
      // M15: guard the persistent accumulators against a poisoned prior value
      // so they self-heal to a finite state on the next clean frame.
      growth = sanitizeUnit(growthLevel(sanitizeUnit(growth), audioLevel, s.mode, params.growthAttack, params.growthRelease));
      baseline = sanitizeFinite(baseline + (audioLevel - sanitizeFinite(baseline, 0)) * params.startleBaselineRate, 0);
      startle = sanitizeUnit(startleOffset(sanitizeUnit(startle), audioLevel, baseline, params.startleSensitivity, params.startleDecay));
      // Startle direction: a noise-chosen angle that drifts slowly.
      const startleAngle = TAU * noise2D(900.5, t * 0.7);
      const sdx = Math.cos(startleAngle) * startle * params.startleMaxPx;
      const sdy = Math.sin(startleAngle) * startle * params.startleMaxPx;

      // Idle morphing only when at rest: full at idle/silence, fades as audio rises
      // or while actively recording, so it never fights speech-driven deformation.
      const recordingFade = s.mode === "recording" ? 0.3 : 1;
      const idleFactor = Math.max(0, 1 - audioLevel * 3) * recordingFade;

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

      // Integrate with form memory: fast attack, slow release.
      // M15: if the prior integrated field was poisoned (a non-finite slipped in
      // on some earlier frame), drop it and re-seed from the (sanitised) target
      // so a single bad frame cannot stick in form-memory forever.
      const safePrev = deform && deform.every((v) => Number.isFinite(v)) ? deform : null;
      deform = safePrev
        ? integrateDeformation(safePrev, targetDeform, params.attack, params.release)
        : targetDeform.slice();

      // Drift activation ramp: cell stays centered at rest, drifts while recording.
      // setPointerCapture keeps the recording session even if the cell wanders
      // off the finger, so visual drift during recording is fine.
      drift01 = driftActivation(drift01, s.mode === "recording", params.driftActivationRate ?? 0.02);

      // Hoisted cell centre + radius: includes drift blend, startle jolt (sdx,sdy) and growth swell.
      const baseR = resolveBaseRadius(width, height, params, growth);
      // Integrated wander (natural roaming that never gravitates to centre).
      if (!wander) {
        wander = { x: width / 2, y: height / 2, heading: noise2D(7.1, 3.3) * TAU, vx: 0, vy: 0, clock: 0 };
      }
      wander = wanderStep(wander, dt, width, height, baseR, params);
      // Blend between rest center (width/2, height/2) and full-wander position
      const driftedX = width / 2 + (wander.x - width / 2) * drift01;
      const driftedY = height / 2 + (wander.y - height / 2) * drift01;
      const cx = driftedX + sdx;
      const cy = driftedY + sdy;
      const maxRadius = height * 0.46;
      const floorRadius = baseR * 0.35;
      const sampleCount = deform.length;

      const smoothedPoints: Array<[number, number]> = [];
      for (let i = 0; i < sampleCount; i++) {
        const angle = (i / sampleCount) * TAU;
        const rawRadius = baseR * (1 + deform[i]);
        const radius = Math.max(floorRadius, Math.min(maxRadius, rawRadius));
        const x = cx + radius * Math.cos(angle);
        const y = cy + radius * Math.sin(angle);
        smoothedPoints.push([x, y]);
      }

      // Smooth via Catmull-Rom (4 segments per span for smoothness)
      const splinePoints = catmullRom(smoothedPoints, 4);

      if (splinePoints.length >= 3) {
        // --- Cilia (under the membrane) ---
        // Multi-segment flagella with an asymmetric power/recovery beat and a
        // metachronal wave travelling round the crown (biologically motivated).
        {
          const cilia = ciliaPath(cx, cy, baseR, t, energy, growth, params);
          ctx.lineCap = "round";
          for (const hair of cilia) {
            ctx.lineWidth = hair.width; // per-hair thickness (diverse)
            ctx.strokeStyle = hsla(baseHue, 0.6, 0.6, 0.35 + 0.35 * energy);
            ctx.beginPath();
            ctx.moveTo(hair.points[0][0], hair.points[0][1]);
            // Smooth the spine with a Catmull-Rom through the segment points.
            const spline = catmullRom(hair.points, 4);
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
        const nucleus = nucleusTransform(t, audioLevel, baseR, params);
        if (nucleus.r >= 2.5) {
          const nx = cx + nucleus.cx;
          const ny = cy + nucleus.cy;
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

        // --- Stroke: iridescent outline ---
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.strokeStyle = hsla(baseHue, 0.8, 0.6, 0.9);
        ctx.lineWidth = 1.8;
        ctx.stroke();

        // Second pass: segment-by-segment with iridescent hue
        // Split the spline into segments matching the original control-point count
        const segments = smoothedPoints.length;
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
