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
pub struct TranscriptionContext {
    pub app: AppHandle,
    pub output: Arc<OutputHandler>,
    pub state: Arc<Mutex<RecordingState>>,
    pub overlay: Arc<Mutex<Box<dyn OverlayBackend>>>,
    pub audio_data: Vec<u8>,
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
        audio_data: Vec<u8>,
        coordinator: Arc<TranscriptionCoordinator>,
    ) -> Self {
        Self {
            app,
            output,
            state,
            overlay,
            audio_data,
            coordinator,
        }
    }
}
