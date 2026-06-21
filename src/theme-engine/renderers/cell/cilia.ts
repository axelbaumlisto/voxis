// src/theme-engine/renderers/cell/cilia.ts

import { noise2D, smoothstep, TAU, wrapPi, deformAt, deformDerivAt } from "../shared";
import { affineSqueezePoints } from "./contour";
import type { CellParams } from "./types";

// Cilia helpers only. Trichocysts are defensive extrusomes, not cilia.
// SoupaWhisper cell v1.0 intentionally uses short, dense somatic fur rather
// than long whiskers/flagella for the approved Paramecium-like look.

export interface Cilium {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Quadratic Bezier control point — bent sideways off the base->tip chord
   * so the cilium bows like a living flagellum instead of a rigid spike. */
  cpx: number;
  cpy: number;
}

/**
 * Hair-like cilia around the membrane. Each cilium base sits on the cell
 * radius at its angle; the tip extends outward by (ciliaLength + growth*
 * ciliaGrowthBoost)*baseR and sways laterally via a per-cilium noise wave.
 * Energy makes them a touch longer/livelier. Pure & deterministic given t.
 *
 * @param cx,cy   Cell center (already including any startle offset).
 * @param baseR   Base cell radius in pixels.
 * @param t       Continuous time (seconds).
 * @param energy  Cell energy [0,1].
 * @param growth  Growth level [0,1].
 */
export function ciliaEndpoints(
  cx: number,
  cy: number,
  baseR: number,
  t: number,
  energy: number,
  growth: number,
  params: CellParams,
): Cilium[] {
  const out: Cilium[] = [];
  const n = Math.max(1, params.ciliaCount);
  const lenPx = baseR * (params.ciliaLength + growth * params.ciliaGrowthBoost) * (0.7 + energy * 0.6);
  for (let k = 0; k < n; k++) {
    const baseAngle = (k / n) * TAU;
    // per-cilium lateral sway via noise (each hair waves slightly differently)
    const sway = noise2D(k * 5.3, t * params.ciliaWaveSpeed) * params.ciliaWave;
    const tipAngle = baseAngle + sway;
    const x1 = cx + baseR * Math.cos(baseAngle);
    const y1 = cy + baseR * Math.sin(baseAngle);
    const x2 = cx + (baseR + lenPx) * Math.cos(tipAngle);
    const y2 = cy + (baseR + lenPx) * Math.sin(tipAngle);

    // Bow the hair sideways: place a quadratic Bezier control point at the
    // chord midpoint, displaced PERPENDICULAR to the base->tip direction by
    // a noise-driven amount that differs per hair (k) and drifts over time.
    // This makes each cilium curve organically and chaotically rather than
    // standing as a straight needle.
    const dx = x2 - x1;
    const dy = y2 - y1;
    const segLen = Math.hypot(dx, dy) || 1;
    // unit perpendicular to the chord
    const px = -dy / segLen;
    const py = dx / segLen;
    // bend amount: each hair always bows to one side (deterministic sign per
    // hair, so no cilium is ever a straight needle), modulated by drifting
    // noise for a living, chaotic wobble. Scaled by hair length so longer
    // hairs bow more (∝ flagellar flexibility).
    const bias = ((k * 2654435761) % 2 === 0 ? 1 : -1); // stable per-hair side
    const wobble = noise2D(k * 9.7 + 0.5, t * params.ciliaWaveSpeed * 0.6 + k * 1.7); // [-1,1]
    // base bow (always present) + noise wobble; keep within ~[0.4,1.4]*curl
    const bendMag = (0.7 + 0.5 * wobble) * params.ciliaCurl;
    const bend = bias * bendMag * lenPx;
    const midx = (x1 + x2) / 2;
    const midy = (y1 + y2) / 2;
    const cpx = midx + px * bend;
    const cpy = midy + py * bend;
    out.push({ x1, y1, x2, y2, cpx, cpy });
  }
  return out;
}

