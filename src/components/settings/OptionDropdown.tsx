/**
 * Generic dropdown component for selecting options.
 */

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
}: OptionDropdownProps) {
  // Check if current selection is in the options list
  const hasCurrentOption = options.some((opt) => opt.id === selectedId);

  return (
    <select
      className={className}
      value={selectedId}
      onChange={(e) => onChange(e.target.value)}
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
