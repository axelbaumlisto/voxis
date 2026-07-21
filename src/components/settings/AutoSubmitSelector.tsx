/**
 * AutoSubmitSelector — dropdown for the auto-submit key combo.
 *
 * Configures optional submit keystrokes after auto-typing.
 *
 * Off (default), Enter, Cmd/Super+Enter, Shift+Enter. Per-OS label
 * tweak so macOS sees "Cmd+Enter" and Linux/Windows see "Super+Enter"
 * (the same key, different mainstream name).
 *
 * KISS: stateless wrapper over the standard {label, description, value,
 * onChange} contract used by the rest of the custom widgets.
 */
import FieldWrapper, { useFieldControlId } from "./FieldWrapper";

export interface AutoSubmitSelectorProps {
  label: string;
  description?: string;
  value: string;
  onChange: (value: string) => void;
}

function isMac(): boolean {
  if (typeof navigator === "undefined" || !navigator.platform) return false;
  return navigator.platform.toLowerCase().includes("mac");
}

const VALUES = ["off", "enter", "cmd_enter", "shift_enter"] as const;
type Value = (typeof VALUES)[number];

function isValidValue(v: string): v is Value {
  return (VALUES as readonly string[]).includes(v);
}

export default function AutoSubmitSelector({
  label,
  description,
  value,
  onChange,
}: AutoSubmitSelectorProps) {
  const metaLabel = isMac() ? "Cmd+Enter" : "Super+Enter";
  const safeValue = isValidValue(value) ? value : "off";

  return (
    <FieldWrapper label={label} description={description}>
      <AutoSubmitControl
        label={label}
        safeValue={safeValue}
        metaLabel={metaLabel}
        onChange={onChange}
      />
    </FieldWrapper>
  );
}

/** Inner control: consumes the FieldWrapper id so the label resolves to it. */
function AutoSubmitControl({
  label,
  safeValue,
  metaLabel,
  onChange,
}: {
  label: string;
  safeValue: Value;
  metaLabel: string;
  onChange: (value: string) => void;
}) {
  const controlId = useFieldControlId();
  return (
    <select
      id={controlId}
      className="settings-field-input"
      value={safeValue}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      data-testid="auto-submit-select"
    >
      <option value="off">Off (don't submit)</option>
      <option value="enter">Enter</option>
      <option value="cmd_enter">{metaLabel}</option>
      <option value="shift_enter">Shift+Enter</option>
    </select>
  );
}
