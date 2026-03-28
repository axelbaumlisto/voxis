import FieldWrapper from "./FieldWrapper";

interface InputFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  description?: string;
  type?: "text" | "number";
}

function InputField({
  label,
  value,
  onChange,
  placeholder,
  description,
  type = "text",
}: InputFieldProps) {
  return (
    <FieldWrapper label={label} description={description}>
      <input
        type={type}
        className="settings-field-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </FieldWrapper>
  );
}

export default InputField;
