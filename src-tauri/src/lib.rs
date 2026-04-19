//! Voice Tauri library - voice dictation app.
//!
//! Architecture:
//! - config: AppConfig struct and validation
//! - storage: File-based storage (INI, MD, TXT, JSON)
//! - overlay: Overlay window management
//! - tray: System tray icon and menu
//! - audio: Audio recording using cpal
//! - transcription: Groq Whisper API client
//! - output: Clipboard and auto-typing
//! - hotkey: Low-level keyboard input via rdev
//! - orchestrator: Workflow coordination (recording -> transcription -> output)
//! - commands: Tauri commands exposed to frontend
//! - setup: Application initialization and configuration

pub mod audio;
pub mod commands;
pub mod config;
pub mod error;
pub mod hotkey;
pub mod learning;
pub mod llm;
pub mod orchestrator;
pub mod output;
pub mod overlay;
pub mod overlay_native;
pub mod permissions;
pub mod setup;
pub mod storage;
pub mod transcription;
pub mod tray;

use std::sync::Arc;

use audio::AudioRecorder;
use hotkey::HotkeyListener;
use orchestrator::Orchestrator;
use output::OutputHandler;
use tokio::sync::Mutex;

// =============================================================================
// Domain-specific State structs (SRP: each state handles one domain)
// =============================================================================

/// Audio recording state (SRP: audio management only).
pub struct AudioState {
    pub recorder: Arc<AudioRecorder>,
    /// Pending audio data from recording, awaiting transcription.
    pub pending_audio: Arc<std::sync::Mutex<Option<Vec<u8>>>>,
    /// Spectrum analyzer for FFT visualization.
    pub spectrum_analyzer: Arc<std::sync::Mutex<audio::SpectrumAnalyzer>>,
}

/// Text output state (SRP: output handling only).
pub struct OutputState {
    pub output: Arc<OutputHandler>,
}

/// Orchestrator state (SRP: workflow coordination only).
pub struct OrchestratorState {
    pub orchestrator: Arc<Orchestrator>,
}

/// Hotkey listener state (SRP: hotkey management only).
pub struct HotkeyState {
    pub hotkey_listener: Arc<Mutex<HotkeyListener>>,
}

/// Initialize and run the Tauri application.
pub fn run() {
    // Initialize X11 thread safety BEFORE anything else (Linux only)
    #[cfg(target_os = "linux")]
    setup::init_x11_threads();

    // Initialize logging
    setup::init_logging();

    // Kill any existing instances (after logging init so we see the logs)
    setup::kill_existing_instances();

    tracing::info!("Starting Voice app...");

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_os::init());

    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_plugin_macos_permissions::init());
    }

    builder
        .setup(setup::configure_app)
        .on_window_event(setup::handle_window_event)
        .invoke_handler(setup::command_handler())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
