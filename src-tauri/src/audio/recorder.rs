use crate::audio::stream::{spawn_recording_thread, RecordCommand};
use crate::audio::sync::lock_or_recover;
use crate::audio::vad::{filter_with_vad, VoiceActivityDetector, SILERO_FRAME_SAMPLES};
use crate::audio::TRANSCRIPTION_SAMPLE_RATE;
use crate::audio::{downsample, get_device, list_devices, samples_to_wav, AudioDevice, AudioError};
use cpal::traits::DeviceTrait;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

pub struct AudioRecorder {
    is_recording: Arc<AtomicBool>,
    is_ready: Arc<AtomicBool>,
    /// Single-flight guard for `stop()`: CAS'd `false -> true` at entry,
    /// reset to `false` on every exit path via `StoppingGuard` (RAII) and
    /// defensively in `start()`. Distinct from `is_recording` — that flag
    /// is the *stream*-state flag flipped by the recording thread on
    /// `Pause` (`stream.rs`), and `stop_macos_pause()` busy-waits on it;
    /// CASing `is_recording` here would break that wait and
    /// `try_resume_recording`. A second concurrent `stop()` call gets
    /// `Err(NotRecording)` immediately from this flag, without touching
    /// `is_recording`, cloning samples, or re-entering VAD.
    stopping: Arc<AtomicBool>,
    samples: Arc<Mutex<Vec<f32>>>,
    audio_level: Arc<AtomicU32>,
    sample_rate: Arc<AtomicU32>,
    audio_boost: Arc<AtomicU32>,
    /// Bit pattern of the peak (pre-boost) chunk RMS observed since the
    /// last `take_rms_peak()` call (or since `start()`). Updated via
    /// `fetch_max` in `process_chunk` — valid because non-negative f32
    /// bit patterns are monotonic as `u32`. Boost-independent silence
    /// signal for the recording guard (plan Layer 2).
    rms_peak_bits: Arc<AtomicU32>,
    /// Upper bound on buffered (native-rate) samples. Default
    /// `usize::MAX` = no cap; the caller (recording guard, Layer 5) sets
    /// this from `max_recording_ms × native_rate`.
    max_samples: Arc<AtomicUsize>,
    /// Set once `max_samples` is reached; reset on `start()`. The cpal
    /// callback only stops *pushing into the buffer* — an active stop is
    /// the guard's job (plan Layer 2/3), not this primitive's.
    cap_hit: Arc<AtomicBool>,
    stop_tx: Mutex<Option<mpsc::Sender<RecordCommand>>>,
    thread_handle: Mutex<Option<JoinHandle<()>>>,
    /// Optional VAD applied to downsampled (16 kHz) samples in `stop()`.
    /// Setting `None` disables VAD filtering (default behaviour).
    vad: Mutex<Option<Box<dyn VoiceActivityDetector>>>,
}

impl Default for AudioRecorder {
    fn default() -> Self {
        Self::new()
    }
}

// Safe because all shared state is Arc/Mutex and stream stays on the recording thread.
unsafe impl Send for AudioRecorder {}
unsafe impl Sync for AudioRecorder {}

/// RAII guard that resets `AudioRecorder::stopping` back to `false` on
/// every exit path of `stop()` — early return, error return, or normal
/// completion — so no return point has to remember to clear it by hand.
struct StoppingGuard<'a> {
    flag: &'a AtomicBool,
}

impl Drop for StoppingGuard<'_> {
    fn drop(&mut self) {
        self.flag.store(false, Ordering::Release);
    }
}

impl AudioRecorder {
    pub fn new() -> Self {
        Self {
            is_recording: Arc::new(AtomicBool::new(false)),
            is_ready: Arc::new(AtomicBool::new(false)),
            stopping: Arc::new(AtomicBool::new(false)),
            samples: Arc::new(Mutex::new(Vec::new())),
            audio_level: Arc::new(AtomicU32::new(0)),
            sample_rate: Arc::new(AtomicU32::new(44100)),
            audio_boost: Arc::new(AtomicU32::new(8000)),
            rms_peak_bits: Arc::new(AtomicU32::new(0)),
            max_samples: Arc::new(AtomicUsize::new(usize::MAX)),
            cap_hit: Arc::new(AtomicBool::new(false)),
            stop_tx: Mutex::new(None),
            thread_handle: Mutex::new(None),
            vad: Mutex::new(None),
        }
    }

