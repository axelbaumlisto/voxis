//! Commands for managing failed transcriptions.
//!
//! Provides frontend access to list and dismiss failed transcriptions
//! that are stored for potential retry.

use crate::config::AppConfig;
use crate::orchestrator::transcription::run_transcription;
use crate::storage::{
    AppPaths, ConfigSqliteStorage, FailedAudioStorage, FailedTranscription, HistorySqliteStorage,
};
use tauri::{AppHandle, Emitter, State};

/// Get all failed transcriptions.
#[tauri::command]
pub fn get_failed_transcriptions(
    paths: State<'_, AppPaths>,
) -> Result<Vec<FailedTranscription>, String> {
    let storage = FailedAudioStorage::new(paths.config_dir())?;
    storage.list()
}

/// Dismiss (remove) a failed transcription by ID.
#[tauri::command]
pub fn dismiss_failed_transcription(id: String, paths: State<'_, AppPaths>) -> Result<(), String> {
    let storage = FailedAudioStorage::new(paths.config_dir())?;
    storage.remove(&id)
}

/// Core retry logic — testable without Tauri state injection.
///
/// Uses `config.api_url_override` when set (e.g. for testing with mockito).
pub async fn retry_inner(paths: &AppPaths, id: &str, config: &AppConfig) -> Result<String, String> {
    let storage = FailedAudioStorage::new(paths.config_dir())?;

    // Get metadata and verify it exists
    let items = storage.list()?;
    let _meta = items
        .iter()
        .find(|i| i.id == id)
        .ok_or("Failed transcription not found")?;

    // Get audio data
    let audio = storage.get_audio(id)?;

    // Retry transcription
    let result = run_transcription(config, audio).await?;

    // Success - add to history
    let history = HistorySqliteStorage::new(paths.history_file());
    history
        .add(&result.text, result.language.as_deref(), result.duration)
        .map_err(|e| e.to_string())?;

    // Remove from failed storage
    storage.remove(id)?;

    Ok(result.text)
}

/// Retry a failed transcription.
///
/// Loads the audio from storage, runs transcription again with current config,
/// and on success adds the result to history and removes from failed storage.
#[tauri::command]
pub async fn retry_transcription(
    id: String,
    app: AppHandle,
    paths: State<'_, AppPaths>,
) -> Result<String, String> {
    let config_storage = ConfigSqliteStorage::new(paths.config_db());
    let config: AppConfig = config_storage.load().unwrap_or_default();

    let text = retry_inner(&paths, &id, &config).await?;

    // Emit events to update UI
    let _ = app.emit("failed-transcriptions-updated", ());
    let _ = app.emit("history-updated", ());
    let _ = app.emit("transcription", &text);

    Ok(text)
}

#[cfg(test)]
mod tests {
    use crate::storage::{AppPaths, FailedAudioStorage, HistorySqliteStorage};
    use tempfile::TempDir;

