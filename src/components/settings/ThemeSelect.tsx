import { useState } from "react";
import { useTranslation } from "react-i18next";
import FieldWrapper from "./FieldWrapper";
import { useVisualizationThemes } from "../../hooks/useVisualizationThemes";
import { previewVisualizationTheme } from "../../lib/commands";


interface ThemeSelectProps {
  label: string;
  description?: string;
  value: string;
  onChange: (value: string) => void;
}

/**
 * Mini visual swatch (~96×16) placeholder for a theme.
 * Formerly rendered family-specific previews (bars/ring/handy) from the
 * legacy TS pipeline. All themes are now code modules (manifest v2) —
 * swatch data comes from the Rust theme-engine in a future update.
 */
function ThemeSwatch({ themeId }: { themeId: string }) {
  return <span className="theme-swatch theme-swatch--missing" aria-hidden data-testid={`theme-swatch-${themeId}`} />;
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
      {/* Swatch grid \u2014 click to select. All themes are now code
          modules (manifest v2); swatches display placeholder until
          the Rust theme-engine ships swatch data in a future update. */}
      <div
        className="theme-swatch-grid"
        data-testid="theme-swatch-grid"
        role="radiogroup"
        aria-label={`${label} \u2014 visual preview`}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: "6px",
          marginTop: "8px",
        }}
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.value)}
              className={`theme-swatch-row${selected ? " theme-swatch-row--selected" : ""}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "4px 8px",
                border: selected
                  ? "1px solid var(--accent-color, #1e88e5)"
                  : "1px solid var(--border-color, #444)",
                borderRadius: "4px",
                background: selected
                  ? "var(--accent-bg, rgba(30, 136, 229, 0.12))"
                  : "transparent",
                cursor: "pointer",
                textAlign: "left",
                color: "inherit",
              }}
            >
              <ThemeSwatch themeId={option.value} />
              <span
                style={{
                  fontSize: "0.85em",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {option.label}
              </span>
            </button>
          );
        })}
      </div>
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

export default ThemeSelect;
