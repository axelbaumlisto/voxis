// src/theme-engine/renderers/cell/interior.ts

import { TAU, deformAt, noise2D } from "../shared";
import { affineSqueezePoints } from "./contour";
import { bodyHalfWidth, buildProfilePts, interpProfileRadius, profileCDFInv } from "./profile";
import type { CellParams } from "./types";

/**
 * Commit 32a — context for `interiorPoint`. Carries the SAME per-frame wall
 * description the membrane + cilia use (`deform`, `squeezeK`, `squeezePhi`) plus
 * the body geometry (`cx`, `cy`, `baseR`, `bodyHeading`, `params`). Bundling it
 * keeps the helper a single pure mapping with no hidden globals.
 */
export interface InteriorCtx {
  cx: number;
  cy: number;
  baseR: number;
  /** SAME per-canvas-angle deform array the membrane uses this frame. */
  deform: number[];
  /** SAME body affine the membrane/cilia use this frame. */
  squeezeK: number;
  squeezePhi: number;
  /** Body long-axis heading (rad). */
  bodyHeading: number;
  params: CellParams;
  /** Commit 32c (OPT): precomputed 96-sample {ang, rad} profile polar table
   * (from `buildProfilePts`). When supplied the caller builds it ONCE per frame
   * so `interiorPoint` skips its per-call profile loop. When omitted, behaviour
   * is byte-identical to before (the same table is rebuilt internally). */
  profilePts?: Array<{ ang: number; rad: number }>;
}

/**
 * Commit 32a — map a BODY-NORMALISED interior coordinate (u, s) to a world
 * point by RECONSTRUCTING the exact same wall the membrane + cilia draw, so the
 * wall is literally `interiorPoint(., s=+-1)`. This is the shared coupling seam
 * for every organelle (slices 32b-32e): each organelle deforms WITH the
 * membrane via this one path, never via a separate disc.
 *
 * Coordinates: `u` in [-1, 1] is the axial fraction (u=+1 anterior, matching
 * bodyHalfWidth/bodyProfilePoint which put the anterior at +x); `s` in [-1, 1]
 * is the transverse fraction of the LOCAL half-width (s=+-1 = the wall, s=0 =
 * the long axis).
 *
 * Construction (GUARANTEES wall-landing on BOTH the profile path and a
 * synthetic FBM deform): at |s|=1 the radial fraction f === 1 exactly, so the
 * point equals the membrane ray reconstruction `baseR*(1+deformAt(theta))` then
 * the SAME affine. REUSES bodyHalfWidth / bodyProfilePoint / interpProfileRadius
 * / deformAt / affineSqueezePoints — no duplicated profile or affine math.
 * HEADING is applied EXACTLY once (thetaCanvas = thetaBody + bodyHeading).
 * Pure & deterministic. The per-call 96-sample profile loop is acceptable for
 * 32a (caching is a later optimisation; KISS).
 */
export function interiorPoint(u: number, s: number, ctx: InteriorCtx): [number, number] {
  const { cx, cy, baseR, deform, squeezeK, squeezePhi, bodyHeading, params } = ctx;
  // 1. Body-frame interior point (anterior at +x), SAME embedding as
  //    bodyProfilePoint: length L = baseR*sqrt(aspect), width W = baseR/sqrt(aspect).
  const aspect = params.bodyAspect ?? 3;
  const L = baseR * Math.sqrt(aspect);
  const W = baseR / Math.sqrt(aspect);
  const what = bodyHalfWidth(u, params); // normalised local half-width
  const xb = L * u;
  const bend = params.bodyVentralBend ?? 0;
  // Match bodyProfilePoint's ventral-bend centerline shift (cell.ts ~2185:
  // y += bend*W*max(0, cos t), cos t = u) so |s|=1 lands on the bent wall.
  const yb = s * W * what + bend * W * Math.max(0, u); // s scales the local half-width => |s|=1 is the wall
  // 2. Body angle + radius of this interior point.
  const rho = Math.hypot(xb, yb);
  const thetaBody = Math.atan2(yb, xb);
  // 3. The UN-scaled profile wall radius at this body angle (same sampling as
  //    bodyProfileDeform / bodyProfileAreaScale use). Use the caller's per-frame
  //    cache when supplied (32c perf); else rebuild the SAME 96-sample table via
  //    buildProfilePts so the fallback is byte-identical to before.
  const pts = ctx.profilePts ?? buildProfilePts(baseR, params);
  const profileR = interpProfileRadius(thetaBody, pts);
  // 4. Radial fraction f in [0, 1]: at |s|=1, rho === profileR so f === 1 (on
  //    the wall); at the centre (rho=0) f === 0. Pole guard: profileR -> 0 at
  //    u=+-1 falls back to 0 (no NaN).
  const f = profileR > 1e-9 ? rho / profileR : 0;
  // 5. The LIVE wall radius at the matching CANVAS angle (heading baked in once),
  //    via the SAME deformAt the membrane uses.
  const thetaCanvas = thetaBody + bodyHeading;
  const wallR = baseR * (1 + deformAt(thetaCanvas, deform));
  // 6. Interior point along that canvas ray at fraction f, then the SAME affine
  //    (identity when squeezeK === 1 or enableAffine is off).
  const px0 = cx + Math.cos(thetaCanvas) * f * wallR;
  const py0 = cy + Math.sin(thetaCanvas) * f * wallR;
  return affineSqueezePoints([[px0, py0]], squeezeK, squeezePhi, cx, cy, params)[0];
}

