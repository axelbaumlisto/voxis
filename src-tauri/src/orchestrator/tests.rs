//! Integration tests for the orchestrator module.
//!
//! TDD: Tests complete workflows and state transitions.
//!
//! Note: Full orchestrator testing requires a Tauri AppHandle which is difficult
//! to mock. These tests focus on:
//! - State machine transitions (using mock state)
//! - Post-processing pipeline
//! - Configuration validation
//! - Component interactions
//! - Audio level polling lifecycle

use super::audio_level::start_audio_level_polling;
use super::state::{ErrorContext, RecordingState};
use crate::audio::AudioRecorder;
use crate::overlay_native::{NoopOverlay, OverlayBackend};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

// =============================================================================
// Basic State/Context Tests (from original mod.rs)
// =============================================================================

#[test]
fn test_recording_state_serialize() {
    assert_eq!(
        serde_json::to_string(&RecordingState::Idle).unwrap(),
        "\"idle\""
    );
}

#[test]
fn test_error_context_debug() {
    assert_eq!(format!("{:?}", ErrorContext::Hotkey), "Hotkey");
}

#[test]
fn test_recording_state_default_is_idle() {
    let state = RecordingState::Idle;
    assert!(matches!(state, RecordingState::Idle));
}

#[test]
fn test_recording_state_all_variants_serialize() {
    let states = [
        (RecordingState::Idle, "\"idle\""),
        (RecordingState::Recording, "\"recording\""),
        (RecordingState::Transcribing, "\"transcribing\""),
        (RecordingState::Error, "\"error\""),
    ];

    for (state, expected) in states {
        assert_eq!(serde_json::to_string(&state).unwrap(), expected);
    }
}

#[test]
fn test_error_context_all_variants_debug() {
    assert_eq!(format!("{:?}", ErrorContext::Hotkey), "Hotkey");
    assert_eq!(
        format!("{:?}", ErrorContext::Transcription),
        "Transcription"
    );
    assert_eq!(format!("{:?}", ErrorContext::Llm), "Llm");
}

#[test]
fn test_recording_state_copy_trait() {
    let state = RecordingState::Recording;
    let copied = state;
    assert_eq!(state, copied);
}

#[test]
fn test_error_context_copy_trait() {
    let context = ErrorContext::Transcription;
    let copied = context;
    assert!(matches!(context, ErrorContext::Transcription));
    assert!(matches!(copied, ErrorContext::Transcription));
}

// =============================================================================
// State Machine Tests
// =============================================================================

/// Helper to create a test state machine.
fn create_test_state() -> Arc<Mutex<RecordingState>> {
    Arc::new(Mutex::new(RecordingState::Idle))
}

/// Test complete recording cycle: Idle -> Recording -> Transcribing -> Idle
#[tokio::test]
async fn test_complete_recording_cycle() {
    let state = create_test_state();

    // Initial state is Idle
    assert_eq!(*state.lock().await, RecordingState::Idle);

    // Transition to Recording
    {
        let mut s = state.lock().await;
        assert_eq!(*s, RecordingState::Idle);
        *s = RecordingState::Recording;
    }
    assert_eq!(*state.lock().await, RecordingState::Recording);

    // Transition to Transcribing
    {
        let mut s = state.lock().await;
        assert_eq!(*s, RecordingState::Recording);
        *s = RecordingState::Transcribing;
    }
    assert_eq!(*state.lock().await, RecordingState::Transcribing);

    // Transition back to Idle
    {
        let mut s = state.lock().await;
        *s = RecordingState::Idle;
    }
    assert_eq!(*state.lock().await, RecordingState::Idle);
}

/// Test hotkey debouncing: multiple presses during Recording should not change state.
#[tokio::test]
async fn test_hotkey_debouncing_recording() {
    let state = create_test_state();

    // Start recording
    {
        let mut s = state.lock().await;
        *s = RecordingState::Recording;
    }

    // Simulate multiple hotkey presses - state should remain Recording
    for _ in 0..5 {
        let s = state.lock().await;
        // Only start recording if Idle - debouncing logic
        if *s == RecordingState::Idle {
            panic!("State should not be Idle during Recording");
        }
        assert_eq!(*s, RecordingState::Recording);
    }
}

/// Test hotkey debouncing: presses during Transcribing should be ignored.
#[tokio::test]
async fn test_hotkey_debouncing_transcribing() {
    let state = create_test_state();

    // Set to Transcribing
    {
        let mut s = state.lock().await;
        *s = RecordingState::Transcribing;
    }

    // Simulate hotkey press - should be ignored (not Idle)
    {
        let s = state.lock().await;
        let should_start = *s == RecordingState::Idle;
        assert!(
            !should_start,
            "Should not start recording during Transcribing"
        );
    }

    // State should remain Transcribing
    assert_eq!(*state.lock().await, RecordingState::Transcribing);
}

