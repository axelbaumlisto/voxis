import { useState } from "react";
import FieldWrapper from "./FieldWrapper";

interface PasswordFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  description?: string;
}

function PasswordField({
  label,
  value,
  onChange,
  placeholder,
  description,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <FieldWrapper label={label} description={description}>
      <div className="password-field-wrapper">
        <input
          type={visible ? "text" : "password"}
          className="settings-field-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setVisible(!visible)}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
    </FieldWrapper>
  );
}

export default PasswordField;
