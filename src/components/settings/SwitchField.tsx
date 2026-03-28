import FieldWrapper from "./FieldWrapper";

interface SwitchFieldProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
}

function SwitchField({
  label,
  checked,
  onChange,
  description,
}: SwitchFieldProps) {
  return (
    <FieldWrapper
      label={label}
      description={description}
      className="settings-field-switch"
    >
      <label className="switch">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="switch-slider" />
      </label>
    </FieldWrapper>
  );
}

export default SwitchField;
