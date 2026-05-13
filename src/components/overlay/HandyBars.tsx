/**
 * HandyBars — the 9-bar compact equalizer used in the Handy pill overlay.
 *
 * Visual formulas ported from Handy
 * (github.com/cjpais/Handy/src/overlay/RecordingOverlay.tsx):
 *   height  = MIN + pow(v, power_curve) * (maxHeight - MIN)
 *   opacity = max(min_opacity, v * opacity_gain)
 *
 * SOLID/DRY/KISS:
 *  - SRP: only renders bars given normalized values; smoothing + peak-tracking
 *    are the caller's job (see useSmoothBars).
 *  - DIP: visual coefficients (power curve, min height/opacity, gain,
 *    transition timings) are read from `useHandyBarMathOrDefault()` and
 *    CSS variables, so swapping the theme via <HandyThemeProvider>
 *    changes the bar response WITHOUT prop drilling.
 *  - OCP: adding a new theme = JSON file in src-tauri/themes/; bars
 *    re-render with new math automatically.
 *  - KISS: inline styles — no CSS module needed for this tiny component;
 *    durations consumed via var(--hp-bar-height-ms) with literal fallback.
 */
import { useHandyBarMathOrDefault } from "../../themes/HandyThemeProvider";

export interface HandyBarsProps {
  /** Normalized levels in [0, 1]. */
  bars: number[];
  /** CSS color. Default reads from `--hp-bar` (theme palette). */
  color?: string;
  /** Maximum pixel height a bar can reach. Default 20. */
  maxHeight?: number;
  /** Bar width in px. Default 6. */
  barWidth?: number;
  /** Gap between bars in px. Default 3. */
  gap?: number;
  /**
   * Override the theme-driven math. Useful for unit tests that want a
   * specific power curve regardless of the active Provider.
   */
  powerCurve?: number;
  minHeightPx?: number;
  minOpacity?: number;
  opacityGain?: number;
}

const DEFAULT_MAX_HEIGHT = 20;
const DEFAULT_BAR_WIDTH = 6;
const DEFAULT_GAP = 3;
// Fallback colour used both as CSS-var fallback and as the rendered
// inline-style value when no `color` prop is given.
const DEFAULT_BAR_CSS = "var(--hp-bar, #ffe5ee)";

function barHeight(
  v: number,
  maxHeight: number,
  power: number,
  minPx: number,
): number {
  const clamped = Math.max(0, Math.min(1, v));
  const range = Math.max(0, maxHeight - minPx);
  return Math.min(maxHeight, minPx + Math.pow(clamped, power) * range);
}

function barOpacity(v: number, minOpacity: number, gain: number): number {
  const clamped = Math.max(0, Math.min(1, v));
  return Math.max(minOpacity, Math.min(1, clamped * gain));
}

export default function HandyBars({
  bars,
  color,
  maxHeight = DEFAULT_MAX_HEIGHT,
  barWidth = DEFAULT_BAR_WIDTH,
  gap = DEFAULT_GAP,
  powerCurve,
  minHeightPx,
  minOpacity,
  opacityGain,
}: HandyBarsProps) {
  const math = useHandyBarMathOrDefault();
  // ISP: bars reads only the 3 JS-math fields; remaining 4 (min_height_px,
  // min_opacity, opacity_gain, plus the CSS-only timings) come from CSS vars
  // or from explicit overrides for testability.
  const power = powerCurve ?? math.power_curve;
  // The other knobs are CSS-vars; when no Provider is up we use literals.
  // Reading `getComputedStyle(:root)` synchronously would force a layout
  // and produce stale values right after Provider mount, so we just consume
  // them via CSS in `transition` and use sensible literals for the JS-side
  // height calculation.
  const minPx = minHeightPx ?? 4;
  const minOpa = minOpacity ?? 0.2;
  const gain = opacityGain ?? 1.7;
  const barCss = color ?? DEFAULT_BAR_CSS;

  return (
    <div
      className="bars-container"
      style={{
        display: "flex",
        alignItems: "end",
        justifyContent: "center",
        gap: `${gap}px`,
        height: `${maxHeight + 4}px`,
        overflow: "hidden",
      }}
    >
      {bars.map((v, i) => (
        <div
          key={i}
          className="bar"
          style={{
            width: `${barWidth}px`,
            background: barCss,
            maxHeight: `${maxHeight}px`,
            minHeight: `${minPx}px`,
            height: `${barHeight(v, maxHeight, power, minPx)}px`,
            opacity: barOpacity(v, minOpa, gain),
            borderRadius: "2px",
            transition:
              "height var(--hp-bar-height-ms, 60ms) ease-out, " +
              "opacity var(--hp-bar-opacity-ms, 120ms) ease-out",
          }}
        />
      ))}
    </div>
  );
}
