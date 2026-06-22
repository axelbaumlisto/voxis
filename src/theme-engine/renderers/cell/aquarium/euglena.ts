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
  readonly eyespotFront: number;
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
  readonly reservoir: { readonly x: number; readonly y: number; readonly r: number } | null;
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
  // switch the exponent where the profile is symmetric (us=0) so the seam stays
  // C0/C1 continuous after the belly skew; blunt anterior, pointed posterior.
  const p = us >= 0 ? 0.40 : 0.90;
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
    const env = 0.18 + 0.82 * Math.pow(q, 1.5); // stiffer base, whip-crack tip (torsion wave)
    const ph = TAU * flagellum - waves * TAU * q;
    // non-planar "spinning lasso": a 2nd harmonic + a near-equal along-axis curl
    // (90° quadrature) so the tip traces a ROUND loop in projection, not a flat sine.
    const lateral = clamp(
      ampTip * env * (Math.sin(ph) + 0.28 * Math.sin(2 * ph + Math.PI / 2)),
      -maxLat,
      maxLat,
    );
    const curl = ampTip * env * 0.55 * Math.cos(ph);
    const along = halfLength + flagellumLength * q + curl;
    flagellumPoints.push(transform(cx, cy, ux, uy, along, lateral));
  }
  const flagellumEnd = flagellumPoints[flagellumPoints.length - 1];

  // --- stigma / eyespot: lateral, beside the reservoir (NOT at the tip) ---
  // eyespot: fraction of the LOCAL half-width (always inside), roll-projected so
  // it circles to the far face; eyespotFront lets the draw layer dim it there.
  const eyeSUnit = 0.7;
  const eyespot = transform(cx, cy, ux, uy, halfLength * 0.66, eyeSUnit * Math.cos(rollAng) * halfWidthAt(0.66));
  const eyespotFront = 0.5 + 0.5 * Math.cos(rollAng - eyeSUnit * 1.2);

  // --- interior organelles (deterministic, body-normalised, roll-swept, LOD) ---
  // CONTAINMENT GUARANTEE: ry is clamped to the local half-width and the lateral
  // centre to ±(halfWidth−ry), so the whole ellipse stays inside the outline at
  // EVERY roll/metaboly phase. Lateral is roll-swept by cos(rollAng) (only ever
  // shrinks toward the axis), so nothing can cross the membrane.
  const seed = options.organelleSeed;
  const chloroplasts: EuglenaOrganelle[] = [];
  const paramylon: EuglenaOrganelle[] = [];
  let nucleus: EuglenaOrganelle | null = null;
  let reservoir: { x: number; y: number; r: number } | null = null;
  let contractileVacuole: { x: number; y: number; r: number } | null = null;
  const pellicleStrips: AquariumPoint[][] = [];

  if (seed !== undefined) {
    const bodyPoint = (u: number, sFrac: number): AquariumPoint =>
      transform(cx, cy, ux, uy, halfLength * u, sFrac * halfWidthAt(u));
    const safeEllipse = (u: number, sUnit: number, baseRx: number, baseRy: number, hueShift: number, lightShift: number): EuglenaOrganelle => {
      const hw = halfWidthAt(u);
      const ry = Math.max(0.2, Math.min(baseRy, hw * 0.85));
      const latMax = Math.max(0, hw - ry);
      const lat = sUnit * latMax * Math.cos(rollAng);
      const p = transform(cx, cy, ux, uy, halfLength * u, lat);
      return {
        x: p.x, y: p.y,
        rx: Math.max(0.3, Math.min(baseRx, halfLength * 0.5)),
        ry,
        angle: heading,
        hueShift, lightShift,
        front: 0.5 + 0.5 * Math.cos(rollAng - sUnit * 1.2),
      };
    };

    const chCount = Math.max(0, Math.floor(finiteOr(options.chloroplastCount, 0)));
    for (let j = 0; j < chCount; j++) {
      const u = -0.70 + seededUnit(seed, j, 0x9a1f2b3c) * 1.20; // [-0.70, +0.50] off the taper
      const sUnit = (seededUnit(seed, j, 0x51bd0e77) - 0.5) * 2; // [-1, +1]
      chloroplasts.push(safeEllipse(
        u, sUnit, length * 0.08, length * 0.045,
        (seededUnit(seed, j, 0x2cd9a14b) - 0.5) * 8,
        (seededUnit(seed, j, 0x7e3a5d91) - 0.5) * 5,
      ));
    }

    if (options.includeNucleus) {
      // axial-elongated ellipse, vertically clamped to fit the body
      nucleus = safeEllipse(-0.22, 0, length * 0.11, length * 0.12, 0, 0);
    }

    const pmCount = Math.max(0, Math.floor(finiteOr(options.paramylonCount, 0)));
    if (pmCount >= 1) paramylon.push(safeEllipse(-0.45, 0.5, length * 0.038, length * 0.038, 0, 0)); // ring, posterior
    if (pmCount >= 2) paramylon.push(safeEllipse(-0.22, -0.5, length * 0.034, length * 0.034, 0, 0));

    if (options.includeReservoir) {
      const rr = Math.max(0.4, Math.min(length * 0.04, halfWidthAt(0.78) * 0.8));
      const p = bodyPoint(0.78, 0);
      reservoir = { x: p.x, y: p.y, r: rr };
    }
    if (options.includeCV) {
      const cvPulse = 0.5 - 0.5 * Math.cos(TAU * wrapUnit(finiteOr(options.cvPhase, 0)));
      const cvR = Math.max(0.4, Math.min(length * (0.025 + 0.05 * cvPulse), halfWidthAt(0.60) * 0.75));
      const latMax = Math.max(0, halfWidthAt(0.60) - cvR);
      const lat = -0.5 * latMax * Math.cos(rollAng);
      const p = transform(cx, cy, ux, uy, halfLength * 0.60, lat);
      contractileVacuole = { x: p.x, y: p.y, r: cvR };
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
    eyespotFront,
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
      rollRate: 0.25 + seededUnit(seed, i, salt ^ 0x14c8af21) * 0.25,
      metabolyRate: 0.10 + seededUnit(seed, i, salt ^ 0x3bc85a13) * 0.06,
      flagellumRate: 3.0 + seededUnit(seed, i, salt ^ 0x752f7c59) * 2.0, // Hz; ~8-12 beats/roll (real 15-20), under 30Hz Nyquist
      spiralAmplitude: 0.12 + seededUnit(seed, i, salt ^ 0x61ab0917) * 0.06,
      cvPhase: seededUnit(seed, i, salt ^ 0x3da17c45),
      cvRate: 0.035 + seededUnit(seed, i, salt ^ 0x59e2b7a3) * 0.015,
      burstPhase: seededUnit(seed, i, salt ^ 0x1f7c6b29),
      burstRate: 0.08 + seededUnit(seed, i, salt ^ 0x46b9d2e1) * 0.05,
      turnProgress: 2,
      turnFrom: heading,
      turnTo: heading,
      startle: 0,
    });
  }
  return euglena;
}

