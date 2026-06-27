import FieldWrapper, { useFieldControlId } from "./FieldWrapper";

function InputControl(props: {
  type: "text" | "number";
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  readonly: boolean;
  ariaInvalid?: boolean;
}) {
  const id = useFieldControlId();
  return (
    <input
      id={id}
      type={props.type}
      className="settings-field-input"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      placeholder={props.placeholder}
      readOnly={props.readonly}
      aria-invalid={props.ariaInvalid}
      style={props.readonly ? { opacity: 0.7, cursor: "default" } : undefined}
    />
  );
}

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
      <InputControl
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        readonly={readonly}
        ariaInvalid={ariaInvalid}
      />
    </FieldWrapper>
  );
}

export default InputField;
