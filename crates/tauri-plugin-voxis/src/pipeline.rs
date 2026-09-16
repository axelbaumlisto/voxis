//! The real capture -> guard -> transcription -> dictionary -> llm ->
//! `DictationResult` pipeline (Task 3b), replacing Task 3's
//! always-`Finalized`-empty-text stub.
//!
//! One `tokio::spawn`ed task per session (`spawn`, invoked from
//! `commands::do_start`) owns the whole lifecycle: a 250 ms guard-poll
//! loop (`record_phase`) that also watches for an external `stop`/
//! `cancel` signal and (Hold mode only) a heartbeat lease, followed by
//! `finalize`, which stops the capture backend, decides Finalize vs.
//! Discard, optionally runs the (independently abortable, for `cancel`
//! during `Transcribing`) transcription+dictionary+llm chain, and always
//! ends by publishing the outcome and freeing the session slot \u2014
//! whatever branch got there.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration as StdDuration;

use tokio::sync::watch;
use tokio::time::{interval, Instant as TokioInstant};

use voxis_core::config::AppConfig;
use voxis_core::guard::{GuardState, StopReason};
use voxis_core::transcription::TranscriptionClient;

use crate::capture::{AudioCapture, RecFile};
use crate::error::PluginError;
use crate::events::EventSink;
use crate::guard_adapter;
use crate::lease::LeaseTracker;
use crate::models::{DictationResult, GuardOutcome, LevelEvent, Mode, SessionId, State, LEVEL_EVENT, RESULT_EVENT, STATE_EVENT};
use crate::secrets::SecretStore;
use crate::session::{ControlSignal, Outcome, SessionGuard, SessionHandles};

/// `SecretStore` key the pipeline reads the transcription API key from
/// at call time \u2014 never cached anywhere in `PluginState`/`PipelineDeps`
/// (`[R1-Safety S2]`).
pub const API_KEY_SECRET_NAME: &str = "api_key";

/// Consecutive missed 250 ms polls (with the session still `Recording`)
/// before the capture backend is considered dead (`[R1-Arch S3]`):
/// 4 * 250ms = 1s, matching the plan's "Recover \u2264 1 s" acceptance.
const LIVENESS_MISSED_POLLS_LIMIT: u32 = 4;

/// Everything a spawned session task needs, snapshotted/cloned out of
/// `PluginState` at `start()` time so the task has no lifetime tied to
/// any particular command invocation or Tauri runtime (unit-testable
/// with `RecordingSink`/`MockCapture`/`InMemorySecretStore`, no
/// `tauri::test` harness).
#[derive(Clone)]
pub struct PipelineDeps {
    pub capture: Arc<dyn AudioCapture>,
    pub secrets: Arc<dyn SecretStore>,
    pub events: Arc<dyn EventSink>,
    /// Snapshot of the profile-derived settings the pipeline needs
    /// (`model`/`language`/`api_url_override`/`silence_timeout_ms`/
    /// `max_recording_ms`/`min_recording_ms`/`llm`). Task 2/6/7 own
    /// actually populating this from an applied `VoxisProfile`; until
    /// then it's `AppConfig::default()`.
    pub app_config: AppConfig,
    /// `(source, replacement)` dictionary entries, snapshotted the same
    /// way (Task 2/6/7 populate from `VoxisProfile.dictionary`).
    pub dictionary: Vec<(String, String)>,
}

/// Spawns the Recording-phase task for a just-`begin()`'d session and
/// returns the handles `SessionGuard::attach_handles` stores for it.
/// `file` (the just-created `RecFile`) moves into the task \u2014 it is
/// dropped (deleting the WAV) exactly once, inside `finalize`, on every
/// exit path.
pub fn spawn(id: SessionId, mode: Mode, file: RecFile, deps: PipelineDeps, sessions: Arc<SessionGuard>) -> SessionHandles {
    let (control_tx, control_rx) = watch::channel(ControlSignal::None);
    let (outcome_tx, outcome_rx) = watch::channel(None);
    let transcribe_abort = Arc::new(StdMutex::new(None));
    let cancelled = Arc::new(AtomicBool::new(false));
    let lease = if mode == Mode::Hold { Some(Arc::new(StdMutex::new(LeaseTracker::new(TokioInstant::now())))) } else { None };

    deps.events.emit(STATE_EVENT, serde_json::to_value(State::Recording).unwrap());

    // `SessionSlotGuard` (review finding F4): a panic anywhere in
    // `record_phase`/`finalize` still unwinds through this guard's
    // `Drop`, freeing the single-flight slot -- without it a panicking
    // pipeline task would wedge `SessionGuard` at `AlreadyRecording`
    // forever, since `finalize`'s own explicit `sessions.end(&id)` would
    // never run. Calling `end` a second time on the normal path is a
    // harmless no-op (`UnknownSession`, ignored).
    let slot_guard = SessionSlotGuard { sessions: sessions.clone(), id: id.clone() };
    let task_lease = lease.clone();
    let task_transcribe_abort = transcribe_abort.clone();
    let task_cancelled = cancelled.clone();
    tokio::spawn(async move {
        let _slot_guard = slot_guard;
        record_phase(
            id,
            mode,
            file,
            deps,
            control_rx,
            outcome_tx,
            task_lease,
            task_transcribe_abort,
            task_cancelled,
            sessions,
        )
        .await;
    });

    SessionHandles { control_tx, outcome_rx, transcribe_abort, lease, cancelled }
}

/// See `spawn`'s doc comment / review finding F4.
struct SessionSlotGuard {
    sessions: Arc<SessionGuard>,
    id: SessionId,
}

impl Drop for SessionSlotGuard {
    fn drop(&mut self) {
        let _ = self.sessions.end(&self.id);
    }
}

/// Why the Recording-phase loop stopped polling.
#[derive(Debug, Clone, Copy)]
enum Trigger {
    Guard(StopReason),
    StreamDied,
    LeaseLost,
    ExternalStop,
    ExternalCancel,
}

#[allow(clippy::too_many_arguments)]
async fn record_phase(
    id: SessionId,
    mode: Mode,
    file: RecFile,
    deps: PipelineDeps,
    mut control_rx: watch::Receiver<ControlSignal>,
    outcome_tx: watch::Sender<Option<Outcome>>,
    lease: Option<Arc<StdMutex<LeaseTracker>>>,
    transcribe_abort: Arc<StdMutex<Option<tokio::task::AbortHandle>>>,
    cancelled: Arc<AtomicBool>,
    sessions: Arc<SessionGuard>,
) {
    let guard_cfg = guard_adapter::guard_cfg_for(&deps.app_config, mode);
    let mut guard_state = GuardState::new(&guard_cfg);
    let mut level_rx = deps.capture.level_rx();
    let mut ticker = interval(StdDuration::from_millis(guard_cfg.poll_ms() as u64));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut missed_polls: u32 = 0;

    let trigger = loop {
        tokio::select! {
            _ = ticker.tick() => {
                if level_rx.has_changed().unwrap_or(false) {
                    missed_polls = 0;
                    if let Some(sample) = *level_rx.borrow_and_update() {
                        deps.events.emit(
                            LEVEL_EVENT,
                            serde_json::to_value(LevelEvent { rms: sample.rms, peak: sample.peak, muted: sample.muted }).unwrap(),
                        );
                        if let Some(voxis_core::guard::GuardEvent::Stop(reason)) = guard_adapter::poll(&mut guard_state, &guard_cfg, Some(sample)) {
                            break Trigger::Guard(reason);
                        }
                    }
                } else {
                    missed_polls += 1;
                    if missed_polls >= LIVENESS_MISSED_POLLS_LIMIT {
                        break Trigger::StreamDied;
                    }
                }
                if let Some(lease) = &lease {
                    if lease.lock().unwrap().is_lost(TokioInstant::now()) {
                        break Trigger::LeaseLost;
                    }
                }
            }
            Ok(()) = control_rx.changed() => {
                match *control_rx.borrow_and_update() {
                    ControlSignal::Stop => break Trigger::ExternalStop,
                    ControlSignal::Cancel => break Trigger::ExternalCancel,
                    ControlSignal::None => {}
                }
            }
        }
    };

    finalize(id, trigger, file, deps, outcome_tx, transcribe_abort, cancelled, sessions).await;
}

