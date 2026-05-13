//! Transcription module for Groq Whisper API.
//!
//! Handles HTTP requests to Groq's OpenAI-compatible API.
//! Follows SRP: Only handles transcription, no audio recording.

use reqwest::multipart::{Form, Part};
use serde::{Deserialize, Serialize};
use thiserror::Error;

const GROQ_API_URL: &str = "https://api.groq.com/openai/v1/audio/transcriptions";
const DEFAULT_MODEL: &str = "whisper-large-v3";

/// Groq API file size limit (25MB).
const MAX_AUDIO_BYTES: usize = 25 * 1024 * 1024;

/// Transcription errors.
#[derive(Error, Debug)]
pub enum TranscriptionError {
    #[error("API key not configured")]
    NoApiKey,
    #[error("HTTP error: {0}")]
    HttpError(String),
    #[error("API error: {0}")]
    ApiError(String),
    #[error("Invalid response: {0}")]
    ParseError(String),
    #[error("Audio too large: {0} bytes exceeds 25MB limit. Record shorter segments.")]
    AudioTooLarge(usize),
}

/// Transcription result from API.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct TranscriptionResult {
    pub text: String,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub duration: Option<f32>,
}

/// Groq API error response.
#[derive(Debug, Deserialize)]
struct ApiErrorResponse {
    error: ApiErrorDetail,
}

#[derive(Debug, Deserialize)]
struct ApiErrorDetail {
    message: String,
}

/// Build the multipart **text** params for a Whisper-compatible
/// /transcriptions request. Audio bytes are added separately by the
/// caller. Pure function: no I/O, easy to unit-test (SOLID-SRP).
///
/// `task=translate` follows the documented Groq + OpenAI Whisper API
/// behaviour: when present, the endpoint returns English text
/// regardless of the spoken language. Omitted by default so we stay
/// faithful to the source-language transcription.
pub(crate) fn build_form_text_params(
    model: &str,
    language: Option<&str>,
    translate: bool,
) -> Vec<(&'static str, String)> {
    let mut params: Vec<(&'static str, String)> = vec![
        ("model", model.to_string()),
        ("response_format", "verbose_json".to_string()),
    ];
    if let Some(lang) = language {
        params.push(("language", lang.to_string()));
    }
    if translate {
        params.push(("task", "translate".to_string()));
    }
    params
}

/// Transcription client for Groq API.
pub struct TranscriptionClient {
    api_key: String,
    model: String,
    language: Option<String>,
    /// When `true`, request English translation instead of source-language
    /// transcription (Whisper `task=translate`).
    translate: bool,
    client: reqwest::Client,
    api_url: String,
}

impl TranscriptionClient {
    /// Create a new transcription client.
    pub fn new(
        api_key: &str,
        model: Option<&str>,
        language: Option<&str>,
    ) -> Result<Self, TranscriptionError> {
        Self::with_url(api_key, model, language, GROQ_API_URL)
    }

    /// Create a new transcription client with custom API URL (for testing).
    pub fn with_url(
        api_key: &str,
        model: Option<&str>,
        language: Option<&str>,
        api_url: &str,
    ) -> Result<Self, TranscriptionError> {
        if api_key.is_empty() {
            return Err(TranscriptionError::NoApiKey);
        }

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| TranscriptionError::HttpError(e.to_string()))?;

