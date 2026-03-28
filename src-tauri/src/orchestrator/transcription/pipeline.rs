use crate::config::AppConfig;
use crate::orchestrator::post_process::apply_post_processing;
use crate::orchestrator::state::RecordingState;
use crate::storage::{self, FailedAudioStorage};
use std::time::Instant;
use tauri::Emitter;

use super::context::TranscriptionContext;
use super::debug::{save_debug_audio, save_debug_log};
use super::error::{handle_transcription_error, show_idle_overlay};
use super::{finalize_output, run_transcription, validate_config};

/// Perform transcription and output (runs in background).
///
/// SRP: Acts as a coordinator, delegating to helper functions.
pub async fn transcribe_and_output(
    ctx: TranscriptionContext,
    audio_data: Vec<u8>,
    config: AppConfig,
) {
    let total_start = Instant::now();
    let audio_size = audio_data.len();

    tracing::info!(
        "⏱️ [PERF] Starting transcription pipeline, audio: {} bytes ({:.1} KB)",
        audio_size,
        audio_size as f64 / 1024.0
    );

    // Validate configuration
    if let Err(msg) = validate_config(&config) {
        handle_transcription_error(&ctx, msg, true).await;
        return;
    }

    // Save debug audio if enabled
    let debug_save_start = Instant::now();
    let debug_audio_file = if config.debug {
        save_debug_audio(&ctx.app, &audio_data)
    } else {
        None
    };
    if config.debug {
        tracing::info!(
            "⏱️ [PERF] Debug audio save: {}ms",
            debug_save_start.elapsed().as_millis()
        );
    }

    // Run transcription (API call)
    let transcription_start = Instant::now();
    let result = match run_transcription(&config, audio_data).await {
        Ok(r) => r,
        Err(e) => {
            save_failed_audio(&ctx, &config, &e);
            handle_transcription_error(&ctx, &e, true).await;
            return;
        }
    };

    let transcription_duration_ms = transcription_start.elapsed().as_millis() as u64;
    tracing::info!(
        "⏱️ [PERF] Transcription API: {}ms, text: \"{}\"",
        transcription_duration_ms,
        result.text
    );

    // Apply post-processing (dictionary + LLM)
    let post_start = Instant::now();
    let post_result = apply_post_processing(&ctx.app, &config, &result.text).await;
    let post_duration_ms = post_start.elapsed().as_millis();
    tracing::info!(
        "⏱️ [PERF] Post-processing: {}ms (LLM: {}ms)",
        post_duration_ms,
        post_result.llm_duration_ms
    );

    // Save debug log if enabled
    if config.debug {
        save_debug_log(
            &ctx.app,
            &config,
            debug_audio_file,
            audio_size,
            &result.text,
            &post_result.text,
            result.language.clone(),
            transcription_duration_ms,
            &post_result,
        );
    }

    // Finalize output and emit
    finalize_output(
        &ctx.app,
        &ctx.output,
        &post_result.text,
        &config,
        result.language.as_deref(),
        result.duration,
    );

    // Reset to idle
    show_idle_overlay(&ctx.overlay).await;
    let mut s = ctx.state.lock().await;
    *s = RecordingState::Idle;
    let _ = ctx.app.emit("state-changed", RecordingState::Idle);

    // Total pipeline timing
    let total_duration_ms = total_start.elapsed().as_millis();
    tracing::info!(
        "⏱️ [PERF] TOTAL pipeline: {}ms (API: {}ms, Post: {}ms)",
        total_duration_ms,
        transcription_duration_ms,
        post_duration_ms
    );
}

fn save_failed_audio(ctx: &TranscriptionContext, config: &AppConfig, error: &str) {
    if let Some(paths) = storage::get_app_paths(&ctx.app) {
        match FailedAudioStorage::new(paths.config_dir()) {
            Ok(storage) => {
                if let Err(save_err) =
                    storage.save(&ctx.audio_data, error, None, &config.cloud_provider)
                {
                    tracing::warn!("Failed to save for retry: {}", save_err);
                } else {
                    let _ = ctx.app.emit("failed-transcriptions-updated", ());
                }
            }
            Err(storage_err) => {
                tracing::warn!("Failed to create FailedAudioStorage: {}", storage_err);
            }
        }
    }
}
