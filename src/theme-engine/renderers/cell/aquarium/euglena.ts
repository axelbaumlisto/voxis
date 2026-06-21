import type { ThemeState } from "../../../contract";
import type { AquariumFrame, AquariumParamsView, EuglenaState } from "./types";
import { seededUnit } from "./seeds";

export interface EuglenaPoseOptions {
  readonly centerX?: number;
  readonly centerY?: number;
  readonly length?: number;
  readonly baseWidth?: number;
  readonly heading?: number;
  readonly flagellumLength?: number;
  readonly stripeCount?: number;
  readonly flagellumPhase?: number;
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
  readonly flagellumPoints: readonly AquariumPoint[];
  readonly apparentWidth: number;
  readonly stripePhase: number;
  readonly bodySamples: readonly { readonly u: number; readonly halfWidth: number }[];
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
const METABOLY_AMP = 0.045;

interface EuglenaModeView {
  readonly motionMul: number;
  readonly alphaMul: number;
}

function euglenaModeView(mode: ThemeState["mode"]): EuglenaModeView {
  switch (mode) {
    case "recording":
      return { motionMul: 1.15, alphaMul: 1.08 };
    case "transcribing":
      return { motionMul: 0.35, alphaMul: 0.80 };
    case "error":
      return { motionMul: 0.15, alphaMul: 0.55 };
    case "idle":
    default:
      return { motionMul: 1.00, alphaMul: 1.00 };
  }
}

function wrapUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return ((value % 1) + 1) % 1;
}

function wrap(value: number, max: number): number {
  if (!(max > 0)) return 0;
  const wrapped = value % max;
  return wrapped < 0 ? wrapped + max : wrapped;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, finite(value, 0)));
}

function point(cx: number, cy: number, ux: number, uy: number, along: number): AquariumPoint {
  return { x: cx + ux * along, y: cy + uy * along };
}

function transform(
  cx: number,
  cy: number,
  ux: number,
  uy: number,
  along: number,
  lateral: number,
): AquariumPoint {
  const nx = -uy;
  const ny = ux;
  return { x: cx + ux * along + nx * lateral, y: cy + uy * along + ny * lateral };
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
  const flagellum = wrapUnit(options.flagellumPhase ?? roll * 1.7);

  const ux = Math.cos(heading);
  const uy = Math.sin(heading);
  const lengthScale = 1 + METABOLY_AMP * Math.sin(metaboly * TAU);
  const widthScale = 1 / lengthScale;
  const halfLength = (length * lengthScale) / 2;
  const rollCos = Math.cos(roll * TAU);
  const apparentWidth = baseWidth * widthScale * (0.72 + 0.28 * Math.abs(rollCos));
  const stripePhase = wrapUnit(roll * stripeCount + metaboly * 0.18);
  const anterior = point(cx, cy, ux, uy, halfLength);
  const posterior = point(cx, cy, ux, uy, -halfLength);
  const eyespot = point(cx, cy, ux, uy, halfLength - length * 0.08);

  const flagellumPoints: AquariumPoint[] = [eyespot];
  const waveAmp = Math.min(1.25, Math.max(0.35, apparentWidth * 0.34));
  for (let i = 1; i <= 4; i++) {
    const q = i / 4;
    const along = halfLength - length * 0.08 + flagellumLength * q;
    const taper = 1 - q * 0.35;
    const lateral = Math.sin(flagellum * TAU + q * Math.PI * 1.35) * waveAmp * taper;
    flagellumPoints.push(transform(cx, cy, ux, uy, along, lateral));
  }
  const flagellumEnd = flagellumPoints[flagellumPoints.length - 1];

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
    flagellumPoints,
    apparentWidth,
    stripePhase,
    bodySamples,
  };
}

export function seedEuglena(count: number, seed: number, frame: AquariumFrame, salt = 0x0e091eaa): EuglenaState[] {
  if (count <= 0) return [];
  const euglena: EuglenaState[] = [];
  const safeWidth = Math.max(0, finite(frame.width, 0));
  const safeHeight = Math.max(0, finite(frame.height, 0));
  for (let i = 0; i < count; i++) {
    const heading = seededUnit(seed, i, salt ^ 0x68bc21eb) * TAU;
    euglena.push({
      x: seededUnit(seed, i, salt) * safeWidth,
      y: seededUnit(seed, i, salt ^ 0x51ed270b) * safeHeight,
      phase: heading,
      size: 0.5 + seededUnit(seed, i, salt ^ 0x02e5be93),
      heading,
      swimSpeed: 0.55 + seededUnit(seed, i, salt ^ 0x2fda92a1) * 0.75,
      rollPhase: seededUnit(seed, i, salt ^ 0x4207e617),
      metabolyPhase: seededUnit(seed, i, salt ^ 0x39f0b4f5),
      flagellumPhase: seededUnit(seed, i, salt ^ 0x27d4eb2f),
      rollRate: 0.18 + seededUnit(seed, i, salt ^ 0x14c8af21) * 0.12,
      metabolyRate: 0.028 + seededUnit(seed, i, salt ^ 0x3bc85a13) * 0.024,
      flagellumRate: 1.05 + seededUnit(seed, i, salt ^ 0x752f7c59) * 0.55,
      spiralAmplitude: 0.28 + seededUnit(seed, i, salt ^ 0x61ab0917) * 0.34,
    });
  }
  return euglena;
}