/// Maps a stop trigger to the `GuardOutcome` reported to the caller and
/// whether the captured audio should actually be sent for transcription.
fn decide(trigger: Trigger, duration_ms: u64, min_recording_ms: u32) -> (GuardOutcome, bool) {
    let long_enough = duration_ms >= min_recording_ms as u64;
    match trigger {
        Trigger::Guard(StopReason::SilenceTimeout) => (GuardOutcome::SilenceTimeout, long_enough),
        Trigger::Guard(StopReason::SilenceTimeoutNoSpeech) => (GuardOutcome::SilenceTimeoutNoSpeech, false),
        Trigger::Guard(StopReason::MaxDuration) => (GuardOutcome::MaxDuration, long_enough),
        // guard_step only ever emits the three reasons above via
        // GuardEvent::Stop \u2014 the rest of StopReason is orchestrator-only
        // (desktop press/release machinery) and unreachable here, but
        // StopReason isn't ours to make exhaustive-by-construction.
        Trigger::Guard(_) => (GuardOutcome::Finalized, long_enough),
        Trigger::StreamDied => (GuardOutcome::StreamDied, long_enough),
        Trigger::LeaseLost => (GuardOutcome::LeaseLost, false),
        Trigger::ExternalStop => (GuardOutcome::Finalized, long_enough),
        Trigger::ExternalCancel => (GuardOutcome::Cancelled, false),
    }
}

#[allow(clippy::too_many_arguments)]
async fn finalize(
    id: SessionId,
    trigger: Trigger,
    file: RecFile,
    deps: PipelineDeps,
    outcome_tx: watch::Sender<Option<Outcome>>,
    transcribe_abort: Arc<StdMutex<Option<tokio::task::AbortHandle>>>,
    cancelled: Arc<AtomicBool>,
    sessions: Arc<SessionGuard>,
) {
    // `[ADO-8]`: same reasoning as `commands::do_start` -- on desktop,
    // `CpalCapture::stop()` joins the level thread, which can block up to
    // `LEVEL_INTERVAL` (see `desktop.rs`); on mobile this is a
    // `run_mobile_plugin` IPC round-trip. Never run it inline on this
    // spawned task's own tokio worker thread.
    let capture = deps.capture.clone();
    let stop_result = tokio::task::spawn_blocking(move || capture.stop())
        .await
        .unwrap_or_else(|join_err| Err(crate::capture::CaptureError::Backend(format!("capture.stop() task panicked: {join_err}"))));
    let (stats, capture_failed) = match stop_result {
        Ok(stats) => (stats, false),
        Err(e) => {
            // `[ADO-2/3 minors]`, "for 3b": a failed stop() must not
            // leave the backend internally "running" -- the session
            // slot is about to be freed either way, and a wedged backend
            // would then reject the very next start().
            deps.capture.reset();
            tracing::warn!(error = %e, "capture.stop() failed during finalize; backend reset");
            (crate::capture::CaptureStats::default(), true)
        }
    };

    let (decided_outcome, decided_should_transcribe) = decide(trigger, stats.duration_ms, deps.app_config.min_recording_ms);
    // Review finding F2 (TOCTOU): a `cancel()` that arrived after the
    // Recording-phase loop already broke out with some other trigger
    // (silence/max-duration/liveness), but before this check, must still
    // win -- otherwise `do_cancel` can return `Ok` while a full
    // transcription happens anyway and `voxis://result` carries real
    // text for a session the caller believes was cancelled.
    let already_cancelled = cancelled.load(Ordering::SeqCst);
    let (guard_outcome, should_transcribe) =
        if already_cancelled { (GuardOutcome::Cancelled, false) } else { (decided_outcome, decided_should_transcribe) };

    let result: Outcome = if capture_failed {
        Err(PluginError::Capture { message: "capture backend failed to stop cleanly".to_string() })
    } else if !should_transcribe {
        Ok(DictationResult { session_id: id.clone(), text: String::new(), language: None, duration_ms: stats.duration_ms, guard_outcome })
    } else {
        sessions.mark_transcribing(&id);
        deps.events.emit(STATE_EVENT, serde_json::to_value(State::Transcribing).unwrap());
        match run_transcription(file.path(), &deps, &transcribe_abort, &cancelled).await {
            TranscribeOutcome::Text { text, language } => {
                Ok(DictationResult { session_id: id.clone(), text, language, duration_ms: stats.duration_ms, guard_outcome })
            }
            TranscribeOutcome::Aborted => {
                Ok(DictationResult { session_id: id.clone(), text: String::new(), language: None, duration_ms: stats.duration_ms, guard_outcome: GuardOutcome::Cancelled })
            }
            TranscribeOutcome::Failed(e) => Err(e),
        }
    };

    // Review finding F3: `state()` never reports a lingering `Error` --
    // `Error` is a transient one-poll notification, always immediately
    // followed by the same `Idle` a successful run would end on.
    if result.is_err() {
        deps.events.emit(STATE_EVENT, serde_json::to_value(State::Error).unwrap());
    }
    deps.events.emit(STATE_EVENT, serde_json::to_value(State::Idle).unwrap());

    // Cleanup MUST complete before both the outcome is published AND
    // `voxis://result` is emitted: a waiter (`do_stop`/`do_cancel`'s
    // `await_outcome`, or a test on a different OS thread under the
    // multi-thread runtime) can be woken and resume running concurrently
    // with the rest of this function the instant `outcome_tx.send`
    // returns -- sending first would let it observe "the session
    // finished" before the slot is actually freed or the rec file
    // actually deleted (round-2 review, scenario A/B tests hit this in
    // practice on the multi-thread test runtime). `[ADO-3b]`: the same
    // reasoning applies to `voxis://result` -- it used to fire before
    // this cleanup, so a frontend that reacted to the event by
    // immediately calling `start()` again could race the not-yet-freed
    // session slot into a spurious `AlreadyRecording`. Within cleanup
    // itself, the file is dropped (deleted) BEFORE the slot is freed
    // (round-3 review, M1) so "slot free" is exactly synonymous with
    // "file gone" for any observer -- `do_cancel` has a path that returns
    // `Ok` without waiting at all when `outcome_receiver` is already
    // `None` (the session ended between `request_cancel` and that call),
    // and that caller should never be able to see a freed slot with an
    // orphaned rec file still on disk.
    drop(file); // deletes the WAV -- every exit path, success or failure.
    let _ = sessions.end(&id);
    if let Ok(dictation_result) = &result {
        deps.events.emit(RESULT_EVENT, serde_json::to_value(dictation_result).unwrap());
    }
    let _ = outcome_tx.send(Some(result));
}

enum TranscribeOutcome {
    Text { text: String, language: Option<String> },
    Aborted,
    Failed(PluginError),
}

