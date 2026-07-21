import { noise2D } from "../shared";
import { cellReach } from "./sizing";
import type { CellParams } from "./types";

/**
 * G2 — propulsion speed law. Low-Reynolds swimming is Stokes-linear: the swim
 * speed is proportional to the ciliary beat, which we drive by activity `a`
 * (U_norm = a). There is NO inertia — silence (a→0) means the cell stops in the
 * SAME frame (memoryless; no coasting). Returns px/sec. (plan G2; low-Re:
 * hydrodynamic coupling design notes now summarized in docs/CELL_MATH.md.)
 */
export function swimSpeed(
  activity: number,
  width: number,
  height: number,
  params: CellParams,
): number {
  const a = activity < 0 ? 0 : activity > 1 ? 1 : activity;
  const frac = params.swimSpeedMaxFrac ?? 0.06;
  return a * frac * Math.min(width, height);
}

/**
 * Smoothed drift-activation ramp.
 *
 * Moves `prev` toward a target of 1 (when `recording` is true) or 0
 * (when idle/transcribing/error) by a per-frame `rate`, then clamps to
 * [0, 1]. This gives a visually smooth transition between centered rest
 * and full-drift recording, without instant jumps.
 *
 * At the default rate of 0.02 and 60 fps, it takes about 3 seconds to
 * reach 90% of the target.  rate=1 jumps instantly; rate=0 never moves.
 */
export function driftActivation(
  prev: number,
  recording: boolean,
  rate: number,
  dt?: number,
): number {
  const target = recording ? 1 : 0;
  // F8: frame-rate independence. `rate` is the historical per-frame (1/60 s) lerp
  // factor. Generalize to any dt by compounding it: alpha = 1 - (1-rate)^(dt*60),
  // which equals `rate` exactly at dt=1/60 (back-compat) and keeps the time
  // constant fixed regardless of frame rate. When dt is omitted, fall back to
  // the legacy per-frame factor.
  const r = rate < 0 ? 0 : rate > 1 ? 1 : rate;
  const alpha = dt === undefined ? r : 1 - Math.pow(1 - r, dt * 60);
  const raw = prev + (target - prev) * alpha;
  if (raw > 1) return 1;
  if (raw < 0) return 0;
  return raw;
}

// ---------------------------------------------------------------------------
// Cell drift (slow travel within aquarium bounds)
// ---------------------------------------------------------------------------

export function cellDrift(
  t: number,
  width: number,
  height: number,
  baseR: number,
  params: CellParams,
): { cx: number; cy: number } {
  // Contain the WHOLE organism (membrane + cilia + startle), not just the
  // base circle.  `inset` is the min distance from wall that the centre must
  // respect so that no part of the living cell clips the aquarium edge.
  const reach = cellReach(baseR, params);
  const inset = Math.max(params.driftMargin ?? 4, reach);
  const speed = params.driftSpeed ?? 0.03;

  const travelRangeX = width - 2 * inset;
  const travelRangeY = height - 2 * inset;

  const phaseX = t * speed + 1000;
  const phaseY = t * speed + 2000;

  const noiseX = noise2D(phaseX, 0);
  const noiseY = noise2D(phaseY, 0);

  // Map [-1, 1] → [lo, hi]; clamp degenerate axis to center
  const mapTo = (noise: number, lo: number, hi: number) =>
    lo + (noise * 0.5 + 0.5) * (hi - lo);

  const cx = travelRangeX > 0
    ? mapTo(noiseX, inset, width - inset)
    : width / 2;
  const cy = travelRangeY > 0
    ? mapTo(noiseY, inset, height - inset)
    : height / 2;

  return { cx, cy };
}