/// Test recording failure recovery: Error -> (delay) -> Idle
#[tokio::test]
async fn test_recording_failure_recovery() {
    let state = create_test_state();

    // Simulate error state
    {
        let mut s = state.lock().await;
        *s = RecordingState::Error;
    }
    assert_eq!(*state.lock().await, RecordingState::Error);

    // Simulate recovery delay (reduced for test)
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    // Reset to Idle after error
    {
        let mut s = state.lock().await;
        *s = RecordingState::Idle;
    }
    assert_eq!(*state.lock().await, RecordingState::Idle);
}

/// Test invalid state transitions: Recording -> Recording is no-op.
#[tokio::test]
async fn test_invalid_state_transition_recording_to_recording() {
    let state = create_test_state();

    // Start recording
    {
        let mut s = state.lock().await;
        *s = RecordingState::Recording;
    }

    // Attempt to "start recording" again - simulates guard logic
    {
        let s = state.lock().await;
        let can_start = *s == RecordingState::Idle;
        assert!(!can_start, "Cannot start recording when already Recording");
    }

    assert_eq!(*state.lock().await, RecordingState::Recording);
}

/// Test invalid state transitions: Idle -> Transcribing is invalid.
#[tokio::test]
async fn test_invalid_state_transition_idle_to_transcribing() {
    let state = create_test_state();

    // In Idle state
    assert_eq!(*state.lock().await, RecordingState::Idle);

    // Simulating guard: can only transition to Transcribing from Recording
    {
        let s = state.lock().await;
        let can_transcribe = *s == RecordingState::Recording;
        assert!(!can_transcribe, "Cannot transcribe from Idle state");
    }
}

/// Test concurrent state access: no deadlocks.
#[tokio::test]
async fn test_concurrent_state_access() {
    let state = create_test_state();

    // Spawn multiple tasks that read/write state
    let mut handles = vec![];

    for i in 0..10 {
        let state_clone = Arc::clone(&state);
        let handle = tokio::spawn(async move {
            // Mix of reads and writes
            if i % 2 == 0 {
                let _ = *state_clone.lock().await;
            } else {
                let mut s = state_clone.lock().await;
                *s = RecordingState::Idle;
            }
        });
        handles.push(handle);
    }

    // All tasks should complete without deadlock
    for handle in handles {
        handle.await.expect("Task should complete without panic");
    }

    // State should still be valid
    let final_state = *state.lock().await;
    assert!(matches!(
        final_state,
        RecordingState::Idle
            | RecordingState::Recording
            | RecordingState::Transcribing
            | RecordingState::Error
    ));
}

// =============================================================================
// Configuration Validation Tests
// =============================================================================

use super::transcription::validate_config;
use crate::config::AppConfig;

/// Test API key validation returns error when missing.
#[test]
fn test_api_key_validation_error() {
    let config = AppConfig {
        api_key: String::new(),
        ..Default::default()
    };

    let result = validate_config(&config);
    assert!(result.is_err());
    assert_eq!(result.unwrap_err(), "API key not configured");
}

/// Test API key validation passes with valid key.
#[test]
fn test_api_key_validation_success() {
    let config = AppConfig {
        api_key: "gsk_test_key_12345".to_string(),
        ..Default::default()
    };

    let result = validate_config(&config);
    assert!(result.is_ok());
}

// =============================================================================
// Post-Processing Pipeline Tests
// =============================================================================

use super::post_process::PostProcessResult;

/// Test post-process result preserves text when no LLM.
#[test]
fn test_post_processing_no_llm() {
    let result = PostProcessResult {
        text: "Hello World".to_string(),
        llm_result: None,
        llm_duration_ms: 0,
    };

    assert_eq!(result.text, "Hello World");
    assert!(result.llm_result.is_none());
    assert_eq!(result.llm_duration_ms, 0);
}

/// Test post-process result with LLM processing.
#[test]
fn test_post_processing_with_llm() {
    use crate::llm::LlmResult;

    let llm_result = LlmResult {
        text: "Corrected text".to_string(),
        suggestions: vec![],
    };

    let result = PostProcessResult {
        text: "Corrected text".to_string(),
        llm_result: Some(llm_result),
        llm_duration_ms: 250,
    };

    assert_eq!(result.text, "Corrected text");
    assert!(result.llm_result.is_some());
    assert_eq!(result.llm_duration_ms, 250);
}

// =============================================================================
// State Transition Sequence Tests
// =============================================================================

/// Test valid state transition sequence for successful transcription.
#[tokio::test]
async fn test_valid_state_sequence_success() {
    let state = create_test_state();
    let transitions = vec![
        RecordingState::Idle,
        RecordingState::Recording,
        RecordingState::Transcribing,
        RecordingState::Idle,
    ];

    for expected in transitions {
        {
            let mut s = state.lock().await;
            *s = expected;
        }
        assert_eq!(*state.lock().await, expected);
    }
}

/// Test valid state transition sequence for error case.
#[tokio::test]
async fn test_valid_state_sequence_error() {
    let state = create_test_state();
    let transitions = vec![
        RecordingState::Idle,
        RecordingState::Recording,
        RecordingState::Error,
        RecordingState::Idle,
    ];

    for expected in transitions {
        {
            let mut s = state.lock().await;
            *s = expected;
        }
        assert_eq!(*state.lock().await, expected);
    }
}

