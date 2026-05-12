//! Debug storage module - saves audio files, transcriptions, and LLM calls.
//!
//! When debug mode is enabled:
//! - Saves last N audio recordings as WAV files
//! - Logs transcription results with timestamps
//! - Logs LLM prompts and responses
//!
//! Files are stored in ~/.config/soupawhisper/debug/

use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// Maximum number of audio files to keep.
const MAX_AUDIO_FILES: usize = 3;

/// Debug log entry for a single recording session.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct DebugEntry {
    pub timestamp: String,
    pub audio_file: Option<String>,
    pub audio_size_bytes: usize,
    pub transcription: Option<TranscriptionLog>,
    pub llm: Option<LlmLog>,
}

/// Transcription debug info.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct TranscriptionLog {
    pub provider: String,
    pub model: String,
    pub language: Option<String>,
    pub duration_ms: u64,
    pub text: String,
}

/// LLM debug info.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct LlmLog {
    pub provider: String,
    pub model: String,
    pub prompt: String,
    pub input_text: String,
    pub output_text: String,
    pub duration_ms: u64,
}

/// Debug storage for saving audio and logs.
pub struct DebugStorage {
    debug_dir: PathBuf,
}

impl DebugStorage {
    /// Create new debug storage.
    pub fn new(debug_dir: PathBuf) -> std::io::Result<Self> {
        fs::create_dir_all(&debug_dir)?;
        Ok(Self { debug_dir })
    }

    /// Save audio file and return the filename.
    /// Rotates old files, keeping only MAX_AUDIO_FILES.
    pub fn save_audio(&self, audio_data: &[u8]) -> std::io::Result<String> {
        // Generate timestamped filename
        let now: DateTime<Local> = Local::now();
        let filename = format!("audio_{}.wav", now.format("%Y%m%d_%H%M%S"));
        let filepath = self.debug_dir.join(&filename);

        // Save the audio file
        fs::write(&filepath, audio_data)?;
        tracing::info!(
            "Debug: saved audio to {:?} ({} bytes)",
            filepath,
            audio_data.len()
        );

        // Rotate old files
        self.rotate_audio_files()?;

        Ok(filename)
    }

