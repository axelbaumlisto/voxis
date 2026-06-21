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
  noise2D, catmullRom, catmullRomOpen, hsla, TAU, growthLevel,
  lerp, smoothstep, deformAt,
} from "./shared";
import { sanitizeUnit, sanitizeFinite, sanitizeBins } from "./cell/math";
import { cellEnergy, smoothEnergy, cellActivity, effectiveCyclosisPeriod } from "./cell/activity";
import { advanceAxialSpinPhase, advanceCyclosisPhase, advanceCiliaBeatCycles } from "./cell/phases";
import { membraneMaxRadius, resolveBaseRadius, perimeterCiliaCount } from "./cell/sizing";
import { startleOffset, startleHeadingKick, startleBurstSpeed } from "./cell/startle";
import { swimSpeed, driftActivation, wanderStep } from "./cell/locomotion";
import type { WanderState } from "./cell/locomotion";
import { bodyHeadingStep, prolateAspect, helicalOffset } from "./cell/body-motion";
import {
  bodyHalfWidth, interpProfileRadius, bodyProfileDeform,
  applyOralGroove, buildProfilePts, profileCDFInv,
} from "./cell/profile";
import { serializeCellState, parseCellState, restoreSeed, cellPersistKey, wanderPoseFromState } from "./cell/persistence";
import {
  affineSqueezePoints, bandLimitDeform, buildTargetDeformation, integrateDeformPipeline,
} from "./cell/contour";
import {
  ciliaPath, somaticCiliaParams, strokeAxisStrength,
} from "./cell/cilia";
import type { CiliaMotion } from "./cell/cilia";
import type { CellParams, CellOptions } from "./cell/types";
import { CELL_DEFAULTS } from "./cell/defaults";

// Backward-compat re-exports: existing imports of these from "./cell" keep working.
export { noise2D, fbm, catmullRom, catmullRomOpen, lowpassRadii, integrateDeformation, TAU, smoothstep } from "./shared";
export { sanitizeUnit, sanitizeFinite, sanitizeBins } from "./cell/math";
export { cellEnergy, smoothEnergy, cellActivity, effectiveCyclosisPeriod } from "./cell/activity";
export { advanceAxialSpinPhase, advanceCyclosisPhase, advanceCiliaBeatCycles } from "./cell/phases";
export { membraneMaxRadius, resolveBaseRadius, perimeterCiliaCount, cellReach } from "./cell/sizing";
export { startleOffset, startleHeadingKick, startleBurstSpeed } from "./cell/startle";
export { swimSpeed, driftActivation, cellDrift, wanderStep, wallReorientHeading, rotationalBrownianStep, sedimentationBias } from "./cell/locomotion";
export type { WanderState } from "./cell/locomotion";
export { bodyHeadingStep, prolateAspect, helicalOffset, axialSpin } from "./cell/body-motion";
export {
  bodyHalfWidth, bodyProfilePoint, bodyProfileArea, bodyProfileAreaScale,
  interpProfileRadius, bodyProfileDeform, applyOralGroove, buildProfilePts, profileCDFInv,
} from "./cell/profile";
export { serializeCellState, parseCellState, restoreSeed, cellPersistKey, wanderPoseFromState } from "./cell/persistence";
export type { CellPersistState } from "./cell/persistence";
export {
  cellRadius, pseudopodOffset, idleMorph, sampleBinLevel,
  saturateTargetDeform, normalizeAreaDeform, integrateDeformPipeline,
  affineSqueezePoints, buildTargetDeformation, buildCellContour, bandLimitDeform,
} from "./cell/contour";
export {
  ciliaEndpoints, ciliaBeatPhase, ciliaBeatPhaseAtCycle,
  strokeAxisStrength, metachronalIndex, ciliaStrokeAngle,
  somaticCiliaParams, ciliaStructureMod, ciliaPath,
} from "./cell/cilia";
export type { Cilium, CiliaMotion, CiliumPath } from "./cell/cilia";



// ---------------------------------------------------------------------------
// Cell parameters
// ---------------------------------------------------------------------------

export type { CellParams, CellOptions } from "./cell/types";
export { CELL_DEFAULTS } from "./cell/defaults";



// ---------------------------------------------------------------------------
// Cell geometry functions
// ---------------------------------------------------------------------------

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
 * Commit 26 — TWO contractile vacuoles (anterior + posterior). A real
 * Paramecium has a pair of CVs at opposite ends, each pulsing on its OWN clock
 * (asynchronous: different periods + a posterior phase offset). This pure
 * helper returns the pair's geometry in the WORLD frame (pre-affine-squeeze):
 * each entry's `bearing` (world angle = squeezePhi + body-frame bearing, so the
 * pair rotates with the body heading/spin) and `r` (px, the live vesicle
 * radius). REUSES `contractileVacuole` for the fill/collapse curve (DRY) by
 * passing a time-shifted `t` and a per-vacuole period/maxFrac. The renderer
 * places each vesicle at a clamped `placeR` along `bearing` (containment vs
 * `minMembraneR` lives in the renderer, since that is not known here). Returns
 * [] when `enableVacuoles` is off so the gated draw block is skipped. Pure &
 * deterministic — depends only on (t, baseR, squeezePhi, params).
 */