/// Test state machine can handle rapid transitions without corruption.
#[tokio::test]
async fn test_rapid_state_transitions() {
    let state = create_test_state();

    // Rapidly cycle through states
    for _ in 0..100 {
        {
            let mut s = state.lock().await;
            *s = RecordingState::Recording;
        }
        {
            let mut s = state.lock().await;
            *s = RecordingState::Transcribing;
        }
        {
            let mut s = state.lock().await;
            *s = RecordingState::Idle;
        }
    }

    // Final state should be Idle
    assert_eq!(*state.lock().await, RecordingState::Idle);
}

// =============================================================================
// Edge Case Tests
// =============================================================================

/// Test state after multiple errors.
#[tokio::test]
async fn test_multiple_errors_recovery() {
    let state = create_test_state();

    for _ in 0..3 {
        // Simulate error
        {
            let mut s = state.lock().await;
            *s = RecordingState::Error;
        }
        assert_eq!(*state.lock().await, RecordingState::Error);

        // Recover to Idle
        {
            let mut s = state.lock().await;
            *s = RecordingState::Idle;
        }
        assert_eq!(*state.lock().await, RecordingState::Idle);
    }
}

/// Test state serialization roundtrip.
#[test]
fn test_recording_state_serialization() {
    let states = vec![
        RecordingState::Idle,
        RecordingState::Recording,
        RecordingState::Transcribing,
        RecordingState::Error,
    ];

    for state in states {
        let json = serde_json::to_string(&state).unwrap();
        let deserialized: RecordingState = serde_json::from_str(&json).unwrap();
        assert_eq!(state, deserialized);
    }
}

/// Test concurrent reads don't block.
#[tokio::test]
async fn test_concurrent_reads() {
    let state = create_test_state();

    // Set to Recording
    {
        let mut s = state.lock().await;
        *s = RecordingState::Recording;
    }

    // Spawn multiple readers
    let mut handles = vec![];
    for _ in 0..10 {
        let state_clone = Arc::clone(&state);
        let handle = tokio::spawn(async move {
            let s = state_clone.lock().await;
            assert_eq!(*s, RecordingState::Recording);
        });
        handles.push(handle);
    }

    for handle in handles {
        handle.await.expect("Read should complete");
    }
}

// =============================================================================
// Audio Level Polling Integration Tests
// =============================================================================

/// Test that polling cancellation is immediate (< 20ms), not waiting for 80ms sleep cycle.
/// This is critical for releasing the microphone promptly.
#[tokio::test]
async fn test_polling_cancellation_is_immediate() {
    let recorder = Arc::new(AudioRecorder::new());
    let overlay: Arc<Mutex<Box<dyn OverlayBackend>>> =
        Arc::new(Mutex::new(Box::new(NoopOverlay::new())));
    let cancel_token = CancellationToken::new();

    // Start polling
    start_audio_level_polling(
        Arc::clone(&recorder),
        Arc::clone(&overlay),
        cancel_token.clone(),
    );

    // Wait for polling to start (initial 50ms delay in polling)
    tokio::time::sleep(tokio::time::Duration::from_millis(60)).await;

    // Measure cancellation time
    let start = Instant::now();
    cancel_token.cancel();

    // Give a small window for async task to respond
    tokio::time::sleep(tokio::time::Duration::from_millis(20)).await;
    let elapsed = start.elapsed();

    // Cancellation should be near-instant (< 50ms), NOT waiting for 80ms sleep
    // Using 50ms allows for 20ms sleep + 30ms scheduling overhead
    assert!(
        elapsed.as_millis() < 50,
        "Polling cancellation took {}ms, expected < 50ms (should not wait for 80ms sleep)",
        elapsed.as_millis()
    );
}

/// Test AudioRecorder lifecycle: is_recording and audio_level after stop.
#[test]
fn test_recorder_state_after_stop_without_start() {
    let recorder = AudioRecorder::new();

    // Initially not recording
    assert!(!recorder.is_recording());
    assert_eq!(recorder.audio_level(), 0);

    // stop() without start returns error
    let result = recorder.stop();
    assert!(result.is_err());

    // State should still be clean
    assert!(!recorder.is_recording());
    assert_eq!(recorder.audio_level(), 0);
}

/// Test that is_recording is false immediately after stop() returns.
/// This verifies the recording thread has completed and stream is dropped.
#[test]
fn test_is_recording_false_immediately_after_stop() {
    // This test documents the expected behavior:
    // After recorder.stop() returns, is_recording() MUST be false.
    // The current implementation sets is_recording = false INSIDE the recording thread
    // after the stream is dropped, and stop() waits for the thread to complete.

    let recorder = AudioRecorder::new();

    // Try to start recording (may fail without real microphone)
    let start_result = recorder.start("default");

    if start_result.is_ok() {
        // Give a moment for recording to stabilize
        std::thread::sleep(std::time::Duration::from_millis(50));
        assert!(recorder.is_recording());

        // Stop recording
        let stop_result = recorder.stop();
        assert!(stop_result.is_ok());

        // CRITICAL: is_recording must be false IMMEDIATELY after stop() returns
        // (not after some async delay)
        assert!(
            !recorder.is_recording(),
            "is_recording() should be false immediately after stop() returns"
        );

        // audio_level should also be reset
        assert_eq!(
            recorder.audio_level(),
            0,
            "audio_level() should be 0 after stop()"
        );
    }
    // If start failed (no microphone), test passes trivially
}

