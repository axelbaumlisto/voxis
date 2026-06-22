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
const VC_CONTRACT = 0.02; // ballistic collapse window (snap)
const VC_HOLD = 0.02;     // contracted hold
const VC_RELAX = 0.33;    // slow re-extension window

// Absolute-time spasmoneme clocks (seconds) — the collapse is power-limited and
// cadence-INDEPENDENT, so it runs on real dt, decoupled from how often it fires.
const T_C = 0.08;    // ballistic collapse (~5 frames @60fps; real <10ms, floored for visibility)
const T_HOLD = 0.05; // contracted hold
const T_E = 2.6;     // slow Ca-reload re-extension

/** Deterministic Poisson-ish feeding dwell (s) before the next contraction.
 *  `cadence` folds in the theme contract-rate + mode + startle (higher = more frequent). */
function drawFeedInterval(cellSeed: number, eventCount: number, activityMix: number, cadence: number): number {
  const mean = (9 - 6 * clamp01(activityMix)) / Math.max(0.2, cadence); // ~9s idle -> shorter when active/loud
  const u = Math.max(1e-4, seededUnit(cellSeed, eventCount, 0x51bd0e77));
  return clamp(-Math.log(u) * mean, 2.5, 18);
}

function vorticellaCellSeed(anchorX: number): number {
  return (Math.round(anchorX * 7) ^ 0x070271ca) >>> 0;
}

