import type { AquariumFrame, DiatomState } from "./types";
import type { AquariumParamsView } from "./types";
import { seededUnit } from "./seeds";

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

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function positive(value: number | undefined, fallback: number): number {
  return Math.max(0.001, finiteOr(value, fallback));
}

const TAU = Math.PI * 2;

function wrap(value: number, max: number): number {
  if (!(max > 0)) return 0;
  const wrapped = value % max;
  return wrapped < 0 ? wrapped + max : wrapped;
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

export function seedDiatoms(count: number, seed: number, frame: AquariumFrame, salt = 0x0d1a70cd): DiatomState[] {
  if (count <= 0) return [];
  const diatoms: DiatomState[] = [];
  const safeWidth = Math.max(0, finite(frame.width, 0));
  const safeHeight = Math.max(0, finite(frame.height, 0));
  for (let i = 0; i < count; i++) {
    const shape: DiatomShape = seededUnit(seed, i, salt ^ 0x19a43d11) < 0.68 ? "navicula" : "ovalCentric";
    const heading = seededUnit(seed, i, salt ^ 0x68bc21eb) * Math.PI * 2;
    const driftAngle = seededUnit(seed, i, salt ^ 0x3468ac95) * Math.PI * 2;
    const driftMag = 0.18 + seededUnit(seed, i, salt ^ 0x2fda92a1) * 0.82;
    const rotationSign = seededUnit(seed, i, salt ^ 0x55d7f2bd) < 0.5 ? -1 : 1;
    diatoms.push({
      x: seededUnit(seed, i, salt) * safeWidth,
      y: seededUnit(seed, i, salt ^ 0x51ed270b) * safeHeight,
      phase: heading,
      size: 0.5 + seededUnit(seed, i, salt ^ 0x02e5be93),
      shape,
      heading,
      driftX: Math.cos(driftAngle) * driftMag,
      driftY: Math.sin(driftAngle) * driftMag,
      rotationRate: rotationSign * (0.018 + seededUnit(seed, i, salt ^ 0x1c4f3ac7) * 0.045),
    });
  }
  return diatoms;
}

export function updateDiatoms(
  diatoms: readonly DiatomState[],
  frame: AquariumFrame,
  view: AquariumParamsView,
): readonly DiatomState[] {
  if (diatoms.length === 0) return diatoms;
  const dt = Math.max(0, finite(frame.dt, 0));
  const speed = Math.max(0, finite(view.diatoms.driftSpeed, 0));
  const safeWidth = Math.max(0, finite(frame.width, 0));
  const safeHeight = Math.max(0, finite(frame.height, 0));
  return diatoms.map((diatom) => ({
    ...diatom,
    x: wrap(finite(diatom.x, 0) + finite(diatom.driftX, 0) * speed * dt, safeWidth),
    y: wrap(finite(diatom.y, 0) + finite(diatom.driftY, 0) * speed * dt, safeHeight),
    heading: wrap(finite(diatom.heading, 0) + finite(diatom.rotationRate, 0) * dt, TAU),
  }));
}

function drawPolyline(ctx: CanvasRenderingContext2D, points: readonly AquariumPoint[], close: boolean): void {
  if (points.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  if (close) ctx.closePath();
}

export function drawDiatoms(
  ctx: CanvasRenderingContext2D,
  diatoms: readonly DiatomState[],
  frame: AquariumFrame,
  view: AquariumParamsView,
): void {
  if (!view.enabled || diatoms.length === 0 || view.diatoms.count <= 0) return;
  const alpha = Math.max(0, Math.min(1, view.alpha * view.diatoms.alpha));
  if (alpha <= 0) return;
  const shimmer = 1 + 0.05 * Math.max(0, Math.min(1, finite(frame.activity, 0)));
  const hue = finite(frame.baseHue, 50) - 8;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let i = 0; i < diatoms.length; i++) {
    const diatom = diatoms[i];
    const length = Math.max(3, Math.min(8, (diatom.shape === "navicula" ? 5.5 : 4.6) * finite(diatom.size, 1)));
    const width = diatom.shape === "navicula" ? length * 0.33 : length * 0.68;
    const geometry = diatomGeometry(diatom.shape, {
      centerX: finite(diatom.x, 0),
      centerY: finite(diatom.y, 0),
      length,
      width,
      heading: finite(diatom.heading, 0),
      minStriaSpacing: 1.25,
    });
    const fillAlpha = alpha * 0.18 * shimmer;
    const strokeAlpha = alpha * 0.42 * shimmer;
    const detailAlpha = alpha * 0.24 * shimmer;
    drawPolyline(ctx, geometry.outline, true);
    ctx.fillStyle = `hsla(${hue}, 35%, 63%, ${fillAlpha})`;
    ctx.strokeStyle = `hsla(${hue}, 42%, 70%, ${strokeAlpha})`;
    ctx.lineWidth = 0.55;
    ctx.fill();
    ctx.stroke();

    drawPolyline(ctx, geometry.raphe, false);
    ctx.strokeStyle = `hsla(${hue + 12}, 28%, 78%, ${detailAlpha})`;
    ctx.lineWidth = 0.35;
    ctx.stroke();

    ctx.strokeStyle = `hsla(${hue - 8}, 32%, 55%, ${detailAlpha * 0.75})`;
    ctx.lineWidth = 0.28;
    for (const stria of geometry.striae) {
      ctx.beginPath();
      ctx.moveTo(stria.from.x, stria.from.y);
      ctx.lineTo(stria.to.x, stria.to.y);
      ctx.stroke();
    }
  }
  ctx.restore();
}
