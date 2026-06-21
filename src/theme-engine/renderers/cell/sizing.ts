import type { CellParams } from "./types";
import { TAU } from "../shared";

/**
 * Membrane clamp ceiling (step-9 safety net) [B1 radius budget].
 *
 * The membrane is contained by the SHORTER window side so a non-square overlay
 * never clips the cell on its narrow axis: `maxRadius = min(w,h)*0.46`. This is
 * the MEMBRANE radius only — distinct from {@link cellReach}, which also budgets
 * cilia + drag-lean for whole-organism wall containment. With B1 saturation the
 * deformation is bounded by Dmax, so `baseR*(1+Dmax) <= maxRadius` and this
 * clamp is provably a no-op under normal audio (the saturation, not the clamp,
 * keeps the radius in budget).
 */
export function membraneMaxRadius(width: number, height: number): number {
  return Math.min(width, height) * 0.46;
}

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

/**
 * E1 (OPT) — perimeter-driven cilia count. A bigger cell should carry more
 * hairs at roughly constant arc spacing, not a fixed number. Returns
 * `round(2*pi*baseR / ciliaSpacingPx)`, at least 1 and capped by `ciliaCount`
 * (so it never explodes on a huge overlay). Pure & deterministic.
 */
export function perimeterCiliaCount(baseR: number, params: CellParams): number {
  const spacing = Math.max(0.5, params.ciliaSpacingPx ?? 8);
  const n = Math.round((TAU * Math.max(0, baseR)) / spacing);
  const cap = Math.max(1, params.ciliaCount);
  return Math.max(1, Math.min(cap, n));
}

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
  // F12: match the ACTUAL worst-case cilium in ciliaPath, which the old 1.3
  // factor underestimated (so the longest hairs clipped the wall).
  //  lenMean = baseR*(ciliaLength + growth*boost)*(0.55 + 0.45*energy)
  //          ≤ baseR*(ciliaLength + boost)            (growth=1, energy=1)
  //  longest hair: lenK = lenMean*(1 - lenVar + 2*lenVar*r01), max at r01=1
  //          → lenMean*(1 + lenVar)
  //  so the tip sits at radial distance `along` = baseR + lenK_max.
  const lenVar = Math.max(0, Math.min(0.95, params.ciliaLengthVar ?? 0));
  const longestAlong = baseR + baseR * (ciliaLength + ciliaGrowthBoost) * (1 + lenVar);
  // The transverse bend is capped (F2) at 0.5*gap*along, so the tip's distance
  // from centre is along*sqrt(1 + (0.5*gap)^2); include that headroom too.
  const ciliaCount = params.ciliaCount ?? 0;
  const gap = ciliaCount > 0 ? TAU / ciliaCount : 0;
  const ciliaOuter = longestAlong * Math.sqrt(1 + 0.25 * gap * gap);

  return Math.max(membraneOuter, ciliaOuter) + startleMaxPx;
}