/** Contraction amount s in [0,1] from the absolute-time leg/timer state. */
function vorticellaLegAmount(leg: number, timer: number): number {
  if (leg === 1) { const u = clamp01(timer / T_C); return 1 - Math.pow(1 - u, 3); } // ballistic ease-out
  if (leg === 2) return 1;                                                          // hold
  if (leg === 3) { const u = clamp01(timer / T_E); return Math.exp(-Math.pow(u * 1.9, 1.4)); } // stretched-exp
  return 0;                                                                          // extended / feeding
}

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
      swayPhase: seededUnit(seed, i, salt ^ 0x3b91ce07),
      swayRate: 0.10 + seededUnit(seed, i, salt ^ 0x5a2f81b3) * 0.07, // ~0.10-0.17 Hz gentle sway
      // absolute-time contraction machine: start mid-dwell but FAR from a
      // contraction boundary (timer < 1.5 < min interval) so dt-partition stays exact
      contractLeg: 0,
      contractTimer: seededUnit(seed, i, salt ^ 0x29ab7f15) * 1.5,
      feedInterval: drawFeedInterval(vorticellaCellSeed(anchorX), 0, 0, 1),
      eventCount: 0,
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
  // cadence = how OFTEN it contracts (theme rate * mode * startle); the collapse
  // SPEED is separate and absolute (T_C on real dt), decoupled from cadence.
  const cadence = Math.max(0.2, Math.min(3.5, rate * modeMul * startleBoost));
  // oral cilia beat ~20Hz; visual cap 24Hz (>=3 samples/cycle @60fps, anti-shimmer)
  const oralHz = Math.min(24, (frame.mode === "error" ? 6 : frame.mode === "transcribing" ? 12 : 20) * (1 + activityMix * 0.2));
  // sway slows a little under load (the zooid stiffens when contracting often)
  const swayMul = frame.mode === "error" ? 0.3 : frame.mode === "transcribing" ? 0.6 : 1;
  return vorticella.map((cell) => {
    // CV pulses on its own slow rhythm, independent of contraction events
    const cvClock = wrapUnit(finite(cell.contractCyclePhase, 0) + Math.max(0, finite(cell.contractRate, 0)) * dt);
    const cellSeed = vorticellaCellSeed(finite(cell.anchorX, 0));
    // absolute-time contraction state machine (real dt; legs advance with carry)
    let leg = Math.max(0, Math.min(3, Math.floor(finiteOr(cell.contractLeg, 0))));
    let timer = Math.max(0, finiteOr(cell.contractTimer, 0)) + dt;
    let interval = Math.max(2.5, finiteOr(cell.feedInterval, 6));
    let evt = Math.max(0, Math.floor(finiteOr(cell.eventCount, 0)));
    for (let guard = 0; guard < 128; guard++) {
      if (leg === 0) { if (timer >= interval) { timer -= interval; leg = 1; } else break; }
      else if (leg === 1) { if (timer >= T_C) { timer -= T_C; leg = 2; } else break; }
      else if (leg === 2) { if (timer >= T_HOLD) { timer -= T_HOLD; leg = 3; } else break; }
      else { if (timer >= T_E) { timer -= T_E; leg = 0; evt += 1; interval = drawFeedInterval(cellSeed, evt, activityMix, cadence); } else break; }
    }
    return {
      ...cell,
      x: cell.anchorX,
      y: cell.anchorY,
      phase: cvClock,
      contractCyclePhase: cvClock,
      contractPhase: clamp01(vorticellaLegAmount(leg, timer)),
      contractLeg: leg,
      contractTimer: timer,
      feedInterval: interval,
      eventCount: evt,
      oralWreathPhase: wrapUnit(cell.oralWreathPhase + oralHz * dt),
      swayPhase: wrapUnit(finiteOr(cell.swayPhase, 0) + Math.max(0, finiteOr(cell.swayRate, 0.12)) * swayMul * dt),
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
    const baseDir = finite(cell.directionAngle, -Math.PI / 2);
    // idle sway: the slender stalk flexes gently so the zooid is alive at rest;
    // sway eases out as it contracts (the coiled spasmoneme is short and stiff).
    const sway = 0.07 * (1 - 0.8 * s) * Math.sin(TAU * wrapUnit(finiteOr(cell.swayPhase, 0)));
    // post-arrest recoil: a fast under-damped bell tilt right after the ballistic
    // collapse arrests (during HOLD + early re-extension), decaying to 0.
    const vleg = Math.floor(finiteOr(cell.contractLeg, 0));
    const arrestT = vleg === 2 ? Math.max(0, finiteOr(cell.contractTimer, 0))
      : vleg === 3 ? T_HOLD + Math.max(0, finiteOr(cell.contractTimer, 0)) : -1;
    const wobble = arrestT >= 0 && arrestT < 0.7
      ? 0.10 * Math.exp(-0.45 * TAU * 6 * arrestT) * Math.cos(TAU * 6 * 0.8932 * arrestT)
      : 0;
    const dir = baseDir + sway + wobble;
    const ux = Math.cos(dir), uy = Math.sin(dir);
    const nx = -uy, ny = ux;
    const anchorX = finite(cell.anchorX, 0);
    const anchorY = finite(cell.anchorY, 0);

    // --- modest bell + a longer stalk so it reads as a stalked, leggy zooid ---
    const D = clamp((8 + finite(cell.size, 1) * 4) * scale, 6, H * 0.40);
    const bellHeight = 1.35 * D;
    const restStalk = clamp(D * 2.8, D * 1.3, H - bellHeight - 3);

    const geom = vorticellaGeometry(s, {
      anchorX, anchorY, restLength: restStalk, directionAngle: dir,
      minLengthFrac: 0.32, coilSampleCount: 30, coilTurnsContracted: 3.0, coilRadius: D * 0.24,
    });
    const neck = geom.bellCenter;           // base of the bell (top of stalk)
    const rimC = { x: neck.x + ux * bellHeight, y: neck.y + uy * bellHeight }; // peristome centre
    const open = 1 - 0.7 * s;               // peristome closes as it contracts
    const Rrim = (D / 2) * open;

    const bodyPoint = (along: number, lateral: number): AquariumPoint => ({
      x: neck.x + ux * along + nx * lateral,
      y: neck.y + uy * along + ny * lateral,
    });
    // convex urn/bell silhouette: narrow neck, bulges to widest just below the
    // everted peristomial lip, then eases in slightly to the rim (NOT a straight cone).
    // campanulate bell: FULL neck (not a needle), convex bulging shoulders,
    // widest just below the everted lip, easing in slightly to the rim.
    const halfW = (u: number): number => {
      const um = 0.82, w0 = 0.24, wMax = 0.54, wRim = 0.54; // ~2.25x flare; everted lip is the widest
      const base = u <= um
        ? w0 + (wMax - w0) * Math.pow(smoothstep(u / um), 0.72) // convex shoulders
        : wMax + (wRim - wMax) * smoothstep((u - um) / (1 - um));
      return D * base * (u > 0.9 ? 0.55 + 0.45 * open : 1);
    };

    // === STALK (spasmoneme) — straight at rest, tight HELIX when contracted ===
    // base pass (back side / whole path), dim
    drawPolyline(ctx, geom.stalkPath, false);
    ctx.strokeStyle = `hsla(202, 26%, 80%, ${alpha * 0.34})`;
    ctx.lineWidth = Math.max(0.6, D * 0.07);
    ctx.stroke();
    // depth-shaded near-side turns: brighter/thicker where the coil faces the
    // viewer (cos>0) so the contracted stalk reads as a 3-D helical SPRING,
    // not a flat zigzag. (Only meaningful once coiled; negligible when straight.)
    if (s > 0.05 && geom.stalkPath.length > 2) {
      const n = geom.stalkPath.length;
      for (let i = 1; i < n; i++) {
        const t = i / (n - 1);
        const near = Math.cos(t * geom.coilTurns * TAU); // +1 near, -1 far
        drawPolyline(ctx, [geom.stalkPath[i - 1], geom.stalkPath[i]], false);
        if (near > 0) {
          ctx.strokeStyle = `hsla(204, 32%, 90%, ${alpha * (0.18 + 0.34 * near) * s})`;
          ctx.lineWidth = Math.max(0.4, D * (0.05 + 0.05 * near));
        } else {
          ctx.strokeStyle = `hsla(204, 24%, 64%, ${alpha * 0.12 * s})`; // far turns: faint, continuous
          ctx.lineWidth = Math.max(0.3, D * 0.03);
        }
        ctx.stroke();
      }
    }
    // faint inner spasmoneme line
    drawPolyline(ctx, geom.stalkPath, false);
    ctx.strokeStyle = `hsla(204, 30%, 70%, ${alpha * 0.3})`;
    ctx.lineWidth = Math.max(0.3, D * 0.03);
    ctx.stroke();
    // floor holdfast
    ctx.beginPath();
    ctx.arc(anchorX, anchorY, Math.max(0.8, D * 0.16), 0, TAU);
    ctx.fillStyle = `hsla(202, 24%, 76%, ${alpha * 0.4})`;
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
    ctx.fillStyle = `hsla(205, 42%, 79%, ${alpha * 0.34})`; // discernibly cool hyaline (alpha is the key lever over black)
    ctx.strokeStyle = `hsla(205, 44%, 90%, ${alpha * 0.46})`;
    ctx.lineWidth = Math.max(0.4, D * 0.05);
    ctx.fill();
    ctx.stroke();

    // === INTERIOR (subtle, hyaline) ===
    // macronucleus: curved C / horseshoe band lying along the body
    const macPts: AquariumPoint[] = [];
    const macAlong = bellHeight * 0.50;
    const macR = D * 0.30; // open horseshoe band (~195deg, never closes into a ring/logo)
    for (let i = 0; i <= 14; i++) {
      const th = Math.PI * (0.32 + (i / 14) * 1.08);
      macPts.push(bodyPoint(macAlong - macR * 1.05 * Math.cos(th), macR * Math.sin(th)));
    }
    drawPolyline(ctx, macPts, false);
    ctx.strokeStyle = `hsla(50, 14%, 72%, ${alpha * 0.3})`;
    ctx.lineWidth = Math.max(0.6, D * 0.12);
    ctx.stroke();
    // micronucleus: a tiny dot docked against the OUTER edge of one nuclear arm
    if (D >= 11) {
      const mic = bodyPoint(macAlong - macR * 0.9, macR * 0.5);
      ctx.beginPath();
      ctx.arc(mic.x, mic.y, Math.max(0.4, D * 0.045), 0, TAU);
      ctx.fillStyle = `hsla(50, 16%, 66%, ${alpha * 0.34})`;
      ctx.fill();
    }

    // contractile vacuole: a faint translucent fill (NOT a bright ring — must not
    // read as an eye), set to one side of the upper body.
    if (D >= 10) {
      const cvPulse = 0.5 - 0.5 * Math.cos(TAU * wrapUnit(finite(cell.contractCyclePhase, 0) * 0.5));
      const cv = bodyPoint(bellHeight * 0.66, D * 0.20);
      ctx.beginPath();
      ctx.arc(cv.x, cv.y, Math.max(0.4, D * (0.035 + 0.035 * cvPulse)), 0, TAU);
      ctx.fillStyle = `hsla(198, 22%, 84%, ${alpha * 0.16})`;
      ctx.fill();
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
    ctx.strokeStyle = `hsla(204, 26%, 88%, ${alpha * 0.45 * open})`;
    ctx.lineWidth = Math.max(0.4, D * 0.05);
    ctx.stroke();

    // adoral zone of membranelles (AZM): a CCW spiral on the peristomal disc
    // funnelling to the cytostome — the feeding vortex.
    if (open > 0.3 && D >= 9) {
      const turns = 1.6, N = 30;
      const cytLat = Rrim * 0.30, cytDep = lipRy * 0.30;
      const spiral: AquariumPoint[] = [];
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const rr = 1 - t;
        const a = -t * turns * TAU; // CCW inward
        const lateral = Math.cos(a) * Rrim * rr + cytLat * t;
        const depth = Math.sin(a) * lipRy * rr + cytDep * t;
        spiral.push({ x: rimC.x + nx * lateral + ux * depth, y: rimC.y + ny * lateral + uy * depth });
      }
      drawPolyline(ctx, spiral, false);
      ctx.strokeStyle = `hsla(48, 24%, 88%, ${alpha * 0.32 * open})`;
      ctx.lineWidth = Math.max(0.25, D * 0.03);
      ctx.stroke();
      // second, inner membranelle row (phase-offset) so the AZM reads as a
      // layered band driving a feeding vortex, not a single circlet.
      const spiral2: AquariumPoint[] = [];
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const rr = (1 - t) * 0.7;
        const a = -t * turns * TAU + 0.6;
        const lateral = Math.cos(a) * Rrim * rr + cytLat * t;
        const depth = Math.sin(a) * lipRy * rr + cytDep * t;
        spiral2.push({ x: rimC.x + nx * lateral + ux * depth, y: rimC.y + ny * lateral + uy * depth });
      }
      drawPolyline(ctx, spiral2, false);
      ctx.strokeStyle = `hsla(46, 22%, 84%, ${alpha * 0.22 * open})`;
      ctx.lineWidth = Math.max(0.2, D * 0.022);
      ctx.stroke();
      const cyt = { x: rimC.x + nx * cytLat + ux * cytDep, y: rimC.y + ny * cytLat + uy * cytDep };
      ctx.beginPath();
      ctx.arc(cyt.x, cyt.y, Math.max(0.4, D * 0.05), 0, TAU);
      ctx.fillStyle = `hsla(205, 26%, 68%, ${alpha * 0.4 * open})`;
      ctx.fill();
    }

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
