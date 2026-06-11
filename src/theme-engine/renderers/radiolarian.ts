/**
 * radiolarian.ts — luminous glass-skeleton marine microorganism renderer.
 *
 * A radial, N-fold symmetric silica "test": a stiff bumpy shell, a lattice
 * of hexagonal-ish pores, and radial spikes that extend with voice. Built on
 * the shared math primitives (noise/fbm/spline) — SRP: only radiolarian
 * geometry + drawing live here.
 */
import { fbm, TAU } from "./shared";
import type { ThemeMode } from "../contract";

export interface RadiolarianParams {
  /** Rotational symmetry order (number of spikes / lattice repeats). */
  symmetry: number;
  /** Base shell radius as fraction of min(width,height). */
  radiusFraction: number;
  /** FBM octaves for the (stiff) shell bumpiness. */
  octaves: number;
  /** FBM frequency multiplier per octave. */
  lacunarity: number;
  /** FBM amplitude multiplier per octave. */
  gain: number;
  /** Shell bump amplitude (small — the test is rigid glass). */
  shellAmplitude: number;
  /** Time scale for slow shell shimmer. */
  timeScale: number;
  /** Idle breathing floor (alive during silence). */
  idle: number;
  /** Audio level → energy gain during recording. */
  levelGain: number;
  /** Spike resting length as fraction of baseR (beyond the shell). */
  spikeLength: number;
  /** Audio-driven extra spike extension as fraction of baseR. */
  spikePulse: number;
  /** Number of concentric pore rings inside the shell. */
  poreRings: number;
  /** Pore dot radius in pixels (min-clamped for visibility). */
  poreRadius: number;
  /** Global rotation speed (radians/sec) — slow drift of the whole test. */
  spinSpeed: number;
}

export const RADIOLARIAN_DEFAULTS: RadiolarianParams = {
  symmetry: 6,
  radiusFraction: 0.34,
  octaves: 2,
  lacunarity: 2.0,
  gain: 0.5,
  shellAmplitude: 0.12,
  timeScale: 0.25,
  idle: 0.12,
  levelGain: 0.8,
  spikeLength: 0.5,
  spikePulse: 0.45,
  poreRings: 2,
  poreRadius: 1.2,
  spinSpeed: 0.15,
};

/** Energy: idle breathing blended with audio activity, clamped to [0,1]. */
export function radiolarianEnergy(
  mode: ThemeMode,
  audioLevel: number,
  t: number,
  params: RadiolarianParams,
): number {
  switch (mode) {
    case "idle":
      return params.idle * (1 + Math.sin(t * 0.9) * 0.25);
    case "recording":
      return Math.max(0, Math.min(1, params.idle + audioLevel * params.levelGain));
    case "transcribing":
      return Math.max(0, Math.min(1, params.idle * 0.7 + audioLevel * 0.15));
    default:
      return params.idle;
  }
}

/**
 * Shell radius fraction at a given angle. N-fold symmetric: FBM is sampled on
 * an angle wrapped into a single symmetry wedge, so r repeats every 2π/symmetry.
 * Returns a multiplier around 1.0 (baseR * shellRadius = pixels).
 */
export function shellRadius(
  angle: number,
  t: number,
  energy: number,
  params: RadiolarianParams,
): number {
  const wedge = TAU / params.symmetry;
  // Fold angle into [0, wedge) then to a symmetric triangle for seamless wrap.
  const folded = ((angle % wedge) + wedge) % wedge;
  const sym = Math.abs(folded / wedge - 0.5) * 2; // 0..1..0 triangle, period = wedge
  const n = fbm(sym * 3.0, t * params.timeScale, params.octaves, params.lacunarity, params.gain);
  const breathe = 1 + energy * 0.18;
  return (1 + n * params.shellAmplitude) * breathe;
}

export interface Spike { x1: number; y1: number; x2: number; y2: number; }

/**
 * Radial spikes from the shell outward, one per symmetry vertex. Inner point
 * sits on the shell; outer point extends by spikeLength + audio*spikePulse.
 * `spin` (t*spinSpeed) rotates the whole crown slowly.
 */
export function spikeEndpoints(
  cx: number, cy: number, baseR: number,
  t: number, audioLevel: number, params: RadiolarianParams,
): Spike[] {
  const out: Spike[] = [];
  const spin = t * params.spinSpeed;
  const ext = baseR * (params.spikeLength + audioLevel * params.spikePulse);
  for (let k = 0; k < params.symmetry; k++) {
    const a = spin + (k / params.symmetry) * TAU;
    const sr = baseR * shellRadius(a, t, params.idle, params);
    const x1 = cx + sr * Math.cos(a);
    const y1 = cy + sr * Math.sin(a);
    const x2 = cx + (sr + ext) * Math.cos(a);
    const y2 = cy + (sr + ext) * Math.sin(a);
    out.push({ x1, y1, x2, y2 });
  }
  return out;
}

export interface Pore { x: number; y: number; r: number; }

/**
 * Concentric rings of pore dots on a symmetric angular grid. Each ring i sits
 * at radius baseR*(0.35 + 0.5*i/poreRings); dots per ring scale with symmetry.
 */
export function poreLattice(
  cx: number, cy: number, baseR: number,
  t: number, params: RadiolarianParams,
): Pore[] {
  const out: Pore[] = [];
  const spin = t * params.spinSpeed * 0.5;
  const r = Math.max(0.6, params.poreRadius);
  for (let ring = 0; ring < params.poreRings; ring++) {
    const rr = baseR * (0.35 + 0.5 * (ring / Math.max(1, params.poreRings)));
    const count = params.symmetry * (ring + 1);
    const offset = ring % 2 === 0 ? 0 : (TAU / count) * 0.5; // brick-stagger
    for (let j = 0; j < count; j++) {
      const a = spin + offset + (j / count) * TAU;
      out.push({ x: cx + rr * Math.cos(a), y: cy + rr * Math.sin(a), r });
    }
  }
  return out;
}
