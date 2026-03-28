use crate::output::OutputHandler;
use crate::overlay_native::OverlayBackend;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::Mutex;

use crate::orchestrator::state::RecordingState;

/// Context for transcription operations.
///
/// Groups related parameters to reduce function argument count (KISS principle).
pub struct TranscriptionContext {
    pub app: AppHandle,
    pub output: Arc<OutputHandler>,
    pub state: Arc<Mutex<RecordingState>>,
    pub overlay: Arc<Mutex<Box<dyn OverlayBackend>>>,
    pub audio_data: Vec<u8>,
}

impl TranscriptionContext {
    /// Create a new transcription context.
    pub fn new(
        app: AppHandle,
        output: Arc<OutputHandler>,
        state: Arc<Mutex<RecordingState>>,
        overlay: Arc<Mutex<Box<dyn OverlayBackend>>>,
        audio_data: Vec<u8>,
    ) -> Self {
        Self {
            app,
            output,
            state,
            overlay,
            audio_data,
        }
    }
}
