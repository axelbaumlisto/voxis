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
// Task 4: desktop-only backends (`CpalCapture`/`RdevHotkey`), behind the
// `desktop` Cargo feature so `cargo build -p tauri-plugin-voxis --target
// aarch64-apple-ios` (default, zero features) never touches cpal/rdev.
#[cfg(feature = "desktop")]
pub mod desktop;
pub mod error;
pub mod events;
pub mod guard_adapter;
#[cfg(feature = "desktop")]
pub mod hotkey_desktop;
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

/// Bridges `commands::set_hotkey` to a platform-specific OS-level hotkey
/// backend. `hotkey_desktop::RdevHotkey` implements this (Task 4); iOS
/// has no OS-level hotkey concept (plan decision 5 — touch hosts drive
/// hotkeys from the guest-js `keydown`/`keyup` side instead), so
/// `PluginState.hotkey` stays `None` there and `set_hotkey` is a
/// harmless no-op, same as the pre-Task-4 stub.
pub trait HotkeyController: Send + Sync {
    fn set_hotkey(&self, spec: &models::HotkeySpec) -> Result<(), error::PluginError>;
}

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
    /// The OS-level hotkey backend `commands::set_hotkey` delegates to
    /// (Task 4's `hotkey_desktop::RdevHotkey` on desktop). `None` on
    /// platforms/hosts with no such backend (iOS, or desktop builds
    /// without the `desktop` feature) — `set_hotkey` is then a no-op,
    /// same as the pre-Task-4 stub.
    pub hotkey: Option<Arc<dyn HotkeyController>>,
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
    fn new(
        config_dir: PathBuf,
        cache_dir: PathBuf,
        secrets: Arc<dyn SecretStore>,
        capture: Arc<dyn AudioCapture>,
        events: Arc<dyn EventSink>,
        hotkey: Option<Arc<dyn HotkeyController>>,
    ) -> Self {
        let plugin_config_dir = config_dir.join(PLUGIN_DIR_NAME);
        Self {
            sessions: Arc::new(SessionGuard::new()),
            consent: ConsentStore::new(plugin_config_dir.join("consent.json")),
            secrets,
            rec_dir: RecDir::new(cache_dir),
            capture,
            events,
            pipeline_config: std::sync::Mutex::new(PipelineConfig::default()),
            hotkey,
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
    build(None, default_capture, None)
}

/// Registers the plugin with a host-supplied `SecretStore` (e.g. naked's
/// `naked_core::SecretStore`) instead of the desktop JSON fallback.
pub fn init_with<R: Runtime>(secrets: Arc<dyn SecretStore>) -> TauriPlugin<R> {
    build(Some(secrets), default_capture, None)
}

fn default_capture() -> Arc<dyn AudioCapture> {
    Arc::new(MockCapture::new())
}

/// Registers the plugin with the real desktop backends (Task 4):
/// `desktop::CpalCapture` for `AudioCapture` and
/// `hotkey_desktop::RdevHotkey` (wired to `commands::do_start`/`do_stop`
/// through a `PluginHotkeySink`) for `commands::set_hotkey`. Behind the
/// `desktop` Cargo feature.
#[cfg(feature = "desktop")]
pub fn init_desktop<R: Runtime>() -> TauriPlugin<R> {
    build(None, desktop_capture, Some(desktop_hotkey_factory))
}

/// Same as [`init_desktop`], with a host-supplied `SecretStore`.
#[cfg(feature = "desktop")]
pub fn init_desktop_with<R: Runtime>(secrets: Arc<dyn SecretStore>) -> TauriPlugin<R> {
    build(Some(secrets), desktop_capture, Some(desktop_hotkey_factory))
}

#[cfg(feature = "desktop")]
fn desktop_capture() -> Arc<dyn AudioCapture> {
    Arc::new(desktop::CpalCapture::new())
}

/// What to do about one `(hotkey_desktop::Edge, Mode)` given the currently-tracked
/// active session, if any — pure decision, no I/O, fully unit-testable.
/// Hold: press starts (if idle), release stops (if a session is active).
/// Toggle: press starts-or-stops depending on whether one is already
/// active; release is always a no-op (the physical key may still be
/// "released" a moment after a toggle tap started a session).
#[cfg(feature = "desktop")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HotkeyAction {
    Start,
    Stop,
    Noop,
}

