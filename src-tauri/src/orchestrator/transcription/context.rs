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
/// Phase 4.2: `coordinator` is the authoritative state owner; `state` remains
/// as a downstream cache used by legacy code paths (error.rs, pipeline.rs final
/// state). When coordinator is `Some`, transitions go through it.
pub struct TranscriptionContext {
    pub app: AppHandle,
    pub output: Arc<OutputHandler>,
    pub state: Arc<Mutex<RecordingState>>,
    pub overlay: Arc<Mutex<Box<dyn OverlayBackend>>>,
    pub audio_data: Vec<u8>,
    pub coordinator: Option<Arc<TranscriptionCoordinator>>,
}

impl TranscriptionContext {
    /// Create a new transcription context without coordinator (legacy/test).
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
            coordinator: None,
        }
    }

    /// Create a new transcription context with coordinator handle (production).
    pub fn new_with_coordinator(
        app: AppHandle,
        output: Arc<OutputHandler>,
        state: Arc<Mutex<RecordingState>>,
        overlay: Arc<Mutex<Box<dyn OverlayBackend>>>,
        audio_data: Vec<u8>,
        coordinator: Option<Arc<TranscriptionCoordinator>>,
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
