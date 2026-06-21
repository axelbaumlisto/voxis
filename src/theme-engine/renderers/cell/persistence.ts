import type { CellParams } from "./types";
import { cellReach } from "./sizing";

export interface CellPersistState {
  driftPhase: number;
  growth: number;
  elapsed: number;
  /** M4/M5: persisted wander pose. Position is stored as a FRACTION of the tank
   * (fx=x/width, fy=y/height) so it stays meaningful across resizes (M5). All
   * three are optional for back-compat with legacy v1 payloads (no pose). */
  fx?: number;
  fy?: number;
  heading?: number;
}

export function serializeCellState(s: CellPersistState): string {
  return JSON.stringify(s);
}

export function parseCellState(raw: string | null): CellPersistState | null {
  if (raw === null) return null;
  try {
    const obj = JSON.parse(raw);
    if (
      typeof obj !== "object" ||
      obj === null ||
      typeof obj.driftPhase !== "number" ||
      !Number.isFinite(obj.driftPhase) ||
      typeof obj.growth !== "number" ||
      !Number.isFinite(obj.growth) ||
      typeof obj.elapsed !== "number" ||
      !Number.isFinite(obj.elapsed)
    ) {
      return null;
    }
    // Reject absurd-but-finite values that could freeze/break animation
    if (obj.elapsed < 0 || obj.elapsed >= 1e7) return null;
    if (obj.driftPhase < -1e7 || obj.driftPhase > 1e7) return null;
    const base: CellPersistState = { driftPhase: obj.driftPhase, growth: obj.growth, elapsed: obj.elapsed };
    // M4/M5: attach the pose ONLY if all three fields are present, finite and in
    // range. A corrupt/partial pose is dropped (base state still restores), so a
    // bad fraction can never teleport the cell out of bounds.
    if (
      typeof obj.fx === "number" && Number.isFinite(obj.fx) && obj.fx >= 0 && obj.fx <= 1 &&
      typeof obj.fy === "number" && Number.isFinite(obj.fy) && obj.fy >= 0 && obj.fy <= 1 &&
      typeof obj.heading === "number" && Number.isFinite(obj.heading) &&
      obj.heading > -1e4 && obj.heading < 1e4
    ) {
      base.fx = obj.fx;
      base.fy = obj.fy;
      base.heading = obj.heading;
    }
    return base;
  } catch {
    return null;
  }
}

/**
 * Compute initial `startedAt` and `driftPhaseOffset` from a persisted
 * cell state so that the first rendered frame's drift-phase argument
 * (`t + driftPhaseOffset`) continues seamlessly from the saved phase.
 *
 * Pure & exported for testability.
 *
 * @param saved  Parsed persistence state from localStorage.
 * @param now    Current `performance.now()` value at restore time (ms).
 */
export function restoreSeed(
  saved: CellPersistState,
  now: number,
): { startedAt: number; driftPhaseOffset: number } {
  const elapsed = saved.elapsed > 0 ? saved.elapsed : 0;
  return {
    startedAt: now - elapsed * 1000,
    driftPhaseOffset: saved.driftPhase - elapsed,
  };
}

/**
 * M4/M5 — reconstruct a wander pose (pixel x/y + heading) from a persisted
 * state. Position is stored as a FRACTION of the tank, so we re-derive it
 * against the CURRENT width/height (resize-safe) and clamp it into the wander
 * inset (same `max(driftMargin, cellReach)` the wander itself uses) so a saved
 * near-wall fraction can never start the cell out of bounds. Returns null when
 * the saved state carries no pose (legacy payload). Pure & deterministic.
 */
export function wanderPoseFromState(
  saved: CellPersistState,
  width: number,
  height: number,
  baseR: number,
  params: CellParams,
): { x: number; y: number; heading: number } | null {
  if (saved.fx === undefined || saved.fy === undefined || saved.heading === undefined) {
    return null;
  }
  const reach = cellReach(baseR, params);
  const inset = Math.max(params.driftMargin ?? 4, reach);
  const clamp = (v: number, lo: number, hi: number) =>
    lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v));
  return {
    x: clamp(saved.fx * width, inset, width - inset),
    y: clamp(saved.fy * height, inset, height - inset),
    heading: saved.heading,
  };
}

/**
 * M5 — persistence key namespaced by tank size so a state saved for one overlay
 * geometry (e.g. the 160x160 square overlay) is never loaded into another (e.g.
 * the 172x36 harness strip), which would restore a nonsensical pose.
 */
export function cellPersistKey(width: number, height: number): string {
  return `talri.cell.state.v2.${Math.round(width)}x${Math.round(height)}`;
}