async fn run_transcription(
    path: &Path,
    deps: &PipelineDeps,
    abort_cell: &Arc<StdMutex<Option<tokio::task::AbortHandle>>>,
    cancelled: &Arc<AtomicBool>,
) -> TranscribeOutcome {
    let bytes = match tokio::fs::read(path).await {
        Ok(b) => b,
        Err(e) => return TranscribeOutcome::Failed(PluginError::Capture { message: format!("reading rec file: {e}") }),
    };

    // Review finding F2, scenario B: `cancel()` can arrive while we're
    // still here (reading the file / fetching the secret / building the
    // client) -- before `abort_cell` even has a handle in it for
    // `request_cancel`'s `Transcribing` branch to grab. This is an early,
    // cheap check right after the file read; the check right before
    // actually building the client / spawning the HTTP task is the one
    // just below, after `secrets.get()` returns.
    if cancelled.load(Ordering::SeqCst) {
        return TranscribeOutcome::Aborted;
    }

    let api_key = match deps.secrets.get(API_KEY_SECRET_NAME) {
        Ok(Some(secret)) => secret,
        Ok(None) => return TranscribeOutcome::Failed(PluginError::Transcription { message: "no API key configured in SecretStore".to_string() }),
        Err(e) => return TranscribeOutcome::Failed(PluginError::Transcription { message: format!("reading API key: {e}") }),
    };

    // `SecretStore::get` is a synchronous trait method that can itself
    // take real time (host keychain prompt, disk IO) -- `cancel()` can
    // land while it's in flight, before `abort_cell` has anything in it
    // for `request_cancel`'s `Transcribing` branch to grab (round-2
    // review, scenario B). Re-check right after it returns, before
    // building the client / spawning the HTTP task at all.
    if cancelled.load(Ordering::SeqCst) {
        return TranscribeOutcome::Aborted;
    }

    let model = deps.app_config.model.clone();
    let language = deps.app_config.language.clone();
    let api_url_override = deps.app_config.api_url_override.clone();
    let client = {
        let key = api_key.expose();
        let built = match &api_url_override {
            Some(url) => TranscriptionClient::with_url(key, Some(&model), Some(&language), url),
            None => TranscriptionClient::new(key, Some(&model), Some(&language)),
        };
        match built {
            Ok(c) => c,
            Err(e) => return TranscribeOutcome::Failed(PluginError::Transcription { message: e.to_string() }),
        }
    };

    let handle = tokio::spawn(async move { client.transcribe(bytes).await });
    *abort_cell.lock().unwrap() = Some(handle.abort_handle());
    let joined = handle.await;
    *abort_cell.lock().unwrap() = None;

    // Symmetric check right after the network call completes: a
    // `cancel()` that landed while the request was in flight (too late
    // to actually abort the socket, e.g. the response had already fully
    // arrived) must still drop the real result instead of reporting it
    // as a successful transcription for a session the caller was told
    // was cancelled.
    if cancelled.load(Ordering::SeqCst) {
        return TranscribeOutcome::Aborted;
    }

    match joined {
        Ok(Ok(transcription)) => {
            let text = apply_dictionary(&transcription.text, &deps.dictionary);
            let text = apply_llm(text, &deps.app_config.llm).await;
            TranscribeOutcome::Text { text, language: transcription.language }
        }
        Ok(Err(e)) => TranscribeOutcome::Failed(PluginError::Transcription { message: e.to_string() }),
        Err(join_err) if join_err.is_cancelled() => TranscribeOutcome::Aborted,
        Err(join_err) => TranscribeOutcome::Failed(PluginError::Transcription { message: join_err.to_string() }),
    }
}

/// `[ADO-3b]` DRY: delegates to `voxis_core::storage::dictionary::
/// apply_entries`, the same case-insensitive, word-boundary regex logic
/// Voxis desktop's `DictionaryStorage::apply` uses \u2014 this crate applies
/// an in-memory `Vec<(String, String)>` snapshot (from a `VoxisProfile`,
/// Task 2/6/7) rather than `DictionaryStorage`'s own file-coupled
/// `dictionary.txt`, which is why this takes `entries` directly instead
/// of constructing a `DictionaryStorage`, not a reason to keep a second
/// copy of the regex itself.
fn apply_dictionary(text: &str, entries: &[(String, String)]) -> String {
    voxis_core::storage::dictionary::apply_entries(text, entries)
}