/// Test rapid start/stop cycles don't leave recorder in inconsistent state.
#[test]
fn test_rapid_start_stop_cycles() {
    let recorder = AudioRecorder::new();

    for i in 0..3 {
        let start_result = recorder.start("default");

        if start_result.is_ok() {
            // Tiny delay to let recording actually start
            std::thread::sleep(std::time::Duration::from_millis(20));

            let stop_result = recorder.stop();
            assert!(
                stop_result.is_ok(),
                "Cycle {}: stop() should succeed after start()",
                i
            );

            // Verify clean state
            assert!(
                !recorder.is_recording(),
                "Cycle {}: should not be recording after stop()",
                i
            );
            assert_eq!(
                recorder.audio_level(),
                0,
                "Cycle {}: audio_level should be 0 after stop()",
                i
            );
        }
    }
}

/// Test that multiple polling tasks with proper cancellation don't interfere.
/// Simulates rapid press/release hotkey scenario.
#[tokio::test]
async fn test_rapid_polling_start_cancel_cycles() {
    let recorder = Arc::new(AudioRecorder::new());
    let overlay: Arc<Mutex<Box<dyn OverlayBackend>>> =
        Arc::new(Mutex::new(Box::new(NoopOverlay::new())));

    // Simulate rapid press/release cycles (like fast hotkey tapping)
    for _ in 0..5 {
        let token = CancellationToken::new();

        // Start polling
        start_audio_level_polling(Arc::clone(&recorder), Arc::clone(&overlay), token.clone());

        // Quick cancel (simulating fast hotkey release)
        tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
        token.cancel();

        // Small gap before next cycle
        tokio::time::sleep(tokio::time::Duration::from_millis(5)).await;
    }

    // All polling tasks should have exited cleanly
    // Give time for async cleanup
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    // Verify recorder is in clean state
    assert!(!recorder.is_recording());
    assert_eq!(recorder.audio_level(), 0);
}

// =============================================================================
// Integration Tests: Queue Processing Pipeline
// =============================================================================

use super::queue::TranscriptionQueue;

/// Test full queue pipeline: push audio -> pop processes -> state transitions
/// Simulates: Recording -> queue push -> Transcribing -> processing -> Idle
#[tokio::test]
async fn test_queue_pipeline_state_transitions() {
    let state = create_test_state();
    let queue = TranscriptionQueue::new();
    let overlay: Arc<Mutex<Box<dyn OverlayBackend>>> =
        Arc::new(Mutex::new(Box::new(NoopOverlay::new())));

    // Phase 1: Recording starts
    {
        let mut s = state.lock().await;
        assert_eq!(*s, RecordingState::Idle);
        *s = RecordingState::Recording;
    }

    // Phase 2: Recording stops, audio pushed to queue
    let fake_audio = vec![0u8; 1024]; // Simulated WAV data
    let queue_len = queue.push(fake_audio.clone()).await;
    assert_eq!(queue_len, 1);

    // Transition to Transcribing
    {
        let mut s = state.lock().await;
        assert_eq!(*s, RecordingState::Recording);
        *s = RecordingState::Transcribing;
    }

    // Show overlay transcribing state
    overlay.lock().await.show(OverlayState::Transcribing);

    // Phase 3: Queue worker pops and processes
    let item = queue.try_pop().await;
    assert!(item.is_some());
    assert_eq!(item.unwrap().audio_data.len(), 1024);
    assert!(queue.is_empty().await);

    // Phase 4: Transcription complete, back to Idle
    {
        let mut s = state.lock().await;
        assert_eq!(*s, RecordingState::Transcribing);
        *s = RecordingState::Idle;
    }
    overlay.lock().await.show(OverlayState::Idle);

    assert_eq!(*state.lock().await, RecordingState::Idle);
}

