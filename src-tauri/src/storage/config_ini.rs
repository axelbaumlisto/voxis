//! Read-only legacy INI parser. Exists solely for one-time migration to
//! SQLite (setup/state.rs). Delete when migration support is dropped.

use crate::config::AppConfig;
use ini::Ini;
use std::path::PathBuf;

// =============================================================================
// DRY: INI parsing helper functions
// =============================================================================

/// Get string value from INI section.
fn get_string(section: &ini::Properties, key: &str) -> Option<String> {
    section.get(key).map(|v| v.to_string())
}

/// Get boolean value from INI section (only "true" is true).
fn get_bool(section: &ini::Properties, key: &str) -> Option<bool> {
    section.get(key).map(|v| v == "true")
}

/// Get integer value from INI section with default fallback.
fn get_int<T: std::str::FromStr>(section: &ini::Properties, key: &str, default: T) -> T {
    section
        .get(key)
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

/// Get f32 value from INI section with default fallback.
fn get_f32(section: &ini::Properties, key: &str, default: f32) -> f32 {
    section
        .get(key)
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

// =============================================================================
// Storage implementation
// =============================================================================

/// Storage for config.ini file.
pub struct ConfigIniStorage {
    path: PathBuf,
}

impl ConfigIniStorage {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    /// Load config from INI file.
    ///
    /// DRY: Uses helper functions (get_string, get_bool, get_int, get_float)
    /// to reduce repetitive parsing code.
    pub fn load(&self) -> Result<AppConfig, Box<dyn std::error::Error>> {
        if !self.path.exists() {
            return Ok(AppConfig::default());
        }

        let ini = Ini::load_from_file(&self.path)?;
        let mut config = AppConfig::default();

        // [api] section (Tauri format)
        if let Some(s) = ini.section(Some("api")) {
            if let Some(v) = get_string(s, "key") {
                config.api_key = v;
            }
            if let Some(v) = get_string(s, "model") {
                config.model = v;
            }
            if let Some(v) = get_string(s, "language") {
                config.language = v;
            }
        }

        // [groq] section (Python soupawhisper format - for compatibility)
        if let Some(s) = ini.section(Some("groq")) {
            if let Some(v) = get_string(s, "api_key") {
                config.api_key = v;
            }
            if let Some(v) = get_string(s, "model") {
                config.model = v;
            }
            if let Some(v) = get_string(s, "language") {
                config.language = v;
            }
        }

        // [recording] section (Tauri format)
        if let Some(s) = ini.section(Some("recording")) {
            if let Some(v) = get_string(s, "hotkey") {
                config.hotkey = v;
            }
            if let Some(v) = get_string(s, "audio_device") {
                config.audio_device = v;
            }
        }

        // [hotkey] section (Python format)
        if let Some(s) = ini.section(Some("hotkey")) {
            if let Some(v) = get_string(s, "key") {
                config.hotkey = v;
            }
        }

        // [audio] section (Python format)
        if let Some(s) = ini.section(Some("audio")) {
            if let Some(v) = get_string(s, "device") {
                config.audio_device = v;
            }
        }

        // [behavior] section (Python format)
        if let Some(s) = ini.section(Some("behavior")) {
            if let Some(v) = get_bool(s, "auto_type") {
                config.auto_type = v;
            }
            if let Some(v) = get_bool(s, "auto_enter") {
                config.auto_enter = v;
            }
            config.typing_delay = get_int(s, "typing_delay", config.typing_delay);
            if let Some(v) = get_bool(s, "notifications") {
                config.notifications = v;
            }
            if let Some(v) = get_string(s, "backend") {
                config.backend = v;
            }
            if let Some(v) = get_bool(s, "debug") {
                config.debug = v;
            }
        }

        // [text] section (Python format)
        if let Some(s) = ini.section(Some("text")) {
            if let Some(v) = get_bool(s, "processing") {
                config.text_processing = v;
            }
            if let Some(v) = get_string(s, "dictionary_path") {
                config.dictionary.path = v;
            }
        }

        // [output] section
        if let Some(s) = ini.section(Some("output")) {
            if let Some(v) = get_bool(s, "auto_type") {
                config.auto_type = v;
            }
            if let Some(v) = get_bool(s, "auto_enter") {
                config.auto_enter = v;
            }
            config.typing_delay = get_int(s, "typing_delay", config.typing_delay);
            if let Some(v) = get_bool(s, "notifications") {
                config.notifications = v;
            }
            if let Some(v) = get_string(s, "backend") {
                config.backend = v;
            }
        }

        // [overlay] section
        if let Some(s) = ini.section(Some("overlay")) {
            if let Some(v) = get_bool(s, "enabled") {
                config.overlay.enabled = v;
            }
            if let Some(v) = get_string(s, "position") {
                config.overlay.position = v;
            }
            if let Some(v) = get_string(s, "size") {
                config.overlay.size = v;
            }
            config.overlay.margin = get_int(s, "margin", config.overlay.margin);
        }

        // [vad] section
        if let Some(s) = ini.section(Some("vad")) {
            if let Some(v) = get_bool(s, "enabled") {
                config.vad.enabled = v;
            }
            config.vad.threshold = get_f32(s, "threshold", config.vad.threshold);
        }

        // [llm] section
        if let Some(s) = ini.section(Some("llm")) {
            if let Some(v) = get_bool(s, "enabled") {
                config.llm.enabled = v;
            }
            if let Some(v) = get_string(s, "provider") {
                config.llm.provider = v;
            }
            if let Some(v) = get_string(s, "api_url") {
                config.llm.api_url = v;
            }
            if let Some(v) = get_string(s, "api_key") {
                config.llm.api_key = v;
            }
            if let Some(v) = get_string(s, "model") {
                config.llm.model = v;
            }
            if let Some(v) = get_string(s, "prompt") {
                config.llm.prompt = v;
            }
        }

        // [dictionary] section
        if let Some(s) = ini.section(Some("dictionary")) {
            if let Some(v) = get_string(s, "path") {
                config.dictionary.path = v;
            }
            if let Some(v) = get_string(s, "learning_mode") {
                config.dictionary.learning_mode = v;
            }
            config.dictionary.learning_threshold = get_int(
                s,
                "learning_threshold",
                config.dictionary.learning_threshold,
            );
        }

        // [provider] section
        if let Some(s) = ini.section(Some("provider")) {
            if let Some(v) = get_string(s, "active") {
                config.active_provider = v;
            }
            if let Some(v) = get_string(s, "cloud") {
                config.cloud_provider = v;
            }
            if let Some(v) = get_string(s, "local_backend") {
                config.local_backend = v;
            }
        }

        // [history] section
        if let Some(s) = ini.section(Some("history")) {
            if let Some(v) = get_bool(s, "enabled") {
                config.history_enabled = v;
            }
            config.history_days = get_int(s, "days", config.history_days);
        }

        // [advanced] section
        if let Some(s) = ini.section(Some("advanced")) {
            if let Some(v) = get_bool(s, "debug") {
                config.debug = v;
            }
            if let Some(v) = get_bool(s, "text_processing") {
                config.text_processing = v;
            }
        }

        Ok(config)
    }


}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;



    #[test]
    fn test_load_nonexistent_returns_default() {
        let storage = ConfigIniStorage::new(PathBuf::from("/nonexistent/config.ini"));
        let config = storage.load().unwrap();
        assert_eq!(config, AppConfig::default());
    }

    #[test]
    fn test_load_empty_file() {
        let file = NamedTempFile::new().unwrap();
        let storage = ConfigIniStorage::new(file.path().to_path_buf());
        let config = storage.load().unwrap();
        // Empty file should return defaults
        assert_eq!(config.api_key, "");
        assert_eq!(config.model, AppConfig::default().model);
    }

    #[test]
    fn test_load_api_section() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(file, "[api]").unwrap();
        writeln!(file, "key=my-api-key").unwrap();
        writeln!(file, "model=whisper-large-v3").unwrap();
        writeln!(file, "language=ru").unwrap();

        let storage = ConfigIniStorage::new(file.path().to_path_buf());
        let config = storage.load().unwrap();

        assert_eq!(config.api_key, "my-api-key");
        assert_eq!(config.model, "whisper-large-v3");
        assert_eq!(config.language, "ru");
    }

    #[test]
    fn test_load_groq_section_compatibility() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(file, "[groq]").unwrap();
        writeln!(file, "api_key=groq-key-123").unwrap();
        writeln!(file, "model=whisper-large").unwrap();
        writeln!(file, "language=en").unwrap();

        let storage = ConfigIniStorage::new(file.path().to_path_buf());
        let config = storage.load().unwrap();

        assert_eq!(config.api_key, "groq-key-123");
        assert_eq!(config.model, "whisper-large");
        assert_eq!(config.language, "en");
    }

    #[test]
    fn test_load_recording_section() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(file, "[recording]").unwrap();
        writeln!(file, "hotkey=ctrl+shift+r").unwrap();
        writeln!(file, "audio_device=USB Microphone").unwrap();

        let storage = ConfigIniStorage::new(file.path().to_path_buf());
        let config = storage.load().unwrap();

        assert_eq!(config.hotkey, "ctrl+shift+r");
        assert_eq!(config.audio_device, "USB Microphone");
    }

    #[test]
    fn test_load_behavior_section() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(file, "[behavior]").unwrap();
        writeln!(file, "auto_type=true").unwrap();
        writeln!(file, "auto_enter=false").unwrap();
        writeln!(file, "typing_delay=25").unwrap();
        writeln!(file, "notifications=true").unwrap();
        writeln!(file, "debug=true").unwrap();

        let storage = ConfigIniStorage::new(file.path().to_path_buf());
        let config = storage.load().unwrap();

        assert!(config.auto_type);
        assert!(!config.auto_enter);
        assert_eq!(config.typing_delay, 25);
        assert!(config.notifications);
        assert!(config.debug);
    }

    #[test]
    fn test_load_boolean_parsing() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(file, "[behavior]").unwrap();
        writeln!(file, "auto_type=true").unwrap();
        writeln!(file, "auto_enter=false").unwrap();
        // Test that only "true" is recognized as true
        writeln!(file, "notifications=yes").unwrap();
        writeln!(file, "debug=1").unwrap();

        let storage = ConfigIniStorage::new(file.path().to_path_buf());
        let config = storage.load().unwrap();

        assert!(config.auto_type);
        assert!(!config.auto_enter);
        // "yes" and "1" are not "true", so should be false
        assert!(!config.notifications);
        assert!(!config.debug);
    }

    #[test]
    fn test_load_integer_parsing_invalid() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(file, "[behavior]").unwrap();
        writeln!(file, "typing_delay=not_a_number").unwrap();

        let storage = ConfigIniStorage::new(file.path().to_path_buf());
        let config = storage.load().unwrap();

        // Should fall back to default (12) when parsing fails
        assert_eq!(config.typing_delay, 12);
    }



    #[test]
    fn test_load_overlay_section() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(file, "[overlay]").unwrap();
        writeln!(file, "enabled=true").unwrap();
        writeln!(file, "position=top-right").unwrap();
        writeln!(file, "size=large").unwrap();
        writeln!(file, "margin=50").unwrap();

        let storage = ConfigIniStorage::new(file.path().to_path_buf());
        let config = storage.load().unwrap();

        assert!(config.overlay.enabled);
        assert_eq!(config.overlay.position, "top-right");
        assert_eq!(config.overlay.size, "large");
        assert_eq!(config.overlay.margin, 50);
    }

    #[test]
    fn test_load_vad_section() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(file, "[vad]").unwrap();
        writeln!(file, "enabled=true").unwrap();
        writeln!(file, "threshold=0.65").unwrap();

        let storage = ConfigIniStorage::new(file.path().to_path_buf());
        let config = storage.load().unwrap();

        assert!(config.vad.enabled);
        assert!((config.vad.threshold - 0.65).abs() < 0.001);
    }

    #[test]
    fn test_load_llm_section() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(file, "[llm]").unwrap();
        writeln!(file, "enabled=true").unwrap();
        writeln!(file, "provider=groq").unwrap();
        writeln!(file, "api_url=https://api.groq.com/v1").unwrap();
        writeln!(file, "api_key=llm-secret").unwrap();
        writeln!(file, "model=llama-70b").unwrap();
        writeln!(file, "prompt=Fix grammar").unwrap();

        let storage = ConfigIniStorage::new(file.path().to_path_buf());
        let config = storage.load().unwrap();

        assert!(config.llm.enabled);
        assert_eq!(config.llm.provider, "groq");
        assert_eq!(config.llm.api_url, "https://api.groq.com/v1");
        assert_eq!(config.llm.api_key, "llm-secret");
        assert_eq!(config.llm.model, "llama-70b");
        assert_eq!(config.llm.prompt, "Fix grammar");
    }

    #[test]
    fn test_load_dictionary_section() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(file, "[dictionary]").unwrap();
        writeln!(file, "path=/home/user/dict.json").unwrap();
        writeln!(file, "learning_mode=manual").unwrap();
        writeln!(file, "learning_threshold=5").unwrap();

        let storage = ConfigIniStorage::new(file.path().to_path_buf());
        let config = storage.load().unwrap();

        assert_eq!(config.dictionary.path, "/home/user/dict.json");
        assert_eq!(config.dictionary.learning_mode, "manual");
        assert_eq!(config.dictionary.learning_threshold, 5);
    }

    #[test]
    fn test_load_provider_section() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(file, "[provider]").unwrap();
        writeln!(file, "active=local").unwrap();
        writeln!(file, "cloud=openai").unwrap();
        writeln!(file, "local_backend=faster-whisper").unwrap();

        let storage = ConfigIniStorage::new(file.path().to_path_buf());
        let config = storage.load().unwrap();

        assert_eq!(config.active_provider, "local");
        assert_eq!(config.cloud_provider, "openai");
        assert_eq!(config.local_backend, "faster-whisper");
    }

    #[test]
    fn test_load_corrupted_ini_file() {
        let mut file = NamedTempFile::new().unwrap();
        // Write corrupted INI content (missing section header, invalid format)
        writeln!(file, "[api").unwrap(); // Missing closing bracket
        writeln!(file, "key=value").unwrap();

        let storage = ConfigIniStorage::new(file.path().to_path_buf());
        let result = storage.load();

        // Should return error for corrupted INI file
        assert!(result.is_err());
    }

    #[test]
    fn test_load_invalid_utf8_file() {
        use std::io::Write;
        let file = NamedTempFile::new().unwrap();

        // Write invalid UTF-8 bytes
        let mut f = std::fs::File::create(file.path()).unwrap();
        f.write_all(&[0x80, 0x81, 0x82]).unwrap();

        let storage = ConfigIniStorage::new(file.path().to_path_buf());
        let result = storage.load();

        // Should return error for invalid UTF-8
        assert!(result.is_err());
    }



    #[test]
    fn test_partial_section_parsing() {
        let mut file = NamedTempFile::new().unwrap();
        // Only api section, missing other sections
        writeln!(file, "[api]").unwrap();
        writeln!(file, "key=partial-key").unwrap();
        // No other sections

        let storage = ConfigIniStorage::new(file.path().to_path_buf());
        let config = storage.load().unwrap();

        // api_key should be set
        assert_eq!(config.api_key, "partial-key");
        // Other fields should have defaults
        assert_eq!(config.hotkey, AppConfig::default().hotkey);
        assert_eq!(config.model, AppConfig::default().model);
    }

    #[test]
    fn test_unknown_section_ignored() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(file, "[api]").unwrap();
        writeln!(file, "key=valid-key").unwrap();
        writeln!(file, "[unknown_section]").unwrap();
        writeln!(file, "random_key=random_value").unwrap();
        writeln!(file, "another_key=another_value").unwrap();

        let storage = ConfigIniStorage::new(file.path().to_path_buf());
        let config = storage.load().unwrap();

        // Should successfully parse, ignoring unknown section
        assert_eq!(config.api_key, "valid-key");
    }

    #[test]
    fn test_empty_value_handling() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(file, "[api]").unwrap();
        writeln!(file, "key=").unwrap(); // Empty value
        writeln!(file, "model=").unwrap(); // Empty value
        writeln!(file, "language=en").unwrap(); // Non-empty

        let storage = ConfigIniStorage::new(file.path().to_path_buf());
        let config = storage.load().unwrap();

        // Empty values should be empty strings
        assert_eq!(config.api_key, "");
        assert_eq!(config.model, "");
        // Non-empty should work
        assert_eq!(config.language, "en");
    }
}