/**
 * Asymmetric two-phase ciliary beat clock.
 *
 * Real motile cilia spend LESS time in the fast power stroke and MORE in the
 * slow recovery stroke (Gompper/Elgeti et al.). We model the beat as a phase
 * in [0,1) that advances NON-uniformly in time: fast through the power band,
 * slow through recovery. `ciliaAsymmetry` in [0,1) controls the skew
 * (0 = symmetric). `index` applies a metachronal phase lag so neighbouring
 * cilia are offset, producing a wave that travels around the crown.
 *
 * Pure & deterministic.
 */
export function ciliaBeatPhase(
  t: number,
  index: number,
  params: CellParams,
): number {
  const hz = params.ciliaBeatHz ?? 0.9;
  return ciliaBeatPhaseAtCycle(t * hz, index, params);
}

/**
 * Step A+B: ciliary beat phase from an already-integrated base cycle count.
 * Keeps the pure asymmetric/metachronal mapping, but lets the render loop
 * advance `baseCycles += hz(activity) * dt` instead of `hz(activity) * simTime`.
 */
export function ciliaBeatPhaseAtCycle(
  baseCycles: number,
  index: number,
  params: CellParams,
): number {
  const lag = (params.ciliaMetachronal ?? 0) * index;
  // Linear phase advance + metachronal offset, wrapped to [0,1).
  const lin = (baseCycles + lag / TAU) % 1;
  const u = ((lin % 1) + 1) % 1; // guard negatives
  const a = Math.max(0, Math.min(0.95, params.ciliaAsymmetry ?? 0));
  if (a === 0) return u;
  // F3 (C1 beat clock): warp the uniform clock u -> phase with a SMOOTH,
  // PERIODIC velocity profile instead of a piecewise-linear ramp. We want the
  // power stroke (early phase) to pass quickly and the recovery (late phase) to
  // dwell. Define a positive periodic phase velocity
  //     dphase/du = g(u) = 1 + A*sin(2*pi*u),   A = a (< 1 keeps g > 0)
  // which is fastest near u=0.25 (power) and slowest near u=0.75 (recovery).
  // Integrating from 0 (so phase(0)=0, phase(1)=1) gives a closed form:
  //     phase(u) = u + (A / 2pi) * (1 - cos(2*pi*u)).
  // g is C-infinity AND periodic, so dphase/du is continuous across the period
  // wrap u: 1->0 (the old piecewise map had a slope jump there). The map is
  // monotone for A<1 and reduces to the identity at A=0 (symmetric beat).
  const A = a; // a is already clamped to [0, 0.95]
  const phase = u + (A / TAU) * (1 - Math.cos(TAU * u));
  return ((phase % 1) + 1) % 1; // keep in [0,1) against FP drift
}


/**
 * D2 motion basis for cilia drag-lean. When the cell swims, viscous drag bends
 * the whole crown REARWARD (opposite the travel tangent), more on the leading
 * face than the trailing one. (plan D2.)
 */
export interface CiliaMotion {
  /** Unit travel tangent x (direction of motion). */
  tx: number;
  /** Unit travel tangent y. */
  ty: number;
  /** Normalized swim speed [0,1]; 0 => no lean (identity). */
  speedNorm: number;
  /** F4/G3: global stroke-axis coherence weight [0,1] (= strokeAxisStrength(a)).
   * 0 => per-hair local azimuth (identity). Optional; defaults to 0. */
  axisStrength?: number;
  /** Step A+B: integrated cilia beat base cycles. When absent, ciliaPath keeps
   * legacy pure `t * ciliaBeatHz` behaviour for helper compatibility. */
  beatCycles?: number;
  /** Commit 21c: the live membrane contour the cilia should anchor on. When
   * present AND params.enableCiliaOnContour, each hair base sits on the deformed
   * (deform[]) + affine-squeezed (squeezeK,squeezePhi) contour and grows along
   * its true outward normal. Absent => the legacy bare-circle base (identity). */
  contour?: { deform: number[]; squeezeK: number; squeezePhi: number };
}

/**
 * G3 — idle/active stroke-axis vigour. Maps the master activity scalar to a
 * coherence weight in [0,1] via a smoothstep knee, so an idle crown is
 * near-isotropic (weight≈0, R<0.2, no "rowing in place") and an active crown is
 * coherent (weight≈1, R>0.4) driving propulsion. Pure & monotone in activity.
 */
