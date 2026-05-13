/**
 * useSmoothBars — exponential smoothing + peak-decay tracker for bar levels.
 *
 * Two-stage output:
 *   1. smoothed[i] = prev_smoothed[i] * (1 - alpha) + input[i] * alpha     (Handy-style)
 *   2. peak[i]     = max(smoothed[i], prev_peak[i] * peak_decay)
 *   bars[i]        = max(smoothed[i], peak[i])
 *
 * When `peak_decay >= 1.0` the second stage is bypassed (no peak hold) —
 * output reduces to the historical Handy formula.
 *
 * Design (SOLID/DRY/KISS):
 *  - SRP: this hook owns ONLY level smoothing + peak tracking. No
 *    rendering, no event-bus subscription.
 *  - OCP: tuning is data (options object), not new code paths.
 *  - DIP: callers may pass `alpha` / `peak_decay` explicitly, or read
 *    them from the active theme via `useHandyBarMath()` upstream.
 *  - KISS: two `useRef` buffers; no kalman, no debounce.
 *  - DRY: any consumer that needs smoothed audio levels reuses this.
 */
import { useRef } from "react";

/** Tunable smoothing factor (exp avg). */
export const DEFAULT_SMOOTHING_ALPHA = 0.3;

/** `>= 1.0` means "no peak hold" — passthrough. */
export const DEFAULT_PEAK_DECAY = 1.0;

export interface UseSmoothBarsOptions {
  /** Output array length. Inputs are truncated or zero-padded to this size. */
  size: number;
  /**
   * Exponential moving average factor in [0, 1].
   * - 0 = frozen (input ignored)
   * - 1 = no smoothing (raw input passes through)
   * - default {@link DEFAULT_SMOOTHING_ALPHA} = 0.3 (Handy reference)
   */
  alpha?: number;
  /**
   * Peak tracker decay rate per render (0..1].
   * - 1.0 (default) disables peak hold; output == smoothed
   * - 0.95 = slowly falling peak (visible "memory" of recent peaks)
   * - 0.5  = aggressive — peak drops by 50 % each render
   */
  peak_decay?: number;
}

function makeZeros(n: number): number[] {
  return new Array(n).fill(0);
}

export function useSmoothBars(
  input: number[] | null | undefined,
  {
    size,
    alpha = DEFAULT_SMOOTHING_ALPHA,
    peak_decay = DEFAULT_PEAK_DECAY,
  }: UseSmoothBarsOptions,
): number[] {
  const smoothedRef = useRef<number[]>(makeZeros(size));
  const peakRef = useRef<number[]>(makeZeros(size));

  // Re-size both buffers if `size` prop changes (rare but supported).
  if (smoothedRef.current.length !== size) {
    smoothedRef.current = makeZeros(size);
    peakRef.current = makeZeros(size);
  }

  if (size === 0) {
    return [];
  }

  if (!Array.isArray(input)) {
    // Invalid payload — return current smoothed state unchanged.
    return smoothedRef.current.slice();
  }

  const a = Math.max(0, Math.min(1, alpha));
  const decay = Math.max(0, Math.min(1, peak_decay));
  const usePeakTracker = decay < 1.0;

  const nextSmoothed = smoothedRef.current.map((prev, i) => {
    const target = i < input.length ? Number(input[i]) || 0 : 0;
    return prev * (1 - a) + target * a;
  });
  smoothedRef.current = nextSmoothed;

  if (!usePeakTracker) {
    // Fast path: peak hold disabled, output is plain smoothed.
    peakRef.current = nextSmoothed.slice();
    return nextSmoothed.slice();
  }

  const nextPeak = peakRef.current.map((prevPeak, i) => {
    const decayed = prevPeak * decay;
    return Math.max(decayed, nextSmoothed[i]);
  });
  peakRef.current = nextPeak;

  return nextSmoothed.map((s, i) => Math.max(s, nextPeak[i]));
}
