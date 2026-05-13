import { invoke } from "@tauri-apps/api/core";

// =============================================================================
// Types
// =============================================================================

/**
 * Hand-maintained TypeScript view of the Rust `AppConfig` struct.
 *
 * Kept in sync with `src-tauri/src/config/mod.rs::AppConfig`. The
 * auto-generated `src/bindings.ts` has the canonical shape but uses
 * `?: T | undefined` for every field (specta default), which is
 * inconvenient for the settings UI — hand-curated required-fields
 * version stays here.
 *
 * When adding a field in Rust, ALSO add it here. The two are
 * regression-checked indirectly via the e2e settings save test
 * (which round-trips every key).
 */
export interface AppConfig {
  api_key: string;
  model: string;
  language: string;
  hotkey: string;
  hotkey_hold_ms: number;
  hotkey_mode: string;
  auto_type: boolean;
  auto_enter: boolean;
  append_trailing_space: boolean;
  translate_to_english: boolean;
  auto_submit_key: "off" | "enter" | "cmd_enter" | "shift_enter";
  audio_feedback: { enabled: boolean; volume: number };
  always_on_microphone: boolean;
  typing_delay: number;
  notifications: boolean;
  backend: string;
  debug: boolean;
  audio_device: string;
  history_enabled: boolean;
  history_days: number;
  retention_period: string;
  retention_limit: number;
  active_provider: string;
  cloud_provider: string;
  local_backend: string;
  text_processing: boolean;
  paste_shortcuts: string;
  first_run_completed: boolean;
  vad: VadConfig;
  overlay: OverlayConfig;
  llm: LlmConfig;
  dictionary: DictionaryConfig;
}

export interface VadConfig {
  enabled: boolean;
  backend: string;
  threshold: number;
  onset_frames: number;
  hangover_frames: number;
  prefill_frames: number;
}

export interface OverlayConfig {
  enabled: boolean;
  position: string;
  size: string;
  margin: number;
  audio_boost: number;
  theme: string;
  backend: string;
}

export interface LlmConfig {
  enabled: boolean;
  provider: string;
  api_url: string;
  api_key: string;
  model: string;
  prompt: string;
}

export interface DictionaryConfig {
  path: string;
  learning_mode: string;
  learning_threshold: number;
}

export interface HistoryEntry {
  id: number;
  timestamp: string;
  text: string;
  language: string | null;
  duration: number | null;
}

export interface DictionaryEntry {
  id: number;
  source: string;
  replacement: string;
}

export interface PendingSuggestion {
  id: number;
  source: string;
  replacement: string;
  count: number;
  first_seen: string;
  last_seen: string;
}

export interface AudioDevice {
  id: string;
  name: string;
  is_default: boolean;
}

export interface LlmModel {
  id: string;
  name: string;
}

export interface LlmProvider {
  id: string;
  name: string;
  api_url: string;
  models: LlmModel[];
  default_model: string;
  builtin: boolean;
}

export interface TranscriptionResult {
  text: string;
  language: string | null;
  duration: number | null;
}

// =============================================================================
// Config Commands
// =============================================================================

export async function getConfig(): Promise<AppConfig> {
  return invoke<AppConfig>("get_config");
}

export async function saveConfig(config: AppConfig): Promise<void> {
  return invoke("save_config", { config });
}

// =============================================================================
// History Commands
// =============================================================================

export async function getHistory(limit?: number): Promise<HistoryEntry[]> {
  return invoke<HistoryEntry[]>("get_history", { limit });
}

export async function addHistoryEntry(
  text: string,
  language?: string,
  duration?: number
): Promise<void> {
  return invoke("add_history_entry", { text, language, duration });
}

export async function clearHistory(): Promise<void> {
  return invoke("clear_history");
}

// =============================================================================
// Dictionary Commands
// =============================================================================

export async function getDictionary(): Promise<DictionaryEntry[]> {
  return invoke<DictionaryEntry[]>("get_dictionary");
}