/**
 * Priority-weighted steering + interaction model for the euglena. Each weight
 * is the PRIORITY of a behaviour; the heading eases toward the weighted sum of
 * the behaviours' direction vectors. Tune these to manage behaviour:
 *  - forward:   momentum / minimal-reverse bias (turns the short way, rarely flips back).
 *  - wall:      avoid the impassable tank walls — highest priority.
 *  - hero:      constant bias toward the hero (>0 keep clear / AVOID, <0 PURSUE).
 *               NOTE: pursue (<0) is a generic engine knob — it is NOT biological
 *               for Euglena→Paramecium (a phototroph does not hunt a ciliate);
 *               use it only for genuine predator pairs.
 *  - loiter:    EMERGENT standoff — a weak near-field hydrodynamic attraction
 *               balanced against the contact-avoidance below, so the cell hovers
 *               at the distance where the two cancel (not a teleological target).
 *  - wake:      near-field hydrodynamic entrainment — a brief advective tug (px/s)
 *               along the hero's heading while the euglena trails in its wake.
 *  - startleAway/startleDart: escape REORIENTATION (away-turn, beat-switch tumble)
 *               + small speed bump when contact is too close.
 *
 * Behaviour recipes: AVOID = {hero:+, loiter:0}; PURSUE = {hero:negative,
 * loiter:0} (predator pairs only); LOITER/hover = {hero:0, loiter:+} (default).
 * Default = mutual non-predation (Euglena exceeds Paramecium's cytostome gape:
 * a size refuge), the euglena carrying the contact-avoidance for the display.
 */
