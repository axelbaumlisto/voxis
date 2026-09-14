//! `tauri-plugin-voxis`: Voxis dictation as an embeddable Tauri 2 plugin
//! (desktop + iOS). See `docs`/the plan
//! (`.pi/plans/tauri-plugin-voxis.md`) for the full design; this crate's
//! own module docs cover the contract each piece fixes:
//!
//! - `models`: wire-format command/event types (camelCase serde,
//!   fixture-snapshot tested).
//! - `capture`: `AudioCapture` trait, `rec/` scratch-dir helpers
//!   (`RecDir`/`RecFile`), `MockCapture`.
//! - `secrets`/`consent`: `SecretStore` trait + desktop fallback impls,
//!   the per-(host, provider) consent gate.
//! - `session`: single-flight active-session guard.
//! - `error`: the one `PluginError` every command returns.
//! - `commands`: the eleven Tauri commands, thin wrappers around
//!   testable `do_*` functions operating on `&PluginState` (no Tauri
//!   runtime needed to unit-test the actual logic).
//!
//! **Task 3 scope**: the skeleton above, wired together with a stub
//! pipeline — `start`/`stop`/`cancel` really do single-flight session
//! management, real consent gating, and real `RecFile` cleanup, but
//! `stop()` always returns an empty-text `DictationResult` with
//! `GuardOutcome::Finalized` (no guard timers, no transcription). Task 3b
//! (`pipeline.rs`/`session.rs` additions/`lease.rs`/`guard_adapter.rs`)
//! replaces the stub with the real capture -> guard -> transcription ->
//! dictionary -> llm pipeline, lease-based hold-mode safety, and the
//! richer failure-mode tests the plan's Task 3b acceptance lists.

pub mod capture;
pub mod commands;
pub mod consent;
pub mod error;
pub mod models;
pub mod secrets;
pub mod session;

use std::path::PathBuf;
use std::sync::Arc;

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

use capture::{AudioCapture, MockCapture, RecDir};
use consent::ConsentStore;
use secrets::{FileSecretStore, SecretStore};
use session::SessionGuard;

/// The plugin's own subdirectory name under the host's app-config
/// directory (`<host-config>/voxis-plugin/` for secrets/consent) *and*
/// under the host's app-cache directory (`<host-cache>/voxis-plugin/rec/`,
/// via `RecDir` — see `PluginState::new`'s doc comment for why in-flight
/// recordings live under cache, not config) — kept apart from anything
/// the host itself stores in either directory.
const PLUGIN_DIR_NAME: &str = "voxis-plugin";

/// Managed Tauri state: everything a command needs, gathered in one
/// place so `commands.rs`'s `do_*` functions can take `&PluginState`
/// directly (constructible in tests with no running Tauri app).
pub struct PluginState {
    pub sessions: SessionGuard,
    pub consent: ConsentStore,
    pub secrets: Arc<dyn SecretStore>,
    pub rec_dir: RecDir,
    pub capture: Arc<dyn AudioCapture>,
    /// Identifies the embedding host for consent/secret scoping (e.g.
    /// `"naked"`). Task 3 has no profile plumbing yet to source this
    /// from, so `init`/`init_with` just take it as a constructor
    /// argument.
    pub host_id: String,
    /// The STT provider host consent/gating currently applies to.
    /// Hardcoded to the desktop Voxis default (Groq) until Task 2/6 wire
    /// this from the active `VoxisProfile` instead.
    pub provider_host: String,
}

impl PluginState {
    /// `config_dir` (secrets/consent — small JSON files, fine to be
    /// backed up/synced) and `cache_dir` (`RecDir` — plan decision 3 /
    /// `[R1-Safety S5]` explicitly puts in-flight recordings under the
    /// host's *cache* dir, not config: on iOS the app-config-equivalent
    /// directory is iCloud-backed-up, and desktop hosts commonly sync
    /// their config dir; neither should ever see a moment-old WAV of
    /// someone's dictation) are deliberately two different `PathBuf`s —
    /// see `build`'s `setup` hook, which sources them from
    /// `app.path().app_config_dir()` / `app.path().app_cache_dir()`
    /// respectively.
    fn new(config_dir: PathBuf, cache_dir: PathBuf, secrets: Arc<dyn SecretStore>, capture: Arc<dyn AudioCapture>) -> Self {
        let plugin_config_dir = config_dir.join(PLUGIN_DIR_NAME);
        Self {
            sessions: SessionGuard::new(),
            consent: ConsentStore::new(plugin_config_dir.join("consent.json")),
            secrets,
            rec_dir: RecDir::new(cache_dir),
            capture,
            host_id: "default-host".to_string(),
            provider_host: "api.groq.com".to_string(),
        }
    }
}

/// Registers the plugin with the default desktop `SecretStore`
/// (`FileSecretStore`, a 0600 JSON file under the host's app-config dir —
/// see `secrets.rs` for why this is a fallback, not the final answer) and
/// `MockCapture` (Task 3 ships no real backend; Task 4/8 add
/// `CpalCapture`/the iOS Swift bridge and are expected to provide their
/// own `init_with_capture`-style constructor instead of this default).
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    build(None)
}

/// Registers the plugin with a host-supplied `SecretStore` (e.g. naked's
/// `naked_core::SecretStore`) instead of the desktop JSON fallback.
pub fn init_with<R: Runtime>(secrets: Arc<dyn SecretStore>) -> TauriPlugin<R> {
    build(Some(secrets))
}

fn build<R: Runtime>(secrets_override: Option<Arc<dyn SecretStore>>) -> TauriPlugin<R> {
    Builder::new("voxis")
        .invoke_handler(tauri::generate_handler![
            commands::start,
            commands::stop,
            commands::cancel,
            commands::state,
            commands::get_profile,
            commands::apply_profile,
            commands::import_profile_from_desktop,
            commands::import_profile_from_qr,
            commands::set_hotkey,
            commands::set_consent,
            commands::hold_lease,
        ])
        .setup(move |app, _api| {
            // Both `?` here surface a real "the host's app identifier/
            // paths aren't set up" failure through plugin `setup` instead
            // of silently treating it as `.` (which would put the rec/
            // scratch dir and the secrets/consent files in the process's
            // current working directory — exactly the kind of silent
            // fallback that made this a review finding to begin with).
            let config_dir = app.path().app_config_dir()?;
            let cache_dir = app.path().app_cache_dir()?;
            let secrets = secrets_override.clone().unwrap_or_else(|| {
                Arc::new(FileSecretStore::new(config_dir.join(PLUGIN_DIR_NAME).join("secrets.json")))
                    as Arc<dyn SecretStore>
            });
            let capture: Arc<dyn AudioCapture> = Arc::new(MockCapture::new());
            let state = PluginState::new(config_dir, cache_dir, secrets, capture);

            // `[R1-Safety S5]`: any file left in `rec/` at startup is an
            // orphan from a crash/SIGKILL mid-recording — sweep
            // unconditionally before anything else can touch that
            // directory. Best-effort (a sweep failure shouldn't block the
            // plugin from loading), but no longer silent: a failed sweep
            // means a possible orphan WAV is still sitting on disk.
            if let Err(e) = state.rec_dir.sweep() {
                tracing::warn!(error = %e, "RecDir::sweep failed during plugin setup — an orphaned recording file may remain on disk");
            }

            app.manage(state);
            Ok(())
        })
        .build()
}