export function contractileVacuolePair(
  t: number,
  baseR: number,
  squeezePhi: number,
  params: CellParams,
): Array<{ bearing: number; r: number }> {
  if (!params.enableVacuoles) return [];
  const maxFrac = params.vacuolePairMaxFrac ?? 0.16;
  const antPeriod = params.vacuoleAnteriorPeriod ?? 9;
  const postPeriod = params.vacuolePosteriorPeriod ?? 13;
  const antBearing = params.vacuoleAnteriorBearing ?? 1.9;
  const postBearing = params.vacuolePosteriorBearing ?? -1.9;
  const postPhase = params.vacuolePosteriorPhase ?? 0.5;
  // anterior CV: phase offset 0; posterior CV: out of phase by a fraction of
  // its own cycle so the two never start together (asynchronous).
  const anterior = contractileVacuole(t, baseR, {
    ...params,
    vacuolePeriod: antPeriod,
    vacuoleMaxFrac: maxFrac,
  });
  const posterior = contractileVacuole(t + postPhase * postPeriod, baseR, {
    ...params,
    vacuolePeriod: postPeriod,
    vacuoleMaxFrac: maxFrac,
  });
  return [
    { bearing: squeezePhi + antBearing, r: anterior.r },
    { bearing: squeezePhi + postBearing, r: posterior.r },
  ];
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

/**
 * Commit 27 — cytoplasmic streaming (cyclosis) velocity field. A rigid-rotation
 * field `u(dx,dy) = omega*(-dy, dx)` is EXACTLY divergence-free
 * (∂(-omega·dy)/∂dx + ∂(omega·dx)/∂dy = 0) and tangent to circles about the
 * centre, so `u·r = 0` (no radial flux) and `u·n = 0` at a circular wall. A
 * granule advected by this field stays on its circle, giving a stable closed
 * cyclosis loop. omega>0 is counterclockwise. Pure & deterministic.
 */
export function cyclosisField(dx: number, dy: number, omega: number): { vx: number; vy: number } {
  return { vx: -omega * dy, vy: omega * dx };
}

/**
 * Commit 27 — deterministic scatter of `cyclosisGranuleCount` granules as
 * BODY-FRAME offsets (relative to the centre) within
 * `granuleMaxRadiusFrac*baseR`. Two decorrelated value-noise seeds per granule
 * (→ angle + radius); the radius uses a sqrt for an area-uniform disc fill.
 * Returns [] when the gate is off or the count is 0. Pure & deterministic.
 */
export function seedGranules(baseR: number, params: CellParams): Array<{ x: number; y: number }> {
  if (!params.enableCyclosis) return [];
  const n = Math.max(0, Math.floor(params.cyclosisGranuleCount ?? 0));
  if (n === 0) return [];
  const maxRad = Math.max(0, params.granuleMaxRadiusFrac ?? 0.75) * Math.max(0, baseR);
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i++) {
    const ang = (noise2D(i * 12.9898 + 1.7, 78.233) + 1) * Math.PI; // [0, 2PI]
    // sqrt of a [0,1] sample -> area-uniform fill of the disc.
    const rad = Math.sqrt((noise2D(i * 39.346 + 5.3, 11.135) + 1) * 0.5) * maxRad;
    out.push({ x: rad * Math.cos(ang), y: rad * Math.sin(ang) });
  }
  return out;
}

/**
 * Commit 27 — advance one granule's BODY-FRAME offset by the cyclosis rotation
 * field for `dt`. omega = TAU / max(0.1, cyclosisPeriod). Explicit Euler on a
 * rotation drifts outward by O(dt²); we renormalise the radius back to its prior
 * magnitude so the granule stays exactly on its circle (no spiral-out/collapse).
 * The body-frame radius is clamped to granuleMaxRadiusFrac*baseR. Pure &
 * deterministic; angular speed is fixed by cyclosisPeriod (frame-rate
 * independent in the sense that the same simTime path yields the same loop).
 */
export function advectGranule(
  g: { x: number; y: number },
  baseR: number,
  dt: number,
  params: CellParams,
): { x: number; y: number } {
  const omega = TAU / Math.max(0.1, params.cyclosisPeriod ?? 45);
  const v = cyclosisField(g.x, g.y, omega);
  const nx = g.x + v.vx * dt;
  const ny = g.y + v.vy * dt;
  const maxRad = Math.max(0, params.granuleMaxRadiusFrac ?? 0.75) * Math.max(0, baseR);
  const r0 = Math.min(Math.hypot(g.x, g.y), maxRad);
  const r1 = Math.hypot(nx, ny) || 1;
  const s = r0 / r1;
  return { x: nx * s, y: ny * s };
}

/**
 * Commit 28 — a food vacuole's [0..1] size scalar over its DIGEST cycle. Fresh
 * vacuoles are full (1.0) and shrink linearly to ~0.3 over `foodVacuoleDigestPeriod`
 * seconds, then reset (a new vacuole forms). `seedPhase` offsets each vacuole so
 * they digest asynchronously. Pure & deterministic.
 */
export function foodVacuoleSize(t: number, seedPhase: number, params: CellParams): number {
  const period = Math.max(0.1, params.foodVacuoleDigestPeriod ?? 30);
  const u = (((t / period + seedPhase) % 1) + 1) % 1; // [0,1)
  // full when fresh (u=0), shrinks to ~0.3 by u->1, then resets at the wrap.
  return 1 - 0.7 * u;
}

/**
 * Commit 28 — deterministic scatter of `foodVacuoleCount` food vacuoles as
 * BODY-FRAME offsets within `foodVacuoleMaxRadiusFrac*baseR` (a bit deeper than
 * granules), each with a per-vacuole digest `phase` in [0,1) from a third
 * decorrelated noise seed. Returns [] when the gate is off or the count is 0.
 * Pure & deterministic.
 */
export function seedFoodVacuoles(
  baseR: number,
  params: CellParams,
): Array<{ x: number; y: number; phase: number }> {
  if (!params.enableOrganelles) return [];
  const n = Math.max(0, Math.floor(params.foodVacuoleCount ?? 0));
  if (n === 0) return [];
  const maxRad = Math.max(0, params.foodVacuoleMaxRadiusFrac ?? 0.62) * Math.max(0, baseR);
  const out: Array<{ x: number; y: number; phase: number }> = [];
  for (let i = 0; i < n; i++) {
    const ang = (noise2D(i * 17.413 + 3.1, 52.917) + 1) * Math.PI; // [0, 2PI]
    // sqrt of a [0,1] sample -> area-uniform fill of the disc.
    const rad = Math.sqrt((noise2D(i * 44.197 + 9.7, 23.671) + 1) * 0.5) * maxRad;
    // third decorrelated seed -> digest phase in [0,1).
    const phase = (noise2D(i * 61.829 + 2.3, 88.541) + 1) * 0.5;
    out.push({ x: rad * Math.cos(ang), y: rad * Math.sin(ang), phase });
  }
  return out;
}

/**
 * Commit 32d — seed `count` food vacuoles in BODY-NORMALISED loop coords so they
 * ride the SAME divergence-free cyclosis loop as the granules (cyclosisLoopPoint)
 * and circulate through the elongated body to the poles, drawn via interiorPoint
 * (coupled to the deforming wall). Each vacuole gets a loop label `q`, an initial
 * loop phase `phi0`, and a per-vacuole `digestPhase` for foodVacuoleSize's shrink
 * curve. REUSES the EXACT decorrelated noise seed constants the legacy
 * seedFoodVacuoles used (17.413/52.917, 44.197/23.671, 61.829/88.541) so the
 * vacuole RNG stream stays familiar/decorrelated from the granule stream. Pure &
 * deterministic; returns [] when count is 0.
 */
