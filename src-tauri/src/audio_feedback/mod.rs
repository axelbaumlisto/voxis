//! Audio feedback: short beeps on recording start / stop / error.
//!
//! Closes #6 from `.pi/plans/handy-recommendations-cloud-only.md`.
//!
//! Plays a tiny .wav clip when the orchestrator changes state so the
//! user gets immediate auditory confirmation that the hotkey
//! registered \u2014 critical for accessibility and for users with
//! always-visible pill overlays who can't easily glance away.
//!
//! Architecture:
//!  - `SoundType` enum: Start, Stop, Error (3 well-known events).
//!  - `AudioFeedbackSettings`: `{ enabled, volume }`.
//!  - `play(kind, settings, &dyn SoundPlayer)`: pure dispatcher.
//!  - Real `RodioPlayer` (added in T-B6.2) implements `SoundPlayer` and
//!    decodes the bundled .wav payloads.
//!
//! SOLID:
//!  - SRP: this file owns the dispatch logic + the data shape. No I/O.
//!  - DIP: dispatcher depends on `SoundPlayer` trait \u2014 unit tests use
//!    a `RecordingPlayer` to verify call order without making noise.
//!  - OCP: new sound events = append to enum + match arm.
//!  - KISS: no async, no buffering, no shared state.

use serde::{Deserialize, Serialize};
use specta::Type;

/// Which feedback sound to play.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum SoundType {
    /// Played when recording begins (hotkey pressed, mic capture started).
    Start,
    /// Played when recording ends (hotkey released or toggle off).
    Stop,
    /// Played when an error occurs (mic permission denied, API failure, etc.).
    Error,
}

/// User-facing settings for the audio feedback feature. Live in
/// `AppConfig` (added in T-B6.3 wiring) and flow through to `play()`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Type)]
pub struct AudioFeedbackSettings {
    pub enabled: bool,
    /// Linear volume in [0.0, 1.0]. Values outside that range are
    /// clamped at call time \u2014 see `clamp_volume`.
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

/// Clamp the volume into the safe [0.0, 1.0] range. Public so the
/// settings UI can show the same number it actually plays at.
pub fn clamp_volume(v: f32) -> f32 {
    if v.is_nan() {
        return 0.0;
    }
    v.clamp(0.0, 1.0)
}

/// Backend that knows how to make sound. Tests use a recorder; prod
/// uses `RodioPlayer` (T-B6.2).
pub trait SoundPlayer {
    fn play_sound(&self, kind: SoundType, volume: f32) -> Result<(), String>;
}

/// Top-level dispatcher. No-op when `enabled = false` \u2014 explicit
/// silent-by-default privacy. The caller hands the settings + the
/// player implementation.
pub fn play(
    kind: SoundType,
    settings: AudioFeedbackSettings,
    player: &dyn SoundPlayer,
) -> Result<(), String> {
    if !settings.enabled {
        return Ok(());
    }
    let v = clamp_volume(settings.volume);
    player.play_sound(kind, v)
}

#[cfg(test)]
mod tests;
