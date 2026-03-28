use crate::config::AppConfig;
use crate::storage::{self, DebugEntry, DebugStorage, LlmLog, TranscriptionLog};
use chrono::Local;

use crate::orchestrator::post_process::PostProcessResult;

/// Save debug audio file.
pub fn save_debug_audio(app: &tauri::AppHandle, audio_data: &[u8]) -> Option<String> {
    if let Some(paths) = storage::get_app_paths(app) {
        if let Ok(debug_dir) = paths.ensure_debug_dir() {
            if let Ok(storage) = DebugStorage::new(debug_dir) {
                match storage.save_audio(audio_data) {
                    Ok(filename) => {
                        tracing::info!("Debug: audio saved");
                        return Some(filename);
                    }
                    Err(e) => tracing::warn!("Debug: failed to save audio: {}", e),
                }
            }
        }
    }
    None
}

/// Save debug log entry.
#[allow(clippy::too_many_arguments)]
pub fn save_debug_log(
    app: &tauri::AppHandle,
    config: &AppConfig,
    debug_audio_file: Option<String>,
    audio_size: usize,
    original_text: &str,
    final_text: &str,
    language: Option<String>,
    transcription_duration_ms: u64,
    post_result: &PostProcessResult,
) {
    if let Some(paths) = storage::get_app_paths(app) {
        if let Ok(debug_dir) = paths.ensure_debug_dir() {
            if let Ok(storage) = DebugStorage::new(debug_dir) {
                let llm_log = if config.llm.enabled && post_result.llm_result.is_some() {
                    Some(LlmLog {
                        provider: config.llm.provider.clone(),
                        model: config.llm.model.clone(),
                        prompt: config.llm.prompt.clone(),
                        input_text: original_text.to_string(),
                        output_text: final_text.to_string(),
                        duration_ms: post_result.llm_duration_ms,
                    })
                } else {
                    None
                };

                let entry = DebugEntry {
                    timestamp: Local::now().format("%Y-%m-%dT%H:%M:%S").to_string(),
                    audio_file: debug_audio_file,
                    audio_size_bytes: audio_size,
                    transcription: Some(TranscriptionLog {
                        provider: config.cloud_provider.clone(),
                        model: config.model.clone(),
                        language,
                        duration_ms: transcription_duration_ms,
                        text: original_text.to_string(),
                    }),
                    llm: llm_log,
                };
                if let Err(e) = storage.save_entry(&entry) {
                    tracing::warn!("Debug: failed to save entry: {}", e);
                }
            }
        }
    }
}
