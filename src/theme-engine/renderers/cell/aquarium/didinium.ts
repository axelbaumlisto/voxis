import type { ThemeState } from "../../../contract";
import { sourceId } from "./interaction";
import type { FieldContribution, FieldKind } from "./interaction";
import type { AquariumFrame, AquariumParamsView, DidiniumState } from "./types";
import { mix32, noise2D, seededUnit } from "./seeds";
import { TAU, clamp, clamp01, finite, finiteOr, wrapUnit } from "./util";

/** Frozen per-species deterministic salt for Didinium seeding. */
export const DIDINIUM_SALT = 0x0d1d1c0a;

// ── biology constants (Didinium nasutum) ───────────────────────────────────
// Stout barrel, aspect ~1.35:1 (length:width). Two transverse ciliary girdles
// (pectinelles): anterior at the shoulder, posterior just below mid-body. A
// conical apical snout (cytostome cone, closed at rest). Horseshoe macronucleus.
// Terminal contractile vacuole at the aboral (posterior) pole.
const ASPECT = 1.35; // length : width
const GIRDLE_A_U = 0.46; // anterior girdle position (shoulder), u ∈ [-1(post), +1(snout)]
const GIRDLE_P_U = -0.16; // posterior girdle position (just below mid-body)
const SHOULDER_U = 0.52; // where the barrel meets the cone snout
const BRUSH_ROWS = 5; // dorsal brushes (brosse) per girdle

// ── swim constants ──────────────────────────────────────────────────────────
const STOPGO_FREQ = 0.42; // Hz-ish; erratic cruise stop/dart modulation (phase-fn of frame.t)
const WANDER_FREQ = 0.21; // slow heading wander (phase-fn of frame.t)
const WANDER_RAD = 0.5; // max wander heading swing (rad) at full noise
const WALL_LOOK = 2.0; // body-lengths of anticipatory wall lookahead
const AVOID_SECONDS = 0.7; // eased duration of the "avoiding reaction" back-turn
const AVOID_TURN_MIN = (2 * Math.PI) / 3; // ~120° sharp re-orient
const AVOID_TURN_MAX = (5 * Math.PI) / 6; // ~150°

interface DidiniumModeView {
  readonly motionMul: number;
  readonly alphaMul: number;
}

function didiniumModeView(mode: ThemeState["mode"]): DidiniumModeView {
  switch (mode) {
    case "recording":
      return { motionMul: 1.2, alphaMul: 1.08 };
    case "transcribing":
      return { motionMul: 0.35, alphaMul: 0.8 };
    case "error":
      return { motionMul: 0.15, alphaMul: 0.55 };
    case "idle":
    default:
      return { motionMul: 1.0, alphaMul: 1.0 };
  }
}

/**
 * Display body length (px). SINGLE SOURCE OF TRUTH shared by updateDidinium
 * (speed in body-lengths) and drawDidinium (geometry).
 */
export function didiniumDisplayLength(size: number, scale: number): number {
  const s = Math.max(0.1, finite(scale, 1));
  return Math.max(7, Math.min(34 * s, (16 + finite(size, 1) * 4) * s));
}

/**
 * Normalized barrel half-width profile, peak ≈ 1. u=+1 is the apical snout tip
 * (cone, closed), u=-1 the rounded aboral pole. A flattened anterior shoulder
 * sits just below the cone; the mid-body is the widest; the posterior rounds off.
 */