export const EUGLENA_STEER = {
  forward: 1.0,
  wall: 2.0,
  hero: 0.0,
  loiter: 1.1,
  wake: 10,
  startleAway: 3.0,
  startleDart: 1.0,
};

// Interaction geometry/timing (q = sqrt(heroQd): normalized elliptical distance,
// q=1 on the exclusion boundary).
const HERO_LOITER_Q = 1.30;        // emergent hover distance (attraction == avoidance)
const HERO_INTEREST_RANGE = 2.2;   // beyond this q the hero is ignored
const HERO_WAKE_RANGE = 1.5;       // entrainment is NEAR-FIELD only (~one half-width)
const STARTLE_TRIGGER_Q = 1.12;    // contact this close -> startle escape
const STARTLE_TAU = 0.6;           // s; escape decay time-constant

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

  return euglena.map((cell) => {
    const L = euglenaDisplayLength(finite(cell.size, 1), scale);
    let heading = finite(cell.heading, 0);

    const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    const px0 = finite(cell.x, 0);
    const py0 = finite(cell.y, 0);
    let ux = Math.cos(heading);
    let uy = Math.sin(heading);
    const vPx = Math.max(0, finite(cell.swimSpeed, 0)) * vBL * L;

    // hero ellipse params (shared by the behavioural steer AND the hard push).
    // Body-frame ELLIPTICAL exclusion hugging the elongated paramecium (~3:1),
    // grown by the euglena's own half-length so the two outlines never overlap.
    let heroParams: { hx: number; hy: number; A: number; B: number; cphi: number; sphi: number } | null = null;
    let heroQd = Infinity;
    if (frame.hero) {
      const hx = finite(frame.hero.x, safeWidth / 2);
      const hy = finite(frame.hero.y, safeHeight / 2);
      const hr = Math.max(0, finite(frame.hero.radius, 0));
      const m = 0.9 * L; // keep the whole euglena body (and most of its flagellum reach) off the hero
      const A = Math.max(1e-3, finiteOr(frame.hero.halfLen, hr) + m);
      const B = Math.max(1e-3, finiteOr(frame.hero.halfWid, hr) + m);
      const hh = finiteOr(frame.hero.heading, 0);
      heroParams = { hx, hy, A, B, cphi: Math.cos(hh), sphi: Math.sin(hh) };
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

    // === priority-weighted steering (tunable interaction arbitration) ===
    // Every behaviour adds a world-space direction vector scaled by its weight.
    // `forward` carries the current heading (short-way turns, minimal reverse);
    // walls win over the hero; the hero term blends a constant bias with an
    // approach-then-retreat spring (curiosity) and a startle escape.
    {
      let sx = ux * EUGLENA_STEER.forward;
      let sy = uy * EUGLENA_STEER.forward;
      const look = L * 2.4; // anticipate ~2.4 body-lengths ahead of every wall
      if (px0 < look) sx += (1 - px0 / look) * EUGLENA_STEER.wall;
      if (safeWidth - px0 < look) sx -= (1 - (safeWidth - px0) / look) * EUGLENA_STEER.wall;
      if (py0 < look) sy += (1 - py0 / look) * EUGLENA_STEER.wall;
      if (safeHeight - py0 < look) sy -= (1 - (safeHeight - py0) / look) * EUGLENA_STEER.wall;
      if (heroParams && heroQ < HERO_INTEREST_RANGE && heroQ > 1e-4) {
        const falloff = Math.min(1, (HERO_INTEREST_RANGE - heroQ) / (HERO_INTEREST_RANGE - 1));
        // radial weight: >0 repels (too close), <0 attracts (too far). The `loiter`
        // term is near-field attraction vs avoidance — it cancels at HERO_LOITER_Q,
        // an EMERGENT standoff, not a hard-coded goal. `hero` adds an avoid/pursue bias.
        const wr = (EUGLENA_STEER.hero + EUGLENA_STEER.loiter * interest * (HERO_LOITER_Q - heroQ)) * falloff;
        sx += ax * wr;
        sy += ay * wr;
        sx += ax * EUGLENA_STEER.startleAway * startle; // escape burst pushes straight away
        sy += ay * EUGLENA_STEER.startleAway * startle;
      }
      const pressure = Math.hypot(sx - ux * EUGLENA_STEER.forward, sy - uy * EUGLENA_STEER.forward);
      if (pressure > 1e-6) {
        const desired = Math.atan2(sy, sx);
        heading += wrapPi(desired - heading) * Math.min(1, (2.5 + 7 * Math.min(1, pressure)) * dt);
        ux = Math.cos(heading);
        uy = Math.sin(heading);
      }
    }

    const vPxEff = vPx * (1 + EUGLENA_STEER.startleDart * startle); // dart faster while fleeing
    let nextX = px0 + ux * vPxEff * dt;
    let nextY = py0 + uy * vPxEff * dt;

    // hydrodynamic drafting: when the euglena sits in the hero's wake, the
    // hero's swimming current advects it along the hero heading (the two drift
    // together). Advection (px/s) decays with distance and with how directly
    // the euglena trails behind the hero's motion.
    if (heroParams && heroQ < HERO_WAKE_RANGE && heroQ > 1e-4) {
      const hd = finiteOr(frame.hero?.heading, 0);
      const hdx = Math.cos(hd), hdy = Math.sin(hd);
      const behind = Math.max(0, -(ax * hdx + ay * hdy)); // 1 when directly behind the hero
      const prox = Math.min(1, (HERO_WAKE_RANGE - heroQ) / (HERO_WAKE_RANGE - 1));
      const wakeSpeed = EUGLENA_STEER.wake * prox * behind;
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

    const rollDelta = Math.max(0, finite(cell.rollRate, 0)) * act * dt;
    // occasional discrete "turning beat" flick: a brief faster, stronger stroke
    // once per burst cycle (real activity = beat-pattern switching, not a ramp).
    const bphase = wrapUnit(finiteOr(cell.burstPhase, 0));
    const flick = bphase < 0.08 ? Math.sin((bphase / 0.08) * Math.PI) : 0;
    const beatBoost = 1 + 1.3 * flick;
    // the spinning/turning beat REORIENTS the cell (run-and-tumble): a brief
    // heading kick during the flick, steered toward open water (tank centre) so
    // it swims AWAY from walls instead of persistently curving off to one side.
    if (flick > 0) {
      const toCenter = Math.atan2(safeHeight / 2 - py0, safeWidth / 2 - px0);
      const turnSign = wrapPi(toCenter - heading) >= 0 ? 1 : -1;
      heading += turnSign * 0.9 * flick * dt;
    }
    // cap effective beat freq so the 2nd lasso harmonic (2f) stays < 30Hz Nyquist
    const fEff = Math.min(13, Math.max(0, finite(cell.flagellumRate, 0)) * act * beatBoost);
    return {
      ...cell,
      x: clamp(nextX, 0, safeWidth), // clamp, never wrap (wrapping teleported it across the tank)
      y: clamp(nextY, 0, safeHeight),
      phase: heading,
      heading,
      turnProgress: finiteOr(cell.turnProgress, 2),
      turnFrom: finiteOr(cell.turnFrom, heading),
      turnTo: finiteOr(cell.turnTo, heading),
      startle: startle * Math.exp(-dt / STARTLE_TAU),
      rollPhase: wrapUnit(finite(cell.rollPhase, 0) + rollDelta),
      metabolyPhase: wrapUnit(finite(cell.metabolyPhase, 0) + Math.max(0, finite(cell.metabolyRate, 0)) * act * dt),
      flagellumPhase: wrapUnit(finite(cell.flagellumPhase, 0) + fEff * dt),
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
    // Foreshorten the body through a U-turn so the long cell never rotates into
    // a clipped vertical sliver inside the short 36px strip (looks like it turns
    // toward the viewer). Full length is still used for speed/margin in update.
    const tp = finiteOr(cell.turnProgress, 2);
    const turnShrink = tp < 1 ? 0.5 + 0.5 * Math.abs(Math.cos(tp * Math.PI)) : 1;
    const fullLength = euglenaDisplayLength(finite(cell.size, 1), scale);
    const length = fullLength * turnShrink;
    // as the body foreshortens through the turn it also widens — reads as a cell
    // pivoting toward the viewer, not a thin edge-on blade.
    const turnWiden = 1 + 0.9 * (1 - turnShrink);
    const width = fullLength * 0.22 * turnWiden;
    const flagellumLength = length * 0.95; // ~1× body (real: ½–1×)
    const heading = finite(cell.heading, 0);

    // LOD ladder by display length L
    const chCount = length < 7 ? 0 : length < 14 ? 5 : length < 40 ? clamp(Math.round(length / 4), 8, 12) : clamp(Math.round(length / 4.5), 12, 20); // real 6-16 discoid chloroplasts
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

    // beat vigour ebbs and surges (deterministic) so the whip is never
    // metronomic. Real cruising beats are regular but show stochastic "active
    // fluctuations" (Ma/Friedrich PRL 2014) — approximated here by a sum of two
    // incommensurate slow components so there is no single clean period.
    const bp = wrapUnit(finiteOr(cell.burstPhase, 0));
    const hh = finite(cell.heading, 0);
    // discrete turning-beat flick (matches updateEuglena) surges the whip wider
    const flick = bp < 0.08 ? Math.sin((bp / 0.08) * Math.PI) : 0;
    const vigour = 0.80
      + 0.12 * Math.sin(TAU * bp + hh)
      + 0.08 * Math.sin(TAU * bp * 2.7 + hh * 1.7)
      + 0.30 * flick;
    const ampTip = clamp(length * 0.22, 2, 0.40 * H) * vigour;
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
      flagellumWaves: 1.5,
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

    // anterior "gullet" clearing — the reservoir/canal region is COLORLESS, not
    // green, so the cell is not uniformly green: a pale clear wash over the front.
    if (length >= 12) {
      const gx = cxr + ux * length * 0.33;
      const gy = cyr + uy * length * 0.33;
      ctx.fillStyle = `hsla(188, 16%, 84%, ${alpha * 0.20})`;
      ctx.beginPath();
      ctx.ellipse(gx, gy, length * 0.26, width * 0.40, heading, 0, TAU);
      ctx.fill();
    }

    // pellicle striae (cool sheen lines, helical)
    if (pose.pellicleStrips.length > 0) {
      ctx.strokeStyle = `hsla(${hue - 6}, 22%, 76%, ${alpha * 0.40})`;
      ctx.lineWidth = Math.max(0.35, Math.min(0.55, width * 0.06));
      for (const strip of pose.pellicleStrips) {
        drawPolyline(ctx, strip, false);
        ctx.stroke();
      }
    }

    // chloroplasts (the dense green mass; roll fades the far face)
    for (const c of pose.chloroplasts) {
      const fa = alpha * 0.74 * (0.65 + 0.35 * c.front);
      ctx.fillStyle = `hsla(${hue + c.hueShift}, 64%, ${40 + c.lightShift}%, ${fa})`;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, c.rx, c.ry, c.angle, 0, TAU);
      ctx.fill();
    }

    // nucleus (dim olive clearing with a faint rim — not a bright bubble)
    if (pose.nucleus) {
      ctx.fillStyle = `hsla(${hue - 2}, 20%, 44%, ${alpha * 0.34})`;
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
      const fa = alpha * 0.42 * (0.55 + 0.45 * p.front);
      ctx.fillStyle = `hsla(50, 12%, 74%, ${fa})`;
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
      ctx.fillStyle = `hsla(186, 18%, 78%, ${alpha * 0.30})`;
      ctx.beginPath();
      ctx.arc(pose.reservoir.x, pose.reservoir.y, pose.reservoir.r, 0, TAU);
      ctx.fill();
    }

    // contractile vacuole (slow pulse)
    if (pose.contractileVacuole) {
      ctx.fillStyle = `hsla(190, 16%, 86%, ${alpha * 0.34})`;
      ctx.beginPath();
      ctx.arc(pose.contractileVacuole.x, pose.contractileVacuole.y, Math.max(0.4, pose.contractileVacuole.r), 0, TAU);
      ctx.fill();
    }

    // stigma / eyespot (single warm accent; dims as it rolls to the far face)
    ctx.fillStyle = `hsla(8, 88%, 49%, ${alpha * (0.45 + 0.47 * pose.eyespotFront)})`;
    ctx.beginPath();
    ctx.arc(pose.eyespot.x, pose.eyespot.y, Math.max(0.6, length * 0.03), 0, TAU);
    ctx.fill();

    // flagellum (anterior whip): ONE fused continuous path, base→tip taper via
    // three overlaid passes (underglow → thin full-length tip → thick proximal),
    // so there are no per-segment round-cap "bead" seams.
    const fp = pose.flagellumPoints;
    if (fp.length >= 2) {
      // when the euglena is tucked against the hero (its body occluded by the
      // paramecium drawn on top), fade the protruding whip so it doesn't read as
      // an orphaned line floating over the hero.
      let flagFade = 1;
      if (frame.hero) {
        const hdx = finite(cell.x, 0) - finite(frame.hero.x, 0);
        const hdy = finite(cell.y, 0) - finite(frame.hero.y, 0);
        // hide the flagellum entirely near the hero (no green may touch the
        // paramecium); ramp back in only well clear of it.
        const reach = (Math.max(finiteOr(frame.hero.halfLen, frame.hero.radius), frame.hero.radius) + flagellumLength) * 1.05;
        const hdist = Math.hypot(hdx, hdy);
        flagFade = hdist >= reach ? 1 : clamp((hdist / reach - 0.45) / 0.5, 0, 1);
      }
      // soft underglow so the thin whip separates from the dark field
      ctx.strokeStyle = `hsla(${hue + 8}, 20%, 66%, ${alpha * 0.30 * flagFade})`;
      ctx.lineWidth = Math.max(0.9, width * 0.18);
      drawPolyline(ctx, fp, false);
      ctx.stroke();
      // full-length thin tip stroke
      ctx.strokeStyle = `hsla(${hue + 8}, 34%, 70%, ${alpha * 0.90 * flagFade})`;
      ctx.lineWidth = Math.max(0.5, width * 0.10);
      drawPolyline(ctx, fp, false);
      ctx.stroke();
      // thicker proximal ~60% on top → continuous base-to-tip taper
      const nprox = Math.max(2, Math.round(fp.length * 0.6));
      ctx.lineWidth = Math.max(0.8, width * 0.16);
      drawPolyline(ctx, fp.slice(0, nprox), false);
      ctx.stroke();
    }
  });
  ctx.restore();
}
