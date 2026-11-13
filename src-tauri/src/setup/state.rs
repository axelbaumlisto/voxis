use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::{App, Manager};
use tokio::sync::Mutex;

use crate::audio::AudioRecorder;
use crate::config::DEFAULT_OVERLAY_THEME;
use crate::hotkey::HotkeyListener;
use crate::orchestrator::Orchestrator;
use crate::output::OutputHandler;
use crate::storage;
use crate::theme_engine::{
    known_builtin_digests, manifest::is_safe_path_component, retire_pristine_copies, DirSource,
    EmbeddedSource, ThemeEngineLoader, ThemeSource,
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

/// The overlay theme to switch to when the configured one is gone.
///
/// Builtin themes ship in the binary, so an id can disappear between versions
/// while it stays in the user's config: the settings would show an empty
/// selection and the overlay would try to load a script that no longer
/// resolves. Returns the id to write into the config — always `default`, and
/// only when that theme is actually available; `None` means "leave the value
/// alone" (either it resolves, or there is nothing sane to fall back to).
///
/// "Gone" is stricter than "the loader does not know it": the scanner skips a
/// theme it cannot parse, so a user theme mid-edit (or a temporarily unreadable
/// user dir) is absent from the cache while its selection is perfectly valid.
/// The rewrite is persisted, so getting this wrong would throw the user's own
/// theme away — hence the folder probe: a theme that still has a folder of that
/// name in the user dir keeps its selection (the frontend already falls back to
/// `default` visually in the meantime). "Unknown" is never treated as "gone".
pub(super) fn fallback_overlay_theme(
    selected: &str,
    loader: &ThemeEngineLoader,
    user_dir: &Path,
) -> Option<&'static str> {
    if selected == DEFAULT_OVERLAY_THEME {
        return None;
    }
    if loader.manifest(selected).is_some() {
        return None;
    }
    if user_theme_may_exist(selected, user_dir) {
        return None;
    }
    if loader.manifest(DEFAULT_OVERLAY_THEME).is_some() {
        Some(DEFAULT_OVERLAY_THEME)
    } else {
        // Never guess another id and never retry: a missing `default` is a
        // broken install, not something to paper over at startup.
        None
    }
}

/// Might `user_dir` still hold a theme called `selected`?
///
/// True when an entry of that name exists — any entry type counts
/// (`symlink_metadata`, not the target): a theme the user is editing can be a
/// folder with a broken manifest, a folder still being written, or a symlink
/// into their dotfiles. Also true when the user dir itself cannot be read (the
/// loader probes it the same way): nothing is visible then, and "unknown" must
/// not be persisted as "gone". Ids that are not a single path component are
/// never probed, so this cannot look outside `user_dir`.
fn user_theme_may_exist(selected: &str, user_dir: &Path) -> bool {
    if !is_safe_path_component(selected) {
        return false;
    }
    if std::fs::read_dir(user_dir).is_err() {
        return true;
    }
    user_dir.join(selected).symlink_metadata().is_ok()
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
