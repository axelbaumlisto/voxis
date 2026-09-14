//! Pure data type shared with `voice_lib::audio_feedback`.
//!
//! Split out of `voice_lib::audio_feedback` in Task 1a: `AppConfig`
//! (moved to `crate::config`) embeds this struct, but the rodio-backed
//! playback (`SoundType`, `play`, `RodioPlayer`, `synthesize_beep`) stays
//! in voice_lib since voxis-core must not depend on rodio's audio-output
//! stack. `voice_lib` re-exports this exact type as
//! `audio_feedback::AudioFeedbackSettings` so every existing path keeps
//! resolving.

use serde::{Deserialize, Serialize};
use specta::Type;

/// User-facing settings for the audio feedback feature. Live in
/// `AppConfig` and flow through to `voice_lib::audio_feedback::play()`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Type)]
pub struct AudioFeedbackSettings {
    pub enabled: bool,
    /// Linear volume in [0.0, 1.0]. Values outside that range are
    /// clamped at call time — see `voice_lib::audio_feedback::clamp_volume`.
    pub volume: f32,
}

impl Default for AudioFeedbackSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            volume: 0.6,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_settings_are_off_with_safe_volume() {
        let s = AudioFeedbackSettings::default();
        assert!(!s.enabled, "off by default (privacy)");
        assert_eq!(s.volume, 0.6);
    }
}
