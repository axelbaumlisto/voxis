import FieldWrapper from "./FieldWrapper";

interface TextAreaFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  description?: string;
  rows?: number;
  placeholder?: string;
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
      <textarea
        className="settings-field-input settings-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
      />
    </FieldWrapper>
  );
}

export default TextAreaField;