/**
 * Commit 32b — seed `count` interior granules in BODY-NORMALISED coords (u, s).
 * `s` is Uniform(-1, 1) transverse; `u` is area-uniform axial via profileCDFInv
 * so the cloud fills the slipper to the poles (density ∝ ŵ(u)) instead of
 * clustering centrally. `q` (loop label) and `phi0` (loop phase) are seeded now
 * from decorrelated noise but UNUSED until the cyclosis advection lands in 32c —
 * included so 32c needs no reseed. Pure & deterministic (noise2D only).
 */
export function seedInteriorGranules(
  count: number,
  seedBase: number,
  params: CellParams,
): Array<{ u: number; s: number; q: number; phi0: number }> {
  const n = Math.max(0, Math.floor(count));
  const out: Array<{ u: number; s: number; q: number; phi0: number }> = [];
  for (let i = 0; i < n; i++) {
    const xiU = (noise2D(i * 12.9898 + seedBase + 1.7, 78.233) + 1) * 0.5; // [0,1]
    const xiS = (noise2D(i * 39.346 + seedBase + 5.3, 11.135) + 1) * 0.5; // [0,1]
    const xiQ = (noise2D(i * 17.13 + seedBase + 2.9, 51.07) + 1) * 0.5; // [0,1] loop label (32c)
    const xiP = (noise2D(i * 7.77 + seedBase + 9.1, 23.31) + 1) * 0.5; // [0,1] phase (32c)
    const s = 2 * xiS - 1; // Uniform(-1, 1) transverse
    const u = profileCDFInv(xiU, params); // area-uniform axial
    out.push({ u, s, q: xiQ, phi0: xiP * TAU });
  }
  return out;
}

/**
 * Commit 32c — advance one interior granule along a divergence-free closed
 * cyclosis loop in BODY coords (u, s). In the unit square [-1,1]^2 the
 * streamfunction psi(u, s) = (1-u^2)(1-s^2) vanishes on all edges, so its level
 * sets are nested closed loops tangent to the wall (u . n = 0). We use the
 * phase parametrisation (option A in aplan-organelles-math.md): NO
 * renormalisation, exactly on the loop, frame-rate independent (reads simTime,
 * not dt):
 *
 *   u(phi) = amp * sin(phi)
 *   s(phi) = amp * sin(phi + pi/2) = amp * cos(phi)    (delta = pi/2 => clean loop)
 *
 * `amp` (which nested loop this granule rides) comes from the seeded loop label
 * q in [0, 1], biased outward by sqrt so a fraction of granules ride the OUTER
 * cortical loop near the poles. Because (u, s) maps through the ELONGATED body
 * via interiorPoint, this body-coord circle becomes an elongated world loop that
 * follows the body and reaches the poles. Divergence-free + wall-tangent by
 * construction (|u|,|s| < 1 for amp < 1). Pure & deterministic — depends only on
 * (q, phi0, simTime, params); decoupled from speedNorm (uses cyclosisPeriod).
 */
export function cyclosisLoopPoint(
  g: { q: number; phi0: number },
  simTime: number,
  params: CellParams,
): { u: number; s: number } {
  const T = Math.max(0.1, params.cyclosisPeriod ?? 45);
  const sense = (params.cyclosisSense ?? 1) >= 0 ? 1 : -1;
  return cyclosisLoopPointAtPhase(g, sense * (TAU / T) * simTime);
}

/**
 * Step A+B: cyclosis loop from an integrated phase offset (radians). The seeded
 * `phi0` remains per-granule; the renderer accumulates only the shared offset.
 */
export function cyclosisLoopPointAtPhase(
  g: { q: number; phi0: number },
  phase: number,
): { u: number; s: number } {
  const phi = g.phi0 + phase;
  // nested loop amplitude from the loop label q in [0, 1]; sqrt biases outward
  // so some granules ride the OUTER loop near the cortex/poles.
  const amp = 0.3 + 0.68 * Math.sqrt(Math.max(0, Math.min(1, g.q))); // [0.30, 0.98]
  const u = amp * Math.sin(phi);
  const s = amp * Math.sin(phi + Math.PI / 2); // = amp*cos(phi); delta=pi/2 -> elliptical loop
  return { u, s };
}

