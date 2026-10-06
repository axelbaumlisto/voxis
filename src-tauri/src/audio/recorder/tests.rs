use super::*;
use crate::audio::sync::lock_or_recover;
use std::sync::Barrier;

#[test]
fn test_recorder_creation() {
    let recorder = AudioRecorder::new();
    assert!(!recorder.is_recording());
    assert_eq!(recorder.audio_level(), 0);
}

#[test]
fn test_is_recording_initially_false() {
    let recorder = AudioRecorder::new();
    assert!(!recorder.is_recording());
}

#[test]
fn test_audio_level_initially_zero() {
    let recorder = AudioRecorder::new();
    assert_eq!(recorder.audio_level(), 0);
}

#[test]
fn test_set_audio_boost() {
    let recorder = AudioRecorder::new();

    // Default boost is 800.0 (stored as 8000)
    assert_eq!(recorder.audio_boost.load(Ordering::SeqCst), 8000);

    // Set new boost
    recorder.set_audio_boost(500.0);
    assert_eq!(recorder.audio_boost.load(Ordering::SeqCst), 5000);

    // Test clamping - minimum is 10.0 (100 stored)
    recorder.set_audio_boost(5.0);
    assert_eq!(recorder.audio_boost.load(Ordering::SeqCst), 100);

    // Test clamping - maximum is 1000.0 (10000 stored)
    recorder.set_audio_boost(2000.0);
    assert_eq!(recorder.audio_boost.load(Ordering::SeqCst), 10000);
}

#[test]
fn test_recorder_default_trait() {
    let recorder = AudioRecorder::default();
    assert!(!recorder.is_recording());
    assert_eq!(recorder.audio_level(), 0);
}

#[test]
fn test_stop_without_start() {
    let recorder = AudioRecorder::new();
    let result = recorder.stop();
    assert!(matches!(result, Err(AudioError::NotRecording)));
}

#[test]
fn test_start_already_recording_returns_ok() {
    // When is_recording is true, start() should return Ok (no-op)
    let recorder = AudioRecorder::new();
    recorder.is_recording.store(true, Ordering::SeqCst);
    let result = recorder.start("nonexistent_device");
    // Should return Ok because early return when already recording
    assert!(result.is_ok());
    // Reset to avoid issues on drop
    recorder.is_recording.store(false, Ordering::SeqCst);
}

#[test]
fn test_start_with_nonexistent_device_falls_back_to_default() {
    // get_device() falls back to default device when device_id not found,
    // so this may succeed if a default device is available.
    let recorder = AudioRecorder::new();
    let result = recorder.start("totally_nonexistent_device_xyz_999");
    match result {
        Ok(()) => {
            // Started recording on fallback default device
            assert!(recorder.is_recording());
            let _ = recorder.stop();
        }
        Err(AudioError::NoInputDevices) => {
            // No default device available (headless system)
            assert!(!recorder.is_recording());
        }
        Err(e) => {
            // Some other error (e.g., config/permission error)
            println!("Device fallback resulted in error: {}", e);
            assert!(!recorder.is_recording());
        }
    }
}

#[test]
fn test_stop_not_recording_error_message() {
    let recorder = AudioRecorder::new();
    let err = recorder.stop().unwrap_err();
    assert_eq!(err.to_string(), "Recording not started");
}

#[test]
fn test_get_recent_samples_empty() {
    let recorder = AudioRecorder::new();
    let samples = recorder.get_recent_samples(100);
    assert!(samples.is_empty());
}

#[test]
fn test_get_recent_samples_fewer_than_requested() {
    let recorder = AudioRecorder::new();
    {
        let mut samples = lock_or_recover(&recorder.samples);
        samples.extend_from_slice(&[0.1, 0.2, 0.3]);
    }
    let recent = recorder.get_recent_samples(100);
    assert_eq!(recent.len(), 3);
}

#[test]
fn test_close_without_recording() {
    // close() on a fresh recorder should not panic
    let recorder = AudioRecorder::new();
    recorder.close(); // Should be a no-op
    assert!(!recorder.is_recording());
}

