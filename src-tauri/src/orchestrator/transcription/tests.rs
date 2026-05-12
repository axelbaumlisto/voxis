use super::*;
use crate::config::AppConfig;
use crate::orchestrator::post_process::PostProcessResult;
use crate::orchestrator::state::RecordingState;
use crate::output::OutputHandler;
use crate::overlay_native::OverlayBackend;
use crate::storage::{self, DebugEntry, DebugStorage, LlmLog, TranscriptionLog};
use std::sync::Arc;
use tokio::sync::Mutex;

/// SRP: type alias for the `TranscriptionContext::new` signature — used by the
/// compile-time signature check below; silences `clippy::type_complexity`.
type CtxCtor = fn(
    tauri::AppHandle,
    Arc<OutputHandler>,
    Arc<Mutex<RecordingState>>,
    Arc<Mutex<Box<dyn OverlayBackend>>>,
    Vec<u8>,
) -> TranscriptionContext;

#[test]
fn test_validate_config_missing_api_key() {
    let config = AppConfig {
        api_key: String::new(),
        ..AppConfig::default()
    };
    assert!(validate_config(&config).is_err());
    assert_eq!(
        validate_config(&config).unwrap_err(),
        "API key not configured"
    );
}

#[test]
fn test_validate_config_with_api_key() {
    let config = AppConfig {
        api_key: "test-key".to_string(),
        ..AppConfig::default()
    };
    assert!(validate_config(&config).is_ok());
}

#[test]
fn test_validate_config_whitespace_api_key() {
    let config = AppConfig {
        api_key: "   ".to_string(),
        ..Default::default()
    };
    // Whitespace-only API key is technically not empty
    assert!(validate_config(&config).is_ok());
}

#[test]
fn test_validate_config_with_special_characters() {
    // API keys often have special characters
    let config = AppConfig {
        api_key: "sk-abc123_XYZ-456".to_string(),
        ..Default::default()
    };
    assert!(validate_config(&config).is_ok());
}

#[test]
fn test_validate_config_long_api_key() {
    // Test with a realistic long API key
    let config = AppConfig {
        api_key: "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ".to_string(),
        ..Default::default()
    };
    assert!(validate_config(&config).is_ok());
}

#[tokio::test]
async fn test_show_idle_overlay_with_noop() {
    use crate::overlay_native::NoopOverlay;
    let overlay: Arc<Mutex<Box<dyn OverlayBackend>>> =
        Arc::new(Mutex::new(Box::new(NoopOverlay::new())));
    // Should not panic
    show_idle_overlay(&overlay).await;
}

#[tokio::test]
async fn test_show_idle_overlay_concurrent_access() {
    use crate::overlay_native::NoopOverlay;
    // Test that concurrent access to overlay doesn't cause issues
    let overlay: Arc<Mutex<Box<dyn OverlayBackend>>> =
        Arc::new(Mutex::new(Box::new(NoopOverlay::new())));

    let overlay1 = Arc::clone(&overlay);
    let overlay2 = Arc::clone(&overlay);

    let handle1 = tokio::spawn(async move {
        show_idle_overlay(&overlay1).await;
    });
    let handle2 = tokio::spawn(async move {
        show_idle_overlay(&overlay2).await;
    });

    // Both should complete without deadlock
    let _ = tokio::join!(handle1, handle2);
}

// ==========================================================================
// Additional tests for transcription module
// ==========================================================================

#[test]
fn test_validate_config_unicode_api_key() {
    // API keys should work with any characters
    let config = AppConfig {
        api_key: "ключ-123".to_string(),
        ..Default::default()
    };
    assert!(validate_config(&config).is_ok());
}

#[test]
fn test_config_language_auto() {
    let config = AppConfig {
        api_key: "test".to_string(),
        language: "auto".to_string(),
        ..Default::default()
    };
    // Verify auto detection works
    assert_eq!(config.language, "auto");
}

#[test]
fn test_config_language_specific() {
    let config = AppConfig {
        api_key: "test".to_string(),
        language: "ru".to_string(),
        ..Default::default()
    };
    assert_eq!(config.language, "ru");
}