function bodyShape(u: number): number {
  if (u >= SHOULDER_U) {
    // cone snout: half-width eases from the shoulder width down to ~0 at the tip,
    // slightly concave flanks (a cone, not a dome).
    const q = (u - SHOULDER_U) / (1 - SHOULDER_U); // 0 at shoulder, 1 at tip
    const wShoulder = 0.9; // flattened shoulder is a touch narrower than the belly
    return wShoulder * Math.pow(1 - q, 0.85);
  }
  // barrel body: flat-ish sides, widest mid, rounded posterior.
  const t = (u - SHOULDER_U) / (-1 - SHOULDER_U); // 0 at shoulder, 1 at aboral pole
  // belly bulge peaking around the lower-mid body, easing to a rounded posterior.
  const belly = Math.sin(Math.PI * clamp01(t * 0.86 + 0.07));
  return 0.62 + 0.38 * belly;
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

export function seedDidinium(count: number, seed: number, frame: AquariumFrame, salt = DIDINIUM_SALT): DidiniumState[] {
  if (count <= 0) return [];
  const out: DidiniumState[] = [];
  const safeWidth = Math.max(0, finite(frame.width, 0));
  const safeHeight = Math.max(0, finite(frame.height, 0));
  for (let i = 0; i < count; i++) {
    const dir = seededUnit(seed, i, salt ^ 0x68bc21eb) < 0.5 ? 0 : Math.PI;
    const tilt = (seededUnit(seed, i, salt ^ 0x1b9c4e3d) - 0.5) * 0.6;
    const heading = dir + tilt;
    out.push({
      x: (0.2 + 0.6 * seededUnit(seed, i, salt)) * safeWidth, // start mid-water
      y: (0.25 + 0.5 * seededUnit(seed, i, salt ^ 0x51ed270b)) * safeHeight,
      phase: heading,
      size: 0.5 + seededUnit(seed, i, salt ^ 0x02e5be93),
      heading,
      swimSpeed: 0.85 + seededUnit(seed, i, salt ^ 0x2fda92a1) * 0.3,
      rollPhase: seededUnit(seed, i, salt ^ 0x4207e617),
      rollRate: 0.35 + seededUnit(seed, i, salt ^ 0x14c8af21) * 0.25, // axial spin (rev/s)
      beatPhase: seededUnit(seed, i, salt ^ 0x27d4eb2f),
      beatRate: 4.0 + seededUnit(seed, i, salt ^ 0x752f7c59) * 1.5, // pectinelle beat (rendered Hz, capped)
      cvPhase: seededUnit(seed, i, salt ^ 0x3da17c45),
      cvRate: 0.045 + seededUnit(seed, i, salt ^ 0x59e2b7a3) * 0.02,
      turnSide: seededUnit(seed, i, salt ^ 0x7a3f4d21) < 0.5 ? -1 : 1, // birth-stable avoiding-reaction handedness
      avoidIndex: 0,
      avoidFrom: heading,
      avoidTo: heading,
      avoidProgress: 1,
      noiseSeed: mix32(seed ^ Math.imul(i + 1, 0x9e3779b1) ^ salt) >>> 0,
    });
  }
  return out;
}

export const DIDINIUM_RELEVANT_FIELDS: ReadonlySet<FieldKind> = new Set(["obstacle"]);

/**
 * Field contribution: Didinium emits a `motile` at its body position so other
 * organisms (e.g. a Vorticella mechanosensor) can react to it. v1 themes are
 * SOLO so nothing consumes this yet — the seam exists for the later predator
 * phase. Didinium itself consumes only obstacles (walls handled inline).
 */
export function didiniumContribute(cell: DidiniumState, idx: number): FieldContribution[] {
  return [{ kind: "motile", x: finite(cell.x, 0), y: finite(cell.y, 0), sourceId: sourceId("didinium", idx) }];
}

export function updateDidinium(
  didinium: readonly DidiniumState[],
  frame: AquariumFrame,
  view: AquariumParamsView,
): readonly DidiniumState[] {
  if (didinium.length === 0) return didinium;
  const dt = Math.max(0, finite(frame.dt, 0));
  const safeWidth = Math.max(0, finite(frame.width, 0));
  const safeHeight = Math.max(0, finite(frame.height, 0));
  const activityMix = clamp01(finite(frame.activity, 0) * finite(view.activityBoost, 0));
  const modeView = didiniumModeView(frame.mode);
  const vIdleBL = Math.max(0, finite(view.didinium.speed, 0));
  const vActiveBL = Math.max(0, finite(view.didinium.speedActive, vIdleBL));
  const vBL = (vIdleBL + (vActiveBL - vIdleBL) * activityMix) * modeView.motionMul;
  const act = modeView.motionMul * (1 + 0.7 * activityMix);
  const scale = view.didinium.scale;
  const t = finite(frame.t, 0);

  const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

  return didinium.map((cell, _idx) => {
    const L = didiniumDisplayLength(finite(cell.size, 1), scale);
    const nseed = finiteOr(cell.noiseSeed, 0) | 0;
    let heading = finite(cell.heading, 0);
    const px0 = finite(cell.x, 0);
    const py0 = finite(cell.y, 0);

    // ── erratic cruise: fast cruise punctuated by abrupt slow-downs ("stops").
    // Phase-function of ABSOLUTE frame.t only (never accumulated, never position-
    // dependent) → dt-partition exact at fixed frame.t. noise raised to a power
    // makes most of the time fast with occasional near-stops.
    const stopgo = noise2D(nseed ^ 0x53705f00, t * STOPGO_FREQ, 0.13);
    const cruiseEnv = 0.18 + 0.82 * Math.pow(stopgo, 2.0); // ∈ [0.18,1], biased fast
    const vPx = Math.max(0, finite(cell.swimSpeed, 0)) * vBL * L * cruiseEnv;

    // ── slow heading wander as a PHASE-FUNCTION of absolute frame.t (NOT an
    // accumulator): added to the base cruise heading only at move time. At a
    // fixed frame.t the effective heading is constant, so the open-water path is
    // dt-partition exact (the euglena helix trick). The base `heading` changes
    // only via the discrete wall avoiding-reaction below.
    const wander = (noise2D(nseed ^ 0x1ab39c21, t * WANDER_FREQ, 0.61) * 2 - 1) * WANDER_RAD;

    // ── wall pressure (anticipatory) — nonzero only near walls, so the
    // open-water (center) path never touches the heading state.
    let wallPressure = 0;
    let wallAwayX = 0;
    let wallAwayY = 0;
    const look = L * WALL_LOOK;
    if (px0 < look) { wallAwayX += (1 - px0 / look); wallPressure += 1 - px0 / look; }
    if (safeWidth - px0 < look) { wallAwayX -= (1 - (safeWidth - px0) / look); wallPressure += 1 - (safeWidth - px0) / look; }
    if (py0 < look) { wallAwayY += (1 - py0 / look); wallPressure += 1 - py0 / look; }
    if (safeHeight - py0 < look) { wallAwayY -= (1 - (safeHeight - py0) / look); wallPressure += 1 - (safeHeight - py0) / look; }

    // ── "avoiding reaction" (Jennings): on a real wall hit, back-turn the BASE
    // heading to a FIXED per-cell side. Eased discrete reorientation, gated on
    // wall contact — inert (state untouched) in open water.
    let avoidIndex = Math.max(0, Math.floor(finiteOr(cell.avoidIndex, 0)));
    let avoidFrom = finiteOr(cell.avoidFrom, heading);
    let avoidTo = finiteOr(cell.avoidTo, heading);
    let avoidProgress = clamp01(finiteOr(cell.avoidProgress, 1));
    const side = finiteOr(cell.turnSide, 1) < 0 ? -1 : 1;
    const hitWall = wallPressure > 0.85 && avoidProgress >= 1; // close to a wall, not mid-turn
    if (hitWall) {
      avoidIndex += 1;
      const magU = noise2D(nseed ^ 0x2f31a7d5, avoidIndex, 0.71);
      const magnitude = AVOID_TURN_MIN + (AVOID_TURN_MAX - AVOID_TURN_MIN) * magU;
      avoidFrom = heading;
      avoidTo = heading + side * magnitude; // always the same side (Jennings)
      avoidProgress = 0;
    }

    if (avoidProgress < 1) {
      const next = Math.min(1, avoidProgress + dt / AVOID_SECONDS);
      const turnK = 6.0; // sharp re-orient
      heading += wrapPi(avoidTo - heading) * (1 - Math.exp(-turnK * dt));
      if (next >= 1) heading = avoidTo;
      avoidProgress = next;
    } else if (wallPressure > 1e-6) {
      // gentle anticipatory bank away before an actual hit (gated near walls only)
      const desired = Math.atan2(Math.sin(heading) + wallAwayY, Math.cos(heading) + wallAwayX);
      const turnK = 1.0 + 2.5 * Math.min(1, wallPressure);
      heading += wrapPi(desired - heading) * (1 - Math.exp(-turnK * dt));
    }

    // effective swim heading = base + frame.t-phase wander (constant at fixed t)
    const eh = heading + wander;
    const ux = Math.cos(eh);
    const uy = Math.sin(eh);
    let nextX = px0 + ux * vPx * dt;
    let nextY = py0 + uy * vPx * dt;
    nextX = clamp(nextX, 0, safeWidth);
    nextY = clamp(nextY, 0, safeHeight);

    // beat freq capped so the metachronal girdle shimmer stays < Nyquist.
    const beatEff = Math.min(6, Math.max(0, finite(cell.beatRate, 0)) * act);

    return {
      ...cell,
      x: nextX,
      y: nextY,
      phase: heading,
      heading,
      rollPhase: wrapUnit(finite(cell.rollPhase, 0) + Math.max(0, finite(cell.rollRate, 0)) * act * dt),
      beatPhase: wrapUnit(finiteOr(cell.beatPhase, 0) + beatEff * dt),
      cvPhase: wrapUnit(finiteOr(cell.cvPhase, 0) + Math.max(0, finiteOr(cell.cvRate, 0)) * act * dt),
      avoidIndex,
      avoidFrom,
      avoidTo,
      avoidProgress,
    };
  });
}

function transform(
  cx: number,
  cy: number,
  ux: number,
  uy: number,
  along: number,
  lateral: number,
): { x: number; y: number } {
  const nx = -uy;
  const ny = ux;
  return { x: cx + ux * along + nx * lateral, y: cy + uy * along + ny * lateral };
}

function drawPolyline(ctx: CanvasRenderingContext2D, points: readonly { x: number; y: number }[], close: boolean): void {
  if (points.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  if (close) ctx.closePath();
}

export function drawDidinium(
  ctx: CanvasRenderingContext2D,
  didinium: readonly DidiniumState[],
  frame: AquariumFrame,
  view: AquariumParamsView,
): void {
  if (!view.enabled || didinium.length === 0 || view.didinium.count <= 0) return;
  const alpha = Math.max(0, Math.min(1, view.alpha * 0.9 * didiniumModeView(frame.mode).alphaMul));
  if (alpha <= 0) return;
  const scale = Math.max(0.1, finite(view.didinium.scale, 1));
  // darkfield: cool blue-white luminous; girdles + nucleus + CV are the bright cues.
  const hue = 200 + finite(view.didinium.hueOffset, 0);

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  didinium.forEach((cell) => {
    const L = didiniumDisplayLength(finite(cell.size, 1), scale);
    const halfLength = L / 2;
    const wMax = (L / ASPECT) / 2; // half of body width
    const heading = finite(cell.heading, 0);
    const ux = Math.cos(heading);
    const uy = Math.sin(heading);
    const cx = finite(cell.x, 0);
    const cy = finite(cell.y, 0);
    const roll = wrapUnit(finite(cell.rollPhase, 0));
    const rollAng = roll * TAU;
    const rollCos = Math.cos(rollAng);
    const widthMul = 0.9 + 0.1 * Math.abs(rollCos); // near-circular cross-section

    const halfWidthAt = (u: number): number => wMax * widthMul * normHalfWidth(u);

    // ── body outline (closed barrel + cone snout), cosine-clustered samples ──
    const SAMP = 30;
    const upper: { x: number; y: number }[] = [];
    const lower: { x: number; y: number }[] = [];
    for (let i = 0; i <= SAMP; i++) {
      const u = -Math.cos((Math.PI * i) / SAMP); // clusters toward poles
      const hw = halfWidthAt(u);
      upper.push(transform(cx, cy, ux, uy, halfLength * u, hw));
      lower.push(transform(cx, cy, ux, uy, halfLength * u, -hw));
    }
    const outline = [...upper, ...lower.reverse()];

    // ── body fill: faint luminous cool glow (more TRANSPARENT than Vorticella) ──
    drawPolyline(ctx, outline, true);
    ctx.fillStyle = `hsla(${hue}, 30%, 80%, ${alpha * 0.34})`;
    ctx.fill();
    // dim scattering rim
    ctx.strokeStyle = `hsla(${hue}, 36%, 88%, ${alpha * 0.5})`;
    ctx.lineWidth = Math.max(0.6, wMax * 0.1);
    ctx.stroke();

    // faint granular endoplasm stipple (sparse, birth-stable) so the body is not
    // a flat wash — but kept light to preserve transparency.
    const gSeed = finiteOr(cell.noiseSeed, 0) | 0;
    const gCount = Math.round(clamp(L * 1.4, 16, 64));
    ctx.fillStyle = `hsla(${hue}, 26%, 86%, ${alpha * 0.16})`;
    for (let g = 0; g < gCount; g++) {
      const gu = (seededUnit(gSeed, g, 0x51bd0e77) * 2 - 1) * 0.86;
      const gs = (seededUnit(gSeed, g, 0x9a1f2b3c) * 2 - 1) * 0.8;
      const hw = halfWidthAt(gu);
      const p = transform(cx, cy, ux, uy, halfLength * gu, gs * hw);
      const r = 0.4 + seededUnit(gSeed, g, 0x2cd9a14b) * 0.7;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.fill();
    }

    // ── horseshoe / sausage macronucleus (cool band, curved along the body) ──
    {
      const muStart = -0.5;
      const muEnd = 0.2;
      const macro: { x: number; y: number }[] = [];
      for (let k = 0; k <= 14; k++) {
        const u = muStart + (muEnd - muStart) * (k / 14);
        const bow = Math.sin((k / 14) * Math.PI) * 0.42; // horseshoe bow toward one side
        const lat = bow * halfWidthAt(u) * rollCos;
        macro.push(transform(cx, cy, ux, uy, halfLength * u, lat));
      }
      ctx.strokeStyle = `hsla(${hue - 4}, 22%, 84%, ${alpha * 0.62})`;
      ctx.lineWidth = Math.max(0.8, wMax * 0.22);
      drawPolyline(ctx, macro, false);
      ctx.stroke();
    }

    // ── two transverse pectinelle girdles (the brightest darkfield feature) ──
    // Each girdle is a band of short radial cilia ticks around the body cross-
    // section at that u. Depth-shaded under roll: near side bright, far side dim.
    const beat = wrapUnit(finiteOr(cell.beatPhase, 0));
    const drawGirdle = (gu: number) => {
      const hw = halfWidthAt(gu);
      const baseAlong = halfLength * gu;
      const ticks = Math.max(8, Math.round(hw * 1.6));
      for (let s = 0; s <= ticks; s++) {
        // parametrize around the ring: theta is the roll angle of each tick
        const theta = (s / ticks) * Math.PI - Math.PI / 2; // -90°..+90° (the visible silhouette span)
        const lat = Math.sin(theta) * hw;
        // depth: front (near) when cos(theta+rollAng) > 0
        const depth = Math.cos(theta + rollAng); // [-1,1], 1 = nearest the viewer
        const front = 0.5 + 0.5 * depth;
        // metachronal beat travels around the ring
        const wave = 0.5 + 0.5 * Math.sin(TAU * beat - theta * 2.2);
        const cilLen = hw * (0.32 + 0.26 * wave);
        const base = transform(cx, cy, ux, uy, baseAlong, lat);
        // cilia tick points slightly outward + forward (toward the snout) — beating
        const tipAlong = baseAlong + cilLen * 0.35;
        const tipLat = lat + Math.sign(lat || 1) * cilLen * 0.5;
        const tip = transform(cx, cy, ux, uy, tipAlong, tipLat);
        ctx.strokeStyle = `hsla(${hue + 6}, 44%, 90%, ${alpha * (0.2 + 0.7 * front)})`;
        ctx.lineWidth = Math.max(0.5, wMax * 0.07);
        ctx.beginPath();
        ctx.moveTo(base.x, base.y);
        ctx.lineTo(tip.x, tip.y);
        ctx.stroke();
      }
      // a faint band line marking the girdle seat
      const band: { x: number; y: number }[] = [];
      for (let s = 0; s <= 12; s++) {
        const theta = (s / 12) * Math.PI - Math.PI / 2;
        band.push(transform(cx, cy, ux, uy, baseAlong, Math.sin(theta) * hw));
      }
      ctx.strokeStyle = `hsla(${hue + 4}, 40%, 92%, ${alpha * 0.4})`;
      ctx.lineWidth = Math.max(0.4, wMax * 0.05);
      drawPolyline(ctx, band, false);
      ctx.stroke();
    };
    drawGirdle(GIRDLE_A_U);
    drawGirdle(GIRDLE_P_U);

    // ── dorsal brushes (brosse): short tufts on the dorsal side below each girdle ──
    const dorsalSign = rollCos >= 0 ? 1 : -1; // dorsal side faces the viewer w/ roll
    const drawBrushes = (gu: number) => {
      const bu = gu - 0.1; // just below the girdle
      const hw = halfWidthAt(bu);
      for (let r = 0; r < BRUSH_ROWS; r++) {
        const along = halfLength * (bu - r * 0.03);
        const lat = dorsalSign * hw * 0.7;
        const base = transform(cx, cy, ux, uy, along, lat);
        const tip = transform(cx, cy, ux, uy, along + hw * 0.12, lat + dorsalSign * hw * 0.28);
        ctx.strokeStyle = `hsla(${hue + 8}, 38%, 88%, ${alpha * 0.3})`;
        ctx.lineWidth = Math.max(0.4, wMax * 0.05);
        ctx.beginPath();
        ctx.moveTo(base.x, base.y);
        ctx.lineTo(tip.x, tip.y);
        ctx.stroke();
      }
    };
    drawBrushes(GIRDLE_A_U);
    drawBrushes(GIRDLE_P_U);

    // ── apical cone snout (cytostome cone), tip closed at rest ──
    {
      const tip = transform(cx, cy, ux, uy, halfLength * 1.0, 0);
      const shL = transform(cx, cy, ux, uy, halfLength * SHOULDER_U, halfWidthAt(SHOULDER_U));
      const shR = transform(cx, cy, ux, uy, halfLength * SHOULDER_U, -halfWidthAt(SHOULDER_U));
      ctx.strokeStyle = `hsla(${hue + 2}, 34%, 88%, ${alpha * 0.5})`;
      ctx.lineWidth = Math.max(0.5, wMax * 0.07);
      ctx.beginPath();
      ctx.moveTo(shL.x, shL.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.lineTo(shR.x, shR.y);
      ctx.stroke();
      // faint apical dot (closed cytostome), not a gaping mouth
      ctx.fillStyle = `hsla(${hue}, 30%, 80%, ${alpha * 0.4})`;
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, Math.max(0.5, wMax * 0.1), 0, TAU);
      ctx.fill();
    }

    // ── terminal contractile vacuole at the aboral (posterior) pole ──
    {
      const cvPulse = 0.5 - 0.5 * Math.cos(TAU * wrapUnit(finiteOr(cell.cvPhase, 0)));
      const cvR = Math.max(0.6, wMax * (0.24 + 0.14 * cvPulse));
      const p = transform(cx, cy, ux, uy, -halfLength * 0.86, 0);
      ctx.fillStyle = `hsla(${hue + 2}, 32%, 92%, ${alpha * 0.42})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, cvR, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = `hsla(${hue + 4}, 40%, 94%, ${alpha * 0.5})`;
      ctx.lineWidth = Math.max(0.4, wMax * 0.05);
      ctx.beginPath();
      ctx.arc(p.x, p.y, cvR, 0, TAU);
      ctx.stroke();
    }
  });

  ctx.restore();
}
