//! `AudioCapture` trait (desktop `CpalCapture`/Task 4 and iOS Swift
//! bridge/Task 8 both implement this), the `rec/` scratch-directory
//! helpers every capture backend writes into, and `MockCapture` — the
//! only implementation this task ships.

use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tokio::sync::watch;

/// One RMS/peak measurement of the input signal, pushed onto
/// `AudioCapture::level_rx` roughly every 250 ms while a capture runs.
///
/// `muted` (Task 3b, `[R1-Safety T3]`/`[R1-iOS C3]`): `true` when the
/// backend detects the input is muted (iOS system mic-mute button,
/// desktop equivalent) — flows straight through to the `voxis://level`
/// event's own `muted` field for an immediate UI reaction, and
/// `guard_adapter` treats it as silence (zeroes the peak it feeds
/// `guard_step`) regardless of the actual (zero) signal, so a muted take
/// behaves exactly like a silent one for the guard's timeout/NoSpeech
/// logic instead of needing its own parallel decision path.
///
/// `cap_hit` (`[R1-Arch S2]`, self-cap): `true` once the backend's own
/// `cap_samples` ceiling (passed to `start`) has been reached —
/// independent of whether anything is still polling `level_rx` (a real
/// cpal callback / Swift tap enforces this in its own thread; `MockCapture`
/// mirrors that by refusing to advance past `cap_samples` in `tick()`).
/// `guard_adapter`'s poll loop treats a `cap_hit` sample as an immediate
/// `MaxDuration` stop, same as `guard_step`'s own `cap_hit` parameter —
/// the backstop is honoured even if the async guard task that would
/// otherwise notice `elapsed_ms >= max` were somehow never spawned.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LevelSample {
    pub rms: f32,
    pub peak: f32,
    pub muted: bool,
    pub cap_hit: bool,
}

impl LevelSample {
    /// Convenience constructor for scripting `MockCapture` in tests —
    /// `muted`/`cap_hit` default `false` (both are actually overwritten by
    /// `MockCapture::tick()` from its own knobs/self-cap state at emit
    /// time regardless of what's scripted here, so a literal's values for
    /// those two fields would be misleading busywork to fill in by hand).
    pub fn new(rms: f32, peak: f32) -> Self {
        Self { rms, peak, muted: false, cap_hit: false }
    }
}

/// `stop()`'s result — enough for the (stub, Task 3; real, Task 3b)
/// pipeline to build a `DictationResult` without re-reading the WAV file.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct CaptureStats {
    pub duration_ms: u64,
    pub samples: usize,
    pub peak_rms: f32,
}

#[derive(Debug, thiserror::Error)]
pub enum CaptureError {
    #[error("capture already running")]
    AlreadyRunning,
    #[error("capture not running")]
    NotRunning,
    /// Microphone permission denied by the OS -- iOS's `AVAudioApplication`/
    /// `AVAudioSession` record-permission check (`mobile.rs::map_invoke_error`
    /// maps the Swift `PERMISSION_DENIED` reject code here); desktop has no
    /// equivalent runtime prompt today, so only the iOS backend constructs
    /// this variant. Kept distinct from `Backend` so `PluginError::from`
    /// (`error.rs`) can surface it under the SAME `permissionDenied` `kind`
    /// tag desktop's own `PluginError::PermissionDenied` (hotkey OS
    /// permission, `hotkey_desktop.rs`) already uses, instead of the
    /// frontend needing two different error shapes for "OS said no".
    #[error("capture permission denied: {0}")]
    PermissionDenied(String),
    #[error("capture backend error: {0}")]
    Backend(String),
}

