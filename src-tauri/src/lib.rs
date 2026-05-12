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

pub mod apple_intelligence;
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

/// Build the specta Builder that mirrors the subset of Tauri commands we want
/// type-checked from the frontend. KISS: starts with five commands; expand as
/// the rest of the surface is migrated. This is intentionally separate from the
/// real Tauri `invoke_handler` (see `setup::command_handler`) so we can grow
/// specta coverage incrementally without breaking runtime command dispatch.
pub fn specta_bindings_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new().commands(tauri_specta::collect_commands![
        crate::commands::config::get_config,
        crate::commands::config::save_config,
        crate::commands::history::get_history,
        crate::commands::history::clear_history,
        crate::commands::dictionary::get_dictionary,
    ])
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

    // Specta TypeScript bindings: parallel builder used for type generation only.
    // The real invoke_handler is still produced by setup::command_handler() so the
    // entire command surface keeps working unchanged. In debug builds we re-export
    // bindings.ts whenever the app starts (cheap incremental task, gated by
    // debug_assertions so it never runs in release).
    #[cfg(debug_assertions)]
    {
        use specta_typescript::{BigIntExportBehavior, Typescript};
        // `@ts-nocheck` skips strict-mode unused-import errors for the generated
        // helpers (TAURI_CHANNEL, __makeEvents__) that specta emits unconditionally.
        let ts = Typescript::default()
            .bigint(BigIntExportBehavior::Number)
            .header("// @ts-nocheck\n");
        if let Err(e) = specta_bindings_builder().export(ts, "../src/bindings.ts") {
            tracing::warn!("Failed to export specta TypeScript bindings: {}", e);
        }
    }

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

#[cfg(test)]
mod bindings_export_tests {
    //! Forces specta bindings to regenerate on every `cargo test` run.
    //!
    //! Keeping the export inside a test guarantees that:
    //! 1. `src/bindings.ts` stays in sync with Rust command/type signatures.
    //! 2. CI fails (via dirty git tree check) when a developer forgets to
    //!    commit a regenerated bindings file.
    //!
    //! The test only runs in debug builds; the production path stays in
    //! `run()` gated by `cfg(debug_assertions)` for dev-server workflows.

    use super::specta_bindings_builder;
    use specta_typescript::{BigIntExportBehavior, Typescript};

    #[test]
    fn exports_typescript_bindings() {
        // Resolve path relative to the src-tauri crate so the test works from
        // any working directory (cargo runs tests from the crate root).
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let output = std::path::Path::new(manifest_dir).join("../src/bindings.ts");

        // Map i64/u64 -> TS `number`. JS losslessly stores integers up to 2^53,
        // which covers all id-like fields we currently expose.
        // `@ts-nocheck` skips strict-mode unused-import errors for specta helpers.
        let ts = Typescript::default()
            .bigint(BigIntExportBehavior::Number)
            .header("// @ts-nocheck\n");
        specta_bindings_builder()
            .export(ts, &output)
            .expect("specta bindings export failed");

        assert!(
            output.exists(),
            "bindings.ts was not written to {}",
            output.display()
        );
    }
}
