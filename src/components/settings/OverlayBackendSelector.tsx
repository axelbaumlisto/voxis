/**
 * Settings selector for the overlay rendering backend.
 *
 * SOLID/DRY/KISS:
 * - SRP: a single dropdown for `overlay.backend`. Save flow lives in
 *   SettingsPage; we only emit `onChange(value)` like any other field.
 * - OCP: options are sourced from `OVERLAY_BACKEND_OPTIONS` (constants) so
 *   adding a backend means appending one entry there.
 * - DRY: reuses `FieldWrapper` for label + description layout.
 * - KISS: native `<select>`; per-option `disabled` flag for the
 *   platform-restricted `nspanel` value; restart notice tracked via local
 *   "initial value" reference.
 */
import { useMemo, useRef } from "react";
import FieldWrapper from "./FieldWrapper";
import { OVERLAY_BACKEND_OPTIONS } from "../../lib/constants";

interface OverlayBackendSelectorProps {
  label: string;
  description?: string;
  value: string;
  onChange: (value: string) => void;
}

const MACOS_ONLY_BACKENDS: ReadonlySet<string> = new Set(["nspanel"]);

function isMacPlatform(): boolean {
  // jsdom and modern browsers still expose `navigator.platform`. Apple Silicon
  // Macs report "MacIntel" too (legacy compat), so the substring check is
  // sufficient for our needs.
  if (typeof navigator === "undefined" || !navigator.platform) return false;
  return navigator.platform.toLowerCase().includes("mac");
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
  const isMac = useMemo(() => isMacPlatform(), []);

  const platformLockedOptions = OVERLAY_BACKEND_OPTIONS.filter((o) =>
    MACOS_ONLY_BACKENDS.has(o.value),
  );
  const showPlatformHint = !isMac && platformLockedOptions.length > 0;
  const showRestartNotice = value !== initialValueRef.current;

  const platformHint = showPlatformHint
    ? `${platformLockedOptions.map((o) => o.label.replace(/\s*\(.*?\)\s*$/, "")).join(", ")}: macOS only`
    : null;

  return (
    <FieldWrapper label={label} description={description}>
      <select
        className="settings-field-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
      >
        {OVERLAY_BACKEND_OPTIONS.map((opt) => {
          const disabled = !isMac && MACOS_ONLY_BACKENDS.has(opt.value);
          return (
            <option key={opt.value} value={opt.value} disabled={disabled}>
              {opt.label}
            </option>
          );
        })}
      </select>
      {platformHint && (
        <p
          className="settings-field-description"
          data-testid="overlay-backend-platform-hint"
        >
          {platformHint}
        </p>
      )}
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

export default OverlayBackendSelector;
