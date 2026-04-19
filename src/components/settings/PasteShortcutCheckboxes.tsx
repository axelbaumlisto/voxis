import React from "react";
import { PASTE_SHORTCUT_OPTIONS } from "../../lib/constants";

interface PasteShortcutCheckboxesProps {
  label: string;
  description?: string;
  value: string; // comma-separated
  onChange: (value: string) => void;
}

export default function PasteShortcutCheckboxes({
  label,
  description,
  value,
  onChange,
}: PasteShortcutCheckboxesProps) {
  // Parse comma-separated value into Set
  const selected = new Set(
    (value ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  );

  const handleChange = (optionValue: string, checked: boolean) => {
    const newSelected = new Set(selected);
    if (checked) {
      newSelected.add(optionValue);
    } else {
      newSelected.delete(optionValue);
    }
    // Convert back to comma-separated string
    const newValue = Array.from(newSelected).join(",");
    onChange(newValue || "ctrl_shift_v"); // Default if empty
  };

  return (
    <div className="setting-field">
      <label className="setting-label">{label}</label>
      {description && <p className="setting-description">{description}</p>}
      <div className="checkbox-group">
        {PASTE_SHORTCUT_OPTIONS.map((option) => (
          <label key={option.value} className="checkbox-label">
            <input
              type="checkbox"
              checked={selected.has(option.value)}
              onChange={(e) => handleChange(option.value, e.target.checked)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
