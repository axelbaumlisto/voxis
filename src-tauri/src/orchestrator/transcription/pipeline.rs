use crate::config::AppConfig;
use crate::orchestrator::hallucination::is_likely_hallucination;
use crate::orchestrator::post_process::apply_post_processing;
use crate::orchestrator::state::RecordingState;
use crate::storage::{self, FailedAudioStorage};
use crate::transcription::{exceeds_size_limit, TranscriptionError, MAX_AUDIO_BYTES};
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

    // Oversize gate — reject BEFORE any dump write, config validation, or
    // HTTP round-trip. The client would reject this identically (same
    // `TranscriptionError::AudioTooLarge`, reused here so the user-facing
    // text is unchanged) — but only after this pipeline had already
    // written the full buffer to disk TWICE
    // (`save_debug_audio` + `save_failed_audio`, 2 × 1684 MB in the Sep 4
    // incident) for output nobody can retry: an oversize WAV fails the same
    // way every time. Placed ahead of `validate_config` deliberately — a
    // stuck recording that also has a stale API key should surface the
    // more actionable "too large" message, not "API key not configured".
    if exceeds_size_limit(audio_size) {
        crate::diagnostics::breadcrumbs::sites::transcription_failed();
        let message = format!(
            "Transcription failed: {}",
            TranscriptionError::AudioTooLarge(audio_size)
        );
        handle_transcription_error(&ctx, &message, true).await;
        return;
    }

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

    // Run transcription (API call). Cloned ONLY here, ONLY for the HTTP
    // client's ownership requirement (`run_transcription` →
    // `TranscriptionClient::transcribe` builds an owned multipart body) —
    // `audio_data` itself stays alive and unmodified for the whole function,
    // so the error branch below can pass it to `save_failed_audio` by
    // reference without a second long-lived copy (this used to be a THIRD
    // full-buffer copy living in `ctx.audio_data` for the entire pipeline,
    // success path included).
    let transcription_start = Instant::now();
    let result = match run_transcription(&config, audio_data.clone()).await {
        Ok(r) => r,
        Err(e) => {
            crate::diagnostics::breadcrumbs::sites::transcription_failed();
            save_failed_audio(&ctx.app, &audio_data, &config, &e);
            handle_transcription_error(&ctx, &e, true).await;
            return;
        }
    };

    crate::diagnostics::breadcrumbs::sites::first_transcription_success();
    let transcription_duration_ms = transcription_start.elapsed().as_millis() as u64;
    tracing::info!(
        "⏱️ [PERF] Transcription API: {}ms, text: \"{}\"",
        transcription_duration_ms,
        result.text
    );

    // Hallucination guard: Whisper invents stock phrases ("Продолжение
    // следует...", "Thanks for watching", etc.) on near-silent audio.
    // Drop such outputs BEFORE post-processing / output so they never
    // hit the clipboard or get auto-typed.
    if is_likely_hallucination(&result.text) {
        tracing::info!(
            "Hallucination guard: discarding stock phrase \"{}\" (тишина / no speech)",
            result.text
        );
        // Persist debug log so the user can see what was discarded.
        if config.debug {
            save_debug_log(
                &ctx.app,
                &config,
                debug_audio_file,
                audio_size,
                &result.text,
                "[discarded: hallucination]",
                result.language.clone(),
                transcription_duration_ms,
                &crate::orchestrator::post_process::PostProcessResult {
                    text: String::new(),
                    llm_result: None,
                    llm_duration_ms: 0,
                },
            );
        }
        show_idle_overlay(&ctx.overlay).await;
        let mut s = ctx.state.lock().await;
        *s = RecordingState::Idle;
        let _ = ctx.app.emit("state-changed", RecordingState::Idle);
        return;
    }

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

    crate::diagnostics::breadcrumbs::sites::transcription_completed();

    // Total pipeline timing
    let total_duration_ms = total_start.elapsed().as_millis();
    tracing::info!(
        "⏱️ [PERF] TOTAL pipeline: {}ms (API: {}ms, Post: {}ms)",
        total_duration_ms,
        transcription_duration_ms,
        post_duration_ms
    );
}

/// Persist `audio` for user-visible retry after a transcription failure.
///
/// Takes `audio: &[u8]` explicitly (not `ctx.audio_data`, which no longer
/// exists — `TranscriptionContext` stopped owning a redundant clone of the
/// WAV). Refuses oversize audio as defense-in-depth: the pipeline's own
/// gate above already prevents this call for oversize audio on the normal
/// path, but a future caller reaching this function directly must not
/// resurrect the double-dump bug.
fn save_failed_audio(app: &tauri::AppHandle, audio: &[u8], config: &AppConfig, error: &str) {
    if exceeds_size_limit(audio.len()) {
        tracing::warn!(
            "save_failed_audio: refusing to persist {} bytes (> {} byte limit) — \
             not retryable, would fail identically",
            audio.len(),
            MAX_AUDIO_BYTES
        );
        return;
    }
    if let Some(paths) = storage::get_app_paths(app) {
        match FailedAudioStorage::new(paths.config_dir()) {
            Ok(storage) => {
                if let Err(save_err) = storage.save(audio, error, None, &config.cloud_provider) {
                    tracing::warn!("Failed to save for retry: {}", save_err);
                } else {
                    let _ = app.emit("failed-transcriptions-updated", ());
                }
            }
            Err(storage_err) => {
                tracing::warn!("Failed to create FailedAudioStorage: {}", storage_err);
            }
        }
    }
}
