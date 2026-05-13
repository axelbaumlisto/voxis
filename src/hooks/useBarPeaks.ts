/**
 * useBarPeaks — Winamp-style peak-hold-and-decay.
 *
 * Classic Winamp spectrum analyzer behavior:
 *  - Each bar has its own "peak" indicator (thin tick at the top).
 *  - Peak snaps INSTANTLY upward to follow rising audio.
 *  - When audio drops, peak falls at a CONSTANT rate (gravity), NOT
 *    proportional to amplitude. This makes peaks "hang" briefly,
 *    making the visualizer feel alive even during silence.
 *
 * Distinct from `useSmoothBars` (which smooths the audio itself).
 * This hook decorates the SAME smoothed bars with a slower trailing
 * peak indicator for rendering.
 *
 * SRP: only computes peak[i] from bars[i]; no rendering, no DOM.
 * KISS: requestAnimationFrame loop with a ref-snapshot of inputs
 *       (avoids re-binding the loop on every prop tick).
 */
import { useEffect, useRef, useState } from "react";

export function useBarPeaks(
  bars: number[],
  decayPerFrame: number,
): number[] {
  // Snapshot props through refs so the RAF loop doesn't re-bind on every
  // render (would cancel/recreate, causing visible jitter).
  const barsRef = useRef(bars);
  const decayRef = useRef(decayPerFrame);
  barsRef.current = bars;
  decayRef.current = decayPerFrame;

  const [peaks, setPeaks] = useState<number[]>(() => bars.slice());

  useEffect(() => {
    let cancelled = false;
    let rafId = 0;

    const tick = () => {
      if (cancelled) return;
      setPeaks((prev) => {
        const input = barsRef.current;
        const decay = decayRef.current;
        const len = input.length;
        const next = new Array<number>(len);
        let dirty = prev.length !== len;
        for (let i = 0; i < len; i++) {
          const bar = input[i] ?? 0;
          const old = prev[i] ?? 0;
          // Instant rise, linear decay clamped at 0.
          const v = bar >= old ? bar : Math.max(0, old - decay);
          if (!dirty && Math.abs(v - old) > 1e-6) dirty = true;
          next[i] = v;
        }
        return dirty ? next : prev;
      });
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, []);

  return peaks;
}