/// Desktop `cpal` (Task 4) / iOS `AVAudioEngine` (Task 8) capture bridge.
/// Contract fixed here so both backends and the pipeline (Task 3b) share
/// one shape:
///
/// - `start`/`stop` write/finish a single WAV file at a caller-chosen path
///   (plan decision 3: file, not stream); `cap_samples` is the backend's
///   own **self-cap**, independent of any guard task above it — the
///   audio callback must stop writing on its own once it reaches this
///   many samples even if `stop()` is never called (`[R1-Arch S2]`,
///   mirrors desktop Voxis's `native_cap_samples`).
/// - `level_rx` returns a `tokio::sync::watch::Receiver` rather than an
///   `mpsc` one: level updates are a *current value* the overlay reads at
///   its own pace, not an ordered queue the pipeline must fully drain —
///   `watch` naturally coalesces bursts instead of piling up an unbounded
///   backlog behind a slow consumer. It doubles as this contract's
///   **liveness** signal (`[R1-Arch S3]`): the plan defines "no tick for
///   4 polls while running" as `StreamDied` — with `watch`, that means
///   `Receiver::changed()` not resolving within ~4 poll intervals
///   (~1s at the 250ms cadence above) while the session is still
///   `Recording`. Task 3b's `guard_adapter.rs` implements that poll; this
///   trait only fixes the channel type it polls.
pub trait AudioCapture: Send + Sync {
    /// Start writing 16 kHz mono WAV samples to `path`. `cap_samples` is
    /// always expressed in samples **at 16 kHz** (`voxis_core::audio_wav::
    /// TRANSCRIPTION_SAMPLE_RATE`), regardless of whatever native rate a
    /// given backend actually records at — `commands.rs`'s `do_start`
    /// computes it via `voxis_core::guard::native_cap_samples(..,
    /// TRANSCRIPTION_SAMPLE_RATE)` before any backend's `start()` runs, so
    /// it cannot know the real device rate yet. A backend recording at a
    /// different native rate (desktop's `CpalCapture`) must rescale this
    /// value internally once its own rate is known before comparing a
    /// sample count against it (see `desktop::pure::scale_cap_samples`); a
    /// backend whose own output is already fixed at 16 kHz before this
    /// self-cap check ever runs (iOS's `AVAudioConverter` output, Task 8)
    /// needs no such scaling and can compare directly.
    fn start(&self, path: &Path, cap_samples: usize) -> Result<(), CaptureError>;
    /// Stop and finalize the WAV file, returning capture statistics.
    fn stop(&self) -> Result<CaptureStats, CaptureError>;
    /// Current level channel — `None` until the first sample after `start`.
    fn level_rx(&self) -> watch::Receiver<Option<LevelSample>>;
    /// Force the backend back to a known-idle state after a `stop()` that
    /// returned `Err` (Task 3b `[ADO-2/3 minors]`, "for 3b": `do_stop`
    /// must not leave the backend internally "running" just because the
    /// plugin's own session slot was already freed — without this, the
    /// *next* `start()` would fail with `CaptureError::AlreadyRunning`
    /// even though nothing in the plugin thinks a session is active).
    /// Default no-op: a backend whose `stop()` can't fail (or that
    /// already self-recovers) needs nothing here.
    fn reset(&self) {}

    /// Select the input device by platform-specific id/name for the
    /// *next* `start()` (Task 6b / `[HW-GATE finding]`: a profile's
    /// `ProfileConfig::audio_device` must steer capture away from
    /// whatever the system default input device happens to be — on this
    /// hardware that default is a lavalier mic that records zeros).
    /// `desktop::CpalCapture` overrides this to update the device its own
    /// `start()` re-reads fresh every call, so a call here takes effect
    /// starting with the very next session, no restart required.
    /// Default no-op: backends with no device-selection concept (iOS's
    /// `AVAudioEngine` bridge — `.record` category always uses the
    /// system input, Task 8's own doc) simply ignore it; `MockCapture`
    /// overrides it too, purely to make the wiring
    /// (`profile_source::refresh_pipeline_config` calling this after
    /// every profile import/apply) assertable in tests without a real
    /// `CpalCapture`.
    fn set_device_id(&self, _device_id: &str) {}
}

