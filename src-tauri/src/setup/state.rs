use std::sync::Arc;

use tauri::{App, Manager};
use tokio::sync::Mutex;

use crate::audio::AudioRecorder;
use crate::hotkey::HotkeyListener;
use crate::orchestrator::Orchestrator;
use crate::output::OutputHandler;
use crate::overlay_native::ThemeLoaderState;
use crate::storage;
use crate::theme_engine::ThemeEngineLoader;
use crate::{AudioState, HotkeyState, OrchestratorState, OutputState};

/// Theme engine state wrapping the new manifest-v2 loader.
/// Lives alongside the legacy ThemeLoaderState until Phase 6 deletion.
pub struct ThemeEngineState {
    pub loader: Arc<ThemeEngineLoader>,
}

/// Migrate configuration from INI to SQLite if needed.
pub(super) fn migrate_config_if_needed(
    paths: &storage::AppPaths,
    sqlite_storage: &storage::ConfigSqliteStorage,
) {
    let ini_path = paths.config_file();
    if ini_path.exists() {
        let ini_storage = storage::ConfigIniStorage::new(ini_path.clone());
        if let Ok(ini_config) = ini_storage.load() {
            if sqlite_storage.is_empty().unwrap_or(true) {
                if let Err(e) = sqlite_storage.save(&ini_config) {
                    tracing::warn!("Failed to migrate config to SQLite: {}", e);
                } else {
                    let backup_path = ini_path.with_extension("ini.bak");
                    if let Err(e) = std::fs::rename(&ini_path, &backup_path) {
                        tracing::warn!("Failed to rename config.ini to backup: {}", e);
                    } else {
                        tracing::info!(
                            "Migrated config from INI to SQLite, backup at {:?}",
                            backup_path
                        );
                    }
                }
            }
        }
    }
}

/// Create and register all shared application state.
pub(super) fn create_app_state(
    app: &App,
    config: &crate::config::AppConfig,
    enable_hotkey: bool,
) -> Arc<Orchestrator> {
    let recorder = Arc::new(AudioRecorder::new());
    let output = Arc::new(OutputHandler::default());

    let themes_dir = dirs::config_dir()
        .unwrap_or_default()
        .join("soupawhisper")
        .join("themes");
    let theme_loader_state = ThemeLoaderState::new(themes_dir.clone());
    let theme_loader_handle = Arc::clone(&theme_loader_state.handle);

    // New theme engine (manifest v2) — lives alongside legacy loader until Phase 6.
    let theme_engine_loader = ThemeEngineLoader::new(themes_dir);
    if let Err(e) = theme_engine_loader.scan() {
        tracing::warn!("ThemeEngineLoader scan failed at startup: {}", e);
    }
    app.manage(ThemeEngineState {
        loader: Arc::new(theme_engine_loader),
    });

    let orchestrator = Arc::new(Orchestrator::new(
        app.handle().clone(),
        Arc::clone(&recorder),
        Arc::clone(&output),
        theme_loader_handle,
    ));

    let hotkey_str = &config.hotkey;
    let hotkey_listener = Arc::new(Mutex::new(HotkeyListener::new()));

    if enable_hotkey {
        tracing::debug!("Setup: starting hotkey listener for '{}'...", hotkey_str);
        {
            let listener = hotkey_listener.blocking_lock();
            listener.start(app.handle().clone(), hotkey_str);
        }
        tracing::info!("Hotkey listener started: {}", hotkey_str);
    } else {
        tracing::warn!("Setup: hotkey listener NOT started (missing permissions)");
    }

    tracing::debug!("Setup: registering domain states...");

    app.manage(AudioState {
        recorder,
        pending_audio: Arc::new(std::sync::Mutex::new(None)),
        spectrum_analyzer: Arc::new(std::sync::Mutex::new(crate::audio::SpectrumAnalyzer::new())),
    });

    app.manage(OutputState { output });

    app.manage(OrchestratorState {
        orchestrator: Arc::clone(&orchestrator),
    });

    app.manage(HotkeyState { hotkey_listener });
    app.manage(theme_loader_state);

    tracing::debug!("Setup: domain states registered");
    orchestrator
}
