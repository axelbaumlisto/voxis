use std::sync::Arc;

use tauri::{App, Manager};
use tokio::sync::Mutex;

use crate::audio::AudioRecorder;
use crate::hotkey::HotkeyListener;
use crate::orchestrator::Orchestrator;
use crate::output::OutputHandler;
use crate::storage;
use crate::theme_engine::ThemeEngineLoader;
use crate::{AudioState, HotkeyState, OrchestratorState, OutputState};

/// Theme engine state wrapping the manifest-v2 loader.
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

/// Resolve the bundled themes directory path.
///
/// Tries each candidate in order; the first one that `.is_dir()` wins.
/// If no candidate passes, falls back to `CARGO_MANIFEST_DIR/themes` (dev).
/// Returns `None` only if nothing exists.
///
/// Extracted as a pure function so it can be unit-tested without an AppHandle.
pub(crate) fn resolve_bundled_themes_path(
    candidates: &[std::path::PathBuf],
) -> Option<std::path::PathBuf> {
    for candidate in candidates {
        if candidate.is_dir() {
            return Some(candidate.clone());
        }
    }
    let dev_path =
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("themes");
    if dev_path.is_dir() {
        return Some(dev_path);
    }
    None
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

    // --- Theme engine v2: seed bundled themes BEFORE legacy seeder runs ---
    //
    // Ordering is critical: the legacy ThemeLoader::ensure_seeded_external_themes()
    // writes v1-format theme.json files and skips dirs that already have a
    // theme.json. By running v2 seeding first, we ensure:
    //  1. Fresh install: v2 theme.jsons land first, legacy seeder skips them.
    //  2. Upgrade from older TALRI: v2 seed_from_bundle overwrites legacy v1
    //     theme.jsons (detected by missing manifest_version:2), then the legacy
    //     seeder sees the v2 files and skips.
    let theme_engine_loader = ThemeEngineLoader::new(themes_dir.clone());

    // Resolve the bundled themes path (prod: resource dir, dev: CARGO_MANIFEST_DIR).
    let bundle_themes_dir = {
        let resource_candidate = app
            .path()
            .resource_dir()
            .ok()
            .map(|r| r.join("themes"));
        let candidates: Vec<std::path::PathBuf> =
            resource_candidate.into_iter().collect();
        resolve_bundled_themes_path(&candidates)
    };
    if let Some(bundle_dir) = bundle_themes_dir {
        if let Err(e) = theme_engine_loader.seed_from_bundle(&bundle_dir) {
            tracing::warn!("ThemeEngineLoader seed_from_bundle failed: {}", e);
        }
    } else {
        tracing::warn!("ThemeEngineLoader: cannot resolve bundled themes directory");
    }

    // Scan v2 themes after seeding.
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

    tracing::debug!("Setup: domain states registered");
    orchestrator
}