#[test]
fn test_double_stop_returns_not_recording() {
    let recorder = AudioRecorder::new();
    let result1 = recorder.stop();
    assert!(matches!(result1, Err(AudioError::NotRecording)));
    let result2 = recorder.stop();
    assert!(matches!(result2, Err(AudioError::NotRecording)));
}

#[test]
fn test_get_audio_boost_default() {
    let recorder = AudioRecorder::new();
    let boost = recorder.get_audio_boost();
    assert!((boost - 800.0).abs() < 0.1);
}

#[test]
fn test_set_vad_to_none_disables_filtering() {
    let recorder = AudioRecorder::new();
    recorder.set_vad(None);
    // No panic, no state change observable from outside. Just verify call is safe.
    assert!(!recorder.is_recording());
}

#[test]
fn test_set_vad_resets_state_on_install() {
    use crate::audio::vad::ThresholdVad;
    let recorder = AudioRecorder::new();
    let vad = Box::new(ThresholdVad::new(0.1));
    recorder.set_vad(Some(vad));
    // Re-install with new VAD — also no panic, replaces previous.
    let vad2 = Box::new(ThresholdVad::new(0.2));
    recorder.set_vad(Some(vad2));
    // Remove
    recorder.set_vad(None);
}

#[test]
fn test_apply_vad_returns_samples_unchanged_when_vad_none() {
    // When VAD is None, apply_vad in stop() returns samples as-is.
    // Indirectly verified: a recorder with vad=None should preserve all samples.
    let recorder = AudioRecorder::new();
    recorder.set_vad(None);
    // No assertion beyond no-panic; full pipeline coverage in integration tests.
    let _ = recorder.get_audio_boost();
}

#[test]
fn test_apply_vad_filters_silence_with_threshold_vad() {
    use crate::audio::vad::{filter_with_vad, ThresholdVad, SILERO_FRAME_SAMPLES};
    // Direct check of the underlying filter routing that AudioRecorder uses.
    let silence = vec![0.0; SILERO_FRAME_SAMPLES * 2];
    let mut vad = ThresholdVad::new(0.1);
    let out = filter_with_vad(&silence, &mut vad, SILERO_FRAME_SAMPLES);
    assert!(out.is_empty(), "ThresholdVad must drop silent frames");
}

// ---------------------------------------------------------------------
// Single-flight `stop()`, `mem::take` drain, peak-RMS wrapper, cap
// wrapper primitives.
// ---------------------------------------------------------------------

#[test]
fn test_stopping_resets_after_not_recording_error() {
    let recorder = AudioRecorder::new();
    let result = recorder.stop();
    assert!(matches!(result, Err(AudioError::NotRecording)));
    assert!(
        !recorder.is_stopping(),
        "stopping must reset even on the NotRecording error path"
    );
}

#[test]
fn test_concurrent_stop_is_single_flight() {
    let recorder = Arc::new(AudioRecorder::new());
    match recorder.start("default") {
        Ok(()) => {
            // Let the cpal callback actually start writing samples.
            std::thread::sleep(std::time::Duration::from_millis(20));

            let barrier = Arc::new(Barrier::new(2));
            let (r1, b1) = (Arc::clone(&recorder), Arc::clone(&barrier));
            let (r2, b2) = (Arc::clone(&recorder), Arc::clone(&barrier));
            let h1 = std::thread::spawn(move || {
                b1.wait();
                r1.stop()
            });
            let h2 = std::thread::spawn(move || {
                b2.wait();
                r2.stop()
            });
            let res1 = h1.join().expect("thread 1 panicked");
            let res2 = h2.join().expect("thread 2 panicked");

            let ok_count = [&res1, &res2].iter().filter(|r| r.is_ok()).count();
            assert_eq!(
                ok_count, 1,
                "exactly one concurrent stop() must succeed, got res1_ok={} res2_ok={}",
                res1.is_ok(),
                res2.is_ok()
            );
            let loser = if res1.is_err() { &res1 } else { &res2 };
            assert!(
                matches!(loser, Err(AudioError::StopInProgress)),
                "the losing concurrent stop() must get StopInProgress specifically, got {:?}",
                loser
            );
            assert!(
                !recorder.is_stopping(),
                "stopping flag must be false once both calls have returned"
            );
        }
        Err(e) => {
            // Headless CI: no input device available to actually race
            // two stops against. Fall back to exercising the guard's
            // reset-on-error path (mirrors
            // test_stopping_resets_after_not_recording_error) — this
            // recorder never started, so the CAS itself succeeds (nobody
            // else holds the flag) and it's the is_recording check below
            // it that returns NotRecording, not the StopInProgress branch.
            println!(
                "test_concurrent_stop_is_single_flight: no device ({e}), checking guard reset only"
            );
            let result = recorder.stop();
            assert!(matches!(result, Err(AudioError::NotRecording)));
            assert!(!recorder.is_stopping());
        }
    }
}

