import { KIND_ID, sourceId } from "../interaction";
import type { FieldContribution, FieldKind } from "../interaction";
import type { AquariumFrame, AquariumParamsView, DidiniumState } from "../types";
import { mix32, noise2D, seededUnit } from "../seeds";
import { TAU, clamp, clamp01, finite, finiteOr, wrapUnit } from "../util";
import { didiniumDisplayLength } from "./geometry";

/** Frozen per-species deterministic salt for Didinium seeding. */
export const DIDINIUM_SALT = 0x0d1d1c0a;

// ── swim constants (grounded in real D. nasutum kinematics) ───────────────────
// Real cell: U≈11 BL/s (1.3 mm/s), axial spin Ω≈4.5 rad/s (~0.7 rev/s), thin
// stretched helix (pitch≈10×radius → small helix/lean angle), "constantly
// rotating and leaning to one side" = a smooth corkscrew coupled to the spin,
// punctuated by stops + a fixed-side avoiding reaction that BACKS UP first.
// (bioRxiv 2025.09.12.675801; Jennings 1902; Berdan; cavac/Rosetta)
const STOPGO_FREQ = 0.32; // Hz-ish; calm stop/dart modulation (phase-fn of frame.t)
const WANDER_FREQ = 0.1; // slow purposeful heading drift (phase-fn of frame.t): low so
                       // straight runs last longer (real Didinium darts in long runs)
const WANDER_RAD = 0.42; // open-water heading swing (rad): calm wide-search travel
                      // direction MEANDERS in 2D mid-tank (not a dead-straight shot that
                      // only turns at walls), but not so wide that turns stack into a
                      // loop. Two-sided noise → cannot loop; pure fn of t → partition-exact.
const HELIX_LEAN = 0.07; // corkscrew lean angle (rad); thin helix, coupled to the axial spin
// One-sided turning BIAS as a BOUNDED slow phase-function of frame.t: a slow
// noise envelope (0..1) scaled by a max lean angle and the fixed per-cell side.
// When the envelope is low the cell runs near-straight (directed gait); when it
// rises it leans to its fixed side (the real "constantly leaning" search) — so
// the path alternates straight runs and gentle one-sided turns instead of one
// permanent loop. Bounded → frame-rate independent & dt-partition exact at every
// t (unlike the old linear-in-t side*CURVE_RATE*t, which grew without bound and
// made the partition error climb with t).
const CURVE_FREQ = 0.09; // Hz-ish; how fast the one-sided turning bias varies
const CURVE_BIAS = 0.18; // max one-sided lean (rad) — gentle, so it does not by itself loop
const WALL_LOOK = 1.25; // body-lengths of anticipatory wall lookahead. MUST be small enough
                     // that the tank centre is genuine open water (zero wall pressure):
                     // the tank is only ~2.5 body-heights tall, so a large look made
                     // pressure>0 everywhere → the avoiding reaction re-fired forever and
                     // the cell circled the perimeter. Small look = bank only when close.
const BACKUP_SECONDS = 0.08; // brief reverse jerk that opens the avoiding reaction
const AVOID_SECONDS = 0.18; // eased duration of the fixed-side back-turn after the reverse
const AVOID_TURN_MIN = (2 * Math.PI) / 3; // ~120° sharp re-orient
const AVOID_TURN_MAX = (5 * Math.PI) / 6; // ~150°

interface DidiniumModeView {
  readonly motionMul: number;
}

function didiniumModeView(mode: AquariumFrame["mode"]): DidiniumModeView {
  switch (mode) {
    case "recording":
      return { motionMul: 1.2 };
    case "transcribing":
      return { motionMul: 0.35 };
    case "error":
      return { motionMul: 0.15 };
    case "idle":
    default:
      return { motionMul: 1.0 };
  }
}

