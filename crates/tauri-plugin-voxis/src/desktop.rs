//! `CpalCapture`: the desktop `AudioCapture` backend (Task 4), gated
//! behind this crate's `desktop` feature so the iOS build never sees
//! `cpal`.
//!
//! Mirrors `src-tauri/src/audio/{recorder.rs,stream.rs}`'s shape (same
//! project, same reasons) rather than reusing it directly \u2014 this crate
//! cannot depend on `voice_lib` (the dependency arrow in the plan's
//! Approach diagram runs the other way: `voice_lib` -> `voxis-core`, and
//! `tauri-plugin-voxis` -> `voxis-core`, never `tauri-plugin-voxis` ->
//! `voice_lib`). What *is* shared: `voxis_core::audio_wav`'s
//! downsample/`samples_to_wav` (the same WAV code desktop Voxis, this
//! plugin, and the iOS Swift bridge all use), and the same
//! catch_unwind-on-build/play pattern (cpal panics instead of returning
//! an `Err` when microphone permission is denied).
//!
//! Design, matching `AudioCapture`'s contract (`capture.rs`):
//! - **Buffering**: native-rate mono `f32` samples accumulate in an
//!   in-memory `Vec` (plan decision 3 KISS note: "accumulate f32 in
//!   memory like desktop [Voxis]"), owned by a dedicated OS thread that
//!   also owns the `cpal::Stream` itself (cpal streams are not
//!   `Send`/`Sync` on every platform \u2014 same reason
//!   `stream.rs::spawn_recording_thread` exists). `stop()` downsamples to
//!   16 kHz and writes the WAV to the path `start()` was given, all on
//!   the caller's thread (no macOS pause/resume fast-restart path here \u2014
//!   this crate always tears down and rebuilds the stream per session,
//!   there is no "fast restart" requirement in this contract).
//! - **Self-cap**: `accumulate_capped` (pure, unit-tested) stops pushing
//!   into the buffer once `cap_samples` (native-rate) is reached and
//!   reports `cap_hit`, independent of anything polling `level_rx` \u2014
//!   same semantics as desktop Voxis's `set_max_samples`/`cap_hit`.
//! - **Level cadence**: a second thread polls `stage` (see below) and,
//!   once `Running`, wakes every 250 ms, drains a `WindowPeakAccumulator`
//!   (peak RMS since the last drain, same "peak-not-average" metric as
//!   `AudioRecorder::take_rms_peak`) and publishes one `LevelSample` on
//!   the `watch` channel -- `rms` and `peak` both come from that single
//!   `take_peak()` reading (`pure::level_sample_from_peak`; calling
//!   `take_peak()` twice would silently zero the second reading, since
//!   it resets on every call -- review fix H1). The level thread stops
//!   on its own once `stage` moves to `Failed`/`Stopped` -- which is
//!   also what makes a stream death visible as ticks stopping (this
//!   contract's liveness signal, `capture.rs`'s `AudioCapture` doc).
//! - **Startup handshake** (`pure::stage`, review fix M3): the level
//!   thread polls `stage` (`Starting` -> keep waiting, don't tick, don't
//!   give up; `Running` -> tick; `Failed`/`Stopped` -> exit) instead of a
//!   fixed "sleep one interval then check a bool" delay, so a slow but
//!   healthy device open (first-run TCC prompt, Bluetooth mic pairing)
//!   is never mistaken for `StreamDied`.
//! - **Error/liveness**: `start()` returns `Ok(())` optimistically once
//!   the background thread is spawned (opening the device/building the
//!   stream happens *on* that thread, matching
//!   `stream.rs::spawn_recording_thread`'s own fire-and-forget shape);
//!   any catch_unwind'd panic, `cpal::BuildStreamError`/
//!   `PlayStreamError`, or a stream runtime error from cpal's own
//!   `err_fn` (review fix M2 -- previously logged only, leaving `stage`
//!   at `Running` and ticks flowing with `rms: 0.0` forever) is recorded
//!   in `last_error` and flips `stage` to `Failed` -- `level_rx` then
//!   stops ticking (liveness catches it) and the *next* `stop()` call
//!   returns `Err(CaptureError::Backend(..))` with the recorded cause
//!   instead of a fabricated success.
//! - **Self-cap unit** (review fix M1): `AudioCapture::start`'s
//!   `cap_samples` is expressed in samples-at-16kHz (`commands.rs`'s
//!   `do_start` computes it via `native_cap_samples(..,
//!   TRANSCRIPTION_SAMPLE_RATE)`, since the real device rate isn't known
//!   before `start()` is called) -- `pure::scale_cap_samples` rescales it
//!   to the device's actual native rate as soon as `run_capture_thread`
//!   learns it, before `accumulate_capped` ever compares a sample count
//!   against it.
mod pure;

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU8, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SampleFormat, StreamConfig};
use tokio::sync::watch;