/// `<host-cache>/voxis-plugin/rec/` — the plugin's dedicated scratch
/// directory for in-flight WAV recordings (plan decision 3). Every file
/// directly inside it is either the one `RecFile` an active session
/// currently owns, or an orphan left by a crash/SIGKILL mid-recording —
/// `sweep()` (called unconditionally from `lib.rs`'s plugin `setup`,
/// `[R1-Safety S5]`) treats it as such and deletes it.
pub struct RecDir {
    dir: PathBuf,
}

impl RecDir {
    pub fn new(base: PathBuf) -> Self {
        Self { dir: base.join("voxis-plugin").join("rec") }
    }

    pub fn path(&self) -> &Path {
        &self.dir
    }

    /// Delete every file directly inside the rec dir (subdirectories, if
    /// any ever appear, are left alone — nothing in this contract creates
    /// one). Creates the directory if it doesn't exist yet (first run);
    /// never errors just because there was nothing to sweep.
    pub fn sweep(&self) -> std::io::Result<()> {
        match fs::read_dir(&self.dir) {
            Ok(entries) => {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() {
                        // `[ADO-2/3]`: a per-file removal failure (e.g. an
                        // unreadable/permission-denied orphan) must not be
                        // swallowed silently — it's exactly the kind of
                        // leftover audio file this sweep exists to catch,
                        // so a failure to actually delete it deserves a
                        // loud `warn!` with the path, not a mystery orphan
                        // that quietly survives every future startup.
                        if let Err(e) = fs::remove_file(&path) {
                            tracing::warn!(path = %path.display(), error = %e, "RecDir::sweep: failed to delete orphaned rec file");
                        }
                    }
                }
                Ok(())
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => fs::create_dir_all(&self.dir),
            Err(e) => Err(e),
        }
    }

    /// A fresh `<uuid>.wav` path inside the rec dir for a new session.
    /// Does not create the file — pass the result to `RecFile::create`.
    pub fn new_session_path(&self) -> PathBuf {
        self.dir.join(format!("{}.wav", uuid::Uuid::new_v4()))
    }
}

/// Owns exactly one path inside a `RecDir`; deletes it on `Drop`
/// regardless of outcome (successful result, cancel, `NoSpeech` discard,
/// error) — plan decision 3 / `[R1-Safety S5]`. Capture backends write
/// through `RecFile::path()`; the WAV file itself is created (and, on
/// `cfg(unix)`, chmod'd 0600) up front so the permission is in place
/// before any audio is written to it, not applied after the fact.
pub struct RecFile {
    path: PathBuf,
}

impl RecFile {
    /// Creates the parent directory (if missing) and an empty 0600
    /// (desktop `unix`) file at `path`. On unix the 0600 mode is applied
    /// atomically as part of `open(2)`'s `O_CREAT` (`OpenOptions::mode`),
    /// not via a separate `create()` + `set_permissions()` pair — the
    /// latter leaves a window, however brief, where the (about to hold a
    /// user's dictation audio) file exists with the process's default
    /// umask-derived permissions before the chmod lands.
    pub fn create(path: PathBuf) -> std::io::Result<Self> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(&path)?;
        }
        #[cfg(not(unix))]
        {
            fs::File::create(&path)?;
        }
        Ok(Self { path })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for RecFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

