import React from "react";

interface FieldWrapperProps {
  label: string;
  description?: string;
  className?: string;
  children: React.ReactNode;
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
  return (
    <div className={`settings-field ${className ?? ""}`}>
      <div className="settings-field-header">
        <label className="settings-field-label">{label}</label>
        {description && (
          <span className="settings-field-description">{description}</span>
        )}
      </div>
      {children}
    </div>
  );
}

export default FieldWrapper;
