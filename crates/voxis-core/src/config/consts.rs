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

/// Recording guard (Layer 5): auto-stop when the mic has been silent for
/// this long, so a lost hotkey-release (see press/release race,
/// `orchestrator::recording`) doesn't leave the recorder running
/// indefinitely. `0` disables the silence guard.
pub const DEFAULT_SILENCE_TIMEOUT_MS: u32 = 60_000;

/// Recording guard (Layer 5): absolute wall-clock ceiling on one
/// recording, independent of silence detection — the deterministic
/// backstop against an unbounded in-memory sample buffer. `0` disables
/// the config-level cap (the hard-coded `ABS_MAX_RECORDING_MS` backstop
/// still applies).
pub const DEFAULT_MAX_RECORDING_MS: u32 = 600_000;

/// Upper bound accepted for `max_recording_ms`: 25 MiB (Groq's
/// transcription upload limit) / 32 000 B/s (16 kHz, 16-bit mono WAV)
/// ≈ 819 s, with a small safety margin so a capture at the ceiling still
/// clears the API's size check after downsampling.
pub const MAX_RECORDING_MS_CEILING: u32 = 780_000;

/// Hard backstop applied to the raw sample buffer when
/// `max_recording_ms == 0` (config-level cap disabled). Independent of
/// user config so the buffer can never grow unbounded even with a
/// misconfigured/zeroed setting.
pub const ABS_MAX_RECORDING_MS: u32 = 1_800_000;

/// Recording guard (Layer 5): peak-RMS threshold (linear amplitude,
/// pre-boost) below which a poll counts as "silent". ≈ -34 dBFS.
///
/// Calibrated 2026-09-07 against a REAL failed take on a MacBook Air M3
/// built-in mic, quiet room, v0.1.4 installed: an 87s silent recording's
/// actual per-250ms peak-RMS (exactly what `AudioRecorder::take_rms_peak`
/// feeds the guard) measured a room floor of median 0.0061 (-44 dBFS),
/// p90 0.0104 (-40 dBFS), max 0.0156 (-36 dBFS) — all ABOVE the previous
/// 0.005 (-46 dBFS) constant. Result: only 34.5% of polls read "silent",
/// `SILENCE_FRACTION` (0.80) was never reached, the guard never armed in
/// 87s of silence, `GuardState::ever_loud` stayed `true` from room noise
/// alone, and the whole silent take was sent to Whisper — its
/// hallucinated output ("Продолжение следует... Субтитры создавал
/// DimaTorzok") was auto-typed into the focused app with no human in the
/// loop. This is the exact hazard the guard exists to prevent; the
/// constant had been below the reference hardware's noise floor since it
/// was introduced (flagged "not empirically validated" by three prior
/// reviews).
///
/// 0.02 gives ~2 dB of margin above the measured floor's max (0.0156) and
/// ~7 dB of margin below a modest -26 dBFS test signal played through the
/// laptop speakers into the same mic (0.047); normal dictation speech is
/// -30..-12 dBFS (0.03-0.25), comfortably clear on the loud side.
///
/// Trade-off, stated honestly: a very quiet or distant speaker whose
/// voice stays below -34 dBFS in EVERY 10ms chunk of a given 250ms poll
/// will have that poll counted as silent. `SILENCE_FRACTION`'s
/// 80%-of-window tolerance absorbs isolated dips like this (a pause, a
/// soft word) — it does not help a speaker who is consistently this
/// quiet for the whole `SILENCE_WINDOW_MS` window.
pub const SILENCE_RMS: f32 = 0.02;

/// Recording guard (Layer 5): how often the guard polls the recorder's
/// peak-RMS signal.
pub const GUARD_POLL_MS: u32 = 250;

/// Recording guard (Layer 5): sliding window length used to decide
/// "mostly silent" — avoids a single loud poll (keyboard click) resetting
/// the whole silence counter.
pub const SILENCE_WINDOW_MS: u32 = 10_000;

/// Recording guard (Layer 5): fraction of polls in `SILENCE_WINDOW_MS`
/// that must be below `SILENCE_RMS` for the window to count as silent.
pub const SILENCE_FRACTION: f32 = 0.80;

/// Recording guard (Layer 5): lead time before the silence-timeout stop
/// at which a warning beep plays, so the user has a chance to keep
/// talking before the recording is cut.
pub const PRE_CUTOFF_BEEP_MS: u32 = 3_000;

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
pub const VALID_OVERLAY_THEMES: &[&str] = &["default", "winamp_classic", "neon"];

/// Default paste shortcuts on Linux (Ctrl+Shift+V for terminals).
pub const DEFAULT_PASTE_SHORTCUTS: &str = "ctrl_shift_v";

/// Valid paste shortcuts.
pub const VALID_PASTE_SHORTCUTS: &[&str] = &["ctrl_shift_v", "ctrl_v", "shift_insert"];
