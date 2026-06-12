//! Centralized constants for configuration validation.
//!
//! DRY: Single source of truth for valid values.
//! All constants are exported from config/mod.rs for backward compatibility.

/// Valid language codes for transcription.
pub const VALID_LANGUAGES: &[&str] = &[
    "auto", "ru", "en", "de", "fr", "es", "zh", "ja", "ko", "pt", "it", "nl", "pl", "uk",
];

/// Valid display backend types.
pub const VALID_BACKENDS: &[&str] = &["auto", "x11", "wayland", "darwin", "windows"];

/// Valid overlay positions on screen.
pub const VALID_OVERLAY_POSITIONS: &[&str] = &[
    "bottom_left",
    "bottom_right",
    "top_left",
    "top_right",
    "center",
    "top_center",
    "bottom_center",
    "left_center",
    "right_center",
];

/// Valid overlay sizes.
pub const VALID_OVERLAY_SIZES: &[&str] = &["small", "medium", "large"];

/// Valid dictionary learning modes.
pub const VALID_LEARNING_MODES: &[&str] = &["disabled", "pending", "auto"];

/// Valid single hotkeys (modifiers and function keys).
pub const VALID_SINGLE_HOTKEYS: &[&str] = &[
    // Modifiers
    "ctrl_r",
    "ctrl_l",
    "ctrl",
    "alt_r",
    "alt_l",
    "alt",
    "alt_gr",
    "shift_r",
    "shift_l",
    "shift",
    "super_r",
    "super_l",
    "super",
    "cmd_r",
    "cmd_l",
    "cmd",
    // Function keys
    "f1",
    "f2",
    "f3",
    "f4",
    "f5",
    "f6",
    "f7",
    "f8",
    "f9",
    "f10",
    "f11",
    "f12",
    "f13",
    "f14",
    "f15",
    "f16",
    "f17",
    "f18",
    "f19",
    "f20",
    // Common keys
    "space",
    "enter",
    "tab",
    "escape",
    "backspace",
    "caps_lock",
    "delete",
    "home",
    "end",
    "page_up",
    "page_down",
    "num_lock",
    "scroll_lock",
    "print_screen",
    "pause",
    "insert",
    "menu",
];

/// Valid modifier prefixes for combo hotkeys.
pub const VALID_MODIFIERS: &[&str] = &["ctrl", "alt", "shift", "super"];

/// Valid single character keys for combos.
pub const COMBO_KEYS: &str = "qwertyuiopasdfghjklzxcvbnm1234567890";

// =============================================================================
// Default Values
// =============================================================================

/// Default Whisper model.
pub const DEFAULT_MODEL: &str = "whisper-large-v3";

/// Default LLM model for text processing.
pub const DEFAULT_LLM_MODEL: &str = "llama-3.3-70b-versatile";

/// Groq chat completions API URL.
pub const GROQ_CHAT_URL: &str = "https://api.groq.com/openai/v1/chat/completions";

/// Groq transcription API URL.
pub const GROQ_API_URL: &str = "https://api.groq.com/openai/v1/audio/transcriptions";

// =============================================================================
// Config Default Values (DRY: used by both serde defaults and impl Default)
// =============================================================================

/// Default hotkey for recording.
pub const DEFAULT_HOTKEY: &str = "ctrl_r";

/// Minimum hold time (ms) before the hotkey actually activates recording.
/// Below this threshold, the press is treated as a modifier in a key
/// combination and silently ignored. Default 300 ms balances perceived
/// responsiveness (start feels instant) and tolerance for AltGr / Ctrl
/// being used in shortcuts like AltGr+R, Ctrl+C, etc.
pub const DEFAULT_HOTKEY_HOLD_MS: u32 = 300;

/// Recordings shorter than this (after VAD) are silently dropped instead
/// of sent to the transcription API (which rejects sub-second clips as
/// "Audio file is too short"). Guards accidental short clicks/taps on the
/// press-and-hold overlay.
pub const DEFAULT_MIN_RECORDING_MS: u32 = 300;

/// Default typing delay in milliseconds.
pub const DEFAULT_TYPING_DELAY: u32 = 12;

/// Default audio device name.
pub const DEFAULT_AUDIO_DEVICE: &str = "default";

/// Default history retention days.
pub const DEFAULT_HISTORY_DAYS: u32 = 30;

/// Default provider ID.
pub const DEFAULT_PROVIDER: &str = "groq";

/// Default local backend for transcription.
pub const DEFAULT_LOCAL_BACKEND: &str = "mlx";

/// Default value for auto-detection fields.
pub const DEFAULT_AUTO: &str = "auto";

/// Default VAD threshold.
pub const DEFAULT_VAD_THRESHOLD: f32 = 0.5;

/// Default overlay position.
pub const DEFAULT_OVERLAY_POSITION: &str = "bottom_left";

/// Default overlay size.
pub const DEFAULT_OVERLAY_SIZE: &str = "medium";

/// Default overlay margin in pixels. Can be negative to move overlay partially off-screen.
pub const DEFAULT_OVERLAY_MARGIN: i32 = 30;

/// Default audio boost for waveform visualization.
pub const DEFAULT_AUDIO_BOOST: f32 = 800.0;

/// Default learning threshold for dictionary suggestions.
pub const DEFAULT_LEARNING_THRESHOLD: u32 = 3;

/// Default overlay theme.
pub const DEFAULT_OVERLAY_THEME: &str = "default";

/// Valid overlay themes.
pub const VALID_OVERLAY_THEMES: &[&str] =
    &["default", "winamp_classic", "dark", "neon", "monochrome"];

/// Default paste shortcuts on Linux (Ctrl+Shift+V for terminals).
pub const DEFAULT_PASTE_SHORTCUTS: &str = "ctrl_shift_v";

/// Valid paste shortcuts.
pub const VALID_PASTE_SHORTCUTS: &[&str] = &["ctrl_shift_v", "ctrl_v", "shift_insert"];
