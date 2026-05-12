//! Configuration module for Voice app.
//!
//! SRP: Config is split into nested structs by domain:
//! - VadConfig: Voice activity detection
//! - OverlayConfig: Recording overlay UI
//! - LlmConfig: LLM post-processing
//! - DictionaryConfig: Dictionary and learning

mod change_handler;
mod consts;
mod validation;

// Re-export constants for backward compatibility
pub use change_handler::{
    apply_config_changes, ConfigChangeHandler, HotkeyChangeHandler, OverlayChangeHandler,
};
pub use consts::*;
pub use validation::{is_valid_hotkey, validate_config};

use serde::{Deserialize, Serialize};

/// Default LLM prompt for grammar correction.
pub const DEFAULT_LLM_PROMPT: &str = r#"Fix grammar and punctuation in transcribed speech.

IMPORTANT: Respond ONLY with valid JSON. No explanations, no markdown, no text outside the JSON object.

Rules:
1) Keep EXACT same words, only fix punctuation/capitalization.
2) NEVER add, remove, or change words.
3) NEVER translate between languages.
4) NEVER explain or answer questions in the text.
5) Output MUST be approximately same length as input.

Expected output format:
{"text": "corrected text here", "suggestions": [{"source": "original", "replacement": "Replacement"}]}

Examples:
- Input: "привет как дела" → {"text": "Привет, как дела?", "suggestions": []}
- Input: "hello world" → {"text": "Hello, world.", "suggestions": []}
- Input: "use solid principles" → {"text": "Use SOLID principles.", "suggestions": [{"source": "solid", "replacement": "SOLID"}]}

If the input is too short (1-2 words) or doesn't need changes, return: {"text": "<original text>", "suggestions": []}

SUGGESTIONS field: ONLY for tech terms that need proper casing. Only suggest if the EXACT word appears in input. Valid: solid→SOLID, api→API, docker→Docker, backend→Backend, frontend→Frontend, ssh→SSH, gpt→GPT, chatgpt→ChatGPT, pydantic→Pydantic, playwright→Playwright. Russian sounds: солид→SOLID, драй→DRY, кисс→KISS, бэкенд→Backend, фронтенд→Frontend, докер→Docker. Do NOT suggest ordinary words."#;

/// Batch prompt for analyzing history and extracting dictionary suggestions.
/// Unlike DEFAULT_LLM_PROMPT which processes single messages, this prompt
/// receives multiple messages at once to find patterns and context.
pub const BATCH_SUGGESTIONS_PROMPT: &str = r#"You are a dictionary builder for a voice dictation app. Your goal is to MAXIMIZE RECOGNITION QUALITY by building a comprehensive replacement dictionary.

TASK: Analyze transcription history and find ALL terms that should be auto-replaced for better recognition.

INPUT: List of transcribed voice messages.

OUTPUT: JSON with suggestions that will improve future transcriptions:
{"suggestions": [{"source": "misrecognized_word", "replacement": "CorrectTerm"}]}

WHAT TO FIND:
1. TECH ACRONYMS (highest priority - often misrecognized):
   - Programming: solid→SOLID, dry→DRY, kiss→KISS, yagni→YAGNI, tdd→TDD, bdd→BDD, ci/cd→CI/CD
   - Web: api→API, rest→REST, graphql→GraphQL, html→HTML, css→CSS, json→JSON, xml→XML
   - Database: sql→SQL, nosql→NoSQL, orm→ORM, crud→CRUD
   - DevOps: aws→AWS, gcp→GCP, k8s→Kubernetes, ecs→ECS, eks→EKS

2. TOOL & FRAMEWORK NAMES:
   - Containers: docker→Docker, kubernetes→Kubernetes, helm→Helm
   - Databases: postgres→PostgreSQL, mysql→MySQL, mongodb→MongoDB, redis→Redis
   - Frameworks: react→React, vue→Vue, angular→Angular, nextjs→Next.js, nuxt→Nuxt
   - Languages: python→Python, javascript→JavaScript, typescript→TypeScript, golang→Go, rust→Rust

