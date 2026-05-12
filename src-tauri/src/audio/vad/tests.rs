use super::*;

// --- Helper: create frames ---

/// Silent frame (all zeros).
fn silence(len: usize) -> Vec<f32> {
    vec![0.0; len]
}

/// Loud frame (constant amplitude).
fn speech(len: usize) -> Vec<f32> {
    vec![0.5; len]
}

// =============================================================
// ThresholdVad tests
// =============================================================

#[test]
fn test_threshold_vad_silence_returns_noise() {
    let mut vad = ThresholdVad::new(0.1);
    let frame = silence(480);
    let result = vad.push_frame(&frame).unwrap();
    assert!(!result.is_speech());
}

#[test]
fn test_threshold_vad_speech_returns_speech() {
    let mut vad = ThresholdVad::new(0.1);
    let frame = speech(480);
    let result = vad.push_frame(&frame).unwrap();
    assert!(result.is_speech());
}

#[test]
fn test_threshold_vad_at_boundary() {
    // RMS of [0.1, 0.1, ...] = 0.1 exactly — should be speech with threshold 0.1
    let mut vad = ThresholdVad::new(0.1);
    let frame = vec![0.1; 480];
    let result = vad.push_frame(&frame).unwrap();
    assert!(result.is_speech());
}

#[test]
fn test_threshold_vad_just_below_threshold() {
    let mut vad = ThresholdVad::new(0.1);
    let frame = vec![0.09; 480];
    let result = vad.push_frame(&frame).unwrap();
    assert!(!result.is_speech());
}

#[test]
fn test_threshold_vad_empty_frame_is_noise() {
    let mut vad = ThresholdVad::new(0.1);
    let frame: Vec<f32> = vec![];
    let result = vad.push_frame(&frame).unwrap();
    assert!(!result.is_speech());
}

#[test]
fn test_threshold_vad_is_voice_convenience() {
    let mut vad = ThresholdVad::new(0.1);
    assert!(vad.is_voice(&speech(480)).unwrap());
    assert!(!vad.is_voice(&silence(480)).unwrap());
}

// =============================================================
// VadFrame tests
// =============================================================

#[test]
fn test_vad_frame_is_speech() {
    let data = [1.0, 2.0];
    let speech_frame = VadFrame::Speech(&data);
    assert!(speech_frame.is_speech());

    let noise_frame = VadFrame::Noise;
    assert!(!noise_frame.is_speech());
}

// =============================================================
// SmoothedVad tests
// =============================================================

/// Helper: create SmoothedVad wrapping a ThresholdVad.
fn make_smoothed(
    threshold: f32,
    prefill: usize,
    hangover: usize,
    onset: usize,
) -> SmoothedVad {
    SmoothedVad::new(
        Box::new(ThresholdVad::new(threshold)),
        prefill,
        hangover,
        onset,
    )
}

#[test]
fn test_smoothed_onset_requires_consecutive_frames() {
    // onset=3: need 3 consecutive voice frames to trigger speech
    let mut vad = make_smoothed(0.1, 0, 0, 3);

    // Frame 1: voice → onset_counter=1, still Noise
    assert!(!vad.push_frame(&speech(480)).unwrap().is_speech());
    // Frame 2: voice → onset_counter=2, still Noise
    assert!(!vad.push_frame(&speech(480)).unwrap().is_speech());
    // Frame 3: voice → onset_counter=3 → triggers Speech
    assert!(vad.push_frame(&speech(480)).unwrap().is_speech());
}

#[test]
fn test_smoothed_onset_resets_on_silence() {
    // onset=3: if silence interrupts, counter resets
    let mut vad = make_smoothed(0.1, 0, 0, 3);

    // 2 voice frames
    assert!(!vad.push_frame(&speech(480)).unwrap().is_speech());
    assert!(!vad.push_frame(&speech(480)).unwrap().is_speech());
    // Silence breaks the streak
    assert!(!vad.push_frame(&silence(480)).unwrap().is_speech());
    // Start over — need 3 more consecutive
    assert!(!vad.push_frame(&speech(480)).unwrap().is_speech());
    assert!(!vad.push_frame(&speech(480)).unwrap().is_speech());
    assert!(vad.push_frame(&speech(480)).unwrap().is_speech());
}

#[test]
fn test_smoothed_single_voice_frame_with_onset_1() {
    // onset=1: single voice frame triggers immediately
    let mut vad = make_smoothed(0.1, 0, 0, 1);
    assert!(vad.push_frame(&speech(480)).unwrap().is_speech());
}

#[test]
fn test_smoothed_hangover_keeps_speech_during_silence() {
    // hangover=3: after speech, tolerate 3 silence frames
    let mut vad = make_smoothed(0.1, 0, 3, 1);

    // Trigger speech
    assert!(vad.push_frame(&speech(480)).unwrap().is_speech());

    // 3 silence frames — still Speech due to hangover
    assert!(vad.push_frame(&silence(480)).unwrap().is_speech()); // hangover=2
    assert!(vad.push_frame(&silence(480)).unwrap().is_speech()); // hangover=1
    assert!(vad.push_frame(&silence(480)).unwrap().is_speech()); // hangover=0
}

