//! SQLite storage for config.
//!
//! Stores config as key-value pairs in SQLite database.
//! Replaces INI storage to avoid section conflicts and ensure reliability.

use crate::config::{AppConfig, DictionaryConfig, LlmConfig, OverlayConfig, VadConfig};
use rusqlite::{params, Connection};
use std::path::PathBuf;

/// SQLite storage for config.
pub struct ConfigSqliteStorage {
    path: PathBuf,
}

impl ConfigSqliteStorage {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    /// Open connection and ensure schema exists.
    /// DRY: Uses sqlite_base for common connection pattern.
    fn connect(&self) -> Result<Connection, Box<dyn std::error::Error>> {
        use super::sqlite_base::open_with_schema;

        open_with_schema(&self.path, |conn| {
            conn.execute(
                "CREATE TABLE IF NOT EXISTS config (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )",
                [],
            )?;
            Ok(())
        })
    }

    /// Check if the config database is empty.
    pub fn is_empty(&self) -> Result<bool, Box<dyn std::error::Error>> {
        let conn = self.connect()?;
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM config", [], |row| row.get(0))?;
        Ok(count == 0)
    }

    /// Get a single value by key.
    fn get(&self, conn: &Connection, key: &str) -> Option<String> {
        conn.query_row("SELECT value FROM config WHERE key = ?", [key], |row| {
            row.get(0)
        })
        .ok()
    }

    /// Get a typed value with default (DRY helper for numeric types).
    fn get_typed<T: std::str::FromStr>(&self, conn: &Connection, key: &str, default: T) -> T {
        self.get(conn, key)
            .and_then(|v| v.parse().ok())
            .unwrap_or(default)
    }

    /// Get a bool value with default.
    fn get_bool(&self, conn: &Connection, key: &str, default: bool) -> bool {
        self.get(conn, key).map(|v| v == "true").unwrap_or(default)
    }

    /// Get a string value with default.
    fn get_str(&self, conn: &Connection, key: &str, default: &str) -> String {
        self.get(conn, key).unwrap_or_else(|| default.to_string())
    }

