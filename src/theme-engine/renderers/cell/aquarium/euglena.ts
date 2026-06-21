export interface EuglenaPoseOptions {
  readonly centerX?: number;
  readonly centerY?: number;
  readonly length?: number;
  readonly baseWidth?: number;
  readonly heading?: number;
  readonly flagellumLength?: number;
  readonly stripeCount?: number;
}

export interface AquariumPoint {
  readonly x: number;
  readonly y: number;
}

export interface EuglenaPose {
  readonly center: AquariumPoint;
  readonly anterior: AquariumPoint;
  readonly posterior: AquariumPoint;
  readonly eyespot: AquariumPoint;
  readonly flagellumEnd: AquariumPoint;
  readonly apparentWidth: number;
  readonly stripePhase: number;
  readonly bodySamples: readonly { readonly u: number; readonly halfWidth: number }[];
}

function finiteOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? (value as number) : fallback;
}

function positive(value: number | undefined, fallback: number): number {
  return Math.max(0.001, finiteOr(value, fallback));
}

function wrapUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return ((value % 1) + 1) % 1;
}

function point(cx: number, cy: number, ux: number, uy: number, along: number): AquariumPoint {
  return { x: cx + ux * along, y: cy + uy * along };
}

export function euglenaPose(
  rollPhase: number,
  metabolyPhase: number,
  options: EuglenaPoseOptions = {},
): EuglenaPose {
  const cx = finiteOr(options.centerX, 0);
  const cy = finiteOr(options.centerY, 0);
  const length = positive(options.length, 8);
  const baseWidth = positive(options.baseWidth, length * 0.28);
  const heading = finiteOr(options.heading, 0);
  const flagellumLength = positive(options.flagellumLength, length * 0.45);
  const stripeCount = Math.max(1, Math.floor(finiteOr(options.stripeCount, 6)));
  const roll = wrapUnit(rollPhase);
  const metaboly = wrapUnit(metabolyPhase);

  const ux = Math.cos(heading);
  const uy = Math.sin(heading);
  const metabolyStretch = 1 + 0.06 * Math.sin(metaboly * Math.PI * 2);
  const halfLength = (length * metabolyStretch) / 2;
  const rollCos = Math.cos(roll * Math.PI * 2);
  const apparentWidth = baseWidth * (0.72 + 0.28 * Math.abs(rollCos));
  const stripePhase = wrapUnit(roll * stripeCount + metaboly * 0.18);
  const anterior = point(cx, cy, ux, uy, halfLength);
  const posterior = point(cx, cy, ux, uy, -halfLength);
  const eyespot = point(cx, cy, ux, uy, halfLength - length * 0.08);
  const flagellumEnd = point(cx, cy, ux, uy, halfLength + flagellumLength);

  const bodySamples = [-1, -0.5, 0, 0.5, 1].map((u) => {
    const taper = Math.max(0, 1 - u * u);
    const anteriorTaper = 1 - 0.12 * Math.max(0, u);
    return { u, halfWidth: (apparentWidth / 2) * Math.sqrt(taper) * anteriorTaper };
  });

  return {
    center: { x: cx, y: cy },
    anterior,
    posterior,
    eyespot,
    flagellumEnd,
    apparentWidth,
    stripePhase,
    bodySamples,
  };
}