#[cfg(feature = "desktop")]
fn decide_hotkey_action(mode: models::Mode, edge: hotkey_desktop::Edge, active: Option<&models::SessionId>) -> HotkeyAction {
    match (mode, edge, active) {
        (models::Mode::Hold, hotkey_desktop::Edge::Pressed, None) => HotkeyAction::Start,
        (models::Mode::Hold, hotkey_desktop::Edge::Pressed, Some(_)) => HotkeyAction::Noop,
        (models::Mode::Hold, hotkey_desktop::Edge::Released, Some(_)) => HotkeyAction::Stop,
        (models::Mode::Hold, hotkey_desktop::Edge::Released, None) => HotkeyAction::Noop,
        (models::Mode::Toggle, hotkey_desktop::Edge::Pressed, None) => HotkeyAction::Start,
        (models::Mode::Toggle, hotkey_desktop::Edge::Pressed, Some(_)) => HotkeyAction::Stop,
        (models::Mode::Toggle, hotkey_desktop::Edge::Released, _) => HotkeyAction::Noop,
    }
}

/// Applies `decide_hotkey_action`'s outcome against `state`, awaiting the
/// resulting `commands::do_start`/`do_stop` call to full completion
/// before returning and updating `active` — the actual race fix (H2):
/// as long as every edge is routed through one call to this function at
/// a time, in arrival order (`run_hotkey_edge_loop`'s single-consumer
/// `while let` loop below guarantees that), a release can never observe
/// a press's session as "not started yet" merely because the press's own
/// `.await` hasn't resolved -- there is no press `.await` still in
/// flight when the release's turn comes.
///
/// Review round 2, N-M1: `active` is this loop's OWN belief about
/// whether a hotkey-started session is still running -- nothing here
/// observes a session ending any other way (UI stop/cancel button,
/// `cancel_all_hold`, the guard's own silence/max-duration timeout, a
/// pipeline failure). Without reconciling against the real source of
/// truth first, a session that ended out-of-band left `active` stuck at
/// `Some(stale_id)`, so the *next* Hold press was decided as `Noop`
/// (`decide_hotkey_action` sees "already active") and silently recorded
/// nothing. `state.sessions.has_active()` is checked (not
/// `is_active(id)`) because it stays `true` through `Transcribing` --
/// only `SessionGuard::end` (called once, at the very end of
/// `pipeline::finalize`) clears it -- so a hotkey session that is still
/// genuinely in flight (recording or transcribing) is never mistaken for
/// stale here.
#[cfg(feature = "desktop")]
async fn apply_hotkey_edge(state: &PluginState, mode: models::Mode, edge: hotkey_desktop::Edge, active: &mut Option<models::SessionId>) {
    if active.is_some() && !state.sessions.has_active() {
        *active = None;
    }
    match decide_hotkey_action(mode, edge, active.as_ref()) {
        HotkeyAction::Start => match commands::do_start(state, mode).await {
            Ok(id) => *active = Some(id),
            Err(e) => tracing::warn!(error = ?e, "hotkey-triggered start failed"),
        },
        HotkeyAction::Stop => {
            if let Some(id) = active.take() {
                let _ = commands::do_stop(state, &id).await;
            }
        }
        HotkeyAction::Noop => {}
    }
}

