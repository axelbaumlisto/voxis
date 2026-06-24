import { KIND_ID, sourceId } from "../interaction";
import type { FieldContribution, FieldKind, ObstacleEllipse } from "../interaction";
import type { AquariumFrame, AquariumParamsView, EuglenaState } from "../types";
import { mix32, noise2D, seededUnit } from "../seeds";
import { TAU, clamp, clamp01, finite, finiteOr, wrapUnit } from "../util";
import { euglenaDisplayLength } from "./pose";
import {
  DIDINIUM_HAZARD_WEIGHT,
  EUGLENA_STEER,
  HERO_INTEREST_RANGE,
  HERO_LOITER_Q,
  HERO_WAKE_RANGE,
  MEDIUM,
  SEPARATION_RANGE_BODY_LENGTHS,
  STARTLE_TAU,
  STARTLE_TRIGGER_Q,
} from "./steering";

interface EuglenaModeView {
  readonly motionMul: number;
}

function euglenaModeView(mode: AquariumFrame["mode"]): EuglenaModeView {
  switch (mode) {
    case "recording":
      return { motionMul: 1.15 };
    case "transcribing":
      return { motionMul: 0.35 };
    case "error":
      return { motionMul: 0.15 };
    case "idle":
    default:
      return { motionMul: 1.00 };
  }
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
      rollRate: 0.25 + seededUnit(seed, i, salt ^ 0x14c8af21) * 0.25,
      metabolyRate: 0.10 + seededUnit(seed, i, salt ^ 0x3bc85a13) * 0.06,
      flagellumRate: 10.0 + seededUnit(seed, i, salt ^ 0x752f7c59) * 6.0, // rendered shimmer Hz; real beat ≈20-40Hz, capped later for anti-aliasing
      spiralAmplitude: 0.12 + seededUnit(seed, i, salt ^ 0x61ab0917) * 0.06,
      cvPhase: seededUnit(seed, i, salt ^ 0x3da17c45),
      cvRate: 0.035 + seededUnit(seed, i, salt ^ 0x59e2b7a3) * 0.015,
      burstPhase: seededUnit(seed, i, salt ^ 0x1f7c6b29),
      burstRate: 0.08 + seededUnit(seed, i, salt ^ 0x46b9d2e1) * 0.05,
      turnProgress: 2,
      turnFrom: heading,
      turnTo: heading,
      tumbleIndex: 0,
      tumbleFrom: heading,
      tumbleTo: heading,
      tumbleProgress: 1,
      startle: 0,
      noiseSeed: mix32(seed ^ Math.imul(i + 1, 0x9e3779b1) ^ 0x5eed) >>> 0,
    });
  }
  return euglena;
}

const TUMBLE_WINDOW = 0.08;         // burst-phase window; existing beat-switch gate
const TUMBLE_SECONDS = 1.0;         // reorientation duration (~1s, not instant)
const TUMBLE_MIN_RAD = Math.PI / 6; // 30°
const TUMBLE_MAX_RAD = (5 * Math.PI) / 6; // 150°
const TUMBLE_RATE_MIN = 0.045;      // heavy-tail clamped slow end: ~22s max cycle
const TUMBLE_RATE_MAX = 0.16;       // fast end: ~6.25s min cycle
const PHOTO_TARGET_REACHED_PX = 30; // retarget before a light run degenerates into edge waiting
const PHOTO_TARGET_MAX_SECONDS = 11; // escape local bowls instead of orbiting a waypoint

export const EUGLENA_RELEVANT_FIELDS: ReadonlySet<FieldKind> = new Set(["obstacle", "wake", "motile"]);

