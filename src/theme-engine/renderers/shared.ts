/**
 * shared.ts — organism-agnostic pure math for canvas overlay renderers.
 *
 * SRP: deterministic numeric kernels only (noise, fbm, spline, temporal
 * integration, color). No DOM, no canvas, no organism-specific geometry.
 * DRY: consumed by cell.ts (amoeba) and radiolarian.ts (glass shell) alike.
 */

import type { ThemeMode } from "../contract";

// ---------------------------------------------------------------------------
// Noise tables — deterministic, self-contained
// ---------------------------------------------------------------------------

/**
 * Classic permutation table (256 entries). Derived from a fixed shuffle of
 * [0..255]. Deterministic, so noise values are reproducible in tests.
 */
const PERM: number[] = [
  151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225,
  140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148,
  247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32,
  57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175,
  74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122,
  60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54,
  65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169,
  200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64,
  52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212,
  207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213,
  119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9,
  129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104,
  218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241,
  81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157,
  184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93,
  222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180,
];

/** Padded double-length table for wrapping. */
const PERM2 = [...PERM, ...PERM];

// ---------------------------------------------------------------------------
// Interpolation helpers
// ---------------------------------------------------------------------------

/** Smoothstep interpolation (3t² − 2t³), clamped. */
export function smoothstep(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
}

/** Linear interpolation between a and b by t in [0,1]. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ---------------------------------------------------------------------------
// Noise & FBM
// ---------------------------------------------------------------------------

/**
 * Deterministic 2D value-noise.
 *
 * Range: roughly [−1, 1] (four-corner lattice of raw values mapped from
 * 0..255 to −1..1, then blended).
 * Deterministic: same (x,y) always produces the same value.
 */
export function noise2D(x: number, y: number): number {
  const xi = Math.floor(x) & 255;
  const yi = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);

  const sx = smoothstep(xf);
  const sy = smoothstep(yf);

  const v00 = PERM2[PERM2[xi] + yi];
  const v10 = PERM2[PERM2[xi + 1] + yi];
  const v01 = PERM2[PERM2[xi] + yi + 1];
  const v11 = PERM2[PERM2[xi + 1] + yi + 1];

  const nx0 = lerp(v00 / 255, v10 / 255, sx);
  const nx1 = lerp(v01 / 255, v11 / 255, sx);
  const val = lerp(nx0, nx1, sy);

  // Map [0, 1] → [−1, 1]
  return val * 2 - 1;
}

/**
 * Fractional Brownian Motion — sums multiple octaves of noise2D.
 *
 * @param octaves   Number of octaves (≥1).
 * @param lacunarity Frequency multiplier per octave (e.g. 2.0).
 * @param gain       Amplitude multiplier per octave (e.g. 0.5).
 * @returns Roughly [−1, 1] after normalization.
 */
export function fbm(
  x: number,
  y: number,
  octaves: number,
  lacunarity: number,
  gain: number,
): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0; // for normalization

  for (let i = 0; i < octaves; i++) {
    value += noise2D(x * frequency, y * frequency) * amplitude;
    maxValue += amplitude;
    frequency *= lacunarity;
    amplitude *= gain;
  }

  return value / maxValue;
}

// ---------------------------------------------------------------------------
// Spline
// ---------------------------------------------------------------------------

/**
 * Closed Catmull-Rom spline interpolation through N control points.
 *
 * Produces `segmentsPerSpan * N` output points. Since the spline is closed,
 * the first point is also appended at the end for matching behaviour.
 *
 * @param points          Control points (N ≥ 2).
 * @param segmentsPerSpan Number of interpolated segments between each pair.
 * @returns Interpolated points array of length segmentsPerSpan * N.
 */
