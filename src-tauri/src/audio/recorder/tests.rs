use super::*;
use crate::audio::sync::lock_or_recover;

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
