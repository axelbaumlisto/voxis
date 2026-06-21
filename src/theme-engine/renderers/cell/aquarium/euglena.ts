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
  /** Flagellar beat tip amplitude in px (lateral). Default derived from width. */
  readonly flagellumAmp?: number;
  /** Number of flagellum sample segments. Default 8. */
  readonly flagellumSegments?: number;
  /** Whole wavelengths along the flagellum. Default 1.7. */
  readonly flagellumWaves?: number;
  /** Hard cap on flagellar lateral excursion (keeps it inside the strip). */
  readonly maxFlagellumLateral?: number;
  /** Slow intermittent metaboly envelope E(t) ∈ [0,1]. Default 1. */
  readonly metabolyEnvelope?: number;
  /** Deterministic per-cell seed for organelle jitter. Omit → no organelles. */
  readonly organelleSeed?: number;
  readonly chloroplastCount?: number;
  readonly paramylonCount?: number;
  readonly striaeCount?: number;
  readonly includeNucleus?: boolean;
  readonly includeReservoir?: boolean;
  readonly includeCV?: boolean;
  /** Contractile-vacuole pulse phase (cycles) for slow systole/diastole. */
  readonly cvPhase?: number;
}

export interface AquariumPoint {
  readonly x: number;
  readonly y: number;
}