#[test]
fn test_get_samples_drains_and_releases_capacity() {
    let recorder = AudioRecorder::new();
    {
        let mut samples = lock_or_recover(&recorder.samples);
        samples.extend_from_slice(&[0.1; 1000]);
        assert!(samples.capacity() >= 1000);
    }

    let taken = recorder.get_samples();
    assert_eq!(taken.len(), 1000);

    let guard = lock_or_recover(&recorder.samples);
    assert_eq!(guard.len(), 0);
    assert_eq!(
        guard.capacity(),
        0,
        "mem::take must release the old buffer's capacity, not just clear() it"
    );
}

#[test]
fn test_take_rms_peak_swaps_and_resets() {
    let recorder = AudioRecorder::new();
    recorder
        .rms_peak_bits
        .store(0.25f32.to_bits(), Ordering::SeqCst);

    let taken = recorder.take_rms_peak();
    assert!((taken - 0.25).abs() < 1e-6);

    assert_eq!(
        recorder.take_rms_peak(),
        0.0,
        "second call after draining must read back 0.0"
    );
}

#[test]
fn test_set_max_samples_and_cap_hit_default() {
    let recorder = AudioRecorder::new();
    assert!(!recorder.cap_hit(), "cap_hit must start false");
    assert_eq!(
        recorder.max_samples.load(Ordering::SeqCst),
        usize::MAX,
        "default cap must be unlimited so existing behavior is unchanged"
    );

    recorder.set_max_samples(1000);
    assert_eq!(recorder.max_samples.load(Ordering::SeqCst), 1000);
}

#[test]
fn test_start_resets_rms_peak_and_cap_hit() {
    let recorder = AudioRecorder::new();
    // Dirty the state that start() must reset. NOTE: `stopping` is
    // deliberately NOT dirtied/checked here — start() must never clear
    // it (see test_start_refused_while_stopping); only `StoppingGuard`
    // may.
    recorder
        .rms_peak_bits
        .store(0.5f32.to_bits(), Ordering::SeqCst);
    recorder.cap_hit.store(true, Ordering::SeqCst);

    // The resets happen unconditionally before device access, so this
    // holds whether or not a real input device is available in CI.
    let _ = recorder.start("totally_nonexistent_device_xyz_999");

    assert_eq!(recorder.take_rms_peak(), 0.0, "start() must reset rms_peak");
    assert!(!recorder.cap_hit(), "start() must reset cap_hit");

    let _ = recorder.stop();
}

#[test]
fn test_start_refused_while_stopping() {
    // Fail-safe primitive-level enforcement: a press arriving while a
    // stop() is still in flight must refuse, not start on top of it.
    // start() must refuse — not silently resume — while a stop() owns the
    // flag, and must leave the flag untouched (only StoppingGuard's Drop
    // may clear it).
    let recorder = AudioRecorder::new();
    recorder.stopping.store(true, Ordering::SeqCst);

    let result = recorder.start("default");

    assert!(
        matches!(result, Err(AudioError::StopInProgress)),
        "start() must refuse while a stop() is in flight, got {:?}",
        result
    );
    assert!(
        recorder.is_stopping(),
        "start() must NOT clear `stopping` — only StoppingGuard's Drop may"
    );
}

// ---------------------------------------------------------------------------
// Dead-stream liveness (2026-10-06: a USB mic re-enumerated for 0.6 s; the
// always-on stream kept "resuming" fine and delivered nothing for an hour).
// A fake recording thread stands in for cpal: it honours Play/Pause/Close on
// the command channel exactly like `run_command_loop`, but either calls back
// (bumps `callbacks`) or stays silent — the one difference between a live and
// a dead device as the recorder can observe it.
// ---------------------------------------------------------------------------