#[derive(Debug, Clone)]
struct MockCaptureState {
    running: bool,
    script: VecDeque<LevelSample>,
    fixture_wav: Option<PathBuf>,
    die_silently: bool,
    ignore_stop: bool,
    started_path: Option<PathBuf>,
    peak_rms: f32,
    samples_written: usize,
    /// The `cap_samples` argument the most recent `start()` was given —
    /// `tick()`'s self-cap ceiling (`[R1-Arch S2]`).
    cap_samples: usize,
    /// Set once `samples_written` has reached `cap_samples`; every
    /// scripted sample emitted from that point on carries
    /// `cap_hit: true`, and `tick()` stops advancing the script (mirrors
    /// a real backend that stops writing once its buffer is full).
    cap_hit: bool,
    /// The `muted` knob (Task 3b `[R1-Safety T3]`) — forced onto every
    /// emitted `LevelSample` regardless of the scripted rms/peak.
    muted: bool,
    /// Last value `set_device_id` was called with (Task 6b) — `None`
    /// until the first call, purely a test-observability knob (a real
    /// backend has no such getter; nothing about capture behaviour reads
    /// this field back).
    device_id: Option<String>,
}

impl Default for MockCaptureState {
    fn default() -> Self {
        Self {
            running: false,
            script: VecDeque::new(),
            fixture_wav: None,
            die_silently: false,
            ignore_stop: false,
            started_path: None,
            peak_rms: 0.0,
            samples_written: 0,
            cap_samples: usize::MAX,
            cap_hit: false,
            muted: false,
            device_id: None,
        }
    }
}

/// Test/tracer-bullet double for `AudioCapture`.
///
/// - Replays a scripted sequence of RMS/peak windows over `level_rx`, one
///   window per explicit `tick()` call (deterministic — no background
///   thread/timer, unlike the real backends) so tests control exactly
///   when each sample lands.
/// - `stop()` copies a fixture WAV to the requested path if one was set
///   via `set_fixture_wav`, so downstream pipeline code (Task 3b) can
///   read a real, playable file back.
/// - `set_die_silently(true)` makes `tick()` a no-op while `is_running()`
///   still reports `true` — the liveness/`StreamDied` test double
///   (`[R1-Arch S3]`).
/// - `set_ignore_stop(true)` makes `stop()` return a `Backend` error
///   instead of actually stopping — the "capture ignores stop"
///   single-flight/lease test double.
pub struct MockCapture {
    state: Mutex<MockCaptureState>,
    tx: watch::Sender<Option<LevelSample>>,
    rx: watch::Receiver<Option<LevelSample>>,
}

impl MockCapture {
    pub fn new() -> Self {
        let (tx, rx) = watch::channel(None);
        Self { state: Mutex::new(MockCaptureState::default()), tx, rx }
    }

    /// Sets the RMS/peak windows `tick()` will replay in order.
    pub fn set_script(&self, samples: Vec<LevelSample>) {
        self.state.lock().unwrap().script = samples.into_iter().collect();
    }

    /// Sets a WAV fixture path `stop()` copies to the requested output
    /// path. Without one, `stop()` leaves the (already-created, via
    /// `RecFile`) output file as-is — an empty/zero-byte WAV.
    pub fn set_fixture_wav(&self, path: PathBuf) {
        self.state.lock().unwrap().fixture_wav = Some(path);
    }

    pub fn set_die_silently(&self, die: bool) {
        self.state.lock().unwrap().die_silently = die;
    }

    pub fn set_ignore_stop(&self, ignore: bool) {
        self.state.lock().unwrap().ignore_stop = ignore;
    }

    /// The muted knob (`[R1-Safety T3]`): every sample `tick()` emits from
    /// now on carries `muted` as given, until changed again.
    pub fn set_muted(&self, muted: bool) {
        self.state.lock().unwrap().muted = muted;
    }

    /// Pushes the next scripted sample onto `level_rx`. No-op (and, in
    /// particular, no tick observed by watchers) once `die_silently` is
    /// set, the script is exhausted, the capture isn't running, or the
    /// self-cap has already been hit (`[R1-Arch S2]` — a real backend
    /// stops writing once its buffer is full, independent of anything
    /// still polling `level_rx`) — mirroring a backend whose callback
    /// stopped firing while `is_recording()` still returns `true`.
    pub fn tick(&self) {
        let mut state = self.state.lock().unwrap();
        if !state.running || state.die_silently || state.cap_hit {
            return;
        }
        if let Some(mut sample) = state.script.pop_front() {
            state.peak_rms = state.peak_rms.max(sample.peak);
            state.samples_written += 1;
            if state.samples_written >= state.cap_samples {
                state.cap_hit = true;
            }
            sample.muted = state.muted;
            sample.cap_hit = state.cap_hit;
            let _ = self.tx.send(Some(sample));
        }
    }

