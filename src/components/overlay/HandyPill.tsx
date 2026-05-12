/**
 * HandyPill \u2014 compact 172\u00d736 recording overlay, ported from Handy
 * (github.com/cjpais/Handy/src/overlay/RecordingOverlay.tsx).
 *
 * Layout (3-column grid): icon | middle | cancel
 *   recording    \u2192 MicrophoneIcon    | <HandyBars>           | CancelIcon
 *   transcribing \u2192 TranscriptionIcon | "Transcribing..."     | \u2014
 *   idle         \u2192 TranscriptionIcon | \u2014                     | \u2014
 *   error        \u2192 TranscriptionIcon | "Error"               | \u2014
 *
 * SRP: layout + mode dispatch only; bars rendering is delegated to HandyBars,
 *      icons to /components/icons, smoothing to useSmoothBars.
 * KISS: no i18n inside the overlay yet \u2014 strings are constants that callers can
 *       override via props if/when overlay i18n lands.
 */
import {
  CancelIcon,
  MicrophoneIcon,
  TranscriptionIcon,
  DEFAULT_ICON_COLOR,
} from "../icons";
import HandyBars from "./HandyBars";
import styles from "./HandyPill.module.css";

export type HandyPillMode = "idle" | "recording" | "transcribing" | "error";

export interface HandyPillProps {
  mode: HandyPillMode;
  /** Already-smoothed normalized bar values (use `useSmoothBars` upstream). */
  bars: number[];
  /** Visible overlay (controls fade-in opacity). Default `true`. */
  visible?: boolean;
  /** Click handler for the cancel button (recording mode only). */
  onCancel?: () => void;
  /** Override icon color. Default `#FAA2CA` (Handy pink). */
  iconColor?: string;
  /** Override bar color. Default `#ffe5ee` (Handy light pink). */
  barColor?: string;
  /** Labels used for non-recording modes. */
  labels?: Partial<Record<"transcribing" | "processing" | "error", string>>;
}

const DEFAULT_LABELS = {
  transcribing: "Transcribing\u2026",
  processing: "Processing\u2026",
  error: "Error",
} as const;

function leftIcon(mode: HandyPillMode, color: string) {
  if (mode === "recording") {
    return <MicrophoneIcon color={color} data-testid="handy-pill-icon-microphone" />;
  }
  return <TranscriptionIcon color={color} data-testid="handy-pill-icon-transcription" />;
}

// React swallows data-* on direct JSX, but our icons are SVG; for stable
// testids we wrap them.
function IconSlot({ mode, color }: { mode: HandyPillMode; color: string }) {
  const testid =
    mode === "recording"
      ? "handy-pill-icon-microphone"
      : "handy-pill-icon-transcription";
  return (
    <span data-testid={testid} style={{ display: "inline-flex" }}>
      {leftIcon(mode, color)}
    </span>
  );
}

export default function HandyPill({
  mode,
  bars,
  visible = true,
  onCancel,
  iconColor = DEFAULT_ICON_COLOR,
  barColor,
  labels,
}: HandyPillProps) {
  const text = { ...DEFAULT_LABELS, ...(labels ?? {}) };
  const rootClass = [styles["recording-overlay"], visible ? styles["fade-in"] : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={`${rootClass} recording-overlay${visible ? " fade-in" : ""}`}
      data-mode={mode}
    >
      <div className={`${styles["overlay-left"]} overlay-left`}>
        <IconSlot mode={mode} color={iconColor} />
      </div>

      <div className={`${styles["overlay-middle"]} overlay-middle`}>
        {mode === "recording" && <HandyBars bars={bars} color={barColor} />}
        {mode === "transcribing" && (
          <span className={`${styles["transcribing-text"]} transcribing-text`}>
            {text.transcribing}
          </span>
        )}
        {mode === "error" && (
          <span className={`${styles["transcribing-text"]} transcribing-text`}>
            {text.error}
          </span>
        )}
        {/* idle: empty middle slot (just icon visible) */}
      </div>

      <div className={`${styles["overlay-right"]} overlay-right`}>
        {mode === "recording" && (
          <button
            type="button"
            className={`${styles["cancel-button"]} cancel-button`}
            data-testid="handy-pill-cancel"
            aria-label="Cancel recording"
            onClick={() => onCancel?.()}
          >
            <CancelIcon color={iconColor} />
          </button>
        )}
      </div>
    </div>
  );
}