    /// Set a single key-value pair (upsert).
    fn set(
        &self,
        conn: &Connection,
        key: &str,
        value: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        conn.execute(
            "INSERT INTO config (key, value) VALUES (?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    /// Load config from SQLite database.
    pub fn load(&self) -> Result<AppConfig, Box<dyn std::error::Error>> {
        if !self.path.exists() {
            return Ok(AppConfig::default());
        }

        let conn = self.connect()?;
        let mut config = AppConfig::default();

        // API settings
        config.api_key = self.get(&conn, "api_key").unwrap_or_default();
        config.model = self.get_str(&conn, "model", &config.model);
        config.language = self.get_str(&conn, "language", &config.language);

        // Hotkey
        config.hotkey = self.get_str(&conn, "hotkey", &config.hotkey);
        config.hotkey_hold_ms =
            self.get_typed(&conn, "hotkey_hold_ms", config.hotkey_hold_ms);

        // Behavior
        config.auto_type = self.get_bool(&conn, "auto_type", config.auto_type);
        config.auto_enter = self.get_bool(&conn, "auto_enter", config.auto_enter);
        config.append_trailing_space = self.get_bool(
            &conn,
            "append_trailing_space",
            config.append_trailing_space,
        );
        config.translate_to_english = self.get_bool(
            &conn,
            "translate_to_english",
            config.translate_to_english,
        );
        if let Some(v) = self.get(&conn, "auto_submit_key") {
            if let Ok(parsed) = serde_json::from_str::<
                crate::output::auto_submit::AutoSubmitKey,
            >(&format!("\"{v}\""))
            {
                config.auto_submit_key = parsed;
            }
        }
        config.audio_feedback.enabled = self.get_bool(
            &conn,
            "audio_feedback_enabled",
            config.audio_feedback.enabled,
        );
        config.audio_feedback.volume = self.get_typed(
            &conn,
            "audio_feedback_volume",
            config.audio_feedback.volume,
        );
        // shortcut_bindings stored as a single JSON column — simpler
        // than a side table for a list whose total size is < 4 KB.
        if let Some(json) = self.get(&conn, "shortcut_bindings") {
            if let Ok(parsed) = serde_json::from_str::<
                Vec<crate::shortcut::ShortcutBinding>,
            >(&json)
            {
                if !parsed.is_empty() {
                    config.shortcut_bindings = parsed;
                }
            }
        }
        config.typing_delay = self.get_typed(&conn, "typing_delay", config.typing_delay);
        config.notifications = self.get_bool(&conn, "notifications", config.notifications);
        config.backend = self.get_str(&conn, "backend", &config.backend);
        config.debug = self.get_bool(&conn, "debug", config.debug);

        // Audio
        config.audio_device = self.get_str(&conn, "audio_device", &config.audio_device);

        // History
        config.history_enabled = self.get_bool(&conn, "history_enabled", config.history_enabled);
        config.history_days = self.get_typed(&conn, "history_days", config.history_days);

        // Provider
        config.active_provider = self.get_str(&conn, "active_provider", &config.active_provider);
        config.cloud_provider = self.get_str(&conn, "cloud_provider", &config.cloud_provider);
        config.local_backend = self.get_str(&conn, "local_backend", &config.local_backend);

        // Text processing
        config.text_processing = self.get_bool(&conn, "text_processing", config.text_processing);

        // Paste shortcuts
        config.paste_shortcuts = self.get_str(&conn, "paste_shortcuts", &config.paste_shortcuts);

        // VAD
        config.vad = VadConfig {
            enabled: self.get_bool(&conn, "vad_enabled", config.vad.enabled),
            backend: self.get_str(&conn, "vad_backend", &config.vad.backend),
            threshold: self.get_typed(&conn, "vad_threshold", config.vad.threshold),
            onset_frames: self.get_typed(&conn, "vad_onset_frames", config.vad.onset_frames),
            hangover_frames: self.get_typed(&conn, "vad_hangover_frames", config.vad.hangover_frames),
            prefill_frames: self.get_typed(&conn, "vad_prefill_frames", config.vad.prefill_frames),
        };

        // Overlay
        config.overlay = OverlayConfig {
            enabled: self.get_bool(&conn, "overlay_enabled", config.overlay.enabled),
            position: self.get_str(&conn, "overlay_position", &config.overlay.position),
            size: self.get_str(&conn, "overlay_size", &config.overlay.size),
            margin: self.get_typed(&conn, "overlay_margin", config.overlay.margin),
            audio_boost: self.get_typed(&conn, "overlay_audio_boost", config.overlay.audio_boost),
            theme: self.get_str(&conn, "overlay_theme", &config.overlay.theme),
            backend: self.get_str(&conn, "overlay_backend", &config.overlay.backend),
        };

        // LLM
        config.llm = LlmConfig {
            enabled: self.get_bool(&conn, "llm_enabled", config.llm.enabled),
            provider: self.get_str(&conn, "llm_provider", &config.llm.provider),
            api_url: self.get_str(&conn, "llm_api_url", &config.llm.api_url),
            api_key: self.get(&conn, "llm_api_key").unwrap_or_default(),
            model: self.get_str(&conn, "llm_model", &config.llm.model),
            prompt: self.get_str(&conn, "llm_prompt", &config.llm.prompt),
        };

        // Dictionary
        config.dictionary = DictionaryConfig {
            path: self.get(&conn, "dictionary_path").unwrap_or_default(),
            learning_mode: self.get_str(
                &conn,
                "dictionary_learning_mode",
                &config.dictionary.learning_mode,
            ),
            learning_threshold: self.get_typed(
                &conn,
                "dictionary_learning_threshold",
                config.dictionary.learning_threshold,
            ),
        };

        Ok(config)
    }

    /// Save config to SQLite database.
    pub fn save(&self, config: &AppConfig) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.connect()?;

        // API settings
        self.set(&conn, "api_key", &config.api_key)?;
        self.set(&conn, "model", &config.model)?;
        self.set(&conn, "language", &config.language)?;

        // Hotkey
        self.set(&conn, "hotkey", &config.hotkey)?;
        self.set(&conn, "hotkey_hold_ms", &config.hotkey_hold_ms.to_string())?;

        // Behavior
        self.set(&conn, "auto_type", &config.auto_type.to_string())?;
        self.set(&conn, "auto_enter", &config.auto_enter.to_string())?;
        self.set(
            &conn,
            "append_trailing_space",
            &config.append_trailing_space.to_string(),
        )?;
        self.set(
            &conn,
            "translate_to_english",
            &config.translate_to_english.to_string(),
        )?;
        // serde produces e.g. ""cmd_enter"" — trim quotes for storage.
        let auto_submit_str = serde_json::to_string(&config.auto_submit_key)
            .unwrap_or_else(|_| "\"off\"".to_string())
            .trim_matches('"')
            .to_string();
        self.set(&conn, "auto_submit_key", &auto_submit_str)?;
        self.set(
            &conn,
            "audio_feedback_enabled",
            &config.audio_feedback.enabled.to_string(),
        )?;
        self.set(
            &conn,
            "audio_feedback_volume",
            &config.audio_feedback.volume.to_string(),
        )?;
        if let Ok(json) = serde_json::to_string(&config.shortcut_bindings) {
            self.set(&conn, "shortcut_bindings", &json)?;
        }
        self.set(&conn, "typing_delay", &config.typing_delay.to_string())?;
        self.set(&conn, "notifications", &config.notifications.to_string())?;
        self.set(&conn, "backend", &config.backend)?;
        self.set(&conn, "debug", &config.debug.to_string())?;

        // Audio
        self.set(&conn, "audio_device", &config.audio_device)?;

        // History
        self.set(
            &conn,
            "history_enabled",
            &config.history_enabled.to_string(),
        )?;
        self.set(&conn, "history_days", &config.history_days.to_string())?;

        // Provider
        self.set(&conn, "active_provider", &config.active_provider)?;
        self.set(&conn, "cloud_provider", &config.cloud_provider)?;
        self.set(&conn, "local_backend", &config.local_backend)?;

        // Text processing
        self.set(
            &conn,
            "text_processing",
            &config.text_processing.to_string(),
        )?;

        // Paste shortcuts
        self.set(&conn, "paste_shortcuts", &config.paste_shortcuts)?;

        // VAD
        self.set(&conn, "vad_enabled", &config.vad.enabled.to_string())?;
        self.set(&conn, "vad_threshold", &config.vad.threshold.to_string())?;

        // Overlay
        self.set(
            &conn,
            "overlay_enabled",
            &config.overlay.enabled.to_string(),
        )?;
        self.set(&conn, "overlay_position", &config.overlay.position)?;
        self.set(&conn, "overlay_size", &config.overlay.size)?;
        self.set(&conn, "overlay_margin", &config.overlay.margin.to_string())?;
        self.set(
            &conn,
            "overlay_audio_boost",
            &config.overlay.audio_boost.to_string(),
        )?;
        self.set(&conn, "overlay_theme", &config.overlay.theme)?;
        self.set(&conn, "overlay_backend", &config.overlay.backend)?;

        // LLM
        self.set(&conn, "llm_enabled", &config.llm.enabled.to_string())?;
        self.set(&conn, "llm_provider", &config.llm.provider)?;
        self.set(&conn, "llm_api_url", &config.llm.api_url)?;
        self.set(&conn, "llm_api_key", &config.llm.api_key)?;
        self.set(&conn, "llm_model", &config.llm.model)?;
        self.set(&conn, "llm_prompt", &config.llm.prompt)?;

        // Dictionary
        self.set(&conn, "dictionary_path", &config.dictionary.path)?;
        self.set(
            &conn,
            "dictionary_learning_mode",
            &config.dictionary.learning_mode,
        )?;
        self.set(
            &conn,
            "dictionary_learning_threshold",
            &config.dictionary.learning_threshold.to_string(),
        )?;

        Ok(())
    }
}

// =============================================================================
// Trait implementation for DIP compliance
// =============================================================================

impl super::traits::ConfigStorage for ConfigSqliteStorage {
    fn load(&self) -> super::traits::StorageResult<AppConfig> {
        self.load().map_err(super::traits::into_storage_error)
    }

