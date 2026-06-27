import React from "react";
import SelectField from "../components/settings/SelectField";
import SwitchField from "../components/settings/SwitchField";
import InputField from "../components/settings/InputField";
import PasswordField from "../components/settings/PasswordField";
import AlwaysOnMicrophone from "../components/settings/AlwaysOnMicrophone";
import AudioFeedback from "../components/settings/AudioFeedback";
import AutoSubmitSelector from "../components/settings/AutoSubmitSelector";
import LlmPromptManager from "../components/settings/LlmPromptManager";
import ShortcutBindingList from "../components/settings/ShortcutBindingList";
import OverlayBackendSelector from "../components/settings/OverlayBackendSelector";
import PasteShortcutCheckboxes from "../components/settings/PasteShortcutCheckboxes";
import ProviderSelect from "../components/settings/ProviderSelect";
import ThemeSelect from "../components/settings/ThemeSelect";
import { AppConfig } from "../lib/commands";
import { SettingOption, WidgetType } from "../lib/settingsRegistry";

/**
 * Common props for a built-in settings field.
 * The value is `unknown` because it comes straight off the config blob; the
 * renderer coerces it to the concrete shape each control expects.
 */
export interface FieldProps {
  label: string;
  description?: string;
  value: unknown;
  onChange: (value: unknown) => void;
  options?: SettingOption[];
  placeholder?: string;
}

/**
 * Props for a custom (config-aware) settings widget.
 */
export interface CustomWidgetProps {
  label: string;
  description?: string;
  config: AppConfig;
  settingKey: string;
  onChange: (key: string, value: unknown) => void;
  onProviderChange?: (
    providerId: string,
    apiUrl: string,
    defaultModel: string
  ) => void;
  onModelChange?: (modelId: string) => void;
}

/**
 * Convert a string value to a typed value (number or string).
 * Single source of truth for type conversion across the editable fields.
 * Returns number only for pure integer strings (e.g. "123" / "-5"); strings
 * like "3.14" or "1e5" are preserved to keep their string semantics.
 */
function convertToTypedValue(value: string): string | number {
  const trimmed = value.trim();
  if (trimmed === "") {
    return value;
  }
  if (/^-?\d+$/.test(trimmed)) {
    return Number(value);
  }
  return value;
}

/** Coerce any config value to a display string (null/undefined -> ""). */
function toStringValue(value: unknown): string {
  return String(value ?? "");
}

/**
 * Render a built-in field by widget type with proper, cast-free types.
 * Returns null for the `custom` type (handled by {@link renderCustomWidget})
 * or any unknown type.
 */
export function renderBuiltinField(
  widgetType: WidgetType,
  props: FieldProps
): React.ReactNode {
  switch (widgetType) {
    case "select":
    case "hotkey": // hotkey uses a select control for now
      return (
        <SelectField
          label={props.label}
          description={props.description}
          value={toStringValue(props.value)}
          options={props.options ?? []}
          onChange={(v) => props.onChange(convertToTypedValue(v))}
        />
      );
    case "switch":
      return (
        <SwitchField
          label={props.label}
          description={props.description}
          checked={Boolean(props.value)}
          onChange={(v) => props.onChange(v)}
        />
      );
    case "input":
      return (
        <InputField
          label={props.label}
          description={props.description}
          value={toStringValue(props.value)}
          placeholder={props.placeholder}
          onChange={(v) => props.onChange(convertToTypedValue(v))}
        />
      );
    case "password":
      return (
        <PasswordField
          label={props.label}
          description={props.description}
          value={toStringValue(props.value)}
          placeholder={props.placeholder}
          onChange={(v) => props.onChange(v)}
        />
      );
    default:
      return null;
  }
}

/**
 * Render a custom config-aware widget by name with proper, cast-free types.
 * Returns null for an unknown widget name.
 */
export function renderCustomWidget(
  name: string,
  props: CustomWidgetProps
): React.ReactElement | null {
  const {
    label,
    description,
    config,
    settingKey,
    onChange,
    onProviderChange,
    onModelChange,
  } = props;

  switch (name) {
    case "provider-select":
      return (
        <ProviderSelect
          providerId={config.llm.provider}
          modelId={config.llm.model}
          apiUrl={config.llm.api_url}
          onProviderChange={onProviderChange ?? (() => {})}
          onModelChange={onModelChange ?? (() => {})}
        />
      );
    case "theme-select":
      return (
        <ThemeSelect
          label={label}
          description={description}
          value={config.overlay.theme}
          onChange={(value) => onChange(settingKey, value)}
        />
      );
    case "paste-shortcut-checkboxes":
      return (
        <PasteShortcutCheckboxes
          label={label}
          description={description}
          value={config.paste_shortcuts}
          onChange={(value) => onChange(settingKey, value)}
        />
      );
    case "overlay-backend-select":
      return (
        <OverlayBackendSelector
          label={label}
          description={description}
          value={config.overlay.backend}
          onChange={(value) => onChange(settingKey, value)}
        />
      );
    case "llm-prompt-manager":
      // Self-contained — talks directly to commands.* for CRUD.
      return <LlmPromptManager />;
    case "auto-submit-select":
      return (
        <AutoSubmitSelector
          label={label}
          description={description}
          value={config.auto_submit_key ?? "off"}
          onChange={(value) => onChange(settingKey, value)}
        />
      );
    case "shortcut-binding-list":
      return <ShortcutBindingList />;
    case "always-on-microphone":
      return (
        <AlwaysOnMicrophone
          label={label}
          description={description}
          value={config.always_on_microphone ?? false}
          onChange={(value) => onChange(settingKey, value)}
        />
      );
    case "audio-feedback":
      return (
        <AudioFeedback
          label={label}
          description={description}
          value={config.audio_feedback ?? { enabled: false, volume: 0.6 }}
          onChange={(value) => onChange(settingKey, value)}
        />
      );
    default:
      return null;
  }
}
