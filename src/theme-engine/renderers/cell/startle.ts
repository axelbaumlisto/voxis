import { noise2D } from "../shared";
import type { CellParams } from "./types";

/**
 * Startle reflex magnitude (the cell "darts" on a sharp audio onset).
 *
 * Detects a rising edge as (level - baseline) scaled by `sensitivity`; the new
 * magnitude is the MAX of the decayed previous magnitude and this fresh edge,
 * so a jolt rises instantly and then springs back via `decay` (per-frame factor
 * in [0,1], e.g. 0.85). Clamped to [0,1]. Pure & deterministic.
 *
 * The renderer converts magnitude → a small (dx,dy) using a noise-chosen angle.
 */
export function startleOffset(
  prevMag: number,
  level: number,
  baseline: number,
  sensitivity: number,
  decay: number,
): number {
  const edge = Math.max(0, (level - baseline) * sensitivity);
  const decayed = prevMag * Math.max(0, Math.min(1, decay));
  return Math.max(0, Math.min(1, Math.max(decayed, edge)));
}

/**
 * H1/M8 — startle as a low-Reynolds ESCAPE DART, not a mass-spring shove.
 * A real ciliate startled by a stimulus performs an avoidance reaction: it
 * changes direction and darts away. We model that as (1) a HEADING KICK on the
 * fresh onset of startle (a rising edge), and (2) a transient SPEED BURST while
 * startled (see `startleBurstSpeed`). This replaces the old positional (dx,dy)
 * centre offset, which implied inertia (dart-and-spring-back) and wrongly shoved
 * the cell even when idle/centred (M8).
 *
 * Returns the heading delta (radians) to apply THIS frame: a noise-chosen escape
 * angle on a rising edge (`startle - prevStartle > threshold`), else 0. Pure.
 */
export function startleHeadingKick(
  startle: number,
  prevStartle: number,
  t: number,
  params: CellParams,
): number {
  const rising = startle - prevStartle;
  if (rising <= (params.startleKickThreshold ?? 0.12)) return 0;
  // Escape angle in [-kickMax, +kickMax], chosen by slow noise so successive
  // darts pick different but deterministic directions.
  return noise2D(811.3, t * 1.7) * (params.startleKickMax ?? 1.2);
}

/**
 * H1 — transient swim-speed burst while startled (px/sec). Memoryless: it scales
 * with the current startle magnitude, so as startle decays the burst fades with
 * it (no coasting). Added on top of the activity-driven swim speed. Pure.
 */
export function startleBurstSpeed(
  startle: number,
  baseR: number,
  params: CellParams,
): number {
  const s = startle < 0 ? 0 : startle > 1 ? 1 : startle;
  return s * (params.startleBurstFrac ?? 0.5) * baseR;
}
