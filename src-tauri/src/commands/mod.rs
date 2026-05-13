//! Tauri commands - exposed to frontend via invoke().
//!
//! Commands follow Tauri patterns:
//! - Return Result<T, String> for error handling
//! - Use State for shared app state
//! - Async where needed for I/O operations
//!
//! SRP: Commands are split into modules by domain.
//! DIP: All storage access goes through StorageFactory.

// Public modules to expose #[tauri::command] internal symbols
pub mod config;
pub mod debug;
pub mod dictionary;
pub mod failed;
pub mod history;
pub mod overlay;
pub mod permissions;
pub mod prompts;
pub mod providers;
pub mod recording;
pub mod shortcut_bindings;
pub mod suggestions;

use crate::storage::{AppPaths, StorageFactory};
use tauri::State;

/// Create a StorageFactory from AppPaths State.
/// DRY: Single helper function used by all command modules.
fn get_factory(paths: &State<AppPaths>) -> StorageFactory {
    StorageFactory::new(paths.inner().clone())
}

// =============================================================================
// Re-exports
// =============================================================================

// Config
pub use config::{get_config, save_config};

// History
pub use history::{
    add_history_entry, clear_history, delete_history_entry, get_history, search_history,
    HistoryEntry,
};

// Dictionary
pub use dictionary::{
    add_dictionary_entry, delete_dictionary_entry, get_dictionary, update_dictionary_entry,
    DictionaryEntry,
};

// Suggestions
pub use suggestions::{
    approve_suggestion, approve_suggestion_by_source, get_pending_count, get_pending_suggestions,
    reject_suggestion, reject_suggestion_by_source, reprocess_history_for_suggestions,
    PendingSuggestion, ReprocessResult,
};

// Overlay
pub use overlay::{get_overlay_state, hide_overlay, show_overlay, update_overlay_position};

// Recording
pub use recording::{
    copy_to_clipboard, get_audio_level, get_recording_status, list_audio_devices,
    manual_start_recording, manual_stop_recording, start_recording, stop_recording,
    transcribe_audio, type_text,
};

// Debug
pub use debug::{clear_debug, get_debug_dir, get_debug_entries};

// Providers
pub use providers::{
    add_llm_provider, get_llm_providers, remove_llm_provider, update_llm_provider,
};

// Permissions
pub use permissions::{
    check_permissions, open_permission_settings, request_accessibility_permission,
    request_microphone_permission, PermissionInfo,
};

// Failed transcriptions
pub use failed::{dismiss_failed_transcription, get_failed_transcriptions};
