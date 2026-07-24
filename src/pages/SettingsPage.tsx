import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { useSettings } from "../hooks/useSettings";
import { useAudioDevices } from "../hooks/useAudioDevices";
import { getConfigValue } from "../lib/config";
import {
  getSections,
  getSettingsBySection,
  SettingDefinition,
  SettingOption,
} from "../lib/settingsRegistry";
import Section from "../components/settings/Section";
import { renderBuiltinField, renderCustomWidget } from "./settingsRenderers";
import "../styles/settings.css";

/**
 * Validate the optional custom transcription endpoint URL.
 * An empty value is always valid (means "use the default Groq endpoint").
 * A non-empty value must be a syntactically valid absolute http(s) URL — we
 * only check URL *shape*, not any required path suffix, so self-hosted setups
 * with arbitrary paths are accepted. `new URL()` alone accepts other schemes
 * (e.g. ftp:, file:), so the explicit http(s) prefix check is required.
 */
export function isApiUrlOverrideValid(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return true;
  if (!(trimmed.startsWith("http://") || trimmed.startsWith("https://"))) {
    return false;
  }
  try {
    new URL(trimmed);
    return true;
  } catch {
    return false;
  }
}

function SettingsPage() {
  const { t } = useTranslation();
  const {
    config,
    loading,
    error,
    saving,
    updateNestedConfig,
    save,
    hasChanges,
  } = useSettings();

  const { options: audioDeviceOptions, error: audioDeviceError } =
    useAudioDevices(config?.audio_device);

  // Handlers for ProviderSelect
  const handleProviderChange = useCallback(
    (providerId: string, apiUrl: string, defaultModel: string) => {
      updateNestedConfig("llm.provider", providerId);
      updateNestedConfig("llm.api_url", apiUrl);
      updateNestedConfig("llm.model", defaultModel);
    },
    [updateNestedConfig]
  );

  const handleModelChange = useCallback(
    (modelId: string) => {
      updateNestedConfig("llm.model", modelId);
    },
    [updateNestedConfig]
  );

  const handleSave = async () => {
    try {
      await save();
    } catch {
      // Error is already set in the hook
    }
  };

  if (loading) {
    return (
      <div>
        <header className="page-header">
          <h1 className="page-title">{t("settings.title")}</h1>
        </header>
        <div className="card">
          <p style={{ color: "var(--fg-muted)" }}>{t("common.loading")}</p>
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div>
        <header className="page-header">
          <h1 className="page-title">{t("settings.title")}</h1>
        </header>
        <div className="card">
          <p style={{ color: "var(--error)" }}>
            {t("settings.failedToLoad", { error })}
          </p>
        </div>
      </div>
    );
  }

  // Resolve an i18n key when present, otherwise fall back to the raw string.
  const resolveLabel = (raw: string, key?: string) => (key ? t(key) : raw);
  // Resolve option labels through t() when an option carries a labelKey.
  const resolveOptions = (options: SettingOption[]): SettingOption[] =>
    options.map((opt) =>
      opt.labelKey ? { ...opt, label: t(opt.labelKey) } : opt
    );

  // Block save while a non-empty custom endpoint URL is malformed.
  const apiUrlOverrideValid = isApiUrlOverrideValid(
    String(getConfigValue(config, "api_url_override") ?? "")
  );

  const renderSettingField = (setting: SettingDefinition) => {
    const label = resolveLabel(setting.label, setting.labelKey);
    const description =
      setting.description !== undefined || setting.descriptionKey !== undefined
        ? resolveLabel(setting.description ?? "", setting.descriptionKey)
        : undefined;

    // Handle custom widgets via registry (OCP)
    if (setting.widgetType === "custom" && setting.customComponent) {
      const rendered = renderCustomWidget(setting.customComponent, {
        label,
        description,
        config,
        settingKey: setting.key,
        onChange: (key, value) => updateNestedConfig(key as string, value),
        onProviderChange: handleProviderChange,
        onModelChange: handleModelChange,
      });
      if (rendered !== null) return <div key={setting.key}>{rendered}</div>;
      return null;
    }

    const value = getConfigValue(config, setting.key);
    // Determine options: audio_device is dynamic, getOptions takes priority over static options
    const options =
      setting.key === "audio_device"
        ? audioDeviceOptions
        : (setting.getOptions?.() ?? setting.options ?? []);

    return (
      <div key={setting.key}>
        {renderBuiltinField(setting.widgetType, {
          label,
          description,
          value,
          onChange: (v) => updateNestedConfig(setting.key, v),
          options: resolveOptions(options),
          placeholder: setting.placeholder,
        })}
        {setting.key === "audio_device" && audioDeviceError && (
          <p
            className="settings-field-error"
            role="alert"
            data-testid="audio-device-error"
            style={{ color: "var(--error)" }}
          >
            {t("settings.audioDevicesUnavailable")}
          </p>
        )}
        {setting.key === "api_url_override" && (
          <>
            {!isApiUrlOverrideValid(String(value ?? "")) && (
              <p
                className="settings-field-error"
                role="alert"
                data-testid="api-url-override-error"
                style={{ color: "var(--error)" }}
              >
                {t("settings.apiUrlOverrideInvalid")}
              </p>
            )}
            <div style={{ marginTop: "0.5rem" }}>
              <button
                type="button"
                className="secondary"
                data-testid="use-local-server-preset"
                onClick={() =>
                  updateNestedConfig(
                    "api_url_override",
                    "http://localhost:8000/v1/audio/transcriptions"
                  )
                }
              >
                {t("settings.useLocalServerPreset")}
              </button>
              <p
                style={{
                  marginTop: "0.35rem",
                  fontSize: "0.85em",
                  color: "var(--fg-muted)",
                }}
              >
                {t("settings.useLocalServerPresetHint")}
              </p>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="settings-page">
      <header className="page-header">
        <div className="page-header-content">
          <div>
            <h1 className="page-title">{t("settings.title")}</h1>
            <p className="page-description">
              {t("settings.description")}
            </p>
          </div>
          <div className="page-header-actions">
            <select
              className="language-select"
              value={i18n.language.startsWith("ru") ? "ru" : "en"}
              onChange={(e) => i18n.changeLanguage(e.target.value)}
              aria-label={t("common.language")}
            >
              <option value="en">English</option>
              <option value="ru">Русский</option>
            </select>
            {error && <span className="settings-error">{error}</span>}
            <button
              className="primary"
              onClick={handleSave}
              disabled={!hasChanges || saving || !apiUrlOverrideValid}
            >
              {saving ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </div>
      </header>

      <div className="settings-grid">
        {getSections().map((section) => (
          <Section key={section} sectionKey={section} title={section}>
            {getSettingsBySection(section).map(renderSettingField)}
          </Section>
        ))}
      </div>
    </div>
  );
}

export default SettingsPage;
