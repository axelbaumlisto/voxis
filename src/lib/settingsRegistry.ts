/**
 * Settings Registry - Declarative settings definitions.
 *
 * OCP: Add settings without modifying SettingsPage.
 * DRY: Single source of truth for setting definitions.
 */

import {
  AUDIO_BOOST_OPTIONS,
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
  /** Optional i18n key resolved at the render boundary; falls back to label. */
  labelKey?: string;
}

export interface SettingDefinition {
  key: string;
  label: string;
  /** i18n key for the label, resolved via t() at the render boundary. */
  labelKey?: string;
  widgetType: WidgetType;
  section: string;
  /** Static options array */
  options?: SettingOption[];
  /** Dynamic options function (called at render time) */
  getOptions?: () => SettingOption[];
  placeholder?: string;
  description?: string;
  /** i18n key for the description, resolved via t() at the render boundary. */
  descriptionKey?: string;
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
    labelKey: "settings.provider",
    widgetType: "select",
    section: "Provider",
    options: CLOUD_PROVIDER_OPTIONS,
  },
  {
    key: "api_key",
    label: "API Key",
    labelKey: "settings.apiKey",
    widgetType: "password",
    section: "Provider",
    placeholder: "Enter API key",
  },
  {
    key: "model",
    label: "Model",
    labelKey: "settings.model",
    widgetType: "select",
    section: "Provider",
    options: WHISPER_MODEL_OPTIONS,
  },
  {
    key: "language",
    label: "Language",
    labelKey: "settings.language",
    widgetType: "select",
    section: "Provider",
    options: LANGUAGE_OPTIONS,
  },

  // Recording section
  {
    key: "hotkey",
    label: "Hotkey",
    labelKey: "settings.hotkey",
    widgetType: "select",
    section: "Recording",
    getOptions: getHotkeyOptions,
  },
  {
    key: "hotkey_hold_ms",
    label: "Hold Threshold (ms)",
    labelKey: "settings.hotkeyHoldMs",
    widgetType: "input",
    section: "Recording",
    placeholder: "300",
    description:
      "Minimum hold time before recording starts. Short presses are treated as key combinations (e.g. AltGr+R).",
    descriptionKey: "settings.hotkeyHoldMsDesc",
  },
  {
    key: "shortcut_bindings",
    label: "Shortcut bindings",
    labelKey: "settings.shortcutBindings",
    widgetType: "custom",
    section: "Recording",
    description:
      "Map keys to different actions (raw transcribe / transcribe + LLM post-process). The legacy single Hotkey above stays for back-compat.",
    descriptionKey: "settings.shortcutBindingsDesc",
    customComponent: "shortcut-binding-list",
  },
  {
    key: "hotkey_mode",
    label: "Activation mode",
    labelKey: "settings.hotkeyMode",
    widgetType: "select",
    section: "Recording",
    description:
      "Hold: record while the key is held (legacy). Toggle: tap to start, tap again to stop — friendlier for long dictation.",
    descriptionKey: "settings.hotkeyModeDesc",
    options: [
      { label: "Hold (legacy)", labelKey: "settings.options.hotkeyModeHold", value: "hold" },
      { label: "Toggle (tap to start/stop)", labelKey: "settings.options.hotkeyModeToggle", value: "toggle" },
    ],
  },
  {
    key: "always_on_microphone",
    label: "Always-on microphone",
    labelKey: "settings.alwaysOnMicrophone",
    widgetType: "custom",
    section: "Recording",
    description:
      "Keep the audio capture stream alive between recordings to remove the cold-start delay on the first sample of each take.",
    descriptionKey: "settings.alwaysOnMicrophoneDesc",
    customComponent: "always-on-microphone",
  },
  {
    key: "audio_device",
    label: "Audio Device",
    labelKey: "settings.audioDevice",
    widgetType: "select",
    section: "Recording",
    options: [{ label: "Default", labelKey: "settings.options.audioDeviceDefault", value: "default" }],
  },

  // Output section
  {
    key: "auto_type",
    label: "Auto-type",
    labelKey: "settings.autoType",
    widgetType: "switch",
    section: "Output",
    description: "Automatically type transcribed text",
    descriptionKey: "settings.autoTypeDesc",
  },
  {
    key: "auto_enter",
    label: "Auto-enter",
    labelKey: "settings.autoEnter",
    widgetType: "switch",
    section: "Output",
    description: "Press Enter after typing",
    descriptionKey: "settings.autoEnterDesc",
  },
  {
    key: "append_trailing_space",
    label: "Append trailing space",
    labelKey: "settings.appendTrailingSpace",
    widgetType: "switch",
    section: "Output",
    description:
      "Add a single space after each dictation so consecutive recordings don't merge. No-op if the text already ends in whitespace.",
    descriptionKey: "settings.appendTrailingSpaceDesc",
  },
  {
    key: "translate_to_english",
    label: "Translate to English",
    labelKey: "settings.translateToEnglish",
    widgetType: "switch",
    section: "Output",
    description:
      "Ask Whisper to translate the audio to English instead of transcribing in the source language (Groq / OpenAI task=translate).",
    descriptionKey: "settings.translateToEnglishDesc",
  },
  {
    key: "auto_submit_key",
    label: "Auto-submit after typing",
    labelKey: "settings.autoSubmitKey",
    widgetType: "custom",
    section: "Output",
    description:
      "Press Enter (or Cmd/Super/Shift + Enter) after the transcription is typed so chat clients send the message without you touching the keyboard.",
    descriptionKey: "settings.autoSubmitKeyDesc",
    customComponent: "auto-submit-select",
  },
  {
    key: "audio_feedback",
    label: "Audio feedback",
    labelKey: "settings.audioFeedback",
    widgetType: "custom",
    section: "Output",
    description:
      "Short beeps on recording start, stop, and failure so you know the hotkey registered without looking at the overlay.",
    descriptionKey: "settings.audioFeedbackDesc",
    customComponent: "audio-feedback",
  },
  {
    key: "typing_delay",
    label: "Typing Delay (ms)",
    labelKey: "settings.typingDelay",
    widgetType: "input",
    section: "Output",
    placeholder: "12",
  },
  {
    key: "notifications",
    label: "Notifications",
    labelKey: "settings.notifications",
    widgetType: "switch",
    section: "Output",
    description: "Show desktop notifications",
    descriptionKey: "settings.notificationsDesc",
  },
  {
    key: "paste_shortcuts",
    label: "Paste Shortcuts",
    labelKey: "settings.pasteShortcuts",
    widgetType: "custom",
    section: "Output",
    customComponent: "paste-shortcut-checkboxes",
    description: "Keyboard shortcuts for paste (Linux only)",
    descriptionKey: "settings.pasteShortcutsDesc",
  },

  // Overlay section
  {
    key: "overlay.enabled",
    label: "Enabled",
    labelKey: "settings.overlayEnabled",
    widgetType: "switch",
    section: "Overlay",
    description: "Show recording overlay",
    descriptionKey: "settings.overlayEnabledDesc",
  },
  {
    key: "overlay.position",
    label: "Position",
    labelKey: "settings.overlayPosition",
    widgetType: "select",
    section: "Overlay",
    options: OVERLAY_POSITION_OPTIONS,
  },
  {
    key: "overlay.size",
    label: "Size",
    labelKey: "settings.overlaySize",
    widgetType: "select",
    section: "Overlay",
    options: OVERLAY_SIZE_OPTIONS,
  },
  {
    key: "overlay.margin",
    label: "Margin (px)",
    labelKey: "settings.overlayMargin",
    widgetType: "input",
    section: "Overlay",
    placeholder: "30",
  },
  {
    key: "overlay.audio_boost",
    label: "Audio Sensitivity",
    labelKey: "settings.audioSensitivity",
    widgetType: "select",
    section: "Overlay",
    description: "Waveform sensitivity (higher = more responsive for quiet mics)",
    descriptionKey: "settings.audioSensitivityDesc",
    options: AUDIO_BOOST_OPTIONS,
  },
  {
    key: "overlay.theme",
    label: "Theme",
    labelKey: "settings.theme",
    widgetType: "custom",
    section: "Overlay",
    description: "Visualization preset (built-in and custom themes)",
    descriptionKey: "settings.themeDesc",
    customComponent: "theme-select",
  },
  {
    key: "overlay.backend",
    label: "Backend",
    labelKey: "settings.overlayBackend",
    widgetType: "custom",
    section: "Overlay",
    description: "Overlay rendering backend (advanced)",
    descriptionKey: "settings.overlayBackendDesc",
    customComponent: "overlay-backend-select",
  },

  // VAD section
  {
    key: "vad.backend",
    label: "Voice Activity Detection",
    labelKey: "settings.vadBackend",
    widgetType: "select",
    section: "VAD",
    description: "Filter silence from recordings before transcription",
    descriptionKey: "settings.vadBackendDesc",
    options: VAD_BACKEND_OPTIONS,
  },
  {
    key: "vad.onset_frames",
    label: "Onset (frames)",
    labelKey: "settings.vadOnsetFrames",
    widgetType: "input",
    section: "VAD",
    description: "Consecutive voice frames required to trigger speech start (default: 3)",
    descriptionKey: "settings.vadOnsetFramesDesc",
    placeholder: "3",
  },
  {
    key: "vad.hangover_frames",
    label: "Hangover (frames)",
    labelKey: "settings.vadHangoverFrames",
    widgetType: "input",
    section: "VAD",
    description: "Silence frames tolerated before ending speech (default: 5)",
    descriptionKey: "settings.vadHangoverFramesDesc",
    placeholder: "5",
  },
  {
    key: "vad.prefill_frames",
    label: "Prefill (frames)",
    labelKey: "settings.vadPrefillFrames",
    widgetType: "input",
    section: "VAD",
    description: "Past frames included when speech starts (default: 2)",
    descriptionKey: "settings.vadPrefillFramesDesc",
    placeholder: "2",
  },

  // LLM section
  {
    key: "llm.enabled",
    label: "Enable LLM",
    labelKey: "settings.enableLlm",
    widgetType: "switch",
    section: "LLM",
    description: "Use LLM for grammar correction",
    descriptionKey: "settings.enableLlmDesc",
  },
  // OCP: Provider/model selection handled via custom widget
  {
    key: "llm.provider",
    label: "LLM Provider",
    labelKey: "settings.llmProvider",
    widgetType: "custom",
    section: "LLM",
    customComponent: "provider-select",
    description: "Select LLM provider and model",
    descriptionKey: "settings.llmProviderDesc",
  },
  {
    key: "llm.api_key",
    label: "LLM API Key",
    labelKey: "settings.llmApiKey",
    widgetType: "password",
    section: "LLM",
    placeholder: "Leave empty to use main API key",
  },
  {
    key: "llm.prompts",
    label: "Prompt templates",
    labelKey: "settings.llmPrompts",
    widgetType: "custom",
    section: "LLM",
    description:
      "Multiple named prompts for the LLM post-processor. The selected template wins; if none is selected the legacy llm.prompt string is used (back-compat).",
    descriptionKey: "settings.llmPromptsDesc",
    customComponent: "llm-prompt-manager",
  },

  // History / privacy section
  {
    key: "retention_period",
    label: "History retention",
    labelKey: "settings.retentionPeriod",
    widgetType: "select",
    section: "History",
    description:
      "Auto-delete old transcription history. 'Never' keeps everything; 'preserve_limit' keeps only the N most recent (see Recent Limit below).",
    descriptionKey: "settings.retentionPeriodDesc",
    options: [
      { label: "Never (keep everything)", labelKey: "settings.options.retentionNever", value: "never" },
      { label: "Only the N most recent", labelKey: "settings.options.retentionLimitOnly", value: "preserve_limit" },
      { label: "3 days", labelKey: "settings.options.retention3Days", value: "days_3" },
      { label: "2 weeks", labelKey: "settings.options.retention2Weeks", value: "weeks_2" },
      { label: "3 months", labelKey: "settings.options.retention3Months", value: "months_3" },
    ],
  },
  {
    key: "retention_limit",
    label: "Recent limit (preserve_limit policy)",
    labelKey: "settings.retentionLimit",
    widgetType: "input",
    section: "History",
    placeholder: "100",
    description:
      "How many recent entries to keep when 'History retention' is set to 'Only the N most recent'.",
    descriptionKey: "settings.retentionLimitDesc",
  },

  // Advanced section
  {
    key: "text_processing",
    label: "Text Processing",
    labelKey: "settings.textProcessing",
    widgetType: "switch",
    section: "Advanced",
    description: "Apply dictionary replacements",
    descriptionKey: "settings.textProcessingDesc",
  },
  {
    key: "debug",
    label: "Debug Mode",
    labelKey: "settings.debug",
    widgetType: "switch",
    section: "Advanced",
    description: "Enable debug logging",
    descriptionKey: "settings.debugDesc",
  },
  {
    key: "backend",
    label: "Display Backend",
    labelKey: "settings.backend",
    widgetType: "select",
    section: "Advanced",
    options: BACKEND_OPTIONS,
  },
];

/**
 * Map raw section strings (used as registry grouping keys) to i18n keys.
 * Resolved via t() at the render boundary (Section.tsx).
 */
export const SECTION_KEY_MAP: Record<string, string> = {
  Provider: "settings.sections.provider",
  Recording: "settings.sections.recording",
  Output: "settings.sections.output",
  Overlay: "settings.sections.overlay",
  VAD: "settings.sections.vad",
  LLM: "settings.sections.llm",
  History: "settings.sections.history",
  Advanced: "settings.sections.advanced",
};

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
