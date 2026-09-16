//! `CpalCapture`'s pure, device-free logic \u2014 window peak-RMS
//! accumulation, self-cap enforcement, and WAV assembly from an
//! accumulated `f32` buffer \u2014 split out so it's testable with plain
//! synthetic sample slices, no cpal device involved at all.

use std::sync::atomic::{AtomicU32, AtomicU8, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use voxis_core::audio_wav::{downsample, samples_to_wav, TRANSCRIPTION_SAMPLE_RATE};

use crate::capture::LevelSample;

/// Appends `chunk` (mono `f32`) onto `buffer` up to `max_samples`
/// (`[R1-Arch S2]` self-cap, same semantics as desktop Voxis's
/// `set_max_samples`/`process_chunk`): once the buffer is full, further
/// samples in `chunk` are silently dropped rather than growing the
/// buffer, and the returned `bool` is `true` for exactly the call whose
/// chunk caused (or found) the buffer already at/over the cap. RMS is
/// computed over the *whole incoming chunk* regardless of how much of it
/// was actually buffered \u2014 the level metric keeps working after the cap
/// is hit, same as `process_chunk`'s own chunk-RMS.
pub fn accumulate_capped(buffer: &mut Vec<f32>, chunk: &[f32], max_samples: usize) -> (f32, bool) {
    let mut hit = false;
    for &sample in chunk {
        if buffer.len() < max_samples {
            buffer.push(sample);
        } else {
            hit = true;
        }
    }
    let rms = if chunk.is_empty() {
        0.0
    } else {
        (chunk.iter().map(|s| s * s).sum::<f32>() / chunk.len() as f32).sqrt()
    };
    (rms, hit)
}

/// Tracks the peak (not average) RMS observed across chunks since the
/// last `take_peak()` \u2014 the same "boost-independent peak since last
/// poll" metric as `AudioRecorder::take_rms_peak`, drained once per
/// `LevelSample` (every 250 ms). Valid because non-negative `f32` bit
/// patterns are monotonic as `u32`, so an integer `fetch_max` on the bit
/// pattern tracks the peak without a lock; `NaN` is rejected by the
/// caller (`desktop.rs`'s `if rms.is_finite()`) before it ever reaches
/// `observe`, same guard `process_chunk` applies.
#[derive(Default)]
pub struct WindowPeakAccumulator {
    peak_bits: AtomicU32,
}

impl WindowPeakAccumulator {
    pub fn observe(&self, rms: f32) {
        self.peak_bits.fetch_max(rms.to_bits(), Ordering::Relaxed);
    }

    /// Returns the peak observed since the last call (or since
    /// creation), resetting it to 0.0.
    pub fn take_peak(&self) -> f32 {
        f32::from_bits(self.peak_bits.swap(0, Ordering::AcqRel))
    }
}

/// Builds one `LevelSample` from a single peak-RMS reading (drained
/// exactly once from `WindowPeakAccumulator::take_peak()`) — `rms` and
/// `peak` both equal that one reading. Review fix H1: the level thread
/// used to call `take_peak()` twice while building the sample (once for
/// `rms`, once for `peak`); the accumulator's `take_peak()` resets to
/// 0.0 on every call, so the *second* call always returned 0.0 --
/// `guard_adapter::poll` feeds `sample.peak` into `guard_step`, so every
/// real recording had a permanently-zero peak and the silence guard
/// auto-stopped it almost immediately. Taking this pure function's
/// single `peak: f32` argument makes it structurally impossible to
/// re-introduce that bug at the call site.
pub fn level_sample_from_peak(peak: f32, muted: bool, cap_hit: bool) -> LevelSample {
    LevelSample { rms: peak, peak, muted, cap_hit }
}

/// Scales a cap expressed in samples-at-16kHz to the device's actual
/// native sample rate, once known. Review fix M1: `commands.rs`'s
/// `do_start` computes `cap_samples` via `voxis_core::guard::
/// native_cap_samples(max_recording_ms, TRANSCRIPTION_SAMPLE_RATE)` --
/// i.e. expressed in 16kHz samples, since the plugin doesn't know the
/// real device rate before `AudioCapture::start` is called -- but
/// `accumulate_capped` compares it directly against the NATIVE-rate
/// buffer. Without scaling, a 60s cap became a 20s cap at a 48kHz
/// device. `usize::MAX` ("no cap") and `native_rate == 0` ("not yet
/// known") both pass through unscaled.
pub fn scale_cap_samples(cap_at_16k: usize, native_rate: u32) -> usize {
    if cap_at_16k == usize::MAX || native_rate == 0 {
        return cap_at_16k;
    }
    let scaled = (cap_at_16k as u128 * native_rate as u128) / TRANSCRIPTION_SAMPLE_RATE as u128;
    scaled.min(usize::MAX as u128) as usize
}

/// The capture thread's own lifecycle stage, polled by the level-cadence
/// thread (review fix M3: replaces a fixed "sleep one interval, then
/// check a bool" startup handshake, which declared a healthy-but-slow
/// device open -- first TCC prompt, Bluetooth mic pairing -- `StreamDied`
/// before the stream ever had a chance to come up). `Starting` means
/// "keep waiting, don't tick, don't give up"; only `Failed`/`Stopped`
/// mean "exit now".
pub mod stage {
    pub const STARTING: u8 = 0;
    pub const RUNNING: u8 = 1;
    pub const FAILED: u8 = 2;
    pub const STOPPED: u8 = 3;
}

/// Sleeps `total` in `slice`-sized increments via `sleep_fn`, checking
/// `stage_flag` after every slice and returning as soon as it no longer
/// reads `RUNNING` (`[ADO-4]`: previously a single fixed
/// `thread::sleep(LEVEL_INTERVAL)` — 250ms — meant `stop()`'s
/// `level_thread.join()` could block for up to that whole interval even
/// though `stage` flips to `STOPPED` immediately at the start of
/// `stop()`). `sleep_fn` is injected so this is unit-testable with a
/// counting stub instead of real wall-clock sleeps.
pub fn sleep_while_running(stage_flag: &AtomicU8, total: Duration, slice: Duration, mut sleep_fn: impl FnMut(Duration)) {
    let mut waited = Duration::ZERO;
    while waited < total {
        sleep_fn(slice);
        waited = waited.saturating_add(slice);
        if stage_flag.load(Ordering::SeqCst) != stage::RUNNING {
            return;
        }
    }
}

/// Records a stream runtime error (cpal's own `err_fn`, or any other
/// mid-session failure) into shared state: sets `last_error` (surfaced
/// by the next `stop()`) and flips `stage` to `FAILED` so the level
/// thread's next poll exits instead of continuing to tick a dead stream.
/// Review fix M2: `err_fn` previously only logged via `tracing::error!`,
/// so a stream error mid-session left `level_rx` ticking `rms: 0.0`
/// forever and `stop()` still returned `Ok` -- the module doc's own
/// liveness claim was false for this path.
pub fn record_stream_runtime_error(last_error: &Mutex<Option<String>>, stage_flag: &AtomicU8, message: String) {
    *last_error.lock().unwrap() = Some(message);
    stage_flag.store(stage::FAILED, Ordering::SeqCst);
}

/// Downsamples `samples` (recorded at `native_rate`) to
/// `TRANSCRIPTION_SAMPLE_RATE` when needed and encodes them as a WAV,
/// exactly like `AudioRecorder::stop()`'s own downsample-then-encode
/// step. `native_rate == 0` (never learned \u2014 the device never opened
/// successfully) is treated as already-16kHz so a zero-sample/zero-rate
/// session still produces a valid, empty WAV instead of panicking in
/// `downsample`'s ratio math. Returns the encoded WAV bytes and the
/// final (possibly downsampled) sample count for `CaptureStats::samples`.
pub fn finalize_wav(samples: &[f32], native_rate: u32) -> Result<(Vec<u8>, usize), String> {
    let native_rate = if native_rate == 0 { TRANSCRIPTION_SAMPLE_RATE } else { native_rate };
    let (final_samples, final_rate) = if native_rate > TRANSCRIPTION_SAMPLE_RATE {
        (downsample(samples, native_rate, TRANSCRIPTION_SAMPLE_RATE), TRANSCRIPTION_SAMPLE_RATE)
    } else {
        (samples.to_vec(), native_rate)
    };
    let wav = samples_to_wav(&final_samples, final_rate).map_err(|e| e.to_string())?;
    Ok((wav, final_samples.len()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accumulate_capped_appends_below_cap_without_hitting() {
        let mut buffer = Vec::new();
        let (rms, hit) = accumulate_capped(&mut buffer, &[0.5, -0.5, 0.5, -0.5], 10);
        assert_eq!(buffer.len(), 4);
        assert!(!hit);
        assert!((rms - 0.5).abs() < 1e-6);
    }

    #[test]
    fn accumulate_capped_stops_growing_past_the_cap_and_reports_hit() {
        let mut buffer = vec![0.0; 3];
        let (_, hit) = accumulate_capped(&mut buffer, &[1.0, 1.0, 1.0], 4);
        assert_eq!(buffer.len(), 4, "must stop at exactly the cap, not grow past it");
        assert!(hit, "a chunk that reaches/exceeds the cap must report hit");
    }

    #[test]
    fn accumulate_capped_no_hit_when_buffer_already_below_cap_after_chunk() {
        let mut buffer = Vec::new();
        let (_, hit) = accumulate_capped(&mut buffer, &[0.1, 0.2], 10);
        assert!(!hit);
    }

    #[test]
    fn accumulate_capped_rms_still_computed_once_cap_is_hit() {
        // The visualizer must keep working after the cap: RMS reflects
        // the whole incoming chunk even though only part of it (or none
        // of it) was actually buffered.
        let mut buffer = vec![0.0; 2];
        let (rms, hit) = accumulate_capped(&mut buffer, &[1.0, 1.0], 2);
        assert!(hit);
        assert_eq!(buffer.len(), 2, "already at cap before this chunk arrived -- nothing more buffered");
        assert!((rms - 1.0).abs() < 1e-6, "RMS of an all-1.0 chunk is 1.0 regardless of buffering");
    }

    #[test]
    fn window_peak_accumulator_tracks_the_max_not_the_last() {
        let acc = WindowPeakAccumulator::default();
        acc.observe(0.1);
        acc.observe(0.9);
        acc.observe(0.3);
        assert!((acc.take_peak() - 0.9).abs() < 1e-6);
    }

    #[test]
    fn window_peak_accumulator_resets_after_take() {
        let acc = WindowPeakAccumulator::default();
        acc.observe(0.7);
        let _ = acc.take_peak();
        assert_eq!(acc.take_peak(), 0.0, "take_peak must reset to 0.0 for the next window");
    }

    #[test]
    fn finalize_wav_downsamples_from_48k_to_16k() {
        let samples = vec![0.5f32; 48_000]; // 1s @ 48kHz
        let (wav, count) = finalize_wav(&samples, 48_000).unwrap();
        assert_eq!(&wav[0..4], b"RIFF");
        // ~1s @ 16kHz = ~16000 samples (linear-interp downsample, allow slack).
        assert!((count as i64 - 16_000).abs() < 10, "got {count} samples");
    }

    #[test]
    fn finalize_wav_leaves_already_16k_samples_untouched() {
        let samples = vec![0.25f32; 1_600];
        let (wav, count) = finalize_wav(&samples, 16_000).unwrap();
        assert_eq!(count, 1_600);
        assert_eq!(&wav[0..4], b"RIFF");
    }

    #[test]
    fn level_sample_from_peak_rms_equals_peak_and_is_nonzero() {
        let acc = WindowPeakAccumulator::default();
        acc.observe(0.5);
        let peak = acc.take_peak();
        let sample = level_sample_from_peak(peak, false, false);
        assert_ne!(sample.rms, 0.0, "H1 regression: rms must not be the always-zero second take_peak() call");
        assert_eq!(sample.rms, sample.peak, "rms and peak must come from the same single reading");
        assert!((sample.rms - 0.5).abs() < 1e-6);
    }

    #[test]
    fn level_sample_from_peak_carries_muted_and_cap_hit_through() {
        let sample = level_sample_from_peak(0.3, true, true);
        assert!(sample.muted);
        assert!(sample.cap_hit);
    }

    #[test]
    fn scale_cap_samples_scales_16k_cap_to_native_rate() {
        assert_eq!(scale_cap_samples(16_000, 48_000), 48_000, "1s cap at 16k must become 1s (48_000 samples) at 48k");
        assert_eq!(scale_cap_samples(16_000, 16_000), 16_000, "no-op when native rate already matches 16k");
    }

    #[test]
    fn scale_cap_samples_usize_max_passes_through_unscaled() {
        assert_eq!(scale_cap_samples(usize::MAX, 48_000), usize::MAX, "\"no cap\" must not overflow-multiply");
    }

    #[test]
    fn scale_cap_samples_zero_native_rate_passes_through_unscaled() {
        assert_eq!(scale_cap_samples(1_000, 0), 1_000, "native rate not yet known -- safe unscaled default");
    }

    #[test]
    fn record_stream_runtime_error_sets_last_error_and_failed_stage() {
        let last_error: Mutex<Option<String>> = Mutex::new(None);
        let stage_flag = AtomicU8::new(stage::RUNNING);

        record_stream_runtime_error(&last_error, &stage_flag, "device unplugged".to_string());

        assert_eq!(*last_error.lock().unwrap(), Some("device unplugged".to_string()));
        assert_eq!(stage_flag.load(Ordering::SeqCst), stage::FAILED);
    }

    /// `[ADO-4]` happy path: while `stage` stays `RUNNING` the whole
    /// time, `sleep_while_running` must sleep the full `total` in
    /// `slice`-sized increments (same cadence as today's fixed sleep).
    #[test]
    fn sleep_while_running_sleeps_the_full_interval_when_stage_stays_running() {
        let stage_flag = AtomicU8::new(stage::RUNNING);
        let mut slices = Vec::new();
        sleep_while_running(&stage_flag, Duration::from_millis(250), Duration::from_millis(25), |d| slices.push(d));
        assert_eq!(slices, vec![Duration::from_millis(25); 10], "10 * 25ms == 250ms, same total cadence as before");
    }

    /// `[ADO-4]` regression: once `stage` flips away from `RUNNING`
    /// (`stop()` sets it to `STOPPED` before joining this thread),
    /// `sleep_while_running` must return after at most one slice instead
    /// of completing the full interval -- this is what bounds `stop()`'s
    /// `level_thread.join()` wait to one slice instead of the whole 250ms.
    #[test]
    fn sleep_while_running_stops_early_once_stage_leaves_running() {
        let stage_flag = AtomicU8::new(stage::RUNNING);
        let mut slept = 0;
        sleep_while_running(&stage_flag, Duration::from_millis(250), Duration::from_millis(25), |_| {
            slept += 1;
            stage_flag.store(stage::STOPPED, Ordering::SeqCst);
        });
        assert_eq!(slept, 1, "must stop after the first slice once stage is no longer RUNNING");
    }

    #[test]
    fn finalize_wav_zero_native_rate_treated_as_16k() {
        // A session where the device never actually opened successfully
        // (native_rate never learned) must still produce a valid WAV
        // instead of panicking in downsample's ratio math.
        let (wav, count) = finalize_wav(&[], 0).unwrap();
        assert_eq!(count, 0);
        assert_eq!(&wav[0..4], b"RIFF");
    }
}
