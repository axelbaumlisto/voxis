use crate::config::AppConfig;
use crate::output::auto_submit;
use crate::output::{format_output_text, OutputHandler};
use crate::storage;
use std::time::Instant;
use tauri::{AppHandle, Emitter};

/// Finalize output (clipboard, auto-type, history, emit).
pub fn finalize_output(
    app: &AppHandle,
    output: &OutputHandler,
    text: &str,
    config: &AppConfig,
    language: Option<&str>,
    duration: Option<f32>,
) {
    let output_start = Instant::now();

    // Apply pure output-shaping (e.g. append_trailing_space) BEFORE
    // anything touches the clipboard or the typer, and BEFORE we hand
    // the text to history — we want history to reflect what the user
    // actually saw in their target app (SRP for the shaping function;
    // SSOT for the displayed text).
    let shaped = format_output_text(text, config.append_trailing_space);
    let text = shaped.as_str();

    if config.auto_type {
        // Auto-type mode: type directly, don't touch clipboard
        if let Err(e) = output.type_text(text) {
            tracing::warn!("Auto-type failed: {}", e);
        }
    } else {
        // Clipboard paste mode: backup clipboard, copy+paste (keeps handle alive), restore
        let saved = output.save_clipboard();

        if let Err(e) = output.copy_and_paste_with_shortcuts(text, &config.paste_shortcuts) {
            tracing::error!("Failed to copy+paste: {}", e);
        }

        // Restore original clipboard contents.
        // copy_and_paste holds handle for 100ms post-paste (enough for X11 SelectionRequest).
        // restore_clipboard uses wait_until() on Linux for clipboard manager handoff.
        if let Err(e) = output.restore_clipboard(saved) {
            tracing::debug!("Failed to restore clipboard: {}", e);
        }
    }

    // Auto-submit: emit Enter / Cmd+Enter / Shift+Enter so chat
    // clients send the message without user keystroke. Off by default.
    if let Err(e) = auto_submit::emit(
        config.auto_submit_key,
        &auto_submit::EnigoEmitter,
    ) {
        tracing::warn!("auto_submit failed (non-fatal): {}", e);
    }

    tracing::info!("⏱️ [PERF] Output: {}ms", output_start.elapsed().as_millis());

    // History
    if config.history_enabled {
        save_to_history(app, text, language, duration);
    }

    // Emit result
    if let Err(e) = app.emit("transcription", text) {
        tracing::error!("Failed to emit transcription: {}", e);
    }
}

/// Save to history storage.
fn save_to_history(app: &AppHandle, text: &str, language: Option<&str>, duration: Option<f32>) {
    if let Some(factory) = storage::get_storage_factory(app) {
        if let Err(e) = factory.history().add(text, language, duration) {
            tracing::error!("Failed to add to history: {}", e);
        } else {
            tracing::info!("Emitting history-updated event");
            if let Err(e) = app.emit("history-updated", ()) {
                tracing::error!("Failed to emit history-updated: {}", e);
            }
        }
    }
}
