// src/theme-engine/renderers/cell/profile.ts

import { TAU } from "../shared";
import type { CellParams } from "./types";

/**
 * Commit 31a — normalised half-width of the asymmetric "slipper" body profile
 * for axial coordinate u in [-1, 1]. u=+1 is the ANTERIOR (wider blunt end),
 * u=-1 is the POSTERIOR (tapered end). Returns ~0 at u=+-1 and a max near mid.
 * For the taper coefficient c (params.bodyProfileTaper) the anterior (+u) is
 * wider than the posterior (-u) — the "not an oval" asymmetry. At c=0 both
 * taperedEllipse and egg reduce exactly to the ellipse sqrt(1-u^2). Pure.
 */
export function bodyHalfWidth(u: number, params: CellParams): number {
  const c = params.bodyProfileTaper ?? 0.3;
  const base = Math.sqrt(Math.max(0, 1 - u * u));
  const type = params.bodyProfileType ?? "taperedEllipse";
  switch (type) {
    case "egg":
      // Hügelschäffer egg via u=cos t; blunt (wider) at +u anterior, tapered at
      // -u posterior (c=d/a in [0,1)). The -2cu term makes +u the wider end.
      return base / Math.sqrt(1 - 2 * c * u + c * c);
    case "piriform": {
      // Pointed-posterior variant: tapered ellipse extra-narrowed toward -u by
      // the (1+u)/2 factor (1 at anterior, 0 at posterior pole). Single-valued,
      // smooth, w(+-1)=0, w>=0.
      const w = base * (1 + c * u) * Math.sqrt(Math.max(0, (1 + u) / 2));
      return w < 0 ? 0 : w;
    }
    case "taperedEllipse":
    default: {
      // Anterior (+u) wider for c>0; symmetric ellipse at c=0.
      const w = base * (1 + c * u);
      return w < 0 ? 0 : w;
    }
  }
}

/**
 * Commit 31a — body-frame contour point of the slipper profile for parameter
 * t in [0, 2pi). Anterior is at +x (t=0). Length scale L = baseR*sqrt(aspect),
 * width scale W = baseR/sqrt(aspect) (so L*W = baseR^2, area-neutral for the
 * plain ellipse). Optional small ventral bend shifts one flank only. Pure.
 */
export function bodyProfilePoint(
  t: number,
  baseR: number,
  params: CellParams,
): [number, number] {
  const c = params.bodyProfileTaper ?? 0.3;
  const aspect = params.bodyAspect ?? 3;
  const L = baseR * Math.sqrt(aspect);
  const W = baseR / Math.sqrt(aspect);
  const ct = Math.cos(t);
  const st = Math.sin(t);
  const x = L * ct;
  let y: number;
  const type = params.bodyProfileType ?? "taperedEllipse";
  switch (type) {
    case "egg":
      y = (W * st) / Math.sqrt(1 - 2 * c * ct + c * c);
      break;
    case "piriform":
      y = W * st * (1 + c * ct) * Math.sqrt(Math.max(0, (1 + ct) / 2));
      break;
    case "taperedEllipse":
    default:
      y = W * st * (1 + c * ct);
      break;
  }
  // Optional ventral oral-groove bend: tiny lateral shift on the anterior flank
  // only (cos t > 0). No-op when bodyVentralBend === 0 (default).
  const bend = params.bodyVentralBend ?? 0;
  if (bend !== 0) {
    y += bend * W * Math.max(0, ct);
  }
  return [x, y];
}

/**
 * Commit 31a — shoelace (polygon) area of the sampled slipper profile. Samples
 * bodyProfilePoint at t_k = 2pi*k/samples. Returns the absolute area. Pure.
 */
export function bodyProfileArea(
  baseR: number,
  params: CellParams,
  samples = 96,
): number {
  const n = Math.max(3, Math.floor(samples));
  let a = 0;
  let [px, py] = bodyProfilePoint(0, baseR, params);
  const [x0, y0] = [px, py];
  for (let k = 1; k <= n; k++) {
    const [cx, cy] = k === n ? [x0, y0] : bodyProfilePoint((TAU * k) / n, baseR, params);
    a += px * cy - cx * py;
    px = cx;
    py = cy;
  }
  return Math.abs(a) / 2;
}

