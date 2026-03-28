//! Failed audio storage module - stores audio for failed transcriptions with retry capability.
//!
//! Stores up to 3 failed transcription attempts in FIFO order.
//! Each entry has:
//! - WAV audio file (NNN.wav)
//! - JSON metadata (NNN.json)
//!
//! Files are stored in ~/.config/soupawhisper/failed_audio/

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// Maximum number of failed audio entries to keep.
const MAX_ENTRIES: usize = 3;

/// Metadata for a failed transcription attempt.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FailedTranscription {
    /// Unique identifier (e.g., "001", "002", "003")
    pub id: String,
    /// Error message that caused the failure
    pub error: String,
    /// Partial Whisper transcription text (if any)
    pub whisper_text: Option<String>,
    /// Timestamp when the failure occurred
    pub timestamp: DateTime<Utc>,
    /// Provider that was used (e.g., "groq", "openai")
    pub provider: String,
}

/// Storage for failed transcription audio files.
pub struct FailedAudioStorage {
    storage_dir: PathBuf,
}

impl FailedAudioStorage {
    /// Create new failed audio storage.
    /// Creates the `failed_audio/` subdirectory if it doesn't exist.
    pub fn new(config_dir: &Path) -> Result<Self, String> {
        let storage_dir = config_dir.join("failed_audio");
        fs::create_dir_all(&storage_dir)
            .map_err(|e| format!("Failed to create failed_audio directory: {}", e))?;
        Ok(Self { storage_dir })
    }

    /// Save a failed transcription audio and metadata.
    /// Returns the assigned ID (e.g., "001", "002", "003").
    ///
    /// Uses FIFO rotation: when at max capacity, removes oldest and shifts IDs.
    pub fn save(
        &self,
        audio: &[u8],
        error: &str,
        whisper_text: Option<&str>,
        provider: &str,
    ) -> Result<String, String> {
        // Get current entries and check if rotation needed
        let entries = self.list_ids()?;

        if entries.len() >= MAX_ENTRIES {
            // Rotate: remove 001, shift 002->001, 003->002, new entry gets 003
            self.rotate()?;
        }

        // Find next available ID
        let next_id = self.next_id()?;

        // Save audio file
        let audio_path = self.audio_path(&next_id);
        fs::write(&audio_path, audio).map_err(|e| format!("Failed to write audio file: {}", e))?;

        // Save metadata
        let metadata = FailedTranscription {
            id: next_id.clone(),
            error: error.to_string(),
            whisper_text: whisper_text.map(|s| s.to_string()),
            timestamp: Utc::now(),
            provider: provider.to_string(),
        };

        let json_path = self.json_path(&next_id);
        let json = serde_json::to_string_pretty(&metadata)
            .map_err(|e| format!("Failed to serialize metadata: {}", e))?;
        fs::write(&json_path, json).map_err(|e| format!("Failed to write metadata file: {}", e))?;

        tracing::info!(
            "Failed audio saved: id={}, error={}, provider={}",
            next_id,
            error,
            provider
        );

        Ok(next_id)
    }

    /// List all failed transcription entries.
    pub fn list(&self) -> Result<Vec<FailedTranscription>, String> {
        let ids = self.list_ids()?;
        let mut entries = Vec::new();

        for id in ids {
            let json_path = self.json_path(&id);
            if json_path.exists() {
                let content = fs::read_to_string(&json_path)
                    .map_err(|e| format!("Failed to read metadata for {}: {}", id, e))?;
                let entry: FailedTranscription = serde_json::from_str(&content)
                    .map_err(|e| format!("Failed to parse metadata for {}: {}", id, e))?;
                entries.push(entry);
            }
        }

        Ok(entries)
    }

    /// Get audio data for a specific entry.
    pub fn get_audio(&self, id: &str) -> Result<Vec<u8>, String> {
        let audio_path = self.audio_path(id);
        if !audio_path.exists() {
            return Err(format!("Audio file not found for id: {}", id));
        }
        fs::read(&audio_path).map_err(|e| format!("Failed to read audio file: {}", e))
    }

    /// Remove a specific entry (both audio and metadata).
    pub fn remove(&self, id: &str) -> Result<(), String> {
        let audio_path = self.audio_path(id);
        let json_path = self.json_path(id);

        if audio_path.exists() {
            fs::remove_file(&audio_path)
                .map_err(|e| format!("Failed to remove audio file: {}", e))?;
        }

        if json_path.exists() {
            fs::remove_file(&json_path)
                .map_err(|e| format!("Failed to remove metadata file: {}", e))?;
        }

        tracing::info!("Failed audio removed: id={}", id);
        Ok(())
    }

    /// Get the path to an audio file.
    fn audio_path(&self, id: &str) -> PathBuf {
        self.storage_dir.join(format!("{}.wav", id))
    }