#[test]
fn test_smoothed_hangover_expires_to_noise() {
    // hangover=2: after 2 silence frames, next silence → Noise
    let mut vad = make_smoothed(0.1, 0, 2, 1);

    // Trigger speech
    assert!(vad.push_frame(&speech(480)).unwrap().is_speech());

    // Hangover frames
    assert!(vad.push_frame(&silence(480)).unwrap().is_speech()); // hangover=1
    assert!(vad.push_frame(&silence(480)).unwrap().is_speech()); // hangover=0

    // Hangover expired → Noise
    assert!(!vad.push_frame(&silence(480)).unwrap().is_speech());
}

#[test]
fn test_smoothed_hangover_resets_on_voice() {
    // hangover=2: voice during hangover resets counter
    let mut vad = make_smoothed(0.1, 0, 2, 1);

    // Trigger speech
    assert!(vad.push_frame(&speech(480)).unwrap().is_speech());

    // One silence frame (hangover=1)
    assert!(vad.push_frame(&silence(480)).unwrap().is_speech());

    // Voice comes back — hangover resets to 2
    assert!(vad.push_frame(&speech(480)).unwrap().is_speech());

    // Now 2 more silence frames should be tolerated
    assert!(vad.push_frame(&silence(480)).unwrap().is_speech());
    assert!(vad.push_frame(&silence(480)).unwrap().is_speech());

    // Expires
    assert!(!vad.push_frame(&silence(480)).unwrap().is_speech());
}

#[test]
fn test_smoothed_prefill_includes_previous_frames() {
    // prefill=2, onset=1: when speech triggers, output includes 2 previous frames
    let mut vad = make_smoothed(0.1, 2, 0, 1);

    // Feed 2 silence frames (will be buffered as prefill)
    let pre1 = vec![0.01; 480];
    let pre2 = vec![0.02; 480];
    vad.push_frame(&pre1).unwrap();
    vad.push_frame(&pre2).unwrap();

    // Speech frame triggers — output should contain pre1 + pre2 + speech
    let loud = speech(480);
    let result = vad.push_frame(&loud).unwrap();
    assert!(result.is_speech());

    if let VadFrame::Speech(data) = result {
        // Should be 3 frames concatenated: 480 * 3 = 1440 samples
        assert_eq!(data.len(), 480 * 3);
        // First 480 samples should be from pre1
        assert!((data[0] - 0.01).abs() < f32::EPSILON);
        // Next 480 from pre2
        assert!((data[480] - 0.02).abs() < f32::EPSILON);
        // Last 480 from speech
        assert!((data[960] - 0.5).abs() < f32::EPSILON);
    } else {
        panic!("Expected Speech frame with prefill data");
    }
}

#[test]
fn test_smoothed_prefill_limited_to_buffer_size() {
    // prefill=5 but only 1 frame before speech — should include what's available
    let mut vad = make_smoothed(0.1, 5, 0, 1);

    // Only 1 pre-frame
    let pre = vec![0.01; 480];
    vad.push_frame(&pre).unwrap();

    // Speech triggers — should have pre + speech = 2 frames
    let loud = speech(480);
    let result = vad.push_frame(&loud).unwrap();
    assert!(result.is_speech());

    if let VadFrame::Speech(data) = result {
        assert_eq!(data.len(), 480 * 2);
    } else {
        panic!("Expected Speech frame");
    }
}

#[test]
fn test_smoothed_reset_clears_state() {
    let mut vad = make_smoothed(0.1, 2, 3, 2);

    // Build up some state: 1 onset frame
    vad.push_frame(&speech(480)).unwrap();
    // And some prefill
    vad.push_frame(&silence(480)).unwrap();

    // Reset
    vad.reset();

    // After reset, onset counter should be 0 — need full onset again
    // Also prefill buffer should be empty
    assert!(!vad.push_frame(&speech(480)).unwrap().is_speech()); // onset=1, need 2
    assert!(vad.push_frame(&speech(480)).unwrap().is_speech());  // onset=2 → triggers

    // Prefill should only include frames after reset
    // (the speech frame that triggered, plus the one before it)
}

#[test]
fn test_smoothed_continuous_speech_stays_speech() {
    let mut vad = make_smoothed(0.1, 0, 0, 1);

    // Many consecutive speech frames
    for _ in 0..20 {
        assert!(vad.push_frame(&speech(480)).unwrap().is_speech());
    }
}

#[test]
fn test_smoothed_continuous_silence_stays_noise() {
    let mut vad = make_smoothed(0.1, 0, 0, 3);

    // Many consecutive silence frames
    for _ in 0..20 {
        assert!(!vad.push_frame(&silence(480)).unwrap().is_speech());
    }
}