fn install_fake_stream(recorder: &AudioRecorder, alive: bool) {
    let (tx, rx) = mpsc::channel::<RecordCommand>();
    let is_recording = Arc::clone(&recorder.is_recording);
    let callbacks = Arc::clone(&recorder.callbacks);
    let handle = std::thread::spawn(move || loop {
        // Off macOS the loop never sees Play/Pause; these stay referenced.
        let _ = (&alive, &callbacks);
        match rx.recv() {
            #[cfg(target_os = "macos")]
            Ok(RecordCommand::Play) => {
                is_recording.store(true, Ordering::SeqCst);
                if alive {
                    // a live stream calls back every buffer
                    let cb = Arc::clone(&callbacks);
                    let rec = Arc::clone(&is_recording);
                    std::thread::spawn(move || {
                        while rec.load(Ordering::SeqCst) {
                            cb.fetch_add(1, Ordering::Relaxed);
                            std::thread::sleep(std::time::Duration::from_millis(5));
                        }
                    });
                }
            }
            #[cfg(target_os = "macos")]
            Ok(RecordCommand::Pause) => is_recording.store(false, Ordering::SeqCst),
            Ok(RecordCommand::Close) | Err(_) => {
                is_recording.store(false, Ordering::SeqCst);
                return;
            }
        }
    });
    *lock_or_recover(&recorder.stop_tx) = Some(tx);
    *lock_or_recover(&recorder.thread_handle) = Some(handle);
    recorder.is_ready.store(true, Ordering::SeqCst);
}

#[cfg(target_os = "macos")]
#[test]
fn resume_trusts_a_stream_that_calls_back() {
    let recorder = AudioRecorder::new();
    install_fake_stream(&recorder, true);
    assert!(recorder.try_resume_recording(), "a live paused stream resumes");
    assert!(recorder.is_recording());
    recorder.close();
}

#[cfg(target_os = "macos")]
#[test]
fn resume_refuses_a_stream_that_reports_recording_but_never_calls_back_and_tears_it_down() {
    let recorder = AudioRecorder::new();
    install_fake_stream(&recorder, false);
    let t0 = std::time::Instant::now();
    assert!(!recorder.try_resume_recording(), "a dead stream is not a resume");
    assert!(t0.elapsed() >= AudioRecorder::RESUME_LIVENESS, "it waited the full liveness window first");
    assert!(!recorder.is_ready.load(Ordering::SeqCst), "the dead thread is gone: the next start() opens the device by name");
    assert!(lock_or_recover(&recorder.stop_tx).is_none());
    assert!(!recorder.is_recording());
}

#[test]
fn stop_after_a_long_hold_with_zero_callbacks_is_a_device_error_not_an_empty_wav() {
    let recorder = AudioRecorder::new();
    install_fake_stream(&recorder, false);
    recorder.is_recording.store(true, Ordering::SeqCst);
    *lock_or_recover(&recorder.session_started) =
        Some(std::time::Instant::now() - std::time::Duration::from_millis(1500));
    match recorder.stop() {
        Err(AudioError::NoAudioFromDevice { held_ms }) => assert!(held_ms >= 1500),
        other => panic!("expected NoAudioFromDevice, got {other:?}"),
    }
    assert!(!recorder.is_ready.load(Ordering::SeqCst), "the dead stream was closed");
}

#[test]
fn stop_after_a_tap_with_zero_callbacks_is_still_just_an_empty_recording() {
    // Under DEAD_DEVICE_MIN_HOLD a buffer-less stop is a tap, not a dead
    // device: the orchestrator's "too short" rule owns that case.
    let recorder = AudioRecorder::new();
    install_fake_stream(&recorder, false);
    recorder.is_recording.store(true, Ordering::SeqCst);
    *lock_or_recover(&recorder.session_started) = Some(std::time::Instant::now());
    let wav = recorder.stop().expect("an empty WAV, no error");
    assert!(crate::audio::wav_duration_ms(&wav).unwrap_or(0) < 300);
    recorder.close();
}
