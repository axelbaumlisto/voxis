use super::*;
use std::cell::RefCell;

/// Test player that records calls without making sound.
struct Recorder {
    calls: RefCell<Vec<(SoundType, f32)>>,
}

impl Recorder {
    fn new() -> Self {
        Self {
            calls: RefCell::new(Vec::new()),
        }
    }
    fn transcript(&self) -> Vec<(SoundType, f32)> {
        self.calls.borrow().clone()
    }
}

impl SoundPlayer for Recorder {
    fn play_sound(&self, kind: SoundType, volume: f32) -> Result<(), String> {
        self.calls.borrow_mut().push((kind, volume));
        Ok(())
    }
}

#[test]
fn play_returns_ok_silently_when_disabled() {
    let rec = Recorder::new();
    let settings = AudioFeedbackSettings {
        enabled: false,
        volume: 0.8,
    };
    play(SoundType::Start, settings, &rec).unwrap();
    assert!(
        rec.transcript().is_empty(),
        "disabled feedback must NOT touch the player"
    );
}

#[test]
fn play_invokes_player_when_enabled() {
    let rec = Recorder::new();
    let settings = AudioFeedbackSettings {
        enabled: true,
        volume: 0.5,
    };
    play(SoundType::Start, settings, &rec).unwrap();
    play(SoundType::Stop, settings, &rec).unwrap();
    play(SoundType::Error, settings, &rec).unwrap();
    assert_eq!(
        rec.transcript(),
        [
            (SoundType::Start, 0.5),
            (SoundType::Stop, 0.5),
            (SoundType::Error, 0.5),
        ]
    );
}

#[test]
fn volume_clamped_to_0_1_range() {
    assert_eq!(clamp_volume(-0.3), 0.0);
    assert_eq!(clamp_volume(0.0), 0.0);
    assert_eq!(clamp_volume(0.5), 0.5);
    assert_eq!(clamp_volume(1.0), 1.0);
    assert_eq!(clamp_volume(1.7), 1.0);
}

#[test]
fn volume_handles_nan_by_returning_zero() {
    // A corrupt config (NaN) must NOT crash the playback chain; the
    // dispatcher silently clamps to 0 so the user hears nothing
    // rather than a 100%-volume burst.
    assert_eq!(clamp_volume(f32::NAN), 0.0);
}

#[test]
fn play_passes_clamped_volume_to_player() {
    let rec = Recorder::new();
    let settings = AudioFeedbackSettings {
        enabled: true,
        volume: 2.5, // above the legal range
    };
    play(SoundType::Start, settings, &rec).unwrap();
    assert_eq!(rec.transcript(), [(SoundType::Start, 1.0)]);
}

#[test]
fn default_settings_are_off_with_safe_volume() {
    let s = AudioFeedbackSettings::default();
    assert!(!s.enabled, "off by default (privacy)");
    assert_eq!(s.volume, 0.6);
}

#[test]
fn synthesize_beep_produces_correct_length_per_kind() {
    // Start = 100ms @ 48kHz → 4800 samples
    let start = synthesize_beep(SoundType::Start);
    assert!(
        (4700..=4900).contains(&start.len()),
        "start beep should be ~4800 samples, got {}",
        start.len()
    );
    // Error = 250ms @ 48kHz → 12000 samples
    let error = synthesize_beep(SoundType::Error);
    assert!(
        (11700..=12300).contains(&error.len()),
        "error beep should be ~12000 samples, got {}",
        error.len()
    );
    // Error MUST be longer than Start (so the user can audibly
    // distinguish them).
    assert!(error.len() > start.len());
}

#[test]
fn synthesize_beep_samples_in_signed_range() {
    // Linear envelope * 0.35 amplitude means peak ≈ ±0.35.
    // Anything outside [-1, 1] would clip on output.
    let samples = synthesize_beep(SoundType::Start);
    for (i, s) in samples.iter().enumerate() {
        assert!(
            (-1.0..=1.0).contains(s),
            "sample {} out of range: {}",
            i, s
        );
    }
}

#[test]
fn sound_type_serialize_is_snake_case() {
    // Stable storage form for the SQLite kv table + Tauri events.
    assert_eq!(
        serde_json::to_string(&SoundType::Start).unwrap(),
        "\"start\""
    );
    assert_eq!(
        serde_json::to_string(&SoundType::Error).unwrap(),
        "\"error\""
    );
}