export function seedDidinium(count: number, seed: number, frame: AquariumFrame, salt = DIDINIUM_SALT): DidiniumState[] {
  if (count <= 0) return [];
  const out: DidiniumState[] = [];
  const safeWidth = Math.max(0, finite(frame.width, 0));
  const safeHeight = Math.max(0, finite(frame.height, 0));
  for (let i = 0; i < count; i++) {
    // full 360° random initial heading (NOT just horizontal {0,π}) so the cell
    // explores the whole tank vertically too, not a mid-height horizontal ping-pong.
    const heading = seededUnit(seed, i, salt ^ 0x68bc21eb) * TAU;
    out.push({
      x: (0.2 + 0.6 * seededUnit(seed, i, salt)) * safeWidth, // start mid-water
      y: (0.25 + 0.5 * seededUnit(seed, i, salt ^ 0x51ed270b)) * safeHeight,
      phase: heading,
      size: 0.5 + seededUnit(seed, i, salt ^ 0x02e5be93),
      heading,
      swimSpeed: 0.85 + seededUnit(seed, i, salt ^ 0x2fda92a1) * 0.3,
      rollPhase: seededUnit(seed, i, salt ^ 0x4207e617),
      rollRate: 0.6 + seededUnit(seed, i, salt ^ 0x14c8af21) * 0.24, // axial spin (rev/s) — centred on real Ω≈0.7 rev/s
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

export const DIDINIUM_RELEVANT_FIELDS: ReadonlySet<FieldKind> = new Set(["obstacle", "motile"]);

/**
 * Field contribution: Didinium emits a `motile` at its body position so other
 * organisms (e.g. a Vorticella mechanosensor) can react to it. Didinium also
 * consumes prey/obstacle/motile fields in multi-organism themes, while SOLO
 * themes stay inert because no interaction field is present.
 */
export function didiniumContribute(cell: DidiniumState, idx: number, scale = 1): FieldContribution[] {
  const length = didiniumDisplayLength(finite(cell.size, 1), scale);
  return [{
    kind: "motile",
    x: finite(cell.x, 0),
    y: finite(cell.y, 0),
    heading: finiteOr(cell.heading, finiteOr(cell.phase, 0)),
    radius: length * 0.35,
    speed: Math.max(0, finiteOr(cell.swimSpeed, 0)),
    role: "predator",
    strength: 0.75,
    sourceId: sourceId("didinium", idx),
  }];
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
    const wasContacting = finiteOr(cell.contactTimer, 0) > 0;
    let contactTimer = Math.max(0, finiteOr(cell.contactTimer, 0) - dt);
    let contactDuration = Math.max(0, finiteOr(cell.contactDuration, contactTimer));
    let huntCooldown = Math.max(0, finiteOr(cell.huntCooldown, 0) - dt);

    // ── erratic cruise: fast cruise punctuated by abrupt slow-downs ("stops").
    // Phase-function of ABSOLUTE frame.t only (never accumulated, never position-
    // dependent) → dt-partition exact at fixed frame.t. noise raised to a power
    // makes most of the time fast with occasional near-stops.
    const stopgo = noise2D(nseed ^ 0x53705f00, t * STOPGO_FREQ, 0.13);
    // biased MOSTLY FAST with occasional near-stops (Didinium is a fast swimmer):
    // 1-(1-x)^p spends most of its range near 1, dipping to ~0 only briefly.
    const cruiseEnv = 0.65 + 0.35 * (1 - Math.pow(1 - stopgo, 1.4));
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
    // Trigger the Jennings avoiding reaction EARLY (while still well away from the
    // wall) so the cell smoothly turns BEFORE it ever reaches the clamp — no edge
    // hugging and no hard billiard flip. Turn AWAY from the wall (toward the
    // inward normal) on the fixed per-cell side, not a blind fixed magnitude.
    // with the small look, single-wall pressure maxes ~0.15 at the clamp; trigger
    // the eased Jennings turn just before contact (the clamp branch is the backstop).
    const hitWall = wallPressure > 0.12 && avoidProgress >= 1;
    if (hitWall) {
      avoidIndex += 1;
      const magU = noise2D(nseed ^ 0x2f31a7d5, avoidIndex, 0.71);
      const magnitude = AVOID_TURN_MIN + (AVOID_TURN_MAX - AVOID_TURN_MIN) * magU;
      avoidFrom = heading;
      // bias the turn toward the inward direction (away from the wall) so it
      // reliably clears the wall, then add the fixed-side Jennings sweep.
      const inward = Math.atan2(wallAwayY, wallAwayX);
      avoidTo = inward + side * magnitude * 0.5;
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
      // strong, scaled anticipatory bank: with the larger look there is real
      // runway between first wall pressure and the clamp, so a firm turn here wins
      // the race and the cell veers away BEFORE it ever reaches the boundary (no
      // rail-glide). turnK grows steeply with pressure.
      const turnK = 3.0 + 7.0 * Math.min(1, wallPressure);
      heading += wrapPi(desired - heading) * (1 - Math.exp(-turnK * dt));
    }

    // ── group interaction: Didinium is a Paramecium predator, not just a decorative
    // independent swimmer. Consume the pre-update InteractionField:
    // • social hero ellipse = prey target → soft pursuit from mid range;
    // • circle obstacles (Vorticella bell) = obstacle → bank away.
    // Both are gated to open-ish water and avoidProgress==1 so wall/avoidance
    // reactions still dominate, and defaults/no-hero solo themes stay no-op.
    const field = frame.interaction;
    const prey = (field?.obstacles ?? []).find((obs) => obs.shape === "ellipse" && obs.social);
    let preyData: { q: number; surfaceX: number; surfaceY: number; preyX: number; preyY: number; approachDot: number } | null = null;
    let huntWeight = 0;
    if (prey && prey.shape === "ellipse") {
      const hh = finiteOr(prey.heading, 0);
      const ch = Math.cos(hh), sh = Math.sin(hh);
      const dx = px0 - prey.x;
      const dy = py0 - prey.y;
      const localX = dx * ch + dy * sh;
      const localY = -dx * sh + dy * ch;
      const A = Math.max(1e-3, finiteOr(prey.halfLen, 1) + L * 0.38);
      const B = Math.max(1e-3, finiteOr(prey.halfWid, 1) + L * 0.38);
      const q = Math.sqrt((localX * localX) / (A * A) + (localY * localY) / (B * B)) || 1e-6;
      const targetQ = 1.03; // close latch: body stays outside while snout/filaments meet the membrane
      const sx = localX * (targetQ / q);
      const sy = localY * (targetQ / q);
      const surfaceX = prey.x + sx * ch - sy * sh;
      const surfaceY = prey.y + sx * sh + sy * ch;
      const toTargetX = q < 1 ? prey.x - px0 : surfaceX - px0;
      const toTargetY = q < 1 ? prey.y - py0 : surfaceY - py0;
      const toTargetD = Math.hypot(toTargetX, toTargetY) || 1;
      const probeHeading = heading + wander;
      const approachDot = (Math.cos(probeHeading) * toTargetX + Math.sin(probeHeading) * toTargetY) / toTargetD;
      preyData = { q, surfaceX, surfaceY, preyX: prey.x, preyY: prey.y, approachDot };
      if (q < 1.07 && approachDot > 0.55 && huntCooldown <= 0 && contactTimer <= 0 && avoidProgress >= 1) {
        contactDuration = 2.4 + seededUnit(nseed, 0, 0x2a91f00d) * 0.9;
        contactTimer = contactDuration;
      }
    }
    let obstaclePressure = 0;
    let obstacleAwayX = 0;
    let obstacleAwayY = 0;
    const circleObstacles: Array<{ x: number; y: number; radius: number }> = [];
    for (const obs of field?.obstacles ?? []) {
      if (obs.shape !== "circle") continue;
      circleObstacles.push({ x: obs.x, y: obs.y, radius: obs.radius });
      const dx = px0 - obs.x;
      const dy = py0 - obs.y;
      const d = Math.hypot(dx, dy) || 1;
      const reach = obs.radius + L * 1.25;
      if (d < reach) {
        const p = 1 - d / reach;
        obstaclePressure += p;
        obstacleAwayX += (dx / d) * p;
        obstacleAwayY += (dy / d) * p;
      }
    }
    for (const motile of field?.motiles ?? []) {
      if ((motile.sourceId >> 20) !== KIND_ID.euglena) continue;
      const dx = px0 - motile.x;
      const dy = py0 - motile.y;
      const d = Math.hypot(dx, dy) || 1;
      const radius = Math.max(0, finiteOr(motile.radius, 0));
      const reach = Math.max(8, 0.85 * (L + radius));
      if (d < reach) {
        const p = (1 - d / reach) * 0.45; // neutral deflection, not prey pursuit
        obstaclePressure += p;
        obstacleAwayX += (dx / d) * p;
        obstacleAwayY += (dy / d) * p;
      }
    }
    if (obstaclePressure > 1e-4 && avoidProgress >= 1) {
      const desired = Math.atan2(obstacleAwayY, obstacleAwayX);
      const turnK = 2.5 + 5.0 * Math.min(1, obstaclePressure);
      heading += wrapPi(desired - heading) * (1 - Math.exp(-turnK * dt));
    } else if (avoidProgress >= 1 && wallPressure < 0.2 && contactTimer <= 0) {
      if (preyData) {
        const dx = preyData.surfaceX - px0;
        const dy = preyData.surfaceY - py0;
        const d = Math.hypot(dx, dy) || 1;
        const sense = clamp(L * 2.0, 32, 52);
        if (d < sense && preyData.approachDot > -0.15) {
          const cone = clamp01((preyData.approachDot + 0.15) / 0.65);
          const huntRaw = clamp01((sense - d) / (sense * 0.75)) * cone;
          const hunt = preyData.q < 1.07 ? huntRaw : Math.min(0.35, huntRaw);
          huntWeight = hunt;
          const desired = Math.atan2(dy, dx); // aim at prey SURFACE, not centroid
          const turnK = 1.4 + 2.4 * hunt;
          heading += wrapPi(desired - heading) * (1 - Math.exp(-turnK * dt)) * hunt;
        }
      }
    }

    // ── travel heading = base + slow wander + BOUNDED one-sided turning bias.
    // Real Didinium "constantly leans to one side" between straight runs. curveEnv
    // is a slow bounded noise envelope of absolute frame.t: near 0 the cell runs
    // near-straight (directed gait), rising it leans to its fixed side — so the
    // path alternates runs and gentle turns instead of one permanent loop. Bounded
    // (no linear-in-t growth) so it is frame-rate independent; the partition error
    // stays sub-pixel and non-secular (does NOT climb with t). Forward-Euler with a
    // time-varying direction is not strictly bit-exact, so the dedicated partition
    // test stays on the constant-heading pure-forward open-water cruise.
    const curveEnv = clamp01(noise2D(nseed ^ 0x77c1a2b3, t * CURVE_FREQ, 0.29));
    const curve = side * CURVE_BIAS * curveEnv;
    const huntSuppression = 1 - 0.35 * huntWeight;
    const travel = heading + wander * (0.3 + 0.7 * cruiseEnv) * huntSuppression + curve * huntSuppression;
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
    const vSigned = reversing ? -vPx * 0.28 : vPx; // brief reverse easing
    const rawX = px0 + ux * vSigned * dt;
    const rawY = py0 + uy * vSigned * dt;
    let nextX = rawX;
    let nextY = rawY;
    if (contactTimer > 0 && preyData) {
      // Surface latch/stand-off: overdamped servo toward the prey boundary with
      // the snout aimed into the Paramecium. This reads as contact/attack while
      // avoiding a magnetic snap or the grey body sinking into the hero.
      const corrX = preyData.surfaceX - nextX;
      const corrY = preyData.surfaceY - nextY;
      const corrL = Math.hypot(corrX, corrY) || 1;
      const maxStep = L * (preyData.q < 1 ? 0.65 : 0.04);
      const kLatch = preyData.q < 1 ? 1 : 1 - Math.exp(-2.0 * dt);
      const step = Math.min(maxStep, corrL * kLatch);
      nextX += (corrX / corrL) * step;
      nextY += (corrY / corrL) * step;
      heading = Math.atan2(preyData.preyY - nextY, preyData.preyX - nextX);
    }
    // Keep the whole BODY on-canvas: clamp the centroid inset by half a body
    // length (not to 0), so the cell never slides half-off the wall. Wall-only
    // safety net — in open water nextX/Y are far inside, so this is a no-op and
    // the dt-partition pure-forward path is unaffected.
    // half-extent incl. the protruding cone snout (tip at ~1.14*halfLength) so the
    // proboscis never poked off-canvas either.
    // cone apex and aboral dome both reach ~0.51*L from the centroid, so 0.55*L
    // keeps the whole body on-canvas with a little slack while leaving more open
    // water (a smaller margin = a bigger zero-wall-pressure centre).
    const margin = Math.min(L * 0.55, safeWidth * 0.45, safeHeight * 0.45);
    for (const obs of circleObstacles) {
      const dx = nextX - obs.x;
      const dy = nextY - obs.y;
      const d = Math.hypot(dx, dy) || 1;
      const minD = obs.radius + L * 0.45;
      if (d < minD) {
        const need = minD - d;
        const step = Math.min(L * 0.35, need * (1 - Math.exp(-8 * dt)));
        nextX += (dx / d) * step;
        nextY += (dy / d) * step;
        if (d < obs.radius + L * 0.9 && avoidProgress >= 1 && contactTimer <= 0) {
          avoidIndex += 1;
          avoidFrom = heading;
          avoidTo = Math.atan2(dy, dx) + side * Math.PI * 0.55;
          avoidProgress = 0;
        }
      }
    }
    nextX = clamp(nextX, margin, safeWidth - margin);
    nextY = clamp(nextY, margin, safeHeight - margin);
    // Safety net only: if the cell still reaches the clamp (e.g. spawned in a
    // corner), KICK OFF the smooth avoiding reaction toward the inward normal
    // instead of a hard instantaneous heading flip (the flip read as the axis
    // "snapping"/skipping rather than turning). The eased turn above then carries
    // it inward over AVOID_SECONDS. Gated on a real clamp — open water never
    // clamps, so the dt-partition pure-forward path is unaffected.
    if ((nextX !== rawX || nextY !== rawY) && avoidProgress >= 1 && contactTimer <= 0) {
      avoidIndex += 1;
      const magU = noise2D(nseed ^ 0x2f31a7d5, avoidIndex, 0.71);
      const magnitude = AVOID_TURN_MIN + (AVOID_TURN_MAX - AVOID_TURN_MIN) * magU;
      avoidFrom = heading;
      const inward = Math.atan2(wallAwayY, wallAwayX);
      avoidTo = inward + side * magnitude * 0.5;
      avoidProgress = 0;
    }

    if (wasContacting && contactTimer <= 0) {
      // Release after a short attack beat: turn away and cool down so the predator
      // does not immediately re-latch / buzz-saw through the hero.
      huntCooldown = 22.0 + seededUnit(nseed, 0, 0x4a1b7c29) * 14.0;
      avoidIndex += 1;
      avoidFrom = heading;
      avoidTo = heading + side * (Math.PI * (0.45 + 0.25 * seededUnit(nseed, avoidIndex, 0x359a71d1)));
      avoidProgress = 0;
    }

    // beat freq capped so the metachronal girdle shimmer stays < Nyquist.
    const beatEff = Math.min(6, Math.max(0, finite(cell.beatRate, 0)) * act);

    return {
      ...cell,
      x: nextX,
      y: nextY,
      // phase carries the TRAVEL heading (snout leads the PATH); the fast helix
      // lean is left OUT of the body orientation so the body axis holds near the
      // helix axis instead of wagging (critic C). base `heading` = cruise dir.
      phase: contactTimer > 0 ? heading : travel,
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
      contactTimer,
      contactDuration: contactTimer > 0 ? contactDuration : 0,
      huntCooldown,
    };
  });
}