export function strokeAxisStrength(activity: number, params: CellParams): number {
  const a = activity < 0 ? 0 : activity > 1 ? 1 : activity;
  const knee = params.strokeAxisKnee ?? 0.5;
  return smoothstep(a / (knee > 0 ? knee : 1e-6));
}

/**
 * D3 — metachronal index on the MOTION axis. The metachronal wave's phase lag
 * runs around the crown by hair index `k` at rest, but while swimming the wave
 * should organise along the travel direction. We blend the integer crown index
 * with an AXIAL index `wrapPi(baseAngle − axis)/gap` by `speedNorm`:
 *   metaIdx = (1−speedNorm)·k + speedNorm·(wrapPi(baseAngle−axis)/gap)
 * At speedNorm=0 (or gate off) this is exactly `k` (today's behaviour); at
 * speedNorm=1 the wave is anchored to the heading, so the argmax-phase hair
 * rotates WITH the heading. Fractional index is fine — ciliaBeatPhase accepts it.
 * Pure & deterministic.
 */
export function metachronalIndex(
  baseAngle: number,
  k: number,
  speedNorm: number,
  axis: number,
  gap: number,
  engaged: boolean,
): number {
  if (!engaged) return k;
  const s = speedNorm < 0 ? 0 : speedNorm > 1 ? 1 : speedNorm;
  if (s === 0) return k;
  const axial = wrapPi(baseAngle - axis) / (gap > 0 ? gap : 1e-6);
  return (1 - s) * k + s * axial;
}

/**
 * F4 — shared global stroke axis. Each hair beats in a plane; at rest that plane
 * is the LOCAL perpendicular `baseAngle + π/2` (per-hair azimuth, today's look).
 * While swimming we rotate every hair's beat plane TOWARD one global axis LINE
 * (the body heading), weighted by `strength` in [0,1]. We align to the nearest
 * orientation of the axis (mod π, since a beat plane is a line, not a ray), so a
 * hair never rotates more than π/2. strength=0 => identity. Pure.
 */
export function ciliaStrokeAngle(
  baseAngle: number,
  axis: number,
  strength: number,
): number {
  const local = baseAngle + Math.PI / 2;
  const s = strength < 0 ? 0 : strength > 1 ? 1 : strength;
  if (s === 0) return local;
  // Nearest axis orientation to `local` modulo π (beat plane is a line).
  const delta = wrapPi(2 * (axis - local)) / 2; // in (-π/2, π/2]
  return local + s * delta;
}

/**
 * Commit 22a — somatic ciliature ("mex") parameter override. When
 * `enableSomaticCilia` is on, the crown becomes MANY SHORT hairs (a dense
 * fringe) instead of the few long flagella: ciliaCount -> somaticCiliaCount and
 * ciliaLength -> somaticCiliaLength. Off (default) returns `params` unchanged
 * (referential identity), so the legacy crown is byte-identical. Pure.
 */
export function somaticCiliaParams(params: CellParams): CellParams {
  if (!params.enableSomaticCilia) return params;
  return {
    ...params,
    ciliaCount: params.somaticCiliaCount ?? 72,
    ciliaLength: params.somaticCiliaLength ?? 0.15,
  };
}

/** A cilium rendered as a multi-point spine plus its stroke width. */
export interface CiliumPath {
  /** Polyline points base->tip. */
  points: Array<[number, number]>;
  /** Stroke width in px for this hair (thicker hairs read as nearer/stronger). */
  width: number;
}

/**
 * Biologically-motivated cilium: a multi-segment spine with a bending wave
 * that travels from base to tip, beating with an asymmetric power/recovery
 * cycle and a metachronal phase lag between neighbours.
 *
 * Construction (per cilium, per segment s in [0,1] along arclength):
 *  - spine goes radially outward from the membrane (base at radius baseR);
 *  - a transverse bend offset is applied perpendicular to the radial axis;
 *  - the bend is a travelling sine: sin(2pi*(waves*s - phase)), so the hump
 *    moves outward along the hair over time (base->tip propagation);
 *  - amplitude tapers toward the base (anchored) and grows toward the tip,
 *    and scales with the beat envelope so the power stroke is straighter and
 *    the recovery stroke more curled.
 *
 * Pure & deterministic given t.
 */
