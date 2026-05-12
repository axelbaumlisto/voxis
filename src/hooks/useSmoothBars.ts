/**
 * useSmoothBars — exponential smoothing of bar levels.
 *
 * Mirrors the smoothing Handy applies in RecordingOverlay.tsx:
 *   smoothed[i] = prev[i] * (1 - alpha) + input[i] * alpha
 *
 * SRP: pure smoothing only; layout/styling lives in HandyBars/HandyPill.
 * KISS: useRef to persist the smoothed buffer across renders; no debouncing,
 *       no double-buffering, no kalman.
 * DRY: any caller that wants a sliding smoothed array of fixed size can reuse.
 */
import { useRef } from "react";

export interface UseSmoothBarsOptions {
  /** Output array length. Inputs are truncated or zero-padded to this size. */
  size: number;
  /** Smoothing factor in [0, 1]. 0 = frozen, 1 = no smoothing. Default 0.3 (Handy). */
  alpha?: number;
}

function makeZeros(n: number): number[] {
  return new Array(n).fill(0);
}

export function useSmoothBars(
  input: number[] | null | undefined,
  { size, alpha = 0.3 }: UseSmoothBarsOptions,
): number[] {
  const bufferRef = useRef<number[]>(makeZeros(size));

  // Re-size the buffer if `size` prop changes (rare but supported).
  if (bufferRef.current.length !== size) {
    bufferRef.current = makeZeros(size);
  }

  if (size === 0) {
    return [];
  }

  if (!Array.isArray(input)) {
    // Invalid payload — return current smoothed state unchanged.
    return bufferRef.current.slice();
  }

  const a = Math.max(0, Math.min(1, alpha));
  const next = bufferRef.current.map((prev, i) => {
    const target = i < input.length ? Number(input[i]) || 0 : 0;
    return prev * (1 - a) + target * a;
  });
  bufferRef.current = next;
  return next.slice();
}
