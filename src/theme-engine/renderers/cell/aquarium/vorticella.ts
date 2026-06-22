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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function wrapUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return ((value % 1) + 1) % 1;
}

function smoothstep(x: number): number {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
}

const TAU = Math.PI * 2;

// Asymmetric, mostly-extended duty: a FAST ease-out contraction, a brief hold,
// a SLOW sigmoid re-extension, then a long extended/feeding dwell (s=0). This
// matches the real spasmoneme (ballistic <10ms collapse, ~seconds reload) while
// staying a deterministic, dt-integrated function of one cycle phase.
const VC_CONTRACT = 0.05; // fast collapse window (fraction of cycle)
const VC_HOLD = 0.02;     // contracted hold
const VC_RELAX = 0.33;    // slow re-extension window

export function vorticellaContractPhase(cyclePhase: number): number {
  const phase = wrapUnit(cyclePhase);
  if (phase < VC_CONTRACT) {
    const q = phase / VC_CONTRACT;
    return 1 - Math.pow(1 - q, 3); // ease-out: fast launch, soft arrest
  }
  if (phase < VC_CONTRACT + VC_HOLD) return 1;
  if (phase < VC_CONTRACT + VC_HOLD + VC_RELAX) {
    const q = (phase - VC_CONTRACT - VC_HOLD) / VC_RELAX;
    return 1 - smoothstep(q); // slow sigmoid unfurl 1 → 0
  }
  return 0; // extended, feeding (the cell spends most of the cycle here)
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
    const fill = smoothstep(t);
    const wave = Math.sin(t * coilTurns * TAU) * coilRadius * fill;
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
  const inset = 0.5;
  for (let i = 0; i < count; i++) {
    // Vorticella is sessile on the substrate → anchor along the FLOOR, stalk up.
    // A single hero is centred; multiple companions spread across the floor.
    const along = count === 1 ? 0.5 : seededUnit(seed, i, salt ^ 0x4563d29f);
    const anchorX = along * safeWidth;
    const anchorY = safeHeight - inset;
    const directionAngle = -Math.PI / 2; // up
    const restLength = 7.5 + seededUnit(seed, i, salt ^ 0x02e5be93) * 3.5;
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
      contractRate: 0.06 + seededUnit(seed, i, salt ^ 0x2fda92a1) * 0.05,
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
  // oral cilia beat ~20Hz, capped < 30Hz Nyquist; faster when active
  const oralHz = Math.min(28, (frame.mode === "error" ? 6 : frame.mode === "transcribing" ? 12 : 20) * (1 + activityMix * 0.2));

  return vorticella.map((cell) => {
    const cyclePhase = wrapUnit(cell.contractCyclePhase + Math.max(0, finite(cell.contractRate, 0)) * cycleRateMul * dt);
    return {
      ...cell,
      x: cell.anchorX,
      y: cell.anchorY,
      phase: cyclePhase,
      contractCyclePhase: cyclePhase,
      contractPhase: vorticellaContractPhase(cyclePhase),
      oralWreathPhase: wrapUnit(cell.oralWreathPhase + oralHz * dt),
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
  const alpha = Math.max(0, Math.min(1, view.alpha * 0.85));
  if (alpha <= 0) return;
  const scale = Math.max(0.1, finite(view.vorticella.scale, 1));
  const H = Math.max(1, finite(frame.height, 80));

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const cell of vorticella) {
    const s = clamp01(finite(cell.contractPhase, 0));
    const dir = finite(cell.directionAngle, -Math.PI / 2);
    const ux = Math.cos(dir), uy = Math.sin(dir);
    const nx = -uy, ny = ux;
    const anchorX = finite(cell.anchorX, 0);
    const anchorY = finite(cell.anchorY, 0);

    // --- bell diameter D and a stalk length that fits the canvas with the bell ---
    const D = clamp((8 + finite(cell.size, 1) * 4) * scale, 6, H * 0.42);
    const bellHeight = 1.35 * D;
    const restStalk = clamp(D * 2.4, D, H - bellHeight - 3);

    const geom = vorticellaGeometry(s, {
      anchorX, anchorY, restLength: restStalk, directionAngle: dir,
      minLengthFrac: 0.35, coilSampleCount: 26, coilRadius: D * 0.5,
    });
    const neck = geom.bellCenter;           // base of the bell (top of stalk)
    const rimC = { x: neck.x + ux * bellHeight, y: neck.y + uy * bellHeight }; // peristome centre
    const open = 1 - 0.7 * s;               // peristome closes as it contracts
    const Rrim = (D / 2) * open;

    const bodyPoint = (along: number, lateral: number): AquariumPoint => ({
      x: neck.x + ux * along + nx * lateral,
      y: neck.y + uy * along + ny * lateral,
    });
    // inverted-bell half-width: narrow neck → bulge → flared rim
    const halfW = (u: number): number => (0.10 * D + 0.40 * D * smoothstep(u)) * (u > 0.9 ? open : 1);

    // === STALK (spasmoneme) — straight at rest, tight helix when contracted ===
    drawPolyline(ctx, geom.stalkPath, false);
    ctx.strokeStyle = `hsla(200, 12%, 84%, ${alpha * 0.42})`;
    ctx.lineWidth = Math.max(0.6, D * 0.07);
    ctx.stroke();
    // faint inner spasmoneme line
    ctx.strokeStyle = `hsla(200, 16%, 70%, ${alpha * 0.3})`;
    ctx.lineWidth = Math.max(0.3, D * 0.03);
    ctx.stroke();
    // floor holdfast
    ctx.beginPath();
    ctx.arc(anchorX, anchorY, Math.max(0.8, D * 0.16), 0, TAU);
    ctx.fillStyle = `hsla(200, 12%, 76%, ${alpha * 0.4})`;
    ctx.fill();

    // === BELL BODY (hyaline) ===
    const SAMP = 16;
    const left: AquariumPoint[] = [];
    const right: AquariumPoint[] = [];
    for (let i = 0; i <= SAMP; i++) {
      const u = i / SAMP;
      const hw = halfW(u);
      left.push(bodyPoint(bellHeight * u, -hw));
      right.push(bodyPoint(bellHeight * u, hw));
    }
    const outline = [...left, ...right.reverse()];
    drawPolyline(ctx, outline, true);
    ctx.fillStyle = `hsla(200, 10%, 82%, ${alpha * 0.14})`;
    ctx.strokeStyle = `hsla(200, 16%, 90%, ${alpha * 0.4})`;
    ctx.lineWidth = Math.max(0.4, D * 0.05);
    ctx.fill();
    ctx.stroke();

    // === INTERIOR (subtle, hyaline) ===
    // macronucleus: curved C / horseshoe band lying along the body
    const macPts: AquariumPoint[] = [];
    const macAlong = bellHeight * 0.52;
    const macR = D * 0.24;
    for (let i = 0; i <= 12; i++) {
      const th = Math.PI * (0.30 + (i / 12) * 1.40);
      macPts.push(bodyPoint(macAlong - macR * 0.7 * Math.cos(th), macR * Math.sin(th)));
    }
    drawPolyline(ctx, macPts, false);
    ctx.strokeStyle = `hsla(50, 14%, 72%, ${alpha * 0.3})`;
    ctx.lineWidth = Math.max(0.6, D * 0.12);
    ctx.stroke();

    // contractile vacuole: clear ring near the peristome (upper third)
    if (D >= 10) {
      const cvPulse = 0.5 - 0.5 * Math.cos(TAU * wrapUnit(finite(cell.contractCyclePhase, 0) * 0.5));
      const cv = bodyPoint(bellHeight * 0.78, -D * 0.18);
      ctx.beginPath();
      ctx.arc(cv.x, cv.y, Math.max(0.5, D * (0.05 + 0.05 * cvPulse)), 0, TAU);
      ctx.strokeStyle = `hsla(190, 30%, 86%, ${alpha * 0.4})`;
      ctx.lineWidth = Math.max(0.3, D * 0.03);
      ctx.stroke();
    }

    // food vacuoles: a few faint round inclusions mid/lower body
    if (D >= 12) {
      const fvSeed = (Math.round(anchorX) ^ 0x9e37) >>> 0;
      const fvCount = 4;
      for (let j = 0; j < fvCount; j++) {
        const u = 0.30 + seededUnit(fvSeed, j, 0x51bd0e77) * 0.40;
        const lat = (seededUnit(fvSeed, j, 0x2cd9a14b) - 0.5) * 1.2 * halfW(u);
        const fv = bodyPoint(bellHeight * u, lat);
        ctx.beginPath();
        ctx.arc(fv.x, fv.y, Math.max(0.4, D * (0.05 + seededUnit(fvSeed, j, 0x7e3a5d91) * 0.05)), 0, TAU);
        ctx.fillStyle = `hsla(40, 18%, 74%, ${alpha * 0.18})`;
        ctx.fill();
      }
    }

    // === PERISTOME lip + oral ciliary wreath (the feeding crown) ===
    // raised lip: a thin band at the rim, outer Rrim, drawn as an ellipse seen 3/4
    const lipRy = Math.max(0.5, Rrim * 0.34);
    ctx.beginPath();
    ctx.ellipse(rimC.x, rimC.y, Rrim, lipRy, dir, 0, TAU);
    ctx.fillStyle = `hsla(195, 16%, 80%, ${alpha * 0.16 * open})`;
    ctx.fill();
    ctx.strokeStyle = `hsla(200, 16%, 88%, ${alpha * 0.45 * open})`;
    ctx.lineWidth = Math.max(0.4, D * 0.05);
    ctx.stroke();

    // oral wreath: short cilia tufts around the rim, metachronal traveling wave
    if (open > 0.25) {
      const M = Math.max(8, Math.round(D * 1.1));
      ctx.strokeStyle = `hsla(48, 22%, 86%, ${alpha * 0.5 * open})`;
      ctx.lineWidth = Math.max(0.25, D * 0.025);
      const oral = wrapUnit(finite(cell.oralWreathPhase, 0));
      for (let i = 0; i < M; i++) {
        const a = (i / M);
        // position around the rim ellipse (lateral across, slight along-depth)
        const lateral = Math.cos(a * TAU) * Rrim;
        const depth = Math.sin(a * TAU) * lipRy;
        const base = { x: rimC.x + nx * lateral + ux * depth, y: rimC.y + ny * lateral + uy * depth };
        // metachronal wave (2 waves around the ring) + beat
        const beat = Math.sin((a * 2 - oral) * TAU);
        const len = D * (0.14 + 0.06 * beat);
        const tip = {
          x: base.x + ux * len + nx * beat * D * 0.05,
          y: base.y + uy * len + ny * beat * D * 0.05,
        };
        drawPolyline(ctx, [base, tip], false);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}
