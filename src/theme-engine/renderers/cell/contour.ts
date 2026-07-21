// src/theme-engine/renderers/cell/contour.ts

import { fbm, integrateDeformation, lerp, noise2D, smoothstep, TAU } from "../shared";
import { membraneMaxRadius, resolveBaseRadius } from "./sizing";
import type { CellParams } from "./types";

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
// Deformation pipeline (see docs/CELL_MATH.md for the public rationale).
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
 * instead of growing the whole cell (see docs/CELL_MATH.md area-preservation notes).
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
 * See docs/CELL_MATH.md deformation notes. This is why we use the point-squeeze and
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
    // Commit 29: smooth rigid membrane. Suppress ALL per-vertex deformation
    // (FBM wobble, pseudopods, audio bins, idle morph) to a flat 0 so the body
    // is a perfect circle pre-affine; the downstream affine squeeze then makes a
    // smooth firm spindle. The loop is independent per i, so an early continue
    // here is safe. OFF path below stays byte-identical to the frozen golden.
    if (params.enableRigidMembrane) {
      out.push(0);
      continue;
    }

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
