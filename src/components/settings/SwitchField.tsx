import FieldWrapper, { useFieldControlId } from "./FieldWrapper";

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
      <SwitchControl label={label} checked={checked} onChange={onChange} />
    </FieldWrapper>
  );
}

function SwitchControl({
  label,
  checked,
  onChange,
}: Pick<SwitchFieldProps, "label" | "checked" | "onChange">) {
  const id = useFieldControlId();
  return (
    <label className="switch">
      <input
        id={id}
        type="checkbox"
        aria-label={label}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch-slider" />
    </label>
  );
}

export default SwitchField;