export interface EuglenaOrganelle {
  readonly x: number;
  readonly y: number;
  readonly rx: number;
  readonly ry: number;
  readonly angle: number;
  readonly hueShift: number;
  readonly lightShift: number;
  /** 0..1 depth cue from axial roll (1 = near face, 0 = far face). */
  readonly front: number;
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
  readonly heading: number;
  readonly ux: number;
  readonly uy: number;
  readonly halfLength: number;
  readonly outline: readonly AquariumPoint[];
  readonly chloroplasts: readonly EuglenaOrganelle[];
  readonly nucleus: EuglenaOrganelle | null;
  readonly paramylon: readonly EuglenaOrganelle[];
  readonly reservoir: AquariumPoint | null;
  readonly contractileVacuole: { readonly x: number; readonly y: number; readonly r: number } | null;
  readonly pellicleStrips: readonly (readonly AquariumPoint[])[];
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
const METABOLY_AMP = 0.16; // local traveling-bulge amplitude (was a 0.045 global breathe)
const METABOLY_K = 1.3; // ~1.3 wavelengths along the body
const STRIAE_TURNS = 1.25; // helical turns of a pellicle stria over the body
const STRIAE_AMP = 0.62; // lateral fraction amplitude of a projected stria

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

/**
 * Display body length (px). SINGLE SOURCE OF TRUTH shared by updateEuglena
 * (speed in body-lengths) and drawEuglena (geometry). Replicates the exact
 * max(5, min(16·scale, …)) nesting so update/draw agree.
 */
export function euglenaDisplayLength(size: number, scale: number): number {
  const s = Math.max(0.1, finite(scale, 1));
  return Math.max(5, Math.min(16 * s, (7.2 + finite(size, 1) * 1.6) * s));
}

/**
 * Asymmetric spindle half-width profile (normalized, peak ≈ 1). A belly skew
 * places the widest point ~35% from the anterior; a low anterior exponent keeps
 * the front blunt/rounded, a high posterior exponent draws the tail to a point.
 * A small anterior canal notch at u≈+0.9 marks the flagellar reservoir mouth.
 */
function bodyShape(u: number): number {
  const us = u - 0.28 * (1 - u * u); // belly skew → widest ~u+0.26
  const a = Math.max(0, 1 - us * us);
  const p = u >= 0 ? 0.40 : 0.95;
  let w = Math.pow(a, p);
  const d = (u - 0.9) / 0.11; // wider notch so it survives sampling
  w *= 1 - 0.32 * Math.exp(-d * d);
  return w;
}

const BODY_SHAPE_MAX = (() => {
  let m = 0;
  for (let i = 0; i <= 400; i++) {
    const u = -1 + (i / 400) * 2;
    m = Math.max(m, bodyShape(u));
  }
  return m;
})();

function normHalfWidth(u: number): number {
  return bodyShape(u) / BODY_SHAPE_MAX;
}

export function euglenaPose(
  rollPhase: number,
  metabolyPhase: number,
  options: EuglenaPoseOptions = {},
): EuglenaPose {
  const cx = finiteOr(options.centerX, 0);
  const cy = finiteOr(options.centerY, 0);
  const length = positive(options.length, 8);
  const baseWidth = positive(options.baseWidth, length * 0.22);
  const heading = finiteOr(options.heading, 0);
  const flagellumLength = positive(options.flagellumLength, length * 1.1);
  const envelope = clamp01(finiteOr(options.metabolyEnvelope, 1));
  const roll = wrapUnit(rollPhase);
  const metaboly = wrapUnit(metabolyPhase);
  const flagellum = wrapUnit(options.flagellumPhase ?? roll * 1.7);
  const rollAng = roll * TAU;

  const ux = Math.cos(heading);
  const uy = Math.sin(heading);
  const halfLength = length / 2;
  const rollCos = Math.cos(rollAng);
  const widthMul = 0.85 + 0.15 * Math.abs(rollCos); // near-circular cross-section
  const wmax = baseWidth / 2;
  const apparentWidth = baseWidth * widthMul;
  const stripePhase = wrapUnit(roll + metaboly * 0.18);

  // traveling metaboly bulge (width-only), then area-normalized so it is a
  // constant-area peristaltic wave, not a breathe.
  const metabolyAt = (u: number): number => {
    const wave = Math.sin(TAU * (METABOLY_K * (u + 1) / 2 - metaboly)) * (1 - u * u);
    return 1 + METABOLY_AMP * envelope * wave;
  };
  let areaScale = 1;
  {
    let a0 = 0;
    let at = 0;
    for (let i = 0; i <= 40; i++) {
      const u = -1 + (i / 40) * 2;
      const base = normHalfWidth(u);
      a0 += base;
      at += base * metabolyAt(u);
    }
    areaScale = at > 1e-6 ? a0 / at : 1;
  }
  const halfWidthAt = (u: number): number => wmax * widthMul * normHalfWidth(u) * metabolyAt(u) * areaScale;

  const anterior = point(cx, cy, ux, uy, halfLength);
  const posterior = point(cx, cy, ux, uy, -halfLength);

  // --- body outline: cosine-clustered samples (denser at the high-curvature poles) ---
  const SAMPLES = Math.max(28, Math.min(56, Math.round(length / 2.2)));
  const upper: AquariumPoint[] = [];
  const lower: AquariumPoint[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const u = -Math.cos((Math.PI * i) / SAMPLES); // clusters toward u=±1
    const hw = halfWidthAt(u);
    upper.push(transform(cx, cy, ux, uy, halfLength * u, hw));
    lower.push(transform(cx, cy, ux, uy, halfLength * u, -hw));
  }
  const outline = [...upper, ...lower.reverse()];

  const bodySamples = [-1, -0.5, 0, 0.5, 1].map((u) => ({ u, halfWidth: halfWidthAt(u) }));

  // --- flagellum: single anterior whip, tip-amplified traveling wave ---
  const ampTip = positive(options.flagellumAmp, apparentWidth * 0.9);
  const maxLat = positive(options.maxFlagellumLateral, ampTip);
  const waves = positive(options.flagellumWaves, 1.7);
  const segs = Math.max(2, Math.floor(finiteOr(options.flagellumSegments, 10)));
  const flagellumPoints: AquariumPoint[] = [anterior];
  for (let i = 1; i <= segs; i++) {
    const q = i / segs;
    const along = halfLength + flagellumLength * q;
    const env = Math.pow(q, 1.2); // amplitude grows toward the tip (a whip)
    const lateral = clamp(
      ampTip * env * Math.sin(TAU * flagellum - waves * TAU * q),
      -maxLat,
      maxLat,
    );
    flagellumPoints.push(transform(cx, cy, ux, uy, along, lateral));
  }
  const flagellumEnd = flagellumPoints[flagellumPoints.length - 1];

  // --- stigma / eyespot: lateral, beside the reservoir (NOT at the tip) ---
  const eyespot = transform(cx, cy, ux, uy, halfLength * 0.66, wmax * 0.9);

  // --- interior organelles (deterministic, body-normalised, roll-swept, LOD) ---
  const seed = options.organelleSeed;
  const chloroplasts: EuglenaOrganelle[] = [];
  const paramylon: EuglenaOrganelle[] = [];
  let nucleus: EuglenaOrganelle | null = null;
  let reservoir: AquariumPoint | null = null;
  let contractileVacuole: { x: number; y: number; r: number } | null = null;
  const pellicleStrips: AquariumPoint[][] = [];

  if (seed !== undefined) {
    const bodyPoint = (u: number, sFrac: number): AquariumPoint =>
      transform(cx, cy, ux, uy, halfLength * u, sFrac * halfWidthAt(u));
    // axial roll → off-axis features circle to the far face and back
    const rollProject = (sFrac: number): { sEff: number; front: number } => ({
      sEff: sFrac * Math.cos(rollAng),
      front: 0.5 + 0.5 * Math.cos(rollAng - sFrac * 1.2),
    });

    const chCount = Math.max(0, Math.floor(finiteOr(options.chloroplastCount, 0)));
    for (let j = 0; j < chCount; j++) {
      const u = -0.85 + seededUnit(seed, j, 0x9a1f2b3c) * 1.47; // [-0.85, +0.62]
      const sFrac = (seededUnit(seed, j, 0x51bd0e77) - 0.5) * 1.7; // ±0.85
      const proj = rollProject(sFrac);
      const p = bodyPoint(u, proj.sEff);
      chloroplasts.push({
        x: p.x,
        y: p.y,
        rx: length * 0.09,
        ry: length * 0.05,
        angle: heading,
        hueShift: (seededUnit(seed, j, 0x2cd9a14b) - 0.5) * 8,
        lightShift: (seededUnit(seed, j, 0x7e3a5d91) - 0.5) * 6,
        front: proj.front,
      });
    }

    if (options.includeNucleus) {
      const p = bodyPoint(-0.22, 0);
      nucleus = { x: p.x, y: p.y, rx: length * 0.13, ry: length * 0.13, angle: heading, hueShift: 0, lightShift: 0, front: 1 };
    }

    const pmCount = Math.max(0, Math.floor(finiteOr(options.paramylonCount, 0)));
    if (pmCount >= 1) {
      // ring paramylon, posterior (sheaths around the pyrenoid)
      const proj = rollProject(0.30);
      const a = bodyPoint(-0.30, proj.sEff);
      paramylon.push({ x: a.x, y: a.y, rx: length * 0.045, ry: length * 0.045, angle: heading, hueShift: 0, lightShift: 0, front: proj.front });
    }
    if (pmCount >= 2) {
      const proj = rollProject(-0.30);
      const b = bodyPoint(0.20, proj.sEff);
      paramylon.push({ x: b.x, y: b.y, rx: length * 0.04, ry: length * 0.04, angle: heading, hueShift: 0, lightShift: 0, front: proj.front });
    }

    if (options.includeReservoir) {
      reservoir = bodyPoint(0.82, 0);
    }
    if (options.includeCV) {
      const cvP = bodyPoint(0.60, -0.25);
      const cvPulse = 0.5 - 0.5 * Math.cos(TAU * wrapUnit(finiteOr(options.cvPhase, 0)));
      contractileVacuole = { x: cvP.x, y: cvP.y, r: length * (0.025 + 0.05 * cvPulse) };
    }

    const stCount = Math.max(0, Math.floor(finiteOr(options.striaeCount, 0)));
    for (let j = 0; j < stCount; j++) {
      const phiJ = j / stCount; // distinct phase per stria
      const strip: AquariumPoint[] = [];
      for (let k = 0; k <= 11; k++) {
        const u = -0.85 + (k / 11) * 1.7;
        const ax = (u + 1) / 2;
        // projected helix: sinusoid in u, swept by roll
        const sFrac = clamp(STRIAE_AMP * Math.sin(TAU * (STRIAE_TURNS * ax + phiJ + stripePhase)), -0.92, 0.92);
        strip.push(bodyPoint(u, sFrac));
      }
      pellicleStrips.push(strip);
    }
  }

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
    heading,
    ux,
    uy,
    halfLength,
    outline,
    chloroplasts,
    nucleus,
    paramylon,
    reservoir,
    contractileVacuole,
    pellicleStrips,
  };
}