    fn save(&self, config: &AppConfig) -> super::traits::StorageResult<()> {
        self.save(config).map_err(super::traits::into_storage_error)
    }

    fn is_empty(&self) -> super::traits::StorageResult<bool> {
        self.is_empty().map_err(super::traits::into_storage_error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    #[test]
    fn test_save_and_load_config() {
        let file = NamedTempFile::new().unwrap();
        let storage = ConfigSqliteStorage::new(file.path().to_path_buf());

        let mut config = AppConfig {
            api_key: "test-key-123".to_string(),
            hotkey: "f12".to_string(),
            auto_type: false,
            ..AppConfig::default()
        };
        config.llm.api_key = "llm-key-456".to_string();

        storage.save(&config).unwrap();
        let loaded = storage.load().unwrap();

        assert_eq!(loaded.api_key, "test-key-123");
        assert_eq!(loaded.hotkey, "f12");
        assert!(!loaded.auto_type);
        assert_eq!(loaded.llm.api_key, "llm-key-456");
    }

    #[test]
    fn test_load_nonexistent_returns_default() {
        let storage = ConfigSqliteStorage::new(PathBuf::from("/nonexistent/config.db"));
        let config = storage.load().unwrap();
        assert_eq!(config, AppConfig::default());
    }

    #[test]
    fn test_is_empty() {
        let file = NamedTempFile::new().unwrap();
        let storage = ConfigSqliteStorage::new(file.path().to_path_buf());

        // Initially empty
        assert!(storage.is_empty().unwrap());

        // After save, not empty
        let config = AppConfig::default();
        storage.save(&config).unwrap();
        assert!(!storage.is_empty().unwrap());
    }

    #[test]
    fn test_upsert() {
        let file = NamedTempFile::new().unwrap();
        let storage = ConfigSqliteStorage::new(file.path().to_path_buf());

        let mut config = AppConfig {
            api_key: "first-key".to_string(),
            ..AppConfig::default()
        };
        storage.save(&config).unwrap();

        // Update api_key
        config.api_key = "second-key".to_string();
        storage.save(&config).unwrap();

        let loaded = storage.load().unwrap();
        assert_eq!(loaded.api_key, "second-key");
    }

    #[test]
    fn test_save_creates_db() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("new_config.db");
        let storage = ConfigSqliteStorage::new(path.clone());

        assert!(!path.exists());

        let config = AppConfig::default();
        storage.save(&config).unwrap();

        assert!(path.exists());
    }

    #[test]
    fn test_save_and_load_cycle_all_fields() {
        let file = NamedTempFile::new().unwrap();
        let storage = ConfigSqliteStorage::new(file.path().to_path_buf());

        let mut config = AppConfig {
            api_key: "api-123".to_string(),
            model: "custom-model".to_string(),
            language: "ru".to_string(),
            hotkey: "ctrl+shift+r".to_string(),
            hotkey_hold_ms: 750,
            auto_type: false,
            auto_enter: true,
            typing_delay: 50,
            notifications: false,
            backend: "custom-backend".to_string(),
            debug: true,
            audio_device: "USB Mic".to_string(),
            history_enabled: false,
            history_days: 90,
            active_provider: "local".to_string(),
            text_processing: false,
            ..AppConfig::default()
        };
        config.vad.enabled = true;
        config.vad.threshold = 0.75;
        config.overlay.enabled = true;
        config.overlay.position = "top-left".to_string();
        config.overlay.size = "large".to_string();
        config.overlay.margin = 50;
        config.llm.enabled = true;
        config.llm.provider = "custom-llm".to_string();
        config.llm.api_key = "llm-secret".to_string();
        config.dictionary.learning_mode = "manual".to_string();
        config.dictionary.learning_threshold = 10;

        storage.save(&config).unwrap();
        let loaded = storage.load().unwrap();

        assert_eq!(loaded.api_key, "api-123");
        assert_eq!(loaded.model, "custom-model");
        assert_eq!(loaded.language, "ru");
        assert_eq!(loaded.hotkey, "ctrl+shift+r");
        assert_eq!(
            loaded.hotkey_hold_ms, 750,
            "custom hotkey hold threshold must persist across save/load"
        );
        assert!(!loaded.auto_type);
        assert!(loaded.auto_enter);
        assert_eq!(loaded.typing_delay, 50);
        assert!(!loaded.notifications);
        assert!(loaded.debug);
        assert_eq!(loaded.audio_device, "USB Mic");
        assert!(!loaded.history_enabled);
        assert_eq!(loaded.history_days, 90);
        assert_eq!(loaded.active_provider, "local");
        assert!(loaded.vad.enabled);
        assert!((loaded.vad.threshold - 0.75).abs() < 0.001);
        assert!(loaded.overlay.enabled);
        assert_eq!(loaded.overlay.position, "top-left");
        assert!(loaded.llm.enabled);
        assert_eq!(loaded.llm.api_key, "llm-secret");
        assert_eq!(loaded.dictionary.learning_threshold, 10);
    }

    /// Regression: `overlay.backend` must be persisted by `save()`.
    /// Before fix: read path had `get_str("overlay_backend", …)` at line
    /// ~145, but write path silently dropped it — changing backend in the UI
    /// looked successful (in-memory config updated) but was lost on next load.
    #[test]
    fn test_overlay_backend_persists_through_roundtrip() {
        let file = NamedTempFile::new().unwrap();
        let storage = ConfigSqliteStorage::new(file.path().to_path_buf());

        let mut config = AppConfig::default();
        config.overlay.backend = "nspanel".to_string();

        storage.save(&config).unwrap();
        let loaded = storage.load().unwrap();

        assert_eq!(
            loaded.overlay.backend, "nspanel",
            "overlay.backend must roundtrip through SQLite (read AND write)"
        );
    }

    #[test]
    fn test_partial_update_preserves_other_values() {
        let file = NamedTempFile::new().unwrap();
        let storage = ConfigSqliteStorage::new(file.path().to_path_buf());

        // Save initial config
        let config = AppConfig {
            api_key: "initial-key".to_string(),
            hotkey: "f10".to_string(),
            ..AppConfig::default()
        };
        storage.save(&config).unwrap();

        // Update only api_key
        let mut updated = storage.load().unwrap();
        updated.api_key = "updated-key".to_string();
        storage.save(&updated).unwrap();

        let loaded = storage.load().unwrap();
        assert_eq!(loaded.api_key, "updated-key");
        assert_eq!(loaded.hotkey, "f10"); // Should be preserved
    }

    #[test]
    fn test_default_values_on_empty_db() {
        let file = NamedTempFile::new().unwrap();
        let storage = ConfigSqliteStorage::new(file.path().to_path_buf());

        // Create empty schema without saving config
        let conn = storage.connect().unwrap();
        drop(conn);

        let loaded = storage.load().unwrap();
        let default = AppConfig::default();

        // Should have defaults for non-stored values
        assert_eq!(loaded.model, default.model);
        assert_eq!(loaded.hotkey, default.hotkey);
        assert_eq!(loaded.typing_delay, default.typing_delay);
    }

    #[test]
    fn test_connect_creates_schema_idempotent() {
        let file = NamedTempFile::new().unwrap();
        let storage = ConfigSqliteStorage::new(file.path().to_path_buf());

        // Multiple connects should work
        let _conn1 = storage.connect().unwrap();
        let _conn2 = storage.connect().unwrap();
        let _conn3 = storage.connect().unwrap();

        // Should still work after multiple connects
        let config = AppConfig::default();
        storage.save(&config).unwrap();
        let loaded = storage.load().unwrap();
        assert_eq!(loaded, config);
    }

    #[test]
    fn test_get_bool_default() {
        let file = NamedTempFile::new().unwrap();
        let storage = ConfigSqliteStorage::new(file.path().to_path_buf());
        let conn = storage.connect().unwrap();

        // Non-existent key returns default
        assert!(storage.get_bool(&conn, "nonexistent_bool", true));
        assert!(!storage.get_bool(&conn, "nonexistent_bool", false));
    }

    #[test]
    fn test_get_str_default() {
        let file = NamedTempFile::new().unwrap();
        let storage = ConfigSqliteStorage::new(file.path().to_path_buf());
        let conn = storage.connect().unwrap();

        // Non-existent key returns default
        let result = storage.get_str(&conn, "nonexistent_str", "default_value");
        assert_eq!(result, "default_value");
    }

    #[test]
    fn test_get_typed_default() {
        let file = NamedTempFile::new().unwrap();
        let storage = ConfigSqliteStorage::new(file.path().to_path_buf());
        let conn = storage.connect().unwrap();

        // Non-existent key returns default
        let result: i32 = storage.get_typed(&conn, "nonexistent_int", 42);
        assert_eq!(result, 42);

        let result: f64 = storage.get_typed(&conn, "nonexistent_float", 1.5);
        assert!((result - 1.5).abs() < 0.001);
    }

    #[test]
    fn test_set_and_get_single_value() {
        let file = NamedTempFile::new().unwrap();
        let storage = ConfigSqliteStorage::new(file.path().to_path_buf());
        let conn = storage.connect().unwrap();

        storage.set(&conn, "test_key", "test_value").unwrap();

        let result = storage.get(&conn, "test_key");
        assert_eq!(result, Some("test_value".to_string()));
    }

    #[test]
    fn test_load_corrupted_db() {
        use std::io::Write;
        let file = NamedTempFile::new().unwrap();

        // Write invalid SQLite data (not a valid database)
        let mut f = std::fs::File::create(file.path()).unwrap();
        f.write_all(b"This is not a valid SQLite database!")
            .unwrap();

        let storage = ConfigSqliteStorage::new(file.path().to_path_buf());
        let result = storage.load();

        // Should fail to open corrupted database
        assert!(result.is_err());
    }

    #[test]
    fn test_save_to_corrupted_db() {
        use std::io::Write;
        let file = NamedTempFile::new().unwrap();

        // Write garbage data to the file
        let mut f = std::fs::File::create(file.path()).unwrap();
        f.write_all(b"CORRUPT_DATA_NOT_SQLITE").unwrap();

        let storage = ConfigSqliteStorage::new(file.path().to_path_buf());
        let config = AppConfig::default();
        let result = storage.save(&config);

        // Should fail to open corrupted database for writing
        assert!(result.is_err());
    }

    #[test]
    fn test_is_empty_corrupted_db() {
        use std::io::Write;
        let file = NamedTempFile::new().unwrap();

        let mut f = std::fs::File::create(file.path()).unwrap();
        f.write_all(b"NOT_A_DATABASE").unwrap();

        let storage = ConfigSqliteStorage::new(file.path().to_path_buf());
        let result = storage.is_empty();

        // Should fail
        assert!(result.is_err());
    }

    #[test]
    fn test_get_typed_invalid_value_returns_default() {
        let file = NamedTempFile::new().unwrap();
        let storage = ConfigSqliteStorage::new(file.path().to_path_buf());
        let conn = storage.connect().unwrap();

        // Store a non-numeric string for a numeric field
        storage.set(&conn, "typing_delay", "not_a_number").unwrap();

        // get_typed should return default when parse fails
        let result: u32 = storage.get_typed(&conn, "typing_delay", 12);
        assert_eq!(result, 12);
    }

    #[test]
    fn test_get_bool_non_true_string() {
        let file = NamedTempFile::new().unwrap();
        let storage = ConfigSqliteStorage::new(file.path().to_path_buf());
        let conn = storage.connect().unwrap();

        // Store various non-"true" strings
        storage.set(&conn, "test_bool", "yes").unwrap();
        assert!(!storage.get_bool(&conn, "test_bool", true));

        storage.set(&conn, "test_bool", "1").unwrap();
        assert!(!storage.get_bool(&conn, "test_bool", true));

        storage.set(&conn, "test_bool", "TRUE").unwrap();
        assert!(!storage.get_bool(&conn, "test_bool", true)); // case-sensitive: "TRUE" != "true"

        storage.set(&conn, "test_bool", "true").unwrap();
        assert!(storage.get_bool(&conn, "test_bool", false));
    }

    #[test]
    fn test_save_to_readonly_directory() {
        // Try to save to a path within a non-existent deeply nested directory
        // that cannot be auto-created (SQLite will fail)
        let storage = ConfigSqliteStorage::new(PathBuf::from("/proc/nonexistent/config.db"));
        let config = AppConfig::default();
        let result = storage.save(&config);
        assert!(result.is_err());
    }

    #[test]
    fn test_load_invalid_json_value() {
        let file = NamedTempFile::new().unwrap();
        let storage = ConfigSqliteStorage::new(file.path().to_path_buf());
        let conn = storage.connect().unwrap();

        // Insert invalid JSON-like value (shouldn't affect string parsing)
        storage.set(&conn, "api_key", "{invalid: json}").unwrap();

        // Load should succeed (we store strings, not JSON)
        let config = storage.load().unwrap();
        assert_eq!(config.api_key, "{invalid: json}");
    }

    #[test]
    fn test_save_with_special_characters() {
        let file = NamedTempFile::new().unwrap();
        let storage = ConfigSqliteStorage::new(file.path().to_path_buf());

        let mut config = AppConfig {
            api_key: "key'with\"special<>&chars".to_string(),
            hotkey: "Привет мир 你好".to_string(), // Unicode
            ..AppConfig::default()
        };
        config.llm.prompt = "Prompt with\nnewlines\tand\ttabs".to_string();

        storage.save(&config).unwrap();
        let loaded = storage.load().unwrap();

        assert_eq!(loaded.api_key, "key'with\"special<>&chars");
        assert_eq!(loaded.llm.prompt, "Prompt with\nnewlines\tand\ttabs");
        assert_eq!(loaded.hotkey, "Привет мир 你好");
    }

    #[test]
    fn test_concurrent_save_load() {
        use std::thread;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("concurrent.db");

        // Create storage and initialize
        let storage1 = ConfigSqliteStorage::new(path.clone());
        let config1 = AppConfig {
            api_key: "initial".to_string(),
            ..AppConfig::default()
        };
        storage1.save(&config1).unwrap();

        // Concurrent reads should work
        let path2 = path.clone();
        let handle = thread::spawn(move || {
            let storage = ConfigSqliteStorage::new(path2);
            storage.load().unwrap()
        });

        let loaded1 = storage1.load().unwrap();
        let loaded2 = handle.join().unwrap();

        assert_eq!(loaded1.api_key, "initial");
        assert_eq!(loaded2.api_key, "initial");
    }

    #[test]
    fn test_schema_migration_from_empty() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("new_schema.db");

        // First access creates schema
        let storage = ConfigSqliteStorage::new(path.clone());
        let config = storage.load().unwrap();
        assert_eq!(config, AppConfig::default());

        // Verify schema was created by checking we can write
        let config2 = AppConfig {
            api_key: "after_migration".to_string(),
            ..AppConfig::default()
        };
        storage.save(&config2).unwrap();

        let loaded = storage.load().unwrap();
        assert_eq!(loaded.api_key, "after_migration");
    }