use crate::capture::{AudioCapture, CaptureError, CaptureStats, LevelSample};

pub use pure::{accumulate_capped, finalize_wav, WindowPeakAccumulator};

enum StreamCommand {
    Close,
}

/// Desktop `cpal` capture backend. One instance is meant to be shared
/// (as `Arc<dyn AudioCapture>`) across the plugin's whole lifetime,
/// running at most one session (`start`/`stop` pair) at a time \u2014 same
/// single-session assumption `MockCapture`/`SessionGuard` already make.
pub struct CpalCapture {
    device_id: Mutex<String>,
    session_active: AtomicBool,
    stage: Arc<AtomicU8>,
    samples: Arc<Mutex<Vec<f32>>>,
    native_rate: Arc<AtomicU32>,
    max_samples: Arc<AtomicUsize>,
    cap_hit: Arc<AtomicBool>,
    window_peak: Arc<WindowPeakAccumulator>,
    overall_peak_bits: Arc<AtomicU32>,
    last_error: Arc<Mutex<Option<String>>>,
    cmd_tx: Mutex<Option<mpsc::Sender<StreamCommand>>>,
    audio_thread: Mutex<Option<JoinHandle<()>>>,
    level_thread: Mutex<Option<JoinHandle<()>>>,
    level_tx: watch::Sender<Option<LevelSample>>,
    level_rx: watch::Receiver<Option<LevelSample>>,
    path: Mutex<Option<std::path::PathBuf>>,
    start_instant: Mutex<Option<Instant>>,
}

/// How often `level_rx` gets a fresh `LevelSample` while recording \u2014
/// fixed by `capture.rs`'s `AudioCapture` contract doc (guard_adapter's
/// liveness poll assumes this cadence).
const LEVEL_INTERVAL: Duration = Duration::from_millis(250);

impl CpalCapture {
    /// Opens the platform's default input device.
    pub fn new() -> Self {
        Self::with_device_id("default")
    }

    /// Opens a specific input device by cpal name (falls back to the
    /// default device if `device_id == "default"`, same convention as
    /// `voice_lib::audio::get_device`).
    pub fn with_device_id(device_id: impl Into<String>) -> Self {
        let (level_tx, level_rx) = watch::channel(None);
        Self {
            device_id: Mutex::new(device_id.into()),
            session_active: AtomicBool::new(false),
            stage: Arc::new(AtomicU8::new(pure::stage::STOPPED)),
            samples: Arc::new(Mutex::new(Vec::new())),
            native_rate: Arc::new(AtomicU32::new(0)),
            max_samples: Arc::new(AtomicUsize::new(usize::MAX)),
            cap_hit: Arc::new(AtomicBool::new(false)),
            window_peak: Arc::new(WindowPeakAccumulator::default()),
            overall_peak_bits: Arc::new(AtomicU32::new(0)),
            last_error: Arc::new(Mutex::new(None)),
            cmd_tx: Mutex::new(None),
            audio_thread: Mutex::new(None),
            level_thread: Mutex::new(None),
            level_tx,
            level_rx,
            path: Mutex::new(None),
            start_instant: Mutex::new(None),
        }
    }

    fn record_error(last_error: &Mutex<Option<String>>, stage: &AtomicU8, message: String) {
        pure::record_stream_runtime_error(last_error, stage, message);
    }
}

impl Default for CpalCapture {
    fn default() -> Self {
        Self::new()
    }
}

