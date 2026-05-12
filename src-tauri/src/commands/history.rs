//! History-related Tauri commands.

use crate::error::BoxedIntoCommandError;
use crate::storage::AppPaths;
use serde::{Deserialize, Serialize};
use tauri::State;

use super::get_factory;

/// History entry for frontend display.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct HistoryEntry {
    pub id: i64,
    pub timestamp: String,
    pub text: String,
    pub language: Option<String>,
    pub duration: Option<f32>,
}

/// DRY: Convert storage HistoryEntry to command HistoryEntry.
impl From<crate::storage::HistoryEntry> for HistoryEntry {
    fn from(e: crate::storage::HistoryEntry) -> Self {
        Self {
            id: e.id,
            timestamp: e.timestamp,
            text: e.text,
            language: e.language,
            duration: e.duration,
        }
    }
}

/// Get transcription history.
#[tauri::command]
#[specta::specta]
pub fn get_history(
    limit: Option<usize>,
    paths: State<AppPaths>,
) -> Result<Vec<HistoryEntry>, String> {
    tracing::info!("get_history called with limit: {:?}", limit);
    let factory = get_factory(&paths);
    let storage = factory.history();
    let entries = storage.load(limit).map_err(|e| {
        tracing::error!("Failed to load history: {}", e);
        e.to_string()
    })?;

    tracing::info!("Loaded {} history entries", entries.len());

    // DRY: Use From trait for conversion
    Ok(entries.into_iter().map(Into::into).collect())
}

/// Add a new history entry.
#[tauri::command]
#[specta::specta]
pub fn add_history_entry(
    text: String,
    language: Option<String>,
    duration: Option<f32>,
    paths: State<AppPaths>,
) -> Result<(), String> {
    get_factory(&paths)
        .history()
        .add(&text, language.as_deref(), duration)
        .cmd_err()?;
    Ok(())
}

/// Clear all history entries.
#[tauri::command]
#[specta::specta]
pub fn clear_history(paths: State<AppPaths>) -> Result<(), String> {
    get_factory(&paths).history().clear().cmd_err()
}

/// Delete a history entry by ID.
#[tauri::command]
#[specta::specta]
pub fn delete_history_entry(id: i64, paths: State<AppPaths>) -> Result<(), String> {
    get_factory(&paths).history().delete(id).cmd_err()
}

/// Search history.
#[tauri::command]
#[specta::specta]
pub fn search_history(
    query: String,
    limit: Option<usize>,
    paths: State<AppPaths>,
) -> Result<Vec<HistoryEntry>, String> {
    // DRY: Use From trait for conversion
    let entries = get_factory(&paths)
        .history()
        .search(&query, limit)
        .cmd_err()?;

    Ok(entries.into_iter().map(Into::into).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_history_entry_serialize() {
        let entry = HistoryEntry {
            id: 1,
            timestamp: "2024-01-15T10:30:00".into(),
            text: "Hello world".into(),
            language: Some("en".into()),
            duration: Some(2.5),
        };
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("Hello world"));
    }

    #[test]
    fn test_history_entry_from_storage() {
        let storage_entry = crate::storage::HistoryEntry {
            id: 42,
            timestamp: "2024-06-15T14:30:00".into(),
            text: "Test transcription".into(),
            language: Some("ru".into()),
            duration: Some(3.5),
        };

        let entry: HistoryEntry = storage_entry.into();
        assert_eq!(entry.id, 42);
        assert_eq!(entry.timestamp, "2024-06-15T14:30:00");
        assert_eq!(entry.text, "Test transcription");
        assert_eq!(entry.language, Some("ru".into()));
        assert_eq!(entry.duration, Some(3.5));
    }

    #[test]
    fn test_history_entry_serde_roundtrip() {
        let entry = HistoryEntry {
            id: 1,
            timestamp: "2024-01-15T10:30:00".into(),
            text: "Hello world".into(),
            language: Some("en".into()),
            duration: Some(2.5),
        };
        let json = serde_json::to_string(&entry).unwrap();
        let deserialized: HistoryEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(entry.id, deserialized.id);
        assert_eq!(entry.text, deserialized.text);
        assert_eq!(entry.language, deserialized.language);
        assert_eq!(entry.duration, deserialized.duration);
    }
}