/// Bridges a fresh `hotkey_desktop::RdevHotkey`'s Pressed/Released edges
/// to `commands::do_start`/`do_stop`. The rdev listener thread itself is
/// synchronous and cannot `.await` directly, so `on_pressed`/`on_released`
/// only push onto an unbounded channel (non-blocking, preserves arrival
/// order); a single background task (`run_hotkey_edge_loop`, spawned once
/// in `PluginHotkeySink::new`) drains it and calls `apply_hotkey_edge`
/// for exactly one edge at a time.
///
/// Review fix H2: the previous design spawned a brand-new
/// `tauri::async_runtime::spawn` task per edge, with no ordering between
/// them; `active_session` was only set *after* `do_start().await`
/// resolved, so a quick Hold tap's release task could run first (it sees
/// `None`, does nothing) while the press task was still awaiting the
/// network/pipeline call — recording stuck on until the guard's own
/// silence/max-duration timeout, the original stuck-recording incident's
/// own failure class. The single-consumer queue removes the race by
/// construction instead of relying on lock timing.
#[cfg(feature = "desktop")]
struct PluginHotkeySink {
    edge_tx: tokio::sync::mpsc::UnboundedSender<(hotkey_desktop::Edge, models::Mode)>,
}

#[cfg(feature = "desktop")]
impl PluginHotkeySink {
    fn new<R: Runtime>(app: tauri::AppHandle<R>) -> Self {
        let (edge_tx, edge_rx) = tokio::sync::mpsc::unbounded_channel();
        tauri::async_runtime::spawn(run_hotkey_edge_loop(app, edge_rx));
        Self { edge_tx }
    }
}

#[cfg(feature = "desktop")]
async fn run_hotkey_edge_loop<R: Runtime>(app: tauri::AppHandle<R>, mut edge_rx: tokio::sync::mpsc::UnboundedReceiver<(hotkey_desktop::Edge, models::Mode)>) {
    let mut active: Option<models::SessionId> = None;
    while let Some((edge, mode)) = edge_rx.recv().await {
        let state = app.state::<PluginState>();
        apply_hotkey_edge(&state, mode, edge, &mut active).await;
    }
}

#[cfg(feature = "desktop")]
impl hotkey_desktop::HotkeyActions for PluginHotkeySink {
    fn on_pressed(&self, mode: models::Mode) {
        if let Err(e) = self.edge_tx.send((hotkey_desktop::Edge::Pressed, mode)) {
            tracing::error!(error = ?e, "hotkey edge loop is gone -- dropped a Pressed edge");
        }
    }

    fn on_released(&self, mode: models::Mode) {
        if let Err(e) = self.edge_tx.send((hotkey_desktop::Edge::Released, mode)) {
            tracing::error!(error = ?e, "hotkey edge loop is gone -- dropped a Released edge");
        }
    }
}

#[cfg(feature = "desktop")]
fn desktop_hotkey_factory<R: Runtime>(app: tauri::AppHandle<R>) -> Arc<dyn HotkeyController> {
    let actions: Arc<dyn hotkey_desktop::HotkeyActions> = Arc::new(PluginHotkeySink::new(app));
    Arc::new(hotkey_desktop::RdevHotkey::new(actions))
}

/// Builds a `HotkeyController` from the plugin's `AppHandle` once it's
/// available (`build`'s `setup` hook) — a plain fn pointer (not a
/// capturing closure) so `init`/`init_desktop` can each pass a different
/// one without `build` itself needing to be generic over a closure type.
type HotkeyFactory<R> = fn(tauri::AppHandle<R>) -> Arc<dyn HotkeyController>;