/**
 * Commit 23 — ciliature structure modifier. A real Paramecium's somatic mex is
 * NOT uniform: (1) a ventral ORAL-GROOVE region where the cilia thin out (a
 * density DIP, not a bald gap), and (2) a slightly LONGER caudal tuft at the
 * posterior pole. Given a hair's BODY-FRAME angle `psi = wrapPi(baseAngle -
 * strokeAxis)` (psi=0 at the anterior heading, psi=±π at the posterior pole) and
 * a stable per-hair [0,1] noise scalar `hairNoise`, returns a length scale and a
 * keep flag. Pure/deterministic (wrapPi + arithmetic only). When the gate is OFF
 * it returns {lengthScale:1, keep:true} so the caller stays byte-identical.
 */
export function ciliaStructureMod(
  psi: number,
  hairNoise: number,
  params: CellParams,
): { lengthScale: number; keep: boolean } {
  if (!params.enableCiliaStructure) return { lengthScale: 1, keep: true };
  const caudalTuftWidth = params.caudalTuftWidth ?? 0.6;
  const caudalTuftLength = params.caudalTuftLength ?? 1.7;
  const oralGapCenter = params.oralGapCenter ?? 1.2;
  const oralGapWidth = params.oralGapWidth ?? 0.75;
  const oralGapDip = params.oralGapDip ?? 0.3;
  // Caudal tuft: near the posterior pole (psi ≈ ±π), lengthen.
  const dPost = Math.PI - Math.abs(psi); // 0 at the pole, grows away
  let lengthScale = 1;
  if (dPost < caudalTuftWidth) {
    const f = 1 - dPost / caudalTuftWidth; // 1 at pole -> 0 at edge
    lengthScale = 1 + (caudalTuftLength - 1) * f; // smooth C0 ramp, no step
  }
  // Oral-groove density dip: deterministically thin out (drop) a fraction of
  // hairs in the window, scaled by how central they are (more thinning at the
  // groove centre). Uses the stable per-hair noise so the same hair is dropped
  // every frame (no flicker).
  let keep = true;
  const dOral = Math.abs(wrapPi(psi - oralGapCenter));
  if (dOral < oralGapWidth) {
    const central = 1 - dOral / oralGapWidth; // 1 at centre -> 0 at edge
    if (hairNoise < oralGapDip * central) keep = false;
  }
  return { lengthScale, keep };
}

