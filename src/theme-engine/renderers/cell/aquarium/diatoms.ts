export type DiatomShape = "navicula" | "ovalCentric";

export interface DiatomGeometryOptions {
  readonly centerX?: number;
  readonly centerY?: number;
  readonly length?: number;
  readonly width?: number;
  readonly heading?: number;
  readonly minStriaSpacing?: number;
}

export interface AquariumPoint {
  readonly x: number;
  readonly y: number;
}

export interface DiatomStria {
  readonly from: AquariumPoint;
  readonly to: AquariumPoint;
}

export interface DiatomGeometry {
  readonly shape: DiatomShape;
  readonly center: AquariumPoint;
  readonly outline: readonly AquariumPoint[];
  readonly raphe: readonly AquariumPoint[];
  readonly striae: readonly DiatomStria[];
}

function finiteOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? (value as number) : fallback;
}

function positive(value: number | undefined, fallback: number): number {
  return Math.max(0.001, finiteOr(value, fallback));
}

function transform(cx: number, cy: number, ux: number, uy: number, x: number, y: number): AquariumPoint {
  const nx = -uy;
  const ny = ux;
  return { x: cx + ux * x + nx * y, y: cy + uy * x + ny * y };
}

function naviculaHalfWidth(u: number, halfWidth: number): number {
  return halfWidth * Math.sin(Math.acos(Math.max(-1, Math.min(1, u))));
}

export function diatomGeometry(
  shape: DiatomShape,
  options: DiatomGeometryOptions = {},
): DiatomGeometry {
  const cx = finiteOr(options.centerX, 0);
  const cy = finiteOr(options.centerY, 0);
  const length = positive(options.length, shape === "navicula" ? 7 : 5);
  const width = positive(options.width, shape === "navicula" ? length * 0.32 : length * 0.62);
  const heading = finiteOr(options.heading, 0);
  const minStriaSpacing = positive(options.minStriaSpacing, 1.1);
  const ux = Math.cos(heading);
  const uy = Math.sin(heading);
  const halfLength = length / 2;
  const halfWidth = width / 2;
  const outline: AquariumPoint[] = [];
  const striae: DiatomStria[] = [];
  const raphe: AquariumPoint[] = [];

  if (shape === "navicula") {
    const steps = 16;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const x = halfLength * Math.cos(a);
      const y = halfWidth * Math.sin(a) * (0.72 + 0.28 * Math.abs(Math.cos(a)));
      outline.push(transform(cx, cy, ux, uy, x, y));
    }
    raphe.push(transform(cx, cy, ux, uy, -halfLength * 0.78, 0));
    raphe.push(transform(cx, cy, ux, uy, halfLength * 0.78, 0));

    const pairCount = Math.max(1, Math.min(8, Math.floor(length / minStriaSpacing)));
    for (let i = 1; i <= pairCount; i++) {
      const x = (i / (pairCount + 1)) * halfLength * 0.9;
      for (const sign of [-1, 1]) {
        const sx = x * sign;
        const u = sx / halfLength;
        const hw = naviculaHalfWidth(u, halfWidth) * 0.72;
        striae.push({
          from: transform(cx, cy, ux, uy, sx, -hw),
          to: transform(cx, cy, ux, uy, sx, hw),
        });
      }
    }
  } else {
    const steps = 20;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      outline.push(transform(cx, cy, ux, uy, halfLength * Math.cos(a), halfWidth * Math.sin(a)));
    }
    raphe.push(transform(cx, cy, ux, uy, -halfLength * 0.18, 0));
    raphe.push(transform(cx, cy, ux, uy, halfLength * 0.18, 0));

    const radialCount = Math.max(4, Math.min(16, Math.floor((Math.PI * width) / minStriaSpacing)));
    for (let i = 0; i < radialCount; i++) {
      const a = (i / radialCount) * Math.PI * 2;
      striae.push({
        from: transform(cx, cy, ux, uy, Math.cos(a) * halfLength * 0.18, Math.sin(a) * halfWidth * 0.18),
        to: transform(cx, cy, ux, uy, Math.cos(a) * halfLength * 0.72, Math.sin(a) * halfWidth * 0.72),
      });
    }
  }

  return { shape, center: { x: cx, y: cy }, outline, raphe, striae };
}
