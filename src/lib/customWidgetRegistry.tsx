import React from "react";
import AlwaysOnMicrophone from "../components/settings/AlwaysOnMicrophone";
import AudioFeedback from "../components/settings/AudioFeedback";
import AutoSubmitSelector from "../components/settings/AutoSubmitSelector";
import LlmPromptManager from "../components/settings/LlmPromptManager";
import ShortcutBindingList from "../components/settings/ShortcutBindingList";
import OverlayBackendSelector from "../components/settings/OverlayBackendSelector";
import PasteShortcutCheckboxes from "../components/settings/PasteShortcutCheckboxes";
import ProviderSelect from "../components/settings/ProviderSelect";
import ThemeSelect from "../components/settings/ThemeSelect";
import { AppConfig } from "./commands";

export interface CustomWidgetProps {
  label: string;
  description?: string;
  config: AppConfig;
  settingKey: string;
  onChange: (key: string, value: unknown) => void;
  onProviderChange?: (providerId: string, apiUrl: string, defaultModel: string) => void;
  onModelChange?: (modelId: string) => void;
}

type CustomWidgetFactory = (props: CustomWidgetProps) => React.ReactElement | null;

const registry = new Map<string, CustomWidgetFactory>();

export function registerCustomWidget(name: string, factory: CustomWidgetFactory): void {
  registry.set(name, factory);
}

export function renderCustomWidget(
  name: string,
  props: CustomWidgetProps
): React.ReactElement | null {
  const factory = registry.get(name);
  return factory ? factory(props) : null;
}

// --- Register built-in custom widgets ---

registerCustomWidget("provider-select", ({ config, onProviderChange, onModelChange }) => (
  <ProviderSelect
    providerId={config.llm.provider}
    modelId={config.llm.model}
    apiUrl={config.llm.api_url}
    onProviderChange={onProviderChange ?? (() => {})}
    onModelChange={onModelChange ?? (() => {})}
  />
));

registerCustomWidget("theme-select", ({ label, description, config, settingKey, onChange }) => (
  <ThemeSelect
    label={label}
    description={description}
    value={config.overlay.theme}
    onChange={(value) => onChange(settingKey, value)}
  />
));

registerCustomWidget("paste-shortcut-checkboxes", ({
  label,
  description,
  config,
  settingKey,
  onChange
}) => (
  <PasteShortcutCheckboxes
    label={label}
    description={description}
    value={config.paste_shortcuts}
    onChange={(value) => onChange(settingKey, value)}
  />
));

registerCustomWidget("overlay-backend-select", ({
  label,
  description,
  config,
  settingKey,
  onChange,
}) => (
  <OverlayBackendSelector
    label={label}
    description={description}
    value={config.overlay.backend}
    onChange={(value) => onChange(settingKey, value)}
  />
));

// Multi-prompt LLM templates (#1 from Handy recommendations).
// Self-contained — talks directly to commands.* for CRUD, so the
// generic config save flow is bypassed for this section.
registerCustomWidget("llm-prompt-manager", () => <LlmPromptManager />);

// Auto-submit key combo selector (#4 from Handy recommendations).
registerCustomWidget("auto-submit-select", ({
  label,
  description,
  config,
  settingKey,
  onChange,
}) => (
  <AutoSubmitSelector
    label={label}
    description={description}
    value={config.auto_submit_key ?? "off"}
    onChange={(value) => onChange(settingKey, value)}
  />
));

// Multi-binding shortcut list (#2 from Handy recommendations).
registerCustomWidget("shortcut-binding-list", () => <ShortcutBindingList />);

// Always-on microphone toggle + privacy warning (#8 from Handy recommendations).
registerCustomWidget("always-on-microphone", ({
  label,
  description,
  config,
  settingKey,
  onChange,
}) => (
  <AlwaysOnMicrophone
    label={label}
    description={description}
    value={config.always_on_microphone ?? false}
    onChange={(value) => onChange(settingKey, value)}
  />
));

// Audio feedback toggle + volume slider (#6 from Handy recommendations).
registerCustomWidget("audio-feedback", ({
  label,
  description,
  config,
  settingKey,
  onChange,
}) => (
  <AudioFeedback
    label={label}
    description={description}
    value={config.audio_feedback ?? { enabled: false, volume: 0.6 }}
    onChange={(value) => onChange(settingKey, value)}
  />
));