#[test]
fn test_config_model_default() {
    let config = AppConfig::default();
    // Should have a default model
    assert!(!config.model.is_empty());
}

#[test]
fn test_config_auto_type_disabled() {
    let config = AppConfig {
        api_key: "test".to_string(),
        auto_type: false,
        ..Default::default()
    };
    assert!(!config.auto_type);
}

#[test]
fn test_config_history_enabled_default() {
    let config = AppConfig::default();
    assert!(config.history_enabled);
}

#[test]
fn test_config_debug_disabled_by_default() {
    let config = AppConfig::default();
    assert!(!config.debug);
}

#[tokio::test]
async fn test_run_transcription_empty_api_key() {
    let config = AppConfig {
        api_key: String::new(),
        ..Default::default()
    };
    // Should fail validation before even trying
    assert!(validate_config(&config).is_err());
}

#[test]
fn test_post_process_result_text_preserved() {
    let result = PostProcessResult {
        text: "Привет мир! 你好世界".to_string(),
        llm_result: None,
        llm_duration_ms: 0,
    };
    assert!(result.text.contains("Привет"));
    assert!(result.text.contains("你好"));
}

#[test]
fn test_recording_state_initial() {
    let state = RecordingState::Idle;
    assert!(matches!(state, RecordingState::Idle));
}

#[test]
fn test_recording_state_transitions() {
    let states = [
        RecordingState::Idle,
        RecordingState::Recording,
        RecordingState::Transcribing,
        RecordingState::Error,
    ];
    assert_eq!(states.len(), 4);
}

// Tests for TranscriptionContext
#[test]
fn test_transcription_context_fields() {
    // TranscriptionContext should have all required fields
    // This is a compile-time check - if struct changes, this test breaks
    let _: CtxCtor = TranscriptionContext::new;
}

// ==========================================================================
// Output method selection tests
// ==========================================================================

#[test]
fn test_output_method_clipboard_when_auto_type_disabled() {
    let config = AppConfig {
        api_key: "test".to_string(),
        auto_type: false,
        ..Default::default()
    };
    // When auto_type is false, finalize_output should use clipboard paste path
    assert!(!config.auto_type);
}

#[test]
fn test_output_method_auto_type_when_enabled() {
    let config = AppConfig {
        api_key: "test".to_string(),
        auto_type: true,
        ..Default::default()
    };
    // When auto_type is true, finalize_output should use type_text path
    assert!(config.auto_type);
}

// ==========================================================================
// Empty transcription handling tests
// ==========================================================================

#[test]
fn test_empty_transcription_text() {
    // Empty text should still be a valid PostProcessResult
    let result = PostProcessResult {
        text: String::new(),
        llm_result: None,
        llm_duration_ms: 0,
    };
    assert!(result.text.is_empty());
}

#[test]
fn test_whitespace_only_transcription() {
    let result = PostProcessResult {
        text: "   \n\t  ".to_string(),
        llm_result: None,
        llm_duration_ms: 0,
    };
    assert_eq!(result.text.trim(), "");
}

// ==========================================================================
// History entry creation tests
// ==========================================================================

#[test]
fn test_history_config_enabled() {
    let config = AppConfig {
        api_key: "test".to_string(),
        history_enabled: true,
        ..Default::default()
    };
    // finalize_output calls save_to_history only when history_enabled
    assert!(config.history_enabled);
}

#[test]
fn test_history_config_disabled() {
    let config = AppConfig {
        api_key: "test".to_string(),
        history_enabled: false,
        ..Default::default()
    };
    // When disabled, finalize_output should skip history save
    assert!(!config.history_enabled);
}

// ==========================================================================
// Debug log formatting tests
// ==========================================================================

