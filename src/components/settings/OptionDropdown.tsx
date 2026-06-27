/**
 * Generic dropdown component for selecting options.
 */
import { useFieldControlId } from "./FieldWrapper";

export interface DropdownOption {
  id: string;
  label: string;
  /** Optional suffix to display after the label */
  suffix?: string;
}

interface OptionDropdownProps {
  options: DropdownOption[];
  selectedId: string;
  onChange: (id: string) => void;
  /** If true, shows current selection even if not in options list */
  showMissingSelection?: boolean;
  className?: string;
  /** Accessible name for the underlying <select>. */
  ariaLabel?: string;
}

/**
 * Generic dropdown for selecting from a list of options.
 */
function OptionDropdown({
  options,
  selectedId,
  onChange,
  showMissingSelection = true,
  className = "settings-field-input",
  ariaLabel,
}: OptionDropdownProps) {
  // Check if current selection is in the options list
  const hasCurrentOption = options.some((opt) => opt.id === selectedId);
  // Bind the FieldWrapper-generated id so the label's htmlFor resolves to a
  // real control (a11y), when rendered inside a FieldWrapper.
  const controlId = useFieldControlId();

  return (
    <select
      id={controlId}
      className={className}
      value={selectedId}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
    >
      {options.map((opt) => (
        <option key={opt.id} value={opt.id}>
          {opt.label}
          {opt.suffix && ` ${opt.suffix}`}
        </option>
      ))}
      {showMissingSelection && selectedId && !hasCurrentOption && (
        <option value={selectedId}>{selectedId} (current)</option>
      )}
    </select>
  );
}

export default OptionDropdown;