    /// Install or remove a Voice Activity Detection backend.
    ///
    /// When set, `stop()` filters downsampled samples through this VAD before
    /// WAV encoding. Calling with `None` disables filtering. The VAD is reset
    /// (LSTM state cleared) on each call.
    pub fn set_vad(&self, mut vad: Option<Box<dyn VoiceActivityDetector>>) {
        if let Some(ref mut v) = vad {
            v.reset();
        }
        let mut guard = lock_or_recover(&self.vad);
        *guard = vad;
    }

    pub fn set_audio_boost(&self, boost: f32) {
        let boost_u32 = (boost * 10.0).clamp(100.0, 10000.0) as u32;
        self.audio_boost.store(boost_u32, Ordering::SeqCst);
    }

    pub fn get_audio_boost(&self) -> f32 {
        self.audio_boost.load(Ordering::SeqCst) as f32 / 10.0
    }

    pub fn list_devices() -> Result<Vec<AudioDevice>, AudioError> {
        list_devices()
    }

    pub fn start(&self, device_id: &str) -> Result<(), AudioError> {
        // Fail-safe, checked FIRST: a stop() is currently in flight.
        // `StoppingGuard` already guarantees `stopping` resets on every
        // exit of `stop()` (early Err, Ok, or unwind in non-abort
        // profiles), so a stale flag can never linger here — clearing it
        // in start() would only ever mask a stop() that is genuinely
        // still running. On macOS, stop() flips `is_recording=false` at
        // Pause and then spends seconds in downsample/VAD/WAV on a large
        // buffer; a start() reaching this far in that window would pass
        // the `is_recording` early-return below, reset the VAD mid-apply,
        // resume the stream, and let a second stop() CAS in concurrently
        // — exactly bug E1 (double VAD, both callers `Ok`). Refuse instead.
        if self.stopping.load(Ordering::Acquire) {
            return Err(AudioError::StopInProgress);
        }

        if self.is_recording.load(Ordering::SeqCst) {
            return Ok(());
        }

        self.clear_samples();
        self.reset_vad();
        self.rms_peak_bits.store(0, Ordering::SeqCst);
        self.cap_hit.store(false, Ordering::SeqCst);

        #[cfg(target_os = "macos")]
        {
            if self.try_resume_recording() {
                return Ok(());
            }
        }

        let (device, config) = self.get_device_config(device_id)?;
        let rx = self.setup_stop_channel();
        let handle = spawn_recording_thread(
            device,
            config,
            rx,
            Arc::clone(&self.samples),
            Arc::clone(&self.audio_level),
            Arc::clone(&self.audio_boost),
            Arc::clone(&self.is_recording),
            Arc::clone(&self.is_ready),
            Arc::clone(&self.rms_peak_bits),
            Arc::clone(&self.max_samples),
            Arc::clone(&self.cap_hit),
        );

        let mut thread_handle = lock_or_recover(&self.thread_handle);
        *thread_handle = Some(handle);
        Ok(())
    }

    #[cfg(target_os = "macos")]
    fn try_resume_recording(&self) -> bool {
        if !self.is_ready.load(Ordering::SeqCst) {
            return false;
        }

        let stop_tx = lock_or_recover(&self.stop_tx);
        if let Some(ref tx) = *stop_tx {
            if tx.send(RecordCommand::Play).is_ok() {
                drop(stop_tx);
                for _ in 0..100 {
                    if self.is_recording.load(Ordering::SeqCst) {
                        return true;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(1));
                }
            }
        }
        false
    }

    fn clear_samples(&self) {
        let mut samples = lock_or_recover(&self.samples);
        samples.clear();
    }

    /// Reset VAD internal state (e.g. LSTM in Silero) between recordings.
    fn reset_vad(&self) {
        let mut guard = lock_or_recover(&self.vad);
        if let Some(ref mut vad) = *guard {
            vad.reset();
        }
    }

