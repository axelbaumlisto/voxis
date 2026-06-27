import React, { createContext, useContext, useId } from "react";

interface FieldWrapperProps {
  label: string;
  description?: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * Context exposing the FieldWrapper-generated control id so that field
 * primitives (InputField/SelectField/TextAreaField/PasswordField/SwitchField)
 * can attach it to their underlying <input>/<select>/<textarea>. This wires up
 * label `htmlFor` ↔ control `id` association for accessibility without forcing
 * callers to thread an id prop through every primitive.
 */
const FieldControlIdContext = createContext<string | undefined>(undefined);

/** Read the FieldWrapper-provided control id (undefined when used standalone). */
export function useFieldControlId(): string | undefined {
  return useContext(FieldControlIdContext);
}

/**
 * Wrapper component for settings fields that provides consistent
 * label, description, and styling structure.
 * Eliminates duplicate wrapper code across InputField, SelectField, etc.
 */
function FieldWrapper({
  label,
  description,
  className,
  children,
}: FieldWrapperProps) {
  const id = useId();
  return (
    <div className={`settings-field ${className ?? ""}`}>
      <div className="settings-field-header">
        <label className="settings-field-label" htmlFor={id}>
          {label}
        </label>
        {description && (
          <span className="settings-field-description">{description}</span>
        )}
      </div>
      <FieldControlIdContext.Provider value={id}>
        {children}
      </FieldControlIdContext.Provider>
    </div>
  );
}

export default FieldWrapper;