impl AudioCapture for CpalCapture {
    fn start(&self, path: &std::path::Path, cap_samples: usize) -> Result<(), CaptureError> {
        if self.session_active.swap(true, Ordering::AcqRel) {
            // Minor (review fix): `swap` already wrote `true` atomically;
            // the previous extra `store(true, ..)` here was a no-op.
            return Err(CaptureError::AlreadyRunning);
        }

        self.samples.lock().unwrap().clear();
        self.native_rate.store(0, Ordering::SeqCst);
        self.max_samples.store(cap_samples, Ordering::SeqCst);
        self.cap_hit.store(false, Ordering::SeqCst);
        self.window_peak.take_peak();
        self.overall_peak_bits.store(0, Ordering::SeqCst);
        *self.last_error.lock().unwrap() = None;
        *self.path.lock().unwrap() = Some(path.to_path_buf());
        *self.start_instant.lock().unwrap() = Some(Instant::now());
        self.stage.store(pure::stage::STARTING, Ordering::SeqCst);

        let (tx, rx) = mpsc::channel();
        *self.cmd_tx.lock().unwrap() = Some(tx);

        let device_id = self.device_id.lock().unwrap().clone();
        let samples = self.samples.clone();
        let native_rate = self.native_rate.clone();
        let max_samples = self.max_samples.clone();
        let cap_hit = self.cap_hit.clone();
        let window_peak = self.window_peak.clone();
        let overall_peak_bits = self.overall_peak_bits.clone();
        let last_error = self.last_error.clone();
        let stage = self.stage.clone();

        let audio_handle = std::thread::spawn(move || {
            run_capture_thread(
                device_id,
                rx,
                samples,
                native_rate,
                max_samples,
                cap_hit,
                window_peak,
                overall_peak_bits,
                last_error,
                stage,
            );
        });
        *self.audio_thread.lock().unwrap() = Some(audio_handle);

        let level_tx = self.level_tx.clone();
        let window_peak = self.window_peak.clone();
        let cap_hit = self.cap_hit.clone();
        let stage = self.stage.clone();
        let level_handle = std::thread::spawn(move || loop {
            match stage.load(Ordering::SeqCst) {
                s if s == pure::stage::RUNNING => {
                    let peak = window_peak.take_peak();
                    // No cross-platform mic-mute detection on desktop
                    // cpal today (unlike iOS's system mute switch,
                    // `capture.rs`'s doc) -- always `false` here.
                    let sample = pure::level_sample_from_peak(peak, false, cap_hit.load(Ordering::SeqCst));
                    let _ = level_tx.send(Some(sample));
                    std::thread::sleep(LEVEL_INTERVAL);
                }
                s if s == pure::stage::STARTING => {
                    // Review fix M3: no fixed startup delay -- keep
                    // polling (without ticking) for as long as the audio
                    // thread is still opening the device/building the
                    // stream, however slow (first-run TCC prompt,
                    // Bluetooth mic pairing). Only `Failed`/`Stopped`
                    // (below) end the wait.
                    std::thread::sleep(Duration::from_millis(20));
                }
                _ => return, // Failed or Stopped
            }
        });
        *self.level_thread.lock().unwrap() = Some(level_handle);

        Ok(())
    }

    fn stop(&self) -> Result<CaptureStats, CaptureError> {
        if !self.session_active.swap(false, Ordering::AcqRel) {
            return Err(CaptureError::NotRunning);
        }

        if let Some(tx) = self.cmd_tx.lock().unwrap().take() {
            let _ = tx.send(StreamCommand::Close);
        }
        self.stage.store(pure::stage::STOPPED, Ordering::SeqCst);
        if let Some(handle) = self.audio_thread.lock().unwrap().take() {
            let _ = handle.join();
        }
        if let Some(handle) = self.level_thread.lock().unwrap().take() {
            let _ = handle.join();
        }

        if let Some(cause) = self.last_error.lock().unwrap().take() {
            return Err(CaptureError::Backend(cause));
        }

        let samples = std::mem::take(&mut *self.samples.lock().unwrap());
        let native_rate = self.native_rate.load(Ordering::SeqCst);
        let path = self.path.lock().unwrap().take();
        let start_instant = self.start_instant.lock().unwrap().take();

        let (wav, final_samples_len) = finalize_wav(&samples, native_rate)
            .map_err(|e| CaptureError::Backend(format!("encoding WAV: {e}")))?;

        if let Some(path) = path {
            std::fs::write(&path, &wav)
                .map_err(|e| CaptureError::Backend(format!("writing WAV to {}: {e}", path.display())))?;
        }

        let duration_ms = start_instant.map(|i| i.elapsed().as_millis() as u64).unwrap_or(0);
        let peak_rms = f32::from_bits(self.overall_peak_bits.load(Ordering::SeqCst));

        Ok(CaptureStats { duration_ms, samples: final_samples_len, peak_rms })
    }

    fn level_rx(&self) -> watch::Receiver<Option<LevelSample>> {
        self.level_rx.clone()
    }

