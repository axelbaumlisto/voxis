// src/theme-engine/renderers/bars.ts
/**
 * createBarsRenderer — vanilla-DOM port of ClassicBars.tsx (Winamp-style
 * gradient spectrum bars with peak-hold ticks). No React, no RAF: update()
 * is called on every spectrum event, which is the frame clock.
 *
 * SRP: only DOM rendering of bars; smoothing math lives in smoothing.ts.
 */
import { createSmoother } from "./smoothing";
import type { ThemeState } from "../contract";
import type { Renderer } from "./types";

export interface BarsGradient {
  bottom: string;
  middle: string;
  top: string;
}

export interface BarsOptions {
  gradient: BarsGradient;
  barCount?: number;       // default 16
  maxHeight?: number;      // default 32
  gap?: number;            // default 1
  peakDecay?: number;      // default 0.96 (peak ticks), 0 disables
  smoothingAlpha?: number; // default 0.3
}

export type { Renderer } from "./types";

const DEFAULT_BAR_COUNT = 16;
const DEFAULT_MAX_HEIGHT = 32;
const DEFAULT_GAP = 1;
const DEFAULT_PEAK_DECAY = 0.96;
const DEFAULT_SMOOTHING_ALPHA = 0.3;
const MIN_HEIGHT_PX = 2;
const PEAK_HEIGHT_PX = 2;

/** Height formula ported from ClassicBars: soft power-curve compression. */
function barHeight(v: number, maxHeight: number): number {
  const clamped = Math.max(0, Math.min(1, v));
  const range = Math.max(0, maxHeight - MIN_HEIGHT_PX);
  return Math.min(maxHeight, MIN_HEIGHT_PX + Math.pow(clamped, 0.7) * range);
}

/** Bottom (0%) → middle (50%) → top (100%), fill grows upwards. */
function gradientCss(g: BarsGradient): string {
  return `linear-gradient(to top, ${g.bottom} 0%, ${g.middle} 50%, ${g.top} 100%)`;
}

/** Nearest-neighbour resampling from source bins to barCount. */
function resample(src: number[], count: number): number[] {
  return new Array(count).fill(0).map((_, i) => {
    if (src.length === 0) return 0;
    const srcIdx = Math.min(src.length - 1, Math.floor((i / count) * src.length));
    return src[srcIdx] ?? 0;
  });
}

export function createBarsRenderer(container: HTMLElement, opts: BarsOptions): Renderer {
  const barCount = opts.barCount ?? DEFAULT_BAR_COUNT;
  const maxHeight = opts.maxHeight ?? DEFAULT_MAX_HEIGHT;
  const gap = opts.gap ?? DEFAULT_GAP;
  const peakDecay = opts.peakDecay ?? DEFAULT_PEAK_DECAY;
  const smoothingAlpha = opts.smoothingAlpha ?? DEFAULT_SMOOTHING_ALPHA;

  const smoother = createSmoother({ size: barCount, alpha: smoothingAlpha, peakDecay: 1.0 });
  // Peak-hold state in normalized [0,1] units (instant rise, decay on fall).
  const peaks = new Array<number>(barCount).fill(0);

  const bg = gradientCss(opts.gradient);

  const root = document.createElement("div");
  root.className = "classic-bars";
  Object.assign(root.style, {
    display: "flex",
    alignItems: "end",
    justifyContent: "space-between",
    width: "100%",
    height: `${maxHeight + 4}px`,
    gap: `${gap}px`,
    overflow: "hidden",
  });

  const barEls: HTMLElement[] = [];
  const peakEls: HTMLElement[] = [];

  for (let i = 0; i < barCount; i++) {
    const col = document.createElement("div");
    col.className = "classic-bar-col";
    Object.assign(col.style, {
      position: "relative",
      flex: "1 1 0",
      minWidth: "2px",
      height: `${maxHeight}px`,
      display: "flex",
      alignItems: "end",
    });

    const bar = document.createElement("div");
    bar.className = "classic-bar";
    Object.assign(bar.style, {
      width: "100%",
      maxHeight: `${maxHeight}px`,
      minHeight: `${MIN_HEIGHT_PX}px`,
      height: `${MIN_HEIGHT_PX}px`,
      background: bg,
      borderRadius: "1px",
      transition: "height 60ms ease-out, opacity 120ms ease-out",
    });

    const peak = document.createElement("div");
    peak.className = "classic-bar-peak";
    Object.assign(peak.style, {
      position: "absolute",
      bottom: "0px",
      left: "0",
      right: "0",
      height: `${PEAK_HEIGHT_PX}px`,
      background: opts.gradient.top,
      borderRadius: "1px",
      pointerEvents: "none",
      display: "none",
    });

    col.appendChild(bar);
    col.appendChild(peak);
    root.appendChild(col);
    barEls.push(bar);
    peakEls.push(peak);
  }

  container.appendChild(root);

  return {
    update(state: ThemeState): void {
      const resampled = resample(state.spectrumBins ?? [], barCount);
      const heights = smoother.push(resampled);

      for (let i = 0; i < barCount; i++) {
        const v = heights[i] ?? 0;
        const barPx = barHeight(v, maxHeight);
        barEls[i].style.height = `${barPx}px`;

        // Peak hold: instant rise, multiplicative decay per update.
        const prev = peaks[i];
        peaks[i] = v >= prev ? v : prev * peakDecay;
        const peakPx = barHeight(peaks[i], maxHeight);
        const showPeak = peakDecay > 0 && peakPx > barPx + 1;
        peakEls[i].style.display = showPeak ? "block" : "none";
        if (showPeak) {
          peakEls[i].style.bottom = `${peakPx}px`;
        }
      }
    },
    destroy(): void {
      container.innerHTML = "";
    },
  };
}
