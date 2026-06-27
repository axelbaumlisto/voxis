import { useState } from "react";
import { useTranslation } from "react-i18next";
import FieldWrapper, { useFieldControlId } from "./FieldWrapper";

interface PasswordFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  description?: string;
}

function PasswordControl({
  value,
  onChange,
  placeholder,
}: Pick<PasswordFieldProps, "value" | "onChange" | "placeholder">) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const id = useFieldControlId();

  return (
    <div className="password-field-wrapper">
      <input
        id={id}
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
        {visible ? t("common.hide") : t("common.show")}
      </button>
    </div>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  placeholder,
  description,
}: PasswordFieldProps) {
  return (
    <FieldWrapper label={label} description={description}>
      <PasswordControl
        value={value}
        onChange={onChange}
        placeholder={placeholder}
      />
    </FieldWrapper>
  );
}

export default PasswordField;
