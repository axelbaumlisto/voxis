//! Audio feedback: short beeps on recording start / stop / error.
//!
//! Short feedback sounds for recording lifecycle events.
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

// =============================================================================
// Production player (rodio + synthesized sine beeps)
// =============================================================================

/// Sample rate used for the generated beeps. 48 kHz works on every
/// audio device we've encountered and gives a clean tone.
const SAMPLE_RATE: u32 = 48_000;

/// Generate a short PCM mono beep for the given event kind.
///
/// Three distinct frequencies + lengths so the user can audibly tell
/// them apart without learning a code book:
///   Start  — A5 (880 Hz), 100 ms
///   Stop   — A4 (440 Hz), 100 ms
///   Error  — A3 (220 Hz), 250 ms
///
/// A simple linear attack/release envelope (5 ms each edge) avoids the
/// audible click that a raw sine truncation would produce.
pub(crate) fn synthesize_beep(kind: SoundType) -> Vec<f32> {
    let (freq, duration) = match kind {
        SoundType::Start => (880.0_f32, 0.10_f32),
        SoundType::Stop => (440.0, 0.10),
        SoundType::Error => (220.0, 0.25),
    };
    let n = (SAMPLE_RATE as f32 * duration) as usize;
    let edge = (SAMPLE_RATE as f32 * 0.005) as usize; // 5ms attack/release
    let two_pi_f = 2.0 * std::f32::consts::PI * freq;
    (0..n)
        .map(|i| {
            let t = i as f32 / SAMPLE_RATE as f32;
            let env = if i < edge {
                i as f32 / edge as f32
            } else if i >= n.saturating_sub(edge) {
                n.saturating_sub(i) as f32 / edge as f32
            } else {
                1.0
            };
            (two_pi_f * t).sin() * env * 0.35
        })
        .collect()
}

/// Production `SoundPlayer` backed by `rodio`. Each call spawns a
/// short-lived thread that owns its own `OutputStream` for the
/// lifetime of the beep and then drops it. Trade-off: a few ms of
/// init overhead per call vs. a long-lived audio thread we'd have
/// to manage. The overhead is negligible compared to the orchestrator
/// work happening around it.
pub struct RodioPlayer;

impl SoundPlayer for RodioPlayer {
    fn play_sound(&self, kind: SoundType, volume: f32) -> Result<(), String> {
        let samples = synthesize_beep(kind);
        let duration_ms = (samples.len() as u64 * 1000) / SAMPLE_RATE as u64 + 50;
        std::thread::spawn(move || {
            let (stream, handle) = match rodio::OutputStream::try_default() {
                Ok(pair) => pair,
                Err(e) => {
                    tracing::warn!("audio_feedback: rodio init failed: {e}");
                    return;
                }
            };
            let sink = match rodio::Sink::try_new(&handle) {
                Ok(s) => s,
                Err(e) => {
                    tracing::warn!("audio_feedback: rodio sink failed: {e}");
                    return;
                }
            };
            sink.set_volume(volume);
            sink.append(rodio::buffer::SamplesBuffer::new(
                1,
                SAMPLE_RATE,
                samples,
            ));
            // Hold the thread until playback completes; otherwise the
            // stream gets dropped mid-beep and the user hears nothing.
            std::thread::sleep(std::time::Duration::from_millis(duration_ms));
            drop(sink);
            drop(stream);
        });
        Ok(())
    }
}

#[cfg(test)]
mod tests;