// ---------------------------------------------------------------------------
// Wander — Reynolds steering-style integrated wander (the natural, non-
// returning motion). Unlike `cellDrift` (position = noise(t), which merely
// oscillates the centre about the middle and so always "comes back"), this
// INTEGRATES position along a slowly turning heading:
//
//   heading += smallRandomDisplacement      (random walk — Reynolds wander)
//   velocity  = dir(heading) * speed
//   position += velocity * dt
//   on wall contact: reflect heading (bounce) and clamp inside
//
// Result: the cell roams the tank organically and does not gravitate to the
// centre. The random displacement is small per frame, so turns are smooth
// (no twitching). Deterministic given the input state (the "randomness" is
// value-noise sampled on the heading itself, so no RNG/Date needed).
// ---------------------------------------------------------------------------

export interface WanderState {
  x: number;
  y: number;
  heading: number; // radians
  vx: number;
  vy: number;
  /** Monotonic wander clock (seconds). F6: the heading jitter is sampled on
   * this clock, NOT on position (x+y). Sampling on (x+y) made the random walk
   * couple to where the cell happens to be, which produced stalls and limit
   * cycles (the noise argument stops advancing when the cell slows or circles).
   * A dedicated clock keeps the heading a genuine, position-independent walk. */
  clock?: number;
}

/**
 * F7 (OPT) — wall-avoidance reorientation. Instead of a specular reflection
 * (which keeps the cell skimming the wall), a startled microswimmer backs up and
 * turns around: reorient to roughly the REVERSE of the incoming heading plus a
 * deterministic noise jitter, so it heads back into the tank and successive
 * contacts differ. Pure. Returns the new heading (radians).
 */
export function wallReorientHeading(incoming: number, t: number, params: CellParams): number {
  const jitter = (params.wallReorientJitter ?? 0.6) * noise2D(517.3, t * 1.9);
  return incoming + Math.PI + jitter;
}

/**
 * H2 (OPT) — rotational Brownian motion. A microswimmer's heading diffuses with
 * RMS angular step `sqrt(2*D_r*dt)` per frame. We synthesise a deterministic,
 * approximately-gaussian, zero-mean unit sample from value-noise (sum of a few
 * decorrelated noise taps → central-limit) and scale it. Returns the heading
 * delta (radians) for this frame; 0 when D_r=0. Pure.
 */
export function rotationalBrownianStep(t: number, dt: number, params: CellParams): number {
  const Dr = params.rotationalDiffusion ?? 0;
  if (Dr <= 0) return 0;
  // Approx N(0,1): a sum of 3 decorrelated value-noise taps. NOTE: noise2D is
  // SMOOTHED value-noise, not uniform, so a tap's variance is ~0.21 (not 1/3);
  // the empirical std of this 3-tap SUM is ~0.795 (measured over 4e5 samples).
  // Divide by that std (NOT sqrt(3)) so `g` truly has ~unit variance and the
  // realized RMS angular step matches the labelled sqrt(2*Dr*dt) — keeping the
  // rotationalDiffusion knob physically honest. Zero-mean, deterministic in t.
  const TAP_SUM_STD = 0.795;
  const g = (noise2D(211.7, t * 7.3) + noise2D(389.1, t * 11.9 + 5.5) + noise2D(53.9, t * 17.1 + 1.3)) / TAP_SUM_STD;
  return g * Math.sqrt(2 * Dr * Math.max(0, dt));
}

/**
 * H3 (OPT) — sedimentation. A dense cell settles slowly under gravity. Returns a
 * small DOWNWARD (+y in canvas) velocity bias as a fraction (<0.15) of the swim
 * speed; 0 by default. Pure.
 */
export function sedimentationBias(speed: number, params: CellParams): { dvx: number; dvy: number } {
  const frac = Math.max(0, Math.min(0.15, params.sedimentationFrac ?? 0));
  return { dvx: 0, dvy: frac * speed };
}

