export interface VorticellaGeometryOptions {
  readonly anchorX?: number;
  readonly anchorY?: number;
  readonly restLength?: number;
  readonly minLengthFrac?: number;
  readonly directionAngle?: number;
  readonly coilTurnsRest?: number;
  readonly coilTurnsContracted?: number;
  readonly coilSampleCount?: number;
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

function finiteOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? (value as number) : fallback;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function vorticellaGeometry(
  contractPhase: number,
  options: VorticellaGeometryOptions = {},
): VorticellaGeometry {
  const phase = clamp01(contractPhase);
  const anchorX = finiteOr(options.anchorX, 0);
  const anchorY = finiteOr(options.anchorY, 0);
  const restLength = Math.max(0.001, finiteOr(options.restLength, 10));
  const minLengthFrac = Math.min(1, Math.max(0.12, finiteOr(options.minLengthFrac, 0.32)));
  const angle = finiteOr(options.directionAngle, Math.PI / 2);
  const coilTurnsRest = Math.max(0, finiteOr(options.coilTurnsRest, 0.15));
  const coilTurnsContracted = Math.max(coilTurnsRest, finiteOr(options.coilTurnsContracted, 3.2));
  const sampleCount = Math.max(2, Math.floor(finiteOr(options.coilSampleCount, 16)));

  const stalkLength = restLength * (1 - phase * (1 - minLengthFrac));
  const coilTurns = coilTurnsRest + (coilTurnsContracted - coilTurnsRest) * phase;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const nx = -uy;
  const ny = ux;
  const coilAmplitude = restLength * 0.035 * phase;
  const stalkPath: AquariumPoint[] = [];

  for (let i = 0; i < sampleCount; i++) {
    const t = sampleCount === 1 ? 0 : i / (sampleCount - 1);
    const along = stalkLength * t;
    const wave = Math.sin(t * coilTurns * Math.PI * 2) * coilAmplitude;
    stalkPath.push({
      x: anchorX + ux * along + nx * wave,
      y: anchorY + uy * along + ny * wave,
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