    fn reset(&self) {
        self.session_active.store(false, Ordering::SeqCst);
        self.stage.store(pure::stage::STOPPED, Ordering::SeqCst);
        if let Some(tx) = self.cmd_tx.lock().unwrap().take() {
            let _ = tx.send(StreamCommand::Close);
        }
        if let Some(handle) = self.audio_thread.lock().unwrap().take() {
            let _ = handle.join();
        }
        if let Some(handle) = self.level_thread.lock().unwrap().take() {
            let _ = handle.join();
        }
        self.samples.lock().unwrap().clear();
        *self.last_error.lock().unwrap() = None;
        *self.path.lock().unwrap() = None;
        *self.start_instant.lock().unwrap() = None;
    }
}

/// Body of the dedicated OS thread that owns the `cpal::Stream` for one
/// session: opens the device, builds+plays the stream (both wrapped in
/// `catch_unwind`, same reason `stream.rs::build_and_play_stream` is),
/// then blocks on `rx.recv()` until told to close. Any failure records
/// its cause in `last_error` and flips `stage` to `Failed` -- the level
/// thread's next poll sees that (not `Starting`/`Running`) and exits
/// immediately, i.e. `level_rx` never ticks for this session at all,
/// which is this contract's own liveness signal for "capture never came
/// up" no differently than "capture died mid-session" (`err_fn`, inside
/// `build_stream`, does the same for a failure *after* the stream is up).
#[allow(clippy::too_many_arguments)]
fn run_capture_thread(
    device_id: String,
    rx: mpsc::Receiver<StreamCommand>,
    samples: Arc<Mutex<Vec<f32>>>,
    native_rate: Arc<AtomicU32>,
    max_samples: Arc<AtomicUsize>,
    cap_hit: Arc<AtomicBool>,
    window_peak: Arc<WindowPeakAccumulator>,
    overall_peak_bits: Arc<AtomicU32>,
    last_error: Arc<Mutex<Option<String>>>,
    stage: Arc<AtomicU8>,
) {
    let host = match std::panic::catch_unwind(cpal::default_host) {
        Ok(h) => h,
        Err(_) => {
            CpalCapture::record_error(&last_error, &stage, "cannot access audio system (permission denied?)".to_string());
            return;
        }
    };

    let device = match open_device(&host, &device_id) {
        Ok(d) => d,
        Err(e) => {
            CpalCapture::record_error(&last_error, &stage, e);
            return;
        }
    };

    let config_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| device.default_input_config()));
    let config = match config_result {
        Ok(Ok(c)) => c,
        Ok(Err(e)) => {
            CpalCapture::record_error(&last_error, &stage, format!("no default input config: {e}"));
            return;
        }
        Err(_) => {
            CpalCapture::record_error(&last_error, &stage, "cannot access microphone (permission denied?)".to_string());
            return;
        }
    };

    native_rate.store(config.sample_rate().0, Ordering::SeqCst);
    // Review fix M1: `max_samples` arrives expressed in samples-at-16kHz
    // (see module doc's "Self-cap unit") -- rescale it to the device's
    // real native rate now that it's known, before the stream (and
    // therefore `accumulate_capped`) ever runs.
    let scaled_cap = pure::scale_cap_samples(max_samples.load(Ordering::SeqCst), config.sample_rate().0);
    max_samples.store(scaled_cap, Ordering::SeqCst);
    let stream_config: StreamConfig = config.clone().into();
    let channels = stream_config.channels as usize;
    let sample_format = config.sample_format();

    let build_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        build_stream_for_format(
            sample_format,
            &device,
            &stream_config,
            channels,
            samples,
            max_samples,
            cap_hit,
            window_peak,
            overall_peak_bits,
            last_error.clone(),
            stage.clone(),
        )
    }));
    let stream = match build_result {
        Ok(Ok(s)) => s,
        Ok(Err(e)) => {
            CpalCapture::record_error(&last_error, &stage, format!("building input stream: {e}"));
            return;
        }
        Err(_) => {
            CpalCapture::record_error(&last_error, &stage, "cannot build audio stream (permission denied?)".to_string());
            return;
        }
    };

    let play_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| stream.play()));
    match play_result {
        Ok(Ok(())) => {}
        Ok(Err(e)) => {
            CpalCapture::record_error(&last_error, &stage, format!("playing input stream: {e}"));
            return;
        }
        Err(_) => {
            CpalCapture::record_error(&last_error, &stage, "cannot start audio playback (permission denied?)".to_string());
            return;
        }
    }

    stage.store(pure::stage::RUNNING, Ordering::SeqCst);
    let _ = rx.recv(); // blocks until `stop()`/`reset()` sends `Close` (or the sender is dropped)
    // Only downgrade a still-`Running` stage to `Stopped` here -- if
    // `err_fn` already flipped it to `Failed` (M2) while this thread was
    // blocked in `rx.recv()`, that outcome must survive so `stop()`
    // reports the real cause instead of a fabricated clean stop.
    let _ = stage.compare_exchange(pure::stage::RUNNING, pure::stage::STOPPED, Ordering::SeqCst, Ordering::SeqCst);
    drop(stream);
}