export function euglenaContribute(cell: EuglenaState, idx: number, scale = 1): FieldContribution[] {
  const length = euglenaDisplayLength(finite(cell.size, 1), scale);
  return [{
    kind: "motile",
    x: cell.x,
    y: cell.y,
    heading: finiteOr(cell.heading, finiteOr(cell.phase, 0)),
    radius: length * 0.18,
    speed: Math.max(0, finiteOr(cell.swimSpeed, 0)),
    role: "neutral",
    strength: 0.35,
    sourceId: sourceId("euglena", idx),
  }];
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
  const act = modeView.motionMul * (1 + 0.7 * activityMix);
  const scale = view.euglena.scale;
  const steer = view.euglena.steer ? { ...EUGLENA_STEER, ...view.euglena.steer } : EUGLENA_STEER;
  const medium = view.medium ? { ...MEDIUM, ...view.medium } : MEDIUM;
  const drag = Math.max(0.1, finite(medium.viscosity, 1)); // fluid resistance (water = 1)

  return euglena.map((cell, idx) => {
    const selfId = sourceId("euglena", idx);
    const L = euglenaDisplayLength(finite(cell.size, 1), scale);
    let heading = finite(cell.heading, 0);

    const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    const noiseSeed = finiteOr(cell.noiseSeed, 0) | 0;
    const px0 = finite(cell.x, 0);
    const py0 = finite(cell.y, 0);
    let ux = Math.cos(heading);
    let uy = Math.sin(heading);
    const vPx = Math.max(0, finite(cell.swimSpeed, 0)) * vBL * L;
    // Keep the rendered swimmer in open water, not just its centroid. The body
    // extends ~0.5L forward and the flagellum another ~0.95L, so a centroid-safe
    // clamp still lets a wall-facing cell look pinned into the edge.
    const wallInset = Math.min(L * 1.48 + 8, safeWidth * 0.36, safeHeight * 0.36);

    const field = frame.interaction;
    const fieldObstacles = field ? field.obstacles.filter((obstacle) => obstacle.sourceId !== selfId) : undefined;
    const fieldWakes = field ? field.wakes.filter((wake) => wake.sourceId !== selfId) : undefined;
    const sameSpeciesMotiles = field?.motiles.filter((motile) => (
      (motile.sourceId >> 20) === KIND_ID.euglena && motile.sourceId !== selfId
    ));
    const didiniumHazards = field?.motiles.filter((motile) => (motile.sourceId >> 20) === KIND_ID.didinium);
    const circleObstacles = fieldObstacles?.filter((obstacle) => obstacle.shape === "circle");
    const socialEllipse = fieldObstacles?.find((obstacle): obstacle is ObstacleEllipse => obstacle.shape === "ellipse" && obstacle.social === true);
    const socialWake = socialEllipse
      ? fieldWakes?.find((wake) => wake.sourceId === socialEllipse.sourceId)
      : undefined;

    // hero ellipse params (shared by the behavioural steer AND the hard push).
    // Body-frame ELLIPTICAL exclusion hugging the elongated paramecium (~3:1),
    // grown by the euglena's own half-length so the two outlines never overlap.
    let heroParams: { hx: number; hy: number; A: number; B: number; cphi: number; sphi: number; heading: number } | null = null;
    let heroQd = Infinity;
    if (socialEllipse) {
      const hx = finite(socialEllipse.x, safeWidth / 2);
      const hy = finite(socialEllipse.y, safeHeight / 2);
      const m = 0.9 * L; // keep the whole euglena body (and most of its flagellum reach) off the hero
      const A = Math.max(1e-3, finiteOr(socialEllipse.halfLen, 0) + m);
      const B = Math.max(1e-3, finiteOr(socialEllipse.halfWid, 0) + m);
      const hh = finiteOr(socialEllipse.heading, 0);
      heroParams = { hx, hy, A, B, cphi: Math.cos(hh), sphi: Math.sin(hh), heading: hh };
      const dx = px0 - hx, dy = py0 - hy;
      const px = dx * heroParams.cphi + dy * heroParams.sphi;
      const py = -dx * heroParams.sphi + dy * heroParams.cphi;
      heroQd = (px * px) / (A * A) + (py * py) / (B * B);
    } else if (!field && frame.hero) {
      const hx = finite(frame.hero.x, safeWidth / 2);
      const hy = finite(frame.hero.y, safeHeight / 2);
      const hr = Math.max(0, finite(frame.hero.radius, 0));
      const m = 0.9 * L; // keep the whole euglena body (and most of its flagellum reach) off the hero
      const A = Math.max(1e-3, finiteOr(frame.hero.halfLen, hr) + m);
      const B = Math.max(1e-3, finiteOr(frame.hero.halfWid, hr) + m);
      const hh = finiteOr(frame.hero.heading, 0);
      heroParams = { hx, hy, A, B, cphi: Math.cos(hh), sphi: Math.sin(hh), heading: hh };
      const dx = px0 - hx, dy = py0 - hy;
      const px = dx * heroParams.cphi + dy * heroParams.sphi;
      const py = -dx * heroParams.sphi + dy * heroParams.cphi;
      heroQd = (px * px) / (A * A) + (py * py) / (B * B);
    }
    const heroQ = Math.sqrt(Math.max(0, heroQd)); // normalized elliptical distance (1 = boundary)

    // away-from-hero unit vector + interest level (slow hunger<->satiety cycle)
    let ax = 0, ay = 0;
    if (heroParams) {
      const dxh = px0 - heroParams.hx, dyh = py0 - heroParams.hy;
      const dh = Math.hypot(dxh, dyh) || 1e-6;
      ax = dxh / dh;
      ay = dyh / dh;
    }
    // slow ambient modulation of loiter strength (light/O2 context proxy, not appetite)
    const interest = 0.55 + 0.45 * Math.sin(TAU * wrapUnit(finiteOr(cell.burstPhase, 0)) + 1.3);

    // startle: brief escape state, triggered by very close contact or an app
    // startle pulse, decaying exponentially (frame-rate exact).
    let startle = clamp01(finiteOr(cell.startle, 0));
    if (heroParams && heroQ > 1e-4 && heroQ < STARTLE_TRIGGER_Q) startle = 1;
    if (finite(frame.startle, 0) > 0.5) startle = 1;

    let priorityPressure = 0;
    const photoIntent = Math.max(0, finite(view.euglena.photoIntent, 0));
    let photoTargetIndex = Math.max(0, Math.floor(finiteOr(cell.photoTargetIndex, 0)));
    let photoTargetAge = Math.max(0, finiteOr(cell.photoTargetAge, 0)) + dt;
    let photoTargetX = Number.NaN;
    let photoTargetY = Number.NaN;
    // === priority-weighted steering (tunable interaction arbitration) ===
    // Every behaviour adds a world-space direction vector scaled by its weight.
    // `forward` carries the current heading (short-way turns, minimal reverse);
    // walls win over the hero; the hero term blends a constant bias with an
    // approach-then-retreat spring (curiosity) and a startle escape.
    {
      let sx = ux * steer.forward;
      let sy = uy * steer.forward;
      const look = L * 2.8; // anticipate before the body/flagellum touches a wall
      const leftGap = px0 - wallInset;
      const rightGap = safeWidth - wallInset - px0;
      const topGap = py0 - wallInset;
      const bottomGap = safeHeight - wallInset - py0;
      if (leftGap < look) sx += (1 - leftGap / look) * steer.wall;
      if (rightGap < look) sx -= (1 - rightGap / look) * steer.wall;
      if (topGap < look) sy += (1 - topGap / look) * steer.wall;
      if (bottomGap < look) sy -= (1 - bottomGap / look) * steer.wall;
      // Negative gravitaxis: ACTIVE sensory up-bias, NOT buoyancy/density.
      // Short-tank fade prevents pinning: when the wall lookahead spans most of
      // the tank height, top-wall avoidance must dominate and the up-bias fades
      // out (0 at height<=3L, 1 at height>=5L). Default weight is 0, so the
      // partition-exact open-water path stays unchanged.
      const gravFade = clamp01((safeHeight / Math.max(1e-6, L) - 3) / 2);
      sy -= steer.gravitaxis * gravFade;
      // Phototaxis: app-level METAPHOR only — audio/activity is mapped to a
      // fixed virtual light on the wide edge. The visible eyespot remains a
      // passive shade accent; the real PAB sensor is not rendered. Positive
      // response at low/moderate light flips to photophobic avoidance above I_SAT.
      if (steer.phototaxis !== 0 && safeWidth > 0 && safeHeight > 0) {
        const lightX = safeWidth;
        const lightY = safeHeight / 2;
        const ldx = lightX - px0;
        const ldy = lightY - py0;
        const ldist = Math.hypot(ldx, ldy) || 1e-6;
        const intensity = clamp01(finite(frame.activity, 0) + 0.5 * finite(frame.audioLevel, 0));
        const I_SAT = 0.7;
        const response = intensity * (1 - intensity / I_SAT);
        const photoW = steer.phototaxis * response;
        sx += (ldx / ldist) * photoW;
        sy += (ldy / ldist) * photoW;
      }
      // Optional deterministic photo-response episode for crowded scenes: the
      // swimmer has a readable light transit, then adapts and turns away. It is
      // scoped by a flat theme param (default 0), so existing Euglena themes keep
      // the old steering unless they explicitly opt in.
      if (photoIntent > 0 && safeWidth > 0 && safeHeight > 0) {
        const route = [
          [0.20, 0.25], [0.84, 0.30], [0.78, 0.66],
          [0.28, 0.72], [0.36, 0.38], [0.70, 0.22],
        ][photoTargetIndex % 6];
        photoTargetX = wallInset + (safeWidth - 2 * wallInset) * route[0];
        photoTargetY = wallInset + (safeHeight - 2 * wallInset) * route[1];
        const dx = photoTargetX - px0;
        const dy = photoTargetY - py0;
        const dist = Math.hypot(dx, dy) || 1e-6;
        const tx = dx / dist;
        const ty = dy / dist;
        const bearing = Math.atan2(ty, tx);
        const eyeGate = 0.76 + 0.24 * Math.max(0, Math.cos(bearing - heading - TAU * finite(cell.rollPhase, 0)));
        const approachFade = 0.62 + 0.38 * clamp01(dist / 90);
        const seekW = photoIntent * approachFade * eyeGate;
        sx += tx * seekW;
        sy += ty * seekW;
      }
      if (heroParams && heroQ < HERO_INTEREST_RANGE && heroQ > 1e-4) {
        const falloff = Math.min(1, (HERO_INTEREST_RANGE - heroQ) / (HERO_INTEREST_RANGE - 1));
        // radial weight: >0 repels (too close), <0 attracts (too far). The `loiter`
        // term is near-field attraction vs avoidance — it cancels at HERO_LOITER_Q,
        // an EMERGENT standoff, not a hard-coded goal. `hero` adds an avoid/pursue bias.
        const wr = (steer.hero + steer.loiter * interest * (HERO_LOITER_Q - heroQ)) * falloff;
        sx += ax * wr;
        sy += ay * wr;
        sx += ax * steer.startleAway * startle; // escape burst pushes straight away
        sy += ay * steer.startleAway * startle;
      }
      // Intra-species separation: species-matched euglena motiles only. The
      // weight multiplies the contribution before accumulation, so default 0 is
      // an exact no-op even though motiles are present in the field.
      const separationW = steer.separation;
      if (sameSpeciesMotiles && sameSpeciesMotiles.length > 0) {
        const reach = L * SEPARATION_RANGE_BODY_LENGTHS;
        for (let mi = 0; mi < sameSpeciesMotiles.length; mi++) {
          const mdx = px0 - finite(sameSpeciesMotiles[mi].x, 0);
          const mdy = py0 - finite(sameSpeciesMotiles[mi].y, 0);
          const md = Math.hypot(mdx, mdy) || 1e-6;
          if (md < reach) {
            const prox = (reach - md) / reach;
            const w = separationW * prox;
            sx += (mdx / md) * w;
            sy += (mdy / md) * w;
          }
        }
      }
      // Didinium is a predator-class ciliate in the same drop, but Euglena is not
      // its prey in this theme. Treat nearby Didinium motiles as neutral moving
      // hazards: soft low-priority avoidance only, no hard bounce and no panic.
      if (didiniumHazards && didiniumHazards.length > 0) {
        for (let hi = 0; hi < didiniumHazards.length; hi++) {
          const hazard = didiniumHazards[hi];
          const hdx = px0 - finite(hazard.x, 0);
          const hdy = py0 - finite(hazard.y, 0);
          const hd = Math.hypot(hdx, hdy) || 1e-6;
          const hazardRadius = Math.max(0, finiteOr(hazard.radius, L * 0.35));
          const reach = Math.max(L * 1.2, L * 0.75 + hazardRadius * 1.25 + 8);
          if (hd < reach) {
            const prox = (reach - hd) / reach;
            const w = DIDINIUM_HAZARD_WEIGHT * prox;
            sx += (hdx / hd) * w;
            sy += (hdy / hd) * w;
          }
        }
      }

      // static obstacles (e.g. a sessile vorticella): steer AROUND them, well
      // before contact, scaled by proximity. (Hard non-overlap push below.)
      const obstacles = circleObstacles;
      if (obstacles && obstacles.length > 0) {
        for (let oi = 0; oi < obstacles.length; oi++) {
          const ox = finite(obstacles[oi].x, 0);
          const oy = finite(obstacles[oi].y, 0);
          const orad = Math.max(1, finite(obstacles[oi].radius, 1));
          const odx = px0 - ox, ody = py0 - oy;
          const od = Math.hypot(odx, ody) || 1e-6;
          const reach = orad + L * 1.8;
          if (od < reach) {
            const prox = (reach - od) / reach;
            sx += (odx / od) * steer.obstacle * prox;
            sy += (ody / od) * steer.obstacle * prox;
          }
        }
      }
      const pressure = Math.hypot(sx - ux * steer.forward, sy - uy * steer.forward);
      priorityPressure = pressure;
      if (pressure > 1e-6) {
        const desired = Math.atan2(sy, sx);
        // gentle viscous (low-Reynolds) reorientation: exact exponential approach,
        // frame-rate independent. The medium viscosity damps the turn rate so the
        // cell banks slowly through the fluid (angular velocity ~ 1/viscosity).
        const turnK = (1.0 + 2.5 * Math.min(1, pressure)) / drag; // rad/s relaxation rate
        heading += wrapPi(desired - heading) * (1 - Math.exp(-turnK * dt));
        ux = Math.cos(heading);
        uy = Math.sin(heading);
      }
    }

    const vPxEff = vPx * (1 + steer.startleDart * startle) / Math.max(0.1, finite(medium.translationDrag, 1)); // inert translation drag default
    let nextX = px0 + ux * vPxEff * dt;
    let nextY = py0 + uy * vPxEff * dt;

    // hydrodynamic drafting: when the euglena sits in the hero's wake, the
    // hero's swimming current advects it along the hero heading (the two drift
    // together). Advection (px/s) decays with distance and with how directly
    // the euglena trails behind the hero's motion.
    if (heroParams && (!field || socialWake) && heroQ < HERO_WAKE_RANGE && heroQ > 1e-4) {
      const hd = finiteOr(socialWake?.heading, heroParams.heading);
      const hdx = Math.cos(hd), hdy = Math.sin(hd);
      const behind = Math.max(0, -(ax * hdx + ay * hdy)); // 1 when directly behind the hero
      const prox = Math.min(1, (HERO_WAKE_RANGE - heroQ) / (HERO_WAKE_RANGE - 1));
      const wakeSpeed = (steer.wake * prox * behind) / drag; // entrainment slows in thicker medium
      nextX += hdx * wakeSpeed * dt;
      nextY += hdy * wakeSpeed * dt;
    }

    // hard non-overlap push (safety net, independent of the soft steer above):
    // soft exponential push = exact discrete solution of ṗ=-k·p, so it is
    // frame-rate-exact and never glues/orbits/jitters at the rim.
    if (heroParams) {
      const { hx, hy, A, B, cphi, sphi } = heroParams;
      const dx = nextX - hx, dy = nextY - hy;
      const px = dx * cphi + dy * sphi;   // into hero body frame
      const py = -dx * sphi + dy * cphi;
      const qd = (px * px) / (A * A) + (py * py) / (B * B);
      if (qd < 1 && qd > 1e-9) {
        const f = 1 / Math.sqrt(qd);       // scale-to-boundary (>1 when inside)
        const tx = px * f, ty = py * f;    // target on ellipse boundary (body frame)
        const mvx = (tx - px) * cphi - (ty - py) * sphi; // back to world
        const mvy = (tx - px) * sphi + (ty - py) * cphi;
        const need = Math.hypot(mvx, mvy);
        if (need > 1e-6) {
          const step = need * (1 - Math.exp(-6 * dt));
          nextX += (mvx / need) * step;
          nextY += (mvy / need) * step;
        }
      }
    }

    // hard non-overlap push out of any static obstacle circle (sessile vorticella)
    const obstacles2 = circleObstacles;
    if (obstacles2 && obstacles2.length > 0) {
      for (let oi = 0; oi < obstacles2.length; oi++) {
        const ox = finite(obstacles2[oi].x, 0);
        const oy = finite(obstacles2[oi].y, 0);
        const minD = Math.max(1, finite(obstacles2[oi].radius, 1)) + 0.4 * L;
        const odx = nextX - ox, ody = nextY - oy;
        const od = Math.hypot(odx, ody);
        if (od < minD && od > 1e-6) {
          const push = (minD - od) * (1 - Math.exp(-6 * dt));
          nextX += (odx / od) * push;
          nextY += (ody / od) * push;
        }
      }
    }

    const rollDelta = Math.max(0, finite(cell.rollRate, 0)) * act * dt;

    // Discrete beat-switch tumble (run-and-tumble), NOT Brownian diffusion.
    // The existing burstPhase gate still triggers the event, but each cycle uses
    // a deterministic heavy-tailed interval and a polygonal 30-150° target turn.
    // Hand-built tests with burstRate=0/undefined keep this path inert.
    const bphase = wrapUnit(finiteOr(cell.burstPhase, 0));
    const burstBase = Math.max(0, finiteOr(cell.burstRate, 0));
    let tumbleIndex = Math.max(0, Math.floor(finiteOr(cell.tumbleIndex, 0)));
    let tumbleFrom = finiteOr(cell.tumbleFrom, heading);
    let tumbleTo = finiteOr(cell.tumbleTo, heading);
    let tumbleProgress = clamp01(finiteOr(cell.tumbleProgress, 1));
    const runU = Math.max(0.02, noise2D(noiseSeed ^ 0x6c8e9cf5, tumbleIndex + 0.17, 0.31));
    const intervalScale = clamp(Math.pow(runU, -0.85), 0.6, 3.6); // Levy-ish long runs from small u
    const effectiveBurstRate = burstBase > 0
      ? clamp(burstBase / intervalScale, TUMBLE_RATE_MIN, TUMBLE_RATE_MAX)
      : 0;
    const newBurstPhase = wrapUnit(bphase + effectiveBurstRate * act * dt);
    const firedTumble = effectiveBurstRate > 0 && newBurstPhase < bphase;
    if (firedTumble) {
      tumbleIndex += 1;
      const sign = noise2D(noiseSeed ^ 0x7a3f4d21, tumbleIndex, 0.23) < 0.5 ? -1 : 1;
      const magU = noise2D(noiseSeed ^ 0x2f31a7d5, tumbleIndex, 0.71);
      const magnitude = TUMBLE_MIN_RAD + (TUMBLE_MAX_RAD - TUMBLE_MIN_RAD) * magU;
      tumbleFrom = heading;
      tumbleTo = heading + sign * magnitude;
      tumbleProgress = 0;
    }
    const flick = (effectiveBurstRate > 0 && (bphase < TUMBLE_WINDOW || tumbleProgress < 1))
      ? Math.sin(Math.min(1, tumbleProgress) * Math.PI)
      : 0;
    const beatBoost = 1 + 1.3 * Math.max(0, flick);
    if (tumbleProgress < 1) {
      const nextProgress = Math.min(1, tumbleProgress + dt / TUMBLE_SECONDS);
      // Keep priority steering intact: the tumble is a low-priority reorientation
      // and is skipped while strong wall/hero/startle pressure is active.
      if (priorityPressure < 0.9) {
        const turnK = 5.0 / drag; // ~1s smooth beat-switch reorientation
        heading += wrapPi(tumbleTo - heading) * (1 - Math.exp(-turnK * dt));
        if (nextProgress >= 1) heading = tumbleTo;
      }
      tumbleProgress = nextProgress;
    }
    const rotDiffusion = Math.max(0, finite(medium.rotDiffusion, 0));
    if (rotDiffusion > 0 && dt > 0) {
      // Optional cosmetic active-noise, NOT thermal Brownian diffusion. Default 0
      // so exact partition tests stay unchanged.
      const jitter = (noise2D(noiseSeed ^ 0x51f15e, px0 * 0.037, finite(frame.t, 0) * 0.73) * 2 - 1)
        * rotDiffusion * Math.sqrt(dt);
      heading += jitter;
    }
    // cap effective beat freq so the 2nd lasso harmonic stays near 60fps Nyquist;
    // this reads as high-frequency shimmer instead of a slow tadpole-tail whip.
    const fEff = Math.min(18, Math.max(0, finite(cell.flagellumRate, 0)) * act * beatBoost);
    const minX = wallInset;
    const maxX = Math.max(wallInset, safeWidth - wallInset);
    const minY = wallInset;
    const maxY = Math.max(wallInset, safeHeight - wallInset);
    const clampedX = clamp(nextX, minX, maxX); // clamp, never wrap (wrapping teleported it across the tank)
    const clampedY = clamp(nextY, minY, maxY);
    let finalHeading = heading;
    if (clampedX <= minX + 1e-6 && Math.cos(finalHeading) < 0) finalHeading = Math.atan2(Math.sin(finalHeading), 0.35);
    if (clampedX >= maxX - 1e-6 && Math.cos(finalHeading) > 0) finalHeading = Math.atan2(Math.sin(finalHeading), -0.35);
    if (clampedY <= minY + 1e-6 && Math.sin(finalHeading) < 0) finalHeading = Math.atan2(0.35, Math.cos(finalHeading));
    if (clampedY >= maxY - 1e-6 && Math.sin(finalHeading) > 0) finalHeading = Math.atan2(-0.35, Math.cos(finalHeading));
    if (photoIntent > 0) {
      const reached = Number.isFinite(photoTargetX) && Number.isFinite(photoTargetY)
        && Math.hypot(clampedX - photoTargetX, clampedY - photoTargetY) < PHOTO_TARGET_REACHED_PX;
      const edgeBlocked = clampedX <= minX + 2 || clampedX >= maxX - 2;
      if (reached || edgeBlocked || photoTargetAge > PHOTO_TARGET_MAX_SECONDS) {
        photoTargetIndex += 1;
        photoTargetAge = 0;
      }
    }
    return {
      ...cell,
      x: clampedX,
      y: clampedY,
      phase: finalHeading,
      heading: finalHeading,
      turnProgress: finiteOr(cell.turnProgress, 2),
      turnFrom: finiteOr(cell.turnFrom, heading),
      turnTo: finiteOr(cell.turnTo, heading),
      tumbleIndex,
      tumbleFrom,
      tumbleTo,
      tumbleProgress,
      startle: startle * Math.exp(-dt / STARTLE_TAU),
      ...(photoIntent > 0 ? { photoTargetIndex, photoTargetAge } : {}),
      rollPhase: wrapUnit(finite(cell.rollPhase, 0) + rollDelta),
      metabolyPhase: wrapUnit(finite(cell.metabolyPhase, 0) + Math.max(0, finite(cell.metabolyRate, 0)) * act * dt),
      flagellumPhase: wrapUnit(finite(cell.flagellumPhase, 0) + fEff * dt),
      cvPhase: wrapUnit(finiteOr(cell.cvPhase, 0) + Math.max(0, finiteOr(cell.cvRate, 0)) * act * dt),
      burstPhase: newBurstPhase,
    };
  });
}