        Ok(Self {
            api_key: api_key.to_string(),
            model: model.unwrap_or(DEFAULT_MODEL).to_string(),
            language: language.filter(|l| *l != "auto").map(|l| l.to_string()),
            translate: false,
            client,
            api_url: api_url.to_string(),
        })
    }

    /// Builder-style setter for the `translate` flag. Returns `self` so
    /// it composes with the existing `with_url` constructor without a
    /// breaking signature change.
    pub fn with_translate(mut self, translate: bool) -> Self {
        self.translate = translate;
        self
    }

    /// Transcribe audio data (WAV bytes).
    pub async fn transcribe(
        &self,
        audio_data: Vec<u8>,
    ) -> Result<TranscriptionResult, TranscriptionError> {
        if audio_data.len() > MAX_AUDIO_BYTES {
            return Err(TranscriptionError::AudioTooLarge(audio_data.len()));
        }

        let file_part = Part::bytes(audio_data)
            .file_name("audio.wav")
            .mime_str("audio/wav")
            .map_err(|e| TranscriptionError::HttpError(e.to_string()))?;

        let mut form = Form::new().part("file", file_part);
        for (key, value) in build_form_text_params(
            &self.model,
            self.language.as_deref(),
            self.translate,
        ) {
            form = form.text(key, value);
        }

        let response = self
            .client
            .post(&self.api_url)
            .bearer_auth(&self.api_key)
            .multipart(form)
            .send()
            .await
            .map_err(|e| TranscriptionError::HttpError(e.to_string()))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| TranscriptionError::HttpError(e.to_string()))?;

        if !status.is_success() {
            // Try to parse error response
            if let Ok(error_response) = serde_json::from_str::<ApiErrorResponse>(&body) {
                return Err(TranscriptionError::ApiError(error_response.error.message));
            }
            return Err(TranscriptionError::ApiError(format!(
                "HTTP {}: {}",
                status, body
            )));
        }

        // Parse successful response
        serde_json::from_str::<TranscriptionResult>(&body)
            .map_err(|e| TranscriptionError::ParseError(format!("{}: {}", e, body)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_client_requires_api_key() {
        let result = TranscriptionClient::new("", None, None);
        assert!(matches!(result, Err(TranscriptionError::NoApiKey)));
    }

    #[test]
    fn test_client_creation_with_key() {
        let client = TranscriptionClient::new("test_key", None, None);
        assert!(client.is_ok());
    }

    #[test]
    fn test_client_with_custom_model() {
        let client =
            TranscriptionClient::new("test_key", Some("whisper-large-v3-turbo"), Some("ru"))
                .unwrap();
        assert_eq!(client.model, "whisper-large-v3-turbo");
        assert_eq!(client.language, Some("ru".to_string()));
    }

    #[test]
    fn test_auto_language_becomes_none() {
        let client = TranscriptionClient::new("test_key", None, Some("auto")).unwrap();
        assert_eq!(client.language, None);
    }

    #[test]
    fn test_transcription_result_deserialize() {
        let json = r#"{"text": "Hello world", "language": "en", "duration": 2.5}"#;
        let result: TranscriptionResult = serde_json::from_str(json).unwrap();
        assert_eq!(result.text, "Hello world");
        assert_eq!(result.language, Some("en".to_string()));
        assert_eq!(result.duration, Some(2.5));
    }

    #[test]
    fn test_client_with_url() {
        let client = TranscriptionClient::with_url(
            "test_key",
            None,
            None,
            "http://localhost:8080/transcribe",
        )
        .unwrap();
        assert_eq!(client.api_url, "http://localhost:8080/transcribe");
    }

    #[test]
    fn test_error_display() {
        assert_eq!(
            TranscriptionError::NoApiKey.to_string(),
            "API key not configured"
        );
        assert_eq!(
            TranscriptionError::HttpError("timeout".to_string()).to_string(),
            "HTTP error: timeout"
        );
        assert_eq!(
            TranscriptionError::ApiError("rate limited".to_string()).to_string(),
            "API error: rate limited"
        );
        assert_eq!(
            TranscriptionError::ParseError("invalid json".to_string()).to_string(),
            "Invalid response: invalid json"
        );
    }

    #[test]
    fn test_transcription_result_minimal_deserialize() {
        let json = r#"{"text": "Hello"}"#;
        let result: TranscriptionResult = serde_json::from_str(json).unwrap();
        assert_eq!(result.text, "Hello");
        assert_eq!(result.language, None);
        assert_eq!(result.duration, None);
    }

    #[test]
    fn test_transcription_result_serialize() {
        let result = TranscriptionResult {
            text: "Test".to_string(),
            language: Some("en".to_string()),
            duration: Some(1.5),
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"text\":\"Test\""));
        assert!(json.contains("\"language\":\"en\""));
    }

    // --- T-A9 \xb7 translate_to_english ----------------------------------
    //
    // build_form_text_params() is the pure helper that produces the
    // multipart text fields the Whisper-compatible /transcriptions
    // endpoint accepts (model, language?, response_format, translate?).
    // It is extracted so the toggle can be unit-tested without spinning
    // up an HTTP mock (SOLID-SRP). The Whisper-compatible spec uses a
    // SEPARATE endpoint for translation (POST /audio/translations) but
    // Groq + several others honour a `task=translate` field on the
    // standard endpoint; we send the latter for broadest compat.

    fn find(params: &[(&'static str, String)], key: &str) -> Option<String> {
        params.iter().find(|(k, _)| *k == key).map(|(_, v)| v.clone())
    }

    #[test]
    fn form_params_omits_translate_when_disabled() {
        let params = build_form_text_params("whisper-large-v3-turbo", None, false);
        assert!(find(&params, "task").is_none(), "task must NOT be set when translate=false");
        assert_eq!(find(&params, "model").as_deref(), Some("whisper-large-v3-turbo"));
        assert_eq!(find(&params, "response_format").as_deref(), Some("verbose_json"));
    }

    #[test]
    fn form_params_includes_translate_when_enabled() {
        let params = build_form_text_params("whisper-large-v3-turbo", None, true);
        assert_eq!(find(&params, "task").as_deref(), Some("translate"),
            "task=translate is the documented field that tells Groq / OpenAI Whisper\n             to emit English regardless of the source language");
    }

    #[test]
    fn form_params_passes_through_language_when_set() {
        let params = build_form_text_params("whisper-large-v3-turbo", Some("ru"), false);
        assert_eq!(find(&params, "language").as_deref(), Some("ru"));
    }

    #[test]
    fn form_params_language_and_translate_coexist() {
        // Whisper translation still benefits from language hint (faster
        // / more accurate). The form is allowed to carry both.
        let params = build_form_text_params("whisper-large-v3-turbo", Some("ru"), true);
        assert_eq!(find(&params, "language").as_deref(), Some("ru"));
        assert_eq!(find(&params, "task").as_deref(), Some("translate"));
    }
}

// =============================================================================
// Integration tests with mockito (TDD #9)
// =============================================================================

#[cfg(test)]
mod integration_tests {
    use super::*;

    /// Create test audio data (minimal WAV header).
    fn test_audio_data() -> Vec<u8> {
        // Minimal valid WAV file (44 bytes header + 4 bytes data)
        vec![
            0x52, 0x49, 0x46, 0x46, // "RIFF"
            0x24, 0x00, 0x00, 0x00, // Chunk size (36 + 4 = 40)
            0x57, 0x41, 0x56, 0x45, // "WAVE"
            0x66, 0x6D, 0x74, 0x20, // "fmt "
            0x10, 0x00, 0x00, 0x00, // Subchunk1 size (16)
            0x01, 0x00, // Audio format (PCM = 1)
            0x01, 0x00, // Num channels (1)
            0x44, 0xAC, 0x00, 0x00, // Sample rate (44100)
            0x88, 0x58, 0x01, 0x00, // Byte rate (88200)
            0x02, 0x00, // Block align (2)
            0x10, 0x00, // Bits per sample (16)
            0x64, 0x61, 0x74, 0x61, // "data"
            0x04, 0x00, 0x00, 0x00, // Subchunk2 size (4)
            0x00, 0x00, 0x00, 0x00, // Audio samples
        ]
    }

    #[tokio::test]
    async fn test_successful_transcription() {
        let mut server = mockito::Server::new_async().await;

        let mock = server
            .mock("POST", "/transcriptions")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"text": "Hello world", "language": "en", "duration": 2.5}"#)
            .create_async()
            .await;

        let client = TranscriptionClient::with_url(
            "test_key",
            None,
            None,
            &format!("{}/transcriptions", server.url()),
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
    async fn test_unauthorized_error() {
        let mut server = mockito::Server::new_async().await;

        let mock = server
            .mock("POST", "/transcriptions")
            .with_status(401)
            .with_header("content-type", "application/json")
            .with_body(r#"{"error": {"message": "Invalid API key"}}"#)
            .create_async()
            .await;

        let client = TranscriptionClient::with_url(
            "invalid_key",
            None,
            None,
            &format!("{}/transcriptions", server.url()),
        )
        .unwrap();

        let result = client.transcribe(test_audio_data()).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, TranscriptionError::ApiError(_)));
        assert!(err.to_string().contains("Invalid API key"));

        mock.assert_async().await;
    }

    #[tokio::test]
    async fn test_bad_request_error() {
        let mut server = mockito::Server::new_async().await;

        let mock = server
            .mock("POST", "/transcriptions")
            .with_status(400)
            .with_header("content-type", "application/json")
            .with_body(r#"{"error": {"message": "Invalid audio format"}}"#)
            .create_async()
            .await;

        let client = TranscriptionClient::with_url(
            "test_key",
            None,
            None,
            &format!("{}/transcriptions", server.url()),
        )
        .unwrap();

        let result = client.transcribe(test_audio_data()).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.to_string().contains("Invalid audio format"));

        mock.assert_async().await;
    }

    #[tokio::test]
    async fn test_server_error() {
        let mut server = mockito::Server::new_async().await;

        let mock = server
            .mock("POST", "/transcriptions")
            .with_status(500)
            .with_body("Internal Server Error")
            .create_async()
            .await;

        let client = TranscriptionClient::with_url(
            "test_key",
            None,
            None,
            &format!("{}/transcriptions", server.url()),
        )
        .unwrap();

        let result = client.transcribe(test_audio_data()).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, TranscriptionError::ApiError(_)));
        assert!(err.to_string().contains("HTTP 500"));

        mock.assert_async().await;
    }

    #[tokio::test]
    async fn test_malformed_json_response() {
        let mut server = mockito::Server::new_async().await;

        let mock = server
            .mock("POST", "/transcriptions")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body("{invalid json}")
            .create_async()
            .await;

        let client = TranscriptionClient::with_url(
            "test_key",
            None,
            None,
            &format!("{}/transcriptions", server.url()),
        )
        .unwrap();

        let result = client.transcribe(test_audio_data()).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, TranscriptionError::ParseError(_)));

        mock.assert_async().await;
    }

    #[tokio::test]
    async fn test_rate_limit_error() {
        let mut server = mockito::Server::new_async().await;

        let mock = server
            .mock("POST", "/transcriptions")
            .with_status(429)
            .with_header("content-type", "application/json")
            .with_body(r#"{"error": {"message": "Rate limit exceeded"}}"#)
            .create_async()
            .await;

        let client = TranscriptionClient::with_url(
            "test_key",
            None,
            None,
            &format!("{}/transcriptions", server.url()),
        )
        .unwrap();

        let result = client.transcribe(test_audio_data()).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.to_string().contains("Rate limit exceeded"));

        mock.assert_async().await;
    }

    #[tokio::test]
    async fn test_service_unavailable_error() {
        let mut server = mockito::Server::new_async().await;

        let mock = server
            .mock("POST", "/transcriptions")
            .with_status(503)
            .with_header("content-type", "application/json")
            .with_body(r#"{"error": {"message": "Service temporarily unavailable"}}"#)
            .create_async()
            .await;

        let client = TranscriptionClient::with_url(
            "test_key",
            None,
            None,
            &format!("{}/transcriptions", server.url()),
        )
        .unwrap();

        let result = client.transcribe(test_audio_data()).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.to_string().contains("Service temporarily unavailable"));

        mock.assert_async().await;
    }

    #[tokio::test]
    async fn test_empty_audio_data() {
        let mut server = mockito::Server::new_async().await;

        let mock = server
            .mock("POST", "/transcriptions")
            .with_status(400)
            .with_header("content-type", "application/json")
            .with_body(r#"{"error": {"message": "Audio file is too short"}}"#)
            .create_async()
            .await;

        let client = TranscriptionClient::with_url(
            "test_key",
            None,
            None,
            &format!("{}/transcriptions", server.url()),
        )
        .unwrap();

        // Send empty audio data
        let result = client.transcribe(vec![]).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.to_string().contains("Audio file is too short"));

        mock.assert_async().await;
    }

    #[tokio::test]
    async fn test_network_timeout() {
        // Create a client with very short timeout pointing to a non-routable address
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_millis(1))
            .build()
            .unwrap();

        // Build the TranscriptionClient manually with the short-timeout client
        let tc = TranscriptionClient {
            api_key: "test_key".to_string(),
            model: "whisper-large-v3".to_string(),
            language: None,
            translate: false,
            client,
            api_url: "http://192.0.2.1:1/transcriptions".to_string(), // Non-routable TEST-NET
        };

        let result = tc.transcribe(test_audio_data()).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, TranscriptionError::HttpError(_)));
    }

    #[tokio::test]
    async fn test_html_error_response() {
        // Some proxies return HTML error pages instead of JSON
        let mut server = mockito::Server::new_async().await;

        let mock = server
            .mock("POST", "/transcriptions")
            .with_status(502)
            .with_header("content-type", "text/html")
            .with_body("<html><body>Bad Gateway</body></html>")
            .create_async()
            .await;

        let client = TranscriptionClient::with_url(
            "test_key",
            None,
            None,
            &format!("{}/transcriptions", server.url()),
        )
        .unwrap();

        let result = client.transcribe(test_audio_data()).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        // Should fall through to the generic HTTP error path since it's not valid JSON
        assert!(matches!(err, TranscriptionError::ApiError(_)));
        assert!(err.to_string().contains("HTTP 502"));

        mock.assert_async().await;
    }

    #[tokio::test]
    async fn test_empty_body_error_response() {
        let mut server = mockito::Server::new_async().await;

        let mock = server
            .mock("POST", "/transcriptions")
            .with_status(500)
            .with_body("")
            .create_async()
            .await;

        let client = TranscriptionClient::with_url(
            "test_key",
            None,
            None,
            &format!("{}/transcriptions", server.url()),
        )
        .unwrap();

        let result = client.transcribe(test_audio_data()).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, TranscriptionError::ApiError(_)));
        assert!(err.to_string().contains("HTTP 500"));

        mock.assert_async().await;
    }

    #[tokio::test]
    async fn test_missing_text_field_in_response() {
        // Response JSON is valid but missing required "text" field
        let mut server = mockito::Server::new_async().await;

        let mock = server
            .mock("POST", "/transcriptions")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"language": "en", "duration": 1.0}"#)
            .create_async()
            .await;

        let client = TranscriptionClient::with_url(
            "test_key",
            None,
            None,
            &format!("{}/transcriptions", server.url()),
        )
        .unwrap();

        let result = client.transcribe(test_audio_data()).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, TranscriptionError::ParseError(_)));

        mock.assert_async().await;
    }

    #[tokio::test]
    async fn test_empty_text_in_response() {
        // API returns success with empty transcription (silence)
        let mut server = mockito::Server::new_async().await;

        let mock = server
            .mock("POST", "/transcriptions")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"text": ""}"#)
            .create_async()
            .await;

        let client = TranscriptionClient::with_url(
            "test_key",
            None,
            None,
            &format!("{}/transcriptions", server.url()),
        )
        .unwrap();

        let result = client.transcribe(test_audio_data()).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap().text, "");

        mock.assert_async().await;
    }

    #[tokio::test]
    async fn test_minimal_response() {
        let mut server = mockito::Server::new_async().await;

        let mock = server
            .mock("POST", "/transcriptions")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"text": "Minimal"}"#)
            .create_async()
            .await;

        let client = TranscriptionClient::with_url(
            "test_key",
            None,
            None,
            &format!("{}/transcriptions", server.url()),
        )
        .unwrap();

        let result = client.transcribe(test_audio_data()).await;
        assert!(result.is_ok());
        let result = result.unwrap();
        assert_eq!(result.text, "Minimal");
        assert_eq!(result.language, None);
        assert_eq!(result.duration, None);

        mock.assert_async().await;
    }
}
