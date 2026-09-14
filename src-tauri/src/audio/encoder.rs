//! WAV encoding utilities — thin re-export shim.
//!
//! Task 1b moved `downsample`, `wav_duration_ms`, `TRANSCRIPTION_SAMPLE_RATE`,
//! and the actual WAV-encoding logic into `voxis_core::audio_wav` — the
//! only WAV code shared with voice_lib, the future `tauri-plugin-voxis`,
//! and its Swift contract. `samples_to_wav` is wrapped, not re-exported
//! directly: core's version returns the core-local
//! `voxis_core::audio_wav::WavError` (core doesn't know about
//! `AudioError`'s other, recording-specific variants), so this wrapper
//! converts back to `AudioError` — every existing
//! `crate::audio::samples_to_wav(...)` call site (`recorder.rs`) keeps its
//! original `Result<Vec<u8>, AudioError>` signature completely unchanged.

use super::error::AudioError;

pub use voxis_core::audio_wav::{downsample, wav_duration_ms, TRANSCRIPTION_SAMPLE_RATE};

impl From<voxis_core::audio_wav::WavError> for AudioError {
    fn from(err: voxis_core::audio_wav::WavError) -> Self {
        let voxis_core::audio_wav::WavError::Encode(msg) = err;
        AudioError::WavError(msg)
    }
}

/// Convert f32 samples to WAV bytes — thin adapter over
/// `voxis_core::audio_wav::samples_to_wav`, see module doc for why this
/// isn't a direct re-export.
pub fn samples_to_wav(samples: &[f32], sample_rate: u32) -> Result<Vec<u8>, AudioError> {
    voxis_core::audio_wav::samples_to_wav(samples, sample_rate).map_err(AudioError::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wav_error_converts_to_audio_error_preserving_message() {
        let core_err = voxis_core::audio_wav::WavError::Encode("boom".to_string());
        let mapped: AudioError = core_err.into();
        assert!(matches!(mapped, AudioError::WavError(msg) if msg == "boom"));
    }

    #[test]
    fn samples_to_wav_wrapper_matches_core_output() {
        let samples = vec![0.0f32; 100];
        let wav = samples_to_wav(&samples, 16_000).expect("encode should succeed");
        assert_eq!(&wav[0..4], b"RIFF");
    }
}