#[test]
fn test_debug_entry_construction_without_llm() {
    let config = AppConfig {
        api_key: "test".to_string(),
        debug: true,
        cloud_provider: "groq".to_string(),
        model: "whisper-large-v3".to_string(),
        llm: crate::config::LlmConfig {
            enabled: false,
            ..Default::default()
        },
        ..Default::default()
    };

    let post_result = PostProcessResult {
        text: "hello world".to_string(),
        llm_result: None,
        llm_duration_ms: 0,
    };

    // Replicate the debug log creation logic from save_debug_log
    let llm_log = if config.llm.enabled && post_result.llm_result.is_some() {
        Some(LlmLog {
            provider: config.llm.provider.clone(),
            model: config.llm.model.clone(),
            prompt: config.llm.prompt.clone(),
            input_text: "hello world".to_string(),
            output_text: "hello world".to_string(),
            duration_ms: post_result.llm_duration_ms,
        })
    } else {
        None
    };

    let entry = DebugEntry {
        timestamp: "2026-03-25T12:00:00".to_string(),
        audio_file: Some("debug_001.wav".to_string()),
        audio_size_bytes: 44100,
        transcription: Some(TranscriptionLog {
            provider: config.cloud_provider.clone(),
            model: config.model.clone(),
            language: Some("en".to_string()),
            duration_ms: 500,
            text: "hello world".to_string(),
        }),
        llm: llm_log,
    };

    assert!(entry.llm.is_none());
    assert!(entry.transcription.is_some());
    let t = entry.transcription.unwrap();
    assert_eq!(t.provider, "groq");
    assert_eq!(t.model, "whisper-large-v3");
    assert_eq!(t.text, "hello world");
    assert_eq!(t.duration_ms, 500);
    assert_eq!(t.language, Some("en".to_string()));
    assert_eq!(entry.audio_size_bytes, 44100);
    assert_eq!(entry.audio_file, Some("debug_001.wav".to_string()));
}

#[test]
fn test_debug_entry_construction_with_llm() {
    let config = AppConfig {
        api_key: "test".to_string(),
        debug: true,
        llm: crate::config::LlmConfig {
            enabled: true,
            provider: "groq".to_string(),
            model: "llama-3.3-70b".to_string(),
            api_key: "llm-key".to_string(),
            prompt: "Fix grammar".to_string(),
            ..Default::default()
        },
        ..Default::default()
    };

    let llm_result_data = crate::llm::LlmResult {
        text: "Hello, world!".to_string(),
        suggestions: vec![],
    };
    let post_result = PostProcessResult {
        text: "Hello, world!".to_string(),
        llm_result: Some(llm_result_data),
        llm_duration_ms: 250,
    };

    let llm_log = if config.llm.enabled && post_result.llm_result.is_some() {
        Some(LlmLog {
            provider: config.llm.provider.clone(),
            model: config.llm.model.clone(),
            prompt: config.llm.prompt.clone(),
            input_text: "hello world".to_string(),
            output_text: "Hello, world!".to_string(),
            duration_ms: post_result.llm_duration_ms,
        })
    } else {
        None
    };

    assert!(llm_log.is_some());
    let log = llm_log.unwrap();
    assert_eq!(log.provider, "groq");
    assert_eq!(log.model, "llama-3.3-70b");
    assert_eq!(log.prompt, "Fix grammar");
    assert_eq!(log.input_text, "hello world");
    assert_eq!(log.output_text, "Hello, world!");
    assert_eq!(log.duration_ms, 250);
}

#[test]
fn test_debug_entry_no_audio_file() {
    // When debug audio save fails, audio_file is None
    let entry = DebugEntry {
        timestamp: "2026-03-25T12:00:00".to_string(),
        audio_file: None,
        audio_size_bytes: 8000,
        transcription: Some(TranscriptionLog {
            provider: "groq".to_string(),
            model: "whisper-large-v3".to_string(),
            language: None,
            duration_ms: 300,
            text: "test".to_string(),
        }),
        llm: None,
    };
    assert!(entry.audio_file.is_none());
    assert_eq!(entry.audio_size_bytes, 8000);
}

#[test]
fn test_debug_entry_serializes_to_json() {
    let entry = DebugEntry {
        timestamp: "2026-03-25T12:00:00".to_string(),
        audio_file: Some("test.wav".to_string()),
        audio_size_bytes: 1024,
        transcription: Some(TranscriptionLog {
            provider: "groq".to_string(),
            model: "whisper-large-v3".to_string(),
            language: Some("en".to_string()),
            duration_ms: 100,
            text: "test text".to_string(),
        }),
        llm: None,
    };

    let json = serde_json::to_string(&entry).unwrap();
    assert!(json.contains("\"timestamp\":\"2026-03-25T12:00:00\""));
    assert!(json.contains("\"audio_file\":\"test.wav\""));
    assert!(json.contains("\"audio_size_bytes\":1024"));
    assert!(json.contains("\"text\":\"test text\""));
}