    fn get_device_config(
        &self,
        device_id: &str,
    ) -> Result<(cpal::Device, cpal::SupportedStreamConfig), AudioError> {
        let device = get_device(device_id)?;
        let config = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            device.default_input_config()
        }))
        .map_err(|_| {
            AudioError::ConfigError(
                "Cannot access microphone. Grant permission in System Settings.".into(),
            )
        })?
        .map_err(|e| AudioError::ConfigError(e.to_string()))?;

        self.sample_rate
            .store(config.sample_rate().0, Ordering::SeqCst);
        Ok((device, config))
    }

    fn setup_stop_channel(&self) -> mpsc::Receiver<RecordCommand> {
        let (tx, rx) = mpsc::channel::<RecordCommand>();
        let mut stop_tx = lock_or_recover(&self.stop_tx);
        *stop_tx = Some(tx);
        rx
    }

    #[cfg(target_os = "macos")]
    fn send_pause_command(&self) {
        let stop_tx = lock_or_recover(&self.stop_tx);
        if let Some(ref tx) = *stop_tx {
            let _ = tx.send(RecordCommand::Pause);
        }
    }

    fn join_recording_thread(&self) {
        let mut thread_handle = lock_or_recover(&self.thread_handle);
        if let Some(handle) = thread_handle.take() {
            let _ = handle.join();
        }
    }

    fn clear_stop_sender(&self) {
        let mut stop_tx = lock_or_recover(&self.stop_tx);
        *stop_tx = None;
    }

    /// Drains the buffer via `mem::take` instead of cloning it: removes
    /// the clone's 2× memory peak on `stop()` AND releases the old
    /// buffer's capacity immediately (`start()` still calls
    /// `clear_samples()` defensively, but by then the buffer is already
    /// empty with capacity 0).
    fn get_samples(&self) -> Vec<f32> {
        let mut samples_guard = lock_or_recover(&self.samples);
        std::mem::take(&mut *samples_guard)
    }

    pub fn stop(&self) -> Result<Vec<u8>, AudioError> {
        // Single-flight: a second concurrent caller gets
        // `StopInProgress` immediately (CAS fails), without touching
        // `is_recording`, cloning samples, or re-entering VAD — see plan
        // Layer 1 / bug E1 (a racing double-stop otherwise mutates the
        // shared Silero LSTM state twice and both callers return `Ok`).
        // Distinct from the `NotRecording` below: this caller arrived
        // while ANOTHER stop() owns the flag, not because nothing is
        // recording.
        if self
            .stopping
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Err(AudioError::StopInProgress);
        }
        let _stopping_guard = StoppingGuard {
            flag: &self.stopping,
        };

        if !self.is_recording.load(Ordering::SeqCst) {
            return Err(AudioError::NotRecording);
        }

        #[cfg(target_os = "macos")]
        self.stop_macos_pause();

        #[cfg(not(target_os = "macos"))]
        self.stop_linux();

        let samples = self.get_samples();
        let sample_rate = self.sample_rate.load(Ordering::SeqCst);

        let (downsampled, final_rate) = if sample_rate > TRANSCRIPTION_SAMPLE_RATE {
            (
                downsample(&samples, sample_rate, TRANSCRIPTION_SAMPLE_RATE),
                TRANSCRIPTION_SAMPLE_RATE,
            )
        } else {
            (samples, sample_rate)
        };

        let final_samples = self.apply_vad(downsampled, final_rate);
        samples_to_wav(&final_samples, final_rate)
    }

    /// Apply VAD filter (if configured) to 16 kHz mono samples.
    /// Returns samples unchanged when VAD is `None` or the rate doesn't match
    /// `TRANSCRIPTION_SAMPLE_RATE` (Silero frame size assumes 16 kHz).
    fn apply_vad(&self, samples: Vec<f32>, rate: u32) -> Vec<f32> {
        if rate != TRANSCRIPTION_SAMPLE_RATE {
            return samples;
        }
        let mut guard = lock_or_recover(&self.vad);
        let Some(ref mut vad) = *guard else {
            return samples;
        };
        let filtered = filter_with_vad(&samples, vad.as_mut(), SILERO_FRAME_SAMPLES);
        let original_secs = samples.len() as f32 / TRANSCRIPTION_SAMPLE_RATE as f32;
        let filtered_secs = filtered.len() as f32 / TRANSCRIPTION_SAMPLE_RATE as f32;
        tracing::info!(
            "VAD filtered: {:.2}s -> {:.2}s ({} -> {} samples)",
            original_secs,
            filtered_secs,
            samples.len(),
            filtered.len()
        );
        filtered
    }

    #[cfg(target_os = "macos")]
    fn stop_macos_pause(&self) {
        self.send_pause_command();

        let start = std::time::Instant::now();
        let timeout = if self.is_ready.load(Ordering::SeqCst) {
            std::time::Duration::from_millis(500)
        } else {
            std::time::Duration::from_secs(3)
        };

        while self.is_recording.load(Ordering::SeqCst) {
            if start.elapsed() > timeout {
                break;
            }
            std::thread::yield_now();
        }
    }

    #[cfg(not(target_os = "macos"))]
    fn stop_linux(&self) {
        let stop_tx = lock_or_recover(&self.stop_tx);
        if let Some(ref tx) = *stop_tx {
            let _ = tx.send(RecordCommand::Close);
        }
        drop(stop_tx);

        self.join_recording_thread();
        self.clear_stop_sender();
    }

    pub fn close(&self) {
        self.send_close_command();
        self.join_recording_thread();
        self.clear_stop_sender();
    }

    fn send_close_command(&self) {
        let stop_tx = lock_or_recover(&self.stop_tx);
        if let Some(ref tx) = *stop_tx {
            let _ = tx.send(RecordCommand::Close);
        }
    }

    pub fn is_recording(&self) -> bool {
        self.is_recording.load(Ordering::SeqCst)
    }

    /// Whether a `stop()` call is currently in flight (single-flight
    /// guard). Exposed so callers built on top of `AudioRecorder` (e.g.
    /// the orchestrator's `stop_lock`) can observe this state without
    /// duplicating it.
    pub fn is_stopping(&self) -> bool {
        self.stopping.load(Ordering::SeqCst)
    }

    pub fn audio_level(&self) -> u32 {
        self.audio_level.load(Ordering::SeqCst)
    }

    /// Peak (pre-boost) RMS observed across all chunks since the last
    /// call to this method (or since `start()`) — "peak since last
    /// poll". Boost-independent silence signal for the recording guard
    /// (plan Layer 2): draining via `swap` means a poller on a fixed
    /// interval gets exactly the peak over that interval, without
    /// missing chunks between polls (unlike `audio_level()`, which only
    /// reflects the *last* chunk).
    pub fn take_rms_peak(&self) -> f32 {
        f32::from_bits(self.rms_peak_bits.swap(0, Ordering::AcqRel))
    }

    /// Cap the raw (native-rate) sample buffer at `n` samples. The cpal
    /// callback stops appending once the cap is reached — still
    /// computing RMS/level for visualization — and sets `cap_hit`.
    /// Deciding what an *active* stop looks like when the cap is hit is
    /// the recording guard's job (plan Layer 2/3), not this primitive's.
    pub fn set_max_samples(&self, n: usize) {
        self.max_samples.store(n, Ordering::SeqCst);
    }

    /// Whether the cap set via `set_max_samples` has been reached since
    /// the last `start()`.
    pub fn cap_hit(&self) -> bool {
        self.cap_hit.load(Ordering::SeqCst)
    }

    /// Returns up to the last `count` samples from the buffer, used by
    /// the overlay's spectrum polling. After `stop()` (which now drains
    /// the buffer via `mem::take` in `get_samples`) this returns empty —
    /// acceptable because the polling loop that calls this is cancelled
    /// around the same stop (see `orchestrator::audio_level` /
    /// `polling_cancel`).
    pub fn get_recent_samples(&self, count: usize) -> Vec<f32> {
        let samples_guard = lock_or_recover(&self.samples);
        let len = samples_guard.len();
        if len >= count {
            samples_guard[len - count..].to_vec()
        } else {
            samples_guard.clone()
        }
    }
}

#[cfg(test)]
mod tests;
