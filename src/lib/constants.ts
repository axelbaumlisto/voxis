/**
 * Centralized constants for the application.
 *
 * DRY: Single source of truth for UI labels and values.
 * Keep in sync with src-tauri/src/config/consts.rs for validation.
 */

// =============================================================================
// Types
// =============================================================================

export interface SelectOption {
  label: string;
  value: string;
}

type Platform = 'macos' | 'windows' | 'linux';

interface HotkeyOptionDef {
  label: string;
  macLabel?: string;  // Alternative label for macOS (with symbols)
  value: string;
  platforms?: Platform[];  // Empty = all platforms
}

// Type declaration for Tauri plugin-os internals
interface TauriOsPluginInternals {
  platform: string;
  eol: string;
  version: string;
}

export const LANGUAGE_OPTIONS: SelectOption[] = [
  { label: "Auto-detect", value: "auto" },
  { label: "Russian", value: "ru" },
  { label: "English", value: "en" },
  { label: "German", value: "de" },
  { label: "French", value: "fr" },
  { label: "Spanish", value: "es" },
  { label: "Chinese", value: "zh" },
  { label: "Japanese", value: "ja" },
  { label: "Korean", value: "ko" },
  { label: "Portuguese", value: "pt" },
  { label: "Italian", value: "it" },
  { label: "Dutch", value: "nl" },
  { label: "Polish", value: "pl" },
  { label: "Ukrainian", value: "uk" },
];

// =============================================================================
// Backend Options
// =============================================================================

export const BACKEND_OPTIONS: SelectOption[] = [
  { label: "Auto", value: "auto" },
  { label: "X11", value: "x11" },
  { label: "Wayland", value: "wayland" },
  { label: "macOS", value: "darwin" },
  { label: "Windows", value: "windows" },
];

// =============================================================================
// Overlay Options
// =============================================================================

export const OVERLAY_POSITION_OPTIONS: SelectOption[] = [
  { label: "Bottom Left", value: "bottom_left" },
  { label: "Bottom Right", value: "bottom_right" },
  { label: "Bottom Center", value: "bottom_center" },
  { label: "Top Left", value: "top_left" },
  { label: "Top Right", value: "top_right" },
  { label: "Top Center", value: "top_center" },
  { label: "Center", value: "center" },
  { label: "Left Center", value: "left_center" },
  { label: "Right Center", value: "right_center" },
];

export const OVERLAY_SIZE_OPTIONS: SelectOption[] = [
  { label: "Small", value: "small" },
  { label: "Medium", value: "medium" },
  { label: "Large", value: "large" },
];

// =============================================================================
// Overlay Backend Options
// =============================================================================

export const OVERLAY_BACKEND_OPTIONS: SelectOption[] = [
  { label: "Auto (recommended)", value: "auto" },
  { label: "Native (egui)", value: "native" },
  { label: "Subprocess", value: "subprocess" },
  { label: "NSPanel (macOS only)", value: "nspanel" },
  { label: "Off", value: "none" },
];

// =============================================================================
// VAD Options
// =============================================================================

export const VAD_BACKEND_OPTIONS: SelectOption[] = [
  { label: "Off (no filtering)", value: "none" },
  { label: "Threshold (simple RMS)", value: "threshold" },
  { label: "Silero (ML model)", value: "silero" },
];

export const AUDIO_BOOST_OPTIONS: SelectOption[] = [
  { label: "Low (400)", value: "400" },
  { label: "Medium (800)", value: "800" },
  { label: "High (1200)", value: "1200" },
  { label: "Very High (1600)", value: "1600" },
  { label: "Maximum (2000)", value: "2000" },
];

export const OVERLAY_THEME_OPTIONS: SelectOption[] = [
  { label: "Default (Blue/Green)", value: "default" },
  { label: "Winamp Classic", value: "winamp_classic" },
  { label: "Dark Purple", value: "dark" },
  { label: "Neon", value: "neon" },
  { label: "Monochrome", value: "monochrome" },
];

// =============================================================================
// Hotkey Options
// =============================================================================