    #[test]
    fn test_get_failed_transcriptions_returns_empty_for_new_storage() {
        let temp = TempDir::new().unwrap();
        let paths = AppPaths::from_config_dir(temp.path().to_path_buf());
        let storage = FailedAudioStorage::new(paths.config_dir()).unwrap();
        let entries = storage.list().unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn test_dismiss_removes_entry() {
        let temp = TempDir::new().unwrap();
        let paths = AppPaths::from_config_dir(temp.path().to_path_buf());
        let storage = FailedAudioStorage::new(paths.config_dir()).unwrap();
        let id = storage
            .save(&[0u8; 100], "test error", None, "groq")
            .unwrap();
        storage.remove(&id).unwrap();
        let entries = storage.list().unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn test_save_and_list_returns_entry() {
        let temp = TempDir::new().unwrap();
        let paths = AppPaths::from_config_dir(temp.path().to_path_buf());
        let storage = FailedAudioStorage::new(paths.config_dir()).unwrap();
        let id = storage
            .save(&[0u8; 100], "network error", Some("partial text"), "openai")
            .unwrap();
        let entries = storage.list().unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, id);
        assert_eq!(entries[0].error, "network error");
        assert_eq!(entries[0].whisper_text.as_deref(), Some("partial text"));
        assert_eq!(entries[0].provider, "openai");
    }

    #[test]
    fn test_get_audio_returns_saved_data() {
        let temp = TempDir::new().unwrap();
        let paths = AppPaths::from_config_dir(temp.path().to_path_buf());
        let storage = FailedAudioStorage::new(paths.config_dir()).unwrap();
        let audio_data = vec![1u8, 2, 3, 4, 5];
        let id = storage.save(&audio_data, "error", None, "groq").unwrap();
        let retrieved = storage.get_audio(&id).unwrap();
        assert_eq!(retrieved, audio_data);
    }

    /// Minimal valid WAV file for testing (44 bytes header + 4 bytes data).
    fn test_audio_data() -> Vec<u8> {
        vec![
            0x52, 0x49, 0x46, 0x46, // "RIFF"
            0x24, 0x00, 0x00, 0x00, // Chunk size
            0x57, 0x41, 0x56, 0x45, // "WAVE"
            0x66, 0x6D, 0x74, 0x20, // "fmt "
            0x10, 0x00, 0x00, 0x00, // Subchunk1 size (16)
            0x01, 0x00, // Audio format (PCM)
            0x01, 0x00, // Num channels (1)
            0x44, 0xAC, 0x00, 0x00, // Sample rate (44100)
            0x88, 0x58, 0x01, 0x00, // Byte rate
            0x02, 0x00, // Block align
            0x10, 0x00, // Bits per sample (16)
            0x64, 0x61, 0x74, 0x61, // "data"
            0x04, 0x00, 0x00, 0x00, // Subchunk2 size (4)
            0x00, 0x00, 0x00, 0x00, // Audio samples
        ]
    }

    #[tokio::test]
    async fn test_retry_inner_success() {
        use super::retry_inner;
        use crate::config::AppConfig;

        // Set up mockito server
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("POST", "/transcriptions")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"text": "Hello from retry", "language": "en", "duration": 1.5}"#)
            .create_async()
            .await;

        // Set up temp storage
        let temp = TempDir::new().unwrap();
        let paths = AppPaths::from_config_dir(temp.path().to_path_buf());

        // Save a failed transcription with valid WAV audio
        let storage = FailedAudioStorage::new(paths.config_dir()).unwrap();
        let id = storage
            .save(&test_audio_data(), "network error", None, "groq")
            .unwrap();

        // Verify it exists before retry
        assert_eq!(storage.list().unwrap().len(), 1);

        // Create config with a test API key and custom URL
        let config = AppConfig {
            api_key: "test_key".to_string(),
            api_url_override: Some(format!("{}/transcriptions", server.url())),
            ..AppConfig::default()
        };

        let result = retry_inner(&paths, &id, &config).await;

        // Assert: result is Ok with expected text
        assert!(result.is_ok(), "retry_inner failed: {:?}", result.err());
        assert_eq!(result.unwrap(), "Hello from retry");

        // Assert: failed entry is removed
        let remaining = storage.list().unwrap();
        assert!(
            remaining.is_empty(),
            "Failed entry should be removed after successful retry"
        );

        // Assert: history entry is added
        let history = HistorySqliteStorage::new(paths.history_file());
        assert_eq!(
            history.count().unwrap(),
            1,
            "History should have exactly one entry"
        );

        mock.assert_async().await;
    }

    #[tokio::test]
    async fn test_retry_inner_transcription_failure_preserves_failed_entry() {
        use super::retry_inner;
        use crate::config::AppConfig;

        // Set up mockito server that returns an error
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("POST", "/transcriptions")
            .with_status(500)
            .with_body("Internal Server Error")
            .create_async()
            .await;

        let temp = TempDir::new().unwrap();
        let paths = AppPaths::from_config_dir(temp.path().to_path_buf());

        let storage = FailedAudioStorage::new(paths.config_dir()).unwrap();
        let id = storage
            .save(&test_audio_data(), "previous error", None, "groq")
            .unwrap();

        let config = AppConfig {
            api_key: "test_key".to_string(),
            api_url_override: Some(format!("{}/transcriptions", server.url())),
            ..AppConfig::default()
        };

        let result = retry_inner(&paths, &id, &config).await;

        // Assert: result is Err
        assert!(result.is_err());

        // Assert: failed entry is NOT removed (transcription failed)
        let remaining = storage.list().unwrap();
        assert_eq!(
            remaining.len(),
            1,
            "Failed entry should be preserved on transcription error"
        );

        // Assert: no history entry added
        let history = HistorySqliteStorage::new(paths.history_file());
        assert_eq!(
            history.count().unwrap(),
            0,
            "No history entry should be added on failure"
        );

        mock.assert_async().await;
    }

    #[tokio::test]
    async fn test_retry_inner_not_found() {
        use super::retry_inner;
        use crate::config::AppConfig;

        let temp = TempDir::new().unwrap();
        let paths = AppPaths::from_config_dir(temp.path().to_path_buf());

        let config = AppConfig {
            api_key: "test_key".to_string(),
            ..AppConfig::default()
        };

        let result = retry_inner(&paths, "nonexistent-id", &config).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }
}