3. RUSSIAN PHONETIC → ENGLISH (critical for bilingual users):
   - солид→SOLID, драй→DRY, кисс→KISS, ягни→YAGNI
   - докер→Docker, кубернетес/кубер→Kubernetes
   - питон/пайтон→Python, джаваскрипт→JavaScript, тайпскрипт→TypeScript
   - бэкенд/бекенд→Backend, фронтенд/фронтэнд→Frontend
   - апи/эйпиай→API, рест→REST
   - постгрес/постгре→PostgreSQL, монго/монгодб→MongoDB
   - реакт→React, вью→Vue, ангуляр→Angular
   - гитхаб/гитхаб→GitHub, гитлаб→GitLab

4. COMMON MISRECOGNITIONS:
   - Look for words that seem like phonetic approximations of tech terms
   - Pay attention to repeated patterns across messages

RULES:
- ONLY suggest terms that ACTUALLY APPEAR in the input text
- Include the exact source form as it appears (lowercase, with typos, etc.)
- Maximum 30 suggestions per batch
- Deduplicate by source word
- Do NOT suggest ordinary Russian/English words

EXAMPLE:
Input: ["настрой докер контейнер", "используем солид и драй", "деплой на кубер"]
Output: {"suggestions": [
  {"source": "докер", "replacement": "Docker"},
  {"source": "солид", "replacement": "SOLID"},
  {"source": "драй", "replacement": "DRY"},
  {"source": "кубер", "replacement": "Kubernetes"}
]}"#;

// =============================================================================
// Nested Config Structs (SRP: group related settings)
// =============================================================================

/// Voice Activity Detection settings.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, specta::Type)]
pub struct VadConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// VAD backend: `"none"` (no filtering, default), `"threshold"` (RMS-based),
    /// or `"silero"` (Silero ONNX model).
    #[serde(default = "default_vad_backend")]
    pub backend: String,
    #[serde(default = "default_vad_threshold")]
    pub threshold: f32,
    /// Consecutive voice frames required to trigger speech start.
    #[serde(default = "default_vad_onset_frames")]
    pub onset_frames: u32,
    /// Silence frames tolerated before ending speech.
    #[serde(default = "default_vad_hangover_frames")]
    pub hangover_frames: u32,
    /// Past frames included when speech starts (captures word beginning).
    #[serde(default = "default_vad_prefill_frames")]
    pub prefill_frames: u32,
}

impl Default for VadConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            backend: default_vad_backend(),
            threshold: DEFAULT_VAD_THRESHOLD,
            onset_frames: 3,
            hangover_frames: 5,
            prefill_frames: 2,
        }
    }
}

fn default_vad_backend() -> String {
    "none".to_string()
}

/// Recording overlay settings.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, specta::Type)]
pub struct OverlayConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_overlay_position")]
    pub position: String,
    #[serde(default = "default_overlay_size")]
    pub size: String,
    /// Margin from screen edge in pixels. Can be negative to move overlay off-screen.
    #[serde(default = "default_overlay_margin")]
    pub margin: i32,
    /// Audio level multiplier for waveform visualization (100-1000).
    /// Higher = more sensitive for quiet microphones.
    #[serde(default = "default_audio_boost")]
    pub audio_boost: f32,
    /// Visualization theme name.
    #[serde(default = "default_overlay_theme")]
    pub theme: String,
    /// Overlay backend: `"auto"` (default, picks best), `"native"`, `"subprocess"`,
    /// `"nspanel"` (macOS only, opt-in), or `"none"`.
    #[serde(default = "default_overlay_backend")]
    pub backend: String,
}

impl Default for OverlayConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            position: DEFAULT_OVERLAY_POSITION.into(),
            size: DEFAULT_OVERLAY_SIZE.into(),
            margin: DEFAULT_OVERLAY_MARGIN,
            audio_boost: DEFAULT_AUDIO_BOOST,
            theme: DEFAULT_OVERLAY_THEME.into(),
            backend: default_overlay_backend(),
        }
    }
}

fn default_overlay_backend() -> String {
    "auto".to_string()
}

