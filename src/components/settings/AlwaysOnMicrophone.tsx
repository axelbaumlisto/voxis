/**
 * AlwaysOnMicrophone — Settings toggle with inline privacy warning
 * Keeps capture warm where supported to reduce recording startup latency.
 *
 * The toggle itself is a single boolean. The interesting part is the
 * warning copy directly under it: keeping a capture stream warm
 * between recordings has real privacy and battery implications, so the
 * user MUST see them at the point of decision (privacy-by-design).
 *
 * On macOS the backend stream is kept alive between recordings, so
 * the privacy note is accurate. On Linux and Windows the backend does
 * not yet honour the flag (the cpal stream is dropped on stop()), so
 * we display an informational note instead of the misleading warning.
 */
import { useTranslation } from "react-i18next";
import FieldWrapper, { useFieldControlId } from "./FieldWrapper";
import { isMac } from "./platformUtils";

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
  const mac = isMac();
  return (
    <FieldWrapper label={label} description={description}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <AlwaysOnMicCheckbox label={label} value={value} onChange={onChange} />
        {mac && value && (
          <PrivacyNote />
        )}
        {!mac && (
          <UnsupportedNote />
        )}
      </div>
    </FieldWrapper>
  );
}

function PrivacyNote() {
  const { t } = useTranslation();
  return (
    <div
      data-testid="always-on-microphone-warning"
      role="note"
      style={{
        padding: "8px 12px",
        border: "1px solid #b08300",
        borderRadius: 4,
        background: "rgba(255, 196, 0, 0.08)",
        // em: parent-relative secondary hint; no px token (would change computed size)
        fontSize: "0.85em",
        lineHeight: 1.4,
      }}
    >
      <strong>{t("settings.alwaysOnMicrophonePrivacyTitle")}</strong>{" "}
      {t("settings.alwaysOnMicrophonePrivacyBody")}{" "}
      <strong>{t("settings.alwaysOnMicrophonePrivacyEmphasis")}</strong>{" "}
      {t("settings.alwaysOnMicrophonePrivacyBattery")}
    </div>
  );
}

function UnsupportedNote() {
  const { t } = useTranslation();
  return (
    <div
      data-testid="always-on-microphone-unsupported"
      role="note"
      style={{
        padding: "8px 12px",
        border: "1px solid #888",
        borderRadius: 4,
        background: "rgba(128, 128, 128, 0.08)",
        fontSize: "0.85em",
        lineHeight: 1.4,
      }}
    >
      {t("settings.alwaysOnMicrophoneUnsupported")}
    </div>
  );
}

/** Inner control: consumes the FieldWrapper id so the label resolves to it. */
function AlwaysOnMicCheckbox({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const controlId = useFieldControlId();
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <input
        id={controlId}
        type="checkbox"
        checked={!!value}
        data-testid="always-on-microphone-toggle"
        aria-label={label}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>Keep microphone capture warm between recordings</span>
    </label>
  );
}