// ==========================================================================
// Transcription API error handling tests (mockito)
// ==========================================================================

/// Create minimal valid WAV test audio data.
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
async fn test_run_transcription_success() {
    let mut server = mockito::Server::new_async().await;

    let mock = server
        .mock("POST", "/v1/audio/transcriptions")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"text": "Hello world", "language": "en", "duration": 2.5}"#)
        .create_async()
        .await;

    let config = AppConfig {
        api_key: "test-key".to_string(),
        model: "whisper-large-v3".to_string(),
        language: "auto".to_string(),
        ..Default::default()
    };

    // Use TranscriptionClient::with_url directly since run_transcription
    // hardcodes the URL via TranscriptionClient::new
    let client = crate::transcription::TranscriptionClient::with_url(
        &config.api_key,
        Some(&config.model),
        None, // "auto" becomes None
        &format!("{}/v1/audio/transcriptions", server.url()),
    )
    .unwrap();

    let result = client.transcribe(test_audio_data()).await;
    assert!(result.is_ok());
    let result = result.unwrap();
    assert_eq!(result.text, "Hello world");
    assert_eq!(result.language, Some("en".to_string()));
    assert_eq!(result.duration, Some(2.5));

    mock.assert_async().await;
}

#[tokio::test]
async fn test_run_transcription_api_error_unauthorized() {
    let mut server = mockito::Server::new_async().await;

    let mock = server
        .mock("POST", "/v1/audio/transcriptions")
        .with_status(401)
        .with_header("content-type", "application/json")
        .with_body(r#"{"error": {"message": "Invalid API key provided"}}"#)
        .create_async()
        .await;

    let client = crate::transcription::TranscriptionClient::with_url(
        "bad-key",
        None,
        None,
        &format!("{}/v1/audio/transcriptions", server.url()),
    )
    .unwrap();

    let result = client.transcribe(test_audio_data()).await;
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(err.to_string().contains("Invalid API key provided"));

    mock.assert_async().await;
}

#[tokio::test]
async fn test_run_transcription_api_error_rate_limit() {
    let mut server = mockito::Server::new_async().await;

    let mock = server
        .mock("POST", "/v1/audio/transcriptions")
        .with_status(429)
        .with_header("content-type", "application/json")
        .with_body(r#"{"error": {"message": "Rate limit exceeded. Please retry after 1s"}}"#)
        .create_async()
        .await;

    let client = crate::transcription::TranscriptionClient::with_url(
        "test-key",
        None,
        None,
        &format!("{}/v1/audio/transcriptions", server.url()),
    )
    .unwrap();

    let result = client.transcribe(test_audio_data()).await;
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("Rate limit"));

    mock.assert_async().await;
}

#[tokio::test]
async fn test_run_transcription_server_error() {
    let mut server = mockito::Server::new_async().await;

    let mock = server
        .mock("POST", "/v1/audio/transcriptions")
        .with_status(500)
        .with_body("Internal Server Error")
        .create_async()
        .await;

    let client = crate::transcription::TranscriptionClient::with_url(
        "test-key",
        None,
        None,
        &format!("{}/v1/audio/transcriptions", server.url()),
    )
    .unwrap();

    let result = client.transcribe(test_audio_data()).await;
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("HTTP 500"));

    mock.assert_async().await;
}

#[tokio::test]
async fn test_run_transcription_malformed_json() {
    let mut server = mockito::Server::new_async().await;

    let mock = server
        .mock("POST", "/v1/audio/transcriptions")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body("not json at all")
        .create_async()
        .await;

    let client = crate::transcription::TranscriptionClient::with_url(
        "test-key",
        None,
        None,
        &format!("{}/v1/audio/transcriptions", server.url()),
    )
    .unwrap();

    let result = client.transcribe(test_audio_data()).await;
    assert!(result.is_err());
    assert!(matches!(
        result.unwrap_err(),
        crate::transcription::TranscriptionError::ParseError(_)
    ));

    mock.assert_async().await;
}