/**
 * Commit 31a — area-neutral scale factor: sqrt(pi*baseR^2 / profileArea) so a
 * caller can scale the profile to preserve the equivalent circle's area.
 * Guards divide-by-zero (returns 1 for a degenerate/zero-area profile). Pure.
 */
export function bodyProfileAreaScale(
  baseR: number,
  params: CellParams,
  samples = 96,
): number {
  const area = bodyProfileArea(baseR, params, samples);
  if (!(area > 0)) return 1;
  return Math.sqrt((Math.PI * baseR * baseR) / area);
}

/**
 * Commit 31b — interpolate the slipper profile radius at a given BODY-frame
 * angle from the sampled (angle, radius) polar table. The profile is
 * star-convex, so radius(angle) is single-valued. `pts` is the raw, unsorted
 * sampling (ascending parameter t, anterior at +x). We sort by angle once and
 * linearly interpolate, wrapping the last->first pair across 2pi. Pure.
 */
export function interpProfileRadius(
  angle: number,
  pts: Array<{ ang: number; rad: number }>,
): number {
  const n = pts.length;
  if (n === 0) return 0;
  // Normalise query angle to [0, 2pi).
  let a = angle % TAU;
  if (a < 0) a += TAU;
  // Sorted-by-angle copy (ascending).
  const sorted = pts
    .map((p) => ({ ang: ((p.ang % TAU) + TAU) % TAU, rad: p.rad }))
    .sort((u, v) => u.ang - v.ang);
  // Find the bracketing pair [sorted[i], sorted[i+1]] with sorted[i].ang <= a.
  for (let i = 0; i < n; i++) {
    const lo = sorted[i];
    const hi = sorted[(i + 1) % n];
    let hiAng = hi.ang;
    // Wrap the seam pair (last -> first) across 2pi.
    if (i === n - 1) hiAng += TAU;
    if (a >= lo.ang && a <= hiAng) {
      const span = hiAng - lo.ang;
      const f = span > 0 ? (a - lo.ang) / span : 0;
      return lo.rad + (hi.rad - lo.rad) * f;
    }
  }
  // a < sorted[0].ang: fall in the seam pair (last -> first wrapped).
  const lo = sorted[n - 1];
  const hi = sorted[0];
  const span = hi.ang + TAU - lo.ang;
  const aShift = a + TAU;
  const f = span > 0 ? (aShift - lo.ang) / span : 0;
  return lo.rad + (hi.rad - lo.rad) * f;
}

/**
 * Commit 31b — sample the asymmetric slipper profile as a deform[]-style array
 * of per-canvas-angle radial deviations (radius = baseR*(1+deform[j])). The
 * slipper lives in deform[] so BOTH the membrane and the cilia (which read the
 * same {deform, squeezeK, squeezePhi} contour) ride it. Area-neutral (keeps the
 * equivalent circle's area) and body-frame-rotated by `bodyHeading` so the wide
 * anterior end points along the swim direction. Pure & deterministic.
 */
export function bodyProfileDeform(
  sampleCount: number,
  bodyHeading: number,
  baseR: number,
  params: CellParams,
): number[] {
  const N = Math.max(3, Math.floor(sampleCount));
  // 1. Sample the profile polygon in the BODY frame (anterior at +x, t=0).
  const pts: Array<{ ang: number; rad: number }> = [];
  for (let k = 0; k < N; k++) {
    const t = (k / N) * TAU;
    const [px, py] = bodyProfilePoint(t, baseR, params);
    pts.push({ ang: Math.atan2(py, px), rad: Math.hypot(px, py) });
  }
  // 2. Area-neutral scale so the slipper keeps the circle's area.
  const scale = bodyProfileAreaScale(baseR, params, N);
  // 3. For each uniform CANVAS vertex angle phi_j, convert to body angle and
  //    interpolate the profile radius; bake the heading in here.
  const out: number[] = [];
  for (let j = 0; j < N; j++) {
    const phi = (j / N) * TAU;
    const bodyAng = phi - bodyHeading;
    const r = interpProfileRadius(bodyAng, pts) * scale;
    out.push(r / baseR - 1);
  }
  return out;
}

/**
 * v3.7B — apply a smooth oral-groove concavity to an existing deform[] array.
 * The groove is a cosine-bell dip centred at `oralGrooveAngle` (body frame,
 * 0 = anterior, positive = ventral), mapped to canvas angle via `bodyHeading`.
 * Modifies in-place and returns the same array. When `enableOralGroove` is
 * false (default), returns immediately — no-op.
 *
 * @param deform       The N-sample deform[] array (mutated in place).
 * @param bodyHeading  Current body long-axis heading (rad).
 * @param params       Cell params (reads groove depth/angle/width).
 * @returns The same deform[] array (for chaining convenience).
 */
