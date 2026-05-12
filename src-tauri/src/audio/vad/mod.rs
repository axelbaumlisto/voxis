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

mod silero;
mod smoothed;
mod threshold;

pub use silero::{SileroVad, SILERO_FRAME_SAMPLES};
pub use smoothed::SmoothedVad;
pub use threshold::ThresholdVad;

#[cfg(test)]
mod tests;

use crate::config::VadConfig;
use std::path::Path;

/// Filter audio samples through a VAD, retaining only frames classified as speech.
///
/// Splits `samples` into fixed-size frames (`frame_size`), feeds each through
/// the VAD, and concatenates frames marked as `Speech`. Frames marked `Noise`
/// are discarded. Trailing samples shorter than `frame_size` are dropped.
///
/// SRP: pure transformation, no I/O.
/// KISS: simple sequential loop, no buffering tricks (SmoothedVad already
/// handles prefill/hangover internally).
pub fn filter_with_vad(
    samples: &[f32],
    vad: &mut dyn VoiceActivityDetector,
    frame_size: usize,
) -> Vec<f32> {
    if frame_size == 0 || samples.len() < frame_size {
        return samples.to_vec();
    }

    let mut output = Vec::with_capacity(samples.len());
    for chunk in samples.chunks_exact(frame_size) {
        match vad.push_frame(chunk) {
            Ok(VadFrame::Speech(s)) => output.extend_from_slice(s),
            Ok(VadFrame::Noise) => {} // discard
            Err(e) => {
                tracing::warn!("VAD error, passing frame through: {}", e);
                output.extend_from_slice(chunk);
            }
        }
    }
    output
}

/// Build a VAD pipeline from config.
///
/// SRP: this factory is the single place that knows how to instantiate VAD
/// backends and wrap them in `SmoothedVad` for prefill/hangover/onset handling.
///
/// Selection rule:
/// - `enabled=false` or `backend == "none"` → `None` (no filtering)
/// - `backend == "threshold"` → `SmoothedVad<ThresholdVad>`
/// - `backend == "silero"` → `SmoothedVad<SileroVad>` (loads ONNX model from `silero_model_path`)
/// - unknown backend → `None` with warning
///
/// Returns `None` when VAD is disabled, set to "none", or backend init fails.
pub fn build_vad(
    config: &VadConfig,
    silero_model_path: Option<&Path>,
) -> Option<Box<dyn VoiceActivityDetector>> {
    if !config.enabled {
        return None;
    }

    let inner: Box<dyn VoiceActivityDetector> = match config.backend.as_str() {
        "none" => return None,
        "threshold" => Box::new(ThresholdVad::new(config.threshold)),
        "silero" => {
            let path = match silero_model_path {
                Some(p) => p,
                None => {
                    tracing::warn!("Silero VAD requested but no model path provided");
                    return None;
                }
            };
            match SileroVad::new(path, config.threshold) {
                Ok(v) => Box::new(v),
                Err(e) => {
                    tracing::warn!("Failed to load Silero VAD: {}", e);
                    return None;
                }
            }
        }
        other => {
            tracing::warn!("Unknown VAD backend: {}", other);
            return None;
        }
    };

    Some(Box::new(SmoothedVad::new(
        inner,
        config.prefill_frames as usize,
        config.hangover_frames as usize,
        config.onset_frames as usize,
    )))
}
