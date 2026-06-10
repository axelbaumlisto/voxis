//! Proof of Concept test for stream.pause() on macOS.
//!
//! Tests whether cpal's pause() can be used to quickly release the microphone
//! instead of dropping the stream (which takes 100-400ms on macOS).
//!
//! Run with: cargo test --test audio_pause_poc -- --nocapture

#[cfg(target_os = "macos")]
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
#[cfg(target_os = "macos")]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(target_os = "macos")]
use std::sync::Arc;
#[cfg(target_os = "macos")]
use std::time::{Duration, Instant};

/// Test that pause() releases the microphone quickly on macOS.
///
/// Expected behavior:
/// - pause() should complete in < 50ms
/// - After pause(), another app should be able to use the microphone
/// - play() should be able to resume recording
#[test]
#[cfg(target_os = "macos")]
fn test_pause_releases_mic_fast() {
    let host = cpal::default_host();

    let device = match host.default_input_device() {
        Some(d) => d,
        None => {
            eprintln!("Skipping test: no input device available");
            return;
        }
    };

    let config = match device.default_input_config() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Skipping test: cannot get config: {}", e);
            return;
        }
    };

    let is_capturing = Arc::new(AtomicBool::new(false));
    let is_capturing_clone = Arc::clone(&is_capturing);

    let stream_config = config.clone().into();
    let stream = device
        .build_input_stream(
            &stream_config,
            move |_data: &[f32], _: &cpal::InputCallbackInfo| {
                is_capturing_clone.store(true, Ordering::SeqCst);
            },
            |err| eprintln!("Stream error: {}", err),
            None,
        )
        .expect("Failed to build stream");

    // 1. Start recording
    stream.play().expect("Failed to start stream");
    std::thread::sleep(Duration::from_millis(100));

    // Verify we're capturing
    assert!(
        is_capturing.load(Ordering::SeqCst),
        "Should be capturing audio"
    );

    // 2. Measure pause() time
    let start = Instant::now();
    stream.pause().expect("pause() should succeed on macOS");
    let pause_elapsed = start.elapsed();

    eprintln!("pause() took {:?}", pause_elapsed);

    // CRITICAL: pause() должен быть быстрым
    assert!(
        pause_elapsed < Duration::from_millis(50),
        "pause() took {:?}, expected < 50ms",
        pause_elapsed
    );

    // 3. Reset capture flag
    is_capturing.store(false, Ordering::SeqCst);
    std::thread::sleep(Duration::from_millis(50));

    // After pause, callback should not be called
    assert!(
        !is_capturing.load(Ordering::SeqCst),
        "Callback should not be called after pause()"
    );

    // 4. Resume with play()
    let play_start = Instant::now();
    stream.play().expect("play() after pause() should succeed");
    let play_elapsed = play_start.elapsed();

    eprintln!("play() after pause() took {:?}", play_elapsed);

    // play() может быть медленнее чем pause() - это нормально
    // Главное что это происходит при START записи, а не при STOP
    // On macOS, play() after pause() can take 100-300ms due to CoreAudio
    assert!(
        play_elapsed < Duration::from_millis(400),
        "play() took {:?}, expected < 400ms",
        play_elapsed
    );

    // Give time to capture
    std::thread::sleep(Duration::from_millis(100));

    // Verify we're capturing again
    assert!(
        is_capturing.load(Ordering::SeqCst),
        "Should be capturing again after play()"
    );

    // 5. Final pause before drop
    stream.pause().expect("Final pause should succeed");

    // 6. Measure drop time for comparison
    let drop_start = Instant::now();
    drop(stream);
    let drop_elapsed = drop_start.elapsed();

    eprintln!("drop(stream) took {:?}", drop_elapsed);

    // drop может быть медленным, просто логируем
    if drop_elapsed > Duration::from_millis(100) {
        eprintln!(
            "WARNING: drop took {:?} - this is the problem we're solving",
            drop_elapsed
        );
    }
}

