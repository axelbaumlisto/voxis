import { noise2D, smoothstep, TAU } from "../shared";
import type { CellParams } from "./types";

/**
 * Compute the nucleus position and radius for the living cell.
 *
 * **SRP**: All nucleus math lives here; renderer only draws.
 * **Deterministic**: same inputs always produce the same output.
 *
 * The nucleus drifts slowly via 2D value-noise (two orthogonal seeds),
 * pulses its radius with audio level, and breathes gently during silence.
 * The offset (and, if needed, the radius) is clamped so the organelle always
 * stays inside the membrane. When the caller passes the LIVE minimum membrane
 * radius (`minMembraneR`), containment uses `minMembraneR * (1 - 0.15)` (F9
 * pinch-escape); otherwise it falls back to the legacy fixed `baseR * 0.55`.
 *
 * @param t          Continuous time in seconds.
 * @param audioLevel Smoothed audio level [0, 1].
 * @param baseR      Base cell radius in pixels.
 * @param params     Cell parameters (nucleus tunables are read from this).
 * @returns `{ cx, cy }` — offset **from cell center** in pixels.
 *          `{ r }` — nucleus radius in pixels, never below a safe floor.
 */
export function nucleusTransform(
  t: number,
  audioLevel: number,
  baseR: number,
  params: CellParams,
  minMembraneR?: number,
): { cx: number; cy: number; r: number } {
  // --- Drift: slow noise-driven offset inside the cell ---
  // M10: give x and y DISTINCT 2-D walks. Sharing the same second coord
  // `t*nucleusDrift` on adjacent first-coord rows (137 vs 241) made the two
  // streams cross-correlate (~0.26 over the test window; the nucleus drifted
  // diagonally). The y-walk uses a different rate (1.3x) and a large phase
  // offset (555.5) so the streams decorrelate to |r|<0.2 (measured ~0.10) while
  // staying smooth & deterministic. (xcorr of slow noise is window-sensitive;
  // <0.2 is the contractual bound, not the exact finite-sample value.)
  // SEED MAP (noise2D first coords): 137=nucleus-x, 241=nucleus-y, 811.3=startle
  // angle, 900.5=legacy startle, 7.1=wander init, k*12.9898=cilia angle jitter,
  // k*3.7/k*5.1=cilia size, k*5.3/k*9.7=cilia sway/wobble.
  const rawCx = baseR * params.nucleusWander * noise2D(137, t * params.nucleusDrift);
  const rawCy = baseR * params.nucleusWander * noise2D(241, t * params.nucleusDrift * 1.3 + 555.5);

  // --- Radius: base size + audio-driven pulse + idle breathing ---
  const idleBreath = Math.sin(t * 1.3) * params.nucleusPulse * 0.25;
  let r = baseR * (params.nucleusRadius + audioLevel * params.nucleusPulse + idleBreath);

  // Enforce a minimum pixel radius so the nucleus is never sub-pixel.
  const MIN_PX_RADIUS = 2.5;
  r = Math.max(MIN_PX_RADIUS, r);

  // --- Safety clamp: nucleus must stay well inside the membrane ---
  // F9 (pinch-escape): when the caller knows the LIVE minimum membrane radius
  // (which can floor near baseR*0.35 under a deep inward pinch), contain the
  // nucleus inside `minMembraneR * (1 - 0.15)`. Without it, fall back to the
  // legacy fixed inner-safe radius baseR*0.55, which assumes an undeformed wall.
  const PINCH_MARGIN = 0.15;
  const safeInner =
    minMembraneR !== undefined && Number.isFinite(minMembraneR)
      ? Math.max(0, minMembraneR) * (1 - PINCH_MARGIN)
      : baseR * 0.55;
  // F9: the nucleus radius itself must fit the safe zone, else it would poke out
  // through a tightly-pinched wall. Shrink it (above the sub-pixel floor) so
  // r + |offset| can satisfy the containment bound.
  if (r > safeInner) r = Math.max(MIN_PX_RADIUS, safeInner);
  const offsetMag = Math.sqrt(rawCx * rawCx + rawCy * rawCy);
  const maxOffsetMag = Math.max(0, safeInner - r);

  if (maxOffsetMag <= 0) {
    // Nucleus radius alone fills the safe zone — pin to centre.
    return { cx: 0, cy: 0, r: Math.max(0, safeInner) };
  }

  let cx: number;
  let cy: number;
  if (offsetMag <= maxOffsetMag) {
    cx = rawCx;
    cy = rawCy;
  } else {
    const scale = maxOffsetMag / offsetMag;
    cx = rawCx * scale;
    cy = rawCy * scale;
  }

  return { cx, cy, r };
}

