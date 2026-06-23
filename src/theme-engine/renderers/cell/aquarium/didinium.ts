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
const ASPECT = 1.28; // length : width (real D. nasutum ~1.25-1.3:1)
const GIRDLE_A_U = 0.46; // anterior girdle position (shoulder), u ∈ [-1(post), +1(snout)]
const GIRDLE_P_U = -0.16; // posterior girdle position (just below mid-body)
const SHOULDER_U = 0.54; // where the barrel meets the cone snout (a real, visible cone)
const BRUSH_ROWS = 5; // dorsal brushes (brosse) per girdle

// ── swim constants (grounded in real D. nasutum kinematics) ───────────────────
// Real cell: U≈11 BL/s (1.3 mm/s), axial spin Ω≈4.5 rad/s (~0.7 rev/s), thin
// stretched helix (pitch≈10×radius → small helix/lean angle), "constantly
// rotating and leaning to one side" = a smooth corkscrew coupled to the spin,
// punctuated by stops + a fixed-side avoiding reaction that BACKS UP first.
// (bioRxiv 2025.09.12.675801; Jennings 1902; Berdan; cavac/Rosetta)
const STOPGO_FREQ = 0.5; // Hz-ish; erratic cruise stop/dart modulation (phase-fn of frame.t)
const WANDER_FREQ = 0.17; // slow purposeful heading drift (phase-fn of frame.t)
const WANDER_RAD = 0.32; // gentle heading drift swing (rad) — was a too-random 0.7
const HELIX_LEAN = 0.2; // corkscrew lean angle (rad); thin helix, coupled to the axial spin
const CURVE_RATE = 0.32; // rad/s persistent one-sided turning → the real "leaning to one
                       // side" spiral search path. Applied as side*CURVE_RATE*t,
                       // a pure frame.t function (constant within a step) so the
                       // open-water path stays dt-partition exact while the heading
                       // sweeps over frames into a wide spiral.
