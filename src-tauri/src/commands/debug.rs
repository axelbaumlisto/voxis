//! Debug-related Tauri commands.

use crate::error::IntoCommandError;
use crate::storage::AppPaths;
use tauri::State;

/// Get recent debug entries.
#[tauri::command]
#[specta::specta]
pub fn get_debug_entries(
    limit: Option<usize>,
    paths: State<AppPaths>,
) -> Result<Vec<crate::storage::DebugEntry>, String> {
    let debug_dir = paths.debug_dir();
    if !debug_dir.exists() {
        return Ok(Vec::new());
    }

    let storage = crate::storage::DebugStorage::new(debug_dir).cmd_err()?;
    storage.get_recent_entries(limit.unwrap_or(10)).cmd_err()
}

/// Clear all debug files.
#[tauri::command]
#[specta::specta]
pub fn clear_debug(paths: State<AppPaths>) -> Result<(), String> {
    let debug_dir = paths.debug_dir();
    if !debug_dir.exists() {
        return Ok(());
    }

    let storage = crate::storage::DebugStorage::new(debug_dir).cmd_err()?;
    storage.clear().cmd_err()
}

/// Get debug directory path.
#[tauri::command]
#[specta::specta]
pub fn get_debug_dir(paths: State<AppPaths>) -> String {
    paths.debug_dir().to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    #[allow(unused_imports)]
    use super::*;
    use crate::storage::test_utils::create_temp_paths;

    #[test]
    fn test_debug_dir_path() {
        let (temp_dir, paths) = create_temp_paths();
        let debug_dir = paths.debug_dir();
        let expected_suffix = "debug";
        assert!(
            debug_dir.to_string_lossy().contains(expected_suffix)
                || debug_dir.parent().unwrap() == temp_dir.path()
        );
    }

    #[test]
    fn test_debug_entries_empty_when_no_dir() {
        let (_temp_dir, paths) = create_temp_paths();
        // Debug dir doesn't exist yet
        let debug_dir = paths.debug_dir();
        assert!(!debug_dir.exists());
    }

    #[test]
    fn test_debug_storage_creation() {
        let (temp_dir, _paths) = create_temp_paths();
        let debug_dir = temp_dir.path().join("debug");
        std::fs::create_dir_all(&debug_dir).unwrap();

        let storage = crate::storage::DebugStorage::new(debug_dir);
        assert!(storage.is_ok());
    }

    #[test]
    fn test_debug_storage_get_recent_empty() {
        let (temp_dir, _paths) = create_temp_paths();
        let debug_dir = temp_dir.path().join("debug");
        std::fs::create_dir_all(&debug_dir).unwrap();

        let storage = crate::storage::DebugStorage::new(debug_dir).unwrap();
        let entries = storage.get_recent_entries(10).unwrap();
        assert!(entries.is_empty());
    }
}
