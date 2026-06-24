import { seededUnit } from "../seeds";
import { TAU, clamp, clamp01, finite, finiteOr, positive, wrapUnit } from "../util";

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

const METABOLY_AMP = 0.16; // local traveling-bulge amplitude (was a 0.045 global breathe)
const METABOLY_K = 1.3; // ~1.3 wavelengths along the body
const STRIAE_TURNS = 1.25; // helical turns of a pellicle stria over the body
const STRIAE_AMP = 0.62; // lateral fraction amplitude of a projected stria

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

