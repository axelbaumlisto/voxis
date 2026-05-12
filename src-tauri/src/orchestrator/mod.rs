//! Orchestrator module - coordinates recording, dispatch and overlay workflow.

pub mod audio_level;
pub mod coordinator;
pub mod dispatch;
pub mod overlay_manager;
pub mod post_process;
pub mod queue;
pub mod recording;
pub mod state;
pub mod transcription;

#[cfg(test)]
mod tests;

pub use queue::TranscriptionQueue;
pub use state::{ErrorContext, RecordingState};

use crate::audio::AudioRecorder;
use crate::config::AppConfig;
use crate::output::OutputHandler;
use crate::overlay_native::{NoopOverlay, OverlayBackend, ThemeLoaderHandle};
use crate::storage::{self, ConfigSqliteStorage};
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use coordinator::{Stage, TranscriptionCoordinator};
use dispatch::TranscriptionDispatcher;
use overlay_manager::OverlayManager;
use recording::RecordingCoordinator;

/// Map TALRI `RecordingState` to Coordinator `Stage`.
///
/// SRP: pure mapping function for stage comparison in Phase 4.1.
pub(crate) fn map_state_to_stage(state: &RecordingState) -> Stage {
    match state {
        RecordingState::Idle | RecordingState::Error => Stage::Idle,
        RecordingState::Recording => Stage::Recording,
        RecordingState::Transcribing => Stage::Processing,
    }
}

pub(crate) fn load_config_from_app(app: &AppHandle) -> AppConfig {
    if let Some(paths) = storage::get_app_paths(app) {
        let storage = ConfigSqliteStorage::new(paths.config_db());
        storage.load().unwrap_or_default()
    } else {
        AppConfig::default()
    }
}

pub struct Orchestrator {
    app: AppHandle,
    recording: RecordingCoordinator,
    overlay_manager: OverlayManager,
    /// Parallel single-thread state machine. Phase 4.1: runs alongside
    /// `RecordingCoordinator` for observation; not yet authoritative.
    coordinator: Arc<TranscriptionCoordinator>,
}

impl Orchestrator {
    pub fn new(
        app: AppHandle,
        recorder: Arc<AudioRecorder>,
        output: Arc<OutputHandler>,
        theme_loader: ThemeLoaderHandle,
    ) -> Self {
        let queue = Arc::new(TranscriptionQueue::new());
        let state = Arc::new(Mutex::new(RecordingState::Idle));
        let overlay: Arc<Mutex<Box<dyn OverlayBackend>>> =
            Arc::new(Mutex::new(Box::new(NoopOverlay::new())));
        let polling_cancel = Arc::new(Mutex::new(None::<CancellationToken>));

        TranscriptionDispatcher::spawn_worker(
            Arc::clone(&queue),
            app.clone(),
            output,
            Arc::clone(&state),
            Arc::clone(&overlay),
        );

        let recording = RecordingCoordinator::new(
            app.clone(),
            recorder,
            state,
            queue,
            Arc::clone(&overlay),
            polling_cancel,
        );
        let overlay_manager = OverlayManager::new(app.clone(), overlay, theme_loader);
        let coordinator = Arc::new(TranscriptionCoordinator::new());

        Self {
            app,
            recording,
            overlay_manager,
            coordinator,
        }
    }

    /// Debug-only check that Coordinator and RecordingCoordinator agree on stage.
    /// Logs (not asserts) divergence so Phase 4.1 is observation-only.
    fn check_stage_agreement(&self, recording_state: RecordingState, label: &str) {
        let coord_stage = self.coordinator.current_stage();
        let expected = map_state_to_stage(&recording_state);
        if coord_stage != expected {
            tracing::warn!(
                "Stage divergence after {}: coordinator={:?}, recording_state={:?} (mapped to {:?})",
                label,
                coord_stage,
                recording_state,
                expected
            );
        } else {
            tracing::debug!("Stage agreement after {}: {:?}", label, coord_stage);
        }
    }

    pub fn load_config(&self) -> AppConfig {
        load_config_from_app(&self.app)
    }
    pub async fn init_overlay(&self, config: &AppConfig) {
        self.overlay_manager.init(config).await;
    }
    pub async fn reinit_overlay(&self, config: &AppConfig) {
        self.overlay_manager.reinit(config).await;
    }
    pub async fn preview_overlay_theme(&self, theme_id: &str) -> Result<(), String> {
        self.overlay_manager.preview_theme(theme_id).await
    }
    pub async fn on_hotkey_pressed(&self) {
        // Phase 4.1: parallel run. Coordinator observes; RecordingCoordinator decides.
        self.coordinator.on_press();
        self.recording.on_hotkey_pressed().await;
        let state = self.recording.get_state().await;
        self.check_stage_agreement(state, "press");
    }
    pub async fn on_hotkey_released(&self) {
        self.coordinator.on_release();
        self.recording.on_hotkey_released().await;
        let state = self.recording.get_state().await;
        self.check_stage_agreement(state, "release");
    }
    pub async fn get_state(&self) -> RecordingState {
        self.recording.get_state().await
    }
    pub async fn is_overlay_running(&self) -> bool {
        self.overlay_manager.is_running().await
    }
    pub async fn manual_start(&self) {
        self.on_hotkey_pressed().await;
    }
    pub async fn manual_stop(&self) {
        self.on_hotkey_released().await;
    }
    pub fn shutdown(&self) {
        self.recording.shutdown();
    }

    /// Notify the Coordinator that the transcription pipeline finished.
    /// Phase 4.1: dispatch calls this when output is complete to keep
    /// Coordinator's stage in sync with reality.
    pub fn notify_processing_finished(&self) {
        self.coordinator.notify_processing_finished();
    }

    #[cfg(debug_assertions)]
    pub async fn run_demo(&self) {
        self.overlay_manager.run_demo().await;
    }
}