export function applyOralGroove(
  deform: number[],
  bodyHeading: number,
  params: CellParams,
): number[] {
  if (!params.enableOralGroove) return deform;
  const N = deform.length;
  if (N < 3) return deform;

  const depth = params.oralGrooveDepth ?? 0.04;
  const center = params.oralGrooveAngle ?? 1.2; // body-frame rad
  const halfW = params.oralGrooveWidth ?? 0.6;  // half-width in rad

  for (let i = 0; i < N; i++) {
    const canvasAng = (i / N) * TAU;
    // Convert canvas angle to body-frame angle.
    let bodyAng = canvasAng - bodyHeading;
    // Wrap to [-π, π]
    bodyAng = ((bodyAng % TAU) + TAU + Math.PI) % TAU - Math.PI;

    const dist = Math.abs(bodyAng - center);
    if (dist < halfW) {
      // Cosine bell: 1 at centre → 0 at edge. Smooth C1 falloff.
      const t = dist / halfW; // 0..1
      const bell = 0.5 * (1 + Math.cos(Math.PI * t));
      deform[i] -= depth * bell;
    }
  }
  return deform;
}

/**
 * Commit 32c — build the 96-sample {ang, rad} polar profile table that
 * `interiorPoint` uses to look up the wall radius at a body angle. EXACTLY the
 * array `interiorPoint` builds inline (sample bodyProfilePoint at t=(k/N)*TAU ->
 * {ang: atan2(py,px), rad: hypot(px,py)}). Pulled out so the caller can build it
 * once per frame instead of once per granule (perf), and so there is ONE
 * definition shared by the cache path and the fallback (DRY). Pure.
 */
export function buildProfilePts(
  baseR: number,
  params: CellParams,
  samples = 96,
): Array<{ ang: number; rad: number }> {
  const N = Math.max(3, Math.floor(samples));
  const pts: Array<{ ang: number; rad: number }> = [];
  for (let k = 0; k < N; k++) {
    const t = (k / N) * TAU;
    const [px, py] = bodyProfilePoint(t, baseR, params);
    pts.push({ ang: Math.atan2(py, px), rad: Math.hypot(px, py) });
  }
  return pts;
}

/**
 * Commit 32b — invert the CDF of the half-width density p(u) ∝ ŵ(u) =
 * bodyHalfWidth(u, params), so a uniform sample `xi` in [0, 1] maps to an
 * AREA-UNIFORM axial coordinate `u` in [-1, 1] (more samples where the body is
 * fat, fewer at the thin poles). Builds a normalised CDF table (M=128 trapezoid
 * samples) once per call, then inverts by binary search + linear interpolation.
 * Works for ALL profile types (incl. ventral bend) since it only reads
 * bodyHalfWidth. Pure & deterministic; O(M) per call (seeding happens lazily).
 */
export function profileCDFInv(xi: number, params: CellParams): number {
  const M = 128;
  const us: number[] = [];
  const cdf: number[] = [];
  let acc = 0;
  let prevW = bodyHalfWidth(-1, params);
  us.push(-1);
  cdf.push(0);
  for (let k = 1; k <= M; k++) {
    const u = -1 + (2 * k) / M;
    const w = bodyHalfWidth(u, params);
    acc += (prevW + w) * 0.5 * (2 / M); // trapezoid step, du = 2/M
    prevW = w;
    us.push(u);
    cdf.push(acc);
  }
  const Z = acc || 1; // guard degenerate (all-zero width)
  const target = Math.max(0, Math.min(1, xi)) * Z;
  // Binary search the first table node with cdf >= target.
  let lo = 0;
  let hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cdf[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  if (lo === 0) return us[0];
  // Lerp between node lo-1 and lo on the cumulative axis.
  const c0 = cdf[lo - 1];
  const c1 = cdf[lo];
  const span = c1 - c0;
  const frac = span > 0 ? (target - c0) / span : 0;
  const u = us[lo - 1] + frac * (us[lo] - us[lo - 1]);
  return u < -1 ? -1 : u > 1 ? 1 : u;
}