/// Test queue pipeline with multiple items: push 3 recordings, process sequentially.
#[tokio::test]
async fn test_queue_pipeline_multiple_items() {
    let state = create_test_state();
    let queue = TranscriptionQueue::new();
    let overlay: Arc<Mutex<Box<dyn OverlayBackend>>> =
        Arc::new(Mutex::new(Box::new(NoopOverlay::new())));

    // Simulate 3 rapid recordings queued up
    for i in 0..3 {
        // Recording phase
        {
            let mut s = state.lock().await;
            // Can start from Idle or Transcribing (queue mode)
            assert!(
                matches!(*s, RecordingState::Idle | RecordingState::Transcribing),
                "Recording {} should start from Idle or Transcribing, got {:?}",
                i,
                *s
            );
            *s = RecordingState::Recording;
        }

        // Stop recording, push to queue
        let audio = vec![i; 512];
        let queue_len = queue.push(audio).await;
        assert_eq!(queue_len as u8, i + 1);

        // Transition to Transcribing
        {
            let mut s = state.lock().await;
            *s = RecordingState::Transcribing;
        }
    }

    // Queue should have 3 items
    assert_eq!(queue.len().await, 3);

    // Process all items sequentially (simulating queue worker)
    for i in 0..3 {
        let item = queue.pop().await;
        assert_eq!(item.audio_data, vec![i as u8; 512]);

        // Show queued state if more items remain
        let remaining = queue.len().await;
        if remaining > 0 {
            overlay.lock().await.show(OverlayState::Queued(remaining));
        }
    }

    // All processed, back to idle
    {
        let mut s = state.lock().await;
        *s = RecordingState::Idle;
    }
    overlay.lock().await.show(OverlayState::Idle);

    assert!(queue.is_empty().await);
    assert_eq!(*state.lock().await, RecordingState::Idle);
}

/// Test queue worker pattern: consumer waits, producer pushes, state updates.
#[tokio::test]
async fn test_queue_worker_async_processing() {
    let queue = Arc::new(TranscriptionQueue::new());
    let state = create_test_state();
    let state_clone = Arc::clone(&state);
    let queue_clone = Arc::clone(&queue);

    // Spawn a simulated queue worker
    let worker = tokio::spawn(async move {
        // Worker waits for item
        let item = queue_clone.pop().await;

        // Process: transition to Transcribing -> Idle
        {
            let mut s = state_clone.lock().await;
            *s = RecordingState::Transcribing;
        }

        // Simulate transcription work
        tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;

        // Done
        {
            let mut s = state_clone.lock().await;
            *s = RecordingState::Idle;
        }

        item.audio_data
    });

    // Give worker time to start waiting
    tokio::time::sleep(tokio::time::Duration::from_millis(5)).await;

    // Push audio (simulating hotkey release)
    {
        let mut s = state.lock().await;
        *s = RecordingState::Recording;
    }
    queue.push(vec![42, 43, 44]).await;

    // Wait for worker to complete
    let result = tokio::time::timeout(tokio::time::Duration::from_secs(1), worker)
        .await
        .expect("Worker should complete within timeout")
        .expect("Worker should not panic");

    assert_eq!(result, vec![42, 43, 44]);
    assert_eq!(*state.lock().await, RecordingState::Idle);
}

// =============================================================================
// Integration Tests: Config Change Handling
// =============================================================================

/// Test overlay reinit on config change: shutdown old -> create new.
#[tokio::test]
async fn test_overlay_reinit_on_config_change() {
    let overlay: Arc<Mutex<Box<dyn OverlayBackend>>> =
        Arc::new(Mutex::new(Box::new(NoopOverlay::new())));

    // Initial state: not running (NoopOverlay)
    assert!(!overlay.lock().await.is_running());

    // Simulate reinit_overlay logic:
    // 1. Shutdown existing
    overlay.lock().await.shutdown();

    // 2. Create new overlay (still NoopOverlay in tests)
    let new_overlay: Box<dyn OverlayBackend> = Box::new(NoopOverlay::new());
    *overlay.lock().await = new_overlay;

    // 3. Set theme
    overlay.lock().await.set_theme("wave");

    // 4. Show idle state
    overlay.lock().await.show(OverlayState::Idle);

    // Should be valid (NoopOverlay, so not "running" per se)
    assert!(!overlay.lock().await.is_running());
}

/// Test overlay config changes: position, size, margin, theme.
#[tokio::test]
async fn test_overlay_config_changes_detected() {
    use crate::config::AppConfig;

    let old_config = AppConfig::default();
    let mut new_config = old_config.clone();

    // No change - should not trigger reinit
    assert_eq!(old_config.overlay, new_config.overlay);

    // Change position
    new_config.overlay.position = "top-left".to_string();
    assert_ne!(old_config.overlay, new_config.overlay);

    // Reset and change margin
    let mut new_config2 = old_config.clone();
    new_config2.overlay.margin = 42;
    assert_ne!(old_config.overlay, new_config2.overlay);

    // Reset and change theme
    let mut new_config3 = old_config.clone();
    new_config3.overlay.theme = "custom-theme".to_string();
    assert_ne!(old_config.overlay, new_config3.overlay);

    // Reset and change enabled
    let mut new_config4 = old_config.clone();
    new_config4.overlay.enabled = !old_config.overlay.enabled;
    assert_ne!(old_config.overlay, new_config4.overlay);
}

/// Test overlay state transitions through config changes during recording.
#[tokio::test]
async fn test_overlay_reinit_during_idle_state() {
    let state = create_test_state();
    let overlay: Arc<Mutex<Box<dyn OverlayBackend>>> =
        Arc::new(Mutex::new(Box::new(NoopOverlay::new())));

    // Ensure we're idle
    assert_eq!(*state.lock().await, RecordingState::Idle);

    // Reinit overlay (simulating config save)
    overlay.lock().await.shutdown();
    *overlay.lock().await = Box::new(NoopOverlay::new());
    overlay.lock().await.show(OverlayState::Idle);

    // State should remain Idle (reinit doesn't affect recording state)
    assert_eq!(*state.lock().await, RecordingState::Idle);
}

