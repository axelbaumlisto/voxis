import { TAU } from "../shared";

type AxialSpinParams = {
  enableAxialSpin?: boolean;
  axialSpinMax?: number;
};

type CyclosisPhaseParams = {
  cyclosisPeriod?: number;
  cyclosisSense?: number;
};

/**
 * Step A+B: dt-integrated axial spin phase for the live render loop.
 * Unlike `axialSpin(simTime, speedNorm)`, the increment depends only on the
 * current frame's bounded rate and dt, so speed/activity changes cannot multiply
 * by the renderer's total elapsed time.
 */
export function advanceAxialSpinPhase(
  prevPhase: number,
  dt: number,
  speedNorm: number,
  params: AxialSpinParams,
): number {
  if (!params.enableAxialSpin) return 0;
  const safeDt = Math.max(0, Number.isFinite(dt) ? dt : 0);
  const s = speedNorm < 0 ? 0 : speedNorm > 1 ? 1 : speedNorm;
  return prevPhase - (params.axialSpinMax ?? 0) * s * safeDt;
}

export function advanceCyclosisPhase(prevPhase: number, dt: number, params: CyclosisPhaseParams): number {
  const safeDt = Math.max(0, Number.isFinite(dt) ? dt : 0);
  const T = Math.max(0.1, params.cyclosisPeriod ?? 45);
  const sense = (params.cyclosisSense ?? 1) >= 0 ? 1 : -1;
  return prevPhase + sense * (TAU / T) * safeDt;
}

export function advanceCiliaBeatCycles(prevCycles: number, dt: number, hz: number): number {
  const safeDt = Math.max(0, Number.isFinite(dt) ? dt : 0);
  const next = prevCycles + Math.max(0, Number.isFinite(hz) ? hz : 0) * safeDt;
  return ((next % 1) + 1) % 1;
}
