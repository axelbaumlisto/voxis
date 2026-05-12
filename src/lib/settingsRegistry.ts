/**
 * Settings Registry - Declarative settings definitions.
 *
 * OCP: Add settings without modifying SettingsPage.
 * DRY: Single source of truth for setting definitions.
 */

import {
  AUDIO_BOOST_OPTIONS,
  OVERLAY_BACKEND_OPTIONS,
  VAD_BACKEND_OPTIONS,
  BACKEND_OPTIONS,
  CLOUD_PROVIDER_OPTIONS,
  getHotkeyOptions,
  LANGUAGE_OPTIONS,
  OVERLAY_POSITION_OPTIONS,
  OVERLAY_SIZE_OPTIONS,
  WHISPER_MODEL_OPTIONS,
} from "./constants";

export type WidgetType = "select" | "switch" | "input" | "password" | "hotkey" | "custom";

export interface SettingOption {
  label: string;
  value: string;
}

export interface SettingDefinition {
  key: string;
  label: string;
  widgetType: WidgetType;
  section: string;
  /** Static options array */
  options?: SettingOption[];
  /** Dynamic options function (called at render time) */
  getOptions?: () => SettingOption[];
  placeholder?: string;
  description?: string;
  /** For custom widgets, the component name to render */
  customComponent?: string;
}

// =============================================================================
// Settings Registry
// =============================================================================

export const SETTINGS_REGISTRY: SettingDefinition[] = [
  // Provider section
  {
    key: "cloud_provider",
    label: "Provider",
    widgetType: "select",
    section: "Provider",
    options: CLOUD_PROVIDER_OPTIONS,
  },
  {
    key: "api_key",
    label: "API Key",
    widgetType: "password",
    section: "Provider",
    placeholder: "Enter API key",
  },
  {
    key: "model",
    label: "Model",
    widgetType: "select",
    section: "Provider",
    options: WHISPER_MODEL_OPTIONS,
  },
  {
    key: "language",
    label: "Language",
    widgetType: "select",
    section: "Provider",
    options: LANGUAGE_OPTIONS,
  },

  // Recording section
  {
    key: "hotkey",
    label: "Hotkey",
    widgetType: "select",
    section: "Recording",
    getOptions: getHotkeyOptions,
  },
  {
    key: "audio_device",
    label: "Audio Device",
    widgetType: "select",
    section: "Recording",
    options: [{ label: "Default", value: "default" }],
  },

  // Output section
  {
    key: "auto_type",
    label: "Auto-type",
    widgetType: "switch",
    section: "Output",
    description: "Automatically type transcribed text",
  },
  {
    key: "auto_enter",
    label: "Auto-enter",
    widgetType: "switch",
    section: "Output",
    description: "Press Enter after typing",
  },
  {
    key: "typing_delay",
    label: "Typing Delay (ms)",
    widgetType: "input",
    section: "Output",
    placeholder: "12",
  },
  {
    key: "notifications",
    label: "Notifications",
    widgetType: "switch",
    section: "Output",
    description: "Show desktop notifications",
  },
  {
    key: "paste_shortcuts",
    label: "Paste Shortcuts",
    widgetType: "custom",
    section: "Output",
    customComponent: "paste-shortcut-checkboxes",
    description: "Keyboard shortcuts for paste (Linux only)",
  },

  // Overlay section
  {
    key: "overlay.enabled",
    label: "Enabled",
    widgetType: "switch",
    section: "Overlay",
    description: "Show recording overlay",
  },
  {
    key: "overlay.position",
    label: "Position",
    widgetType: "select",
    section: "Overlay",
    options: OVERLAY_POSITION_OPTIONS,
  },
  {
    key: "overlay.size",
    label: "Size",
    widgetType: "select",
    section: "Overlay",
    options: OVERLAY_SIZE_OPTIONS,
  },
  {
    key: "overlay.margin",
    label: "Margin (px)",
    widgetType: "input",
    section: "Overlay",
    placeholder: "30",
  },
  {
    key: "overlay.audio_boost",
    label: "Audio Sensitivity",
    widgetType: "select",
    section: "Overlay",
    description: "Waveform sensitivity (higher = more responsive for quiet mics)",
    options: AUDIO_BOOST_OPTIONS,
  },
  {
    key: "overlay.theme",
    label: "Theme",
    widgetType: "custom",
    section: "Overlay",
    description: "Visualization preset (built-in and custom themes)",
    customComponent: "theme-select",
  },
  {
    key: "overlay.backend",
    label: "Backend",
    widgetType: "select",
    section: "Overlay",
    description: "Overlay rendering backend (advanced)",
    options: OVERLAY_BACKEND_OPTIONS,
  },

  // VAD section
  {
    key: "vad.backend",
    label: "Voice Activity Detection",
    widgetType: "select",
    section: "VAD",
    description: "Filter silence from recordings before transcription",
    options: VAD_BACKEND_OPTIONS,
  },
  {
    key: "vad.onset_frames",
    label: "Onset (frames)",
    widgetType: "input",
    section: "VAD",
    description: "Consecutive voice frames required to trigger speech start (default: 3)",
    placeholder: "3",
  },
  {
    key: "vad.hangover_frames",
    label: "Hangover (frames)",
    widgetType: "input",
    section: "VAD",
    description: "Silence frames tolerated before ending speech (default: 5)",
    placeholder: "5",
  },
  {
    key: "vad.prefill_frames",
    label: "Prefill (frames)",
    widgetType: "input",
    section: "VAD",
    description: "Past frames included when speech starts (default: 2)",
    placeholder: "2",
  },

  // LLM section
  {
    key: "llm.enabled",
    label: "Enable LLM",
    widgetType: "switch",
    section: "LLM",
    description: "Use LLM for grammar correction",
  },
  // OCP: Provider/model selection handled via custom widget
  {
    key: "llm.provider",
    label: "LLM Provider",
    widgetType: "custom",
    section: "LLM",
    customComponent: "provider-select",
    description: "Select LLM provider and model",
  },
  {
    key: "llm.api_key",
    label: "LLM API Key",
    widgetType: "password",
    section: "LLM",
    placeholder: "Leave empty to use main API key",
  },

  // Advanced section
  {
    key: "text_processing",
    label: "Text Processing",
    widgetType: "switch",
    section: "Advanced",
    description: "Apply dictionary replacements",
  },
  {
    key: "debug",
    label: "Debug Mode",
    widgetType: "switch",
    section: "Advanced",
    description: "Enable debug logging",
  },
  {
    key: "backend",
    label: "Display Backend",
    widgetType: "select",
    section: "Advanced",
    options: BACKEND_OPTIONS,
  },
];

/**
 * Get unique section names in order of appearance.
 */
export function getSections(): string[] {
  const seen = new Set<string>();
  const sections: string[] = [];
  for (const setting of SETTINGS_REGISTRY) {
    if (!seen.has(setting.section)) {
      seen.add(setting.section);
      sections.push(setting.section);
    }
  }
  return sections;
}

/**
 * Get settings for a specific section.
 */
export function getSettingsBySection(section: string): SettingDefinition[] {
  return SETTINGS_REGISTRY.filter((s) => s.section === section);
}
