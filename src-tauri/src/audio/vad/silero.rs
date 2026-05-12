//! Silero ONNX-based voice activity detection.
//!
//! Wraps the `vad-rs` crate (ONNX Runtime + Silero VAD model) and exposes it
//! through our `VoiceActivityDetector` trait so it can be swapped in for
//! `ThresholdVad` or wrapped by `SmoothedVad` without changes to consumers.
//!
//! Architecture:
//! - **OCP:** New backend implementing existing trait, no consumers modified.
//! - **DIP:** Depends on the trait abstraction (re-exported by callers).
//! - **KISS:** Thin adapter — almost all logic lives in `vad-rs`.
//! - **TDD:** Tests load the bundled `silero_vad_v4.onnx` model and exercise
//!   the trait contract end-to-end.

use anyhow::{anyhow, bail, Result};
use std::path::Path;
use vad_rs::Vad;

use super::{VadFrame, VoiceActivityDetector};
use crate::audio::TRANSCRIPTION_SAMPLE_RATE;

/// Silero processes audio in 30 ms frames.
const SILERO_FRAME_MS: u32 = 30;

/// Number of f32 samples per Silero frame at 16 kHz (= 480).
pub const SILERO_FRAME_SAMPLES: usize =
    (TRANSCRIPTION_SAMPLE_RATE * SILERO_FRAME_MS / 1000) as usize;

/// ONNX-based voice activity detector using the Silero VAD model.
///
/// Caller is responsible for resampling to 16 kHz mono before feeding frames.
pub struct SileroVad {
    engine: Vad,
    threshold: f32,
}

impl SileroVad {
    /// Load the Silero ONNX model at `model_path`.
    ///
    /// `threshold` is the speech probability cut-off in `[0.0, 1.0]`. Frames
    /// whose model output exceeds it are classified as speech.
    pub fn new<P: AsRef<Path>>(model_path: P, threshold: f32) -> Result<Self> {
        if !(0.0..=1.0).contains(&threshold) {
            bail!("threshold must be between 0.0 and 1.0, got {}", threshold);
        }

        let engine = Vad::new(&model_path, TRANSCRIPTION_SAMPLE_RATE as usize)
            .map_err(|e| anyhow!("Failed to load Silero VAD model: {e}"))?;

        Ok(Self { engine, threshold })
    }
}

impl VoiceActivityDetector for SileroVad {
    fn push_frame<'a>(&'a mut self, frame: &'a [f32]) -> Result<VadFrame<'a>> {
        if frame.len() != SILERO_FRAME_SAMPLES {
            bail!(
                "Silero VAD expects {} samples per frame, got {}",
                SILERO_FRAME_SAMPLES,
                frame.len()
            );
        }

        let result = self
            .engine
            .compute(frame)
            .map_err(|e| anyhow!("Silero VAD compute error: {e}"))?;

        if result.prob > self.threshold {
            Ok(VadFrame::Speech(frame))
        } else {
            Ok(VadFrame::Noise)
        }
    }

    fn reset(&mut self) {
        self.engine.reset();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// Path to the bundled Silero ONNX model.
    fn model_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("silero_vad_v4.onnx")
    }

    fn make_vad(threshold: f32) -> SileroVad {
        SileroVad::new(model_path(), threshold)
            .expect("Silero VAD model must load from resources/silero_vad_v4.onnx")
    }

    #[test]
    fn test_silero_vad_loads_model() {
        // Model file is bundled; constructor must succeed.
        let path = model_path();
        assert!(
            path.exists(),
            "missing model: {} — run `curl -L -o {} https://github.com/snakers4/silero-vad/raw/v4.0/files/silero_vad.onnx`",
            path.display(),
            path.display()
        );
        let _vad = SileroVad::new(&path, 0.5).expect("model load succeeded");
    }

    #[test]
    fn test_silero_frame_samples_constant() {
        // 30 ms × 16 kHz = 480 samples — required by the Silero ONNX model.
        assert_eq!(SILERO_FRAME_SAMPLES, 480);
    }

    #[test]
    fn test_silero_vad_silence_detected_as_noise() {
        let mut vad = make_vad(0.5);
        let silence = vec![0.0_f32; SILERO_FRAME_SAMPLES];

        let frame = vad
            .push_frame(&silence)
            .expect("silence frame is processed without error");

        // The Silero model should classify pure silence as non-speech.
        assert!(
            !frame.is_speech(),
            "pure silence should NOT be classified as speech"
        );
    }

    #[test]
    fn test_silero_vad_rejects_wrong_frame_size() {
        let mut vad = make_vad(0.5);

        // Smaller than expected.
        let too_short = vec![0.0_f32; SILERO_FRAME_SAMPLES - 1];
        assert!(vad.push_frame(&too_short).is_err());

        // Larger than expected.
        let too_long = vec![0.0_f32; SILERO_FRAME_SAMPLES + 1];
        assert!(vad.push_frame(&too_long).is_err());

        // Empty frame.
        let empty: Vec<f32> = Vec::new();
        assert!(vad.push_frame(&empty).is_err());
    }

    #[test]
    fn test_silero_vad_invalid_threshold_rejected() {
        let path = model_path();
        assert!(SileroVad::new(&path, -0.1).is_err(), "negative threshold");
        assert!(SileroVad::new(&path, 1.1).is_err(), "threshold > 1.0");
        // Boundaries are valid.
        assert!(SileroVad::new(&path, 0.0).is_ok());
        assert!(SileroVad::new(&path, 1.0).is_ok());
    }

    #[test]
    fn test_silero_vad_is_voice_convenience() {
        let mut vad = make_vad(0.5);
        let silence = vec![0.0_f32; SILERO_FRAME_SAMPLES];

        let is_voice = vad
            .is_voice(&silence)
            .expect("is_voice succeeds on silence frame");
        assert!(!is_voice, "silence is not voice");
    }

    #[test]
    fn test_silero_vad_reset_succeeds() {
        let mut vad = make_vad(0.5);
        let silence = vec![0.0_f32; SILERO_FRAME_SAMPLES];

        // Feed a few frames so the LSTM state is non-zero, then reset.
        for _ in 0..3 {
            let _ = vad.push_frame(&silence);
        }
        vad.reset();

        // After reset, processing must still work.
        let frame = vad
            .push_frame(&silence)
            .expect("frame processed after reset");
        assert!(!frame.is_speech());
    }

    #[test]
    fn test_silero_vad_high_threshold_rejects_low_signal() {
        // With a near-maximum threshold, even mild noise should not pass.
        let mut vad = make_vad(0.99);
        let low_noise: Vec<f32> = (0..SILERO_FRAME_SAMPLES)
            .map(|i| ((i as f32) * 0.001).sin() * 0.01)
            .collect();

        let frame = vad
            .push_frame(&low_noise)
            .expect("low-noise frame processed");
        assert!(
            !frame.is_speech(),
            "low-amplitude noise should not pass threshold=0.99"
        );
    }
}
