//! Simple RMS threshold-based VAD.
//!
//! KISS: Minimal implementation for testing and as a fallback
//! when Silero ONNX is not available.

use super::{VadFrame, VoiceActivityDetector};
use anyhow::Result;

/// Voice activity detector based on RMS (root mean square) amplitude.
///
/// Classifies a frame as speech if its RMS exceeds the threshold.
pub struct ThresholdVad {
    threshold: f32,
}

impl ThresholdVad {
    /// Create a new threshold-based VAD.
    ///
    /// `threshold` — RMS level above which a frame is considered speech (0.0–1.0).
    pub fn new(threshold: f32) -> Self {
        Self { threshold }
    }

    /// Compute RMS of an audio frame.
    fn rms(samples: &[f32]) -> f32 {
        if samples.is_empty() {
            return 0.0;
        }
        let sum_sq: f32 = samples.iter().map(|s| s * s).sum();
        (sum_sq / samples.len() as f32).sqrt()
    }
}

impl VoiceActivityDetector for ThresholdVad {
    fn push_frame<'a>(&'a mut self, frame: &'a [f32]) -> Result<VadFrame<'a>> {
        if Self::rms(frame) >= self.threshold {
            Ok(VadFrame::Speech(frame))
        } else {
            Ok(VadFrame::Noise)
        }
    }
}