export function catmullRom(
  points: Array<[number, number]>,
  segmentsPerSpan: number,
): Array<[number, number]> {
  const n = points.length;
  if (n < 2) return [...points];

  const result: Array<[number, number]> = [];

  // Evaluate Catmull-Rom segment between p1 and p2, with control points p0 and p3
  const segment = (
    p0: [number, number],
    p1: [number, number],
    p2: [number, number],
    p3: [number, number],
    steps: number,
  ): void => {
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const t2 = t * t;
      const t3 = t2 * t;

      const x =
        0.5 *
        (2 * p1[0] +
          (-p0[0] + p2[0]) * t +
          (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
          (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);

      const y =
        0.5 *
        (2 * p1[1] +
          (-p0[1] + p2[1]) * t +
          (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
          (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);

      result.push([x, y]);
    }
  };

  // For closed spline, wrap indices
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    segment(p0, p1, p2, p3, segmentsPerSpan);
  }

  return result;
}

/**
 * OPEN (non-wrapping) Catmull-Rom spline for an OPEN polyline such as a cilium
 * spine. Unlike {@link catmullRom} (which wraps tip->base for a closed contour),
 * the endpoints are CLAMPED by duplicating the first/last control points, so the
 * curve starts exactly at the first point and ENDS exactly at the last point
 * without curving back toward the other end.
 *
 * This matters for the cilia: a cilium is a clamped-base / free-tip elastic rod
 * whose curvature vanishes at the tip (kappa(L)=0). A closed spline would force a
 * spurious bend at the tip by interpolating back toward the base.
 *
 * @returns Sampled points; first sample == points[0], last sample == points[n-1].
 */
export function catmullRomOpen(
  points: Array<[number, number]>,
  segmentsPerSpan: number,
): Array<[number, number]> {
  const n = points.length;
  if (n < 2) return [...points];

  const result: Array<[number, number]> = [];

  const segment = (
    p0: [number, number],
    p1: [number, number],
    p2: [number, number],
    p3: [number, number],
    steps: number,
  ): void => {
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const t2 = t * t;
      const t3 = t2 * t;

      const x =
        0.5 *
        (2 * p1[0] +
          (-p0[0] + p2[0]) * t +
          (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
          (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);

      const y =
        0.5 *
        (2 * p1[1] +
          (-p0[1] + p2[1]) * t +
          (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
          (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);

      result.push([x, y]);
    }
  };

  // CLAMPED ends: reflect/duplicate the first and last points instead of
  // wrapping to the opposite end, so the curve does not close the loop.
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i - 1 < 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 > n - 1 ? n - 1 : i + 2];
    segment(p0, p1, p2, p3, segmentsPerSpan);
  }
  // Append the exact final point (the loops above stop before t=1 of the last
  // span), so the open curve terminates AT points[n-1].
  result.push([points[n - 1][0], points[n - 1][1]]);

  return result;
}

// ---------------------------------------------------------------------------
// Temporal smoothing & integration
// ---------------------------------------------------------------------------

/**
 * Temporal lowpass between two radius arrays.
 *
 * Each element blends toward `next[i]` by factor `(1 - tension)`.
 * Tension 0 = instant jump to next; tension 1 = fully frozen on prev.
 *
 * @returns New array of same length as prev and next.
 */
export function lowpassRadii(
  prev: number[],
  next: number[],
  tension: number,
): number[] {
  const t = Math.max(0, Math.min(1, tension));
  return prev.map((p, i) => lerp(p, next[i], 1 - t));
}

/**
 * Asymmetric temporal integration of per-vertex deformation.
 *
 * For each vertex i:
 * - If |target[i]| >= |prev[i]| (shape being pushed further), blend at `attack` rate (fast).
 * - Otherwise (shape relaxing toward a smaller or zero target), blend at `release` rate (slow).
 *
 * This implements form memory: new sculpted bumps are acquired quickly but
 * persist and relax slowly, so the membrane "holds" its shape instead of
 * springing back instantly when audio drops.
 *
 * Both rates are clamped to [0, 1].
 *
 * @param prevDeform   Previous frame's integrated deformation (length N).
 * @param targetDeform  Current frame's target deformation (length N).
 * @param attack        Per-frame blend factor for growing deformation [0, 1].
 * @param release       Per-frame blend factor for shrinking deformation [0, 1].
 * @returns New integrated deformation array of length N.
 */
export function integrateDeformation(
  prevDeform: number[],
  targetDeform: number[],
  attack: number,
  release: number,
): number[] {
  const a = Math.max(0, Math.min(1, attack));
  const r = Math.max(0, Math.min(1, release));
  const n = prevDeform.length;
  const result = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const prev = prevDeform[i];
    const tgt = targetDeform[i];
    const rate = Math.abs(tgt) >= Math.abs(prev) ? a : r;
    result[i] = prev + (tgt - prev) * rate;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Color helper
// ---------------------------------------------------------------------------

/** Convert HSL to CSS hsla string. */
export function hsla(h: number, s: number, l: number, a: number): string {
  return `hsla(${h},${Math.round(s * 100)}%,${Math.round(l * 100)}%,${a})`;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Biological growth accumulator
// ---------------------------------------------------------------------------

/**
 * Asymmetric growth accumulator: rises toward `audioLevel` during recording
 * at `attack` (fast), relaxes toward 0 otherwise at `release` (slow). Clamped
 * to [0,1]. Organism-agnostic — used by both cell and radiolarian.
 */
export function growthLevel(
  prevGrowth: number,
  audioLevel: number,
  mode: ThemeMode,
  attack: number,
  release: number,
): number {
  const target = mode === "recording" ? Math.max(0, Math.min(1, audioLevel)) : 0;
  const rate = target >= prevGrowth ? attack : release;
  const raw = prevGrowth + (target - prevGrowth) * rate;
  return Math.max(0, Math.min(1, raw));
}
