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

use dispatch::TranscriptionDispatcher;
use overlay_manager::OverlayManager;
use recording::RecordingCoordinator;

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

        Self {
            app,
            recording,
            overlay_manager,
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
        self.recording.on_hotkey_pressed().await;
    }
    pub async fn on_hotkey_released(&self) {
        self.recording.on_hotkey_released().await;
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

    #[cfg(debug_assertions)]
    pub async fn run_demo(&self) {
        self.overlay_manager.run_demo().await;
    }
}