/// LLM post-processing settings.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, specta::Type)]
pub struct LlmConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_provider")]
    pub provider: String,
    #[serde(default = "default_llm_url")]
    pub api_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_llm_model")]
    pub model: String,
    #[serde(default = "default_llm_prompt")]
    pub prompt: String,
}

impl Default for LlmConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            provider: DEFAULT_PROVIDER.into(),
            api_url: GROQ_CHAT_URL.into(),
            api_key: String::new(),
            model: DEFAULT_LLM_MODEL.into(),
            prompt: DEFAULT_LLM_PROMPT.into(),
        }
    }
}

/// Dictionary and learning settings.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, specta::Type)]
pub struct DictionaryConfig {
    #[serde(default)]
    pub path: String,
    #[serde(default = "default_learning_mode")]
    pub learning_mode: String,
    #[serde(default = "default_learning_threshold")]
    pub learning_threshold: u32,
}

impl Default for DictionaryConfig {
    fn default() -> Self {
        Self {
            path: String::new(),
            learning_mode: DEFAULT_AUTO.into(),
            learning_threshold: DEFAULT_LEARNING_THRESHOLD,
        }
    }
}

// =============================================================================
// Main Config
// =============================================================================

/// Main application configuration.
///
/// Groups:
/// - vad: Voice Activity Detection settings
/// - overlay: Recording overlay UI settings
/// - llm: LLM post-processing settings
/// - dictionary: Dictionary and learning settings
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, specta::Type)]
pub struct AppConfig {
    // API settings
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(default = "default_language")]
    pub language: String,

    // Hotkey
    #[serde(default = "default_hotkey")]
    pub hotkey: String,

    // Behavior
    #[serde(default = "default_true")]
    pub auto_type: bool,
    #[serde(default)]
    pub auto_enter: bool,
    #[serde(default = "default_typing_delay")]
    pub typing_delay: u32,
    #[serde(default = "default_true")]
    pub notifications: bool,
    #[serde(default = "default_backend")]
    pub backend: String,
    #[serde(default)]
    pub debug: bool,

    // Audio
    #[serde(default = "default_audio_device")]
    pub audio_device: String,

    // History
    #[serde(default = "default_true")]
    pub history_enabled: bool,
    #[serde(default = "default_history_days")]
    pub history_days: u32,

    // Provider
    #[serde(default = "default_provider")]
    pub active_provider: String,
    #[serde(default = "default_provider")]
    pub cloud_provider: String,
    #[serde(default = "default_local_backend")]
    pub local_backend: String,

    // Text processing
    #[serde(default = "default_true")]
    pub text_processing: bool,

    // Paste shortcuts (Linux only) - comma-separated list
    #[serde(default = "default_paste_shortcuts")]
    pub paste_shortcuts: String,

    // API URL override (for testing or custom endpoints)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_url_override: Option<String>,

    // Nested configs (SRP)
    #[serde(default)]
    pub vad: VadConfig,
    #[serde(default)]
    pub overlay: OverlayConfig,
    #[serde(default)]
    pub llm: LlmConfig,
    #[serde(default)]
    pub dictionary: DictionaryConfig,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            model: DEFAULT_MODEL.into(),
            language: DEFAULT_AUTO.into(),
            hotkey: DEFAULT_HOTKEY.into(),
            auto_type: true,
            auto_enter: false,
            typing_delay: DEFAULT_TYPING_DELAY,
            notifications: true,
            backend: DEFAULT_AUTO.into(),
            debug: false,
            audio_device: DEFAULT_AUDIO_DEVICE.into(),
            history_enabled: true,
            history_days: DEFAULT_HISTORY_DAYS,
            active_provider: DEFAULT_PROVIDER.into(),
            cloud_provider: DEFAULT_PROVIDER.into(),
            local_backend: DEFAULT_LOCAL_BACKEND.into(),
            text_processing: true,
            paste_shortcuts: DEFAULT_PASTE_SHORTCUTS.into(),
            api_url_override: None,
            vad: VadConfig::default(),
            overlay: OverlayConfig::default(),
            llm: LlmConfig::default(),
            dictionary: DictionaryConfig::default(),
        }
    }
}

