import type { AquariumFrame, AquariumParamsView, VorticellaState } from "./types";
import { seededUnit } from "./seeds";

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

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function wrapUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return ((value % 1) + 1) % 1;
}

const TAU = Math.PI * 2;
const CONTRACT_FRACTION = 0.16;

export function vorticellaContractPhase(cyclePhase: number): number {
  const phase = wrapUnit(cyclePhase);
  if (phase < CONTRACT_FRACTION) {
    const q = phase / CONTRACT_FRACTION;
    return 1 - Math.pow(1 - q, 3);
  }
  const q = (phase - CONTRACT_FRACTION) / (1 - CONTRACT_FRACTION);
  return Math.pow(1 - q, 2);
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
    const t = i / (sampleCount - 1);
    const along = stalkLength * t;
    const wave = Math.sin(t * coilTurns * TAU) * coilAmplitude;
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

export function seedVorticella(count: number, seed: number, frame: AquariumFrame, salt = 0x070271ca): VorticellaState[] {
  if (count <= 0) return [];
  const vorticella: VorticellaState[] = [];
  const safeWidth = Math.max(0, finite(frame.width, 0));
  const safeHeight = Math.max(0, finite(frame.height, 0));
  for (let i = 0; i < count; i++) {
    const side = Math.floor(seededUnit(seed, i, salt ^ 0x1f34a2bd) * 4) % 4;
    const along = seededUnit(seed, i, salt ^ 0x4563d29f);
    const inset = 0.5;
    let anchorX = along * safeWidth;
    let anchorY = inset;
    let directionAngle = Math.PI / 2;
    if (side === 1) {
      anchorX = safeWidth - inset;
      anchorY = along * safeHeight;
      directionAngle = Math.PI;
    } else if (side === 2) {
      anchorX = along * safeWidth;
      anchorY = safeHeight - inset;
      directionAngle = -Math.PI / 2;
    } else if (side === 3) {
      anchorX = inset;
      anchorY = along * safeHeight;
      directionAngle = 0;
    }
    const restLength = Math.max(5.5, Math.min(12, (7.5 + seededUnit(seed, i, salt ^ 0x02e5be93) * 3.5) * Math.min(1, safeHeight / 36)));
    const cycle = seededUnit(seed, i, salt ^ 0x61097f2d);
    vorticella.push({
      x: anchorX,
      y: anchorY,
      phase: cycle,
      size: 0.5 + seededUnit(seed, i, salt ^ 0x7281d4c7),
      anchorX,
      anchorY,
      directionAngle,
      restLength,
      contractPhase: vorticellaContractPhase(cycle),
      contractCyclePhase: cycle,
      oralWreathPhase: seededUnit(seed, i, salt ^ 0x68bc21eb),
      contractRate: 0.055 + seededUnit(seed, i, salt ^ 0x2fda92a1) * 0.06,
      oralRate: 0.42 + seededUnit(seed, i, salt ^ 0x14c8af21) * 0.18,
    });
  }
  return vorticella;
}

export function updateVorticella(
  vorticella: readonly VorticellaState[],
  frame: AquariumFrame,
  view: AquariumParamsView,
): readonly VorticellaState[] {
  if (vorticella.length === 0) return vorticella;
  const dt = Math.max(0, finite(frame.dt, 0));
  const activityMix = clamp01(finite(frame.activity, 0) * finite(view.activityBoost, 0));
  const idleRate = Math.max(0, finite(view.vorticella.contractRate, 0));
  const activeRate = Math.max(0, finite(view.vorticella.contractRateActive, idleRate));
  const rate = idleRate + (activeRate - idleRate) * activityMix;
  const modeMul = frame.mode === "recording" ? 1.18 : frame.mode === "transcribing" ? 0.35 : frame.mode === "error" ? 0.15 : 1;
  const startleBoost = 1 + Math.min(0.35, Math.max(0, finite(frame.startle, 0)) * 0.35);
  const cycleRateMul = Math.min(1.45, rate * modeMul * startleBoost);
  const oralRateMul = frame.mode === "error" ? 0.2 : frame.mode === "transcribing" ? 0.45 : 1 + activityMix * 0.18;

  return vorticella.map((cell) => {
    const cyclePhase = wrapUnit(cell.contractCyclePhase + Math.max(0, finite(cell.contractRate, 0)) * cycleRateMul * dt);
    return {
      ...cell,
      x: cell.anchorX,
      y: cell.anchorY,
      phase: cyclePhase,
      contractCyclePhase: cyclePhase,
      contractPhase: vorticellaContractPhase(cyclePhase),
      oralWreathPhase: wrapUnit(cell.oralWreathPhase + Math.max(0, finite(cell.oralRate, 0)) * oralRateMul * dt),
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

export function drawVorticella(
  ctx: CanvasRenderingContext2D,
  vorticella: readonly VorticellaState[],
  frame: AquariumFrame,
  view: AquariumParamsView,
): void {
  if (!view.enabled || vorticella.length === 0 || view.vorticella.count <= 0) return;
  const alpha = Math.max(0, Math.min(1, view.alpha * 0.62));
  if (alpha <= 0) return;
  const scale = Math.max(0.1, finite(view.vorticella.scale, 1));
  const hue = finite(frame.baseHue, 50) + 110;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const cell of vorticella) {
    const bellRadius = Math.max(2.4, Math.min(6.2, (3.8 + finite(cell.size, 1) * 1.4) * scale));
    const restLength = Math.max(5.5, Math.min(12, finite(cell.restLength, 9) * scale));
    const geometry = vorticellaGeometry(cell.contractPhase, {
      anchorX: finite(cell.anchorX, 0),
      anchorY: finite(cell.anchorY, 0),
      restLength,
      directionAngle: finite(cell.directionAngle, Math.PI / 2),
      minLengthFrac: 0.26,
      coilSampleCount: 14,
    });
    const ux = Math.cos(cell.directionAngle);
    const uy = Math.sin(cell.directionAngle);
    const nx = -uy;
    const ny = ux;
    const bellCx = geometry.bellCenter.x;
    const bellCy = geometry.bellCenter.y;
    const cupDepth = bellRadius * 0.88;
    const cupWidth = bellRadius * (1.18 - cell.contractPhase * 0.18);
    const cup: AquariumPoint[] = [
      { x: bellCx + nx * -cupWidth * 0.72 - ux * cupDepth * 0.30, y: bellCy + ny * -cupWidth * 0.72 - uy * cupDepth * 0.30 },
      { x: bellCx + nx * -cupWidth * 0.38 + ux * cupDepth * 0.42, y: bellCy + ny * -cupWidth * 0.38 + uy * cupDepth * 0.42 },
      { x: bellCx + ux * cupDepth * 0.64, y: bellCy + uy * cupDepth * 0.64 },
      { x: bellCx + nx * cupWidth * 0.38 + ux * cupDepth * 0.42, y: bellCy + ny * cupWidth * 0.38 + uy * cupDepth * 0.42 },
      { x: bellCx + nx * cupWidth * 0.72 - ux * cupDepth * 0.30, y: bellCy + ny * cupWidth * 0.72 - uy * cupDepth * 0.30 },
    ];

    drawPolyline(ctx, geometry.stalkPath, false);
    ctx.strokeStyle = `hsla(${hue}, 20%, 72%, ${alpha * 0.46})`;
    ctx.lineWidth = 0.44;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(geometry.anchor.x, geometry.anchor.y, 0.65, 0, TAU);
    ctx.fillStyle = `hsla(${hue - 12}, 14%, 74%, ${alpha * 0.35})`;
    ctx.fill();

    drawPolyline(ctx, cup, true);
    ctx.fillStyle = `hsla(${hue}, 18%, 70%, ${alpha * 0.12})`;
    ctx.strokeStyle = `hsla(${hue + 8}, 22%, 78%, ${alpha * 0.42})`;
    ctx.lineWidth = 0.48;
    ctx.fill();
    ctx.stroke();

    const mouthX = bellCx - ux * cupDepth * 0.30;
    const mouthY = bellCy - uy * cupDepth * 0.30;
    ctx.beginPath();
    ctx.ellipse(mouthX, mouthY, cupWidth * 0.78, Math.max(0.55, bellRadius * 0.28), cell.directionAngle, 0, TAU);
    ctx.strokeStyle = `hsla(${hue + 18}, 18%, 82%, ${alpha * 0.52})`;
    ctx.lineWidth = 0.36;
    ctx.stroke();

    ctx.strokeStyle = `hsla(${hue + 20}, 18%, 84%, ${alpha * 0.38})`;
    ctx.lineWidth = 0.24;
    for (let i = 0; i < 7; i++) {
      const q = (i / 7 + cell.oralWreathPhase) % 1;
      const lateral = (q - 0.5) * cupWidth * 1.35;
      const beat = Math.sin((q + cell.oralWreathPhase) * TAU) * bellRadius * 0.12;
      const base = { x: mouthX + nx * lateral, y: mouthY + ny * lateral };
      const tip = { x: base.x - ux * (0.85 + beat), y: base.y - uy * (0.85 + beat) };
      drawPolyline(ctx, [base, tip], false);
      ctx.stroke();
    }
  }
  ctx.restore();
}