export function updateEuglena(
  euglena: readonly EuglenaState[],
  frame: AquariumFrame,
  view: AquariumParamsView,
): readonly EuglenaState[] {
  if (euglena.length === 0) return euglena;
  const dt = Math.max(0, finite(frame.dt, 0));
  const safeWidth = Math.max(0, finite(frame.width, 0));
  const safeHeight = Math.max(0, finite(frame.height, 0));
  const activityMix = clamp01(finite(frame.activity, 0) * finite(view.activityBoost, 0));
  const idleRate = Math.max(0, finite(view.euglena.speed, 0));
  const activeRate = Math.max(0, finite(view.euglena.speedActive, idleRate));
  const activityRate = idleRate + (activeRate - idleRate) * activityMix;
  const modeView = euglenaModeView(frame.mode);
  const rate = activityRate * modeView.motionMul;

  return euglena.map((cell) => {
    const rollRate = Math.max(0, finite(cell.rollRate, 0)) * rate;
    const rollDelta = rollRate * dt;
    const oldRoll = wrapUnit(cell.rollPhase);
    const nextRoll = wrapUnit(oldRoll + rollDelta);
    const heading = finite(cell.heading, 0);
    const ux = Math.cos(heading);
    const uy = Math.sin(heading);
    const nx = -uy;
    const ny = ux;
    const swim = Math.max(0, finite(cell.swimSpeed, 0)) * rate;
    const lateralDelta = rollDelta === 0
      ? 0
      : finite(cell.spiralAmplitude, 0) * (Math.cos(oldRoll * TAU) - Math.cos((oldRoll + rollDelta) * TAU)) / TAU;
    let nextX = finite(cell.x, 0) + ux * swim * dt + nx * lateralDelta;
    let nextY = finite(cell.y, 0) + uy * swim * dt + ny * lateralDelta;

    if (frame.hero) {
      const hx = finite(frame.hero.x, safeWidth / 2);
      const hy = finite(frame.hero.y, safeHeight / 2);
      const exclusion = Math.max(0, finite(frame.hero.radius, 0)) * 2.2;
      const dx = nextX - hx;
      const dy = nextY - hy;
      const dist = Math.hypot(dx, dy);
      if (dist < exclusion && exclusion > 0) {
        const angle = dist > 1e-6 ? Math.atan2(dy, dx) : heading;
        const penetration = exclusion - dist;
        const repelSpeed = Math.max(10, finite(frame.hero.radius, 0) * 2.4);
        const step = Math.min(penetration, repelSpeed * dt);
        nextX += Math.cos(angle) * step;
        nextY += Math.sin(angle) * step;
      }
    }

    return {
      ...cell,
      x: clamp(wrap(nextX, safeWidth), 0, safeWidth),
      y: clamp(wrap(nextY, safeHeight), 0, safeHeight),
      phase: heading,
      rollPhase: nextRoll,
      metabolyPhase: wrapUnit(cell.metabolyPhase + Math.max(0, finite(cell.metabolyRate, 0)) * rate * dt),
      flagellumPhase: wrapUnit(cell.flagellumPhase + Math.max(0, finite(cell.flagellumRate, 0)) * rate * dt),
    };
  });
}

