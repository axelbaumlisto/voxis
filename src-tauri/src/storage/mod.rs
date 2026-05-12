//! Storage module - file-based storage matching Python formats.
//!
//! Storage formats:
//! - config.db → SQLite (key-value pairs)
//! - history.db → SQLite (primary, compatible with Python)
//! - dictionary.txt → Plain text
//! - corrections.db → SQLite (learning suggestions tracking)
//! - corrections_stats.json → JSON (legacy)

pub mod config_ini;
pub mod config_sqlite;
pub mod corrections;
pub mod corrections_sqlite;
pub mod debug_storage;
pub mod dictionary;
pub mod factory;
pub mod failed_audio;
pub mod history;
pub mod history_sqlite;
pub mod paths;
pub mod providers;
pub mod sqlite_base;
pub mod traits;

pub use config_ini::ConfigIniStorage;
pub use config_sqlite::ConfigSqliteStorage;
pub use corrections::{CorrectionStats, CorrectionsStorage as CorrectionsJsonStorage};
pub use corrections_sqlite::{CorrectionsSqliteStorage, SuggestionStatus, TrackedSuggestion};
pub use debug_storage::{DebugEntry, DebugStorage, LlmLog, TranscriptionLog};
pub use dictionary::DictionaryStorage;
pub use history_sqlite::{HistoryEntry, HistorySqliteStorage};
// Keep old HistoryStorage for migration
pub use factory::StorageFactory;
pub use failed_audio::{FailedAudioStorage, FailedTranscription};
pub use history::HistoryStorage as HistoryMdStorage;
pub use paths::AppPaths;
pub use providers::{LlmModel, LlmProvider, ProvidersStorage};

use tauri::{AppHandle, Manager};

/// Get `AppPaths` from an `AppHandle`.
///
/// DRY helper for the common pattern of `app.try_state::<AppPaths>()`.
/// Returns `None` if `AppPaths` was not registered in app state.
pub fn get_app_paths(app: &AppHandle) -> Option<AppPaths> {
    app.try_state::<AppPaths>().map(|p| p.inner().clone())
}

/// Get a `StorageFactory` from an `AppHandle`.
///
/// DRY helper that combines `try_state::<AppPaths>` + `StorageFactory::new`.
/// Returns `None` if `AppPaths` was not registered in app state.
pub fn get_storage_factory(app: &AppHandle) -> Option<StorageFactory> {
    get_app_paths(app).map(StorageFactory::new)
}

// Export traits for DIP compliance (with Trait suffix to avoid conflicts)
pub use traits::{
    ConfigStorage as ConfigStorageTrait, CorrectionsStorage as CorrectionsStorageTrait,
    DictionaryStorage as DictionaryStorageTrait, HistoryStorage as HistoryStorageTrait,
    ProvidersStorage as ProvidersStorageTrait, StorageResult,
};

/// Test utilities for storage module (DRY: shared across test modules).
#[cfg(test)]
pub mod test_utils {
    use super::AppPaths;
    use tempfile::TempDir;

    /// Create temporary paths for testing.
    /// Returns (TempDir, AppPaths) - TempDir must be kept alive during test.
    pub fn create_temp_paths() -> (TempDir, AppPaths) {
        let temp_dir = TempDir::new().unwrap();
        let paths = AppPaths::from_config_dir(temp_dir.path().to_path_buf());
        (temp_dir, paths)
    }
}