export function wanderStep(
  s: WanderState,
  dt: number,
  width: number,
  height: number,
  baseR: number,
  params: CellParams,
  speedOverride?: number,
): WanderState {
  const reach = cellReach(baseR, params);
  const inset = Math.max(params.driftMargin ?? 4, reach);
  const minX = inset, maxX = width - inset;
  const minY = inset, maxY = height - inset;

  // Degenerate tank (organism doesn't fit): pin to centre.
  if (maxX <= minX || maxY <= minY) {
    return { x: width / 2, y: height / 2, heading: s.heading, vx: 0, vy: 0, clock: (s.clock ?? 0) + dt };
  }

  // Speed in px/sec. G2: when an activity-driven swim speed is supplied it
  // REPLACES the free driftSpeed, so a louder voice (higher beat) swims faster
  // and silence stops the cell in the SAME frame (memoryless, no coasting — the
  // velocity is set from the current heading×speed every step; F5: there is no
  // `v += a*dt` momentum accumulation). The legacy driftSpeed remains the
  // fallback when no override is given (enableActivity off).
  const speed =
    speedOverride !== undefined
      ? speedOverride
      : (params.driftSpeed ?? 0.03) * Math.min(width, height) * 1.2;

  // --- Reynolds wander: small random displacement of the heading. ---
  // Use value-noise sampled along the *current heading + a wander clock*
  // so the turn is smooth and deterministic but never periodic in (x,y).
  // turnRate scales the per-second angular wander (radians/sec).
  const turnRate = params.wanderTurnRate ?? 1.1;
  // F6: advance a dedicated wander clock and sample the heading jitter on it,
  // decoupled from position. noise2D in [-1,1]; the two args are the heading
  // (so the walk still varies smoothly with current direction) and the clock
  // scaled by wanderFreq (so the walk keeps evolving regardless of where the
  // cell is or how fast it moves).
  const wanderFreq = params.wanderFreq ?? 0.6;
  const clock = (s.clock ?? 0) + dt;
  const jitter = noise2D(s.heading * 0.5 + 13.0, clock * wanderFreq);
  let heading = s.heading + jitter * turnRate * dt;
  // H2 (opt, default off): add rotational Brownian diffusion to the heading.
  if (params.enableRotationalBrownian) {
    heading += rotationalBrownianStep(clock, dt, params);
  }

  // Integrate position.
  let vx = Math.cos(heading) * speed;
  let vy = Math.sin(heading) * speed;
  let x = s.x + vx * dt;
  let y = s.y + vy * dt;

  // --- Wall handling. Default: specular reflection off the wall normal. F7
  // (opt, default off): back-up + reorient (~pi turn) instead, an avoidance
  // reaction so the cell doesn't skim the wall. ---
  const hitWall = x < minX || x > maxX || y < minY || y > maxY;
  if (params.enableWallReorient && hitWall) {
    x = Math.max(minX, Math.min(maxX, x));
    y = Math.max(minY, Math.min(maxY, y));
    heading = wallReorientHeading(heading, clock, params);
  } else {
    if (x < minX) {
      x = minX;
      heading = Math.PI - heading; // reflect about vertical wall
    } else if (x > maxX) {
      x = maxX;
      heading = Math.PI - heading;
    }
    if (y < minY) {
      y = minY;
      heading = -heading; // reflect about horizontal wall
    } else if (y > maxY) {
      y = maxY;
      heading = -heading;
    }
  }
  // Recompute velocity after any reflection so callers see the true heading.
  vx = Math.cos(heading) * speed;
  vy = Math.sin(heading) * speed;
  // H3 (opt, default off): small downward sedimentation bias on the velocity.
  if (params.enableSedimentation) {
    const sed = sedimentationBias(speed, params);
    vx += sed.dvx;
    vy += sed.dvy;
    x = Math.max(minX, Math.min(maxX, x + sed.dvx * dt));
    y = Math.max(minY, Math.min(maxY, y + sed.dvy * dt));
  }

  // Normalize heading to [-PI, PI] to keep noise sampling well-conditioned.
  heading = Math.atan2(Math.sin(heading), Math.cos(heading));

  return { x, y, heading, vx, vy, clock };
}
