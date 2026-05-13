import { useState } from "react";
import { useTranslation } from "react-i18next";
import FieldWrapper from "./FieldWrapper";
import { useVisualizationThemes } from "../../hooks/useVisualizationThemes";
import { previewVisualizationTheme } from "../../lib/commands";
import { getBuiltinHandyTheme } from "../../themes/builtinHandyThemes";
import type { HandyPillTheme } from "../../themes/handy";

interface ThemeSelectProps {
  label: string;
  description?: string;
  value: string;
  onChange: (value: string) => void;
}

/**
 * Mini visual swatch (~96×16) for a theme. Renders the family-specific
 * preview:
 *   - bars        → 8 mini gradient bars (top→bottom of palette)
 *   - organic_ring → a small colored ring stub
 *   - handy       → mic dot + 3 mini bars
 *
 * SRP: the swatch only paints. No event handlers, no state.
 */
function ThemeSwatch({ themeId }: { themeId: string }) {
  const theme: HandyPillTheme | null = getBuiltinHandyTheme(themeId);
  if (!theme) {
    return <span className="theme-swatch theme-swatch--missing" aria-hidden />;
  }
  const family = theme.family;
  if (family === "bars") {
    const g = theme.bars;
    const grad = `linear-gradient(to top, ${g.gradient_bottom} 0%, ${g.gradient_middle} 50%, ${g.gradient_top} 100%)`;
    // 8 mini bars with varying heights to suggest spectrum.
    const heights = [10, 14, 16, 13, 11, 15, 9, 12];
    return (
      <span
        className="theme-swatch theme-swatch--bars"
        data-testid={`theme-swatch-${themeId}`}
        style={{
          display: "inline-flex",
          alignItems: "end",
          gap: "1px",
          height: "16px",
          width: "96px",
          padding: "0 2px",
        }}
      >
        {heights.map((h, i) => (
          <span
            key={i}
            style={{
              flex: "1 1 0",
              height: `${h}px`,
              background: grad,
              borderRadius: "1px",
            }}
          />
        ))}
      </span>
    );
  }
  if (family === "organic_ring") {
    // Small open ring (donut shape via border-radius + clip via gap).
    return (
      <span
        className="theme-swatch theme-swatch--ring"
        data-testid={`theme-swatch-${themeId}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          height: "16px",
          width: "96px",
        }}
      >
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: "14px",
            height: "14px",
            borderRadius: "50%",
            border: `3px solid ${theme.palette.icon_color}`,
            borderTopColor: "transparent",
            transform: "rotate(45deg)",
          }}
        />
      </span>
    );
  }
  // family === 'handy' — mic dot + 3 mini bars in palette colors
  return (
    <span
      className="theme-swatch theme-swatch--handy"
      data-testid={`theme-swatch-${themeId}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "3px",
        height: "16px",
        width: "96px",
        padding: "0 2px",
      }}
    >
      <span
        aria-hidden
        style={{
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          background: theme.palette.icon_color,
        }}
      />
      <span style={{ display: "inline-flex", gap: "1px", alignItems: "end" }}>
        {[8, 12, 10].map((h, i) => (
          <span
            key={i}
            style={{
              width: "3px",
              height: `${h}px`,
              background: theme.palette.bar_color,
              borderRadius: "1px",
            }}
          />
        ))}
      </span>
    </span>
  );
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
      {/* Swatch grid \u2014 click to select. Per-family rendering proves at
          a glance which theme is "bars" vs "organic_ring" vs "handy". */}
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