fn build<R: Runtime>(
    secrets_override: Option<Arc<dyn SecretStore>>,
    capture_factory: fn() -> Arc<dyn AudioCapture>,
    hotkey_factory: Option<HotkeyFactory<R>>,
) -> TauriPlugin<R> {
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
            let capture: Arc<dyn AudioCapture> = capture_factory();
            let hotkey = hotkey_factory.map(|f| f(app.app_handle().clone()));
            let events: Arc<dyn EventSink> = Arc::new(TauriEventSink::new(app.app_handle().clone()));
            let state = PluginState::new(config_dir, cache_dir, secrets, capture, events, hotkey);

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

#[cfg(all(test, feature = "desktop"))]
mod hotkey_sink_tests {
    use super::*;
    use crate::capture::MockCapture;
    use crate::consent::ConsentStore;
    use crate::events::RecordingSink;
    use crate::secrets::InMemorySecretStore;
    use crate::session::SessionGuard;
    use std::sync::Mutex as StdMutex;

    fn test_plugin_state(tmp: &tempfile::TempDir) -> PluginState {
        let secrets: Arc<dyn SecretStore> = Arc::new(InMemorySecretStore::new());
        secrets.set(pipeline::API_KEY_SECRET_NAME, &voxis_core::profile::Secret::new("test-key")).unwrap();
        let app_config = voxis_core::config::AppConfig { silence_timeout_ms: 0, ..voxis_core::config::AppConfig::default() };
        let state = PluginState {
            sessions: Arc::new(SessionGuard::new()),
            consent: ConsentStore::new(tmp.path().join("consent.json")),
            secrets,
            rec_dir: capture::RecDir::new(tmp.path().to_path_buf()),
            capture: Arc::new(MockCapture::new()),
            events: Arc::new(RecordingSink::new()),
            pipeline_config: StdMutex::new(PipelineConfig { app_config, dictionary: Vec::new() }),
            hotkey: None,
            host_id: "test-host".to_string(),
            provider_host: "api.groq.com".to_string(),
        };
        state.consent.set_consent("test-host", "api.groq.com", true).unwrap();
        state
    }

    // -- decide_hotkey_action: pure decision table --------------------

    #[test]
    fn hold_press_while_idle_starts() {
        assert_eq!(decide_hotkey_action(models::Mode::Hold, hotkey_desktop::Edge::Pressed, None), HotkeyAction::Start);
    }

    #[test]
    fn hold_release_while_active_stops() {
        let id = models::SessionId::new();
        assert_eq!(decide_hotkey_action(models::Mode::Hold, hotkey_desktop::Edge::Released, Some(&id)), HotkeyAction::Stop);
    }

    #[test]
    fn hold_release_while_idle_is_noop() {
        assert_eq!(decide_hotkey_action(models::Mode::Hold, hotkey_desktop::Edge::Released, None), HotkeyAction::Noop);
    }

    #[test]
    fn hold_press_while_already_active_is_noop() {
        let id = models::SessionId::new();
        assert_eq!(decide_hotkey_action(models::Mode::Hold, hotkey_desktop::Edge::Pressed, Some(&id)), HotkeyAction::Noop);
    }

    #[test]
    fn toggle_press_while_idle_starts() {
        assert_eq!(decide_hotkey_action(models::Mode::Toggle, hotkey_desktop::Edge::Pressed, None), HotkeyAction::Start);
    }

    #[test]
    fn toggle_press_while_active_stops() {
        let id = models::SessionId::new();
        assert_eq!(decide_hotkey_action(models::Mode::Toggle, hotkey_desktop::Edge::Pressed, Some(&id)), HotkeyAction::Stop);
    }

    #[test]
    fn toggle_release_is_always_noop() {
        let id = models::SessionId::new();
        assert_eq!(decide_hotkey_action(models::Mode::Toggle, hotkey_desktop::Edge::Released, Some(&id)), HotkeyAction::Noop);
        assert_eq!(decide_hotkey_action(models::Mode::Toggle, hotkey_desktop::Edge::Released, None), HotkeyAction::Noop);
    }

    // -- apply_hotkey_edge: the actual H2 regression, end to end ------

    /// Quick Hold tap: press then release, applied strictly in order
    /// (exactly what `run_hotkey_edge_loop`'s single-consumer queue
    /// guarantees for two edges that arrive close together) -- must
    /// start, then actually stop, never leaving the session stuck
    /// active because the release "ran too early".
    #[tokio::test]
    async fn quick_hold_tap_starts_then_stops_even_though_the_release_arrives_almost_immediately() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_plugin_state(&tmp);
        let mut active: Option<models::SessionId> = None;

        apply_hotkey_edge(&state, models::Mode::Hold, hotkey_desktop::Edge::Pressed, &mut active).await;
        assert!(active.is_some(), "press must have started a session");
        assert!(state.sessions.has_active());

        apply_hotkey_edge(&state, models::Mode::Hold, hotkey_desktop::Edge::Released, &mut active).await;
        assert!(active.is_none(), "release must have cleared the tracked session");
        assert!(!state.sessions.has_active(), "the session must actually be stopped, not left stuck recording");
    }

    /// N-M1 regression: a hotkey-started session that ends via a
    /// completely different path (UI stop/cancel, `cancel_all_hold`, the
    /// guard's own silence/max-duration timeout, a pipeline failure --
    /// simulated here directly via `SessionGuard::end`, the same call
    /// `pipeline::finalize` itself makes) must not leave `active` stuck
    /// at the stale id -- the *next* Hold press has to actually start a
    /// new session instead of being silently decided `Noop`.
    #[tokio::test]
    async fn hold_press_after_session_ended_out_of_band_starts_a_new_session() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_plugin_state(&tmp);
        let mut active: Option<models::SessionId> = None;

        apply_hotkey_edge(&state, models::Mode::Hold, hotkey_desktop::Edge::Pressed, &mut active).await;
        let first_id = active.clone().expect("press must have started a session");

        // Ended out-of-band (not through `apply_hotkey_edge`'s own Stop
        // branch) -- e.g. the UI's own stop button -- via the real
        // `commands::do_stop` (tears down the capture backend too, same
        // as a real non-hotkey stop path would; a bare `SessionGuard::end`
        // alone would leave `MockCapture` "running" and make the second
        // `do_start` below fail for an unrelated reason).
        commands::do_stop(&state, &first_id).await.unwrap();
        assert!(!state.sessions.has_active());

        apply_hotkey_edge(&state, models::Mode::Hold, hotkey_desktop::Edge::Pressed, &mut active).await;
        assert!(active.is_some(), "a fresh Hold press must start a NEW session, not be swallowed as \"already active\"");
        assert_ne!(active.as_ref(), Some(&first_id), "must be a genuinely new session id");
        assert!(state.sessions.has_active());
    }

    /// Toggle double-tap: two presses (no releases matter) must start
    /// exactly one session then stop that same one, never two starts or
    /// a stuck session.
    #[tokio::test]
    async fn toggle_double_tap_is_one_start_and_one_stop() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_plugin_state(&tmp);
        let mut active: Option<models::SessionId> = None;

        apply_hotkey_edge(&state, models::Mode::Toggle, hotkey_desktop::Edge::Pressed, &mut active).await;
        assert!(active.is_some(), "first tap must start a session");
        let started_id = active.clone();

        apply_hotkey_edge(&state, models::Mode::Toggle, hotkey_desktop::Edge::Pressed, &mut active).await;
        assert!(active.is_none(), "second tap must stop the session the first tap started");
        assert!(!state.sessions.has_active());
        assert!(started_id.is_some());
    }

    /// A `Released` edge for a toggle-mode session must never stop it
    /// (that's the *next press*'s job) -- guards against accidentally
    /// wiring `on_released` to `Stop` for toggle sessions.
    #[tokio::test]
    async fn toggle_release_never_stops_the_session() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_plugin_state(&tmp);
        let mut active: Option<models::SessionId> = None;

        apply_hotkey_edge(&state, models::Mode::Toggle, hotkey_desktop::Edge::Pressed, &mut active).await;
        assert!(active.is_some());

        apply_hotkey_edge(&state, models::Mode::Toggle, hotkey_desktop::Edge::Released, &mut active).await;
        assert!(active.is_some(), "release must be a no-op for an active toggle session");
        assert!(state.sessions.has_active());
    }
}