    #[test]
    fn test_large_config_values() {
        let file = NamedTempFile::new().unwrap();
        let storage = ConfigSqliteStorage::new(file.path().to_path_buf());

        let mut config = AppConfig::default();
        // Create a very large prompt (10KB)
        config.llm.prompt = "X".repeat(10_000);
        // Large API key
        config.api_key = "K".repeat(1_000);

        storage.save(&config).unwrap();
        let loaded = storage.load().unwrap();

        assert_eq!(loaded.llm.prompt.len(), 10_000);
        assert_eq!(loaded.api_key.len(), 1_000);
    }

    #[test]
    fn test_paste_shortcuts_save_and_load() {
        let file = NamedTempFile::new().unwrap();
        let storage = ConfigSqliteStorage::new(file.path().to_path_buf());

        let config = AppConfig {
            paste_shortcuts: "ctrl_shift_v,shift_insert".to_string(),
            ..AppConfig::default()
        };

        storage.save(&config).unwrap();
        let loaded = storage.load().unwrap();

        assert_eq!(loaded.paste_shortcuts, "ctrl_shift_v,shift_insert");
    }

    #[test]
    fn test_paste_shortcuts_default() {
        let file = NamedTempFile::new().unwrap();
        let storage = ConfigSqliteStorage::new(file.path().to_path_buf());

        // Don't save anything - should get default
        let loaded = storage.load().unwrap();
        assert_eq!(loaded.paste_shortcuts, "ctrl_shift_v");
    }
}