// =============================================================================
// Default value functions for serde (DRY: use constants from consts.rs)
// =============================================================================

fn default_true() -> bool {
    true
}

fn default_model() -> String {
    DEFAULT_MODEL.into()
}

fn default_hotkey() -> String {
    DEFAULT_HOTKEY.into()
}

fn default_typing_delay() -> u32 {
    DEFAULT_TYPING_DELAY
}

fn default_audio_device() -> String {
    DEFAULT_AUDIO_DEVICE.into()
}

fn default_history_days() -> u32 {
    DEFAULT_HISTORY_DAYS
}

fn default_provider() -> String {
    DEFAULT_PROVIDER.into()
}

fn default_local_backend() -> String {
    DEFAULT_LOCAL_BACKEND.into()
}

fn default_language() -> String {
    DEFAULT_AUTO.into()
}

fn default_backend() -> String {
    DEFAULT_AUTO.into()
}

fn default_learning_mode() -> String {
    DEFAULT_AUTO.into()
}

fn default_vad_threshold() -> f32 {
    DEFAULT_VAD_THRESHOLD
}

fn default_vad_onset_frames() -> u32 {
    3
}

fn default_vad_hangover_frames() -> u32 {
    5
}

fn default_vad_prefill_frames() -> u32 {
    2
}

fn default_overlay_position() -> String {
    DEFAULT_OVERLAY_POSITION.into()
}

fn default_overlay_size() -> String {
    DEFAULT_OVERLAY_SIZE.into()
}

fn default_overlay_margin() -> i32 {
    DEFAULT_OVERLAY_MARGIN
}

fn default_audio_boost() -> f32 {
    DEFAULT_AUDIO_BOOST
}

fn default_overlay_theme() -> String {
    DEFAULT_OVERLAY_THEME.into()
}

fn default_llm_url() -> String {
    GROQ_CHAT_URL.into()
}

fn default_llm_model() -> String {
    DEFAULT_LLM_MODEL.into()
}

fn default_llm_prompt() -> String {
    DEFAULT_LLM_PROMPT.into()
}

fn default_learning_threshold() -> u32 {
    DEFAULT_LEARNING_THRESHOLD
}

