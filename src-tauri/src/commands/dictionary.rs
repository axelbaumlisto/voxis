//! Dictionary-related Tauri commands.

use crate::error::BoxedIntoCommandError;
use crate::storage::AppPaths;
use serde::{Deserialize, Serialize};
use tauri::State;

use super::get_factory;

/// Dictionary entry for frontend display.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DictionaryEntry {
    pub id: i64,
    pub source: String,
    pub replacement: String,
}

/// Get all dictionary entries.
#[tauri::command]
pub fn get_dictionary(paths: State<AppPaths>) -> Result<Vec<DictionaryEntry>, String> {
    let entries = get_factory(&paths).dictionary().load().cmd_err()?;

    let result: Vec<DictionaryEntry> = entries
        .into_iter()
        .enumerate()
        .map(|(i, (source, replacement))| DictionaryEntry {
            id: i as i64,
            source,
            replacement,
        })
        .collect();

    Ok(result)
}

/// Add a new dictionary entry.
#[tauri::command]
pub fn add_dictionary_entry(
    source: String,
    replacement: String,
    paths: State<AppPaths>,
) -> Result<(), String> {
    get_factory(&paths)
        .dictionary()
        .add(&source, &replacement)
        .cmd_err()
}

/// Delete a dictionary entry by id (line index).
#[tauri::command]
pub fn delete_dictionary_entry(id: i64, paths: State<AppPaths>) -> Result<(), String> {
    get_factory(&paths)
        .dictionary()
        .delete(id as usize)
        .cmd_err()
}

/// Update a dictionary entry by id (line index).
#[tauri::command]
pub fn update_dictionary_entry(
    id: i64,
    source: String,
    replacement: String,
    paths: State<AppPaths>,
) -> Result<(), String> {
    get_factory(&paths)
        .dictionary()
        .update(id as usize, &source, &replacement)
        .cmd_err()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dictionary_entry_serialize() {
        let entry = DictionaryEntry {
            id: 1,
            source: "солид".into(),
            replacement: "SOLID".into(),
        };
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("SOLID"));
    }

    #[test]
    fn test_dictionary_entry_serde_roundtrip() {
        let entry = DictionaryEntry {
            id: 123,
            source: "тест".into(),
            replacement: "test".into(),
        };
        let json = serde_json::to_string(&entry).unwrap();
        let deserialized: DictionaryEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(entry.id, deserialized.id);
        assert_eq!(entry.source, deserialized.source);
        assert_eq!(entry.replacement, deserialized.replacement);
    }

    #[test]
    fn test_dictionary_entry_unicode() {
        let entry = DictionaryEntry {
            id: 1,
            source: "привет мир".into(),
            replacement: "hello world".into(),
        };
        let json = serde_json::to_string(&entry).unwrap();
        let deserialized: DictionaryEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(entry.source, deserialized.source);
    }
}
