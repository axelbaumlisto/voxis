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
} from "./shared";

// Backward-compat re-exports: existing imports of these from "./cell" keep working.
export { noise2D, fbm, catmullRom, lowpassRadii, integrateDeformation, TAU } from "./shared";



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
};


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
    // Bell-shaped lobe: cos(delta)^sharpness, clamped to positive
    const lobe = Math.pow(Math.max(0, Math.cos(delta)), params.sharpness);
    // Amplitude grows with audio level and energy; idle gives tiny twitches
    const audioDrive = params.idle + audioLevel * params.levelGain;
    const amp = params.push * audioDrive * energy;
    total += lobe * amp;
  }

  return total;
}

export interface Cilium { x1: number; y1: number; x2: number; y2: number; }

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
    out.push({ x1, y1, x2, y2 });
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

    // Spectrum bin under this angle modulates local radius slightly
    const normalized = ((angle % TAU) + TAU) % TAU / TAU;
    const binIdx = bins.length === 0 ? 0 : Math.min(Math.floor(normalized * bins.length), bins.length - 1);
    const binLevel = bins.length === 0 ? 0 : bins[binIdx];

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

    // Spectrum bin under this angle modulates local radius slightly
    const normalized = ((angle % TAU) + TAU) % TAU / TAU;
    const binIdx = bins.length === 0 ? 0 : Math.min(Math.floor(normalized * bins.length), bins.length - 1);
    const binLevel = bins.length === 0 ? 0 : bins[binIdx];

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
  // Cilia at max growth and energy: lenPx = baseR*(ciliaLen + growth*boost)*(0.7+energy*0.6)
  // worst case growth=1, energy=1 → factor = (ciliaLen + boost) * 1.3
  const ciliaOuter = baseR + baseR * (ciliaLength + ciliaGrowthBoost) * 1.3;

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
    const t = (performance.now() - startedAt) / 1000;
    const s = latestState;

    if (ctx) {
      ctx.clearRect(0, 0, width, height);

      const energy = cellEnergy(s.mode, s.audioLevel, t, params.idle, params.levelGain);

      // Biological growth (shared accumulator) + startle reflex.
      growth = growthLevel(growth, s.audioLevel, s.mode, params.growthAttack, params.growthRelease);
      baseline = baseline + (s.audioLevel - baseline) * params.startleBaselineRate;
      startle = startleOffset(startle, s.audioLevel, baseline, params.startleSensitivity, params.startleDecay);
      // Startle direction: a noise-chosen angle that drifts slowly.
      const startleAngle = TAU * noise2D(900.5, t * 0.7);
      const sdx = Math.cos(startleAngle) * startle * params.startleMaxPx;
      const sdy = Math.sin(startleAngle) * startle * params.startleMaxPx;

      // Idle morphing only when at rest: full at idle/silence, fades as audio rises
      // or while actively recording, so it never fights speech-driven deformation.
      const recordingFade = s.mode === "recording" ? 0.3 : 1;
      const idleFactor = Math.max(0, 1 - s.audioLevel * 3) * recordingFade;

      // Build per-vertex target deformation fractions
      const targetDeform = buildTargetDeformation(
        width,
        height,
        s.spectrumBins,
        t,
        s.audioLevel,
        energy,
        params,
        idleFactor,
      );

      // Integrate with form memory: fast attack, slow release
      deform = deform
        ? integrateDeformation(deform, targetDeform, params.attack, params.release)
        : targetDeform.slice();

      // Drift activation ramp: cell stays centered at rest, drifts while recording.
      // setPointerCapture keeps the recording session even if the cell wanders
      // off the finger, so visual drift during recording is fine.
      drift01 = driftActivation(drift01, s.mode === "recording", params.driftActivationRate ?? 0.02);

      // Hoisted cell centre + radius: includes drift blend, startle jolt (sdx,sdy) and growth swell.
      const baseR = resolveBaseRadius(width, height, params, growth);
      const drift = cellDrift(t + driftPhaseOffset, width, height, baseR, params);
      // Blend between rest center (width/2, height/2) and full-drift position
      const driftedX = width / 2 + (drift.cx - width / 2) * drift01;
      const driftedY = height / 2 + (drift.cy - height / 2) * drift01;
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
        {
          const cilia = ciliaEndpoints(cx, cy, baseR, t, energy, growth, params);
          ctx.lineCap = "round";
          ctx.lineWidth = 1;
          for (const c of cilia) {
            ctx.strokeStyle = hsla(baseHue, 0.6, 0.6, 0.35 + 0.35 * energy);
            ctx.beginPath();
            ctx.moveTo(c.x1, c.y1);
            ctx.lineTo(c.x2, c.y2);
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
        const nucleus = nucleusTransform(t, s.audioLevel, baseR, params);
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
          const hue = iridescentHue(midAngle, t, s.audioLevel, baseHue, params);

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