export function seedInteriorFoodVacuoles(
  count: number,
  params: CellParams,
): Array<{ q: number; phi0: number; digestPhase: number }> {
  // params is part of the public signature for symmetry with the granule seeder
  // (future profile-aware seeding); the loop coords here are profile-independent.
  void params;
  const n = Math.max(0, Math.floor(count));
  const out: Array<{ q: number; phi0: number; digestPhase: number }> = [];
  for (let i = 0; i < n; i++) {
    const xi_q = (noise2D(i * 17.413 + 3.1, 52.917) + 1) * 0.5; // [0,1] loop label
    const xi_p = (noise2D(i * 44.197 + 9.7, 23.671) + 1) * 0.5; // [0,1] initial loop phase
    const xi_d = (noise2D(i * 61.829 + 2.3, 88.541) + 1) * 0.5; // [0,1] digest phase
    out.push({ q: xi_q, phi0: xi_p * TAU, digestPhase: xi_d });
  }
  return out;
}

/**
 * Commit 28 — advance one food vacuole's BODY-FRAME offset by the SAME cyclosis
 * rotation field as the granules (DRY: reuses cyclosisField), with
 * omega = TAU / max(0.1, foodVacuolePeriod). The radius is renormalised back to
 * its prior magnitude so the vacuole stays exactly on its circle (no spiral-out),
 * clamped to foodVacuoleMaxRadiusFrac*baseR. `phase` (the digest clock) is
 * carried through unchanged. Pure & deterministic.
 */
export function advectFoodVacuole(
  v: { x: number; y: number; phase: number },
  baseR: number,
  dt: number,
  params: CellParams,
): { x: number; y: number; phase: number } {
  const omega = TAU / Math.max(0.1, params.foodVacuolePeriod ?? 55);
  const f = cyclosisField(v.x, v.y, omega);
  const nx = v.x + f.vx * dt;
  const ny = v.y + f.vy * dt;
  const maxRad = Math.max(0, params.foodVacuoleMaxRadiusFrac ?? 0.62) * Math.max(0, baseR);
  const r0 = Math.min(Math.hypot(v.x, v.y), maxRad);
  const r1 = Math.hypot(nx, ny) || 1;
  const s = r0 / r1;
  return { x: nx * s, y: ny * s, phase: v.phase };
}

/**
 * Commit 28 — the micronucleus sits just BESIDE (outside) the macronucleus. Its
 * radius is `macroR * micronucleusSizeFrac` (smaller) and its centre is offset
 * from the macronucleus centre by `macroR * micronucleusOffsetFrac` along a FIXED
 * bearing (deterministic). Returns the ABSOLUTE centre + radius so the caller can
 * draw it around the already-squeezed macronucleus centre. Pure.
 */
export function micronucleusTransform(
  macroCx: number,
  macroCy: number,
  macroR: number,
  params: CellParams,
): { cx: number; cy: number; r: number } {
  const r = macroR * (params.micronucleusSizeFrac ?? 0.32);
  const off = macroR * (params.micronucleusOffsetFrac ?? 1.15);
  const bearing = 0.7; // fixed, deterministic — sits just beside the macronucleus
  return {
    cx: macroCx + Math.cos(bearing) * off,
    cy: macroCy + Math.sin(bearing) * off,
    r,
  };
}

