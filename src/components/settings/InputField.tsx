import FieldWrapper from "./FieldWrapper";

interface InputFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  description?: string;
  type?: "text" | "number";
  readonly?: boolean;
  ariaInvalid?: boolean;
}

function InputField({
  label,
  value,
  onChange,
  placeholder,
  description,
  type = "text",
  readonly = false,
  ariaInvalid,
}: InputFieldProps) {
  return (
    <FieldWrapper label={label} description={description}>
      <input
        type={type}
        className="settings-field-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        readOnly={readonly}
        aria-invalid={ariaInvalid}
        style={readonly ? { opacity: 0.7, cursor: "default" } : undefined}
      />
    </FieldWrapper>
  );
}

export default InputField;
