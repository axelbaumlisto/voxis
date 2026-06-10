import { vi } from "vitest";
import type { AppConfig, HistoryEntry, DictionaryEntry, AudioDevice, TranscriptionResult, LlmProvider } from "../../lib/commands";

// =============================================================================
// Mock Data
// =============================================================================

export const mockConfig: AppConfig = {
  api_key: "test-api-key",
  model: "whisper-large-v3",
  language: "auto",
  hotkey: "ctrl_r",
  auto_type: true,
  auto_enter: false,
  typing_delay: 12,
  notifications: true,
  backend: "auto",
  debug: false,
  audio_device: "default",
  history_enabled: true,
  history_days: 30,
  active_provider: "cloud",
  cloud_provider: "groq",
  local_backend: "faster-whisper",
  text_processing: true,
  paste_shortcuts: "ctrl_shift_v",
  vad: {
    enabled: false,
    threshold: 0.5,
  },
  overlay: {
    enabled: true,
    position: "bottom_right",
    size: "medium",
    margin: 30,
    audio_boost: 800,
    theme: "default",
  },
  llm: {
    enabled: false,
    provider: "groq",
    api_url: "",
    api_key: "",
    model: "llama-3.1-8b-instant",
    prompt: "",
  },
  dictionary: {
    path: "",
    learning_mode: "off",
    learning_threshold: 3,
  },
};

export const mockHistoryEntries: HistoryEntry[] = [
  {
    id: 1,
    timestamp: "2024-01-15 10:30:00",
    text: "Hello, this is a test transcription.",
    language: "en",
    duration: 2.5,
  },
  {
    id: 2,
    timestamp: "2024-01-15 11:00:00",
    text: "Привет, это тестовая транскрипция.",
    language: "ru",
    duration: 3.1,
  },
];

export const mockDictionaryEntries: DictionaryEntry[] = [
  { id: 1, source: "солид", replacement: "SOLID" },
  { id: 2, source: "кисс", replacement: "KISS" },
  { id: 3, source: "драй", replacement: "DRY" },
];

export const mockAudioDevices: AudioDevice[] = [
  { id: "default", name: "Default Device", is_default: true },
  { id: "hw:0,0", name: "Built-in Microphone", is_default: false },
];

export const mockTranscriptionResult: TranscriptionResult = {
  text: "Hello, this is a test transcription.",
  language: "en",
  duration: 2.5,
};

export const mockLlmProviders: LlmProvider[] = [
  {
    id: "openai",
    name: "OpenAI",
    api_url: "https://api.openai.com/v1/chat/completions",
    models: [
      { id: "gpt-4", name: "GPT-4" },
      { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo" },
    ],
    default_model: "gpt-4",
    builtin: true,
  },
  {
    id: "groq",
    name: "Groq",
    api_url: "https://api.groq.com/openai/v1/chat/completions",
    models: [
      { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B" },
      { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B" },
    ],
    default_model: "llama-3.1-8b-instant",
    builtin: true,
  },
  {
    id: "custom-provider",
    name: "Custom Provider",
    api_url: "https://custom.api.com/v1",
    models: [{ id: "custom-model", name: "Custom Model" }],
    default_model: "custom-model",
    builtin: false,
  },
];

// Recording state for mocks
let mockIsRecording = false;

// =============================================================================
// Mock Invoke
// =============================================================================

export const mockInvoke = vi.fn();

// Default mock implementations
export function setupDefaultMocks() {
  mockIsRecording = false;
  mockInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    switch (cmd) {
      case "get_config":
        return { ...mockConfig };
      case "save_config":
        return undefined;
      case "get_history":
        return [...mockHistoryEntries];
      case "add_history_entry":
        return undefined;
      case "clear_history":
        return undefined;
      case "get_dictionary":
        return [...mockDictionaryEntries];
      case "add_dictionary_entry":
        return undefined;
      case "delete_dictionary_entry":
        return undefined;
      case "update_dictionary_entry":
        return undefined;
      // Pending suggestions commands
      case "get_pending_suggestions":
        return [];
      case "get_pending_count":
        return 0;
      case "approve_suggestion":
        return undefined;
      case "approve_suggestion_by_source":
        return undefined;
      case "reject_suggestion":
        return undefined;
      case "reject_suggestion_by_source":
        return undefined;
      case "reprocess_history_for_suggestions":
        return { processed: 0, suggestions_found: 0 };
      // Debug commands
      case "get_debug_entries":
        return [];
      case "clear_debug":
        return undefined;
      case "get_debug_dir":
        return "/home/user/.config/soupawhisper/debug";
      // Recording commands
      case "list_audio_devices":
        return [...mockAudioDevices];
      case "start_recording":
        mockIsRecording = true;
        return undefined;
      case "stop_recording":
        mockIsRecording = false;
        return undefined;
      case "get_recording_status":
        return mockIsRecording;
      case "get_audio_level":
        return mockIsRecording ? 50 : 0;
      // Transcription commands
      case "transcribe_audio":
        return { ...mockTranscriptionResult };
      // Output commands
      case "copy_to_clipboard":
        return undefined;
      case "type_text":
        return undefined;
      // Overlay commands
      case "show_overlay":
        return undefined;
      case "hide_overlay":
        return undefined;
      case "update_overlay_position":
        return undefined;
      case "get_visualization_themes":
        return [
          { id: "default", name: "Default", description: "Blue, green, orange colors" },
          { id: "living_reed", name: "Living Reed", description: "Balanced calm organic ring" },
          { id: "custom_theme", name: "Custom Theme", description: "Custom theme" },
        ];
      case "reload_visualization_themes":
        return undefined;
      case "preview_visualization_theme":
        return undefined;
      // LLM Provider commands
      case "get_llm_providers":
        return [...mockLlmProviders];
      case "add_llm_provider":
        return undefined;
      case "update_llm_provider":
        return undefined;
      case "remove_llm_provider":
        return undefined;
      // Manual recording commands (event-based orchestrator)
      case "manual_start_recording":
        mockIsRecording = true;
        return undefined;
      case "manual_stop_recording":
        mockIsRecording = false;
        return undefined;
      // Permission commands
      case "check_permissions":
        return [
          { name: "Accessibility", status: "granted", description: "Required for global hotkey detection" },
          { name: "Microphone", status: "granted", description: "Required for audio recording" },
        ];
      case "open_permission_settings":
        return undefined;
      case "request_microphone_permission":
        return true;
      case "get_failed_transcriptions":
        return [];
      case "retry_transcription":
        return "";
      case "dismiss_failed_transcription":
        return undefined;
      default:
        throw new Error(`Unknown command: ${cmd}`);
    }
  });
}

export function resetMocks() {
  mockInvoke.mockReset();
  setupDefaultMocks();
}

// =============================================================================
// Mock @tauri-apps/api
// =============================================================================

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: vi.fn().mockReturnValue("macos"),
}));