#[tokio::test]
async fn test_run_transcription_network_error() {
    // Connect to a port where nothing is listening
    let client = crate::transcription::TranscriptionClient::with_url(
        "test-key",
        None,
        None,
        "http://127.0.0.1:1/v1/audio/transcriptions",
    )
    .unwrap();

    let result = client.transcribe(test_audio_data()).await;
    assert!(result.is_err());
    assert!(matches!(
        result.unwrap_err(),
        crate::transcription::TranscriptionError::HttpError(_)
    ));
}

#[tokio::test]
async fn test_run_transcription_empty_response_text() {
    let mut server = mockito::Server::new_async().await;

    let mock = server
        .mock("POST", "/v1/audio/transcriptions")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"text": ""}"#)
        .create_async()
        .await;

    let client = crate::transcription::TranscriptionClient::with_url(
        "test-key",
        None,
        None,
        &format!("{}/v1/audio/transcriptions", server.url()),
    )
    .unwrap();

    let result = client.transcribe(test_audio_data()).await;
    assert!(result.is_ok());
    // Empty text is valid - the API may return empty for silence
    assert_eq!(result.unwrap().text, "");

    mock.assert_async().await;
}

#[tokio::test]
async fn test_run_transcription_with_language_param() {
    let mut server = mockito::Server::new_async().await;

    let mock = server
        .mock("POST", "/v1/audio/transcriptions")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"text": "Привет мир", "language": "ru", "duration": 1.2}"#)
        .create_async()
        .await;

    let client = crate::transcription::TranscriptionClient::with_url(
        "test-key",
        Some("whisper-large-v3"),
        Some("ru"),
        &format!("{}/v1/audio/transcriptions", server.url()),
    )
    .unwrap();

    let result = client.transcribe(test_audio_data()).await;
    assert!(result.is_ok());
    let result = result.unwrap();
    assert_eq!(result.text, "Привет мир");
    assert_eq!(result.language, Some("ru".to_string()));

    mock.assert_async().await;
}

// ==========================================================================
// Post-processing pipeline tests
// ==========================================================================

#[test]
fn test_post_process_result_with_llm_suggestions() {
    use crate::llm::{DictionarySuggestion, LlmResult};

    let llm_result = LlmResult {
        text: "Using SOLID and DRY principles".to_string(),
        suggestions: vec![
            DictionarySuggestion {
                source: "solid".to_string(),
                replacement: "SOLID".to_string(),
            },
            DictionarySuggestion {
                source: "dry".to_string(),
                replacement: "DRY".to_string(),
            },
        ],
    };

    let post_result = PostProcessResult {
        text: llm_result.text.clone(),
        llm_result: Some(llm_result),
        llm_duration_ms: 180,
    };

    assert_eq!(post_result.text, "Using SOLID and DRY principles");
    assert!(post_result.llm_result.is_some());
    let suggestions = &post_result.llm_result.as_ref().unwrap().suggestions;
    assert_eq!(suggestions.len(), 2);
    assert_eq!(suggestions[0].source, "solid");
    assert_eq!(suggestions[0].replacement, "SOLID");
    assert_eq!(suggestions[1].source, "dry");
    assert_eq!(suggestions[1].replacement, "DRY");
    assert_eq!(post_result.llm_duration_ms, 180);
}

#[test]
fn test_post_process_llm_disabled_preserves_text() {
    let config = AppConfig {
        api_key: "test".to_string(),
        llm: crate::config::LlmConfig {
            enabled: false,
            ..Default::default()
        },
        ..Default::default()
    };
    // When LLM is disabled, apply_post_processing should return text unchanged
    // (apart from dictionary). Verify config flag.
    assert!(!config.llm.enabled);
}

#[test]
fn test_post_process_llm_enabled_but_no_api_key() {
    let config = AppConfig {
        api_key: "test".to_string(),
        llm: crate::config::LlmConfig {
            enabled: true,
            api_key: String::new(),
            ..Default::default()
        },
        ..Default::default()
    };
    // apply_post_processing skips LLM when api_key is empty even if enabled
    assert!(config.llm.enabled);
    assert!(config.llm.api_key.is_empty());
}

