//! Storage module - file-based storage matching Python formats — thin
//! Tauri shim.
//!
//! Task 1a moved the pure storage implementations (config_ini, config_sqlite,
//! corrections*, dictionary, factory, history*, paths, prompts_sqlite,
//! providers, sqlite_base, traits) into `voxis_core::storage` (mechanical
//! extraction, no Tauri deps — see `crates/voxis-core/src/storage/mod.rs`).
//! This module re-exports the exact same types/modules so every existing
//! `crate::storage::…` path (including fully-qualified submodule paths like
//! `crate::storage::paths::…`, `crate::storage::history_sqlite::…`,
//! `crate::storage::prompts_sqlite::…`) keeps resolving unchanged, and adds
//! the two tauri-coupled storage kinds that stayed here:
//!
//! - `debug_storage` / `failed_audio` — not part of Task 1a's move at all.
//! - `get_app_paths` / `get_storage_factory` — free functions over
//!   `tauri::AppHandle::try_state`, meaningless outside a running Tauri app.
//!
//! `AppPaths::new(&AppHandle)` itself lives in `voxis_core::storage::paths`
//! behind the `tauri-support` feature (enabled by this crate's Cargo.toml)
//! — see that module's doc comment for why it couldn't be a shim here.

pub mod debug_storage;
pub mod failed_audio;

pub use voxis_core::storage::{
    config_ini, config_sqlite, corrections, corrections_sqlite, dictionary, factory, history,
    history_sqlite, paths, prompts_sqlite, providers, sqlite_base, traits, AppPaths,
    ConfigIniStorage, ConfigSqliteStorage, ConfigStorageTrait, CorrectionStats,
    CorrectionsJsonStorage, CorrectionsSqliteStorage, CorrectionsStorageTrait, DictionaryStorage,
    DictionaryStorageTrait, HistoryEntry, HistoryMdStorage, HistorySqliteStorage,
    HistoryStorageTrait, LlmModel, LlmProvider, ProvidersStorage, ProvidersStorageTrait,
    StorageFactory, StorageResult, SuggestionStatus, TrackedSuggestion,
};

pub use debug_storage::{DebugEntry, DebugStorage, LlmLog, TranscriptionLog};
pub use failed_audio::{FailedAudioStorage, FailedTranscription};

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

/// Test utilities for storage module (DRY: shared across test modules).
#[cfg(test)]
pub mod test_utils {
    pub use voxis_core::storage::test_utils::create_temp_paths;
}