    pub fn cap_hit(&self) -> bool {
        self.state.lock().unwrap().cap_hit
    }

    pub fn is_running(&self) -> bool {
        self.state.lock().unwrap().running
    }

    /// The last value `set_device_id` (`AudioCapture`'s trait method) was
    /// called with, if any — what Task 6b's `import_from_desktop_sets_
    /// capture_device_from_profile` test asserts against.
    pub fn device_id(&self) -> Option<String> {
        self.state.lock().unwrap().device_id.clone()
    }
}

impl Default for MockCapture {
    fn default() -> Self {
        Self::new()
    }
}

impl AudioCapture for MockCapture {
    fn start(&self, path: &Path, cap_samples: usize) -> Result<(), CaptureError> {
        let mut state = self.state.lock().unwrap();
        if state.running {
            return Err(CaptureError::AlreadyRunning);
        }
        state.running = true;
        state.started_path = Some(path.to_path_buf());
        state.peak_rms = 0.0;
        state.samples_written = 0;
        state.cap_samples = cap_samples;
        state.cap_hit = false;
        let _ = self.tx.send(None);
        Ok(())
    }

    fn stop(&self) -> Result<CaptureStats, CaptureError> {
        let mut state = self.state.lock().unwrap();
        if state.ignore_stop {
            return Err(CaptureError::Backend("stop ignored (test double)".to_string()));
        }
        if !state.running {
            return Err(CaptureError::NotRunning);
        }
        state.running = false;
        if let (Some(fixture), Some(dest)) = (state.fixture_wav.clone(), state.started_path.clone()) {
            fs::copy(&fixture, &dest)
                .map_err(|e| CaptureError::Backend(format!("copying fixture wav: {e}")))?;
        }
        Ok(CaptureStats {
            duration_ms: state.samples_written as u64 * 250,
            samples: state.samples_written,
            peak_rms: state.peak_rms,
        })
    }

    fn level_rx(&self) -> watch::Receiver<Option<LevelSample>> {
        self.rx.clone()
    }

    fn reset(&self) {
        let mut state = self.state.lock().unwrap();
        state.running = false;
        state.started_path = None;
    }

    fn set_device_id(&self, device_id: &str) {
        self.state.lock().unwrap().device_id = Some(device_id.to_string());
    }
}

/// A one-shot latch for deterministic (sleep-free) TOCTOU race tests
/// across this crate: a test double calls [`BlockingLatch::block`] from
/// inside a synchronous trait method on a real OS thread, which signals
/// "I'm parked here now" (non-blocking) and then blocks until the test
/// releases it. Shared here so the `commands`/`pipeline` test doubles
/// (blocking `capture.start`/`capture.stop`/`SecretStore::get`) don't each
/// re-implement the same `ready`/`release` handshake (review finding F4).
/// The "ready" side is a non-blocking `tokio::sync::oneshot::Sender::send`
/// (safe from any context); the "release" side is a plain
/// `std::sync::mpsc::Receiver::recv()` (a real blocking wait, deliberately
/// not `oneshot::blocking_recv`, which panics on a runtime worker thread)
/// -- so a double using it needs the multi-thread test runtime.
#[cfg(test)]
pub(crate) struct BlockingLatch {
    ready_tx: std::sync::Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
    release_rx: std::sync::Mutex<Option<std::sync::mpsc::Receiver<()>>>,
}

