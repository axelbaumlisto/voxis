/**
 * AlwaysOnMicrophone — Settings toggle with inline privacy warning
 * (#8 from .pi/plans/handy-recommendations-cloud-only.md).
 *
 * The toggle itself is a single boolean. The interesting part is the
 * warning copy directly under it: keeping a capture stream warm
 * between recordings has real privacy and battery implications, so the
 * user MUST see them at the point of decision (privacy-by-design).
 */
import FieldWrapper from "./FieldWrapper";

export interface AlwaysOnMicrophoneProps {
  label: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}

export default function AlwaysOnMicrophone({
  label,
  description,
  value,
  onChange,
}: AlwaysOnMicrophoneProps) {
  return (
    <FieldWrapper label={label} description={description}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={!!value}
            data-testid="always-on-microphone-toggle"
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>Keep microphone capture warm between recordings</span>
        </label>
        {value && (
          <div
            data-testid="always-on-microphone-warning"
            role="note"
            style={{
              padding: "8px 12px",
              border: "1px solid #b08300",
              borderRadius: 4,
              background: "rgba(255, 196, 0, 0.08)",
              fontSize: "0.85em",
              lineHeight: 1.4,
            }}
          >
            <strong>⚠ Privacy note.</strong> The capture device stays
            active between hotkey presses for zero-latency first sample.
            <strong> Audio is NEVER buffered or sent to the cloud unless
            you actively trigger the hotkey.</strong> Battery use will be
            slightly higher (the mic chip never enters low-power state).
          </div>
        )}
      </div>
    </FieldWrapper>
  );
}