function drawPolyline(ctx: CanvasRenderingContext2D, points: readonly AquariumPoint[], close: boolean): void {
  if (points.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  if (close) ctx.closePath();
}

function euglenaBodyOutline(pose: EuglenaPose, heading: number): AquariumPoint[] {
  const ux = Math.cos(heading);
  const uy = Math.sin(heading);
  const halfLength = Math.hypot(pose.anterior.x - pose.center.x, pose.anterior.y - pose.center.y);
  const upper: AquariumPoint[] = [];
  const lower: AquariumPoint[] = [];
  for (let i = 0; i <= 10; i++) {
    const u = -1 + (i / 10) * 2;
    const sampleTaper = Math.max(0, 1 - u * u);
    const anteriorTaper = 1 - 0.12 * Math.max(0, u);
    const halfWidth = (pose.apparentWidth / 2) * Math.sqrt(sampleTaper) * anteriorTaper;
    upper.push(transform(pose.center.x, pose.center.y, ux, uy, halfLength * u, halfWidth));
    lower.push(transform(pose.center.x, pose.center.y, ux, uy, halfLength * u, -halfWidth));
  }
  return [...upper, ...lower.reverse()];
}

export function drawEuglena(
  ctx: CanvasRenderingContext2D,
  euglena: readonly EuglenaState[],
  frame: AquariumFrame,
  view: AquariumParamsView,
): void {
  if (!view.enabled || euglena.length === 0 || view.euglena.count <= 0) return;
  const alpha = Math.max(0, Math.min(1, view.alpha * 0.72 * euglenaModeView(frame.mode).alphaMul));
  if (alpha <= 0) return;
  const scale = Math.max(0.1, finite(view.euglena.scale, 1));
  const hue = finite(frame.baseHue, 50) + 42;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const cell of euglena) {
    const length = Math.max(5, Math.min(16 * scale, (7.2 + finite(cell.size, 1) * 1.6) * scale));
    const width = Math.max(1.4, Math.min(7.2 * scale, length * 0.45));
    const flagellumLength = Math.max(2.2, Math.min(7.5 * scale, length * 0.55));
    const heading = finite(cell.heading, 0);
    const pose = euglenaPose(cell.rollPhase, cell.metabolyPhase, {
      centerX: finite(cell.x, 0),
      centerY: finite(cell.y, 0),
      length,
      baseWidth: width,
      heading,
      flagellumLength,
      flagellumPhase: cell.flagellumPhase,
      stripeCount: 5,
    });
    const outline = euglenaBodyOutline(pose, heading);
    const detailCount = length >= 9 ? 3 : length >= 7 ? 2 : 0;

    drawPolyline(ctx, outline, true);
    ctx.fillStyle = `hsla(${hue}, 24%, 48%, ${alpha * 0.34})`;
    ctx.strokeStyle = `hsla(${hue + 8}, 22%, 66%, ${alpha * 0.55})`;
    ctx.lineWidth = Math.max(0.48, Math.min(0.9, width * 0.12));
    ctx.fill();
    ctx.stroke();

    const ux = Math.cos(heading);
    const uy = Math.sin(heading);

    if (detailCount > 0) {
      ctx.fillStyle = `hsla(${hue - 12}, 30%, 42%, ${alpha * 0.34})`;
      for (let i = 0; i < detailCount; i++) {
        const q = i / (detailCount - 1);
        const along = length * (-0.17 + q * 0.34);
        const lateralSign = i % 2 === 0 ? 1 : -1;
        const p = transform(pose.center.x, pose.center.y, ux, uy, along, width * 0.13 * lateralSign);
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, 0.50, 0.30, heading, 0, TAU);
        ctx.fill();
      }

      const stripeAlpha = alpha * 0.30;
      ctx.strokeStyle = `hsla(${hue - 8}, 24%, 36%, ${stripeAlpha})`;
      ctx.lineWidth = Math.max(0.24, Math.min(0.55, width * 0.08));
      for (let i = 0; i < detailCount; i++) {
        const q = i / (detailCount - 1);
        const bandOffset = -0.16 + q * 0.32;
        const along = length * (bandOffset + (pose.stripePhase - 0.5) * 0.08);
        const band = [
          transform(pose.center.x, pose.center.y, ux, uy, along - length * 0.16, -width * 0.18),
          transform(pose.center.x, pose.center.y, ux, uy, along + length * 0.16, width * 0.18),
        ];
        drawPolyline(ctx, band, false);
        ctx.stroke();
      }
    }

    ctx.strokeStyle = `hsla(${hue + 10}, 18%, 70%, ${alpha * 0.48})`;
    ctx.lineWidth = Math.max(0.34, Math.min(0.65, width * 0.08));
    drawPolyline(ctx, pose.flagellumPoints, false);
    ctx.stroke();

    if (length >= 7) {
      const reservoir = transform(pose.center.x, pose.center.y, ux, uy, length * 0.33, -width * 0.11);
      ctx.fillStyle = `hsla(175, 22%, 80%, ${alpha * 0.46})`;
      ctx.beginPath();
      ctx.arc(reservoir.x, reservoir.y, Math.min(0.8, Math.max(0.34, width * 0.18)), 0, TAU);
      ctx.fill();
    }

    ctx.fillStyle = `hsla(20, 48%, 50%, ${alpha * 0.78})`;
    ctx.beginPath();
    ctx.arc(pose.eyespot.x, pose.eyespot.y, Math.min(1, Math.max(0.45, width * 0.22)), 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}