export function seedEuglena(count: number, seed: number, frame: AquariumFrame, salt = 0x0e091eaa): EuglenaState[] {
  if (count <= 0) return [];
  const euglena: EuglenaState[] = [];
  const safeWidth = Math.max(0, finite(frame.width, 0));
  const safeHeight = Math.max(0, finite(frame.height, 0));
  for (let i = 0; i < count; i++) {
    const dir = seededUnit(seed, i, salt ^ 0x68bc21eb) < 0.5 ? 0 : Math.PI;
    const tilt = (seededUnit(seed, i, salt ^ 0x1b9c4e3d) - 0.5) * 0.5;
    const heading = dir + tilt;
    euglena.push({
      x: seededUnit(seed, i, salt) * safeWidth,
      y: seededUnit(seed, i, salt ^ 0x51ed270b) * safeHeight,
      phase: heading,
      size: 0.5 + seededUnit(seed, i, salt ^ 0x02e5be93),
      heading,
      swimSpeed: 0.85 + seededUnit(seed, i, salt ^ 0x2fda92a1) * 0.30,
      rollPhase: seededUnit(seed, i, salt ^ 0x4207e617),
      metabolyPhase: seededUnit(seed, i, salt ^ 0x39f0b4f5),
      flagellumPhase: seededUnit(seed, i, salt ^ 0x27d4eb2f),
      rollRate: 0.45 + seededUnit(seed, i, salt ^ 0x14c8af21) * 0.45,
      metabolyRate: 0.12 + seededUnit(seed, i, salt ^ 0x3bc85a13) * 0.08,
      flagellumRate: 2.0 + seededUnit(seed, i, salt ^ 0x752f7c59) * 3.0,
      spiralAmplitude: 0.12 + seededUnit(seed, i, salt ^ 0x61ab0917) * 0.06,
      cvPhase: seededUnit(seed, i, salt ^ 0x3da17c45),
      cvRate: 0.035 + seededUnit(seed, i, salt ^ 0x59e2b7a3) * 0.015,
      burstPhase: seededUnit(seed, i, salt ^ 0x1f7c6b29),
      burstRate: 0.08 + seededUnit(seed, i, salt ^ 0x46b9d2e1) * 0.05,
      turnProgress: 2,
      turnFrom: heading,
      turnTo: heading,
    });
  }
  return euglena;
}