/// Optional LLM post-process (plan decision, "dictionary apply -> optional
/// LLM"): `build_llm_provider` itself returns `None` when
/// `!config.enabled` or no usable provider can be built, so a
/// default/disabled `LlmConfig` (Task 2/6/7 haven't wired a real profile
/// through yet) makes this a no-op. Fails open: a provider error just
/// keeps the dictionary-corrected text \u2014 post-processing is a
/// convenience, not something that should turn a perfectly good
/// transcription into a hard pipeline failure.
async fn apply_llm(text: String, llm_config: &voxis_core::config::LlmConfig) -> String {
    let Some(provider) = voxis_core::llm::provider::build_llm_provider(llm_config) else {
        return text;
    };
    if !provider.is_available() {
        return text;
    }
    match provider.process(&llm_config.prompt, &text).await {
        Ok(content) => match voxis_core::llm::parser::parse_result(&content, &text) {
            Ok(parsed) => parsed.text,
            Err(_) => text,
        },
        Err(e) => {
            tracing::warn!(error = %e, "LLM post-process failed; keeping dictionary-corrected text");
            text
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::{LevelSample, MockCapture};
    use crate::events::RecordingSink;
    use crate::secrets::InMemorySecretStore;
    use std::time::Duration;
    use voxis_core::profile::Secret;

    fn test_deps(capture: Arc<MockCapture>, sink: Arc<RecordingSink>) -> PipelineDeps {
        let secrets = Arc::new(InMemorySecretStore::new());
        secrets.set(API_KEY_SECRET_NAME, &Secret::new("test-key")).unwrap();
        // Deterministic by default: no silence-timeout auto-stop unless a
        // test opts in, and `min_recording_ms` defaults high enough that
        // an incidental nonzero `duration_ms` never accidentally crosses
        // into the transcribe branch (and therefore a real network call
        // to the default, non-overridden Groq URL) — tests that actually
        // want transcription set both `min_recording_ms` (low/0) AND
        // `api_url_override` (a local mockito server) explicitly.
        let app_config = AppConfig { silence_timeout_ms: 0, min_recording_ms: 3_600_000, ..AppConfig::default() };
        PipelineDeps { capture, secrets, events: sink, app_config, dictionary: Vec::new() }
    }

    async fn drain_outcome(mut rx: watch::Receiver<Option<Outcome>>) -> Outcome {
        loop {
            if let Some(outcome) = rx.borrow().clone() {
                return outcome;
            }
            rx.changed().await.unwrap();
        }
    }

    fn rec_file(dir: &tempfile::TempDir) -> (RecFile, std::path::PathBuf) {
        let path = dir.path().join("session.wav");
        (RecFile::create(path.clone()).unwrap(), path)
    }

    // Real time, not `start_paused` (`[R2-Exec]` empirically verified,
    // see `/tmp/repro_crate` throwaway repro during this task): tokio's
    // paused-clock auto-advance races against reqwest's own internal
    // connect/request timeout (a real tokio timer) whenever genuine
    // socket IO to a mockito server is involved, and reliably resolves
    // the timeout as "already elapsed" before the real (near-instant, but
    // not zero-poll) local HTTP round-trip completes — tests that
    // actually exercise the HTTP path use real time; tests that never
    // reach the network (silence/lease/liveness/self-cap decisions) keep
    // `start_paused` to run instantly regardless of guard-window length.
    #[tokio::test]
    async fn happy_path_returns_transcribed_and_dictionary_applied_text() {
        let mut server = mockito::Server::new_async().await;
        let _mock = server
            .mock("POST", "/transcriptions")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"text": "hello solid", "language": "en"}"#)
            .create_async()
            .await;

        let dir = tempfile::tempdir().unwrap();
        let (file, _path) = rec_file(&dir);
        let capture = Arc::new(MockCapture::new());
        let sink = Arc::new(RecordingSink::new());
        let mut deps = test_deps(capture.clone(), sink.clone());
        deps.app_config.api_url_override = Some(format!("{}/transcriptions", server.url()));
        deps.app_config.min_recording_ms = 0;
        deps.dictionary = vec![("solid".to_string(), "SOLID".to_string())];

        let sessions = Arc::new(SessionGuard::new());
        let id = sessions.begin(Mode::Toggle).unwrap();
        capture.start(&dir.path().join("session.wav"), 999_999).unwrap();
        let handles = spawn(id.clone(), Mode::Toggle, file, deps, sessions.clone());
        sessions.attach_handles(&id, handles);

        capture.tick(); // some signal, so liveness/level plumbing runs at least once

        let rx = sessions.signal(&id, ControlSignal::Stop).unwrap();
        let outcome = drain_outcome(rx).await;

        let result = outcome.unwrap();
        assert_eq!(result.text, "hello SOLID");
        assert_eq!(result.guard_outcome, GuardOutcome::Finalized);
        assert!(!sessions.has_active());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().filter(|e| e.as_ref().unwrap().path().extension().map(|x| x == "wav").unwrap_or(false)).count(), 0, "the wav must be deleted after a successful result");
    }

    /// `[ADO-3b]` regression: `voxis://result` must not be observable
    /// before the session slot is actually freed -- a decorator `EventSink`
    /// checks `sessions.has_active()` the instant `RESULT_EVENT` fires
    /// (from inside `emit`, i.e. strictly before `finalize` returns or
    /// `outcome_tx` is published), which would have failed under the old
    /// "emit `voxis://result`, THEN free the slot" ordering.
    #[tokio::test]
    async fn result_event_fires_only_after_the_session_slot_is_freed() {
        struct SlotCheckingSink {
            inner: Arc<RecordingSink>,
            sessions: Arc<SessionGuard>,
            slot_was_free_on_result: Arc<StdMutex<Option<bool>>>,
        }
        impl EventSink for SlotCheckingSink {
            fn emit(&self, event: &str, payload: serde_json::Value) {
                if event == RESULT_EVENT {
                    *self.slot_was_free_on_result.lock().unwrap() = Some(!self.sessions.has_active());
                }
                self.inner.emit(event, payload);
            }
        }

        let mut server = mockito::Server::new_async().await;
        let _mock = server
            .mock("POST", "/transcriptions")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"text": "hello", "language": "en"}"#)
            .create_async()
            .await;

        let dir = tempfile::tempdir().unwrap();
        let (file, _path) = rec_file(&dir);
        let capture = Arc::new(MockCapture::new());
        let sessions = Arc::new(SessionGuard::new());
        let slot_was_free_on_result = Arc::new(StdMutex::new(None));
        let sink = Arc::new(SlotCheckingSink {
            inner: Arc::new(RecordingSink::new()),
            sessions: sessions.clone(),
            slot_was_free_on_result: slot_was_free_on_result.clone(),
        });
        let secrets = Arc::new(InMemorySecretStore::new());
        secrets.set(API_KEY_SECRET_NAME, &Secret::new("test-key")).unwrap();
        let app_config = AppConfig {
            api_url_override: Some(format!("{}/transcriptions", server.url())),
            min_recording_ms: 0,
            silence_timeout_ms: 0,
            ..AppConfig::default()
        };
        let deps = PipelineDeps { capture: capture.clone(), secrets, events: sink, app_config, dictionary: Vec::new() };

        let id = sessions.begin(Mode::Toggle).unwrap();
        capture.start(&dir.path().join("session.wav"), 999_999).unwrap();
        let handles = spawn(id.clone(), Mode::Toggle, file, deps, sessions.clone());
        sessions.attach_handles(&id, handles);

        let rx = sessions.signal(&id, ControlSignal::Stop).unwrap();
        let outcome = drain_outcome(rx).await;
        assert_eq!(outcome.unwrap().text, "hello");

        assert_eq!(
            *slot_was_free_on_result.lock().unwrap(),
            Some(true),
            "the session slot must already be free by the time voxis://result fires"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn no_speech_discard_never_calls_transcription() {
        let mut server = mockito::Server::new_async().await;
        let mock = server.mock("POST", "/transcriptions").expect(0).create_async().await;

        let dir = tempfile::tempdir().unwrap();
        let (file, path) = rec_file(&dir);
        let capture = Arc::new(MockCapture::new());
        let sink = Arc::new(RecordingSink::new());
        let mut deps = test_deps(capture.clone(), sink.clone());
        deps.app_config.api_url_override = Some(format!("{}/transcriptions", server.url()));
        deps.app_config.silence_timeout_ms = 300;

        let sessions = Arc::new(SessionGuard::new());
        let id = sessions.begin(Mode::Toggle).unwrap();
        capture.start(&path, 999_999).unwrap();
        capture.set_script(vec![LevelSample::new(0.0, 0.0); 60]);
        let handles = spawn(id.clone(), Mode::Toggle, file, deps, sessions.clone());
        sessions.attach_handles(&id, handles);

        // Drive the guard by advancing time + ticking in lockstep every
        // 250ms poll. The silence window's capacity is fixed at
        // `SILENCE_WINDOW_MS / GUARD_POLL_MS` = 40 polls regardless of
        // `silence_timeout_ms`, so it takes ~40 polls just to fill before
        // any silence-based decision is possible, plus a couple more once
        // full for `silent_ms` to reach 300ms.
        let rx = sessions.outcome_receiver(&id).unwrap();
        for _ in 0..50 {
            capture.tick();
            tokio::time::advance(Duration::from_millis(250)).await;
            tokio::task::yield_now().await;
            if rx.borrow().is_some() {
                break;
            }
        }

        let outcome = drain_outcome(rx).await;
        let result = outcome.unwrap();
        assert_eq!(result.guard_outcome, GuardOutcome::SilenceTimeoutNoSpeech);
        assert_eq!(result.text, "");
        mock.assert_async().await;
    }

    #[tokio::test] // real time — see happy_path's comment on `start_paused` + real HTTP.
    async fn http_5xx_produces_transcription_error_and_deletes_file() {
        let mut server = mockito::Server::new_async().await;
        let _mock = server.mock("POST", "/transcriptions").with_status(500).with_body("boom").create_async().await;

        let dir = tempfile::tempdir().unwrap();
        let (file, path) = rec_file(&dir);
        let capture = Arc::new(MockCapture::new());
        let sink = Arc::new(RecordingSink::new());
        let mut deps = test_deps(capture.clone(), sink.clone());
        deps.app_config.api_url_override = Some(format!("{}/transcriptions", server.url()));
        deps.app_config.min_recording_ms = 0;

        let sessions = Arc::new(SessionGuard::new());
        let id = sessions.begin(Mode::Toggle).unwrap();
        capture.start(&path, 999_999).unwrap();
        let handles = spawn(id.clone(), Mode::Toggle, file, deps, sessions.clone());
        sessions.attach_handles(&id, handles);

        let rx = sessions.signal(&id, ControlSignal::Stop).unwrap();
        let outcome = drain_outcome(rx).await;

        assert!(matches!(outcome, Err(PluginError::Transcription { .. })));
        assert!(!sessions.has_active());
        assert!(!path.exists(), "the file must be deleted even on a transcription failure");
        assert_eq!(sink.count(STATE_EVENT), 4, "Recording, Transcribing, Error, then back to Idle (review finding F3)");
        assert_eq!(sink.events().last().unwrap().1, serde_json::json!("idle"), "the last state event must never leave the frontend stuck on Error");
    }

    #[tokio::test(start_paused = true)]
    async fn capture_died_silently_recovers_within_one_second() {
        let dir = tempfile::tempdir().unwrap();
        let (file, path) = rec_file(&dir);
        let capture = Arc::new(MockCapture::new());
        let sink = Arc::new(RecordingSink::new());
        let deps = test_deps(capture.clone(), sink.clone());

        let sessions = Arc::new(SessionGuard::new());
        let id = sessions.begin(Mode::Toggle).unwrap();
        capture.start(&path, 999_999).unwrap();
        capture.set_die_silently(true); // "died silently": is_running() stays true, no more ticks
        let handles = spawn(id.clone(), Mode::Toggle, file, deps, sessions.clone());
        sessions.attach_handles(&id, handles);

        let rx = sessions.outcome_receiver(&id).unwrap();
        let start = TokioInstant::now();
        let outcome = drain_outcome(rx).await;
        let elapsed = TokioInstant::now().saturating_duration_since(start);

        assert!(elapsed <= Duration::from_millis(1_000), "must recover within 1s of the stream dying, took {elapsed:?}");
        assert_eq!(outcome.unwrap().guard_outcome, GuardOutcome::StreamDied);
    }

    #[tokio::test(start_paused = true)]
    async fn cap_hit_stops_with_max_duration_even_with_no_guard_task_logic_beyond_the_signal() {
        let dir = tempfile::tempdir().unwrap();
        let (file, path) = rec_file(&dir);
        let capture = Arc::new(MockCapture::new());
        let sink = Arc::new(RecordingSink::new());
        let deps = test_deps(capture.clone(), sink.clone());

        let sessions = Arc::new(SessionGuard::new());
        let id = sessions.begin(Mode::Toggle).unwrap();
        capture.start(&path, 2).unwrap(); // cap_samples = 2: self-cap fires almost immediately
        capture.set_script(vec![LevelSample::new(0.5, 0.5); 10]);
        let handles = spawn(id.clone(), Mode::Toggle, file, deps, sessions.clone());
        sessions.attach_handles(&id, handles);

        let rx = sessions.outcome_receiver(&id).unwrap();
        for _ in 0..5 {
            capture.tick();
            tokio::time::advance(Duration::from_millis(250)).await;
            tokio::task::yield_now().await;
            if rx.borrow().is_some() {
                break;
            }
        }

        let outcome = drain_outcome(rx).await;
        assert_eq!(outcome.unwrap().guard_outcome, GuardOutcome::MaxDuration);
    }

    #[tokio::test(start_paused = true)]
    async fn hold_without_heartbeat_loses_lease_within_3s_and_deletes_file() {
        let dir = tempfile::tempdir().unwrap();
        let (file, path) = rec_file(&dir);
        let capture = Arc::new(MockCapture::new());
        let sink = Arc::new(RecordingSink::new());
        let deps = test_deps(capture.clone(), sink.clone());

        let sessions = Arc::new(SessionGuard::new());
        let id = sessions.begin(Mode::Hold).unwrap();
        capture.start(&path, 999_999).unwrap();
        // A long quiet-but-alive script: keeps the liveness check happy
        // (level_rx keeps ticking) so `StreamDied` (1s) can't preempt the
        // 3s lease-loss deadline this test is actually isolating.
        capture.set_script(vec![LevelSample::new(0.01, 0.01); 20]);
        let handles = spawn(id.clone(), Mode::Hold, file, deps, sessions.clone());
        sessions.attach_handles(&id, handles);

        let rx = sessions.outcome_receiver(&id).unwrap();
        for _ in 0..12 {
            capture.tick();
            tokio::time::advance(Duration::from_millis(250)).await;
            tokio::task::yield_now().await;
            if rx.borrow().is_some() {
                break;
            }
        }

        let outcome = drain_outcome(rx).await;

        assert_eq!(outcome.unwrap().guard_outcome, GuardOutcome::LeaseLost);
        assert!(!path.exists());
    }

    #[tokio::test(start_paused = true)]
    async fn stop_at_2_9s_without_heartbeat_finalizes_not_lease_lost() {
        let dir = tempfile::tempdir().unwrap();
        let (file, path) = rec_file(&dir);
        let capture = Arc::new(MockCapture::new());
        let sink = Arc::new(RecordingSink::new());
        let deps = test_deps(capture.clone(), sink.clone());

        let sessions = Arc::new(SessionGuard::new());
        let id = sessions.begin(Mode::Hold).unwrap();
        capture.start(&path, 999_999).unwrap();
        capture.set_script(vec![LevelSample::new(0.01, 0.01); 20]);
        let handles = spawn(id.clone(), Mode::Hold, file, deps, sessions.clone());
        sessions.attach_handles(&id, handles);

        // Keep the stream alive up to 2.9s (11 ticks * 250ms + 150ms) with
        // no heartbeat at all, then stop — must beat the 3.0s lease-loss
        // deadline.
        for _ in 0..11 {
            capture.tick();
            tokio::time::advance(Duration::from_millis(250)).await;
            tokio::task::yield_now().await;
        }
        tokio::time::advance(Duration::from_millis(150)).await;
        tokio::task::yield_now().await;
        let rx = sessions.signal(&id, ControlSignal::Stop).unwrap();
        let outcome = drain_outcome(rx).await;

        assert_eq!(outcome.unwrap().guard_outcome, GuardOutcome::Finalized, "a stop() at 2.9s must win the race against lease-loss at 3.0s");
    }

    #[tokio::test(start_paused = true)]
    async fn hold_release_hold_five_times_in_two_seconds_causes_zero_false_cancels() {
        // Rapid churn across independent sessions: each session gets its
        // own fresh LeaseTracker/task (lease.rs's per-session design), so
        // there is no stale timer from session N-1 to fire a false
        // LeaseLost for session N.
        for _ in 0..5 {
            let dir = tempfile::tempdir().unwrap();
            let (file, path) = rec_file(&dir);
            let capture = Arc::new(MockCapture::new());
            let sink = Arc::new(RecordingSink::new());
            let deps = test_deps(capture.clone(), sink.clone());

            let sessions = Arc::new(SessionGuard::new());
            let id = sessions.begin(Mode::Hold).unwrap();
            capture.start(&path, 999_999).unwrap();
            let handles = spawn(id.clone(), Mode::Hold, file, deps, sessions.clone());
            sessions.attach_handles(&id, handles);

            tokio::time::advance(Duration::from_millis(100)).await;
            tokio::task::yield_now().await;
            let rx = sessions.signal(&id, ControlSignal::Stop).unwrap();
            let outcome = drain_outcome(rx).await;
            assert_eq!(outcome.unwrap().guard_outcome, GuardOutcome::Finalized, "a quick hold-release must never be reported as LeaseLost");
        }
    }

    #[tokio::test] // real time — see happy_path's comment on `start_paused` + real HTTP.
    async fn cancel_during_transcribing_aborts_http_and_deletes_file() {
        let mut server = mockito::Server::new_async().await;
        let _mock = server
            .mock("POST", "/transcriptions")
            .with_status(200)
            .with_chunked_body(|_w| {
                std::thread::sleep(Duration::from_secs(3600));
                Ok(())
            })
            .create_async()
            .await;

        let dir = tempfile::tempdir().unwrap();
        let (file, path) = rec_file(&dir);
        let capture = Arc::new(MockCapture::new());
        let sink = Arc::new(RecordingSink::new());
        let mut deps = test_deps(capture.clone(), sink.clone());
        deps.app_config.api_url_override = Some(format!("{}/transcriptions", server.url()));
        deps.app_config.min_recording_ms = 0;

        let sessions = Arc::new(SessionGuard::new());
        let id = sessions.begin(Mode::Toggle).unwrap();
        capture.start(&path, 999_999).unwrap();
        let handles = spawn(id.clone(), Mode::Toggle, file, deps, sessions.clone());
        sessions.attach_handles(&id, handles);

        // Kick the pipeline into Transcribing.
        let _ = sessions.signal(&id, ControlSignal::Stop).unwrap();
        // Give the finalize task a chance to reach the point where it
        // has spawned the (now permanently hanging) HTTP call and stored
        // its abort handle — real (small) sleeps, not `yield_now`: this
        // step is real IO (connecting to the mockito socket) under real
        // time (`start_paused` isn't used in this test — see happy_path's
        // comment).
        for _ in 0..100 {
            tokio::time::sleep(Duration::from_millis(5)).await;
            if sessions.stage_of(&id) == Some(crate::session::Stage::Transcribing) && sessions.transcribe_abort_cell(&id).unwrap().lock().unwrap().is_some() {
                break;
            }
        }
        assert_eq!(sessions.stage_of(&id), Some(crate::session::Stage::Transcribing));

        if let Some(handle) = sessions.transcribe_abort_cell(&id).unwrap().lock().unwrap().take() {
            handle.abort();
        }

        let rx = sessions.outcome_receiver(&id).unwrap();
        let outcome = drain_outcome(rx).await;

        assert_eq!(outcome.unwrap().guard_outcome, GuardOutcome::Cancelled);
        assert!(!path.exists());
        assert!(!sessions.has_active());
    }

    #[tokio::test(start_paused = true)]
    async fn muted_sample_is_treated_as_silence_and_reported_muted() {
        let dir = tempfile::tempdir().unwrap();
        let (file, path) = rec_file(&dir);
        let capture = Arc::new(MockCapture::new());
        let sink = Arc::new(RecordingSink::new());
        let mut deps = test_deps(capture.clone(), sink.clone());
        deps.app_config.silence_timeout_ms = 300;

        let sessions = Arc::new(SessionGuard::new());
        let id = sessions.begin(Mode::Toggle).unwrap();
        capture.start(&path, 999_999).unwrap();
        capture.set_muted(true);
        capture.set_script(vec![LevelSample::new(0.9, 0.9); 60]); // loud, but muted must still read as silence
        let handles = spawn(id.clone(), Mode::Toggle, file, deps, sessions.clone());
        sessions.attach_handles(&id, handles);

        let rx = sessions.outcome_receiver(&id).unwrap();
        for _ in 0..50 {
            capture.tick();
            tokio::time::advance(Duration::from_millis(250)).await;
            tokio::task::yield_now().await;
            if rx.borrow().is_some() {
                break;
            }
        }
        let outcome = drain_outcome(rx).await;
        assert_eq!(outcome.unwrap().guard_outcome, GuardOutcome::SilenceTimeoutNoSpeech, "a muted-but-loud take must be treated as silence by the guard");
        assert_eq!(sink.last(LEVEL_EVENT).unwrap()["muted"], serde_json::json!(true));
    }

    /// `[ADO-8]` regression, stop side: `finalize` must run
    /// `AudioCapture::stop` off the spawned session task's tokio worker
    /// thread (`spawn_blocking`), same reasoning as the `do_start` test in
    /// `commands.rs` -- `CpalCapture::stop()` can block up to
    /// `LEVEL_INTERVAL` joining its level thread (`desktop.rs`), and no
    /// `AudioCapture::stop` implementation is contractually guaranteed
    /// non-blocking.
    #[tokio::test(flavor = "multi_thread", worker_threads = 1)]
    async fn finalize_runs_capture_stop_off_the_async_worker_thread() {
        struct ThreadRecordingCapture {
            inner: MockCapture,
            thread_id: StdMutex<Option<std::thread::ThreadId>>,
        }
        impl AudioCapture for ThreadRecordingCapture {
            fn start(&self, path: &Path, cap_samples: usize) -> Result<(), crate::capture::CaptureError> {
                self.inner.start(path, cap_samples)
            }
            fn stop(&self) -> Result<crate::capture::CaptureStats, crate::capture::CaptureError> {
                *self.thread_id.lock().unwrap() = Some(std::thread::current().id());
                self.inner.stop()
            }
            fn level_rx(&self) -> watch::Receiver<Option<LevelSample>> {
                self.inner.level_rx()
            }
        }

        let async_worker_thread_id = tokio::spawn(async { std::thread::current().id() }).await.unwrap();

        let dir = tempfile::tempdir().unwrap();
        let (file, path) = rec_file(&dir);
        let capture = Arc::new(ThreadRecordingCapture { inner: MockCapture::new(), thread_id: StdMutex::new(None) });
        capture.start(&path, 999_999).unwrap();
        let sink = Arc::new(RecordingSink::new());
        let secrets = Arc::new(InMemorySecretStore::new());
        secrets.set(API_KEY_SECRET_NAME, &Secret::new("test-key")).unwrap();
        let app_config = AppConfig { silence_timeout_ms: 0, min_recording_ms: 3_600_000, ..AppConfig::default() };
        let deps = PipelineDeps { capture: capture.clone(), secrets, events: sink, app_config, dictionary: Vec::new() };

        let sessions = Arc::new(SessionGuard::new());
        let id = sessions.begin(Mode::Toggle).unwrap();
        let handles = spawn(id.clone(), Mode::Toggle, file, deps, sessions.clone());
        sessions.attach_handles(&id, handles);

        let rx = sessions.signal(&id, ControlSignal::Stop).unwrap();
        let _ = drain_outcome(rx).await;

        let stop_thread_id = capture.thread_id.lock().unwrap().unwrap();
        assert_ne!(
            stop_thread_id, async_worker_thread_id,
            "AudioCapture::stop() must run on a spawn_blocking thread, not the single async worker thread"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn capture_stop_error_lets_the_next_start_succeed() {
        let dir = tempfile::tempdir().unwrap();
        let (file, path) = rec_file(&dir);
        let capture = Arc::new(MockCapture::new());
        let sink = Arc::new(RecordingSink::new());
        let deps = test_deps(capture.clone(), sink.clone());

        let sessions = Arc::new(SessionGuard::new());
        let id = sessions.begin(Mode::Toggle).unwrap();
        capture.start(&path, 999_999).unwrap();
        capture.set_ignore_stop(true);
        let handles = spawn(id.clone(), Mode::Toggle, file, deps, sessions.clone());
        sessions.attach_handles(&id, handles);

        let rx = sessions.signal(&id, ControlSignal::Stop).unwrap();
        let outcome = drain_outcome(rx).await;
        assert!(outcome.is_err(), "the pipeline still reports the capture failure to the caller");

        // But the backend itself must have been reset, not left "running".
        let other_dir = tempfile::tempdir().unwrap();
        assert!(capture.start(&other_dir.path().join("next.wav"), 999_999).is_ok(), "a subsequent start() must succeed after capture.stop() failed");
    }

    /// A capture backend whose `stop()` panics.
    ///
    /// **What this actually exercises now (hardening-sweep review
    /// minor):** `finalize` runs `capture.stop()` inside
    /// `tokio::task::spawn_blocking` (`[ADO-8]`), so this panic no
    /// longer unwinds through `finalize`/the pipeline task itself --
    /// tokio catches it on the blocking-pool thread and hands `finalize`
    /// an ordinary `JoinError`, which `unwrap_or_else` turns into a
    /// normal `Err(CaptureError::Backend(..))` (see `finalize`'s
    /// `stop_result` handling). `finalize` therefore runs to completion
    /// exactly like any other capture-stop failure (`capture_stop_error_
    /// lets_the_next_start_succeed`): it calls `sessions.end(&id)`
    /// itself and publishes a real outcome, never triggering
    /// `SessionSlotGuard::drop`'s panic-recovery path at all. This test
    /// still legitimately covers "a `stop()` failure -- including one
    /// that started life as a panic on some other thread -- must not
    /// wedge the single-flight slot", just via the ordinary cleanup path
    /// rather than the unwind-safety net; the sibling test right after
    /// it (`a_panic_inside_finalizes_own_body_outside_spawn_blocking_
    /// still_frees_the_session_slot`) exercises a REAL unwind through
    /// `finalize`'s own body to keep `SessionSlotGuard::drop` itself
    /// under test.
    struct PanicOnStopCapture {
        inner: MockCapture,
    }

    impl AudioCapture for PanicOnStopCapture {
        fn start(&self, path: &Path, cap_samples: usize) -> Result<(), crate::capture::CaptureError> {
            self.inner.start(path, cap_samples)
        }
        fn stop(&self) -> Result<crate::capture::CaptureStats, crate::capture::CaptureError> {
            panic!("simulated capture backend panic during stop()");
        }
        fn level_rx(&self) -> tokio::sync::watch::Receiver<Option<LevelSample>> {
            self.inner.level_rx()
        }
    }

    #[tokio::test]
    async fn a_panic_inside_finalize_still_frees_the_session_slot() {
        let dir = tempfile::tempdir().unwrap();
        let (file, path) = rec_file(&dir);
        let capture: Arc<dyn AudioCapture> = Arc::new(PanicOnStopCapture { inner: MockCapture::new() });
        let sink: Arc<RecordingSink> = Arc::new(RecordingSink::new());
        let secrets = Arc::new(InMemorySecretStore::new());
        let app_config = AppConfig { silence_timeout_ms: 0, min_recording_ms: 3_600_000, ..AppConfig::default() };
        let deps = PipelineDeps { capture: capture.clone(), secrets, events: sink, app_config, dictionary: Vec::new() };

        let sessions = Arc::new(SessionGuard::new());
        let id = sessions.begin(Mode::Toggle).unwrap();
        capture.start(&path, 999_999).unwrap();
        let handles = spawn(id.clone(), Mode::Toggle, file, deps, sessions.clone());
        sessions.attach_handles(&id, handles);

        let mut outcome_rx = sessions.signal(&id, ControlSignal::Stop).unwrap();
        // As of `[ADO-8]` (see `PanicOnStopCapture`'s own doc comment
        // above), `capture.stop()`'s panic is caught inside
        // `spawn_blocking` and surfaced to `finalize` as an ordinary
        // `JoinError` -> `Err` -- `finalize` runs to completion and
        // publishes a real outcome through the normal path, it does not
        // panic/get torn down itself. The loop below still tolerates
        // the sender-dropped-without-publishing case for robustness, but
        // the normal branch (`outcome_rx.borrow().is_some()`) is what
        // actually fires here now.
        loop {
            if outcome_rx.borrow().is_some() {
                break;
            }
            if outcome_rx.changed().await.is_err() {
                break; // sender dropped without publishing -- not expected on this path any more, tolerated defensively.
            }
        }

        assert!(!sessions.has_active(), "a capture.stop() panic (caught as a JoinError) must still free the single-flight slot");
        let second = sessions.begin(Mode::Toggle);
        assert!(second.is_ok(), "a subsequent start() must succeed after the panic");
    }

    /// An `EventSink` that panics when `finalize` emits `voxis://state:
    /// idle` -- that `deps.events.emit(...)` call runs directly inside
    /// `finalize`'s own async body (never wrapped in `spawn_blocking`),
    /// and happens BEFORE `finalize`'s own `sessions.end(&id)` cleanup
    /// call further down. A panic here is a genuine unwind through
    /// `finalize` and the outer `tokio::spawn`'d pipeline task, so the
    /// slot can only end up freed via `SessionSlotGuard::drop` (`spawn`'s
    /// own doc comment / review finding F4) -- unlike
    /// `PanicOnStopCapture` above, which (post-`[ADO-8]`) no longer
    /// exercises that path at all.
    struct PanicOnIdleStateSink;

    impl EventSink for PanicOnIdleStateSink {
        fn emit(&self, event: &str, payload: serde_json::Value) {
            if event == STATE_EVENT && payload == serde_json::json!("idle") {
                panic!("simulated panic inside finalize's own body, outside spawn_blocking");
            }
        }
    }

    #[tokio::test]
    async fn a_panic_inside_finalizes_own_body_outside_spawn_blocking_still_frees_the_session_slot() {
        let dir = tempfile::tempdir().unwrap();
        let (file, path) = rec_file(&dir);
        let capture: Arc<dyn AudioCapture> = Arc::new(MockCapture::new());
        let sink: Arc<dyn EventSink> = Arc::new(PanicOnIdleStateSink);
        let secrets = Arc::new(InMemorySecretStore::new());
        let app_config = AppConfig { silence_timeout_ms: 0, min_recording_ms: 3_600_000, ..AppConfig::default() };
        let deps = PipelineDeps { capture: capture.clone(), secrets, events: sink, app_config, dictionary: Vec::new() };

        let sessions = Arc::new(SessionGuard::new());
        let id = sessions.begin(Mode::Toggle).unwrap();
        capture.start(&path, 999_999).unwrap();
        let handles = spawn(id.clone(), Mode::Toggle, file, deps, sessions.clone());
        sessions.attach_handles(&id, handles);

        let mut outcome_rx = sessions.signal(&id, ControlSignal::Stop).unwrap();
        // This time the panic genuinely unwinds `finalize`/the pipeline
        // task -- `finalize` never reaches its own `outcome_tx.send`, so
        // the sender is simply dropped without publishing.
        loop {
            if outcome_rx.borrow().is_some() {
                break;
            }
            if outcome_rx.changed().await.is_err() {
                break; // sender dropped without publishing -- expected here.
            }
        }

        assert!(!sessions.has_active(), "a panic inside finalize's own body (outside spawn_blocking) must still free the slot via SessionSlotGuard::drop");
        assert!(sessions.begin(Mode::Toggle).is_ok(), "a subsequent start() must succeed after the panic");
    }

    // ---- Round-2 review, F2 scenario A/B: deterministic TOCTOU races ----
    //
    // Both tests below deliberately block a REAL OS thread inside a
    // synchronous trait method (`AudioCapture::stop`/`SecretStore::get`)
    // to pin down the exact window `SessionHandles::cancelled` closes --
    // that requires the multi-thread test runtime (a single-thread
    // runtime would deadlock: the same thread would need to both run the
    // blocking call and poll the test task that eventually unblocks it).
    // The "ready"/"release" handshake uses a non-blocking
    // `tokio::sync::oneshot::Sender::send` (safe from any context) paired
    // with a plain `std::sync::mpsc::Receiver::recv()` (a real blocking
    // wait, deliberately NOT `tokio::sync::oneshot`'s own `blocking_recv`,
    // which panics if called from inside a runtime worker thread) -- no
    // sleeps anywhere, fully latch-driven.

    /// Blocks `stop()` on a real channel -- see the module comment above.
    struct BlockingStopCapture {
        inner: Arc<MockCapture>,
        ready_tx: StdMutex<Option<tokio::sync::oneshot::Sender<()>>>,
        release_rx: StdMutex<Option<std::sync::mpsc::Receiver<()>>>,
    }

    impl AudioCapture for BlockingStopCapture {
        fn start(&self, path: &Path, cap_samples: usize) -> Result<(), crate::capture::CaptureError> {
            self.inner.start(path, cap_samples)
        }
        fn stop(&self) -> Result<crate::capture::CaptureStats, crate::capture::CaptureError> {
            if let Some(tx) = self.ready_tx.lock().unwrap().take() {
                let _ = tx.send(());
            }
            if let Some(rx) = self.release_rx.lock().unwrap().take() {
                let _ = rx.recv();
            }
            self.inner.stop()
        }
        fn level_rx(&self) -> tokio::sync::watch::Receiver<Option<LevelSample>> {
            self.inner.level_rx()
        }
    }

    /// Scenario A: the guard's OWN trigger (self-cap here, for a
    /// same-tick deterministic fire -- `MockCapture`'s self-cap needs
    /// only 1 sample, unlike silence timeout's 40-poll window) races a
    /// `cancel()` that arrives while `finalize` is parked inside
    /// `capture.stop()` -- i.e. AFTER the Recording-phase `select!` loop
    /// has already broken out on its own and stopped listening for
    /// `ControlSignal`, but BEFORE `mark_transcribing` runs. `request_cancel`
    /// must therefore see `Stage::Recording` and send a signal into a
    /// channel nobody is reading anymore -- the `cancelled` flag is what
    /// actually saves this case, not the signal.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cancel_races_the_guards_own_finalize_scenario_a() {
        let mut server = mockito::Server::new_async().await;
        let mock_endpoint = server.mock("POST", "/transcriptions").expect(0).create_async().await;

        let dir = tempfile::tempdir().unwrap();
        let (file, path) = rec_file(&dir);
        let mock_capture = Arc::new(MockCapture::new());
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel::<()>();
        let capture: Arc<dyn AudioCapture> = Arc::new(BlockingStopCapture {
            inner: mock_capture.clone(),
            ready_tx: StdMutex::new(Some(ready_tx)),
            release_rx: StdMutex::new(Some(release_rx)),
        });
        let sink = Arc::new(RecordingSink::new());
        let secrets: Arc<dyn SecretStore> = Arc::new(InMemorySecretStore::new());
        secrets.set(API_KEY_SECRET_NAME, &Secret::new("test-key")).unwrap();
        let app_config = AppConfig {
            api_url_override: Some(format!("{}/transcriptions", server.url())),
            min_recording_ms: 0,
            silence_timeout_ms: 0,
            ..AppConfig::default()
        };
        let deps = PipelineDeps { capture: capture.clone(), secrets, events: sink.clone(), app_config, dictionary: Vec::new() };

        let sessions = Arc::new(SessionGuard::new());
        let id = sessions.begin(Mode::Toggle).unwrap();
        capture.start(&path, 1).unwrap(); // cap_samples = 1: self-cap fires on the very first sample
        mock_capture.set_script(vec![LevelSample::new(0.5, 0.5)]);
        // Ticking BEFORE `spawn()` still reaches the session's `level_rx`:
        // `MockCapture::level_rx()` clones its own never-advanced template
        // receiver on every call, so any clone taken later still reports
        // `has_changed() == true` for a send that already happened --
        // there is no scheduling race to win here, `tokio::time::interval`'s
        // documented "first tick completes immediately" does the rest
        // deterministically once the task is polled.
        mock_capture.tick();
        let handles = spawn(id.clone(), Mode::Toggle, file, deps, sessions.clone());
        sessions.attach_handles(&id, handles);

        ready_rx.await.unwrap();
        assert_eq!(
            sessions.stage_of(&id),
            Some(crate::session::Stage::Recording),
            "finalize must be parked in capture.stop() before mark_transcribing -- otherwise this isn't exercising the race"
        );

        assert!(sessions.request_cancel(&id));

        // Grab the outcome receiver BEFORE releasing the block: once
        // released, the pipeline task (on the other worker thread) can
        // run finalize -> `sessions.end(&id)` and free the handles before
        // this thread gets scheduled again, making `outcome_receiver`
        // return `None` -- a `watch::Receiver` clone retains the latest
        // value regardless of when it was obtained, so grabbing it early
        // doesn't miss anything.
        let rx = sessions.outcome_receiver(&id).unwrap();

        release_tx.send(()).unwrap();

        let outcome = drain_outcome(rx).await;
        let result = outcome.unwrap();
        assert_eq!(result.guard_outcome, GuardOutcome::Cancelled);
        assert_eq!(result.text, "");
        assert!(!path.exists(), "the rec file must be deleted");
        assert!(!sessions.has_active());
        mock_endpoint.assert_async().await;
        assert_eq!(sink.last(RESULT_EVENT).unwrap()["text"], serde_json::json!(""));
    }

    /// Blocks `SecretStore::get()` on a real channel -- see the module
    /// comment above.
    struct BlockingSecretStore {
        inner: InMemorySecretStore,
        ready_tx: StdMutex<Option<tokio::sync::oneshot::Sender<()>>>,
        release_rx: StdMutex<Option<std::sync::mpsc::Receiver<()>>>,
    }

    impl crate::secrets::SecretStore for BlockingSecretStore {
        fn get(&self, name: &str) -> crate::secrets::SecretResult<Option<Secret>> {
            if let Some(tx) = self.ready_tx.lock().unwrap().take() {
                let _ = tx.send(());
            }
            if let Some(rx) = self.release_rx.lock().unwrap().take() {
                let _ = rx.recv();
            }
            self.inner.get(name)
        }
        fn set(&self, name: &str, value: &Secret) -> crate::secrets::SecretResult<()> {
            self.inner.set(name, value)
        }
        fn delete(&self, name: &str) -> crate::secrets::SecretResult<()> {
            self.inner.delete(name)
        }
    }

    /// Scenario B: `cancel()` arrives while `run_transcription` is parked
    /// inside `SecretStore::get()` -- after `mark_transcribing` (stage is
    /// already `Transcribing`), but before `abort_cell` has anything in
    /// it for `request_cancel`'s `Transcribing` branch to grab. Exercises
    /// the extra `cancelled` re-check this round added right after
    /// `secrets.get()` returns (without it, execution would fall through
    /// to build the client and fire the real HTTP request).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cancel_while_secret_lookup_is_in_flight_scenario_b() {
        let mut server = mockito::Server::new_async().await;
        let mock_endpoint = server.mock("POST", "/transcriptions").expect(0).create_async().await;

        let dir = tempfile::tempdir().unwrap();
        let (file, path) = rec_file(&dir);
        let capture = Arc::new(MockCapture::new());
        let sink: Arc<RecordingSink> = Arc::new(RecordingSink::new());

        let inner_secrets = InMemorySecretStore::new();
        inner_secrets.set(API_KEY_SECRET_NAME, &Secret::new("test-key")).unwrap();
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel::<()>();
        let secrets: Arc<dyn SecretStore> = Arc::new(BlockingSecretStore {
            inner: inner_secrets,
            ready_tx: StdMutex::new(Some(ready_tx)),
            release_rx: StdMutex::new(Some(release_rx)),
        });

        let app_config = AppConfig {
            api_url_override: Some(format!("{}/transcriptions", server.url())),
            min_recording_ms: 0,
            silence_timeout_ms: 0,
            ..AppConfig::default()
        };
        let deps = PipelineDeps { capture: capture.clone(), secrets, events: sink.clone(), app_config, dictionary: Vec::new() };

        let sessions = Arc::new(SessionGuard::new());
        let id = sessions.begin(Mode::Toggle).unwrap();
        capture.start(&path, 999_999).unwrap();
        let handles = spawn(id.clone(), Mode::Toggle, file, deps, sessions.clone());
        sessions.attach_handles(&id, handles);

        let _ = sessions.signal(&id, ControlSignal::Stop).unwrap();

        ready_rx.await.unwrap();
        assert_eq!(sessions.stage_of(&id), Some(crate::session::Stage::Transcribing));
        let abort_cell = sessions.transcribe_abort_cell(&id).unwrap();
        assert!(abort_cell.lock().unwrap().is_none(), "abort_cell must still be empty -- the HTTP task hasn't been spawned yet");

        assert!(sessions.request_cancel(&id));

        // Grab the outcome receiver BEFORE releasing the block -- see the
        // matching comment in `cancel_races_the_guards_own_finalize_scenario_a`.
        let rx = sessions.outcome_receiver(&id).unwrap();

        release_tx.send(()).unwrap();

        let outcome = drain_outcome(rx).await;
        let result = outcome.unwrap();
        assert_eq!(result.guard_outcome, GuardOutcome::Cancelled);
        assert_eq!(result.text, "");
        assert!(!path.exists(), "the rec file must be deleted");
        assert!(!sessions.has_active());
        mock_endpoint.assert_async().await;
        assert_eq!(sink.last(RESULT_EVENT).unwrap()["text"], serde_json::json!(""));
    }
}