#[cfg(test)]
impl BlockingLatch {
    /// Returns the latch (to embed in a test double) plus the test's
    /// `ready_rx` (await it to learn the double is parked) and `release_tx`
    /// (send `()` to let it proceed).
    pub(crate) fn new() -> (std::sync::Arc<Self>, tokio::sync::oneshot::Receiver<()>, std::sync::mpsc::Sender<()>) {
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel::<()>();
        (
            std::sync::Arc::new(Self {
                ready_tx: std::sync::Mutex::new(Some(ready_tx)),
                release_rx: std::sync::Mutex::new(Some(release_rx)),
            }),
            ready_rx,
            release_tx,
        )
    }

    /// Call from inside the synchronous trait method being blocked.
    pub(crate) fn block(&self) {
        if let Some(tx) = self.ready_tx.lock().unwrap().take() {
            let _ = tx.send(());
        }
        if let Some(rx) = self.release_rx.lock().unwrap().take() {
            let _ = rx.recv();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rec_dir_path_is_scoped_under_voxis_plugin_rec() {
        let rec_dir = RecDir::new(PathBuf::from("/tmp/host-cache"));
        assert_eq!(rec_dir.path(), Path::new("/tmp/host-cache/voxis-plugin/rec"));
    }

    #[test]
    fn sweep_creates_missing_dir() {
        let base = tempfile::tempdir().unwrap();
        let rec_dir = RecDir::new(base.path().to_path_buf());
        assert!(!rec_dir.path().exists());
        rec_dir.sweep().unwrap();
        assert!(rec_dir.path().is_dir());
    }

    #[test]
    fn sweep_deletes_orphan_files() {
        let base = tempfile::tempdir().unwrap();
        let rec_dir = RecDir::new(base.path().to_path_buf());
        fs::create_dir_all(rec_dir.path()).unwrap();
        let orphan = rec_dir.path().join("orphan.wav");
        fs::write(&orphan, b"leftover").unwrap();
        assert!(orphan.exists());

        rec_dir.sweep().unwrap();

        assert!(!orphan.exists());
        assert!(rec_dir.path().is_dir(), "sweep must not remove the dir itself");
    }

    /// `[ADO-2/3]`: a per-file deletion failure during `sweep()` must not
    /// abort the whole sweep or propagate as an `Err` — it's logged
    /// (`tracing::warn!`, see `sweep`'s own doc comment; not asserted
    /// here, no tracing-capture harness in this crate) and the sweep
    /// simply moves on. Simulated without root by making the rec dir
    /// itself read-only (unlink requires write permission on the parent
    /// directory on unix, not on the file itself).
    #[test]
    #[cfg(unix)]
    fn sweep_does_not_fail_the_whole_sweep_when_one_file_cannot_be_deleted() {
        use std::os::unix::fs::PermissionsExt;

        let base = tempfile::tempdir().unwrap();
        let rec_dir = RecDir::new(base.path().to_path_buf());
        fs::create_dir_all(rec_dir.path()).unwrap();
        let stuck = rec_dir.path().join("stuck.wav");
        fs::write(&stuck, b"leftover").unwrap();

        let original_mode = fs::metadata(rec_dir.path()).unwrap().permissions().mode();
        fs::set_permissions(rec_dir.path(), fs::Permissions::from_mode(0o500)).unwrap();

        let result = rec_dir.sweep();

        // Restore write permission unconditionally (even on assertion
        // failure below) so the tempdir can still be cleaned up.
        fs::set_permissions(rec_dir.path(), fs::Permissions::from_mode(original_mode)).unwrap();

        assert!(result.is_ok(), "a single undeletable file must not turn sweep() itself into an Err");
        assert!(stuck.exists(), "the file really was left behind (proves this test actually exercised the failure path)");
    }

    #[test]
    fn new_session_path_is_unique_wav_under_rec_dir() {
        let rec_dir = RecDir::new(PathBuf::from("/tmp/host-cache"));
        let a = rec_dir.new_session_path();
        let b = rec_dir.new_session_path();
        assert_ne!(a, b);
        assert_eq!(a.extension().unwrap(), "wav");
        assert!(a.starts_with(rec_dir.path()));
    }

    #[test]
    fn rec_file_create_is_0600_on_unix() {
        let base = tempfile::tempdir().unwrap();
        let path = base.path().join("rec").join("session.wav");
        let rec_file = RecFile::create(path.clone()).unwrap();
        assert_eq!(rec_file.path(), path.as_path());
        assert!(path.exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }
    }

    #[test]
    fn rec_file_drop_deletes_the_file() {
        let base = tempfile::tempdir().unwrap();
        let path = base.path().join("session.wav");
        let rec_file = RecFile::create(path.clone()).unwrap();
        assert!(path.exists());
        drop(rec_file);
        assert!(!path.exists(), "RecFile::drop must delete its file on every outcome");
    }

    #[test]
    fn mock_capture_replays_script_only_on_explicit_tick() {
        let mock = MockCapture::new();
        mock.set_script(vec![
            LevelSample::new(0.1, 0.2),
            LevelSample::new(0.3, 0.4),
        ]);
        let mut rx = mock.level_rx();
        let base = tempfile::tempdir().unwrap();
        mock.start(&base.path().join("s.wav"), 999_999).unwrap();

        // Before any tick(), only the start-time `None` reset has been sent.
        assert_eq!(*rx.borrow_and_update(), None);

        mock.tick();
        assert_eq!(*rx.borrow_and_update(), Some(LevelSample::new(0.1, 0.2)));

        mock.tick();
        assert_eq!(*rx.borrow_and_update(), Some(LevelSample::new(0.3, 0.4)));
    }

    #[test]
    fn mock_capture_die_silently_stops_ticking_while_running() {
        let mock = MockCapture::new();
        mock.set_script(vec![LevelSample::new(0.5, 0.6)]);
        let base = tempfile::tempdir().unwrap();
        mock.start(&base.path().join("s.wav"), 999_999).unwrap();
        mock.set_die_silently(true);

        let rx = mock.level_rx();
        mock.tick();

        assert_eq!(*rx.borrow(), None, "die_silently must suppress ticks");
        assert!(mock.is_running(), "die_silently keeps is_running() true — that's the whole point");
    }

    #[test]
    fn mock_capture_ignore_stop_returns_backend_error() {
        let mock = MockCapture::new();
        let base = tempfile::tempdir().unwrap();
        mock.start(&base.path().join("s.wav"), 999_999).unwrap();
        mock.set_ignore_stop(true);

        let result = mock.stop();

        assert!(matches!(result, Err(CaptureError::Backend(_))));
        assert!(mock.is_running(), "ignore_stop means stop() didn't actually stop anything");
    }

    #[test]
    fn mock_capture_stop_copies_fixture_wav_to_requested_path() {
        let mock = MockCapture::new();
        let base = tempfile::tempdir().unwrap();
        let fixture = base.path().join("fixture.wav");
        fs::write(&fixture, b"RIFF....WAVEfmt fake").unwrap();
        mock.set_fixture_wav(fixture.clone());

        let dest = base.path().join("session.wav");
        fs::write(&dest, b"").unwrap();
        mock.start(&dest, 999_999).unwrap();
        mock.stop().unwrap();

        assert_eq!(fs::read(&dest).unwrap(), fs::read(&fixture).unwrap());
    }

    #[test]
    fn mock_capture_stop_reports_stats_from_ticked_samples() {
        let mock = MockCapture::new();
        mock.set_script(vec![
            LevelSample::new(0.1, 0.2),
            LevelSample::new(0.9, 0.95),
        ]);
        let base = tempfile::tempdir().unwrap();
        mock.start(&base.path().join("s.wav"), 999_999).unwrap();
        mock.tick();
        mock.tick();

        let stats = mock.stop().unwrap();

        assert_eq!(stats.samples, 2);
        assert_eq!(stats.duration_ms, 500);
        assert!((stats.peak_rms - 0.95).abs() < f32::EPSILON);
    }

    #[test]
    fn mock_capture_second_start_without_stop_is_already_running() {
        let mock = MockCapture::new();
        let base = tempfile::tempdir().unwrap();
        mock.start(&base.path().join("a.wav"), 1).unwrap();
        let second = mock.start(&base.path().join("b.wav"), 1);
        assert!(matches!(second, Err(CaptureError::AlreadyRunning)));
    }

    /// `[R1-Arch S2]` self-cap: the backend must stop advancing past
    /// `cap_samples` **on its own**, with no guard/pipeline task involved
    /// at all — this test drives `tick()` directly, standing in for a
    /// real cpal callback/Swift tap enforcing its own ceiling regardless
    /// of whether anything above it is still alive to notice.
    #[test]
    fn mock_capture_self_cap_stops_advancing_past_cap_samples_with_no_guard_involved() {
        let mock = MockCapture::new();
        mock.set_script(vec![
            LevelSample::new(0.1, 0.1),
            LevelSample::new(0.1, 0.1),
            LevelSample::new(0.1, 0.1),
            LevelSample::new(0.1, 0.1),
            LevelSample::new(0.1, 0.1),
        ]);
        let base = tempfile::tempdir().unwrap();
        mock.start(&base.path().join("s.wav"), 3).unwrap();

        assert!(!mock.cap_hit());
        mock.tick();
        mock.tick();
        assert!(!mock.cap_hit(), "cap must not fire before the 3rd sample");
        mock.tick(); // 3rd sample reaches the cap
        assert!(mock.cap_hit());
        mock.tick();
        mock.tick();

        let stats = mock.stop().unwrap();
        assert_eq!(stats.samples, 3, "ticks past cap_samples must not advance the script further");
    }

    #[test]
    fn mock_capture_emits_cap_hit_on_the_sample_that_reaches_the_cap() {
        let mock = MockCapture::new();
        mock.set_script(vec![LevelSample::new(0.1, 0.1), LevelSample::new(0.1, 0.1)]);
        let base = tempfile::tempdir().unwrap();
        mock.start(&base.path().join("s.wav"), 1).unwrap();
        let mut rx = mock.level_rx();

        mock.tick();
        assert!(rx.borrow_and_update().unwrap().cap_hit, "the sample that reaches cap_samples must carry cap_hit=true");
    }

    #[test]
    fn mock_capture_muted_knob_flows_into_emitted_samples() {
        let mock = MockCapture::new();
        mock.set_script(vec![LevelSample::new(0.1, 0.1), LevelSample::new(0.1, 0.1)]);
        let base = tempfile::tempdir().unwrap();
        mock.start(&base.path().join("s.wav"), 999_999).unwrap();
        let mut rx = mock.level_rx();

        mock.tick();
        assert!(!rx.borrow_and_update().unwrap().muted);

        mock.set_muted(true);
        mock.tick();
        assert!(rx.borrow_and_update().unwrap().muted);
    }

    #[test]
    fn reset_clears_running_state_so_a_subsequent_start_succeeds() {
        let mock = MockCapture::new();
        let base = tempfile::tempdir().unwrap();
        mock.start(&base.path().join("s.wav"), 999_999).unwrap();
        mock.set_ignore_stop(true);
        assert!(mock.stop().is_err(), "stop() fails while ignore_stop is set");
        assert!(mock.is_running(), "the failed stop() must not have cleared running on its own");

        mock.reset();

        assert!(!mock.is_running(), "reset() must clear running regardless of the earlier stop() failure");
        assert!(mock.start(&base.path().join("s2.wav"), 999_999).is_ok(), "a subsequent start() must succeed after reset()");
    }
}
