/**
 * ClassicBars — Winamp-style spectrum analyzer (full-width, gradient bars).
 *
 * Distinct from {@link HandyBars}:
 *  - 16+ bars (vs Handy's 9), denser EQ look
 *  - Per-bar vertical gradient (bottom→middle→top) driven by the active
 *    theme's `gradient` colors (low amplitude shows the bottom color,
 *    peak shows the top color)
 *  - No icon / no cancel; fills the canvas
 *  - Same animation timings as HandyBars (CSS variables from the theme)
 *
 * SOLID/DRY/KISS:
 *  - SRP: only renders bars; smoothing + peak-decay live in `useSmoothBars`.
 *  - DRY: animation timings consumed via `--hp-bar-height-ms` / `--hp-bar-opacity-ms`
 *         CSS variables published by {@link HandyThemeProvider}.
 *  - OCP: new gradient or count = data, no code change.
 *  - KISS: inline styles + CSS linear-gradient. No canvas, no RAF.
 */

export interface ClassicBarsGradient {
  bottom: string;
  middle: string;
  top: string;
}

import { useBarPeaks } from "../../hooks/useBarPeaks";

export interface ClassicBarsProps {
  /** Normalized levels in [0, 1]. Truncated to `barCount`. */
  bars: number[];
  /** Per-bar vertical gradient (Winamp-style). */
  gradient: ClassicBarsGradient;
  /** Number of bars rendered. Default 16. */
  barCount?: number;
  /** Max pixel height a bar can reach. Default 32 (pill is 36 high with 4 px gutter). */
  maxHeight?: number;
  /** Pixel gap between bars. Default 1. */
  gap?: number;
  /**
   * Linear decay per RAF frame for the peak indicator (in normalized
   * units, 0..1). Classic Winamp uses ~0.005-0.01 — a 0..1 peak takes
   * ~2 seconds to fall to zero. Set to 0 to disable peaks entirely.
   * Default 0.008.
   */
  peakDecay?: number;
  /** Pixel height of the peak tick. Default 2. */
  peakHeight?: number;
}

const DEFAULT_BAR_COUNT = 16;
const DEFAULT_MAX_HEIGHT = 32;
const DEFAULT_GAP = 1;
const MIN_HEIGHT_PX = 2;
const DEFAULT_PEAK_DECAY = 0.008;
const DEFAULT_PEAK_HEIGHT_PX = 2;

function barHeight(v: number, maxHeight: number): number {
  const clamped = Math.max(0, Math.min(1, v));
  const range = Math.max(0, maxHeight - MIN_HEIGHT_PX);
  // Slight power-curve for visible activity at low levels (Winamp also
  // applied a soft compression).
  return Math.min(maxHeight, MIN_HEIGHT_PX + Math.pow(clamped, 0.7) * range);
}

/**
 * CSS linear-gradient string. Bottom (0%) = `bottom`, middle (50%) =
 * `middle`, top (100%) = `top`. Inverting `to top` so the bar fill grows
 * "upwards" visually.
 */
function gradientCss(g: ClassicBarsGradient): string {
  return `linear-gradient(to top, ${g.bottom} 0%, ${g.middle} 50%, ${g.top} 100%)`;
}

export default function ClassicBars({
  bars,
  gradient,
  barCount = DEFAULT_BAR_COUNT,
  maxHeight = DEFAULT_MAX_HEIGHT,
  gap = DEFAULT_GAP,
  peakDecay = DEFAULT_PEAK_DECAY,
  peakHeight = DEFAULT_PEAK_HEIGHT_PX,
}: ClassicBarsProps) {
  // Resample / pad the input array to `barCount`. Simple nearest-neighbour
  // is sufficient at this scale; perceptual quality of Winamp-style bars
  // doesn't need a proper resampling filter.
  const heights = new Array(barCount).fill(0).map((_, i) => {
    if (bars.length === 0) return 0;
    const srcIdx = Math.min(
      bars.length - 1,
      Math.floor((i / barCount) * bars.length),
    );
    return bars[srcIdx] ?? 0;
  });
  // Peaks are computed in [0, 1] units alongside; rendered as a separate
  // tick above each bar (classic Winamp peak-hold-and-decay).
  const peaks = useBarPeaks(heights, peakDecay);

  const bg = gradientCss(gradient);

  return (
    <div
      className="classic-bars"
      style={{
        display: "flex",
        alignItems: "end",
        justifyContent: "space-between",
        width: "100%",
        height: `${maxHeight + 4}px`,
        gap: `${gap}px`,
        overflow: "hidden",
      }}
    >
      {heights.map((v, i) => {
        const barPx = barHeight(v, maxHeight);
        const peakV = peaks[i] ?? 0;
        const peakPx = barHeight(peakV, maxHeight);
        const showPeak = peakDecay > 0 && peakPx > barPx + 1;
        return (
          <div
            key={i}
            className="classic-bar-col"
            data-testid={`classic-bar-col-${i}`}
            style={{
              position: "relative",
              flex: "1 1 0",
              minWidth: "2px",
              height: `${maxHeight}px`,
              display: "flex",
              alignItems: "end",
            }}
          >
            <div
              className="classic-bar"
              style={{
                width: "100%",
                maxHeight: `${maxHeight}px`,
                minHeight: `${MIN_HEIGHT_PX}px`,
                height: `${barPx}px`,
                background: bg,
                borderRadius: "1px",
                // Timing themable: --hp-bar-height-ms / --hp-bar-opacity-ms
                // published by HandyThemeProvider.
                transition:
                  "height var(--hp-bar-height-ms, 60ms) ease-out, " +
                  "opacity var(--hp-bar-opacity-ms, 120ms) ease-out",
              }}
            />
            {showPeak && (
              <div
                className="classic-bar-peak"
                data-testid={`classic-bar-peak-${i}`}
                style={{
                  position: "absolute",
                  bottom: `${peakPx}px`,
                  left: 0,
                  right: 0,
                  height: `${peakHeight}px`,
                  background: `var(--hp-peak-color, ${gradient.top})`,
                  borderRadius: "1px",
                  pointerEvents: "none",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