/// Compare pause() vs drop() performance.
#[test]
#[cfg(target_os = "macos")]
fn test_compare_pause_vs_drop() {
    let host = cpal::default_host();

    let device = match host.default_input_device() {
        Some(d) => d,
        None => {
            eprintln!("Skipping test: no input device available");
            return;
        }
    };

    let config = match device.default_input_config() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Skipping test: cannot get config: {}", e);
            return;
        }
    };

    // Test 1: pause() time
    {
        let stream_config = config.clone().into();
        let stream = device
            .build_input_stream(
                &stream_config,
                |_data: &[f32], _: &cpal::InputCallbackInfo| {},
                |_| {},
                None,
            )
            .expect("Failed to build stream");

        stream.play().expect("play failed");
        std::thread::sleep(Duration::from_millis(50));

        let start = Instant::now();
        stream.pause().expect("pause failed");
        let pause_time = start.elapsed();

        eprintln!("Test 1 - pause() time: {:?}", pause_time);

        drop(stream);
    }

    // Small delay between tests
    std::thread::sleep(Duration::from_millis(100));

    // Test 2: direct drop() time (without pause)
    {
        let stream_config = config.clone().into();
        let stream = device
            .build_input_stream(
                &stream_config,
                |_data: &[f32], _: &cpal::InputCallbackInfo| {},
                |_| {},
                None,
            )
            .expect("Failed to build stream");

        stream.play().expect("play failed");
        std::thread::sleep(Duration::from_millis(50));

        let start = Instant::now();
        drop(stream);
        let drop_time = start.elapsed();

        eprintln!("Test 2 - direct drop() time: {:?}", drop_time);
    }

    // Small delay
    std::thread::sleep(Duration::from_millis(100));

    // Test 3: pause() then drop() time
    {
        let stream_config = config.clone().into();
        let stream = device
            .build_input_stream(
                &stream_config,
                |_data: &[f32], _: &cpal::InputCallbackInfo| {},
                |_| {},
                None,
            )
            .expect("Failed to build stream");

        stream.play().expect("play failed");
        std::thread::sleep(Duration::from_millis(50));

        let pause_start = Instant::now();
        stream.pause().expect("pause failed");
        let pause_time = pause_start.elapsed();

        let drop_start = Instant::now();
        drop(stream);
        let drop_after_pause_time = drop_start.elapsed();

        eprintln!("Test 3 - pause() then drop():");
        eprintln!("  pause(): {:?}", pause_time);
        eprintln!("  drop() after pause: {:?}", drop_after_pause_time);
        eprintln!("  total: {:?}", pause_time + drop_after_pause_time);
    }
}

/// Test multiple pause/play cycles work correctly.
#[test]
#[cfg(target_os = "macos")]
fn test_multiple_pause_play_cycles() {
    let host = cpal::default_host();

    let device = match host.default_input_device() {
        Some(d) => d,
        None => {
            eprintln!("Skipping test: no input device available");
            return;
        }
    };

    let config = match device.default_input_config() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Skipping test: cannot get config: {}", e);
            return;
        }
    };

    let stream_config = config.into();
    let sample_count = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let sample_count_clone = Arc::clone(&sample_count);

    let stream = device
        .build_input_stream(
            &stream_config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                sample_count_clone.fetch_add(data.len() as u64, Ordering::SeqCst);
            },
            |_| {},
            None,
        )
        .expect("Failed to build stream");

    for cycle in 0..5 {
        // Start
        stream.play().expect("play should succeed");
        std::thread::sleep(Duration::from_millis(50));

        let samples_after_play = sample_count.load(Ordering::SeqCst);

        // Pause
        let pause_start = Instant::now();
        stream.pause().expect("pause should succeed");
        let pause_time = pause_start.elapsed();

        eprintln!(
            "Cycle {}: pause() took {:?}, samples captured: {}",
            cycle, pause_time, samples_after_play
        );

        assert!(
            pause_time < Duration::from_millis(50),
            "Cycle {}: pause() took {:?}, expected < 50ms",
            cycle,
            pause_time
        );

        // Small pause between cycles
        std::thread::sleep(Duration::from_millis(20));
    }

    // Cleanup
    drop(stream);
}
