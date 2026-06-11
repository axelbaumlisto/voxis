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

// ---------------------------------------------------------------------------
// Noise tables & helpers — deterministic, self-contained
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

/** Smoothstep interpolation (3t² − 2t³), clamped. */
function smoothstep(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
}

/** Linear interpolation between a and b by t in [0,1]. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ---------------------------------------------------------------------------
// Pure exported functions
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
  /** Lowpass tension for temporal smoothing of radii (0=no smoothing, 1=full). */
  tension: number;
  /** Base cell radius as fraction of min(width, height). */
  radiusFraction: number;
}

/** Sensible defaults — lively amber cell with visible pseudopods + iridescence. */
export const CELL_DEFAULTS: CellParams = {
  noiseScale: 0.9,
  octaves: 4,
  lacunarity: 2.3,
  gain: 0.55,
  timeScale: 0.3,
  push: 18,
  sharpness: 4,
  intentDrift: 0.08,
  idle: 0.06,
  levelGain: 0.7,
  hueSpread: 40,
  shimmerSpeed: 0.5,
  hueBoost: 15,
  fillAlpha: 0.18,
  tension: 0.15,
  radiusFraction: 0.34,
};

const TAU = Math.PI * 2;

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

  // Energy scaling: idle gives subtle breathing, recording gives full deformation
  const amplitude = Math.max(params.idle, energy);
  return 1.0 + noiseVal * 0.28 * amplitude;
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
    // Amplitude grows with energy and audio level
    const amp = params.push * (params.idle + audioLevel * params.levelGain) * (energy / Math.max(0.01, params.idle + 0.01));
    total += lobe * amp;
  }

  return total;
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
  const baseR = Math.min(width, height) * params.radiusFraction;

  const out: Array<[number, number]> = [];
  for (let i = 0; i < sampleCount; i++) {
    const angle = (i / sampleCount) * TAU;

    // Spectrum bin under this angle modulates local radius slightly
    const normalized = ((angle % TAU) + TAU) % TAU / TAU;
    const binIdx = bins.length === 0 ? 0 : Math.min(Math.floor(normalized * bins.length), bins.length - 1);
    const binLevel = bins.length === 0 ? 0 : bins[binIdx];

    const rFbm = cellRadius(angle, t, energy, params);
    const rPseudo = pseudopodOffset(angle, t, audioLevel, energy, params);

    // Combine: base radius * deformation * energy + pseudopod + bin modulation
    const radius =
      baseR * rFbm +
      rPseudo +
      binLevel * baseR * 0.15 * energy;

    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    out.push([x, y]);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Canvas helper
// ---------------------------------------------------------------------------

/** Convert HSL to CSS hsla string. */
function hsla(h: number, s: number, l: number, a: number): string {
  return `hsla(${h},${Math.round(s * 100)}%,${Math.round(l * 100)}%,${a})`;
}

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

  // Temporal smoothing state
  let prevRadii: number[] | null = null;

  const startedAt = performance.now();
  let rafId: number | null = null;

  const tick = () => {
    const t = (performance.now() - startedAt) / 1000;
    const s = latestState;

    if (ctx) {
      ctx.clearRect(0, 0, width, height);

      const energy = cellEnergy(s.mode, s.audioLevel, t, params.idle, params.levelGain);

      // Build raw contour points
      const rawPoints = buildCellContour(
        width,
        height,
        s.spectrumBins,
        t,
        s.audioLevel,
        energy,
        params,
      );

      // Compute radii for temporal smoothing
      const cx = width / 2;
      const cy = height / 2;
      const currentRadii = rawPoints.map(
        ([px, py]) => Math.sqrt((px - cx) ** 2 + (py - cy) ** 2),
      );

      let smoothedPoints = rawPoints;
      if (prevRadii && prevRadii.length === currentRadii.length) {
        const smoothedRadii = lowpassRadii(prevRadii, currentRadii, params.tension);
        smoothedPoints = rawPoints.map(([px, py], i) => {
          const angle = Math.atan2(py - cy, px - cx);
          const r = smoothedRadii[i];
          return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)] as [number, number];
        });
      }
      prevRadii = currentRadii;

      // Smooth via Catmull-Rom (4 segments per span for smoothness)
      const splinePoints = catmullRom(smoothedPoints, 4);

      if (splinePoints.length >= 3) {
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
          cx, cy, Math.max(1, Math.min(width, height) * params.radiusFraction * 0.9),
        );
        grad.addColorStop(0, hsla(baseHue + 10, 0.5, 0.7, params.fillAlpha * 0.5));
        grad.addColorStop(1, hsla(baseHue, 0.7, 0.45, params.fillAlpha));
        ctx.fillStyle = grad;
        ctx.fill();

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