fn default_paste_shortcuts() -> String {
    DEFAULT_PASTE_SHORTCUTS.into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = AppConfig::default();
        assert_eq!(config.model, DEFAULT_MODEL);
        assert_eq!(config.hotkey, "ctrl_r");
        assert!(config.auto_type);
        assert!(!config.auto_enter);
        assert_eq!(config.typing_delay, 12);
        assert!(config.vad.enabled);
        assert_eq!(config.vad.threshold, 0.5);
        assert!(config.overlay.enabled);
        assert_eq!(config.overlay.position, "bottom_left");
        assert!(!config.llm.enabled);
        assert_eq!(config.dictionary.learning_threshold, 3);
    }

    #[test]
    fn test_config_serde_roundtrip() {
        let config = AppConfig::default();
        let json = serde_json::to_string(&config).unwrap();
        let parsed: AppConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(config, parsed);
    }

    #[test]
    fn test_config_partial_json() {
        // Only api_key set, rest defaults
        let json = r#"{"api_key": "test-key"}"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.api_key, "test-key");
        assert_eq!(config.model, DEFAULT_MODEL);
        assert!(config.auto_type);
    }

    #[test]
    fn test_nested_config_defaults() {
        let json = r#"{}"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert!(config.vad.enabled);
        assert_eq!(config.vad.threshold, 0.5);
        assert!(config.overlay.enabled);
        assert_eq!(config.overlay.margin, 30);
        assert_eq!(config.overlay.audio_boost, 800.0);
        assert!(!config.llm.enabled);
        assert_eq!(config.llm.model, DEFAULT_LLM_MODEL);
    }

    #[test]
    fn test_vad_config_default() {
        let vad = VadConfig::default();
        assert!(vad.enabled);
        assert!((vad.threshold - 0.5).abs() < f32::EPSILON);
    }

    #[test]
    fn test_overlay_config_default() {
        let overlay = OverlayConfig::default();
        assert!(overlay.enabled);
        assert_eq!(overlay.position, "bottom_left");
        assert_eq!(overlay.size, "medium");
        assert_eq!(overlay.margin, 30);
        assert!((overlay.audio_boost - 800.0).abs() < f32::EPSILON);
        assert_eq!(overlay.theme, "default");
    }

    #[test]
    fn test_llm_config_default() {
        let llm = LlmConfig::default();
        assert!(!llm.enabled);
        assert_eq!(llm.provider, "groq");
        assert_eq!(llm.api_url, GROQ_CHAT_URL);
        assert!(llm.api_key.is_empty());
        assert_eq!(llm.model, DEFAULT_LLM_MODEL);
        assert_eq!(llm.prompt, DEFAULT_LLM_PROMPT);
    }

    #[test]
    fn test_dictionary_config_default() {
        let dict = DictionaryConfig::default();
        assert!(dict.path.is_empty());
        assert_eq!(dict.learning_mode, "auto");
        assert_eq!(dict.learning_threshold, 3);
    }

    #[test]
    fn test_app_config_all_nested_defaults() {
        let config = AppConfig::default();

        // Verify all nested configs are properly initialized
        assert_eq!(config.vad, VadConfig::default());
        assert_eq!(config.overlay, OverlayConfig::default());
        assert_eq!(config.llm, LlmConfig::default());
        assert_eq!(config.dictionary, DictionaryConfig::default());
    }

    #[test]
    fn test_partial_nested_config_merge() {
        // Test that partial nested config merges with defaults
        let json = r#"{"vad": {"threshold": 0.8}}"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();

        // Partially specified
        assert!((config.vad.threshold - 0.8).abs() < f32::EPSILON);
        // Defaults preserved
        assert!(config.vad.enabled);
        // Other nested configs get defaults
        assert!(config.overlay.enabled);
        assert!(!config.llm.enabled);
    }

    #[test]
    fn test_overlay_partial_merge() {
        let json = r#"{"overlay": {"position": "top_right", "margin": 50}}"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();

        assert_eq!(config.overlay.position, "top_right");
        assert_eq!(config.overlay.margin, 50);
        // Defaults preserved
        assert!(config.overlay.enabled);
        assert_eq!(config.overlay.size, "medium");
        assert!((config.overlay.audio_boost - 800.0).abs() < f32::EPSILON);
    }

    #[test]
    fn test_llm_partial_merge() {
        let json = r#"{"llm": {"enabled": true, "api_key": "test-key"}}"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();

        assert!(config.llm.enabled);
        assert_eq!(config.llm.api_key, "test-key");
        // Defaults preserved
        assert_eq!(config.llm.provider, "groq");
        assert_eq!(config.llm.model, DEFAULT_LLM_MODEL);
    }

    #[test]
    fn test_dictionary_partial_merge() {
        let json = r#"{"dictionary": {"learning_mode": "manual", "learning_threshold": 5}}"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();

        assert_eq!(config.dictionary.learning_mode, "manual");
        assert_eq!(config.dictionary.learning_threshold, 5);
        // Defaults preserved
        assert!(config.dictionary.path.is_empty());
    }

    #[test]
    fn test_config_clone() {
        let config = AppConfig::default();
        let cloned = config.clone();

        assert_eq!(config.model, cloned.model);
        assert_eq!(config.hotkey, cloned.hotkey);
        assert_eq!(config.vad, cloned.vad);
        assert_eq!(config.overlay, cloned.overlay);
        assert_eq!(config.llm, cloned.llm);
        assert_eq!(config.dictionary, cloned.dictionary);
    }

    #[test]
    fn test_nested_config_equality() {
        let config1 = AppConfig::default();
        let config2 = AppConfig::default();
        assert_eq!(config1, config2);

        // Modify nested config
        let mut config3 = config1.clone();
        config3.vad.threshold = 0.9;
        assert_ne!(config1, config3);
    }
}
