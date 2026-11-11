//! SQLite storage for config.
//!
//! Stores config as key-value pairs in SQLite database.
//! Replaces INI storage to avoid section conflicts and ensure reliability.

use crate::config::{AppConfig, DictionaryConfig, LlmConfig, OverlayConfig, VadConfig};
use rusqlite::{params, Connection};
use std::path::PathBuf;

use super::sqlite_base::SqliteSchema;

/// SQLite storage for config.
pub struct ConfigSqliteStorage {
    path: PathBuf,
    /// Task 6: when `true`, every connection this storage opens goes
    /// through `sqlite_base::open_read_only` (no `init_schema`, no
    /// writes possible) instead of `SqliteSchema::connect`. See
    /// `read_only`'s doc comment.
    read_only: bool,
}

impl ConfigSqliteStorage {
    pub fn new(path: PathBuf) -> Self {
        Self { path, read_only: false }
    }

    /// Open an existing `config.db` strictly read-only — for
    /// `import_profile_from_desktop` reading an installed Voxis desktop's
    /// database, which may be open and being written to by that other
    /// process at the same time (`[R1-Safety S7]`). Every connection this
    /// instance opens (`load`/`is_empty`, and `save` if ever mistakenly
    /// called on it) goes through `sqlite_base::open_read_only` — no
    /// `CREATE TABLE`/`INSERT` (`init_schema`) ever runs, and an actual
    /// write attempt fails with `SQLITE_READONLY` rather than silently
    /// succeeding. A missing `path` surfaces as
    /// `sqlite_base::ReadOnlyOpenError::NotFound` from the first call that
    /// opens a connection, not from this constructor (which never touches
    /// the filesystem).
    pub fn read_only(path: PathBuf) -> Self {
        Self { path, read_only: true }
    }

    /// DRY seam every method below calls instead of `self.connect()`
    /// directly — the one place the `read_only` flag is honored.
    fn conn(&self) -> Result<Connection, Box<dyn std::error::Error>> {
        if self.read_only {
            Ok(super::sqlite_base::open_read_only(&self.path)?)
        } else {
            self.connect()
        }
    }

