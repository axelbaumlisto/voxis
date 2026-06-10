/**
 * Pure-function geometry for the organic ring overlay.
 *
 * Original math ported from the now-removed egui overlay binary. Two
 * implementations of the same math live side-by-side:
 *   • Rust ring.rs   → subprocess (egui) overlay backend
 *   • TypeScript    → webview (canvas) overlay backend (this file)
 *
 * Keep both files in lockstep when changing formulas — the Rust test set in
 * `ring.rs::tests` and the TS test set in `__tests__/ringGeometry.test.ts`
 * cover the same contracts and should both stay green.
 *
 * SOLID / DRY / KISS:
 * - SRP: this module is math only; no DOM/canvas/React side effects.
 * - DRY: shapes/motions types reused from auto-generated bindings.
 * - KISS: each function is a small numeric kernel mirroring its Rust twin.
 */
export interface OrganicRingShape {
  gap_degrees: number;
  base_thickness: number;
  taper: number;
  roundness: number;
  active_zones: number;
}

export interface OrganicRingMotion {
  idle_breathing: number;
  speech_responsiveness: number;
  drift: number;
  settle_speed: number;
}

export interface OrganicRingTheme {
  shape: OrganicRingShape;
  motion: OrganicRingMotion;
}

export type OverlayMode = "idle" | "recording" | "transcribing" | "error";

const TAU = Math.PI * 2;

/**
 * Base ring radius for a given window. The webview overlay targets a single
 * "Small" size class (≤250×60 or ≤400×100 host); we always use `min(w,h)*0.34`
 * directly, mirroring the Rust `SizeConfig::Small` branch.
 */
export function organicBaseRadius(width: number, height: number): number {
  return Math.min(width, height) * 0.34;
}

/**
 * Returns `true` when the sample angle falls inside the visual ring gap.
 * `gapDegrees` describes the total gap width; we reject `|angle| < gap/2`.
 */
export function applyRingGap(angle: number, gapDegrees: number): boolean {
  const halfGapRad = (gapDegrees * Math.PI) / 180 / 2;
  return Math.abs(angle) < halfGapRad;
}

/**
 * Per-frame state energy that drives oscillation amplitude. Matches
 * `ring.rs::ring_state_energy` with `Queued` collapsed into `Transcribing`
 * (webview surface has no Queued mode).
 */
export function ringStateEnergy(
  mode: OverlayMode,
  speechEnergy: number,
  animationTime: number,
  motion: OrganicRingMotion,
): number {
  switch (mode) {
    case "idle":
      return motion.idle_breathing * (1.0 + Math.sin(animationTime * 0.8) * 0.25);
    case "recording": {
      const v = motion.idle_breathing + speechEnergy * motion.speech_responsiveness * 1.18;
      return Math.max(0, Math.min(1, v));
    }
    case "transcribing": {
      const v = motion.idle_breathing * 0.72 + speechEnergy * 0.12;
      return Math.max(0, Math.min(1, v));
    }
    case "error":
      // Error mode borrows idle dynamics; the visual layer typically swaps the
      // geometry path entirely (ErrorSpectrum) so this is mostly defensive.
      return motion.idle_breathing;
  }
}

/**
 * Spectrum-driven oscillation factor for a given ring angle. Matches
 * `ring.rs::ring_oscillation`.
 */
export function ringOscillation(
  angle: number,
  bins: number[],
  animationTime: number,
  stateEnergy: number,
  activeZones: number,
  drift: number,
): number {
  const len = bins.length;
  // (angle + π/2) wrapped to [0, 2π), normalized to [0, 1).
  const normalized = (((angle + Math.PI / 2) % TAU) + TAU) % TAU / TAU;
  const idx = len === 0 ? 0 : Math.min(Math.floor(normalized * len), len - 1);
  const level = len === 0 ? 0 : bins[idx];

  let wave = 0;
  const zones = Math.max(1, activeZones);
  for (let zone = 0; zone < zones; zone++) {
    const phase = animationTime * (0.4 + zone * 0.17) + zone * 1.3;
    wave += Math.sin(normalized * TAU * (zone + 1) + phase);
  }
  wave /= zones;

  const v = wave * (0.35 + level * 0.65) * (stateEnergy + drift * 0.2);
  return Math.max(-1, Math.min(1, v));
}

/**
 * Stroke width at a given angle. Matches `ring.rs::ring_stroke_width`.
 * The taper-wave shape modulates thickness around the ring; the clamp
 * `>= 1` keeps the line visible even at the thinnest point.
 */
export function ringStrokeWidth(angle: number, shape: OrganicRingShape): number {
  const normalized = (((angle + Math.PI / 2) % TAU) + TAU) % TAU / TAU;
  const taperWave = Math.pow(
    Math.sin(normalized * TAU) * 0.5 + 0.5,
    1.0 + shape.taper,
  );
  return Math.max(1, shape.base_thickness * (0.45 + taperWave * 0.55));
}

/**
 * Sample the ring around 360° (120 samples) and return the points to stroke,
 * skipping samples that fall inside the gap. Mirrors
 * `ring.rs::build_ring_points`.
 */
export function buildRingPoints(
  width: number,
  height: number,
  bins: number[],
  animationTime: number,
  speechEnergy: number,
  theme: OrganicRingTheme,
  mode: OverlayMode,
): Array<[number, number]> {
  const sampleCount = 120;
  const cx = width / 2;
  const cy = height / 2;
  const baseRadius = organicBaseRadius(width, height);
  const stateEnergy = ringStateEnergy(mode, speechEnergy, animationTime, theme.motion);

  const out: Array<[number, number]> = [];
  for (let i = 0; i < sampleCount; i++) {
    const angle = -Math.PI / 2 + (i / sampleCount) * TAU;
    if (applyRingGap(angle, theme.shape.gap_degrees)) continue;

    const oscillation = ringOscillation(
      angle,
      bins,
      animationTime,
      stateEnergy,
      theme.shape.active_zones,
      theme.motion.drift,
    );

    const pulseMultiplier =
      mode === "transcribing" ? 1.0 + Math.sin(animationTime * 4.2) * 0.12 : 1.0;

    const radius = Math.max(
      baseRadius * 0.6,
      baseRadius * pulseMultiplier * (1.0 + oscillation * 0.51),
    );

    out.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  return out;
}