    /// Get the path to a metadata file.
    fn json_path(&self, id: &str) -> PathBuf {
        self.storage_dir.join(format!("{}.json", id))
    }

    /// List all existing entry IDs in sorted order.
    fn list_ids(&self) -> Result<Vec<String>, String> {
        let mut ids: Vec<String> = fs::read_dir(&self.storage_dir)
            .map_err(|e| format!("Failed to read storage directory: {}", e))?
            .filter_map(|entry| entry.ok())
            .filter_map(|entry| {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.ends_with(".json") {
                    Some(name.trim_end_matches(".json").to_string())
                } else {
                    None
                }
            })
            .collect();

        ids.sort();
        Ok(ids)
    }

    /// Get the next available ID.
    fn next_id(&self) -> Result<String, String> {
        let ids = self.list_ids()?;

        if ids.is_empty() {
            return Ok("001".to_string());
        }

        // Find the highest ID and increment
        let max_id: u32 = ids
            .iter()
            .filter_map(|id| id.parse::<u32>().ok())
            .max()
            .unwrap_or(0);

        Ok(format!("{:03}", max_id + 1))
    }

    /// Rotate entries: remove 001, shift remaining entries down.
    fn rotate(&self) -> Result<(), String> {
        let ids = self.list_ids()?;

        if ids.is_empty() {
            return Ok(());
        }

        // Remove the oldest entry (first in sorted order)
        let oldest = &ids[0];
        self.remove(oldest)?;

        // Shift remaining entries down
        let remaining = &ids[1..];
        for (i, id) in remaining.iter().enumerate() {
            let new_id = format!("{:03}", i + 1);
            if *id != new_id {
                self.rename_entry(id, &new_id)?;
            }
        }

        Ok(())
    }

    /// Rename an entry (both audio and metadata files).
    fn rename_entry(&self, old_id: &str, new_id: &str) -> Result<(), String> {
        let old_audio = self.audio_path(old_id);
        let new_audio = self.audio_path(new_id);
        let old_json = self.json_path(old_id);
        let new_json = self.json_path(new_id);

        // Rename audio file
        if old_audio.exists() {
            fs::rename(&old_audio, &new_audio)
                .map_err(|e| format!("Failed to rename audio file: {}", e))?;
        }

        // Rename and update metadata file
        if old_json.exists() {
            let content = fs::read_to_string(&old_json)
                .map_err(|e| format!("Failed to read metadata: {}", e))?;
            let mut entry: FailedTranscription = serde_json::from_str(&content)
                .map_err(|e| format!("Failed to parse metadata: {}", e))?;

            // Update the ID in metadata
            entry.id = new_id.to_string();

            let json = serde_json::to_string_pretty(&entry)
                .map_err(|e| format!("Failed to serialize metadata: {}", e))?;
            fs::write(&new_json, json).map_err(|e| format!("Failed to write metadata: {}", e))?;

            // Remove old json file
            fs::remove_file(&old_json)
                .map_err(|e| format!("Failed to remove old metadata file: {}", e))?;
        }

        tracing::debug!("Failed audio renamed: {} -> {}", old_id, new_id);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_storage() -> (TempDir, FailedAudioStorage) {
        let temp = TempDir::new().unwrap();
        let storage = FailedAudioStorage::new(temp.path()).unwrap();
        (temp, storage)
    }

    #[test]
    fn test_new_creates_directory() {
        let temp = TempDir::new().unwrap();
        let storage_dir = temp.path().join("failed_audio");

        assert!(!storage_dir.exists());
        let _storage = FailedAudioStorage::new(temp.path()).unwrap();
        assert!(storage_dir.exists());
    }

    #[test]
    fn test_save_and_list() {
        let (_temp, storage) = create_storage();

        let audio = vec![0u8; 1000];
        let id = storage
            .save(&audio, "Test error", Some("partial text"), "groq")
            .unwrap();

        assert_eq!(id, "001");

        let entries = storage.list().unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, "001");
        assert_eq!(entries[0].error, "Test error");
        assert_eq!(entries[0].whisper_text, Some("partial text".to_string()));
        assert_eq!(entries[0].provider, "groq");
    }

    #[test]
    fn test_save_multiple_entries() {
        let (_temp, storage) = create_storage();

        let id1 = storage.save(&[1u8; 100], "Error 1", None, "groq").unwrap();
        let id2 = storage
            .save(&[2u8; 100], "Error 2", Some("text2"), "openai")
            .unwrap();
        let id3 = storage.save(&[3u8; 100], "Error 3", None, "groq").unwrap();

        assert_eq!(id1, "001");
        assert_eq!(id2, "002");
        assert_eq!(id3, "003");

        let entries = storage.list().unwrap();
        assert_eq!(entries.len(), 3);
    }

