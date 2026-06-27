import { SettingOption } from "../../lib/settingsRegistry";
import FieldWrapper, { useFieldControlId } from "./FieldWrapper";

interface SelectFieldProps {
  label: string;
  value: string;
  options: SettingOption[];
  onChange: (value: string) => void;
  description?: string;
}

function SelectControl({
  value,
  options,
  onChange,
}: Pick<SelectFieldProps, "value" | "options" | "onChange">) {
  const id = useFieldControlId();
  return (
    <select
      id={id}
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
  );
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
      <SelectControl value={value} options={options} onChange={onChange} />
    </FieldWrapper>
  );
}

export default SelectField;
