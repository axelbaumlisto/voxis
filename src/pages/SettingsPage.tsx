import { useCallback } from "react";
import { useSettings } from "../hooks/useSettings";
import { useAudioDevices } from "../hooks/useAudioDevices";
import { getConfigValue } from "../lib/config";
import {
  getSections,
  getSettingsBySection,
  SettingDefinition,
} from "../lib/settingsRegistry";
import { renderField } from "../lib/fieldRegistry";
import Section from "../components/settings/Section";
import { renderCustomWidget } from "../lib/customWidgetRegistry";
import "../styles/settings.css";

function SettingsPage() {
  const {
    config,
    loading,
    error,
    saving,
    updateNestedConfig,
    save,
    hasChanges,
  } = useSettings();

  const { options: audioDeviceOptions } = useAudioDevices(config?.audio_device);

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
          <h1 className="page-title">Settings</h1>
        </header>
        <div className="card">
          <p style={{ color: "var(--text-secondary)" }}>Loading...</p>
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div>
        <header className="page-header">
          <h1 className="page-title">Settings</h1>
        </header>
        <div className="card">
          <p style={{ color: "var(--error)" }}>
            Failed to load settings: {error}
          </p>
        </div>
      </div>
    );
  }

  const renderSettingField = (setting: SettingDefinition) => {
    // Handle custom widgets via registry (OCP)
    if (setting.widgetType === "custom" && setting.customComponent) {
      const rendered = renderCustomWidget(setting.customComponent, {
        label: setting.label,
        description: setting.description,
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
        {renderField(setting.widgetType, {
          label: setting.label,
          description: setting.description,
          value,
          onChange: (v) => updateNestedConfig(setting.key, v),
          options,
          placeholder: setting.placeholder,
        })}
      </div>
    );
  };

  return (
    <div className="settings-page">
      <header className="page-header">
        <div className="page-header-content">
          <div>
            <h1 className="page-title">Settings</h1>
            <p className="page-description">
              Configure your voice dictation preferences
            </p>
          </div>
          <div className="page-header-actions">
            {error && <span className="settings-error">{error}</span>}
            <button
              className="primary"
              onClick={handleSave}
              disabled={!hasChanges || saving}
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </header>

      <div className="settings-grid">
        {getSections().map((section) => (
          <Section key={section} title={section}>
            {getSettingsBySection(section).map(renderSettingField)}
          </Section>
        ))}
      </div>
    </div>
  );
}

export default SettingsPage;