    #[test]
    fn test_get_audio() {
        let (_temp, storage) = create_storage();

        let original_audio = vec![0xDE, 0xAD, 0xBE, 0xEF];
        let id = storage
            .save(&original_audio, "Test error", None, "groq")
            .unwrap();

        let retrieved_audio = storage.get_audio(&id).unwrap();
        assert_eq!(retrieved_audio, original_audio);
    }

    #[test]
    fn test_get_audio_not_found() {
        let (_temp, storage) = create_storage();

        let result = storage.get_audio("999");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[test]
    fn test_remove() {
        let (temp, storage) = create_storage();

        let id = storage
            .save(&[0u8; 100], "Test error", None, "groq")
            .unwrap();

        // Verify files exist
        let audio_path = temp.path().join("failed_audio").join(format!("{}.wav", id));
        let json_path = temp
            .path()
            .join("failed_audio")
            .join(format!("{}.json", id));
        assert!(audio_path.exists());
        assert!(json_path.exists());

        // Remove
        storage.remove(&id).unwrap();

        // Verify files removed
        assert!(!audio_path.exists());
        assert!(!json_path.exists());

        // Verify list is empty
        let entries = storage.list().unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn test_rotation_fifo() {
        let (_temp, storage) = create_storage();

        // Save 3 entries
        storage.save(&[1u8; 100], "Error 1", None, "groq").unwrap();
        storage.save(&[2u8; 100], "Error 2", None, "groq").unwrap();
        storage.save(&[3u8; 100], "Error 3", None, "groq").unwrap();

        // Verify we have 3 entries
        let entries = storage.list().unwrap();
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].error, "Error 1");
        assert_eq!(entries[1].error, "Error 2");
        assert_eq!(entries[2].error, "Error 3");

        // Save 4th entry - should trigger rotation
        let id4 = storage.save(&[4u8; 100], "Error 4", None, "groq").unwrap();
        assert_eq!(id4, "003");

        // Verify rotation happened
        let entries = storage.list().unwrap();
        assert_eq!(entries.len(), 3);
        // Entry 1 should be removed, entries shifted
        assert_eq!(entries[0].id, "001");
        assert_eq!(entries[0].error, "Error 2"); // Was 002, now 001
        assert_eq!(entries[1].id, "002");
        assert_eq!(entries[1].error, "Error 3"); // Was 003, now 002
        assert_eq!(entries[2].id, "003");
        assert_eq!(entries[2].error, "Error 4"); // New entry
    }

    #[test]
    fn test_rotation_preserves_audio() {
        let (_temp, storage) = create_storage();

        // Save 3 entries with distinct audio
        storage.save(&[1u8; 100], "Error 1", None, "groq").unwrap();
        storage.save(&[2u8; 100], "Error 2", None, "groq").unwrap();
        storage.save(&[3u8; 100], "Error 3", None, "groq").unwrap();

        // Save 4th entry
        storage.save(&[4u8; 100], "Error 4", None, "groq").unwrap();

        // Verify audio content after rotation
        let audio1 = storage.get_audio("001").unwrap();
        let audio2 = storage.get_audio("002").unwrap();
        let audio3 = storage.get_audio("003").unwrap();

        assert_eq!(audio1, vec![2u8; 100]); // Was 002
        assert_eq!(audio2, vec![3u8; 100]); // Was 003
        assert_eq!(audio3, vec![4u8; 100]); // New entry
    }

    #[test]
    fn test_empty_list() {
        let (_temp, storage) = create_storage();

        let entries = storage.list().unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn test_save_with_no_whisper_text() {
        let (_temp, storage) = create_storage();

        let id = storage
            .save(&[0u8; 100], "Test error", None, "groq")
            .unwrap();

        let entries = storage.list().unwrap();
        assert_eq!(entries[0].id, id);
        assert!(entries[0].whisper_text.is_none());
    }

    #[test]
    fn test_metadata_has_timestamp() {
        let (_temp, storage) = create_storage();

        let before = Utc::now();
        storage
            .save(&[0u8; 100], "Test error", None, "groq")
            .unwrap();
        let after = Utc::now();

        let entries = storage.list().unwrap();
        let timestamp = entries[0].timestamp;
        assert!(timestamp >= before && timestamp <= after);
    }

    #[test]
    fn test_file_naming() {
        let (temp, storage) = create_storage();

        storage.save(&[0u8; 100], "Error 1", None, "groq").unwrap();
        storage.save(&[0u8; 100], "Error 2", None, "groq").unwrap();

        let storage_dir = temp.path().join("failed_audio");
        assert!(storage_dir.join("001.wav").exists());
        assert!(storage_dir.join("001.json").exists());
        assert!(storage_dir.join("002.wav").exists());
        assert!(storage_dir.join("002.json").exists());
    }
}
