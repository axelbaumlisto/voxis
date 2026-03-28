import { SettingOption } from "../../lib/settingsRegistry";
import FieldWrapper from "./FieldWrapper";

interface SelectFieldProps {
  label: string;
  value: string;
  options: SettingOption[];
  onChange: (value: string) => void;
  description?: string;
}

function SelectField({
  label,
  value,
  options,
  onChange,
  description,
}: SelectFieldProps) {
  return (
    <FieldWrapper label={label} description={description}>
      <select
        className="settings-field-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </FieldWrapper>
  );
}

export default SelectField;