    /// Check if the config database is empty.
    pub fn is_empty(&self) -> Result<bool, Box<dyn std::error::Error>> {
        let conn = self.conn()?;
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

    /// Read + serde-deserialize a JSON-encoded value. Returns `default`
    /// when the key is absent, the value is empty, or deserialization
    /// fails (corrupt blob never crashes the load path — user keeps
    /// the default for that key and the rest of the config loads).
    ///
    /// DRY: replaces the three slightly-different copies that lived
    /// in the old `load()` for auto_submit_key, shortcut_bindings, and
    /// the per-field retention/hotkey_mode whitelists.
    fn get_json<T: serde::de::DeserializeOwned>(
        &self,
        conn: &Connection,
        key: &str,
        default: T,
    ) -> T {
        let Some(raw) = self.get(conn, key) else {
            return default;
        };
        if raw.is_empty() {
            return default;
        }
        serde_json::from_str::<T>(&raw).unwrap_or(default)
    }

    /// Serialize + upsert a JSON-encoded value. Errors are propagated
    /// so the save path stays atomic-ish (one bad key fails the whole
    /// save, surfacing the bug instead of silently dropping it).
    fn set_json<T: serde::Serialize>(
        &self,
        conn: &Connection,
        key: &str,
        value: &T,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let json = serde_json::to_string(value)?;
        self.set(conn, key, &json)
    }

    /// Load config from SQLite database.
    pub fn load(&self) -> Result<AppConfig, Box<dyn std::error::Error>> {
        if !self.path.exists() {
            return Ok(AppConfig::default());
        }

        let conn = self.conn()?;
        let mut config = AppConfig::default();

        // API settings
        config.api_key = self.get(&conn, "api_key").unwrap_or_default();
        config.model = self.get_str(&conn, "model", &config.model);
        config.language = self.get_str(&conn, "language", &config.language);
        // `api_url_override`: this was a real, pre-existing gap (found
        // while validating Task 6b's profile round-trip) -- neither
        // `load` nor `save` touched this key at all, so a user's
        // self-hosted endpoint (Settings -> Provider, `docs/
        // SELF_HOSTED_TRANSCRIPTION.md`) silently reverted to `None`
        // (default Groq) on the very next config load/app restart, even
        // though `save_config` calls this exact `save`. Same
        // empty-string-means-`None` convention `api_key`/`llm.api_key`
        // already use for an optional secret-shaped string.
        let stored_api_url_override = self.get(&conn, "api_url_override").unwrap_or_default();
        config.api_url_override =
            (!stored_api_url_override.is_empty()).then_some(stored_api_url_override);

        // Hotkey
        config.hotkey = self.get_str(&conn, "hotkey", &config.hotkey);
        config.hotkey_hold_ms = self.get_typed(&conn, "hotkey_hold_ms", config.hotkey_hold_ms);
        // `min_recording_ms`: Task 6c — same silent-revert class as Task
        // 6b's `api_url_override`. Neither `save` nor `load` touched this
        // key at all, so a custom "minimum recording length" setting
        // silently reverted to `DEFAULT_MIN_RECORDING_MS` on every
        // restart. Caught by
        // `every_app_config_field_round_trips_through_sqlite`.
        config.min_recording_ms =
            self.get_typed(&conn, "min_recording_ms", config.min_recording_ms);

        // Recording guard (Layer 5)
        config.silence_timeout_ms =
            self.get_typed(&conn, "silence_timeout_ms", config.silence_timeout_ms);
        config.max_recording_ms =
            self.get_typed(&conn, "max_recording_ms", config.max_recording_ms);

        // Behavior
        config.auto_type = self.get_bool(&conn, "auto_type", config.auto_type);
        config.auto_enter = self.get_bool(&conn, "auto_enter", config.auto_enter);
        config.append_trailing_space =
            self.get_bool(&conn, "append_trailing_space", config.append_trailing_space);
        config.translate_to_english =
            self.get_bool(&conn, "translate_to_english", config.translate_to_english);
        // auto_submit_key serialized as JSON (e.g. "off", "cmd_enter")
        // — stored with the quotes via set_json so get_json reads it
        // back symmetrically.
        config.auto_submit_key = self.get_json(&conn, "auto_submit_key", config.auto_submit_key);
        config.audio_feedback.enabled = self.get_bool(
            &conn,
            "audio_feedback_enabled",
            config.audio_feedback.enabled,
        );
        config.audio_feedback.volume =
            self.get_typed(&conn, "audio_feedback_volume", config.audio_feedback.volume);
        // shortcut_bindings: single JSON column (DRY storage pattern).
        // Empty array on disk still overrides the default if we let it;
        // we keep the seeded defaults via the only-when-non-empty guard.
        let stored_bindings: Vec<crate::shortcut::binding::ShortcutBinding> =
            self.get_json(&conn, "shortcut_bindings", Vec::new());
        if !stored_bindings.is_empty() {
            config.shortcut_bindings = stored_bindings;
        }
        config.first_run_completed =
            self.get_bool(&conn, "first_run_completed", config.first_run_completed);
        if let Some(v) = self.get(&conn, "hotkey_mode") {
            // Forward-compat: only accept known values, otherwise keep default.
            if matches!(v.as_str(), "hold" | "toggle") {
                config.hotkey_mode = v;
            }
        }
        if let Some(v) = self.get(&conn, "retention_period") {
            if matches!(
                v.as_str(),
                "never" | "preserve_limit" | "days_3" | "weeks_2" | "months_3"
            ) {
                config.retention_period = v;
            }
        }
        config.retention_limit = self.get_typed(&conn, "retention_limit", config.retention_limit);
        config.always_on_microphone =
            self.get_bool(&conn, "always_on_microphone", config.always_on_microphone);
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
            hangover_frames: self.get_typed(
                &conn,
                "vad_hangover_frames",
                config.vad.hangover_frames,
            ),
            prefill_frames: self.get_typed(&conn, "vad_prefill_frames", config.vad.prefill_frames),
        };

        // Overlay
        let overlay_custom_x = self
            .get(&conn, "overlay_custom_x")
            .and_then(|v| v.parse::<i32>().ok());
        let overlay_custom_y = self
            .get(&conn, "overlay_custom_y")
            .and_then(|v| v.parse::<i32>().ok());
        config.overlay = OverlayConfig {
            enabled: self.get_bool(&conn, "overlay_enabled", config.overlay.enabled),
            position: self.get_str(&conn, "overlay_position", &config.overlay.position),
            size: self.get_str(&conn, "overlay_size", &config.overlay.size),
            margin: self.get_typed(&conn, "overlay_margin", config.overlay.margin),
            audio_boost: self.get_typed(&conn, "overlay_audio_boost", config.overlay.audio_boost),
            theme: self.get_str(&conn, "overlay_theme", &config.overlay.theme),
            backend: self.get_str(&conn, "overlay_backend", &config.overlay.backend),
            custom_x: overlay_custom_x,
            custom_y: overlay_custom_y,
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
    ///
    /// Every field must be persisted in ConfigSqliteStorage::save/load —
    /// see test every_app_config_field_round_trips_through_sqlite.
    pub fn save(&self, config: &AppConfig) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.conn()?;

        // API settings
        self.set(&conn, "api_key", &config.api_key)?;
        self.set(&conn, "model", &config.model)?;
        self.set(&conn, "language", &config.language)?;
        self.set(&conn, "api_url_override", config.api_url_override.as_deref().unwrap_or(""))?;

        // Hotkey
        self.set(&conn, "hotkey", &config.hotkey)?;
        self.set(&conn, "hotkey_hold_ms", &config.hotkey_hold_ms.to_string())?;
        // Task 6c: was never written by `save` at all (see the matching
        // `load` comment above).
        self.set(&conn, "min_recording_ms", &config.min_recording_ms.to_string())?;

        // Recording guard (Layer 5)
        self.set(
            &conn,
            "silence_timeout_ms",
            &config.silence_timeout_ms.to_string(),
        )?;
        self.set(
            &conn,
            "max_recording_ms",
            &config.max_recording_ms.to_string(),
        )?;

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
        self.set_json(&conn, "auto_submit_key", &config.auto_submit_key)?;
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
        self.set_json(&conn, "shortcut_bindings", &config.shortcut_bindings)?;
        self.set(
            &conn,
            "first_run_completed",
            &config.first_run_completed.to_string(),
        )?;
        self.set(&conn, "hotkey_mode", &config.hotkey_mode)?;
        self.set(&conn, "retention_period", &config.retention_period)?;
        self.set(
            &conn,
            "retention_limit",
            &config.retention_limit.to_string(),
        )?;
        self.set(
            &conn,
            "always_on_microphone",
            &config.always_on_microphone.to_string(),
        )?;
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
        // Task 6c: `backend`/`onset_frames`/`hangover_frames`/
        // `prefill_frames` were read by `load` (above) but never written
        // here — same silent-revert class as `min_recording_ms` and Task
        // 6b's `api_url_override`. Found by
        // `every_app_config_field_round_trips_through_sqlite`.
        self.set(&conn, "vad_enabled", &config.vad.enabled.to_string())?;
        self.set(&conn, "vad_backend", &config.vad.backend)?;
        self.set(&conn, "vad_threshold", &config.vad.threshold.to_string())?;
        self.set(&conn, "vad_onset_frames", &config.vad.onset_frames.to_string())?;
        self.set(
            &conn,
            "vad_hangover_frames",
            &config.vad.hangover_frames.to_string(),
        )?;
        self.set(
            &conn,
            "vad_prefill_frames",
            &config.vad.prefill_frames.to_string(),
        )?;

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
        self.set(
            &conn,
            "overlay_custom_x",
            &config.overlay.custom_x.map(|v| v.to_string()).unwrap_or_default(),
        )?;
        self.set(
            &conn,
            "overlay_custom_y",
            &config.overlay.custom_y.map(|v| v.to_string()).unwrap_or_default(),
        )?;

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
// SqliteSchema trait — DRY connect() via sqlite_base
// =============================================================================

impl SqliteSchema for ConfigSqliteStorage {
    fn path(&self) -> &std::path::Path {
        &self.path
    }

    fn init_schema(&self, conn: &Connection) -> Result<(), Box<dyn std::error::Error>> {
        conn.execute(
            "CREATE TABLE IF NOT EXISTS config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
            [],
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
    use crate::storage::sqlite_base::SqliteSchema;
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

    /// Task 6b regression: `api_url_override` used to round-trip to
    /// `None` regardless of what was saved (`save`/`load` never touched
    /// its key at all) -- a real, pre-existing gap discovered while
    /// validating the plugin's profile-import path, and a genuine
    /// production bug in desktop Voxis's own `save_config` command
    /// (`Settings -> Provider`'s custom endpoint field, `docs/
    /// SELF_HOSTED_TRANSCRIPTION.md`), not something introduced by the
    /// plugin work.
    #[test]
    fn api_url_override_round_trips_some() {
        let file = NamedTempFile::new().unwrap();
        let storage = ConfigSqliteStorage::new(file.path().to_path_buf());

        let config = AppConfig {
            api_url_override: Some("http://127.0.0.1:4217/v1/audio/transcriptions".to_string()),
            ..AppConfig::default()
        };
        storage.save(&config).unwrap();

        let loaded = storage.load().unwrap();

        assert_eq!(
            loaded.api_url_override.as_deref(),
            Some("http://127.0.0.1:4217/v1/audio/transcriptions")
        );
    }

    #[test]
    fn api_url_override_round_trips_none() {
        let file = NamedTempFile::new().unwrap();
        let storage = ConfigSqliteStorage::new(file.path().to_path_buf());

        let config = AppConfig { api_url_override: None, ..AppConfig::default() };
        storage.save(&config).unwrap();

        let loaded = storage.load().unwrap();

        assert_eq!(loaded.api_url_override, None);
    }

    /// A `Some` value saved, then explicitly cleared back to `None` and
    /// saved again, must actually clear on disk -- not just "a fresh
    /// `AppConfig::default()` happens to be `None`" (the test above
    /// alone wouldn't catch a `save` that only ever ADDS the key, never
    /// overwrites it back to empty).
    #[test]
    fn api_url_override_can_be_cleared_back_to_none() {
        let file = NamedTempFile::new().unwrap();
        let storage = ConfigSqliteStorage::new(file.path().to_path_buf());

        let with_override = AppConfig {
            api_url_override: Some("http://127.0.0.1:4217/v1/audio/transcriptions".to_string()),
            ..AppConfig::default()
        };
        storage.save(&with_override).unwrap();
        assert!(storage.load().unwrap().api_url_override.is_some());

        let cleared = AppConfig { api_url_override: None, ..AppConfig::default() };
        storage.save(&cleared).unwrap();

        assert_eq!(storage.load().unwrap().api_url_override, None);
    }

    #[test]
    fn json_helpers_roundtrip_via_save_and_load() {
        // Covers the get_json / set_json contract via the public
        // save/load API: a complex value (auto_submit_key enum,
        // shortcut_bindings list, audio_feedback nested struct) must
        // round-trip identically.
        let file = NamedTempFile::new().unwrap();
        let storage = ConfigSqliteStorage::new(file.path().to_path_buf());

        let mut config = AppConfig {
            auto_submit_key: crate::output_types::AutoSubmitKey::CmdEnter,
            ..AppConfig::default()
        };
        config.audio_feedback.enabled = true;
        config.audio_feedback.volume = 0.42;
        config.shortcut_bindings[0].current_binding = "f9".to_string();

        storage.save(&config).unwrap();
        let loaded = storage.load().unwrap();

        assert_eq!(
            loaded.auto_submit_key,
            crate::output_types::AutoSubmitKey::CmdEnter
        );
        assert!(loaded.audio_feedback.enabled);
        assert!((loaded.audio_feedback.volume - 0.42).abs() < 1e-6);
        assert_eq!(loaded.shortcut_bindings[0].current_binding, "f9");
    }

    #[test]
    fn json_helpers_handle_corrupt_blob_gracefully() {
        // Manually inject a malformed JSON for auto_submit_key; load
        // must keep the default rather than panicking. The defensive
        // unwrap_or(default) in get_json is what makes this safe.
        let file = NamedTempFile::new().unwrap();
        let storage = ConfigSqliteStorage::new(file.path().to_path_buf());
        // First save a valid config to create the table.
        storage.save(&AppConfig::default()).unwrap();
        // Then corrupt the value at the SQL level.
        let conn = storage.connect().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO config (key, value) VALUES ('auto_submit_key', '{ not json }')",
            [],
        )
        .unwrap();

        let loaded = storage.load().unwrap();
        assert_eq!(
            loaded.auto_submit_key,
            crate::output_types::AutoSubmitKey::Off
        );
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

    /// `[ADO-6c]`: replaces the deleted `test_save_and_load_cycle_all_fields`,
    /// which was weaker than its name claimed on two counts — it built
    /// `AppConfig` with `..AppConfig::default()`, so any field the test
    /// author forgot to list (or any field added to `AppConfig` later)
    /// silently rode on the default instead of actually being exercised;
    /// and several fields it DID set (`backend`, `text_processing`,
    /// `overlay.size`, `overlay.margin`, `llm.provider`,
    /// `dictionary.learning_mode`) were never asserted on the loaded copy
    /// at all — a regression in any of those six round-trips would have
    /// passed silently. This test picks up exactly that gap: every field
    /// set here is also asserted, no `..Default()`. Other fields already
    /// have their own focused round-trip tests (e.g.
    /// `test_overlay_backend_persists_through_roundtrip`,
    /// `test_partial_update_preserves_other_values`) — this one doesn't
    /// re-cover those, only the six that had none.
    // Deliberately field-by-field, not `AppConfig { .. , ..Default::default() }`
    // -- see this test's own doc comment above (`[ADO-6c]`) on why the
    // predecessor test's `..Default()` usage was exactly the problem.
    #[allow(clippy::field_reassign_with_default)]
    #[test]
    fn test_backend_text_processing_overlay_size_margin_llm_provider_and_dictionary_learning_mode_persist_through_roundtrip(
    ) {
        let file = NamedTempFile::new().unwrap();
        let storage = ConfigSqliteStorage::new(file.path().to_path_buf());

        let mut config = AppConfig::default();
        config.backend = "custom-backend".to_string();
        config.text_processing = false;
        config.overlay.size = "large".to_string();
        config.overlay.margin = 50;
        config.llm.provider = "custom-llm".to_string();
        config.dictionary.learning_mode = "manual".to_string();

        storage.save(&config).unwrap();
        let loaded = storage.load().unwrap();

        assert_eq!(loaded.backend, "custom-backend");
        assert!(!loaded.text_processing);
        assert_eq!(loaded.overlay.size, "large");
        assert_eq!(loaded.overlay.margin, 50);
        assert_eq!(loaded.llm.provider, "custom-llm");
        assert_eq!(loaded.dictionary.learning_mode, "manual");
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

    #[test]
    fn test_recording_guard_zero_disabled_round_trip() {
        // Layer 5 test 24: `0` (disabled) must persist as-is across
        // save/load, not fall back to the default via `get_typed`.
        let file = NamedTempFile::new().unwrap();
        let storage = ConfigSqliteStorage::new(file.path().to_path_buf());

        let config = AppConfig {
            silence_timeout_ms: 0,
            max_recording_ms: 0,
            ..AppConfig::default()
        };
        storage.save(&config).unwrap();
        let loaded = storage.load().unwrap();

        assert_eq!(loaded.silence_timeout_ms, 0);
        assert_eq!(loaded.max_recording_ms, 0);
    }

    #[test]
    fn test_recording_guard_defaults_when_absent() {
        let file = NamedTempFile::new().unwrap();
        let storage = ConfigSqliteStorage::new(file.path().to_path_buf());

        // Don't save anything - should get defaults
        let loaded = storage.load().unwrap();
        assert_eq!(loaded.silence_timeout_ms, 60_000);
        assert_eq!(loaded.max_recording_ms, 600_000);
    }

    // -- Task 6: ::read_only() -----------------------------------------

    #[test]
    fn read_only_loads_an_existing_config_without_writing_to_it() {
        let file = NamedTempFile::new().unwrap();
        let path = file.path().to_path_buf();
        let mut config = AppConfig {
            api_key: "desktop-secret-key".to_string(),
            hotkey: "alt_r".to_string(),
            ..AppConfig::default()
        };
        config.llm.api_key = "llm-secret-key".to_string();
        ConfigSqliteStorage::new(path.clone()).save(&config).unwrap();

        let before = std::fs::metadata(&path).unwrap().modified().unwrap();
        let ro = ConfigSqliteStorage::read_only(path.clone());
        let loaded = ro.load().unwrap();
        let after = std::fs::metadata(&path).unwrap().modified().unwrap();

        assert_eq!(loaded.api_key, "desktop-secret-key");
        assert_eq!(loaded.hotkey, "alt_r");
        assert_eq!(loaded.llm.api_key, "llm-secret-key");
        assert_eq!(before, after, "a read-only load must not touch the file's mtime");
    }

    #[test]
    fn read_only_save_fails_instead_of_silently_writing() {
        let file = NamedTempFile::new().unwrap();
        let path = file.path().to_path_buf();
        ConfigSqliteStorage::new(path.clone())
            .save(&AppConfig::default())
            .unwrap();

        let ro = ConfigSqliteStorage::read_only(path);
        let result = ro.save(&AppConfig::default());

        assert!(result.is_err(), "a read-only-constructed storage must refuse writes, not silently succeed");
    }

    #[test]
    fn read_only_missing_config_db_does_not_create_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.db");
        let ro = ConfigSqliteStorage::read_only(path.clone());

        let result = ro.is_empty();

        assert!(result.is_err());
        assert!(!path.exists(), "read-only open must never create config.db");
    }

    // -- Task 6c: the durable guard ------------------------------------

    /// Builds an `AppConfig` where every single field holds a value that
    /// differs from `AppConfig::default()`. Used by
    /// `every_app_config_field_round_trips_through_sqlite` below.
    fn fully_non_default_app_config() -> AppConfig {
        AppConfig {
            api_key: "nd-api-key".to_string(),
            model: "nd-model".to_string(),
            language: "en".to_string(),
            hotkey: "f13".to_string(),
            hotkey_hold_ms: 999,
            min_recording_ms: 777,
            silence_timeout_ms: 12_345,
            max_recording_ms: 54_321,
            auto_type: false,
            auto_enter: true,
            typing_delay: 88,
            notifications: false,
            backend: "x11".to_string(),
            debug: true,
            audio_device: "nd-audio-device".to_string(),
            history_enabled: false,
            history_days: 7,
            active_provider: "local".to_string(),
            cloud_provider: "openai".to_string(),
            local_backend: "whisper_cpp".to_string(),
            text_processing: false,
            append_trailing_space: true,
            translate_to_english: true,
            auto_submit_key: crate::output_types::AutoSubmitKey::CmdEnter,
            audio_feedback: crate::audio_feedback_types::AudioFeedbackSettings {
                enabled: true,
                volume: 0.15,
            },
            shortcut_bindings: vec![crate::shortcut::binding::ShortcutBinding {
                id: "nd-binding".to_string(),
                name: "ND Binding".to_string(),
                description: "Non-default fixture binding".to_string(),
                default_binding: "f14".to_string(),
                current_binding: "f15".to_string(),
                action: crate::shortcut::binding::ShortcutAction::TranscribePostProcess {
                    prompt_id: Some("nd-prompt".to_string()),
                },
            }],
            first_run_completed: true,
            hotkey_mode: "toggle".to_string(),
            retention_period: "days_3".to_string(),
            retention_limit: 42,
            always_on_microphone: true,
            paste_shortcuts: "ctrl_v".to_string(),
            api_url_override: Some("http://127.0.0.1:4217/v1/audio/transcriptions".to_string()),
            vad: VadConfig {
                enabled: false,
                backend: "silero".to_string(),
                threshold: 0.91,
                onset_frames: 9,
                hangover_frames: 13,
                prefill_frames: 6,
            },
            overlay: OverlayConfig {
                enabled: false,
                position: "top_right".to_string(),
                size: "large".to_string(),
                margin: -12,
                audio_boost: 250.0,
                theme: "neon".to_string(),
                backend: "none".to_string(),
                custom_x: Some(137),
                custom_y: Some(241),
            },
            llm: LlmConfig {
                enabled: true,
                provider: "openai".to_string(),
                api_url: "https://example.invalid/v1/chat/completions".to_string(),
                api_key: "nd-llm-key".to_string(),
                model: "nd-llm-model".to_string(),
                prompt: "nd-llm-prompt".to_string(),
            },
            dictionary: DictionaryConfig {
                path: "/tmp/nd-dictionary.txt".to_string(),
                learning_mode: "manual".to_string(),
                learning_threshold: 11,
            },
        }
    }

    /// THE DURABLE GUARD (Task 6c): `AppConfig` gained a second silently
    /// dropped field (`min_recording_ms`, same class of bug as Task 6b's
    /// `api_url_override`) because no test ever exercised every field at
    /// once. This test builds an `AppConfig` where EVERY field is a
    /// non-default value, round-trips it through `save`/`load`, and
    /// asserts the result is byte-identical — so a future field added to
    /// `AppConfig` but forgotten in `save`/`load` fails this test
    /// immediately (it would load back as its \*default\*, not the
    /// non-default value that was saved).
    ///
    /// The `let AppConfig { .. } = ..` destructure below (no `..` rest
    /// pattern) is a compile-time belt-and-braces on top of that: adding
    /// a field to `AppConfig` without adding it here too is a compile
    /// error ("pattern does not mention field"), not just a maybe-caught
    /// runtime assertion.
    #[test]
    fn every_app_config_field_round_trips_through_sqlite() {
        let saved = fully_non_default_app_config();

        // Compile-time exhaustiveness check: every `AppConfig` field must
        // be named here. Add a field to the struct without adding it to
        // both this pattern AND `fully_non_default_app_config` above and
        // this file fails to compile.
        let AppConfig {
            api_key: _,
            model: _,
            language: _,
            hotkey: _,
            hotkey_hold_ms: _,
            min_recording_ms: _,
            silence_timeout_ms: _,
            max_recording_ms: _,
            auto_type: _,
            auto_enter: _,
            typing_delay: _,
            notifications: _,
            backend: _,
            debug: _,
            audio_device: _,
            history_enabled: _,
            history_days: _,
            active_provider: _,
            cloud_provider: _,
            local_backend: _,
            text_processing: _,
            append_trailing_space: _,
            translate_to_english: _,
            auto_submit_key: _,
            audio_feedback: _,
            shortcut_bindings: _,
            first_run_completed: _,
            hotkey_mode: _,
            retention_period: _,
            retention_limit: _,
            always_on_microphone: _,
            paste_shortcuts: _,
            api_url_override: _,
            vad: _,
            overlay: _,
            llm: _,
            dictionary: _,
        } = saved.clone();

        let file = NamedTempFile::new().unwrap();
        let storage = ConfigSqliteStorage::new(file.path().to_path_buf());

        storage.save(&saved).unwrap();
        let loaded = storage.load().unwrap();

        assert_eq!(
            saved, loaded,
            "every AppConfig field must round-trip through ConfigSqliteStorage save/load; a \
             mismatch here means some field is set to a non-default value on save but comes \
             back as its default on load (silently dropped, e.g. min_recording_ms before \
             Task 6c / api_url_override before Task 6b)"
        );
    }
}
