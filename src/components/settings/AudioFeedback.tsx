/**
 * AudioFeedback — Settings widget for the start/stop/error beeps.
 *
 * #6 from .pi/plans/handy-recommendations-cloud-only.md.
 *
 * Two-row card: master toggle + volume slider. Slider is disabled
 * while the master toggle is off (cosmetic clarity).
 *
 * SOLID: receives the full sub-shape `{enabled, volume}` plus an
 * onChange that emits the modified shape. The settings page passes
 * one such pair per nested-config key.
 */
import FieldWrapper from "./FieldWrapper";

export interface AudioFeedbackProps {
  label: string;
  description?: string;
  value: { enabled: boolean; volume: number };
  onChange: (value: { enabled: boolean; volume: number }) => void;
}

export default function AudioFeedback({
  label,
  description,
  value,
  onChange,
}: AudioFeedbackProps) {
  const safe = value ?? { enabled: false, volume: 0.6 };
  return (
    <FieldWrapper label={label} description={description}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label
          style={{ display: "flex", alignItems: "center", gap: 8 }}
          data-testid="audio-feedback-toggle-wrapper"
        >
          <input
            type="checkbox"
            checked={safe.enabled}
            data-testid="audio-feedback-toggle"
            onChange={(e) =>
              onChange({ ...safe, enabled: e.target.checked })
            }
          />
          <span>Enable beeps</span>
        </label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            opacity: safe.enabled ? 1 : 0.5,
          }}
        >
          <span style={{ minWidth: 80 }}>Volume</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={safe.volume}
            data-testid="audio-feedback-volume"
            disabled={!safe.enabled}
            onChange={(e) =>
              onChange({ ...safe, volume: Number(e.target.value) })
            }
            style={{ flex: 1 }}
          />
          <span style={{ minWidth: 32, textAlign: "right" }}>
            {Math.round(safe.volume * 100)}%
          </span>
        </label>
      </div>
    </FieldWrapper>
  );
}
