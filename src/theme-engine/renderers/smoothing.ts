// src/theme-engine/renderers/smoothing.ts
/** Frame-to-frame exponential smoothing + peak hold (ported from useSmoothBars). */
export interface SmootherOptions {
  size: number;
  alpha: number;
  peakDecay: number;
}

export interface Smoother {
  push(input: number[]): number[];
}

export function createSmoother({ size, alpha, peakDecay }: SmootherOptions): Smoother {
  const a = Math.max(0, Math.min(1, alpha));
  const decay = Math.max(0, Math.min(1, peakDecay));
  let smoothed = new Array<number>(size).fill(0);
  let peak = new Array<number>(size).fill(0);
  return {
    push(input: number[]): number[] {
      smoothed = smoothed.map((prev, i) => {
        const target = i < input.length ? Number(input[i]) || 0 : 0;
        return prev * (1 - a) + target * a;
      });
      if (decay >= 1.0) {
        peak = smoothed.slice();
        return smoothed.slice();
      }
      peak = peak.map((p, i) => Math.max(p * decay, smoothed[i]));
      return smoothed.map((s, i) => Math.max(s, peak[i]));
    },
  };
}
