import type { VorticellaState } from "../types";
import { TAU, clamp, clamp01, finite, finiteOr, smoothstep } from "../util";

export interface VorticellaGeometryOptions {
  readonly anchorX?: number;
  readonly anchorY?: number;
  readonly restLength?: number;
  readonly minLengthFrac?: number;
  readonly directionAngle?: number;
  readonly coilTurnsRest?: number;
  readonly coilTurnsContracted?: number;
  readonly coilSampleCount?: number;
  readonly coilRadius?: number;
}

export interface AquariumPoint {
  readonly x: number;
  readonly y: number;
}

export interface VorticellaGeometry {
  readonly contractPhase: number;
  readonly anchor: AquariumPoint;
  readonly bellCenter: AquariumPoint;
  readonly stalkLength: number;
  readonly coilTurns: number;
  readonly stalkPath: readonly AquariumPoint[];
}


export function vorticellaBellMetrics(cell: VorticellaState, scale: number, H: number): { D: number; bellHeight: number; restStalk: number } {
  const Hc = Math.max(1, finite(H, 80));
  const Sc = Math.max(0.1, finite(scale, 1));
  const D = clamp((8 + finite(cell.size, 1) * 4) * Sc, 6, Hc * 0.40);
  const bellHeight = 1.45 * D; // elongate inverted bell ~1.4:1 taller than wide (real Vorticella)
  // longer stalk + headroom reserved for the upward crown cilia (~D*0.34 above the
  // rim) so the zooid fills the frame and the crown never clips the top edge.
  // Math-review fix: cap with min() (no D*1.3 floor) so the clamp can never INVERT
  // (lower>upper) at large D and silently defeat the headroom -> crown would clip.
  const restStalk = Math.max(0, Math.min(D * 3.7, Hc - bellHeight - Math.max(10, D * 0.34)));
  return { D, bellHeight, restStalk };
}

export function vorticellaGeometry(
  contractPhase: number,
  options: VorticellaGeometryOptions = {},
): VorticellaGeometry {
  const phase = clamp01(contractPhase);
  const anchorX = finiteOr(options.anchorX, 0);
  const anchorY = finiteOr(options.anchorY, 0);
  const restLength = Math.max(0.001, finiteOr(options.restLength, 10));
  const minLengthFrac = Math.min(1, Math.max(0.12, finiteOr(options.minLengthFrac, 0.35)));
  const angle = finiteOr(options.directionAngle, -Math.PI / 2);
  const coilTurnsRest = Math.max(0, finiteOr(options.coilTurnsRest, 0));
  const coilTurnsContracted = Math.max(coilTurnsRest, finiteOr(options.coilTurnsContracted, 3.5));
  const sampleCount = Math.max(2, Math.floor(finiteOr(options.coilSampleCount, 22)));
  const coilRadiusMax = Math.max(0, finiteOr(options.coilRadius, restLength * 0.18));

  // axial length shrinks with contraction; coil grows from straight → tight helix
  const stalkLength = restLength * (1 - phase * (1 - minLengthFrac));
  const coilTurns = coilTurnsRest + (coilTurnsContracted - coilTurnsRest) * phase;
  const coilRadius = coilRadiusMax * phase;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const nx = -uy;
  const ny = ux;
  const stalkPath: AquariumPoint[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const t = i / (sampleCount - 1);
    const along = stalkLength * t;
    // coil bunches toward the bell end (nucleation front spreads from the zooid)
    // bunch the coil toward the bell end BUT taper the amplitude back to 0 at the very
    // tip (t=1) so the stalk endpoint coincides with the on-axis bellCenter (math-review
    // fix: was leaving a lateral gap up to ~0.2D between stalk tip and bell base).
    const fill = smoothstep(t) * (1 - smoothstep((t - 0.85) / 0.15));
    // 3-D HELIX (NOT a planar zigzag = the confusable genus Haplocaulus): lateral
    // excursion = cos(theta) while the along-axis coordinate gains a sin(theta) loop
    // term, so the projected stalk reads as crossing helical coils, not a flat sine.
    const theta = t * coilTurns * TAU;
    const wave = Math.cos(theta) * coilRadius * fill;
    const loop = Math.sin(theta) * coilRadius * 0.85 * fill; // near-circular helix cross-section -> coils visibly overlap into a corkscrew spring
    stalkPath.push({
      x: anchorX + ux * (along + loop) + nx * wave,
      y: anchorY + uy * (along + loop) + ny * wave,
    });
  }

  return {
    contractPhase: phase,
    anchor: { x: anchorX, y: anchorY },
    bellCenter: { x: anchorX + ux * stalkLength, y: anchorY + uy * stalkLength },
    stalkLength,
    coilTurns,
    stalkPath,
  };
}

export function vorticellaObstacle(
  cell: VorticellaState,
  scale: number,
  frameHeight: number,
): { x: number; y: number; radius: number } {
  const { D, bellHeight, restStalk } = vorticellaBellMetrics(cell, scale, frameHeight);
  const ax = finite(cell.anchorX, 0);
  const ay = finite(cell.anchorY, 0);
  // direction is UP (-y); bell mid sits above the neck (top of the rest stalk)
  return { x: ax, y: ay - (restStalk + bellHeight * 0.5), radius: 1.1 * D };
}