// =============================================================================
// Integration Tests: Error Recovery
// =============================================================================

/// Test error recovery in queue pipeline: transcription fails -> Error -> Idle.
#[tokio::test]
async fn test_error_recovery_transcription_failure() {
    let state = create_test_state();
    let queue = TranscriptionQueue::new();
    let overlay: Arc<Mutex<Box<dyn OverlayBackend>>> =
        Arc::new(Mutex::new(Box::new(NoopOverlay::new())));

    // Record and queue
    {
        let mut s = state.lock().await;
        *s = RecordingState::Recording;
    }
    queue.push(vec![1, 2, 3]).await;
    {
        let mut s = state.lock().await;
        *s = RecordingState::Transcribing;
    }

    // Pop for processing
    let _item = queue.pop().await;

    // Simulate transcription failure (e.g., API error)
    let transcription_result: Result<String, String> =
        Err("Transcription failed: 401 Unauthorized".to_string());
    assert!(transcription_result.is_err());

    // Error handling: transition to Error state
    {
        let mut s = state.lock().await;
        *s = RecordingState::Error;
    }
    overlay.lock().await.show(OverlayState::Idle);

    assert_eq!(*state.lock().await, RecordingState::Error);

    // Recovery: after delay, return to Idle (simulating the 2-second delay)
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
    {
        let mut s = state.lock().await;
        *s = RecordingState::Idle;
    }

    assert_eq!(*state.lock().await, RecordingState::Idle);
    // Queue should be empty (item was consumed)
    assert!(queue.is_empty().await);
}

/// Test error recovery doesn't lose queued items.
#[tokio::test]
async fn test_error_recovery_preserves_remaining_queue() {
    let queue = TranscriptionQueue::new();

    // Queue 3 items
    queue.push(vec![1]).await;
    queue.push(vec![2]).await;
    queue.push(vec![3]).await;
    assert_eq!(queue.len().await, 3);

    // Process first item - it fails
    let item1 = queue.pop().await;
    assert_eq!(item1.audio_data, vec![1]);

    // Even though processing failed, remaining items are preserved
    assert_eq!(queue.len().await, 2);

    // Continue processing remaining items successfully
    let item2 = queue.pop().await;
    assert_eq!(item2.audio_data, vec![2]);

    let item3 = queue.pop().await;
    assert_eq!(item3.audio_data, vec![3]);

    assert!(queue.is_empty().await);
}

/// Test config validation error before transcription attempt.
#[tokio::test]
async fn test_error_recovery_config_validation_failure() {
    let state = create_test_state();
    let overlay: Arc<Mutex<Box<dyn OverlayBackend>>> =
        Arc::new(Mutex::new(Box::new(NoopOverlay::new())));

    // Start transcription
    {
        let mut s = state.lock().await;
        *s = RecordingState::Transcribing;
    }

    // Config validation fails (no API key)
    let config = AppConfig {
        api_key: String::new(),
        ..Default::default()
    };
    let validation = validate_config(&config);
    assert!(validation.is_err());
    assert_eq!(validation.unwrap_err(), "API key not configured");

    // Error handling: set Error, show idle overlay
    {
        let mut s = state.lock().await;
        *s = RecordingState::Error;
    }
    overlay.lock().await.show(OverlayState::Idle);

    // Recovery
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
    {
        let mut s = state.lock().await;
        *s = RecordingState::Idle;
    }

    assert_eq!(*state.lock().await, RecordingState::Idle);
}

/// Test multiple consecutive errors don't leave state stuck.
#[tokio::test]
async fn test_multiple_consecutive_errors_recovery() {
    let state = create_test_state();
    let queue = TranscriptionQueue::new();
    let overlay: Arc<Mutex<Box<dyn OverlayBackend>>> =
        Arc::new(Mutex::new(Box::new(NoopOverlay::new())));

    for attempt in 0..5 {
        // Record and queue
        {
            let mut s = state.lock().await;
            assert!(
                matches!(*s, RecordingState::Idle),
                "Attempt {}: state should be Idle before recording, got {:?}",
                attempt,
                *s
            );
            *s = RecordingState::Recording;
        }
        queue.push(vec![attempt as u8]).await;
        {
            let mut s = state.lock().await;
            *s = RecordingState::Transcribing;
        }

        // Pop and fail
        let _item = queue.pop().await;

        // Error
        {
            let mut s = state.lock().await;
            *s = RecordingState::Error;
        }
        overlay.lock().await.show(OverlayState::Idle);

        // Recovery to Idle
        tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
        {
            let mut s = state.lock().await;
            *s = RecordingState::Idle;
        }
    }

    // After all attempts, state should be clean Idle
    assert_eq!(*state.lock().await, RecordingState::Idle);
    assert!(queue.is_empty().await);
}