export async function addDictionaryEntry(
  source: string,
  replacement: string
): Promise<void> {
  return invoke("add_dictionary_entry", { source, replacement });
}

export async function deleteDictionaryEntry(id: number): Promise<void> {
  return invoke("delete_dictionary_entry", { id });
}

export async function updateDictionaryEntry(
  id: number,
  source: string,
  replacement: string
): Promise<void> {
  return invoke("update_dictionary_entry", { id, source, replacement });
}

// =============================================================================
// Pending Suggestions Commands
// =============================================================================

export async function getPendingSuggestions(): Promise<PendingSuggestion[]> {
  return invoke<PendingSuggestion[]>("get_pending_suggestions");
}

export async function getPendingCount(): Promise<number> {
  return invoke<number>("get_pending_count");
}

export async function approveSuggestion(id: number): Promise<void> {
  return invoke("approve_suggestion", { id });
}

export async function approveSuggestionBySource(
  source: string,
  replacement: string
): Promise<void> {
  return invoke("approve_suggestion_by_source", { source, replacement });
}

export async function rejectSuggestion(id: number): Promise<void> {
  return invoke("reject_suggestion", { id });
}

export async function rejectSuggestionBySource(
  source: string,
  replacement: string
): Promise<void> {
  return invoke("reject_suggestion_by_source", { source, replacement });
}

export interface ReprocessResult {
  processed: number;
  suggestions_found: number;
}

export async function reprocessHistoryForSuggestions(
  limit?: number
): Promise<ReprocessResult> {
  return invoke<ReprocessResult>("reprocess_history_for_suggestions", { limit });
}

// =============================================================================
// Recording Commands
// =============================================================================

export async function listAudioDevices(): Promise<AudioDevice[]> {
  return invoke<AudioDevice[]>("list_audio_devices");
}

export async function startRecording(deviceId?: string): Promise<void> {
  return invoke("start_recording", { deviceId });
}

export async function stopRecording(): Promise<void> {
  return invoke("stop_recording");
}

export async function getRecordingStatus(): Promise<boolean> {
  return invoke<boolean>("get_recording_status");
}

export async function getAudioLevel(): Promise<number> {
  return invoke<number>("get_audio_level");
}

export async function getSpectrumBins(): Promise<number[]> {
  return invoke<number[]>("get_spectrum_bins");
}

// =============================================================================
// Transcription Commands
// =============================================================================

export async function transcribeAudio(
  apiKey: string,
  model?: string,
  language?: string
): Promise<TranscriptionResult> {
  return invoke<TranscriptionResult>("transcribe_audio", {
    apiKey,
    model,
    language,
  });
}

// =============================================================================
// Output Commands
// =============================================================================

export async function copyToClipboard(text: string): Promise<void> {
  return invoke("copy_to_clipboard", { text });
}

export async function typeText(text: string): Promise<void> {
  return invoke("type_text", { text });
}

// =============================================================================
// Overlay Commands
// =============================================================================

export type OverlayState =
  | "hidden"
  | "idle"
  | "recording"
  | "transcribing"
  | { error: string };

export type OverlayPosition =
  | "bottom_left"
  | "bottom_right"
  | "top_left"
  | "top_right"
  | "center"
  | "top_center"
  | "bottom_center";

export async function showOverlay(state: OverlayState): Promise<void> {
  return invoke("show_overlay", { state });
}

export async function hideOverlay(): Promise<void> {
  return invoke("hide_overlay");
}

export async function updateOverlayPosition(
  position: OverlayPosition,
  margin: number
): Promise<void> {
  return invoke("update_overlay_position", { position, margin });
}

// =============================================================================
// Visualization Theme Commands
// =============================================================================

export interface ThemeInfo {
  id: string;
  name: string;
  description: string;
}

export interface ThemeTestResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

export interface ThemeColors {
  use_gradient: boolean;
  gradient_bottom: string;
  gradient_middle: string;
  gradient_top: string;
  recording: string;
  transcribing: string;
  idle: string;
}