    /// Remove old audio files, keeping only MAX_AUDIO_FILES.
    fn rotate_audio_files(&self) -> std::io::Result<()> {
        let mut audio_files: Vec<_> = fs::read_dir(&self.debug_dir)?
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                entry.file_name().to_string_lossy().starts_with("audio_")
                    && entry.file_name().to_string_lossy().ends_with(".wav")
            })
            .collect();

        // Sort by name (timestamp) descending (newest first)
        audio_files.sort_by_key(|b| std::cmp::Reverse(b.file_name().to_os_string()));

        // Remove files beyond MAX_AUDIO_FILES
        for file in audio_files.into_iter().skip(MAX_AUDIO_FILES) {
            if let Err(e) = fs::remove_file(file.path()) {
                tracing::warn!("Failed to remove old audio file: {}", e);
            } else {
                tracing::debug!("Debug: rotated old audio file {:?}", file.path());
            }
        }

        Ok(())
    }

    /// Save a debug entry to the log file.
    pub fn save_entry(&self, entry: &DebugEntry) -> std::io::Result<()> {
        let log_file = self.debug_dir.join("debug_log.jsonl");

        // Append as JSONL (one JSON object per line)
        let json = serde_json::to_string(entry).map_err(std::io::Error::other)?;

        use std::io::Write;
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_file)?;
        writeln!(file, "{}", json)?;

        tracing::info!("Debug: saved entry to {:?}", log_file);
        Ok(())
    }

    /// Get recent debug entries.
    pub fn get_recent_entries(&self, limit: usize) -> std::io::Result<Vec<DebugEntry>> {
        let log_file = self.debug_dir.join("debug_log.jsonl");

        if !log_file.exists() {
            return Ok(Vec::new());
        }

        let content = fs::read_to_string(&log_file)?;
        let entries: Vec<DebugEntry> = content
            .lines()
            .filter_map(|line| serde_json::from_str(line).ok())
            .collect();

        // Return last N entries
        Ok(entries.into_iter().rev().take(limit).collect())
    }

    /// Clear all debug files.
    pub fn clear(&self) -> std::io::Result<()> {
        if self.debug_dir.exists() {
            for entry in (fs::read_dir(&self.debug_dir)?).flatten() {
                let _ = fs::remove_file(entry.path());
            }
        }
        Ok(())
    }

    /// Get debug directory path.
    pub fn debug_dir(&self) -> &PathBuf {
        &self.debug_dir
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_save_audio() {
        let temp = TempDir::new().unwrap();
        let storage = DebugStorage::new(temp.path().to_path_buf()).unwrap();

        let audio_data = vec![0u8; 1000];
        let filename = storage.save_audio(&audio_data).unwrap();

        assert!(filename.starts_with("audio_"));
        assert!(filename.ends_with(".wav"));
        assert!(temp.path().join(&filename).exists());
    }

    #[test]
    fn test_rotate_audio_files() {
        let temp = TempDir::new().unwrap();
        let storage = DebugStorage::new(temp.path().to_path_buf()).unwrap();

        // Create 5 audio files
        for i in 0..5 {
            let filename = format!("audio_2024010{}_120000.wav", i);
            fs::write(temp.path().join(&filename), vec![0u8; 100]).unwrap();
        }

        storage.rotate_audio_files().unwrap();

        // Should only keep MAX_AUDIO_FILES
        let count = fs::read_dir(temp.path())
            .unwrap()
            .filter(|e| {
                e.as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with("audio_")
            })
            .count();
        assert_eq!(count, MAX_AUDIO_FILES);
    }

    #[test]
    fn test_save_and_get_entries() {
        let temp = TempDir::new().unwrap();
        let storage = DebugStorage::new(temp.path().to_path_buf()).unwrap();

        let entry = DebugEntry {
            timestamp: "2024-01-01T12:00:00".to_string(),
            audio_file: Some("audio_test.wav".to_string()),
            audio_size_bytes: 1000,
            transcription: Some(TranscriptionLog {
                provider: "groq".to_string(),
                model: "whisper-large-v3".to_string(),
                language: Some("en".to_string()),
                duration_ms: 500,
                text: "Hello world".to_string(),
            }),
            llm: None,
        };

        storage.save_entry(&entry).unwrap();

        let entries = storage.get_recent_entries(10).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0].transcription.as_ref().unwrap().text,
            "Hello world"
        );
    }

    #[test]
    fn test_new_creates_directory() {
        let temp = TempDir::new().unwrap();
        let debug_dir = temp.path().join("debug_subdir");

        assert!(!debug_dir.exists());
        let _storage = DebugStorage::new(debug_dir.clone()).unwrap();
        assert!(debug_dir.exists());
    }

    #[test]
    fn test_save_audio_filename_format() {
        let temp = TempDir::new().unwrap();
        let storage = DebugStorage::new(temp.path().to_path_buf()).unwrap();

        let audio_data = vec![0u8; 500];
        let filename = storage.save_audio(&audio_data).unwrap();

        // Format: audio_YYYYMMDD_HHMMSS.wav
        assert!(filename.starts_with("audio_"));
        assert!(filename.ends_with(".wav"));
        // Should have underscore-separated date and time
        let parts: Vec<&str> = filename
            .trim_start_matches("audio_")
            .trim_end_matches(".wav")
            .split('_')
            .collect();
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0].len(), 8); // YYYYMMDD
        assert_eq!(parts[1].len(), 6); // HHMMSS
    }

    #[test]
    fn test_save_debug_entry_with_llm() {
        let temp = TempDir::new().unwrap();
        let storage = DebugStorage::new(temp.path().to_path_buf()).unwrap();

        let entry = DebugEntry {
            timestamp: "2024-01-01T12:00:00".to_string(),
            audio_file: None,
            audio_size_bytes: 0,
            transcription: None,
            llm: Some(LlmLog {
                provider: "groq".to_string(),
                model: "llama-70b".to_string(),
                prompt: "Fix grammar".to_string(),
                input_text: "hello world".to_string(),
                output_text: "Hello, world!".to_string(),
                duration_ms: 150,
            }),
        };

        storage.save_entry(&entry).unwrap();

        let entries = storage.get_recent_entries(10).unwrap();
        assert_eq!(entries.len(), 1);
        let llm = entries[0].llm.as_ref().unwrap();
        assert_eq!(llm.provider, "groq");
        assert_eq!(llm.output_text, "Hello, world!");
    }

    #[test]
    fn test_get_recent_entries_limit() {
        let temp = TempDir::new().unwrap();
        let storage = DebugStorage::new(temp.path().to_path_buf()).unwrap();

        // Save 5 entries
        for i in 0..5 {
            let entry = DebugEntry {
                timestamp: format!("2024-01-0{}T12:00:00", i + 1),
                audio_file: None,
                audio_size_bytes: i * 100,
                transcription: None,
                llm: None,
            };
            storage.save_entry(&entry).unwrap();
        }

        // Request only 2
        let entries = storage.get_recent_entries(2).unwrap();
        assert_eq!(entries.len(), 2);
    }

    #[test]
    fn test_get_recent_entries_empty() {
        let temp = TempDir::new().unwrap();
        let storage = DebugStorage::new(temp.path().to_path_buf()).unwrap();

        let entries = storage.get_recent_entries(10).unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn test_clear_removes_all_files() {
        let temp = TempDir::new().unwrap();
        let storage = DebugStorage::new(temp.path().to_path_buf()).unwrap();

        // Create some files
        storage.save_audio(&[0u8; 100]).unwrap();
        let entry = DebugEntry {
            timestamp: "2024-01-01T12:00:00".to_string(),
            audio_file: None,
            audio_size_bytes: 0,
            transcription: None,
            llm: None,
        };
        storage.save_entry(&entry).unwrap();

        // Clear everything
        storage.clear().unwrap();

        // Verify directory is empty
        let count = fs::read_dir(temp.path()).unwrap().count();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_debug_dir_getter() {
        let temp = TempDir::new().unwrap();
        let debug_path = temp.path().to_path_buf();
        let storage = DebugStorage::new(debug_path.clone()).unwrap();

        assert_eq!(storage.debug_dir(), &debug_path);
    }

    #[test]
    fn test_debug_entry_serialize() {
        let entry = DebugEntry {
            timestamp: "2024-01-01T12:00:00".to_string(),
            audio_file: Some("test.wav".to_string()),
            audio_size_bytes: 1024,
            transcription: None,
            llm: None,
        };

        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("\"timestamp\":\"2024-01-01T12:00:00\""));
        assert!(json.contains("\"audio_file\":\"test.wav\""));
        assert!(json.contains("\"audio_size_bytes\":1024"));
    }

    #[test]
    fn test_transcription_log_serialize() {
        let log = TranscriptionLog {
            provider: "test-provider".to_string(),
            model: "test-model".to_string(),
            language: Some("en".to_string()),
            duration_ms: 250,
            text: "Test transcription".to_string(),
        };

        let json = serde_json::to_string(&log).unwrap();
        let deserialized: TranscriptionLog = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.provider, "test-provider");
        assert_eq!(deserialized.duration_ms, 250);
    }

    #[test]
    fn test_llm_log_serialize() {
        let log = LlmLog {
            provider: "llm-provider".to_string(),
            model: "llm-model".to_string(),
            prompt: "Fix grammar".to_string(),
            input_text: "input".to_string(),
            output_text: "output".to_string(),
            duration_ms: 100,
        };

        let json = serde_json::to_string(&log).unwrap();
        let deserialized: LlmLog = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.provider, "llm-provider");
        assert_eq!(deserialized.prompt, "Fix grammar");
    }

    #[test]
    fn test_load_corrupted_jsonl_entry() {
        let temp = TempDir::new().unwrap();
        let storage = DebugStorage::new(temp.path().to_path_buf()).unwrap();

        // Manually write corrupted JSONL (mix of valid and invalid entries)
        let log_file = temp.path().join("debug_log.jsonl");
        let content = r#"{"timestamp":"2024-01-01","audio_file":null,"audio_size_bytes":0,"transcription":null,"llm":null}
not valid json at all
{"timestamp":"2024-01-02","audio_file":null,"audio_size_bytes":100,"transcription":null,"llm":null}
{invalid json}
"#;
        fs::write(&log_file, content).unwrap();

        // Should parse valid entries and skip invalid ones
        let entries = storage.get_recent_entries(10).unwrap();

        // Only 2 valid entries should be returned
        assert_eq!(entries.len(), 2);
    }

    #[test]
    fn test_save_entry_creates_directory() {
        let temp = TempDir::new().unwrap();
        let nested_dir = temp.path().join("nested").join("debug").join("dir");

        // Create storage with nested path that doesn't exist
        let storage = DebugStorage::new(nested_dir.clone()).unwrap();

        // Directory should be created
        assert!(nested_dir.exists());

        // Should be able to save entry
        let entry = DebugEntry {
            timestamp: "2024-01-01".to_string(),
            audio_file: None,
            audio_size_bytes: 0,
            transcription: None,
            llm: None,
        };
        storage.save_entry(&entry).unwrap();

        let entries = storage.get_recent_entries(10).unwrap();
        assert_eq!(entries.len(), 1);
    }

    #[test]
    fn test_clear_removes_all_files_including_subdirs() {
        let temp = TempDir::new().unwrap();
        let storage = DebugStorage::new(temp.path().to_path_buf()).unwrap();

        // Create multiple files of different types
        storage.save_audio(&[0u8; 100]).unwrap();
        storage.save_audio(&[0u8; 200]).unwrap();
        let entry = DebugEntry {
            timestamp: "2024-01-01".to_string(),
            audio_file: Some("test.wav".to_string()),
            audio_size_bytes: 100,
            transcription: Some(TranscriptionLog {
                provider: "test".to_string(),
                model: "test".to_string(),
                language: None,
                duration_ms: 100,
                text: "Hello".to_string(),
            }),
            llm: None,
        };
        storage.save_entry(&entry).unwrap();

        // Verify files exist
        let before_count = fs::read_dir(temp.path()).unwrap().count();
        assert!(before_count > 0);

        // Clear
        storage.clear().unwrap();

        // Verify all files removed
        let after_count = fs::read_dir(temp.path()).unwrap().count();
        assert_eq!(after_count, 0);
    }

    #[test]
    fn test_rotate_with_zero_audio_files() {
        let temp = TempDir::new().unwrap();
        let storage = DebugStorage::new(temp.path().to_path_buf()).unwrap();

        // No audio files to rotate
        let result = storage.rotate_audio_files();
        assert!(result.is_ok());

        // Verify no errors with empty directory
        let count = fs::read_dir(temp.path())
            .unwrap()
            .filter(|e| {
                e.as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with("audio_")
            })
            .count();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_entry_with_all_optional_fields() {
        let temp = TempDir::new().unwrap();
        let storage = DebugStorage::new(temp.path().to_path_buf()).unwrap();

        // Entry with all fields populated
        let entry = DebugEntry {
            timestamp: "2024-01-15T10:30:00.123Z".to_string(),
            audio_file: Some("audio_20240115_103000.wav".to_string()),
            audio_size_bytes: 524288,
            transcription: Some(TranscriptionLog {
                provider: "groq".to_string(),
                model: "whisper-large-v3".to_string(),
                language: Some("ru".to_string()),
                duration_ms: 2500,
                text: "Привет мир, это тест транскрипции.".to_string(),
            }),
            llm: Some(LlmLog {
                provider: "groq".to_string(),
                model: "llama-3.3-70b".to_string(),
                prompt: "Fix grammar and punctuation".to_string(),
                input_text: "Привет мир это тест транскрипции".to_string(),
                output_text: "Привет мир, это тест транскрипции.".to_string(),
                duration_ms: 350,
            }),
        };

        storage.save_entry(&entry).unwrap();
        let entries = storage.get_recent_entries(1).unwrap();

        assert_eq!(entries.len(), 1);
        let loaded = &entries[0];

        assert!(loaded.audio_file.is_some());
        assert_eq!(loaded.audio_size_bytes, 524288);

        let transcription = loaded.transcription.as_ref().unwrap();
        assert_eq!(transcription.provider, "groq");
        assert_eq!(transcription.language.as_ref().unwrap(), "ru");
        assert_eq!(transcription.duration_ms, 2500);

        let llm = loaded.llm.as_ref().unwrap();
        assert_eq!(llm.model, "llama-3.3-70b");
        assert_eq!(llm.duration_ms, 350);
    }
}
