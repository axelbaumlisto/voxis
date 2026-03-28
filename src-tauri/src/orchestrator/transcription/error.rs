use crate::orchestrator::state::RecordingState;
use crate::overlay_native::{OverlayBackend, OverlayState};
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::Mutex;

use super::context::TranscriptionContext;

/// Show idle overlay helper.
pub async fn show_idle_overlay(overlay: &Arc<Mutex<Box<dyn OverlayBackend>>>) {
    overlay.lock().await.show(OverlayState::Idle);
}

/// Handle error with state transition and overlay reset.
pub async fn handle_transcription_error(
    ctx: &TranscriptionContext,
    message: &str,
    reset_to_idle: bool,
) {
    tracing::error!("{}", message);
    let _ = ctx.app.emit("error", message);
    let mut s = ctx.state.lock().await;
    *s = RecordingState::Error;
    let _ = ctx.app.emit("state-changed", RecordingState::Error);
    show_idle_overlay(&ctx.overlay).await;

    if reset_to_idle {
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        *s = RecordingState::Idle;
        let _ = ctx.app.emit("state-changed", RecordingState::Idle);
    }
}