const ALL_HOTKEY_OPTIONS: HotkeyOptionDef[] = [
  // Modifier keys - platform-specific
  { label: "Right Ctrl", macLabel: "Right ⌃", value: "ctrl_r" },
  { label: "Left Ctrl", macLabel: "Left ⌃", value: "ctrl_l" },
  { label: "Right Alt", macLabel: "Right ⌥", value: "alt_r" },
  { label: "Left Alt", macLabel: "Left ⌥", value: "alt_l" },
  { label: "Right Cmd", macLabel: "Right ⌘", value: "super_r", platforms: ['macos'] },
  { label: "Left Cmd", macLabel: "Left ⌘", value: "super_l", platforms: ['macos'] },
  { label: "Right Win", value: "super_r", platforms: ['windows', 'linux'] },
  { label: "Left Win", value: "super_l", platforms: ['windows', 'linux'] },
  // Function keys - all platforms
  { label: "F12", value: "f12" },
  { label: "F11", value: "f11" },
  { label: "F10", value: "f10" },
  { label: "F9", value: "f9" },
  { label: "F8", value: "f8" },
];

let cachedPlatform: Platform | null = null;

/**
 * Reset cached platform. Used for testing.
 * @internal
 */
export function _resetPlatformCache(): void {
  cachedPlatform = null;
}

/**
 * Get the current platform using Tauri plugin-os internals directly.
 * This avoids importing the plugin which crashes when running outside Tauri.
 * Returns 'linux' as fallback for unknown platforms or when running outside Tauri.
 */
function getCurrentPlatform(): Platform {
  if (cachedPlatform === null) {
    // Access Tauri plugin-os internals directly to avoid import issues
    if (typeof window !== 'undefined') {
      const internals = (window as any).__TAURI_OS_PLUGIN_INTERNALS__ as TauriOsPluginInternals | undefined;
      if (internals?.platform) {
        const p = internals.platform;
        if (p === 'macos' || p === 'windows' || p === 'linux') {
          cachedPlatform = p;
        } else {
          cachedPlatform = 'linux';
        }
      } else {
        // Fallback when running outside Tauri (e.g., in Vite dev or E2E tests)
        cachedPlatform = 'linux';
      }
    } else {
      cachedPlatform = 'linux';
    }
  }
  return cachedPlatform;
}

/**
 * Get hotkey options filtered and labeled for the current platform.
 * Uses macOS symbols (⌘⌥⌃) on macOS, Windows key names on Windows/Linux.
 */
export function getHotkeyOptions(): SelectOption[] {
  const currentPlatform = getCurrentPlatform();

  return ALL_HOTKEY_OPTIONS
    .filter(opt => !opt.platforms || opt.platforms.includes(currentPlatform))
    .map(opt => ({
      label: currentPlatform === 'macos' && opt.macLabel ? opt.macLabel : opt.label,
      value: opt.value
    }));
}

// Static export for backwards compatibility (used in tests)
export const HOTKEY_OPTIONS: SelectOption[] = [
  { label: "Right Ctrl", value: "ctrl_r" },
  { label: "Left Ctrl", value: "ctrl_l" },
  { label: "Right Alt", value: "alt_r" },
  { label: "Left Alt", value: "alt_l" },
  { label: "F12", value: "f12" },
  { label: "F11", value: "f11" },
  { label: "F10", value: "f10" },
  { label: "F9", value: "f9" },
  { label: "F8", value: "f8" },
];

// =============================================================================
// Provider Options
// =============================================================================

export const CLOUD_PROVIDER_OPTIONS: SelectOption[] = [
  { label: "Groq", value: "groq" },
  { label: "OpenAI", value: "openai" },
];

export const WHISPER_MODEL_OPTIONS: SelectOption[] = [
  { label: "whisper-large-v3", value: "whisper-large-v3" },
  { label: "whisper-large-v3-turbo", value: "whisper-large-v3-turbo" },
];

// =============================================================================
// Learning Mode Options
// =============================================================================

export const LEARNING_MODE_OPTIONS: SelectOption[] = [
  { label: "Disabled", value: "disabled" },
  { label: "Pending (manual)", value: "pending" },
  { label: "Auto", value: "auto" },
];

// =============================================================================
// Paste Shortcut Options (Linux only)
// =============================================================================

export const PASTE_SHORTCUT_OPTIONS: SelectOption[] = [
  { label: "Ctrl+Shift+V", value: "ctrl_shift_v" },
  { label: "Ctrl+V", value: "ctrl_v" },
  { label: "Shift+Insert", value: "shift_insert" },
];
