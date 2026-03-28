//! Integration tests for audio recording lifecycle.
//!
//! These tests require a real microphone to be present.
//! They verify that the microphone is properly released after recording stops.
//!
//! Run with: cargo test --test audio_integration
//! Skip if no microphone: cargo test --test audio_integration -- --ignored

use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use voice_lib::audio::AudioRecorder;

/// Test that recorder properly releases microphone after stop.
/// Verifies by attempting multiple start/stop cycles.
#[test]
fn test_microphone_release_on_stop() {
    let recorder = Arc::new(AudioRecorder::new());

    // Initial state
    assert!(!recorder.is_recording());
    assert_eq!(recorder.audio_level(), 0);

    // Attempt to start recording - this may fail if no microphone is available
    let start_result = recorder.start("default");

    if start_result.is_err() {
        eprintln!(
            "Skipping test_microphone_release_on_stop: no microphone available ({:?})",
            start_result.err()
        );
        return;
    }

    // Recording started successfully
    assert!(recorder.is_recording());

    // Record for a moment
    thread::sleep(Duration::from_millis(100));

    // Stop recording
    let stop_result = recorder.stop();
    assert!(stop_result.is_ok(), "stop() should succeed");

    // CRITICAL ASSERTION: is_recording must be false IMMEDIATELY
    assert!(
        !recorder.is_recording(),
        "is_recording() must be false immediately after stop()"
    );

    // audio_level must be 0
    assert_eq!(
        recorder.audio_level(),
        0,
        "audio_level() must be 0 after stop()"
    );

    // VERIFICATION: Can we start recording again?
    // This proves the microphone was released.
    let start_again = recorder.start("default");
    assert!(
        start_again.is_ok(),
        "Should be able to start recording again after stop() - microphone should be released"
    );

    // Clean up
    let _ = recorder.stop();
}

/// Test rapid start/stop cycles to verify no resource leaks.
/// Note: First cycle takes longer due to CoreAudio initialization (~500ms on macOS).
/// Subsequent cycles should be faster due to stream reuse.
#[test]
fn test_rapid_start_stop_no_leaks() {
    let recorder = Arc::new(AudioRecorder::new());

    for cycle in 0..5 {
        let start_result = recorder.start("default");

        if start_result.is_err() {
            eprintln!(
                "Skipping test_rapid_start_stop_no_leaks: no microphone available ({:?})",
                start_result.err()
            );
            return;
        }

        // Wait for stream to initialize on first cycle, then brief recording
        let wait_time = if cycle == 0 { 600 } else { 50 };
        thread::sleep(Duration::from_millis(wait_time));

        let stop_result = recorder.stop();
        assert!(
            stop_result.is_ok(),
            "Cycle {}: stop() should succeed",
            cycle
        );

        // Verify clean state
        assert!(
            !recorder.is_recording(),
            "Cycle {}: should not be recording after stop()",
            cycle
        );
    }
}

/// Test that stop() completes in reasonable time (not hanging).
/// Note: This test waits for stream initialization before measuring stop time.
/// On macOS, first build_stream takes ~500ms (CoreAudio init), plus stream.play()
/// can take additional time on first invocation.
#[test]
fn test_stop_completes_quickly() {
    let recorder = Arc::new(AudioRecorder::new());

    let start_result = recorder.start("default");
    if start_result.is_err() {
        eprintln!("Skipping test: no microphone available");
        return;
    }

    // Wait for stream initialization (CoreAudio takes ~500-800ms on first call)
    // Use longer wait to ensure is_ready is set before measuring stop time
    thread::sleep(Duration::from_millis(1000));

    // Measure stop time - should be faster than old implementation
    // On macOS, pause() + wait takes ~10-300ms depending on CoreAudio state
    // But if stream is still initializing (is_ready=false), timeout is 3s
    let start = Instant::now();
    let stop_result = recorder.stop();
    let elapsed = start.elapsed();

    assert!(stop_result.is_ok());
    // Allow up to 500ms for CoreAudio pause on first invocation
    // Subsequent calls should be much faster (~10-50ms)
    assert!(
        elapsed < Duration::from_millis(600),
        "stop() took {:?}, expected < 600ms",
        elapsed
    );
}

/// Test concurrent access to recorder doesn't cause issues.
#[test]
fn test_concurrent_is_recording_queries() {
    let recorder = Arc::new(AudioRecorder::new());

    let start_result = recorder.start("default");
    if start_result.is_err() {
        eprintln!("Skipping test: no microphone available");
        return;
    }

    // Spawn threads that query is_recording while recording
    let mut handles = vec![];
    for _ in 0..10 {
        let r = Arc::clone(&recorder);
        let handle = thread::spawn(move || {
            for _ in 0..100 {
                let _ = r.is_recording();
                let _ = r.audio_level();
            }
        });
        handles.push(handle);
    }

    // Wait a bit then stop
    thread::sleep(Duration::from_millis(50));
    let _ = recorder.stop();

    // All threads should complete without panic
    for handle in handles {
        handle.join().expect("Thread should not panic");
    }
}

/// Test that audio_level returns values during recording.
#[test]
fn test_audio_level_during_recording() {
    let recorder = Arc::new(AudioRecorder::new());

    let start_result = recorder.start("default");
    if start_result.is_err() {
        eprintln!("Skipping test: no microphone available");
        return;
    }

    // Give some time for audio data to be captured
    thread::sleep(Duration::from_millis(200));

    // Check audio_level is being updated (may be 0 if very quiet environment)
    // We just verify it doesn't panic
    let level = recorder.audio_level();
    assert!(level <= 100, "audio_level should be 0-100, got {}", level);

    let _ = recorder.stop();

    // After stop, level should be 0
    assert_eq!(recorder.audio_level(), 0);
}
