import { useState } from "react";
import { useTranslation } from "react-i18next";
import FieldWrapper, { useFieldControlId } from "./FieldWrapper";
import { useVisualizationThemes } from "../../hooks/useVisualizationThemes";
import { previewVisualizationTheme } from "../../lib/commands";
import type { SettingOption } from "../../lib/settingsRegistry";


interface ThemeSelectProps {
  label: string;
  description?: string;
  value: string;
  onChange: (value: string) => void;
}

function ThemeSelect({ label, description, value, onChange }: ThemeSelectProps) {
  const { t } = useTranslation();
  const { options, loading, error, reload } = useVisualizationThemes(value);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const helperText = loading
    ? t("settings.themeLoading")
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
      <ThemeSelectControl
        label={label}
        value={value}
        options={options}
        onChange={onChange}
      />
      <div className="theme-preview-actions">
        <button
          type="button"
          className="theme-preview-btn"
          onClick={() => void runPreview(false)}
          disabled={previewing}
        >
          {previewing ? t("common.previewing") : t("settings.preview")}
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

/** Inner control: consumes the FieldWrapper id so the label resolves to it. */
function ThemeSelectControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: SettingOption[];
  onChange: (value: string) => void;
}) {
  const controlId = useFieldControlId();
  return (
    <select
      id={controlId}
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
  );
}

export default ThemeSelect;
