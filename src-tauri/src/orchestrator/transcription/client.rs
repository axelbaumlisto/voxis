use crate::config::AppConfig;
use crate::transcription::{TranscriptionClient, TranscriptionResult};

/// Create transcription client and run transcription.
///
/// Uses `config.api_url_override` when set (e.g. for testing with mockito),
/// otherwise falls back to the default Groq API URL.
pub async fn run_transcription(
    config: &AppConfig,
    audio_data: Vec<u8>,
) -> Result<TranscriptionResult, String> {
    let language = if config.language == "auto" {
        None
    } else {
        Some(config.language.as_str())
    };

    let client = match config.api_url_override.as_deref() {
        Some(url) => {
            TranscriptionClient::with_url(&config.api_key, Some(&config.model), language, url)
        }
        None => TranscriptionClient::new(&config.api_key, Some(&config.model), language),
    }
    .map_err(|e| format!("Failed to create transcription client: {}", e))?
    .with_translate(config.translate_to_english);

    tracing::info!("Transcribing audio ({} bytes)...", audio_data.len());
    client
        .transcribe(audio_data)
        .await
        .map_err(|e| format!("Transcription failed: {}", e))
}