export function ciliaPath(
  cx: number,
  cy: number,
  baseR: number,
  t: number,
  energy: number,
  growth: number,
  params: CellParams,
  motion?: CiliaMotion,
): CiliumPath[] {
  // D2: drag-lean strength. Zero when there is no motion basis or speedNorm=0,
  // so the crown is identical to the pre-D2 output at rest (back-compat).
  const dragCoeff = params.dragCoeff ?? 0.5;
  const mTx = motion?.tx ?? 0;
  const mTy = motion?.ty ?? 0;
  const mSpeed = motion ? Math.max(0, Math.min(1, motion.speedNorm)) : 0;
  // Commit 21c: anchor hair bases on the deformed+squeezed contour. Engaged ONLY
  // when the gate is on AND a contour is supplied; otherwise the legacy
  // bare-circle base path runs byte-for-byte (commit-21b frozen golden).
  const anchored = params.enableCiliaOnContour === true && motion?.contour !== undefined;
  // F4/G3: global stroke-axis coherence weight. Zero (or gate off, or no motion)
  // => per-hair local azimuth + integer metachronal index (identical to commit 11).
  const axisEngaged = (params.enableStrokeAxis ?? true) && motion !== undefined;
  const axisStrength = axisEngaged
    ? Math.max(0, Math.min(1, (motion?.axisStrength ?? 0) * (params.strokeAxisAlign ?? 1)))
    : 0;
  // Global stroke axis = the travel heading (atan2 of the motion tangent).
  const strokeAxis = Math.atan2(mTy, mTx);
  const out: CiliumPath[] = [];
  const n = Math.max(1, params.ciliaCount);
  const seg = Math.max(2, params.ciliaSegments ?? 6);
  const curl = params.ciliaCurl;
  const lenVar = Math.max(0, Math.min(0.95, params.ciliaLengthVar ?? 0.5));
  // A1: clamp jitter to [0, 0.9] (mirrors lenVar's [0, 0.95] clamp). The base
  // angular offset below is angleJit*gap*0.5, so capping at 0.9 keeps each hair
  // within <0.45*gap of its grid slot — strictly less than the half-gap that
  // would let neighbours swap order.
  const angleJit = Math.max(0, Math.min(0.9, params.ciliaAngleJitter ?? 0.55));
  const baseWidth = params.ciliaWidth ?? 1.6;
  // Number of spatial wavelengths along the hair (a flagellum shows ~1 wave).
  const waves = 1.1;
  const gap = TAU / n; // mean angular spacing between hairs

  // Mean hair length. CRITICAL: drive length by the SMOOTHED `growth`
  // accumulator (asymmetric attack/release) plus the resting `ciliaLength`,
  // NOT by the instantaneous `energy`. This makes the crown shrink GRADUALLY
  // when speech stops (growth releases slowly) instead of snapping shut.
  const lenMean =
    baseR * (params.ciliaLength + growth * params.ciliaGrowthBoost) * (0.55 + 0.45 * energy);

  for (let k = 0; k < n; k++) {
    // --- Aperiodic placement: jitter each hair off the even grid by a stable
    // per-hair noise offset, so spacing is irregular (biological crowns are
    // aperiodic, not perfectly hexagonal). A2: |angOff| <= angleJit*gap*0.5 and
    // angleJit<=0.9, so each hair stays within <0.45*gap of its slot. That bounds
    // the ADJACENT-hair angular DIFFERENCE to gap*(1 - 0.45 - 0.45) = 0.1*gap > 0,
    // i.e. neighbours can never cross / reorder.
    const angOff = noise2D(k * 12.9898, 7.2) * angleJit * gap * 0.5;
    const baseAngle = k * gap + angOff;
    const ux = Math.cos(baseAngle); // radial unit (outward)
    const uy = Math.sin(baseAngle);
    // F4: the transverse BEND plane. At rest this is the local perpendicular
    // (baseAngle + pi/2). While swimming it rotates toward the global stroke
    // axis (the heading), weighted by axisStrength, so the crown rows coherently.
    // When axisStrength==0 take the EXACT legacy vectors (-uy, ux) rather than
    // cos/sin(baseAngle+pi/2): trig of (ba+pi/2) differs from (-sin,cos) at ~1e-15
    // (IEEE-754), so this fast-path keeps the gate-off / at-rest crown BYTE-
    // identical to commit 11, not just visually identical.
    // NOTE (partial-strength seam): ciliaStrokeAngle rotates a LINE toward the
    // nearest axis orientation; for 0<axisStrength<1 the fore/aft hair pair
    // straddling baseAngle≡strokeAxis (mod pi) can fan apart by up to ~axisStrength*pi
    // before reconciling at axisStrength=1. It is one transient neighbour-pair
    // during the activity ramp, bounded and gone at sustained activity.
    let pxn: number;
    let pyn: number;
    if (axisStrength === 0) {
      pxn = -uy; // legacy perpendicular unit (exact)
      pyn = ux;
    } else {
      const strokeAngle = ciliaStrokeAngle(baseAngle, strokeAxis, axisStrength);
      pxn = Math.cos(strokeAngle); // bend-plane unit
      pyn = Math.sin(strokeAngle);
    }

    // Commit 21c: per-hair base anchored on the deformed+squeezed contour, plus
    // its true outward unit normal. Only on the anchored path; the off path keeps
    // the bare-circle base (cx+ux*baseR) and the (pxn,pyn) above untouched.
    let bx = 0;
    let by = 0;
    let anx = 0; // anchored outward unit normal x
    let any = 0; // anchored outward unit normal y
    if (anchored) {
      const contour = motion!.contour!;
      const d = deformAt(baseAngle, contour.deform);
      const dp = deformDerivAt(baseAngle, contour.deform);
      // Anchor radius on the deformed circle r(theta)=baseR*(1+d).
      const rTheta = baseR * (1 + d);
      const bx0 = cx + ux * rTheta;
      const by0 = cy + uy * rTheta;
      // One affine squeeze of the single base point (reuses the exact map;
      // identity when !enableAffine || k===1).
      const sq = affineSqueezePoints(
        [[bx0, by0]],
        contour.squeezeK,
        contour.squeezePhi,
        cx,
        cy,
        params,
      )[0];
      bx = sq[0];
      by = sq[1];
      // Outward normal of the polar curve r(theta)=baseR*(1+d) BEFORE squeeze:
      // n0 = normalize( cosθ*(1+d) + sinθ*d', sinθ*(1+d) - cosθ*d' ).
      let n0x = ux * (1 + d) + uy * dp;
      let n0y = uy * (1 + d) - ux * dp;
      const n0len = Math.hypot(n0x, n0y) || 1;
      n0x /= n0len;
      n0y /= n0len;
      // Transform the normal CONTRAVARIANTLY for the squeeze (reciprocal diagonal):
      // n' = R(phi) . diag(1/k, k) . R(-phi) . n0. NOT affineSqueezePoints (which
      // applies diag(k,1/k) and is WRONG for a normal). Same engaged condition as
      // affineSqueezePoints so base point and normal stay consistent.
      if (params.enableAffine && contour.squeezeK !== 1) {
        const cphi = Math.cos(contour.squeezePhi);
        const sphi = Math.sin(contour.squeezePhi);
        const xr = n0x * cphi + n0y * sphi;
        const yr = -n0x * sphi + n0y * cphi;
        const xs = xr / contour.squeezeK; // diag(1/k, k) — reciprocal of the point map
        const ys = yr * contour.squeezeK;
        const nx = xs * cphi - ys * sphi;
        const ny = xs * sphi + ys * cphi;
        const nlen = Math.hypot(nx, ny) || 1;
        anx = nx / nlen;
        any = ny / nlen;
      } else {
        anx = n0x;
        any = n0y;
      }
      // Local bend-plane perpendicular = 90° rotation of the outward normal.
      pxn = -any;
      pyn = anx;
    }

    // --- Per-hair size diversity: a stable [0,1] random scalar per hair. ---
    const r01 = noise2D(k * 3.7 + 0.3, 1.3) * 0.5 + 0.5; // [0,1]
    // Commit 23: ciliature structure (oral-groove dip + caudal tuft). Gated so
    // the OFF path runs the EXACT original code (no wrapPi, no continue, lenK
    // unchanged) and stays byte-identical to the commit-22 mex/crown golden.
    let lengthScale = 1;
    if (params.enableCiliaStructure) {
      const psi = wrapPi(baseAngle - strokeAxis);
      const struct = ciliaStructureMod(psi, r01, params);
      if (!struct.keep) continue; // oral-groove thinning: drop this hair
      lengthScale = struct.lengthScale; // caudal-tuft lengthening
    }
    // Length spans [1-lenVar, 1+lenVar] around the mean (x*1===x exactly, so the
    // OFF path keeps lenK bit-identical).
    let lenK = lenMean * (1 - lenVar + 2 * lenVar * r01) * lengthScale;
    // v3.9D: metachronal LENGTH wave — a visible traveling ripple of longer/
    // shorter cilia along the contour. Independent of the existing beat-phase
    // `ciliaMetachronal`. When off (default), multiplier is exactly 1.0.
    if (params.enableMetachronal) {
      const mWave = params.metachronalWavelength ?? 20;
      const mSpd = params.metachronalSpeed ?? 4.0;
      // Traveling cosine wave along the cilia index.
      // cos range [-1,1] → modulation range [0.6, 1.0].
      const metaPhase = (k / mWave) * TAU - t * mSpd;
      const depth = params.metachronalDepth ?? 0.4;
      const mod = (1 - depth) + depth * (0.5 + 0.5 * Math.cos(metaPhase));
      lenK *= mod;
    }
    // Thickness correlates loosely with length (longer ~ slightly thicker),
    // plus its own variation so it doesn't look mechanical.
    const r01b = noise2D(k * 5.1 + 2.7, 4.9) * 0.5 + 0.5;
    const hairWidth = baseWidth * (0.55 + 0.9 * (0.5 * r01 + 0.5 * r01b));

    // Beat phase for this hair (asymmetric + metachronal). Per-hair phase
    // seed so even neighbours at the same metachronal index aren't identical.
    // D3: while swimming, the metachronal wave organises along the MOTION axis
    // (metaIdx blends the crown index k -> axial index by speedNorm); at rest it
    // is exactly k (today's around-the-crown wave).
    const metaIdx = metachronalIndex(baseAngle, k, mSpeed, strokeAxis, gap, axisEngaged);
    const phase = motion?.beatCycles !== undefined
      ? ciliaBeatPhaseAtCycle(motion.beatCycles + r01 * 0.6 * (params.ciliaBeatHz ?? 0.9), metaIdx, params)
      : ciliaBeatPhase(t + r01 * 0.6, metaIdx, params);
    // F3: smooth the recovery envelope instead of a hard {0.35,1} step at
    // phase=0.5. smoothstep((phase-0.35)/0.3) ramps 0->1 over phase in
    // [0.35,0.65], Lipschitz and C1, so the bend amplitude no longer jumps.
    const recovery = smoothstep((phase - 0.35) / 0.3);
    // F1: the old `beat = sin(phase*TAU)` drove a uniform `beat*0.3` tip sway and
    // is no longer used — the travelling `wave` below carries all bend.

    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= seg; i++) {
      const sFrac = i / seg; // 0 at base, 1 at tip
      const along = baseR + lenK * sFrac;
      // travelling bend wave (base->tip): the hump moves outward over time
      const wave = Math.sin(TAU * (waves * sFrac - phase));
      // F1: a cilium is a clamped-base / FREE-TIP elastic rod (9+2 axoneme).
      // The bending moment -> 0 at the free tip, so curvature must VANISH there
      // (kappa(L)=0). Use an INTERIOR-peaked envelope sin(pi*sFrac): exactly 0 at
      // the base (sFrac=0, anchored) AND 0 at the tip (sFrac=1, free), peaking
      // mid-shaft. The old tip-peaked pow(sFrac,1.2) flung the tip sideways,
      // which is biologically wrong.
      const amp = curl * lenK * 0.6 * Math.sin(Math.PI * sFrac) * (0.4 + 0.6 * recovery);
      // F1: drop the uniform `beat*0.3` term — it added a constant (sFrac-flat)
      // sway that did not vanish at the tip. The travelling wave alone keeps the
      // tip free.
      const rawBend = wave * 0.7 * amp;
      // F2: cap the transverse offset so a hair's angular sweep at radius `along`
      // stays under half the angular gap to its neighbour. The transverse offset
      // `bend` subtends angle ~bend/along; capping |bend| <= 0.5*gap*along keeps
      // that under half a gap, so beating hairs never cross / reorder.
      const bendCap = 0.5 * gap * along;
      const bend = Math.max(-bendCap, Math.min(bendCap, rawBend));
      // D2: viscous drag-lean. While swimming, each hair leans REARWARD (along
      // -tangent), growing toward the tip (pow(sFrac,1.3)) and stronger on the
      // LEADING face (lead = radial . tangent): dragGain = dragCoeff*speedNorm*
      // (0.6 + 0.4*lead). Zero at speedNorm=0 => identity (back-compat). The lean
      // is a fraction of hair length, so longer hairs sweep more.
      const lead = ux * mTx + uy * mTy;
      const dragGain = dragCoeff * mSpeed * (0.6 + 0.4 * lead);
      const dragPx = dragGain * lenK * Math.pow(sFrac, 1.3);
      // Commit 21c: on the anchored path the base is (bx,by) on the real contour
      // and the shaft grows outward along the true unit normal (anx,any); the
      // outward extent is (along - baseR) = lenK*sFrac. The off path is unchanged.
      const x = anchored
        ? bx + anx * (along - baseR) + pxn * bend - mTx * dragPx
        : cx + ux * along + pxn * bend - mTx * dragPx;
      const y = anchored
        ? by + any * (along - baseR) + pyn * bend - mTy * dragPx
        : cy + uy * along + pyn * bend - mTy * dragPx;
      pts.push([x, y]);
    }
    out.push({ points: pts, width: hairWidth });
  }
  return out;
}