/**
 * F11 (OPT) — contractile vacuole. A peripheral vesicle that slowly FILLS
 * (diastole) then rapidly COLLAPSES (systole) each `vacuolePeriod`. Phase
 * `u = (t/period) mod 1`; radius `R_max * smoothstep(0, 0.85, u)` rising to a
 * peak near u=0.85, then dropping to ~0 by u=1. R_max = vacuoleMaxFrac*baseR.
 * Returns `{ r }` (px). Pure & deterministic.
 */
export function contractileVacuole(t: number, baseR: number, params: CellParams): { r: number } {
  const period = Math.max(0.1, params.vacuolePeriod ?? 7);
  const Rmax = Math.max(0, params.vacuoleMaxFrac ?? 0.18) * Math.max(0, baseR);
  const u = ((t / period) % 1 + 1) % 1;
  let fill: number;
  if (u <= 0.85) {
    // diastole: smoothstep fill 0 -> 1 over [0, 0.85]
    fill = smoothstep(u / 0.85);
  } else {
    // systole: rapid collapse 1 -> 0 over (0.85, 1]
    fill = 1 - smoothstep((u - 0.85) / 0.15);
  }
  return { r: Rmax * fill };
}

/**
 * Commit 26 — TWO contractile vacuoles (anterior + posterior). A real
 * Paramecium has a pair of CVs at opposite ends, each pulsing on its OWN clock
 * (asynchronous: different periods + a posterior phase offset). This pure
 * helper returns the pair's geometry in the WORLD frame (pre-affine-squeeze):
 * each entry's `bearing` (world angle = squeezePhi + body-frame bearing, so the
 * pair rotates with the body heading/spin) and `r` (px, the live vesicle
 * radius). REUSES `contractileVacuole` for the fill/collapse curve (DRY) by
 * passing a time-shifted `t` and a per-vacuole period/maxFrac. The renderer
 * places each vesicle at a clamped `placeR` along `bearing` (containment vs
 * `minMembraneR` lives in the renderer, since that is not known here). Returns
 * [] when `enableVacuoles` is off so the gated draw block is skipped. Pure &
 * deterministic — depends only on (t, baseR, squeezePhi, params).
 */
export function contractileVacuolePair(
  t: number,
  baseR: number,
  squeezePhi: number,
  params: CellParams,
): Array<{ bearing: number; r: number }> {
  if (!params.enableVacuoles) return [];
  const maxFrac = params.vacuolePairMaxFrac ?? 0.16;
  const antPeriod = params.vacuoleAnteriorPeriod ?? 9;
  const postPeriod = params.vacuolePosteriorPeriod ?? 13;
  const antBearing = params.vacuoleAnteriorBearing ?? 1.9;
  const postBearing = params.vacuolePosteriorBearing ?? -1.9;
  const postPhase = params.vacuolePosteriorPhase ?? 0.5;
  // anterior CV: phase offset 0; posterior CV: out of phase by a fraction of
  // its own cycle so the two never start together (asynchronous).
  const anterior = contractileVacuole(t, baseR, {
    ...params,
    vacuolePeriod: antPeriod,
    vacuoleMaxFrac: maxFrac,
  });
  const posterior = contractileVacuole(t + postPhase * postPeriod, baseR, {
    ...params,
    vacuolePeriod: postPeriod,
    vacuoleMaxFrac: maxFrac,
  });
  return [
    { bearing: squeezePhi + antBearing, r: anterior.r },
    { bearing: squeezePhi + postBearing, r: posterior.r },
  ];
}

/**
 * Commit 28 — a food vacuole's [0..1] size scalar over its DIGEST cycle. Fresh
 * vacuoles are full (1.0) and shrink linearly to ~0.3 over `foodVacuoleDigestPeriod`
 * seconds, then reset (a new vacuole forms). `seedPhase` offsets each vacuole so
 * they digest asynchronously. Pure & deterministic.
 */
export function foodVacuoleSize(t: number, seedPhase: number, params: CellParams): number {
  const period = Math.max(0.1, params.foodVacuoleDigestPeriod ?? 30);
  const u = (((t / period + seedPhase) % 1) + 1) % 1; // [0,1)
  // full when fresh (u=0), shrinks to ~0.3 by u->1, then resets at the wrap.
  return 1 - 0.7 * u;
}

/**
 * Commit 28 — deterministic scatter of `foodVacuoleCount` food vacuoles as
 * BODY-FRAME offsets within `foodVacuoleMaxRadiusFrac*baseR` (a bit deeper than
 * granules), each with a per-vacuole digest `phase` in [0,1) from a third
 * decorrelated noise seed. Returns [] when the gate is off or the count is 0.
 * Pure & deterministic.
 */
