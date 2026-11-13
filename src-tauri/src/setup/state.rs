use std::path::PathBuf;
use std::sync::Arc;

use tauri::{App, Manager};
use tokio::sync::Mutex;

use crate::audio::AudioRecorder;
use crate::hotkey::HotkeyListener;
use crate::orchestrator::Orchestrator;
use crate::output::OutputHandler;
use crate::storage;
use crate::theme_engine::{
    known_builtin_digests, retire_pristine_copies, DirSource, EmbeddedSource, ThemeEngineLoader,
    ThemeSource,
};
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

/// The builtin theme layer.
///
/// A debug build reads `src-tauri/themes` from disk, so `bun run build:themes`
/// plus a theme Reload shows edits without recompiling — the no-rebuild
/// workflow in docs/THEME_EDITING.md. A release build uses the themes embedded
/// in the binary: they update and disappear with the app, and a bare binary
/// without a bundle directory still has them.
pub(super) fn builtin_theme_source() -> Box<dyn ThemeSource> {
    if cfg!(debug_assertions) {
        Box::new(DirSource::new(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("themes"),
        ))
    } else {
        Box::new(EmbeddedSource::builtin())
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

    let (user_dir, retired_dir) = {
        let paths = app.state::<storage::AppPaths>();
        // `themes-retired` is a sibling of `themes`, never inside it: the
        // scanner must not see the retired copies as themes.
        (paths.themes_dir(), paths.config_dir().join("themes-retired"))
    };

    // Move the user's untouched copies of old builtin themes out of the themes
    // folder; a copy the user edited stays and keeps shadowing the builtin.
    // `retire_pristine_copies` already logs every single move — here only the
    // summary of a run that retired something, so a clean install logs nothing.
    let report = retire_pristine_copies(&user_dir, &retired_dir, &known_builtin_digests());
    if !report.retired.is_empty() {
        tracing::info!(
            "theme_engine: retired {} pristine builtin theme(s) to {:?}",
            report.retired.len(),
            retired_dir
        );
    }
    // Not "edited" at info level: this also holds legacy and unreadable
    // folders, and it repeats on every start by design.
    if !report.kept_edited.is_empty() {
        tracing::debug!(
            "theme_engine: kept {} builtin-id folder(s) in {:?}: {:?}",
            report.kept_edited.len(),
            user_dir,
            report.kept_edited
        );
    }

    // Builtin themes come from the binary (debug: `src-tauri/themes`), the user
    // folder holds only the user's own themes and overrides.
    let theme_engine_loader = ThemeEngineLoader::with_builtin(builtin_theme_source(), user_dir);

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
        let armed = {
            let listener = hotkey_listener.blocking_lock();
            listener.start(app.handle().clone(), hotkey_str)
        };
        if armed {
            tracing::info!("Hotkey listener started: {}", hotkey_str);
        } else {
            // Two refusals land here (see `HotkeyListener::start`): no hotkey is
            // configured at all, or one is already running. In both cases NO
            // OS-level hook was installed — and while one IS installed this
            // process sees every keystroke on the machine — so claiming
            // "started" would be a lie about the privacy-relevant state.
            tracing::warn!(
                "Setup: hotkey listener NOT armed for '{}' \
                 (no hotkey configured, or a listener is already running)",
                hotkey_str
            );
        }
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