export async function getVisualizationThemes(): Promise<ThemeInfo[]> {
  return invoke<ThemeInfo[]>("get_visualization_themes");
}

export async function validateVisualizationTheme(
  themeId: string
): Promise<ThemeTestResult> {
  return invoke<ThemeTestResult>("validate_visualization_theme", { themeId });
}

export async function getThemesDir(): Promise<string> {
  return invoke<string>("get_themes_dir");
}

export async function exportBuiltinTheme(themeId: string): Promise<string> {
  return invoke<string>("export_builtin_theme", { themeId });
}

export async function reloadVisualizationThemes(): Promise<void> {
  return invoke("reload_visualization_themes");
}

export async function previewVisualizationTheme(
  themeId: string,
  reloadFromDisk = false
): Promise<void> {
  return invoke("preview_visualization_theme", { themeId, reloadFromDisk });
}

export async function getThemeColors(themeId: string): Promise<ThemeColors> {
  return invoke<ThemeColors>("get_theme_colors", { themeId });
}

// =============================================================================
// Debug Commands
// =============================================================================

export interface TranscriptionLog {
  provider: string;
  model: string;
  language: string | null;
  duration_ms: number;
  text: string;
}

export interface LlmLog {
  provider: string;
  model: string;
  prompt: string;
  input_text: string;
  output_text: string;
  duration_ms: number;
}

export interface DebugEntry {
  timestamp: string;
  audio_file: string | null;
  audio_size_bytes: number;
  transcription: TranscriptionLog | null;
  llm: LlmLog | null;
}

export async function getDebugEntries(limit?: number): Promise<DebugEntry[]> {
  return invoke<DebugEntry[]>("get_debug_entries", { limit });
}

export async function clearDebug(): Promise<void> {
  return invoke("clear_debug");
}

export async function getDebugDir(): Promise<string> {
  return invoke<string>("get_debug_dir");
}

// =============================================================================
// LLM Provider Commands
// =============================================================================

export async function getLlmProviders(): Promise<LlmProvider[]> {
  return invoke<LlmProvider[]>("get_llm_providers");
}

export async function addLlmProvider(
  provider: Omit<LlmProvider, "builtin">
): Promise<void> {
  return invoke("add_llm_provider", { provider: { ...provider, builtin: false } });
}

export async function removeLlmProvider(id: string): Promise<void> {
  return invoke("remove_llm_provider", { id });
}

export async function updateLlmProvider(provider: LlmProvider): Promise<void> {
  return invoke("update_llm_provider", { provider });
}

// =============================================================================
// Permission Commands
// =============================================================================

export interface PermissionInfo {
  name: string;
  status: "granted" | "denied" | "unknown";
  description: string;
}

export async function checkPermissions(): Promise<PermissionInfo[]> {
  return invoke<PermissionInfo[]>("check_permissions");
}

export async function openPermissionSettings(permission: string): Promise<void> {
  return invoke("open_permission_settings", { permission });
}

export async function requestMicrophonePermission(): Promise<boolean> {
  return invoke<boolean>("request_microphone_permission");
}

export async function requestAccessibilityPermission(): Promise<boolean> {
  return invoke<boolean>("request_accessibility_permission");
}

export async function restartApp(): Promise<void> {
  return invoke("restart_app");
}

export async function bringToFront(): Promise<void> {
  return invoke("bring_to_front");
}

// =============================================================================
// Failed Transcriptions Commands
// =============================================================================

export interface FailedTranscription {
  id: string;
  error: string;
  whisper_text: string | null;
  timestamp: string;
  provider: string;
}

export async function getFailedTranscriptions(): Promise<FailedTranscription[]> {
  return invoke<FailedTranscription[]>("get_failed_transcriptions");
}

export async function retryTranscription(id: string): Promise<string> {
  return invoke<string>("retry_transcription", { id });
}

export async function dismissFailedTranscription(id: string): Promise<void> {
  return invoke<void>("dismiss_failed_transcription", { id });
}