const WALL_LOOK = 1.4; // body-lengths of anticipatory wall lookahead (tank is short)
const BACKUP_SECONDS = 0.22; // brief reverse jerk that opens the avoiding reaction
const AVOID_SECONDS = 0.6; // eased duration of the fixed-side back-turn after the reverse
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
    return wShoulder * Math.pow(1 - q, 1.15); // blunter, shorter cone (not a witch-hat)
  }
  // ovoid body: moderately narrow anterior shoulder, full belly widest ~40% down,
  // BROADLY ROUNDED posterior (real D. nasutum is plump/egg-shaped, not a flat
  // lemon). Two smooth cosine lobes meet C1-continuously at the belly peak.
  const t = (u - SHOULDER_U) / (-1 - SHOULDER_U); // 0 at shoulder, 1 at aboral pole
  const tp = 0.42; // widest point, just below mid
  if (t <= tp) {
    return 0.72 + 0.28 * Math.sin((t / tp) * (Math.PI / 2)); // shoulder 0.72 -> belly 1.0
  }
  return 0.4 + 0.6 * Math.cos(((t - tp) / (1 - tp)) * (Math.PI / 2)); // belly 1.0 -> rounded pole 0.40
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
      rollRate: 0.7 + seededUnit(seed, i, salt ^ 0x14c8af21) * 0.4, // axial spin (rev/s) — constantly rotating
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
    // biased MOSTLY FAST with occasional near-stops (Didinium is a fast swimmer):
    // 1-(1-x)^p spends most of its range near 1, dipping to ~0 only briefly.
    const cruiseEnv = 0.05 + 0.95 * (1 - Math.pow(1 - stopgo, 2.2));
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

    // The avoiding reaction runs over BACKUP_SECONDS (reverse jerk) + AVOID_SECONDS
    // (fixed-side back-turn). avoidProgress in [0,1] spans the whole thing; the
    // first backupFrac is the reverse, then the heading eases to avoidTo.
    const avoidTotal = BACKUP_SECONDS + AVOID_SECONDS;
    const backupFrac = BACKUP_SECONDS / avoidTotal;
    let reversing = false;
    if (avoidProgress < 1) {
      const next = Math.min(1, avoidProgress + dt / avoidTotal);
      if (avoidProgress < backupFrac) {
        reversing = true; // back up a short distance before turning (Jennings)
      } else {
        const turnK = 6.0; // sharp re-orient toward the fixed side
        heading += wrapPi(avoidTo - heading) * (1 - Math.exp(-turnK * dt));
        if (next >= 1) heading = avoidTo;
      }
      avoidProgress = next;
    } else if (wallPressure > 1e-6) {
      // gentle anticipatory bank away before an actual hit (gated near walls only)
      const desired = Math.atan2(Math.sin(heading) + wallAwayY, Math.cos(heading) + wallAwayX);
      const turnK = 1.0 + 2.5 * Math.min(1, wallPressure);
      heading += wrapPi(desired - heading) * (1 - Math.exp(-turnK * dt));
    }

    // ── travel heading = base + slow wander + PERSISTENT one-sided curvature.
    // Real Didinium "constantly leans to one side" → a looping spiral search path,
    // not a wavy straight line. The curvature is applied as side*CURVE_RATE*t,
    // evaluated at the step's fixed t, so the travel direction sweeps steadily
    // into a wide spiral while the slow wander drifts the spiral centre (epicyclic
    // search). The body is drawn along THIS travel heading (snout leads the path).
    // NOTE: linear-in-t → a 2-step approximation, NOT bit-exact under dt-partition
    // like the bounded phase terms; the dedicated partition test stays on the
    // constant-heading pure-forward open-water cruise.
    const curve = side * CURVE_RATE * t;
    const travel = heading + wander * (0.3 + 0.7 * cruiseEnv) + curve;
    // ── thin corkscrew LEAN at the axial SPIN frequency: a small constant-
    // amplitude offset so the velocity traces a tight cone (thin helix, pitch >>
    // radius). Spin freq is set by the cilia beat chirality, ~speed-independent
    // (NOT scaled by audio) — real Ω≈0.7 rev/s. Fixed per-cell phase seed keeps it
    // a pure frame.t function (partition exact) and de-syncs cells.
    const spinFreq = Math.max(0, finite(cell.rollRate, 0)); // rev/s, decoupled from activity
    const spinSeed = seededUnit(nseed, 0, 0x6c8e9cf5);
    const spinAng = TAU * (spinSeed + spinFreq * t);
    const lean = Math.sin(spinAng) * HELIX_LEAN; // speed-independent radius
    const eh = travel + lean; // velocity direction (travel + fast helix lean)
    const ux = Math.cos(eh);
    const uy = Math.sin(eh);
    const vSigned = reversing ? -vPx * 0.6 : vPx; // brief reverse jerk
    let nextX = px0 + ux * vSigned * dt;
    let nextY = py0 + uy * vSigned * dt;
    nextX = clamp(nextX, 0, safeWidth);
    nextY = clamp(nextY, 0, safeHeight);

    // beat freq capped so the metachronal girdle shimmer stays < Nyquist.
    const beatEff = Math.min(6, Math.max(0, finite(cell.beatRate, 0)) * act);

    return {
      ...cell,
      x: nextX,
      y: nextY,
      // phase carries the TRAVEL heading (snout leads the PATH); the fast helix
      // lean is left OUT of the body orientation so the body axis holds near the
      // helix axis instead of wagging (critic C). base `heading` = cruise dir.
      phase: travel,
      heading,
      // visible axial roll: advance at the SAME un-scaled spinFreq (rollRate) as
      // the helix-lean clock, so the rendered girdle spin and the path corkscrew
      // phase-lock. NOT multiplied by `act` (spin is beat-chirality set, ~0.7
      // rev/s, speed/audio-independent — dynamics critics round 1+2 [S4]).
      rollPhase: wrapUnit(finite(cell.rollPhase, 0) + spinFreq * dt),
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
    // orient the body along the TRAVEL heading (phase) so the snout always leads
    // the actual motion (no sideways crab); falls back to heading at seed.
    const heading = finiteOr(cell.phase, finite(cell.heading, 0));
    const ux = Math.cos(heading);
    const uy = Math.sin(heading);
    const cx = finite(cell.x, 0);
    const cy = finite(cell.y, 0);
    const roll = wrapUnit(finite(cell.rollPhase, 0));
    const rollAng = roll * TAU;
    const rollCos = Math.cos(rollAng);
    // near-constant silhouette: a barrel spinning about its long axis keeps a
    // round cross-section, so only a slight (8%) breathing — the roll is carried
    // by the depth-shaded girdle ticks, NOT by squashing the whole body (which
    // read as a non-physical fat wobble). (math critic S4)
    const widthMul = 0.96 + 0.04 * Math.abs(rollCos);

    const halfWidthAt = (u: number): number => wMax * widthMul * normHalfWidth(u);

    // ── body outline (closed barrel + cone snout), cosine-clustered samples ──
    const SAMP = 64; // higher → smooth rounded silhouette (no faceting)
    const upper: { x: number; y: number }[] = [];
    const lower: { x: number; y: number }[] = [];
    for (let i = 0; i <= SAMP; i++) {
      const u = -Math.cos((Math.PI * i) / SAMP); // clusters toward poles
      const hw = halfWidthAt(u);
      upper.push(transform(cx, cy, ux, uy, halfLength * u, hw));
      lower.push(transform(cx, cy, ux, uy, halfLength * u, -hw));
    }
    const outline = [...upper, ...lower.reverse()];

    // ── body: LUMINOUS cool blue-white granule-scattering glow (darkfield) ──
    // A radial gradient inside the clipped outline makes the whole zooid glow
    // edge-to-edge instead of a flat grey card. Brightest mid-body, easing out.
    ctx.save();
    drawPolyline(ctx, outline, true);
    ctx.clip();
    const glowR = Math.max(1, halfLength * 1.05);
    const grad = ctx.createRadialGradient(cx, cy, glowR * 0.1, cx, cy, glowR);
    grad.addColorStop(0, `hsla(${hue}, 26%, 92%, ${alpha * 0.66})`);
    grad.addColorStop(0.62, `hsla(${hue + 2}, 30%, 84%, ${alpha * 0.5})`);
    grad.addColorStop(1, `hsla(${hue + 4}, 34%, 74%, ${alpha * 0.16})`);
    ctx.fillStyle = grad;
    ctx.fillRect(cx - glowR, cy - glowR, glowR * 2, glowR * 2);

    // dense two-layer granular endoplasm stipple (coarse + fine), birth-stable,
    // so the body scatters like packed cytoplasm (clipped to the outline).
    const gSeed = finiteOr(cell.noiseSeed, 0) | 0;
    const gCount = Math.round(clamp(L * 6, 60, 220)); // denser packed endoplasm (real cytoplasm is crowded)
    ctx.fillStyle = `hsla(${hue}, 24%, 90%, ${alpha * 0.34})`;
    for (let g = 0; g < gCount; g++) {
      const gu = (seededUnit(gSeed, g, 0x51bd0e77) * 2 - 1) * 0.9;
      const gs = (seededUnit(gSeed, g, 0x9a1f2b3c) * 2 - 1) * 0.92;
      const hw = halfWidthAt(gu);
      const p = transform(cx, cy, ux, uy, halfLength * gu, gs * hw);
      const r = 0.5 + seededUnit(gSeed, g, 0x2cd9a14b) * 0.9;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.fill();
    }
    const gCount2 = Math.round(clamp(L * 4, 40, 150));
    ctx.fillStyle = `hsla(${hue + 4}, 20%, 94%, ${alpha * 0.16})`;
    for (let g = 0; g < gCount2; g++) {
      const gu = (seededUnit(gSeed, g, 0x3da17c45) * 2 - 1) * 0.9;
      const gs = (seededUnit(gSeed, g, 0x59e2b7a3) * 2 - 1) * 0.92;
      const hw = halfWidthAt(gu);
      const p = transform(cx, cy, ux, uy, halfLength * gu, gs * hw);
      const r = 0.3 + seededUnit(gSeed, g, 0x14c8af21) * 0.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // feathered scattering rim (no hard ink line): brighter on the flanks, dim at
    // the poles — darkfield bands are fuzzy, not geometric construction lines.
    for (let i = 0; i < upper.length - 1; i++) {
      const u = -Math.cos((Math.PI * i) / SAMP);
      const flank = 1 - Math.abs(u); // bright mid-body flanks, dim toward poles
      const a = alpha * (0.1 + 0.18 * flank * flank); // dimmer, squared falloff (rim < interior)
      ctx.strokeStyle = `hsla(${hue + 2}, 32%, 92%, ${a})`;
      ctx.lineWidth = Math.max(0.5, wMax * 0.07);
      ctx.beginPath();
      ctx.moveTo(upper[i].x, upper[i].y);
      ctx.lineTo(upper[i + 1].x, upper[i + 1].y);
      ctx.moveTo(lower[i].x, lower[i].y);
      ctx.lineTo(lower[i + 1].x, lower[i + 1].y);
      ctx.stroke();
    }

    // ── horseshoe / sausage macronucleus (soft cool band, fades when edge-on) ──
    {
      const muStart = -0.58;
      const muEnd = 0.4; // spans ~0.6L
      const bowDepth = 0.72 * (0.45 + 0.55 * Math.abs(rollCos)); // deeper C-bow + floor so it never collapses to a strut
      // smooth continuous horseshoe: many samples + a half-cosine along-axis arc so
      // the C stays a rounded semicircle at every roll phase (no chevron kink).
      const MN = 40;
      const side2 = rollCos >= 0 ? 1 : -1;
      const macro: { x: number; y: number }[] = [];
      for (let k = 0; k <= MN; k++) {
        const f = k / MN;
        // place samples along a true arc: the along-axis coord follows a gentle
        // cosine so endpoints curl back (horseshoe), not a straight bar.
        const u = muStart + (muEnd - muStart) * (0.5 - 0.5 * Math.cos(Math.PI * f));
        const bow = Math.sin(f * Math.PI) * bowDepth;
        const lat = bow * halfWidthAt(u) * side2;
        macro.push(transform(cx, cy, ux, uy, halfLength * u, lat));
      }
      // FILLED SAUSAGE: offset the centerline perpendicular to its local tangent
      // by a half-thickness that tapers to rounded ends, building a closed ribbon
      // — a solid worm-like macronucleus (Berdan DIC), not a hollow stroked tube.
      const halfTh = Math.max(1.2, wMax * 0.2); // half-thickness of the sausage
      const left: { x: number; y: number }[] = [];
      const right: { x: number; y: number }[] = [];
      for (let k = 0; k <= MN; k++) {
        const f = k / MN;
        const taper = Math.pow(Math.sin(Math.max(0, Math.min(1, f)) * Math.PI), 0.45); // rounded ends
        const a = macro[Math.max(0, k - 1)];
        const b = macro[Math.min(MN, k + 1)];
        let tx = b.x - a.x, ty = b.y - a.y;
        const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
        const nx2 = -ty, ny2 = tx; // perpendicular to the centerline tangent
        const th = halfTh * taper;
        const p = macro[k];
        left.push({ x: p.x + nx2 * th, y: p.y + ny2 * th });
        right.push({ x: p.x - nx2 * th, y: p.y - ny2 * th });
      }
      const ribbon = [...left, ...right.reverse()];
      // soft dark-cool underglow halo to set the C off from the bright endoplasm
      drawPolyline(ctx, macro, false);
      ctx.strokeStyle = `hsla(${hue - 6}, 22%, 70%, ${alpha * 0.3})`;
      ctx.lineWidth = Math.max(2.2, wMax * 0.62);
      ctx.stroke();
      // DOMINANT solid filled C — the single headline DIC interior landmark
      drawPolyline(ctx, ribbon, true);
      ctx.fillStyle = `hsla(${hue - 4}, 30%, 82%, ${alpha * 0.86})`;
      ctx.fill();
      // faint brighter rim on the filled body for refractile relief
      ctx.strokeStyle = `hsla(${hue - 2}, 34%, 90%, ${alpha * 0.4})`;
      ctx.lineWidth = Math.max(0.4, wMax * 0.04);
      ctx.stroke();
    }

    // ── two TRANSVERSE pectinelle girdles = bright encircling ciliary rings ──
    // Each girdle is a full hoop (0..2π) around the body cross-section, projected
    // as a thin ellipse (wide along the body normal, foreshortened along-axis).
    // Many SHORT radial cilia ticks fringe it; depth-shaded by roll (near bright /
    // far dim) so the ring visibly sweeps as the body rotates. Metachronal wave
    // runs around the ring. NO forward sweep — ticks are radial (not blades).
    // No drawn seat-ellipse (that read as a wireframe hoop). Instead a fuzzy band
    // of short cilia ticks, with the FAR half of the ring clipped (invisible), so
    // each girdle reads as a bright scattering crescent on the near face that
    // sweeps as the body rolls. Many faint jittered ticks, metachronal wave.
    const beat = wrapUnit(finiteOr(cell.beatPhase, 0));
    const RING_TILT = 0.18; // along-axis foreshortening: low → a FLAT transverse band, not a tilted spiral
    const gSeedR = finiteOr(cell.noiseSeed, 0) | 0;
    const drawGirdle = (gu: number, seatHue: number, gi: number) => {
      const hw = halfWidthAt(gu);
      const baseAlong = halfLength * gu;
      const NT = 72; // DENSE fine fringe (real pectinelles are numerous close-set cilia)
      // bright near-arc band seat line so the girdle reads as a crisp transverse
      // BAND, not a string of separate beads (far arc skipped → no wireframe).
      const seat: { x: number; y: number }[] = [];
      for (let s = 0; s <= NT; s++) {
        const phi = (s / NT) * TAU;
        if (Math.cos(phi + rollAng) < -0.05) { if (seat.length > 1) { drawPolyline(ctx, seat, false); ctx.strokeStyle = `hsla(${seatHue}, 44%, 94%, ${alpha * 0.5})`; ctx.lineWidth = Math.max(0.5, wMax * 0.06); ctx.stroke(); } seat.length = 0; continue; }
        const lat = Math.cos(phi) * hw;
        const along = baseAlong + Math.sin(phi) * hw * RING_TILT;
        seat.push(transform(cx, cy, ux, uy, along, lat));
      }
      if (seat.length > 1) { drawPolyline(ctx, seat, false); ctx.strokeStyle = `hsla(${seatHue}, 44%, 94%, ${alpha * 0.5})`; ctx.lineWidth = Math.max(0.5, wMax * 0.06); ctx.stroke(); }
      ctx.lineWidth = Math.max(0.4, wMax * 0.045);
      for (let s = 0; s < NT; s++) {
        const phi = (s / NT) * TAU;
        const depth = Math.cos(phi + rollAng); // 1 = nearest viewer
        if (depth < -0.1) continue; // clip the FAR arc → no wireframe back-side
        const front = clamp01(0.5 + 0.5 * depth);
        const jit = (seededUnit(gSeedR, s + gi * 97, 0x2cd9a14b) - 0.5) * 0.1;
        const lat = Math.cos(phi) * hw;
        const along = baseAlong + Math.sin(phi) * hw * RING_TILT;
        const wave = 0.5 + 0.5 * Math.sin(TAU * beat - phi * 3.0); // metachronal
        const cilLen = hw * (0.16 + 0.12 * wave) * (1 + jit); // a touch longer/crisper
        const base = transform(cx, cy, ux, uy, along, lat);
        const outLat = Math.cos(phi);
        const outAlong = Math.sin(phi) * RING_TILT;
        const tip = transform(cx, cy, ux, uy, along + outAlong * cilLen, lat + outLat * cilLen);
        ctx.strokeStyle = `hsla(${seatHue}, 44%, 92%, ${alpha * (0.12 + 0.6 * front)})`;
        ctx.beginPath();
        ctx.moveTo(base.x, base.y);
        ctx.lineTo(tip.x, tip.y);
        ctx.stroke();
      }
    };
    drawGirdle(GIRDLE_A_U, hue + 6, 0);
    drawGirdle(GIRDLE_P_U, hue + 6, 1);

    // ── dorsal brushes (brosse): short clavate tick rows behind each girdle, on
    // the NEAR hemisphere only (depth-gated) — a named D. nasutum diagnostic. ──
    const drawBrushes = (gu: number) => {
      const phi = rollAng; // dorsal landmark rides the near face as the body rolls
      const depth = Math.cos(phi); // near when > 0
      if (depth < 0) return; // hidden on the far hemisphere
      const front = clamp01(0.5 + 0.5 * depth);
      for (let r = 0; r < BRUSH_ROWS; r++) {
        const bu = gu - 0.06 - r * 0.035; // a few rows just behind the girdle
        const hw = halfWidthAt(bu);
        const lat = Math.cos(phi) * hw * 0.62;
        const along = halfLength * bu + Math.sin(phi) * hw * 0.34 * 0.62;
        const base = transform(cx, cy, ux, uy, along, lat);
        const tip = transform(cx, cy, ux, uy, along + hw * 0.06, lat + Math.sign(lat || 1) * hw * 0.16);
        ctx.strokeStyle = `hsla(${hue + 8}, 40%, 90%, ${alpha * 0.34 * front})`;
        ctx.lineWidth = Math.max(0.4, wMax * 0.05);
        ctx.beginPath();
        ctx.moveTo(base.x, base.y);
        ctx.lineTo(tip.x, tip.y);
        ctx.stroke();
      }
    };
    drawBrushes(GIRDLE_A_U);
    drawBrushes(GIRDLE_P_U);

    // ── apical cone snout (cytostome cone), filled, protruding, closed at rest ──
    {
      const coneBaseU = SHOULDER_U;
      const tip = transform(cx, cy, ux, uy, halfLength * 1.14, 0); // taller, dramatic proboscis
      const shL = transform(cx, cy, ux, uy, halfLength * coneBaseU, halfWidthAt(coneBaseU));
      const shR = transform(cx, cy, ux, uy, halfLength * coneBaseU, -halfWidthAt(coneBaseU));
      // filled cone with the body glow so it reads as a solid protrusion
      ctx.beginPath();
      ctx.moveTo(shL.x, shL.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.lineTo(shR.x, shR.y);
      ctx.closePath();
      ctx.fillStyle = `hsla(${hue + 2}, 28%, 90%, ${alpha * 0.52})`;
      ctx.fill();
      // feathered cone flanks (no hard straight outline) — only the two flank edges,
      // so the cone scatters like the body rather than a constructed triangle.
      ctx.strokeStyle = `hsla(${hue + 4}, 36%, 94%, ${alpha * 0.4})`;
      ctx.lineWidth = Math.max(0.5, wMax * 0.06);
      ctx.beginPath();
      ctx.moveTo(shL.x, shL.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.lineTo(shR.x, shR.y);
      ctx.stroke();
      // nematodesmal striae: faint longitudinal lines fanning from the cone base to
      // the apex (the palisade of stiff rods supporting the proboscis).
      ctx.strokeStyle = `hsla(${hue + 4}, 32%, 94%, ${alpha * 0.32})`;
      ctx.lineWidth = Math.max(0.35, wMax * 0.035);
      const NS = 5;
      for (let k = 1; k < NS; k++) {
        const f = k / NS; // across the cone base
        const lat = (f * 2 - 1) * halfWidthAt(coneBaseU);
        const base = transform(cx, cy, ux, uy, halfLength * coneBaseU, lat);
        ctx.beginPath();
        ctx.moveTo(base.x, base.y);
        ctx.lineTo(tip.x, tip.y);
        ctx.stroke();
      }
      // collar of forward-flared cilia at the cone base — the prominent anterior
      // wreath seen in the micrographs where the snout joins the body.
      const collarHw = halfWidthAt(coneBaseU);
      ctx.lineWidth = Math.max(0.45, wMax * 0.05);
      for (let s = 0; s <= 10; s++) {
        const f = s / 10;
        const lat = (f * 2 - 1) * collarHw;
        const depth = Math.cos(rollAng); // collar rides the near face
        if (depth < -0.2) continue;
        const front = clamp01(0.5 + 0.5 * depth);
        const base = transform(cx, cy, ux, uy, halfLength * coneBaseU, lat);
        // flare slightly outward + forward (toward the snout)
        const tipC = transform(cx, cy, ux, uy, halfLength * (coneBaseU + 0.08), lat + Math.sign(lat || 1) * collarHw * 0.22);
        ctx.strokeStyle = `hsla(${hue + 6}, 44%, 93%, ${alpha * (0.16 + 0.5 * front)})`;
        ctx.beginPath();
        ctx.moveTo(base.x, base.y);
        ctx.lineTo(tipC.x, tipC.y);
        ctx.stroke();
      }
      // bright apical pip (closed cytostome), not a gaping mouth
      ctx.fillStyle = `hsla(${hue + 4}, 42%, 96%, ${alpha * 0.72})`;
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, Math.max(0.5, wMax * 0.11), 0, TAU);
      ctx.fill();
    }

    // ── terminal contractile vacuole at the aboral (posterior) pole, refractile ──
    {
      const cvPulse = 0.5 - 0.5 * Math.cos(TAU * wrapUnit(finiteOr(cell.cvPhase, 0)));
      const cvR = Math.max(0.5, wMax * (0.13 + 0.06 * cvPulse)); // small, ~0.15×
      const p = transform(cx, cy, ux, uy, -halfLength * 0.78, 0); // inboard
      ctx.fillStyle = `hsla(${hue + 2}, 30%, 93%, ${alpha * 0.26})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, cvR, 0, TAU);
      ctx.fill();
      // refractile ring (annulus), not a solid eye
      ctx.strokeStyle = `hsla(${hue + 4}, 42%, 95%, ${alpha * 0.5})`;
      ctx.lineWidth = Math.max(0.4, wMax * 0.04);
      ctx.beginPath();
      ctx.arc(p.x, p.y, cvR, 0, TAU);
      ctx.stroke();
    }
  });

  ctx.restore();
}
