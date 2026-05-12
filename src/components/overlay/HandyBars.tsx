/**
 * HandyBars \u2014 the 9-bar compact equalizer used in the Handy pill overlay.
 *
 * Visual formulas ported 1:1 from Handy
 * (github.com/cjpais/Handy/src/overlay/RecordingOverlay.tsx):
 *   height  = min(maxHeight, 4 + pow(v, 0.7) * (maxHeight - 4))
 *   opacity = max(0.2, v * 1.7)
 *
 * SRP: only renders bars given normalized values; smoothing is the caller's
 *      job (see useSmoothBars).
 * KISS: inline styles \u2014 no CSS module needed for this tiny component.
 */

export interface HandyBarsProps {
  /** Normalized levels in [0, 1]. */
  bars: number[];
  /** CSS color. Default `#ffe5ee` (Handy light pink). */
  color?: string;
  /** Maximum pixel height a bar can reach. Default 20. */
  maxHeight?: number;
  /** Bar width in px. Default 6. */
  barWidth?: number;
  /** Gap between bars in px. Default 3. */
  gap?: number;
}

const DEFAULT_COLOR = "#ffe5ee";
const DEFAULT_MAX_HEIGHT = 20;
const DEFAULT_BAR_WIDTH = 6;
const DEFAULT_GAP = 3;
const MIN_HEIGHT_PX = 4;

function barHeight(v: number, maxHeight: number): number {
  const clamped = Math.max(0, Math.min(1, v));
  const range = maxHeight - MIN_HEIGHT_PX;
  return Math.min(maxHeight, MIN_HEIGHT_PX + Math.pow(clamped, 0.7) * range);
}

function barOpacity(v: number): number {
  const clamped = Math.max(0, Math.min(1, v));
  return Math.max(0.2, Math.min(1, clamped * 1.7));
}

export default function HandyBars({
  bars,
  color = DEFAULT_COLOR,
  maxHeight = DEFAULT_MAX_HEIGHT,
  barWidth = DEFAULT_BAR_WIDTH,
  gap = DEFAULT_GAP,
}: HandyBarsProps) {
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
            background: color,
            maxHeight: `${maxHeight}px`,
            minHeight: `${MIN_HEIGHT_PX}px`,
            height: `${barHeight(v, maxHeight)}px`,
            opacity: barOpacity(v),
            borderRadius: "2px",
            transition: "height 60ms ease-out, opacity 120ms ease-out",
          }}
        />
      ))}
    </div>
  );
}