// ---------------------------------------------------------------------------
// Canvas helper
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// Renderer factory
// ---------------------------------------------------------------------------


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
  let trichocystAlpha = 0;  // v3.9B: independent trichocyst fade (decoupled from startle)
  let triPrevStartle = 0;   // v3.9B: previous startle for onset detection (rising edge)
  let baseline = 0; // slow-tracking audio baseline for startle edge detection
  let drift01 = 0; // smoothed drift activation (0=centered, 1=full drift)

  // Reynolds-style integrated wander state (replaces position=noise(t), which
  // oscillated about the centre and kept "returning"). Lazily initialised at
  // the tank centre on the first tick (width/height are stable per renderer).
  let wander: WanderState | null = null;
  let bodyHeading = 0; // G4: smoothed body long-axis heading (radians)
  let interiorHeading = 0; // slow-following heading for interior organelle projection
  // H4 (gate OFF): ambient tracer motes advected by the body's dipolar wake.
  // Lazily seeded on first tick when enableFlowField is on; [] otherwise so the
  // default path allocates nothing and the shipped look is unchanged.
  let motes: { x: number; y: number }[] | null = null;
  // Commit 27 (gate OFF): cytoplasmic-streaming granules, body-frame offsets that
  // circulate on a divergence-free closed loop. Lazily seeded on first tick when
  // enableCyclosis is on; stays null otherwise so the default path allocates
  // nothing and the shipped look is byte-unchanged.
  let granules: Array<{ x: number; y: number }> | null = null;
  // Commit 32b (gate OFF): body-coord interior granules in (u, s). Lazily seeded
  // on first tick when enableInteriorField is on; stays null otherwise so the
  // legacy disc path allocates nothing and goldens stay byte-identical.
  let interiorGranules: Array<{ u: number; s: number; q: number; phi0: number }> | null = null;
  // Commit 28 (gate OFF): food-vacuole body-frame offsets (with a digest phase)
  // that ride the SAME cyclosis loop as the granules, plus a micronucleus drawn
  // beside the macronucleus. Lazily seeded on first tick when enableOrganelles
  // is on; stays null otherwise so the default path allocates nothing and the
  // shipped look is byte-unchanged.
  let foodVacuoles: Array<{ x: number; y: number; phase: number }> | null = null;
  // Commit 32d (gate OFF): food vacuoles in body-coord loop space (q, phi0,
  // digestPhase) that ride the SAME cyclosis loop as the interior granules and
  // are drawn via interiorPoint. Lazily seeded on first tick when
  // enableInteriorField is on; stays null otherwise so the legacy disc path
  // allocates nothing and goldens stay byte-identical.
  let interiorFoodVacuoles: Array<{ q: number; phi0: number; digestPhase: number }> | null = null;
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
  // Step A+B: activity-dependent visual phases must be integrated by dt. Do not
  // compute `rate(currentActivity) * simTime`, because a rate change after long
  // uptime creates a visible phase spike proportional to elapsed time.
  let axialSpinPhase = 0;
  let cyclosisPhase = 0;
  let ciliaBeatCycles = 0;

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
      // v3.7C: compute effective cyclosis period once (activity-modulated).
      // Used by cyclosisLoopPoint and advectGranule below.
      const cyclPeriod = effectiveCyclosisPeriod(activity, params);
      // Shallow override so cyclosisLoopPoint / advectGranule read the
      // activity-modulated period without changing their pure signatures.
      const cyclParams: CellParams = params.cyclosisActivityBoost
        ? { ...params, cyclosisPeriod: cyclPeriod }
        : params; // no boost => reuse original (zero allocation)
      cyclosisPhase = advanceCyclosisPhase(cyclosisPhase, dt, cyclParams);
      const effectiveFillAlpha = lerp(
        params.fillAlpha,
        params.fillAlphaActive ?? params.fillAlpha,
        activity,
      );
      const baseMembraneLightness = params.membraneLightness ?? 0.60;
      const effectiveMembraneLightness = lerp(
        baseMembraneLightness,
        params.membraneLightnessActive ?? baseMembraneLightness,
        activity,
      );
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
      if (params.idleDriftMin) {
        drift01 = Math.max(params.idleDriftMin, drift01);
      }

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
      let baseSwim = params.enableActivity ? swimSpeed(activity, width, height, params) : undefined;
      if (baseSwim !== undefined && params.idleSwimFrac) {
        const maxSwim = (params.swimSpeedMaxFrac ?? 0.06) * Math.min(width, height);
        baseSwim = Math.max(params.idleSwimFrac * maxSwim, baseSwim);
      }
      const burst = useKick ? startleBurstSpeed(startle, baseR, params) : 0;
      const swimPx = baseSwim !== undefined ? baseSwim + burst : burst > 0 ? burst : undefined;
      wander = wanderStep(wander, dt, width, height, baseR, params, swimPx);
      // Blend between rest center (width/2, height/2) and full-wander position
      const driftedX = width / 2 + (wander.x - width / 2) * drift01;
      const driftedY = height / 2 + (wander.y - height / 2) * drift01;
      let cx = driftedX + sdx;
      let cy = driftedY + sdy;
      const maxRadius = membraneMaxRadius(width, height);
      const floorRadius = baseR * 0.35;
      const sampleCount = deform.length;

      // Commit 31b (gate OFF by default): the authentic asymmetric slipper. The
      // profile carries the WHOLE body form (aspect + fore-aft taper), so it
      // REPLACES the radial deform[] shape. It lives in deform[] so the cilia
      // (which read the same {deform, squeezeK, squeezePhi} contour) ride the
      // slipper automatically. `bodyHeading` is the previous frame's smoothed
      // value here (recomputed below); a one-frame-stale heading is invisible.
      if (params.enableBodyProfile) {
        deform = bodyProfileDeform(sampleCount, bodyHeading, baseR, params);
      }

      // v3.7B: oral groove — a smooth ventral concavity. Applied AFTER the
      // profile (additive inward dip). No-op when enableOralGroove is false.
      applyOralGroove(deform, bodyHeading, params);

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
      // Interior heading: slow EMA chasing bodyHeading so organelles don't jitter.
      const iTau = params.interiorHeadingTau ?? 0;
      if (iTau > 0) {
        const iAlpha = 1 - Math.exp(-dt / iTau);
        // Chase bodyHeading with angle wrapping
        let iDelta = bodyHeading - interiorHeading;
        if (iDelta > Math.PI) iDelta -= TAU;
        if (iDelta < -Math.PI) iDelta += TAU;
        interiorHeading += iAlpha * iDelta;
      } else {
        interiorHeading = bodyHeading; // legacy: same as body
      }
      // H4: record this frame's flow source for the NEXT frame's mote advection.
      flowCx = cx; flowCy = cy; flowHeading = bodyHeading; flowSpeed = curSpeed;
      // Step 8: D4 area-preserving affine squeeze on the contour POINTS in the
      // body-heading frame. k=prolateAspect(speedNorm) (round at rest -> identity
      // when still), phi=bodyHeading; det=1 keeps the C1 area. Gated by
      // enableAffine; identity (k=1) when off OR when speedNorm=0.
      // Commit 31b: when the slipper profile is on, the profile already carries
      // the aspect AND heading (baked into bodyProfileDeform), so FORCE k=1 here
      // to stop the affine from double-elongating. Otherwise the legacy path.
      const squeezeK = params.enableBodyProfile
        ? 1
        : params.enableAffine
          ? prolateAspect(speedNorm, params)
          : 1;
      // Commit 24 + Step A+B: axial spin. A near-rigid spindle SPINS about its
      // long axis as it swims. Advance phase by current rate*dt; never use
      // rate(currentSpeed)*simTime, which spikes at recording onset after uptime.
      axialSpinPhase = advanceAxialSpinPhase(axialSpinPhase, dt, speedNorm, params);
      const spinPhi = axialSpinPhase;
      const squeezePhi = bodyHeading + spinPhi;

      // v3.8B: helical swimming — lateral sinusoidal offset perpendicular to heading.
      // Real Paramecium swims a left-handed helix; 2D projection = sine wave ⊥ swim.
      // Phase reuses spinPhi (the axial rotation already computed). Applied to the
      // RENDER position (cx,cy + smoothedPoints), NOT to wander state.
      const [hdx, hdy] = helicalOffset(spinPhi, bodyHeading, baseR, params);
      if (hdx !== 0 || hdy !== 0) {
        cx += hdx;
        cy += hdy;
        for (let i = 0; i < smoothedPoints.length; i++) {
          smoothedPoints[i] = [smoothedPoints[i][0] + hdx, smoothedPoints[i][1] + hdy];
        }
      }

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
          // Commit 22b: somatic-mex param swap. somaticCiliaParams returns
          // `params` UNCHANGED BY REFERENCE when enableSomaticCilia is off, so the
          // default path allocates nothing and stays byte-identical. When on it
          // raises the base count to somaticCiliaCount (72) and shortens hairs to
          // somaticCiliaLength (0.15). enablePerimeterCount can still further
          // override the count from the perimeter; the two compose cleanly because
          // effectiveCount falls back to baseCiliaParams.ciliaCount.
          const baseCiliaParams = somaticCiliaParams(params);
          const effectiveCount = params.enablePerimeterCount
            ? perimeterCiliaCount(baseR, params)
            : baseCiliaParams.ciliaCount;
          const ciliaParams = params.enableActivity
            ? {
                ...baseCiliaParams,
                ciliaCount: effectiveCount,
                ciliaBeatHz: ciliaBeatHzEff(activity, params),
                ciliaCurl: baseCiliaParams.ciliaCurl * (1 + 0.3 * activity),
              }
            : (params.enablePerimeterCount ? { ...baseCiliaParams, ciliaCount: effectiveCount } : baseCiliaParams);
          ciliaBeatCycles = advanceCiliaBeatCycles(ciliaBeatCycles, dt, ciliaParams.ciliaBeatHz ?? 0.9);
          // D2: motion basis so the crown leans rearward while swimming. Tangent
          // is the body heading; speedNorm gates it (0 at rest => identity).
          const ciliaMotion: CiliaMotion = {
            tx: Math.cos(bodyHeading),
            ty: Math.sin(bodyHeading),
            speedNorm,
            beatCycles: ciliaBeatCycles,
            // F4/G3: how coherently the crown rows toward the heading, gated by
            // activity (idle ~isotropic, active coherent). 0 when activity off.
            axisStrength: params.enableActivity ? strokeAxisStrength(activity, params) : 0,
            // Commit 22b: anchor hair bases on the real deformed+squeezed contour.
            // ciliaPath ignores `contour` unless enableCiliaOnContour is on, but we
            // only attach it on the gated path so the default path allocates no
            // extra object and the frozen GATES_OFF / commit-21b golden stays
            // byte-identical. `deform` is non-null here (assigned this tick), the
            // guard just narrows the number[] | null type.
            ...(params.enableCiliaOnContour && deform
              ? { contour: { deform, squeezeK, squeezePhi } }
              : {}),
          };
          const cilia = ciliaPath(cx, cy, baseR, t, energy, growth, ciliaParams, ciliaMotion);
          ctx.lineCap = "round";
          for (const hair of cilia) {
            ctx.lineWidth = hair.width; // per-hair thickness (diverse)
            ctx.strokeStyle = hsla(baseHue, params.ciliaSat ?? 0.60, 0.6, 0.35 + 0.35 * energy);
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

        // --- v3.8E+v3.9B: Trichocyst discharge ---
        // Paramecium discharges crystalline trichocyst needles radially outward
        // from the pellicle on startle (defense reflex). Drawn AFTER cilia so
        // needles visually project THROUGH the fringe.
        // v3.9B: trichocystAlpha decays independently via trichocystDecay param
        // (decoupled from startle fade), making needles visible ~500ms.
        if (params.enableTrichocysts) {
          // Detect startle onset (rising edge) to re-fire trichocystAlpha
          if (startle > triPrevStartle + 0.02) {
            trichocystAlpha = 1.0;
          }
          // Exponential decay at trichocystDecay rate (default 1.0 = ~3.5s visible)
          const triDecayRate = params.trichocystDecay ?? 1.0;
          trichocystAlpha *= Math.exp(-triDecayRate * dt);
          if (trichocystAlpha < 0.005) trichocystAlpha = 0;
          triPrevStartle = startle;
        }
        if (params.enableTrichocysts && trichocystAlpha > 0.005) {
          const triCount = params.trichocystCount ?? 30;
          // Use somatic cilia length (0.15) not legacy ciliaLength (0.4)
          const effectiveCiliaLen = params.enableSomaticCilia
            ? (params.somaticCiliaLength ?? 0.15)
            : (params.ciliaLength ?? 0.45);
          const triLen = (params.trichocystLengthMul ?? 3.0) * baseR * effectiveCiliaLen;
          const triAlpha = trichocystAlpha * 0.7;
          ctx.save();
          ctx.strokeStyle = hsla(0, 0.0, 0.95, triAlpha);
          ctx.lineWidth = params.trichocystLineWidth ?? 1.5;
          ctx.lineCap = "round";
          // Use uniformly-spaced points on the deformed+squeezed membrane contour
          const cN = contourPoints.length;
          for (let i = 0; i < triCount; i++) {
            const idx = Math.round(i * cN / triCount) % cN;
            const [px, py] = contourPoints[idx];
            // Local outward normal from adjacent contour tangent
            const prev = contourPoints[(idx - 1 + cN) % cN];
            const next = contourPoints[(idx + 1) % cN];
            const tx = next[0] - prev[0];
            const ty = next[1] - prev[1];
            // Perpendicular to tangent (candidate outward normal)
            let nx = ty;
            let ny = -tx;
            const nLen = Math.hypot(nx, ny);
            if (nLen < 1e-6) continue; // degenerate segment, skip
            nx /= nLen;
            ny /= nLen;
            // Verify outward: dot with centroid-to-point must be positive
            if (nx * (px - cx) + ny * (py - cy) < 0) {
              nx = -nx;
              ny = -ny;
            }
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(px + nx * triLen, py + ny * triLen);
            ctx.stroke();
          }
          ctx.restore();
        }

        // --- Fill: translucent cytoplasm ---
        // Resolved organelle hues (overridable via params, defaults = legacy)
        const cvH = params.cvHue ?? (baseHue + 20);
        const fvH = params.foodVacuoleHue ?? (baseHue - 30);
        const fvSat = params.foodVacuoleSat ?? 0.4;
        ctx.fillStyle = hsla(baseHue, params.cytoplasmSat ?? 0.70, 0.55, effectiveFillAlpha);
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
        grad.addColorStop(0, hsla(baseHue + 10, (params.cytoplasmSat ?? 0.70) * 0.71, 0.7, effectiveFillAlpha * 0.5));
        grad.addColorStop(1, hsla(baseHue, params.cytoplasmSat ?? 0.70, 0.45, effectiveFillAlpha));
        ctx.fillStyle = grad;
        ctx.fill();

        // --- v3.7D: Ectoplasm/endoplasm boundary ---
        // In DIC micrographs there is a clear cortical rim between the
        // membrane and the granular endoplasm. We draw it as a thin,
        // low-alpha inner contour scaled toward the centroid.
        if (params.enableEctoplasm) {
          const ectoFrac = params.ectoplasmFrac ?? 0.85;
          const ectoAlpha = params.ectoplasmAlpha ?? 0.15;
          ctx.save();
          ctx.beginPath();
          const ex0 = cx + (splinePoints[0][0] - cx) * ectoFrac;
          const ey0 = cy + (splinePoints[0][1] - cy) * ectoFrac;
          ctx.moveTo(ex0, ey0);
          for (let i = 1; i < splinePoints.length; i++) {
            ctx.lineTo(
              cx + (splinePoints[i][0] - cx) * ectoFrac,
              cy + (splinePoints[i][1] - cy) * ectoFrac,
            );
          }
          ctx.closePath();
          ctx.strokeStyle = hsla(baseHue, (params.membraneSat ?? 0.85) * 0.5, effectiveMembraneLightness, ectoAlpha);
          ctx.lineWidth = 0.5;
          ctx.stroke();
          ctx.restore();
        }

        // Clip all internal organelles to the live cell silhouette. interiorPoint
        // guarantees centers are inside, but rendered radii (food vacuoles/CVs)
        // can otherwise protrude beyond the membrane near the cortex.
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(splinePoints[0][0], splinePoints[0][1]);
        for (let i = 1; i < splinePoints.length; i++) {
          ctx.lineTo(splinePoints[i][0], splinePoints[i][1]);
        }
        ctx.closePath();
        if (typeof ctx.clip === "function") ctx.clip();

        // --- Nucleus: denser organelle drifting/pulsing inside the cell ---
        // F9: thread the LIVE minimum membrane radius so a deep inward pinch
        // cannot let the nucleus poke through the wall.
        let minMembraneR = Infinity;
        for (const dv of deform) minMembraneR = Math.min(minMembraneR, baseR * (1 + dv));
        const nucleus = nucleusTransform(t, audioLevel, baseR, params, minMembraneR);
        if (nucleus.r >= 2.5) {
          // Commit 32e: the macronucleus is a cortically-anchored organelle. On
          // the interior-field path it is placed via interiorPoint at the FIXED
          // body-normalised anchor (macronucleusU, macronucleusS) so it rides the
          // elongated deforming wall (axial spin + ventral bend), reusing the
          // SAME per-frame profile cache + InteriorCtx that micronucleus reuses.
          // The radius (+ audio pulse) still comes from nucleusTransform.
          let nx: number, ny: number;
          let macroIctx: InteriorCtx | null = null;
          if (params.enableInteriorField) {
            const profilePts = buildProfilePts(baseR, params);
            macroIctx = {
              cx, cy, baseR, deform, squeezeK, squeezePhi, bodyHeading: interiorHeading, params, profilePts,
            };
            const uM = params.macronucleusU ?? -0.05;
            const sM = params.macronucleusS ?? 0.1;
            [nx, ny] = interiorPoint(uM, sM, macroIctx);
          } else {
            // LEGACY path — VERBATIM (do not tidy). M14: the nucleus rides the
            // same body affine squeeze (k, phi) as the membrane, so when the body
            // becomes prolate (Commit 8/D4) the nucleus stays inside on both axes.
            // While enableAffine is off (k=1) this is a no-op; the squeeze maps
            // the CENTRE (the disk gains an elliptical draw when D4 lands).
            [nx, ny] = affineSqueezePoints(
              [[cx + nucleus.cx, cy + nucleus.cy]], squeezeK, squeezePhi, cx, cy, params,
            )[0];
          }
          const nr = nucleus.r;

          // Soft radial gradient: denser warmer core → darker rim
          const nucGrad = ctx.createRadialGradient(nx, ny, 0, nx, ny, nr);
          // Hue shifted slightly warmer/darker vs the amber cytoplasm base
          const nSm = params.nucleusSatMul ?? 1.0;
          nucGrad.addColorStop(0, hsla(baseHue - 5, 0.80 * nSm, 0.48, params.nucleusAlpha));
          nucGrad.addColorStop(0.4, hsla(baseHue - 8, 0.75 * nSm, 0.40, params.nucleusAlpha));
          nucGrad.addColorStop(1, hsla(baseHue - 10, 0.65 * nSm, 0.30, params.nucleusAlpha * 0.7));

          ctx.fillStyle = nucGrad;
          ctx.beginPath();
          // Commit v3.5F: ellipse aligned with the body axis when interior field is on
          const nAspect = params.nucleusAspect ?? 1.8;
          if (params.enableInteriorField && nAspect !== 1) {
            // Align with bodyHeading (NOT squeezePhi) — the macronucleus is
            // anchored in the cytoplasm and rotates with the body, not with
            // the fast axial spin (which is a surface/cilia phenomenon).
            const nIndent = params.nucleusIndent ?? 0;
            if (nIndent > 0) {
              // Commit v4.0D: kidney/bean shape — ellipse with cosine indent
              // on one flank (sin(t) > 0 side) where the micronucleus sits.
              const kSteps = 32;
              const ch = Math.cos(bodyHeading);
              const sh = Math.sin(bodyHeading);
              for (let ki = 0; ki <= kSteps; ki++) {
                const t = (ki / kSteps) * TAU;
                const ct = Math.cos(t);
                const st = Math.sin(t);
                // Pull inward on one flank: r(θ) modulated by sin²(θ)
                const kidFrac = st > 0 ? 1 - nIndent * st * st : 1;
                const ex = ct * nr * nAspect;
                const ey = st * nr * kidFrac;
                const rx = nx + ex * ch - ey * sh;
                const ry = ny + ex * sh + ey * ch;
                if (ki === 0) ctx.moveTo(rx, ry);
                else ctx.lineTo(rx, ry);
              }
              ctx.closePath();
            } else {
              ctx.ellipse(nx, ny, nr * nAspect, nr, bodyHeading, 0, TAU);
            }
          } else {
            ctx.arc(nx, ny, nr, 0, TAU);
          }
          ctx.fill();

          // Nucleolus — tiny brighter dot at the centre for organelle detail
          ctx.fillStyle = hsla(baseHue + 5, 0.55, 0.72, params.nucleusAlpha * 0.8);
          ctx.beginPath();
          ctx.arc(nx, ny, nr * 0.22, 0, TAU);
          ctx.fill();

          // Commit 28 (gate OFF): MICRONUCLEUS — a small dense nucleus sitting
          // just beside the macronucleus. nx,ny is the SQUEEZED macronucleus
          // centre and nr its radius, so the micronucleus tracks the prolate
          // body too. Skipped unless enableOrganelles is on -> goldens unchanged.
          if (params.enableOrganelles) {
            if (params.enableInteriorField && macroIctx) {
              // Commit 32e: micronucleus docked beside the macronucleus, anchored
              // at the macronucleus (u, s) plus a small fixed delta toward the
              // anterior-dorsal side and placed via interiorPoint (reusing the
              // macronucleus InteriorCtx). Containment is automatic (|s| <= 1).
              const uM = params.macronucleusU ?? -0.05;
              const sM = params.macronucleusS ?? 0.1;
              const [mcx, mcy] = interiorPoint(uM + 0.12, sM + 0.3, macroIctx);
              const mr = nr * (params.micronucleusSizeFrac ?? 0.32);
              ctx.fillStyle = hsla(baseHue - 6, 0.82, 0.42, params.nucleusAlpha);
              ctx.beginPath();
              ctx.arc(mcx, mcy, mr, 0, TAU);
              ctx.fill();
            } else {
              // LEGACY path — VERBATIM (do not tidy).
              const mn = micronucleusTransform(nx, ny, nr, params);
              // Containment: pull the micronucleus centre inward along the line from
              // the body centre so its OUTER edge can't poke past a pinched wall
              // (the macronucleus is only clamped to minMembraneR*0.85, and the
              // micronucleus sits ~1.15*nr beyond it). Gated path => goldens unchanged.
              let mcx = mn.cx;
              let mcy = mn.cy;
              const ddx = mcx - cx;
              const ddy = mcy - cy;
              const dist = Math.hypot(ddx, ddy);
              const maxDist = Math.max(0, minMembraneR - mn.r);
              if (dist > maxDist && dist > 0) {
                const s = maxDist / dist;
                mcx = cx + ddx * s;
                mcy = cy + ddy * s;
              }
              ctx.fillStyle = hsla(baseHue - 6, 0.82, 0.42, params.nucleusAlpha);
              ctx.beginPath();
              ctx.arc(mcx, mcy, mn.r, 0, TAU);
              ctx.fill();
            }
          }
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
            ctx.fillStyle = hsla(cvH, 0.45, 0.70, params.nucleusAlpha * 0.45);
            ctx.beginPath();
            ctx.arc(vx, vy, vac.r, 0, TAU);
            ctx.fill();
          }
        }

        // Commit 26 (gate OFF): the PLURAL pair of asynchronous contractile
        // vacuoles (anterior + posterior). contractileVacuolePair returns the
        // pair's world bearings + live radii (reusing the single-vacuole
        // fill/collapse curve per CV). Each is placed + clamped + squeezed with
        // the same pattern as the single block. Skipped (returns []) unless
        // enableVacuoles is on, so all goldens stay byte-identical.
        if (params.enableVacuoles) {
          const pair = contractileVacuolePair(t, baseR, squeezePhi, params);
          if (params.enableInteriorField) {
            // Commit 32e: the two contractile vacuoles are cortically anchored at
            // FIXED body-normalised (u, s) (anterior + posterior) and placed via
            // interiorPoint so they ride the elongated deforming wall. The live
            // radii still come from contractileVacuolePair (pair[0]=anterior,
            // pair[1]=posterior); pair[i].bearing is unused on this path.
            // Containment is automatic (|s| <= 1).
            const profilePts = buildProfilePts(baseR, params);
            const ictx: InteriorCtx = {
              cx, cy, baseR, deform, squeezeK, squeezePhi, bodyHeading: interiorHeading, params, profilePts,
            };
            const anchors = [
              { u: params.cvAnteriorU ?? 0.55, s: params.cvAnteriorS ?? 0.62 },
              { u: params.cvPosteriorU ?? -0.55, s: params.cvPosteriorS ?? 0.62 },
            ];
            for (let i = 0; i < pair.length; i++) {
              const e = pair[i];
              if (e.r < 0.5) continue;
              const [vx, vy] = interiorPoint(anchors[i].u, anchors[i].s, ictx);
              ctx.fillStyle = hsla(cvH, 0.45, 0.70, params.nucleusAlpha * 0.45);
              ctx.beginPath();
              ctx.arc(vx, vy, e.r, 0, TAU);
              ctx.fill();
              // CV radial canals — star shape (biologist: 6-7 canals, visible during diastole)
              if (params.enableCVCanals && e.r > 1.0) {
                const canalCount = 6;
                const canalLen = e.r * (params.canalLenMul ?? 2.0);
                const canalAlpha = params.nucleusAlpha * 0.45 * (params.canalAlphaMul ?? 0.3);
                ctx.strokeStyle = hsla(cvH, 0.30, 0.72, canalAlpha);
                ctx.lineWidth = params.canalLineWidth ?? 0.5;
                for (let ci = 0; ci < canalCount; ci++) {
                  const angle = (ci / canalCount) * TAU;
                  ctx.beginPath();
                  ctx.moveTo(vx, vy);
                  ctx.lineTo(vx + Math.cos(angle) * canalLen, vy + Math.sin(angle) * canalLen);
                  ctx.stroke();
                }
              }
            }
          } else {
            // LEGACY path — VERBATIM (do not tidy).
            for (const e of pair) {
              if (e.r < 0.5) continue;
              // Containment: clamp placeR so the WHOLE vesicle stays inside the
              // live minimum membrane radius, even when a pinch brings the wall in.
              const placeR = Math.max(0, Math.min(baseR * 0.6, minMembraneR - e.r));
              const vcx0 = cx + Math.cos(e.bearing) * placeR;
              const vcy0 = cy + Math.sin(e.bearing) * placeR;
              const [vx, vy] = affineSqueezePoints(
                [[vcx0, vcy0]], squeezeK, squeezePhi, cx, cy, params,
              )[0];
              ctx.fillStyle = hsla(cvH, 0.45, 0.70, params.nucleusAlpha * 0.45);
              ctx.beginPath();
              ctx.arc(vx, vy, e.r, 0, TAU);
              ctx.fill();
              // CV radial canals — star shape (biologist: 6-7 canals, visible during diastole)
              if (params.enableCVCanals && e.r > 1.0) {
                const canalCount = 6;
                const canalLen = e.r * (params.canalLenMul ?? 2.0);
                const canalAlpha = params.nucleusAlpha * 0.45 * (params.canalAlphaMul ?? 0.3);
                ctx.strokeStyle = hsla(cvH, 0.30, 0.72, canalAlpha);
                ctx.lineWidth = params.canalLineWidth ?? 0.5;
                for (let ci = 0; ci < canalCount; ci++) {
                  const angle = (ci / canalCount) * TAU;
                  ctx.beginPath();
                  ctx.moveTo(vx, vy);
                  ctx.lineTo(vx + Math.cos(angle) * canalLen, vy + Math.sin(angle) * canalLen);
                  ctx.stroke();
                }
              }
            }
          }
        }

        // Commit 27 (gate OFF): cytoplasmic streaming (cyclosis) granules. A
        // field of small warm dots circulates on a divergence-free closed loop
        // inside the body, filling the otherwise near-empty interior. Draw-only:
        // seeded lazily once, advected in body-frame, clamped inside the live
        // minimum membrane radius, then squeezed with the same body affine so
        // they ride the prolate/spin. Skipped (granules stays null) unless
        // enableCyclosis is on, so all goldens stay byte-identical.
        if (params.enableCyclosis && (params.cyclosisGranuleCount ?? 0) > 0) {
          const granuleSizePx = params.granuleSizePx ?? 1.3;
          ctx.fillStyle = hsla(baseHue + 25, params.granuleSat ?? 0.60, 0.6, params.nucleusAlpha * 0.6);
          if (params.enableInteriorField) {
            // Commit 32c (gate ON): body-coord path. Granules CIRCULATE on a
            // divergence-free streamfunction loop (cyclosisLoopPoint) in (u, s)
            // and are drawn via interiorPoint, so they fill the whole slipper,
            // reach the poles, and deform WITH the live wall. The 96-sample
            // profile table is built ONCE per frame (buildProfilePts) and shared
            // via ictx.profilePts so interiorPoint skips its per-call loop.
            if (!interiorGranules) {
              interiorGranules = seedInteriorGranules(params.cyclosisGranuleCount ?? 0, 0, params);
            }
            const profilePts = buildProfilePts(baseR, params);
            const ictx: InteriorCtx = {
              cx, cy, baseR, deform, squeezeK, squeezePhi, bodyHeading: interiorHeading, params, profilePts,
            };
            for (let i = 0; i < interiorGranules.length; i++) {
              const g = interiorGranules[i];
              const loop = cyclosisLoopPointAtPhase(g, cyclosisPhase);
              const [gx, gy] = interiorPoint(loop.u, loop.s, ictx);
              ctx.beginPath();
              ctx.arc(gx, gy, granuleSizePx, 0, TAU);
              ctx.fill();
            }
          } else {
            // LEGACY disc path — VERBATIM (do not tidy), so the deployed look +
            // golden are unchanged.
            if (!granules) granules = seedGranules(baseR, params);
            for (let i = 0; i < granules.length; i++) {
              granules[i] = advectGranule(granules[i], baseR, dt, cyclParams);
              const off = granules[i];
              // Containment: clamp the body-frame radius so granule + draw size
              // stays inside the live minimum membrane radius (like the vacuoles).
              const maxRad = Math.min(
                (params.granuleMaxRadiusFrac ?? 0.75) * baseR,
                Math.max(0, minMembraneR - granuleSizePx),
              );
              const rad = Math.hypot(off.x, off.y);
              const scale = rad > maxRad && rad > 0 ? maxRad / rad : 1;
              const [gx, gy] = affineSqueezePoints(
                [[cx + off.x * scale, cy + off.y * scale]], squeezeK, squeezePhi, cx, cy, params,
              )[0];
              ctx.beginPath();
              ctx.arc(gx, gy, granuleSizePx, 0, TAU);
              ctx.fill();
            }
          }
        }

        // Commit 28 (gate OFF): FOOD VACUOLES — a few larger digesting spheres
        // that ride the SAME cyclosis loop as the granules (advectFoodVacuole
        // reuses cyclosisField) and slowly shrink over their digest cycle before
        // resetting. Body-frame offsets, clamped inside the live minimum membrane
        // radius then squeezed with the body affine. Skipped (foodVacuoles stays
        // null) unless enableOrganelles is on, so all goldens stay byte-identical.
        if (params.enableOrganelles && (params.foodVacuoleCount ?? 0) > 0) {
          const fvSizePx = (params.foodVacuoleSizePx ?? 3.0) * (params.foodVacuoleSizeMul ?? 1.0);
          if (params.enableInteriorField) {
            // Commit 32d (gate ON): body-coord path. Food vacuoles ride the SAME
            // divergence-free streamfunction loop as the granules
            // (cyclosisLoopPoint) in (u, s) and are drawn via interiorPoint, so
            // they circulate through the elongated body to the poles and deform
            // WITH the live wall. Containment is automatic (|s| <= 1). The digest
            // shrink is preserved via foodVacuoleSize (reused unchanged).
            if (!interiorFoodVacuoles) {
              interiorFoodVacuoles = seedInteriorFoodVacuoles(params.foodVacuoleCount ?? 0, params);
            }
            const profilePts = buildProfilePts(baseR, params);
            const ictx: InteriorCtx = {
              cx, cy, baseR, deform, squeezeK, squeezePhi, bodyHeading: interiorHeading, params, profilePts,
            };
            for (let i = 0; i < interiorFoodVacuoles.length; i++) {
              const fv = interiorFoodVacuoles[i];
              const loopRaw = cyclosisLoopPointAtPhase(fv, cyclosisPhase); // same phase as granules
              // Food vacuoles are large endoplasmic bodies: keep their centres
              // off the pellicle so their radius doesn't read as membrane-stuck.
              const fvMaxAmp = params.foodVacuoleLoopMaxAmp ?? 0.82;
              const fvAmp = Math.hypot(loopRaw.u, loopRaw.s);
              const fvScale = fvAmp > fvMaxAmp && fvAmp > 0 ? fvMaxAmp / fvAmp : 1;
              const loop = { u: loopRaw.u * fvScale, s: loopRaw.s * fvScale };
              const size = foodVacuoleSize(t, fv.digestPhase, params); // digest shrink (reuse)
              const drawR = fvSizePx * (0.4 + 0.6 * size);
              const [fx, fy] = interiorPoint(loop.u, loop.s, ictx);
              ctx.fillStyle = hsla(fvH, fvSat, 0.5, params.nucleusAlpha * 0.4);
              ctx.beginPath();
              ctx.arc(fx, fy, drawR, 0, TAU);
              ctx.fill();
              ctx.strokeStyle = hsla(fvH, fvSat * 1.125, 0.35, params.nucleusAlpha * 0.5);
              ctx.lineWidth = 0.8;
              ctx.stroke();
            }
          } else {
            // LEGACY disc path — VERBATIM (do not tidy), so the deployed look +
            // golden are unchanged.
            if (!foodVacuoles) foodVacuoles = seedFoodVacuoles(baseR, params);
            for (let i = 0; i < foodVacuoles.length; i++) {
              foodVacuoles[i] = advectFoodVacuole(foodVacuoles[i], baseR, dt, params);
              const v = foodVacuoles[i];
              const size = foodVacuoleSize(t, v.phase, params);
              const drawR = fvSizePx * (0.4 + 0.6 * size); // shrink as digested
              // Containment: clamp the body-frame radius so vacuole + draw size
              // stays inside the live minimum membrane radius.
              const maxRad = Math.min(
                (params.foodVacuoleMaxRadiusFrac ?? 0.62) * baseR,
                Math.max(0, minMembraneR - drawR),
              );
              const rad = Math.hypot(v.x, v.y);
              const scale = rad > maxRad && rad > 0 ? maxRad / rad : 1;
              const [fx, fy] = affineSqueezePoints(
                [[cx + v.x * scale, cy + v.y * scale]], squeezeK, squeezePhi, cx, cy, params,
              )[0];
              // Translucent olive/greenish fill with a slightly darker rim.
              ctx.fillStyle = hsla(fvH, fvSat, 0.5, params.nucleusAlpha * 0.4);
              ctx.beginPath();
              ctx.arc(fx, fy, drawR, 0, TAU);
              ctx.fill();
              ctx.strokeStyle = hsla(fvH, fvSat * 1.125, 0.35, params.nucleusAlpha * 0.5);
              ctx.lineWidth = 0.8;
              ctx.stroke();
            }
          }
        }

        ctx.restore();

        // --- Stroke: iridescent outline ---
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        const mSat = params.membraneSat ?? 0.85;
        ctx.strokeStyle = hsla(baseHue, mSat * 0.94, effectiveMembraneLightness, 0.9);
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

          ctx.strokeStyle = hsla(hue, mSat, effectiveMembraneLightness, 0.85);
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