#[test]
fn test_smoothed_full_lifecycle() {
    // Realistic scenario: silence → speech onset → speech → pause → hangover → silence
    let mut vad = make_smoothed(0.1, 1, 2, 2);

    // Pre-speech silence
    assert!(!vad.push_frame(&silence(480)).unwrap().is_speech());
    assert!(!vad.push_frame(&silence(480)).unwrap().is_speech());

    // Onset: first voice frame → not yet
    assert!(!vad.push_frame(&speech(480)).unwrap().is_speech());
    // Onset: second voice frame → triggers (with 1 prefill frame)
    assert!(vad.push_frame(&speech(480)).unwrap().is_speech());

    // Continued speech
    assert!(vad.push_frame(&speech(480)).unwrap().is_speech());
    assert!(vad.push_frame(&speech(480)).unwrap().is_speech());

    // Brief pause — hangover keeps it alive
    assert!(vad.push_frame(&silence(480)).unwrap().is_speech()); // hangover=1
    assert!(vad.push_frame(&silence(480)).unwrap().is_speech()); // hangover=0

    // Hangover expired
    assert!(!vad.push_frame(&silence(480)).unwrap().is_speech());
}

#[test]
fn test_smoothed_zero_onset_and_hangover() {
    // Edge case: onset=0 should behave like onset=1 (first voice frame triggers)
    // Actually onset=0 means the condition `onset_counter >= onset_frames` is met immediately
    // when onset_counter is 0 at first non-speech. But since onset_counter starts at 0 and
    // we only increment on voice, onset=0 would never trigger on its own.
    // Let's test onset=1 as minimum practical value.
    let mut vad = make_smoothed(0.1, 0, 0, 1);

    // Immediate trigger, immediate drop
    assert!(vad.push_frame(&speech(480)).unwrap().is_speech());
    assert!(!vad.push_frame(&silence(480)).unwrap().is_speech());
    assert!(vad.push_frame(&speech(480)).unwrap().is_speech());
    assert!(!vad.push_frame(&silence(480)).unwrap().is_speech());
}

// =========================================================================
// filter_with_vad — pure transformation pipeline
// =========================================================================

#[test]
fn test_filter_with_vad_empty_input() {
    let mut vad = ThresholdVad::new(0.1);
    let result = filter_with_vad(&[], &mut vad, 480);
    assert!(result.is_empty());
}

#[test]
fn test_filter_with_vad_shorter_than_frame_passes_through() {
    let mut vad = ThresholdVad::new(0.1);
    let samples = vec![0.5; 100]; // less than 480
    let result = filter_with_vad(&samples, &mut vad, 480);
    assert_eq!(result, samples, "short input should pass through unchanged");
}

#[test]
fn test_filter_with_vad_silence_filtered_out() {
    let mut vad = ThresholdVad::new(0.1);
    let silence = vec![0.0; 480 * 3]; // 3 silent frames
    let result = filter_with_vad(&silence, &mut vad, 480);
    assert!(result.is_empty(), "silence should be filtered out");
}

#[test]
fn test_filter_with_vad_speech_retained() {
    let mut vad = ThresholdVad::new(0.05);
    let speech: Vec<f32> = (0..480 * 3).map(|i| ((i as f32 * 0.1).sin()) * 0.5).collect();
    let result = filter_with_vad(&speech, &mut vad, 480);
    assert!(!result.is_empty(), "speech should be retained");
    assert!(result.len() <= speech.len(), "output cannot exceed input");
}

#[test]
fn test_filter_with_vad_mixed_silence_and_speech() {
    let mut vad = ThresholdVad::new(0.05);
    let mut samples = vec![0.0; 480]; // silence
    samples.extend((0..480).map(|i| ((i as f32 * 0.1).sin()) * 0.5)); // speech
    samples.extend(vec![0.0; 480]); // silence

    let result = filter_with_vad(&samples, &mut vad, 480);
    // Should be ~480 samples (only the speech frame)
    assert!(result.len() >= 480 && result.len() <= 480 * 2);
}

#[test]
fn test_filter_with_vad_drops_partial_trailing_frame() {
    let mut vad = ThresholdVad::new(0.1);
    let speech: Vec<f32> = (0..480 + 100).map(|i| ((i as f32 * 0.1).sin()) * 0.5).collect();
    let result = filter_with_vad(&speech, &mut vad, 480);
    // Trailing 100 samples (< frame_size) are dropped
    assert!(result.is_empty() || result.len() == 480);
}

// =========================================================================
// build_vad — factory
// =========================================================================

fn vad_config_with(enabled: bool, backend: &str) -> crate::config::VadConfig {
    crate::config::VadConfig {
        enabled,
        backend: backend.into(),
        ..crate::config::VadConfig::default()
    }
}

#[test]
fn test_build_vad_disabled_returns_none() {
    assert!(build_vad(&vad_config_with(false, "threshold"), None).is_none());
}

#[test]
fn test_build_vad_backend_none_returns_none() {
    assert!(build_vad(&vad_config_with(true, "none"), None).is_none());
}

#[test]
fn test_build_vad_threshold_returns_some() {
    assert!(build_vad(&vad_config_with(true, "threshold"), None).is_some());
}

#[test]
fn test_build_vad_silero_without_model_returns_none() {
    // Model path not provided -> graceful fallback
    assert!(build_vad(&vad_config_with(true, "silero"), None).is_none());
}

#[test]
fn test_build_vad_unknown_backend_returns_none() {
    assert!(build_vad(&vad_config_with(true, "alien-backend"), None).is_none());
}
