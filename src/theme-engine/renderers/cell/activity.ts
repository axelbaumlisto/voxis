type EnergySmoothingParams = {
  enableEnergySmoothing?: boolean;
  energySmoothTau?: number;
};

type ActivityParams = {
  activityEnergyWeight?: number;
  activityGrowthWeight?: number;
};

type CyclosisPeriodParams = {
  cyclosisPeriod?: number;
  cyclosisActivityBoost?: number;
};

/**
 * Energy level blending idle breathing with audio-driven activity.
 *
 * During idle: oscillates gently around `idle` using sin(t).
 * During recording: idle + audioLevel * levelGain.
 * During transcribing: faded idle + residual level.
 * During error: idle only.
 */
export function cellEnergy(
  mode: string,
  audioLevel: number,
  t: number,
  idle: number,
  levelGain: number,
): number {
  switch (mode) {
    case "idle":
      return idle * (1.0 + Math.sin(t * 0.8) * 0.25);
    case "recording":
      return Math.max(0, Math.min(1, idle + audioLevel * levelGain));
    case "transcribing":
      return Math.max(0, Math.min(1, idle * 0.72 + audioLevel * 0.12));
    case "error":
      return idle;
    default:
      return idle;
  }
}

/**
 * M6 — EMA-chase the (step-valued) energy target to kill the mode-change POP.
 * `cellEnergy` returns a different formula per mode, so at a mode flip (idle ->
 * recording -> transcribing -> idle) the raw energy jumps in one frame. We chase
 * it with a fast exponential `e += (target - e)*(1 - exp(-dt/tau))`, so the
 * change is C0 across the flip while staying responsive. tau is deliberately
 * SMALL (~0.08s) so the idle breathing sine (0.8 rad/s) passes through with <1%
 * attenuation — this smooths discontinuities, not the intended slow motion.
 * Gated by `enableEnergySmoothing` (default on); off => returns target verbatim
 * (byte-identical to pre-M6). Pure & frame-rate independent.
 */
export function smoothEnergy(
  prev: number,
  target: number,
  dt: number,
  params: EnergySmoothingParams,
): number {
  if (params.enableEnergySmoothing === false) return target;
  const tau = params.energySmoothTau ?? 0.08;
  if (tau <= 0) return target;
  const alpha = 1 - Math.exp(-Math.max(0, dt) / tau);
  return prev + (target - prev) * alpha;
}

/**
 * G1 — master ACTIVITY scalar `a ∈ [0,1]`. ONE coherent drive so that
 * audio → ciliary beat → swimming all share a single envelope. As of 8a it
 * drives the swim speed + beat frequency + curl; pseudopod/nucleus amplitude
 * are moved onto `a` in a later sub-commit (8c), after which raw `audioLevel`
 * is used for COLOR (iridescentHue) only. Weighted blend of instantaneous energy
 * (fast) and the smoothed growth accumulator (slow, asymmetric attack/release)
 * so the cell ramps up promptly but winds down gracefully. (plan G1.)
 *
 * Pure & deterministic.
 */
export function cellActivity(
  energy: number,
  growth: number,
  params?: ActivityParams,
): number {
  const we = params?.activityEnergyWeight ?? 0.6;
  const wg = params?.activityGrowthWeight ?? 0.4;
  const a = we * energy + wg * growth;
  return a < 0 ? 0 : a > 1 ? 1 : a;
}

/**
 * v3.7C — effective cyclosis period modulated by activity.
 * At rest (activity=0) returns the base `cyclosisPeriod`. At full activity
 * and `cyclosisActivityBoost=0.4` the period = base / 1.4 (40% faster).
 * Default boost=0 preserves legacy (no modulation). Pure & deterministic.
 */
export function effectiveCyclosisPeriod(
  activity: number,
  params: CyclosisPeriodParams,
): number {
  const base = Math.max(0.1, params.cyclosisPeriod ?? 45);
  const boost = params.cyclosisActivityBoost ?? 0;
  const a = activity < 0 ? 0 : activity > 1 ? 1 : activity;
  return Math.max(0.1, base / (1 + a * boost));
}
