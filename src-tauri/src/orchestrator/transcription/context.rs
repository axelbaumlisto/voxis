use crate::output::OutputHandler;
use crate::overlay_native::OverlayBackend;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::Mutex;

use crate::orchestrator::coordinator::TranscriptionCoordinator;
use crate::orchestrator::state::RecordingState;

/// Context for transcription operations.
///
/// Groups related parameters to reduce function argument count (KISS principle).
///
/// Phase 4.2 (final): `coordinator` is **required** and is the authoritative
/// state owner. The legacy `state: Arc<Mutex<RecordingState>>` field is kept as
/// a downstream cache used by pipeline finalization and error handling — it
/// mirrors coordinator state plus a transient `Error` value the `Stage` enum
/// can't express.
///
/// Deliberately does NOT own the audio bytes: an earlier revision cloned
/// the whole WAV into `ctx.audio_data` in
/// `dispatch.rs` so `save_failed_audio` could still read it after the
/// original was moved into `run_transcription` — a second full-size copy
/// alive for the ENTIRE pipeline (success path included), on top of the one
/// `transcribe_and_output` already owns. `transcribe_and_output` now keeps
/// the single canonical `Vec<u8>` for its whole scope and only clones it
/// once, momentarily, at the point it hands ownership to the HTTP client.
pub struct TranscriptionContext {
    pub app: AppHandle,
    pub output: Arc<OutputHandler>,
    pub state: Arc<Mutex<RecordingState>>,
    pub overlay: Arc<Mutex<Box<dyn OverlayBackend>>>,
    pub coordinator: Arc<TranscriptionCoordinator>,
}

impl TranscriptionContext {
    /// Create a new transcription context.
    ///
    /// SRP: single constructor — every context has an owning coordinator handle.
    pub fn new(
        app: AppHandle,
        output: Arc<OutputHandler>,
        state: Arc<Mutex<RecordingState>>,
        overlay: Arc<Mutex<Box<dyn OverlayBackend>>>,
        coordinator: Arc<TranscriptionCoordinator>,
    ) -> Self {
        Self {
            app,
            output,
            state,
            overlay,
            coordinator,
        }
    }
}