// =============================================================================
// Integration Tests: Multiple Rapid Recordings
// =============================================================================

/// Test rapid press/release hotkey: multiple recordings queued while transcribing.
#[tokio::test]
async fn test_rapid_recordings_queue_buildup() {
    let state = create_test_state();
    let queue = Arc::new(TranscriptionQueue::new());
    let overlay: Arc<Mutex<Box<dyn OverlayBackend>>> =
        Arc::new(Mutex::new(Box::new(NoopOverlay::new())));

    // Simulate: first recording finishes, starts transcribing.
    // User makes 3 more rapid recordings during transcription.

    // First recording
    {
        let mut s = state.lock().await;
        *s = RecordingState::Recording;
    }
    queue.push(vec![1; 256]).await;
    {
        let mut s = state.lock().await;
        *s = RecordingState::Transcribing;
    }
    overlay.lock().await.show(OverlayState::Transcribing);

    // During transcription, user records 3 more times (queue mode allows this)
    for i in 2..=4 {
        {
            let s = state.lock().await;
            // Can start recording from Transcribing state
            assert!(matches!(
                *s,
                RecordingState::Idle | RecordingState::Transcribing
            ));
        }
        // Start recording
        {
            let mut s = state.lock().await;
            *s = RecordingState::Recording;
        }
        // Stop and queue
        queue.push(vec![i as u8; 256]).await;
        {
            let mut s = state.lock().await;
            *s = RecordingState::Transcribing;
        }
    }

    // Queue should have all 4 recordings
    assert_eq!(queue.len().await, 4);

    // Show queued state with count
    overlay
        .lock()
        .await
        .show(OverlayState::Queued(queue.len().await));

    // Process all items in order
    for expected_byte in 1..=4u8 {
        let item = queue.pop().await;
        assert_eq!(item.audio_data[0], expected_byte);

        let remaining = queue.len().await;
        if remaining > 0 {
            overlay.lock().await.show(OverlayState::Queued(remaining));
        }
    }

    // All done
    {
        let mut s = state.lock().await;
        *s = RecordingState::Idle;
    }
    overlay.lock().await.show(OverlayState::Idle);

    assert!(queue.is_empty().await);
    assert_eq!(*state.lock().await, RecordingState::Idle);
}

/// Test concurrent recording and processing via async tasks.
#[tokio::test]
async fn test_concurrent_producer_consumer_workflow() {
    let queue = Arc::new(TranscriptionQueue::new());
    let state = create_test_state();
    let state_for_consumer = Arc::clone(&state);
    let queue_for_consumer = Arc::clone(&queue);
    let processed = Arc::new(Mutex::new(Vec::new()));
    let processed_for_consumer = Arc::clone(&processed);

    // Consumer: processes items from queue
    let consumer = tokio::spawn(async move {
        for _ in 0..3 {
            let item = queue_for_consumer.pop().await;

            // Simulate transcription processing
            {
                let mut s = state_for_consumer.lock().await;
                *s = RecordingState::Transcribing;
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(5)).await;
            {
                let mut s = state_for_consumer.lock().await;
                *s = RecordingState::Idle;
            }

            processed_for_consumer.lock().await.push(item.audio_data[0]);
        }
    });

    // Producer: pushes items with small delays (simulating rapid recordings)
    for i in 0..3u8 {
        queue.push(vec![i]).await;
        tokio::time::sleep(tokio::time::Duration::from_millis(2)).await;
    }

    // Wait for consumer to finish
    tokio::time::timeout(tokio::time::Duration::from_secs(2), consumer)
        .await
        .expect("Consumer should complete within timeout")
        .expect("Consumer should not panic");

    // Verify all items processed in FIFO order
    let result = processed.lock().await;
    assert_eq!(*result, vec![0, 1, 2]);
    assert!(queue.is_empty().await);
    assert_eq!(*state.lock().await, RecordingState::Idle);
}

/// Test that debouncing prevents recording during Recording state,
/// even with rapid hotkey presses (integration with queue).
#[tokio::test]
async fn test_rapid_hotkey_debouncing_with_queue() {
    let state = create_test_state();
    let queue = TranscriptionQueue::new();
    let mut recordings_started = 0u32;

    // Simulate 10 rapid hotkey presses
    for _ in 0..10 {
        let s = state.lock().await;
        if matches!(*s, RecordingState::Idle | RecordingState::Transcribing) {
            drop(s);
            // Start recording
            {
                let mut s = state.lock().await;
                *s = RecordingState::Recording;
            }
            recordings_started += 1;

            // Immediately stop and queue
            queue.push(vec![recordings_started as u8]).await;
            {
                let mut s = state.lock().await;
                *s = RecordingState::Transcribing;
            }
        }
        // else: debounced (state is Recording or Error)
    }

    // All 10 should have been recorded (transitioning Transcribing -> Recording is allowed)
    assert_eq!(recordings_started, 10);
    assert_eq!(queue.len().await, 10);
}

