import { TAU } from "../shared";
import type { CellParams } from "./types";

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
  const base = 1 + elong * Math.max(floor, s); // EXISTING expression, untouched
  if (!params.enableRestingProlate) return base; // OFF => byte-identical
  const rest = params.prolateRestAspect ?? 1.7;
  // Resting spindle: at least `rest` at rest, and never less than the speed-driven
  // base (so swimming can still elongate further). max keeps it monotone in speed.
  return Math.max(rest, base);
}

/**
 * Commit 24 — AXIAL SPIN. A real Paramecium is a near-rigid spindle that SPINS
 * about its long axis (~0.5-2 rev/s, LEFT-handed) as it swims; the apparent
 * "breathe/contract-expand" is the 2D foreshortening of that rotating spindle.
 * We model it as a pure body-frame ROTATION of the existing area-preserving
 * affine squeeze: this returns the spin PHASE offset (radians) to ADD to
 * `squeezePhi`. Because the affine map is `R(phi).diag(k,1/k).R(-phi)` with
 * det=1, rotating its frame leaves the cell's AREA invariant — the spin only
 * re-orients the elongation, it does not change size.
 *
 *   rate = axialSpinMax * clamp01(speedNorm)   (rad/s, bounded, ZERO at rest)
 *   phase = -rate * simTime                     (LEFT-handed => negative sign)
 *
 * This pure helper is retained for compatibility/tests. The live renderer uses
 * `advanceAxialSpinPhase`, because activity-dependent `rate * simTime` creates
 * phase spikes when speed changes after a long elapsed time.
 */
export function axialSpin(simTime: number, speedNorm: number, params: CellParams): number {
  if (!params.enableAxialSpin) return 0;
  const s = speedNorm < 0 ? 0 : speedNorm > 1 ? 1 : speedNorm; // clamp01
  const rate = (params.axialSpinMax ?? 0) * s; // rad/s, proportional to speed
  const leftHanded = -TAU / TAU;
  return leftHanded * rate * simTime; // LEFT-handed spin => negative
}

/**
 * v3.8B: helical swimming offset.
 * Returns the (dx, dy) lateral displacement perpendicular to bodyHeading.
 * Phase = spinPhi (axial spin phase). Amplitude = helicalAmplitude × baseR.
 * Default 0 = no offset = byte-identical to legacy.
 */
export function helicalOffset(
  spinPhi: number,
  bodyHeading: number,
  baseR: number,
  params: Pick<CellParams, "helicalAmplitude">,
): [number, number] {
  const hAmp = params.helicalAmplitude ?? 0;
  if (hAmp === 0 || spinPhi === 0) return [0, 0];
  const lateralOffset = hAmp * baseR * Math.sin(spinPhi);
  return [
    lateralOffset * -Math.sin(bodyHeading),
    lateralOffset *  Math.cos(bodyHeading),
  ];
}