function smoothstep(x: number): number {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
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
  const modeView = euglenaModeView(frame.mode);
  const vIdleBL = Math.max(0, finite(view.euglena.speed, 0));
  const vActiveBL = Math.max(0, finite(view.euglena.speedActive, vIdleBL));
  const vBL = (vIdleBL + (vActiveBL - vIdleBL) * activityMix) * modeView.motionMul;
  const act = modeView.motionMul * (1 + 1.5 * activityMix);
  const scale = view.euglena.scale;
  const turnTime = 1.8;
  const margin = Math.max(8, safeWidth * 0.07);

  return euglena.map((cell) => {
    const L = euglenaDisplayLength(finite(cell.size, 1), scale);
    let heading = finite(cell.heading, 0);

    let turnProgress = finiteOr(cell.turnProgress, 2);
    let turnFrom = finiteOr(cell.turnFrom, heading);
    let turnTo = finiteOr(cell.turnTo, heading);
    let speedScale = 1;
    const turning = turnProgress < 1;
    if (turning) {
      turnProgress = Math.min(1, turnProgress + dt / turnTime);
      heading = turnFrom + (turnTo - turnFrom) * smoothstep(turnProgress);
      speedScale = 0.4 + 0.6 * Math.abs(Math.cos(turnProgress * Math.PI));
      if (turnProgress >= 1) heading = turnTo;
    } else {
      const ux0 = Math.cos(heading);
      const lead = finite(cell.x, 0) + ux0 * (L / 2);
      if ((ux0 > 0 && lead > safeWidth - margin) || (ux0 < 0 && lead < margin)) {
        turnProgress = 0;
        turnFrom = heading;
        turnTo = heading + Math.PI;
        speedScale = 1;
      }
    }

    const ux = Math.cos(heading);
    const uy = Math.sin(heading);
    const vPx = Math.max(0, finite(cell.swimSpeed, 0)) * vBL * L * speedScale;

    let nextX = finite(cell.x, 0) + ux * vPx * dt;
    let nextY = finite(cell.y, 0) + uy * vPx * dt;

    const yc = safeHeight / 2;
    if (safeHeight > 0 && Math.abs(nextY - yc) > 0.35 * safeHeight) {
      nextY += (yc - nextY) * Math.min(1, 2 * dt);
    }

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

    const rollDelta = Math.max(0, finite(cell.rollRate, 0)) * act * dt;
    return {
      ...cell,
      x: clamp(wrap(nextX, safeWidth), 0, safeWidth),
      y: clamp(nextY, 0, safeHeight),
      phase: heading,
      heading,
      turnProgress,
      turnFrom,
      turnTo,
      rollPhase: wrapUnit(finite(cell.rollPhase, 0) + rollDelta),
      metabolyPhase: wrapUnit(finite(cell.metabolyPhase, 0) + Math.max(0, finite(cell.metabolyRate, 0)) * act * dt),
      flagellumPhase: wrapUnit(finite(cell.flagellumPhase, 0) + Math.max(0, finite(cell.flagellumRate, 0)) * act * dt),
      cvPhase: wrapUnit(finiteOr(cell.cvPhase, 0) + Math.max(0, finiteOr(cell.cvRate, 0)) * act * dt),
      burstPhase: wrapUnit(finiteOr(cell.burstPhase, 0) + Math.max(0, finiteOr(cell.burstRate, 0)) * act * dt),
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

/** Intermittent metaboly envelope from a dt-integrated burst phase (~40% duty). */
function metabolyEnvelope(burstPhase: number): number {
  const p = wrapUnit(burstPhase);
  if (p < 0.6) return 0;
  return Math.sin(((p - 0.6) / 0.4) * Math.PI);
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
  const H = Math.max(1, finite(frame.height, 36));

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  euglena.forEach((cell, idx) => {
    const length = euglenaDisplayLength(finite(cell.size, 1), scale);
    const width = length * 0.22;
    const flagellumLength = length * 1.1;
    const heading = finite(cell.heading, 0);

    // LOD ladder by display length L
    const chCount = length < 7 ? 0 : length < 14 ? 3 : length < 40 ? clamp(Math.round(length / 5), 6, 10) : clamp(Math.round(length / 4.5), 12, 20);
    const stCount = length < 7 ? 0 : length < 14 ? 2 : length < 40 ? 4 : Math.min(7, Math.round(length / 9));
    const pmCount = length < 14 ? 0 : length < 40 ? 1 : 2;
    const includeNucleus = length >= 14;
    const includeReservoir = length >= 7;
    const includeCV = length >= 14;
    const flagSegs = clamp(Math.round(length / 3), 10, 24);

    // helix lateral offset: tanh soft-clamp (C∞, no flat-topped corners)
    const roll = wrapUnit(finite(cell.rollPhase, 0));
    const aHelix = finiteOr(cell.spiralAmplitude, 0.15) * length;
    const apparentW = width * (0.85 + 0.15 * Math.abs(Math.cos(roll * TAU)));
    const lmax = Math.max(0, 0.4 * H - apparentW / 2);
    const aFit = Math.min(aHelix, 0.9 * lmax);
    const lateral = lmax > 0 ? lmax * Math.tanh((aFit * Math.sin(roll * TAU + heading)) / lmax) : 0;
    const ux = Math.cos(heading);
    const uy = Math.sin(heading);
    const nx = -uy;
    const ny = ux;
    const cxr = finite(cell.x, 0) + nx * lateral;
    const cyr = finite(cell.y, 0) + ny * lateral;

    const ampTip = clamp(length * 0.22, 2, 0.30 * H);
    const env = metabolyEnvelope(finiteOr(cell.burstPhase, 0));

    const pose = euglenaPose(cell.rollPhase, cell.metabolyPhase, {
      centerX: cxr,
      centerY: cyr,
      length,
      baseWidth: width,
      heading,
      flagellumLength,
      flagellumPhase: cell.flagellumPhase,
      flagellumAmp: ampTip,
      maxFlagellumLateral: 0.40 * H,
      flagellumSegments: flagSegs,
      flagellumWaves: 1.7,
      metabolyEnvelope: env,
      organelleSeed: (view.seed ^ ((idx + 1) * 0x9e3779b1)) >>> 0,
      chloroplastCount: chCount,
      striaeCount: stCount,
      paramylonCount: pmCount,
      includeNucleus,
      includeReservoir,
      includeCV,
      cvPhase: cell.cvPhase,
    });

    // body fill + rim (vivid grass green)
    drawPolyline(ctx, pose.outline, true);
    ctx.fillStyle = `hsla(${hue}, 50%, 46%, ${alpha * 0.50})`;
    ctx.strokeStyle = `hsla(${hue + 6}, 42%, 64%, ${alpha * 0.62})`;
    ctx.lineWidth = Math.max(0.5, Math.min(0.9, width * 0.08));
    ctx.fill();
    ctx.stroke();

    // pellicle striae (light sheen lines, helical)
    if (pose.pellicleStrips.length > 0) {
      ctx.strokeStyle = `hsla(${hue + 4}, 26%, 72%, ${alpha * 0.30})`;
      ctx.lineWidth = Math.max(0.25, Math.min(0.5, width * 0.06));
      for (const strip of pose.pellicleStrips) {
        drawPolyline(ctx, strip, false);
        ctx.stroke();
      }
    }

    // chloroplasts (the dense green mass; roll fades the far face)
    for (const c of pose.chloroplasts) {
      const fa = alpha * 0.74 * (0.55 + 0.45 * c.front);
      ctx.fillStyle = `hsla(${hue + c.hueShift}, 64%, ${40 + c.lightShift}%, ${fa})`;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, c.rx, c.ry, c.angle, 0, TAU);
      ctx.fill();
    }

    // nucleus (bounded grey-green clearing with a faint rim)
    if (pose.nucleus) {
      ctx.fillStyle = `hsla(${hue - 2}, 14%, 50%, ${alpha * 0.42})`;
      ctx.beginPath();
      ctx.ellipse(pose.nucleus.x, pose.nucleus.y, pose.nucleus.rx, pose.nucleus.ry, pose.nucleus.angle, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = `hsla(${hue - 6}, 18%, 38%, ${alpha * 0.5})`;
      ctx.lineWidth = 0.4;
      ctx.beginPath();
      ctx.ellipse(pose.nucleus.x, pose.nucleus.y, pose.nucleus.rx, pose.nucleus.ry, pose.nucleus.angle, 0, TAU);
      ctx.stroke();
    }

    // paramylon (small refractile bodies; first is a ring)
    pose.paramylon.forEach((p, j) => {
      const fa = alpha * 0.52 * (0.6 + 0.4 * p.front);
      ctx.fillStyle = `hsla(50, 12%, 80%, ${fa})`;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.rx, p.ry, p.angle, 0, TAU);
      ctx.fill();
      if (j === 0) {
        ctx.strokeStyle = `hsla(50, 14%, 68%, ${alpha * 0.45})`;
        ctx.lineWidth = Math.max(0.3, width * 0.05);
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.rx, p.ry, p.angle, 0, TAU);
        ctx.stroke();
      }
    });

    // reservoir (small pale anterior pocket)
    if (pose.reservoir) {
      ctx.fillStyle = `hsla(186, 18%, 84%, ${alpha * 0.38})`;
      ctx.beginPath();
      ctx.arc(pose.reservoir.x, pose.reservoir.y, Math.max(0.4, width * 0.14), 0, TAU);
      ctx.fill();
    }

    // contractile vacuole (slow pulse)
    if (pose.contractileVacuole) {
      ctx.fillStyle = `hsla(190, 16%, 86%, ${alpha * 0.34})`;
      ctx.beginPath();
      ctx.arc(pose.contractileVacuole.x, pose.contractileVacuole.y, Math.max(0.4, pose.contractileVacuole.r), 0, TAU);
      ctx.fill();
    }

    // stigma / eyespot (the single warm accent, crimson-red, beside the reservoir)
    ctx.fillStyle = `hsla(8, 88%, 49%, ${alpha * 0.92})`;
    ctx.beginPath();
    ctx.arc(pose.eyespot.x, pose.eyespot.y, Math.max(0.45, length * 0.03), 0, TAU);
    ctx.fill();

    // flagellum (anterior whip, bright, base→tip stroke taper, on top)
    const fp = pose.flagellumPoints;
    for (let i = 1; i < fp.length; i++) {
      const q = i / (fp.length - 1);
      ctx.strokeStyle = `hsla(${hue + 8}, 34%, 66%, ${alpha * 0.88})`;
      ctx.lineWidth = Math.max(0.6, (1.6 - 1.1 * q) * Math.max(0.8, width * 0.14));
      ctx.beginPath();
      ctx.moveTo(fp[i - 1].x, fp[i - 1].y);
      ctx.lineTo(fp[i].x, fp[i].y);
      ctx.stroke();
    }
  });
  ctx.restore();
}
