use super::coordinator::TranscriptionCoordinator;
use super::{load_config_from_app, transcription, RecordingState, TranscriptionQueue};
use crate::output::OutputHandler;
use crate::overlay_native::{OverlayBackend, OverlayState};
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::Mutex;

pub struct TranscriptionDispatcher;

impl TranscriptionDispatcher {
    pub fn spawn_worker(
        queue: Arc<TranscriptionQueue>,
        app: AppHandle,
        output: Arc<OutputHandler>,
        state: Arc<Mutex<RecordingState>>,
        overlay: Arc<Mutex<Box<dyn OverlayBackend>>>,
        coordinator: Arc<TranscriptionCoordinator>,
    ) {
        tauri::async_runtime::spawn(async move {
            loop {
                let item = queue.pop().await;
                tracing::info!(
                    "Queue worker: processing audio ({} bytes, queued {:?} ago)",
                    item.audio_data.len(),
                    item.timestamp.elapsed()
                );

                let config = load_config_from_app(&app);
                let ctx = transcription::TranscriptionContext::new(
                    app.clone(),
                    Arc::clone(&output),
                    Arc::clone(&state),
                    Arc::clone(&overlay),
                    item.audio_data.clone(),
                    Arc::clone(&coordinator),
                );

                transcription::transcribe_and_output(ctx, item.audio_data, config).await;

                // Notify Coordinator that pipeline finished. If a new recording
                // started already, Coordinator stays in Recording (per its rules).
                coordinator.notify_processing_finished();

                let remaining = queue.len().await;
                if remaining > 0 {
                    tracing::info!("Queue worker: {} items remaining", remaining);
                    overlay.lock().await.show(OverlayState::Queued(remaining));
                }
            }
        });
    }
}
