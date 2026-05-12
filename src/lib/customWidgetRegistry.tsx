import React from "react";
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