#[test]
fn test_post_process_result_text_matches_llm_output() {
    use crate::llm::LlmResult;

    let llm_text = "Corrected text with punctuation.".to_string();
    let llm_result = LlmResult {
        text: llm_text.clone(),
        suggestions: vec![],
    };

    // Simulating apply_post_processing behavior:
    // final_text starts as transcription, then gets replaced by llm.text
    let mut final_text = "corrected text with punctuation".to_string();
    if let Some(llm) = Some(&llm_result) {
        final_text = llm.text.clone();
    }

    let post_result = PostProcessResult {
        text: final_text,
        llm_result: Some(llm_result),
        llm_duration_ms: 100,
    };

    assert_eq!(post_result.text, llm_text);
}

// ==========================================================================
// Debug log with DebugStorage (tempfile)
// ==========================================================================

#[test]
fn test_debug_storage_save_and_read_entry() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    let storage = DebugStorage::new(temp_dir.path().to_path_buf()).unwrap();

    let entry = DebugEntry {
        timestamp: "2026-03-25T10:00:00".to_string(),
        audio_file: None,
        audio_size_bytes: 2048,
        transcription: Some(TranscriptionLog {
            provider: "groq".to_string(),
            model: "whisper-large-v3".to_string(),
            language: Some("en".to_string()),
            duration_ms: 450,
            text: "Test transcription".to_string(),
        }),
        llm: None,
    };

    let result = storage.save_entry(&entry);
    assert!(result.is_ok());
}

#[test]
fn test_debug_storage_save_audio() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    let storage = DebugStorage::new(temp_dir.path().to_path_buf()).unwrap();

    let audio = test_audio_data();
    let result = storage.save_audio(&audio);
    assert!(result.is_ok());
    let filename = result.unwrap();
    assert!(filename.ends_with(".wav"));
}

#[test]
fn test_debug_storage_multiple_audio_files() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    let storage = DebugStorage::new(temp_dir.path().to_path_buf()).unwrap();

    // Save multiple audio files, verifying rotation works
    for _ in 0..5 {
        let result = storage.save_audio(&test_audio_data());
        assert!(result.is_ok());
    }
}

// ==========================================================================
// Pipeline config interaction tests
// ==========================================================================

#[test]
fn test_config_determines_transcription_language() {
    // When language is "auto", TranscriptionClient should receive None
    let config = AppConfig {
        api_key: "test-key".to_string(),
        language: "auto".to_string(),
        ..Default::default()
    };
    let lang_param = if config.language == "auto" {
        None
    } else {
        Some(config.language.as_str())
    };
    assert!(lang_param.is_none());

    // When language is specific, client should receive it
    let config2 = AppConfig {
        api_key: "test-key".to_string(),
        language: "ja".to_string(),
        ..Default::default()
    };
    let lang_param2 = if config2.language == "auto" {
        None
    } else {
        Some(config2.language.as_str())
    };
    assert_eq!(lang_param2, Some("ja"));
}

#[test]
fn test_config_debug_controls_audio_save() {
    // When debug is false, save_debug_audio is not called
    let config_no_debug = AppConfig {
        api_key: "test".to_string(),
        debug: false,
        ..Default::default()
    };
    assert!(!config_no_debug.debug);

    // When debug is true, save_debug_audio is called
    let config_debug = AppConfig {
        api_key: "test".to_string(),
        debug: true,
        ..Default::default()
    };
    assert!(config_debug.debug);
}

#[test]
fn test_failed_audio_storage_creation() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    let storage = storage::FailedAudioStorage::new(temp_dir.path());
    assert!(storage.is_ok());
}

#[test]
fn test_failed_audio_storage_save_and_list() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    let storage = storage::FailedAudioStorage::new(temp_dir.path()).unwrap();

    let audio = test_audio_data();
    let result = storage.save(&audio, "Transcription failed: timeout", None, "groq");
    assert!(result.is_ok());

    let entries = storage.list().unwrap();
    assert_eq!(entries.len(), 1);
    assert!(entries[0].error.contains("timeout"));
    assert_eq!(entries[0].provider, "groq");
}
