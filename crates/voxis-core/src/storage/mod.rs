//! Storage module - file-based storage matching Python formats.
//!
//! Storage formats:
//! - config.db → SQLite (key-value pairs)
//! - history.db → SQLite (primary, compatible with Python)
//! - dictionary.txt → Plain text
//! - corrections.db → SQLite (learning suggestions tracking)
//! - corrections_stats.json → JSON (legacy)
//!
//! Task 1a: this is the pure part of the original `voice_lib::storage`. Two
//! tauri-coupled pieces stayed in `voice_lib::storage`:
//! - `debug_storage` and `failed_audio` (not moved at all — orthogonal to
//!   config/storage, listed as staying in the plan).
//! - `get_app_paths(app)`, `get_storage_factory(app)` (free functions using
//!   `tauri::AppHandle::try_state`, which has no meaning outside a running
//!   Tauri app — they live in `voice_lib::storage::{get_app_paths,
//!   get_storage_factory}` and call into this module's
//!   `AppPaths`/`StorageFactory`). The old `AppPaths::new(&AppHandle)`
//!   Tauri-coupled constructor was replaced in Task 1b's deferred
//!   Task-1a minor M1 by the tauri-free `AppPaths::for_desktop()` — this
//!   crate has no `tauri` dependency at all now, not even optional; see
//!   `paths.rs` for why.

pub mod config_ini;
pub mod config_sqlite;
pub mod corrections;
pub mod corrections_sqlite;
pub mod dictionary;
pub mod factory;
pub mod history;
pub mod history_sqlite;
pub mod paths;
pub mod prompts_sqlite;
pub mod providers;
pub mod sqlite_base;
pub mod traits;

pub use config_ini::ConfigIniStorage;
pub use config_sqlite::ConfigSqliteStorage;
pub use corrections::{CorrectionStats, CorrectionsStorage as CorrectionsJsonStorage};
pub use corrections_sqlite::{CorrectionsSqliteStorage, SuggestionStatus, TrackedSuggestion};
pub use dictionary::DictionaryStorage;
pub use history_sqlite::{HistoryEntry, HistorySqliteStorage};
// Keep old HistoryStorage for migration
pub use factory::StorageFactory;
pub use history::HistoryStorage as HistoryMdStorage;
pub use paths::AppPaths;
pub use providers::{LlmModel, LlmProvider, ProvidersStorage};

// Export traits for DIP compliance (with Trait suffix to avoid conflicts)
pub use traits::{
    ConfigStorage as ConfigStorageTrait, CorrectionsStorage as CorrectionsStorageTrait,
    DictionaryStorage as DictionaryStorageTrait, HistoryStorage as HistoryStorageTrait,
    ProvidersStorage as ProvidersStorageTrait, StorageResult,
};

#[cfg(test)]
mod data_gate_tests;

/// Test utilities for storage module (DRY: shared across test modules).
///
/// Deliberately NOT plain `#[cfg(test)]`: that attribute only activates when
/// *this* crate's own test target is built, not when a downstream crate
/// (voice_lib) depends on it normally and wants to use this helper inside
/// its own `#[cfg(test)]` code. Gated on `feature = "test-utils"` too (see
/// Cargo.toml) so voice_lib can opt in via a dev-dependency feature without
/// `tempfile` ever shipping in a release/iOS build.
#[cfg(any(test, feature = "test-utils"))]
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