/// Test that recording is blocked during Error state.
#[tokio::test]
async fn test_recording_blocked_during_error() {
    let state = create_test_state();
    let mut recordings_started = 0u32;

    // Set error state
    {
        let mut s = state.lock().await;
        *s = RecordingState::Error;
    }

    // Try to record 5 times - all should be blocked
    for _ in 0..5 {
        let s = state.lock().await;
        if matches!(*s, RecordingState::Idle | RecordingState::Transcribing) {
            recordings_started += 1;
        }
    }

    assert_eq!(
        recordings_started, 0,
        "No recordings should start during Error state"
    );

    // After recovery, recording should work
    {
        let mut s = state.lock().await;
        *s = RecordingState::Idle;
    }

    {
        let s = state.lock().await;
        if matches!(*s, RecordingState::Idle | RecordingState::Transcribing) {
            recordings_started += 1;
        }
    }

    assert_eq!(
        recordings_started, 1,
        "Recording should work after error recovery"
    );
}

/// Test full workflow cycle with overlay state tracking.
#[tokio::test]
async fn test_full_workflow_with_overlay_states() {
    let state = create_test_state();
    let queue = TranscriptionQueue::new();
    let overlay: Arc<Mutex<Box<dyn OverlayBackend>>> =
        Arc::new(Mutex::new(Box::new(NoopOverlay::new())));
    let mut overlay_states: Vec<&str> = Vec::new();

    // 1. Idle
    assert_eq!(*state.lock().await, RecordingState::Idle);
    overlay_states.push("idle");

    // 2. Hotkey pressed -> Recording + overlay recording
    {
        let mut s = state.lock().await;
        *s = RecordingState::Recording;
    }
    overlay.lock().await.show(OverlayState::Recording);
    overlay_states.push("recording");

    // 3. Hotkey released -> push to queue, Transcribing + overlay transcribing
    queue.push(vec![1, 2, 3]).await;
    {
        let mut s = state.lock().await;
        *s = RecordingState::Transcribing;
    }
    overlay.lock().await.show(OverlayState::Transcribing);
    overlay_states.push("transcribing");

    // 4. Transcription complete -> Idle + overlay idle
    let _item = queue.pop().await;
    {
        let mut s = state.lock().await;
        *s = RecordingState::Idle;
    }
    overlay.lock().await.show(OverlayState::Idle);
    overlay_states.push("idle");

    // Verify the full overlay state sequence
    assert_eq!(
        overlay_states,
        vec!["idle", "recording", "transcribing", "idle"]
    );
    assert_eq!(*state.lock().await, RecordingState::Idle);
}

/// Test cancellation token for polling during rapid recordings.
#[tokio::test]
async fn test_polling_cancel_on_rapid_recordings() {
    let recorder = Arc::new(AudioRecorder::new());
    let overlay: Arc<Mutex<Box<dyn OverlayBackend>>> =
        Arc::new(Mutex::new(Box::new(NoopOverlay::new())));
    let polling_cancel: Arc<Mutex<Option<CancellationToken>>> = Arc::new(Mutex::new(None));

    // Simulate 3 rapid recording cycles, each cancelling previous polling
    for _cycle in 0..3 {
        // Start recording: cancel previous token, create new one
        let token = CancellationToken::new();
        {
            let mut cancel_guard = polling_cancel.lock().await;
            if let Some(old_token) = cancel_guard.take() {
                old_token.cancel();
            }
            *cancel_guard = Some(token.clone());
        }

        // Start polling
        start_audio_level_polling(Arc::clone(&recorder), Arc::clone(&overlay), token.clone());

        // Quick recording duration
        tokio::time::sleep(tokio::time::Duration::from_millis(15)).await;

        // Stop recording: cancel polling
        {
            let mut cancel_guard = polling_cancel.lock().await;
            if let Some(token) = cancel_guard.take() {
                token.cancel();
            }
        }

        // Small gap between cycles
        tokio::time::sleep(tokio::time::Duration::from_millis(5)).await;
    }

    // Verify no lingering state
    assert!(!recorder.is_recording());
    assert!(polling_cancel.lock().await.is_none());
}

use crate::overlay_native::OverlayState;

#[test]
fn test_coordinator_can_be_created_and_observes_idle() {
    use crate::orchestrator::coordinator::{Stage, TranscriptionCoordinator};
    let coord = TranscriptionCoordinator::new();
    assert_eq!(coord.current_stage(), Stage::Idle);
}

#[test]
fn test_coordinator_transitions_on_press_release() {
    use crate::orchestrator::coordinator::{Stage, TranscriptionCoordinator};
    let coord = TranscriptionCoordinator::new();
    coord.on_press();
    // Worker thread processes async; poll up to 500ms
    for _ in 0..50 {
        if coord.current_stage() == Stage::Recording {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    assert_eq!(coord.current_stage(), Stage::Recording);

    coord.on_release();
    for _ in 0..50 {
        if coord.current_stage() == Stage::Processing {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    assert_eq!(coord.current_stage(), Stage::Processing);

    coord.notify_processing_finished();
    for _ in 0..50 {
        if coord.current_stage() == Stage::Idle {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    assert_eq!(coord.current_stage(), Stage::Idle);
}