fn open_device(host: &cpal::Host, device_id: &str) -> Result<cpal::Device, String> {
    if device_id == "default" {
        return host.default_input_device().ok_or_else(|| "no default input device".to_string());
    }
    let mut devices = host.input_devices().map_err(|e| format!("listing input devices: {e}"))?;
    devices
        .find(|d| d.name().map(|n| n == device_id).unwrap_or(false))
        .ok_or_else(|| format!("input device not found: {device_id}"))
}

#[allow(clippy::too_many_arguments)]
fn build_stream_for_format(
    format: SampleFormat,
    device: &cpal::Device,
    config: &StreamConfig,
    channels: usize,
    samples: Arc<Mutex<Vec<f32>>>,
    max_samples: Arc<AtomicUsize>,
    cap_hit: Arc<AtomicBool>,
    window_peak: Arc<WindowPeakAccumulator>,
    overall_peak_bits: Arc<AtomicU32>,
    last_error: Arc<Mutex<Option<String>>>,
    stage: Arc<AtomicU8>,
) -> Result<cpal::Stream, cpal::BuildStreamError> {
    match format {
        SampleFormat::F32 => build_stream::<f32>(device, config, channels, samples, max_samples, cap_hit, window_peak, overall_peak_bits, last_error, stage),
        SampleFormat::I16 => build_stream::<i16>(device, config, channels, samples, max_samples, cap_hit, window_peak, overall_peak_bits, last_error, stage),
        SampleFormat::U16 => build_stream::<u16>(device, config, channels, samples, max_samples, cap_hit, window_peak, overall_peak_bits, last_error, stage),
        _ => Err(cpal::BuildStreamError::StreamConfigNotSupported),
    }
}

#[allow(clippy::too_many_arguments)]
fn build_stream<T>(
    device: &cpal::Device,
    config: &StreamConfig,
    channels: usize,
    samples: Arc<Mutex<Vec<f32>>>,
    max_samples: Arc<AtomicUsize>,
    cap_hit: Arc<AtomicBool>,
    window_peak: Arc<WindowPeakAccumulator>,
    overall_peak_bits: Arc<AtomicU32>,
    last_error: Arc<Mutex<Option<String>>>,
    stage: Arc<AtomicU8>,
) -> Result<cpal::Stream, cpal::BuildStreamError>
where
    T: cpal::Sample + cpal::SizedSample,
    f32: FromSample<T>,
{
    // Review fix M2: previously `err_fn` only logged (`tracing::error!`)
    // -- a mid-session stream error (device unplugged, driver reset)
    // left `stage` at `Running` forever, so the level thread kept
    // ticking `rms: 0.0` and `stop()` still returned `Ok`. Now it records
    // the cause and flips `stage` to `Failed` via the same pure helper
    // `run_capture_thread`'s own startup-failure paths use, so both
    // "never came up" and "died mid-session" produce the identical
    // observable outcome (ticks stop, `stop()` returns `Err`).
    let err_fn = move |err: cpal::StreamError| {
        pure::record_stream_runtime_error(&last_error, &stage, format!("stream error: {err}"));
    };
    device.build_input_stream(
        config,
        move |data: &[T], _: &cpal::InputCallbackInfo| {
            let mono: Vec<f32> = data
                .chunks(channels.max(1))
                .map(|frame| frame.iter().map(|s| <f32 as FromSample<T>>::from_sample_(*s)).sum::<f32>() / channels.max(1) as f32)
                .collect();
            let max = max_samples.load(Ordering::Relaxed);
            let mut buffer = samples.lock().unwrap();
            let (rms, hit) = accumulate_capped(&mut buffer, &mono, max);
            drop(buffer);
            if hit {
                cap_hit.store(true, Ordering::Relaxed);
            }
            if rms.is_finite() {
                window_peak.observe(rms);
                overall_peak_bits.fetch_max(rms.to_bits(), Ordering::Relaxed);
            }
        },
        err_fn,
        None,
    )
}

