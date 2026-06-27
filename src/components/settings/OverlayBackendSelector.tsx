/**
 * Settings toggle for the overlay (visualization) on/off.
 *
 * SOLID/DRY/KISS:
 * - SRP: a single switch for `overlay.backend`. Save flow lives in
 *   SettingsPage; we only emit `onChange(value)` like any other field.
 * - KISS: there is now ONE overlay backend (webview) on every platform, so the
 *   choice collapses to a boolean. On = "webview", Off = "none". Any other
 *   stored value (legacy "auto"/"nspanel"/"native"…) routes to the webview
 *   backend, so it counts as "on".
 * - DRY: reuses `FieldWrapper` for label + description layout.
 */
import { useRef } from "react";
import FieldWrapper, { useFieldControlId } from "./FieldWrapper";

interface OverlayBackendSelectorProps {
  label: string;
  description?: string;
  value: string;
  onChange: (value: string) => void;
}

function OverlayBackendSelector({
  label,
  description,
  value,
  onChange,
}: OverlayBackendSelectorProps) {
  // Capture the value the field mounted with so we can show "requires restart"
  // only when the user actually diverges from it.
  const initialValueRef = useRef(value);
  const enabled = value !== "none";
  const showRestartNotice = value !== initialValueRef.current;

  return (
    <FieldWrapper
      label={label}
      description={description}
      className="settings-field-switch"
    >
      <OverlayCheckbox label={label} enabled={enabled} onChange={onChange} />
      {showRestartNotice && (
        <p
          className="settings-field-description"
          data-testid="overlay-backend-restart-notice"
          role="status"
        >
          Requires restart to take effect.
        </p>
      )}
    </FieldWrapper>
  );
}

/** Inner control: consumes the FieldWrapper id so the label resolves to it. */
function OverlayCheckbox({
  label,
  enabled,
  onChange,
}: {
  label: string;
  enabled: boolean;
  onChange: (value: string) => void;
}) {
  const controlId = useFieldControlId();
  return (
    <label className="switch">
      <input
        id={controlId}
        type="checkbox"
        checked={enabled}
        onChange={(e) => onChange(e.target.checked ? "webview" : "none")}
        aria-label={label}
      />
      <span className="switch-slider" />
    </label>
  );
}

export default OverlayBackendSelector;
