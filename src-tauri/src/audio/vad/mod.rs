//! Voice Activity Detection module.
//!
//! OCP: `VoiceActivityDetector` trait allows different VAD backends
//! (threshold-based, Silero ONNX, etc.) without modifying consumers.
//! DIP: `SmoothedVad` depends on the trait abstraction, not concrete types.

use anyhow::Result;

/// Result of processing a single audio frame through VAD.
pub enum VadFrame<'a> {
    /// Speech detected — contains audio samples (may include prefill).
    Speech(&'a [f32]),
    /// Non-speech (silence/noise). Downstream can discard.
    Noise,
}

impl<'a> VadFrame<'a> {
    /// Returns `true` if this frame contains speech.
    #[inline]
    pub fn is_speech(&self) -> bool {
        matches!(self, VadFrame::Speech(_))
    }
}

/// Trait for voice activity detection backends.
///
/// Implementations process streaming audio frame-by-frame and classify
/// each as speech or noise.
pub trait VoiceActivityDetector: Send + Sync {
    /// Feed one audio frame, get speech/noise decision.
    fn push_frame<'a>(&'a mut self, frame: &'a [f32]) -> Result<VadFrame<'a>>;

    /// Convenience: returns true if frame is speech.
    fn is_voice(&mut self, frame: &[f32]) -> Result<bool> {
        Ok(self.push_frame(frame)?.is_speech())
    }

    /// Reset internal state (e.g. between recordings).
    fn reset(&mut self) {}
}

mod smoothed;
mod threshold;

pub use smoothed::SmoothedVad;
pub use threshold::ThresholdVad;

#[cfg(test)]
mod tests;