export function seedFoodVacuoles(
  baseR: number,
  params: CellParams,
): Array<{ x: number; y: number; phase: number }> {
  if (!params.enableOrganelles) return [];
  const n = Math.max(0, Math.floor(params.foodVacuoleCount ?? 0));
  if (n === 0) return [];
  const maxRad = Math.max(0, params.foodVacuoleMaxRadiusFrac ?? 0.62) * Math.max(0, baseR);
  const out: Array<{ x: number; y: number; phase: number }> = [];
  for (let i = 0; i < n; i++) {
    const ang = (noise2D(i * 17.413 + 3.1, 52.917) + 1) * Math.PI; // [0, 2PI]
    // sqrt of a [0,1] sample -> area-uniform fill of the disc.
    const rad = Math.sqrt((noise2D(i * 44.197 + 9.7, 23.671) + 1) * 0.5) * maxRad;
    // third decorrelated seed -> digest phase in [0,1).
    const phase = (noise2D(i * 61.829 + 2.3, 88.541) + 1) * 0.5;
    out.push({ x: rad * Math.cos(ang), y: rad * Math.sin(ang), phase });
  }
  return out;
}

/**
 * Commit 32d — seed `count` food vacuoles in BODY-NORMALISED loop coords so they
 * ride the SAME divergence-free cyclosis loop as the granules (cyclosisLoopPoint)
 * and circulate through the elongated body to the poles, drawn via interiorPoint
 * (coupled to the deforming wall). Each vacuole gets a loop label `q`, an initial
 * loop phase `phi0`, and a per-vacuole `digestPhase` for foodVacuoleSize's shrink
 * curve. REUSES the EXACT decorrelated noise seed constants the legacy
 * seedFoodVacuoles used (17.413/52.917, 44.197/23.671, 61.829/88.541) so the
 * vacuole RNG stream stays familiar/decorrelated from the granule stream. Pure &
 * deterministic; returns [] when count is 0.
 */
export function seedInteriorFoodVacuoles(
  count: number,
  params: CellParams,
): Array<{ q: number; phi0: number; digestPhase: number }> {
  // params is part of the public signature for symmetry with the granule seeder
  // (future profile-aware seeding); the loop coords here are profile-independent.
  void params;
  const n = Math.max(0, Math.floor(count));
  const out: Array<{ q: number; phi0: number; digestPhase: number }> = [];
  for (let i = 0; i < n; i++) {
    const xi_q = (noise2D(i * 17.413 + 3.1, 52.917) + 1) * 0.5; // [0,1] loop label
    const xi_p = (noise2D(i * 44.197 + 9.7, 23.671) + 1) * 0.5; // [0,1] initial loop phase
    const xi_d = (noise2D(i * 61.829 + 2.3, 88.541) + 1) * 0.5; // [0,1] digest phase
    out.push({ q: xi_q, phi0: xi_p * TAU, digestPhase: xi_d });
  }
  return out;
}

/**
 * Commit 28 — advance one food vacuole's BODY-FRAME offset by the SAME cyclosis
 * rotation field as the granules, with omega = TAU / max(0.1,
 * foodVacuolePeriod). The radius is renormalised back to its prior magnitude so
 * the vacuole stays exactly on its circle (no spiral-out), clamped to
 * foodVacuoleMaxRadiusFrac*baseR. `phase` (the digest clock) is carried through
 * unchanged. Pure & deterministic.
 */
export function advectFoodVacuole(
  v: { x: number; y: number; phase: number },
  baseR: number,
  dt: number,
  params: CellParams,
): { x: number; y: number; phase: number } {
  const omega = TAU / Math.max(0.1, params.foodVacuolePeriod ?? 55);
  const nx = v.x - omega * v.y * dt;
  const ny = v.y + omega * v.x * dt;
  const maxRad = Math.max(0, params.foodVacuoleMaxRadiusFrac ?? 0.62) * Math.max(0, baseR);
  const r0 = Math.min(Math.hypot(v.x, v.y), maxRad);
  const r1 = Math.hypot(nx, ny) || 1;
  const s = r0 / r1;
  return { x: nx * s, y: ny * s, phase: v.phase };
}

/**
 * Commit 28 — the micronucleus sits just BESIDE (outside) the macronucleus. Its
 * radius is `macroR * micronucleusSizeFrac` (smaller) and its centre is offset
 * from the macronucleus centre by `macroR * micronucleusOffsetFrac` along a FIXED
 * bearing (deterministic). Returns the ABSOLUTE centre + radius so the caller can
 * draw it around the already-squeezed macronucleus centre. Pure.
 */
export function micronucleusTransform(
  macroCx: number,
  macroCy: number,
  macroR: number,
  params: CellParams,
): { cx: number; cy: number; r: number } {
  const r = macroR * (params.micronucleusSizeFrac ?? 0.32);
  const off = macroR * (params.micronucleusOffsetFrac ?? 1.15);
  const bearing = 0.7; // fixed, deterministic — sits just beside the macronucleus
  return {
    cx: macroCx + Math.cos(bearing) * off,
    cy: macroCy + Math.sin(bearing) * off,
    r,
  };
}
