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
//! - `session`: single-flight active-session guard + the per-session
//!   `Recording`/`Transcribing` state machine and the handles a command
//!   needs to reach into a running session's pipeline task.
//! - `events`: `EventSink` — the injectable seam between the pipeline
//!   and `voxis://state`/`voxis://level`/`voxis://result`
//!   (`TauriEventSink` in production, `RecordingSink` in tests).
//! - `lease`: the Hold-mode heartbeat lease (`LeaseTracker`).
//! - `guard_adapter`: adapts `voxis_core::guard`'s RMS-window decision
//!   logic to the plugin's `LevelSample` polling.
//! - `pipeline`: the real capture -> guard -> transcription -> dictionary
//!   -> llm -> `DictationResult` pipeline (Task 3b).
//! - `error`: the one `PluginError` every command returns.
//! - `commands`: the eleven Tauri commands, thin wrappers around
//!   testable `do_*` functions operating on `&PluginState` (no Tauri
//!   runtime needed to unit-test the actual logic).
//!
//! **Task 3b** replaced Task 3's always-`Finalized`-empty-text pipeline
//! stub with the real thing: guard-driven silence/max-duration/self-cap/
//! liveness decisions, Hold-mode heartbeat lease, an abortable
//! transcription step, dictionary application, and optional LLM
//! post-process — see `pipeline.rs`'s module doc for the full shape.

pub mod capture;
pub mod commands;
pub mod consent;
pub mod error;
pub mod events;
pub mod guard_adapter;
pub mod lease;
pub mod models;
pub mod pipeline;
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
use events::{EventSink, TauriEventSink};
use secrets::{FileSecretStore, SecretStore};
use session::SessionGuard;

/// The plugin's own subdirectory name under the host's app-config
/// directory (`<host-config>/voxis-plugin/` for secrets/consent) *and*
/// under the host's app-cache directory (`<host-cache>/voxis-plugin/rec/`,
/// via `RecDir` — see `PluginState::new`'s doc comment for why in-flight
/// recordings live under cache, not config) — kept apart from anything
/// the host itself stores in either directory.
const PLUGIN_DIR_NAME: &str = "voxis-plugin";

/// Profile-derived settings/dictionary the pipeline needs at `start()`
/// time (`pipeline::PipelineDeps` is built from a snapshot of this).
/// Task 2/6/7 own actually populating it from an applied `VoxisProfile`
/// via `apply_profile`/`import_profile_from_*`; until then it's just
/// `AppConfig::default()` + an empty dictionary.
#[derive(Default)]
pub struct PipelineConfig {
    pub app_config: voxis_core::config::AppConfig,
    pub dictionary: Vec<(String, String)>,
}

/// Managed Tauri state: everything a command needs, gathered in one
/// place so `commands.rs`'s `do_*` functions can take `&PluginState`
/// directly (constructible in tests with no running Tauri app).
pub struct PluginState {
    /// `Arc`-wrapped (Task 3b, was a plain field in Task 3): the
    /// spawned pipeline task (`pipeline::spawn`) needs its own
    /// `'static`-lifetime handle to end the session's bookkeeping from
    /// inside `finalize`, independent of any particular command
    /// invocation's borrow of `&PluginState`.
    pub sessions: Arc<SessionGuard>,
    pub consent: ConsentStore,
    pub secrets: Arc<dyn SecretStore>,
    pub rec_dir: RecDir,
    pub capture: Arc<dyn AudioCapture>,
    /// The injectable event emitter (`[ADO-2/3 minors]`, "for 3b") —
    /// `TauriEventSink` in production, `events::RecordingSink` in tests.
    pub events: Arc<dyn EventSink>,
    pub pipeline_config: std::sync::Mutex<PipelineConfig>,
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
    /// Snapshot of everything `pipeline::spawn` needs, cloned out from
    /// behind `pipeline_config`'s lock (never held across an `.await` —
    /// the pipeline task that actually runs the async work is entirely
    /// separate from whatever command invocation calls this).
    pub fn pipeline_deps(&self) -> pipeline::PipelineDeps {
        let config = self.pipeline_config.lock().unwrap();
        pipeline::PipelineDeps {
            capture: self.capture.clone(),
            secrets: self.secrets.clone(),
            events: self.events.clone(),
            app_config: config.app_config.clone(),
            dictionary: config.dictionary.clone(),
        }
    }
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
    fn new(config_dir: PathBuf, cache_dir: PathBuf, secrets: Arc<dyn SecretStore>, capture: Arc<dyn AudioCapture>, events: Arc<dyn EventSink>) -> Self {
        let plugin_config_dir = config_dir.join(PLUGIN_DIR_NAME);
        Self {
            sessions: Arc::new(SessionGuard::new()),
            consent: ConsentStore::new(plugin_config_dir.join("consent.json")),
            secrets,
            rec_dir: RecDir::new(cache_dir),
            capture,
            events,
            pipeline_config: std::sync::Mutex::new(PipelineConfig::default()),
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
            let events: Arc<dyn EventSink> = Arc::new(TauriEventSink::new(app.app_handle().clone()));
            let state = PluginState::new(config_dir, cache_dir, secrets, capture, events);

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
        // `[R1-Safety S4]` / review finding F1: a dead/reloaded webview
        // must not leave a Hold session's mic open. `on_page_load` fires
        // on every navigation/reload of the plugin's webview -- including
        // the reload that follows an iOS "web content process
        // terminated" crash (Tauri/WKWebView don't expose that event
        // directly; the next `on_page_load` after it recovering is the
        // closest first observable signal). The Hold-mode heartbeat lease
        // (`lease.rs`) already covers the gap between the crash and that
        // reload (3 s worst case) independently of this hook.
        .on_page_load(|webview, _payload| {
            if let Some(state) = webview.try_state::<PluginState>() {
                state.sessions.cancel_all_hold();
            }
        })
        // Belt-and-suspenders for the same guarantee on desktop: the host
        // window/app closing entirely (not just navigating) must not
        // leave a Hold session running past process exit.
        .on_event(|app, event| {
            if matches!(
                event,
                tauri::RunEvent::WindowEvent { event: tauri::WindowEvent::Destroyed, .. }
                    | tauri::RunEvent::Exit
                    | tauri::RunEvent::ExitRequested { .. }
            ) {
                if let Some(state) = app.try_state::<PluginState>() {
                    state.sessions.cancel_all_hold();
                }
            }
        })
        .build()
}
