import { useState } from "react";
import { useTranslation } from "react-i18next";
import FieldWrapper, { useFieldControlId } from "./FieldWrapper";
import { useVisualizationThemes } from "../../hooks/useVisualizationThemes";
import { exportBuiltinTheme, previewVisualizationTheme } from "../../lib/commands";
import { getErrorMessage } from "../../lib/errors";
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
  const [exporting, setExporting] = useState(false);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const helperText = loading
    ? t("settings.themeLoading")
    : previewError
      ? `Preview failed: ${previewError}`
      : error
        ? `Theme list unavailable: ${error}`
        : description;

  const runPreview = async (reloadFromDisk: boolean, themeId: string = value) => {
    try {
      setPreviewing(true);
      setPreviewError(null);
      await previewVisualizationTheme(themeId, reloadFromDisk);
      if (reloadFromDisk) {
        await reload();
      }
    } catch (err) {
      // Tauri rejects a `Result<_, String>` command with the plain string, not
      // an Error — `getErrorMessage` is what surfaces the backend's message.
      setPreviewError(getErrorMessage(err));
    } finally {
      setPreviewing(false);
    }
  };

  // Live preview: selecting a theme (incl. arrow-key navigation in the
  // dropdown) immediately shows it on the overlay so the user can browse
  // themes by sight. Persists the choice AND previews it. The export result
  // belongs to the previous selection, so it is cleared here.
  const handleChange = (next: string) => {
    onChange(next);
    setExportPath(null);
    setExportError(null);
    void runPreview(false, next);
  };

  // "Export to edit": the backend copies the selected theme into
  // `<themes dir>/<id>_custom` and returns that folder, which is where the
  // user edits it. The selection stays on the original on purpose — the copy
  // is a new id, and switching to it would retheme the overlay behind the
  // user's back while they are only looking for the folder.
  const runExport = async () => {
    try {
      setExporting(true);
      setExportError(null);
      setExportPath(null);
      const folder = await exportBuiltinTheme(value);
      setExportPath(folder);
      await reload();
    } catch (err) {
      setExportError(getErrorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <FieldWrapper label={label} description={helperText}>
      <ThemeSelectControl
        label={label}
        value={value}
        options={options}
        onChange={handleChange}
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
        <button
          type="button"
          className="theme-preview-btn"
          data-testid="theme-export-button"
          onClick={() => void runExport()}
          disabled={exporting}
        >
          {exporting ? "Exporting…" : "Export to edit"}
        </button>
      </div>
      {exportPath && (
        <p
          className="settings-field-description"
          data-testid="theme-export-result"
          role="status"
        >
          Editing copy: <code>{exportPath}</code>
        </p>
      )}
      {exportError && (
        <p
          className="settings-field-description"
          data-testid="theme-export-error"
          role="alert"
          style={{ color: "var(--error)" }}
        >
          Export failed: {exportError}
        </p>
      )}
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
