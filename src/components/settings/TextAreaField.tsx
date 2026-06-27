import FieldWrapper, { useFieldControlId } from "./FieldWrapper";

interface TextAreaFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  description?: string;
  rows?: number;
  placeholder?: string;
}

function TextAreaControl({
  value,
  onChange,
  rows,
  placeholder,
}: Pick<TextAreaFieldProps, "value" | "onChange" | "rows" | "placeholder">) {
  const id = useFieldControlId();
  return (
    <textarea
      id={id}
      className="settings-field-input settings-textarea"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
    />
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  description,
  rows,
  placeholder,
}: TextAreaFieldProps) {
  return (
    <FieldWrapper label={label} description={description}>
      <TextAreaControl
        value={value}
        onChange={onChange}
        rows={rows}
        placeholder={placeholder}
      />
    </FieldWrapper>
  );
}

export default TextAreaField;
