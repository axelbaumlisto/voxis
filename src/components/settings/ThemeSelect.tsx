import { useState } from "react";
import FieldWrapper from "./FieldWrapper";
import { useVisualizationThemes } from "../../hooks/useVisualizationThemes";
import { previewVisualizationTheme } from "../../lib/commands";

interface ThemeSelectProps {
  label: string;
  description?: string;
  value: string;
  onChange: (value: string) => void;
}

function ThemeSelect({ label, description, value, onChange }: ThemeSelectProps) {
  const { options, loading, error, reload } = useVisualizationThemes(value);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const helperText = loading
    ? "Loading themes..."
    : previewError
      ? `Preview failed: ${previewError}`
      : error
        ? `Theme list unavailable: ${error}`
        : description;

  const runPreview = async (reloadFromDisk: boolean) => {
    try {
      setPreviewing(true);
      setPreviewError(null);
      await previewVisualizationTheme(value, reloadFromDisk);
      if (reloadFromDisk) {
        await reload();
      }
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Unknown preview error");
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <FieldWrapper label={label} description={helperText}>
      <select
        className="settings-field-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <div className="theme-preview-actions">
        <button
          type="button"
          className="theme-preview-btn"
          onClick={() => void runPreview(false)}
          disabled={previewing}
        >
          {previewing ? "Previewing..." : "Preview"}
        </button>
        <button
          type="button"
          className="theme-preview-btn"
          onClick={() => void runPreview(true)}
          disabled={previewing}
        >
          Reload + Preview
        </button>
      </div>
    </FieldWrapper>
  );
}

export default ThemeSelect;
