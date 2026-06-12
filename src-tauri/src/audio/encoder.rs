//! WAV encoding utilities.

use super::error::AudioError;
use hound::{WavSpec, WavWriter};
use std::io::Cursor;

/// Target sample rate for transcription (Whisper is trained on 16kHz).
pub const TRANSCRIPTION_SAMPLE_RATE: u32 = 16_000;

/// Downsample audio samples to a lower sample rate using linear interpolation.
///
/// Reduces file size and matches Whisper's native 16kHz training rate.
pub fn downsample(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate || samples.is_empty() {
        return samples.to_vec();
    }
    let ratio = from_rate as f64 / to_rate as f64;
    let output_len = (samples.len() as f64 / ratio).ceil() as usize;
    let mut output = Vec::with_capacity(output_len);
    for i in 0..output_len {
        let src_pos = i as f64 * ratio;
        let src_idx = src_pos as usize;
        let frac = (src_pos - src_idx as f64) as f32;
        let s0 = samples[src_idx.min(samples.len() - 1)];
        let s1 = samples[(src_idx + 1).min(samples.len() - 1)];
        output.push(s0 + frac * (s1 - s0));
    }
    output
}

/// Duration in milliseconds of a canonical PCM WAV (as produced by
/// `samples_to_wav`: 44-byte header, "RIFF"/"WAVE", PCM, mono/stereo).
///
/// Pure & dependency-free: reads sample_rate (@24), channels (@22),
/// bits_per_sample (@34) and the data chunk size (@40) from the header.
/// Returns `None` if the bytes aren't a WAV we recognize.
pub fn wav_duration_ms(wav: &[u8]) -> Option<u32> {
    if wav.len() < 44 || &wav[0..4] != b"RIFF" || &wav[8..12] != b"WAVE" || &wav[36..40] != b"data"
    {
        return None;
    }
    let le16 = |o: usize| u16::from_le_bytes([wav[o], wav[o + 1]]) as u32;
    let le32 = |o: usize| u32::from_le_bytes([wav[o], wav[o + 1], wav[o + 2], wav[o + 3]]);
    let channels = le16(22).max(1);
    let sample_rate = le32(24);
    let bits = le16(34).max(1);
    let data_size = le32(40);
    if sample_rate == 0 {
        return None;
    }
    let bytes_per_sample_frame = channels * (bits / 8).max(1);
    if bytes_per_sample_frame == 0 {
        return None;
    }
    let frames = data_size / bytes_per_sample_frame;
    // ms = frames * 1000 / sample_rate (u64 to avoid overflow)
    Some(((frames as u64 * 1000) / sample_rate as u64) as u32)
}

/// Convert f32 samples to WAV bytes.
pub fn samples_to_wav(samples: &[f32], sample_rate: u32) -> Result<Vec<u8>, AudioError> {
    let spec = WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer =
            WavWriter::new(&mut cursor, spec).map_err(|e| AudioError::WavError(e.to_string()))?;

        for &sample in samples {
            // Convert f32 (-1.0 to 1.0) to i16
            let sample_i16 = (sample * 32767.0).clamp(-32768.0, 32767.0) as i16;
            writer
                .write_sample(sample_i16)
                .map_err(|e| AudioError::WavError(e.to_string()))?;
        }

        writer
            .finalize()
            .map_err(|e| AudioError::WavError(e.to_string()))?;
    }

    Ok(cursor.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_samples_to_wav() {
        let samples = vec![0.0f32; 1000];
        let wav = samples_to_wav(&samples, 44100).unwrap();

        // WAV header is 44 bytes, data is 1000 * 2 bytes (16-bit)
        assert_eq!(wav.len(), 44 + 1000 * 2);
        // Check WAV magic
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
    }

    #[test]
    fn test_samples_to_wav_with_speech_simulation() {
        // Simulate 1 second of speech-like audio (16kHz)
        let sample_rate = 16000;
        let duration_secs = 1.0;
        let num_samples = (sample_rate as f32 * duration_secs) as usize;

        // Generate mock speech waveform (mix of frequencies)
        let samples: Vec<f32> = (0..num_samples)
            .map(|i| {
                let t = i as f32 / sample_rate as f32;
                // Mix of common speech frequencies
                let f1 = (2.0 * std::f32::consts::PI * 200.0 * t).sin() * 0.3;
                let f2 = (2.0 * std::f32::consts::PI * 500.0 * t).sin() * 0.2;
                let f3 = (2.0 * std::f32::consts::PI * 1000.0 * t).sin() * 0.1;
                f1 + f2 + f3
            })
            .collect();

        let wav = samples_to_wav(&samples, sample_rate).unwrap();

        // Verify WAV structure
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(&wav[12..16], b"fmt ");
        assert_eq!(&wav[36..40], b"data");

        // Verify size (44 header + num_samples * 2 bytes)
        assert_eq!(wav.len(), 44 + num_samples * 2);
    }

    #[test]
    fn test_samples_to_wav_various_sample_rates() {
        for sample_rate in [8000u32, 16000, 22050, 44100, 48000] {
            let samples = vec![0.5f32; sample_rate as usize]; // 1 second
            let wav = samples_to_wav(&samples, sample_rate).unwrap();

            // Check sample rate is encoded correctly (bytes 24-27)
            let encoded_rate = u32::from_le_bytes([wav[24], wav[25], wav[26], wav[27]]);
            assert_eq!(
                encoded_rate, sample_rate,
                "Sample rate mismatch for {}",
                sample_rate
            );
        }
    }

    #[test]
    fn test_samples_to_wav_amplitude_range() {
        // Test full amplitude range
        let samples = vec![-1.0f32, 0.0, 1.0, -0.5, 0.5];
        let wav = samples_to_wav(&samples, 44100).unwrap();

        // Extract i16 samples from WAV data section (after 44 byte header)
        let data = &wav[44..];
        assert_eq!(data.len(), 10); // 5 samples * 2 bytes

        // First sample should be close to -32768 (for -1.0)
        let sample0 = i16::from_le_bytes([data[0], data[1]]);
        assert!(sample0 < -30000, "Expected large negative, got {}", sample0);

        // Third sample should be close to 32767 (for 1.0)
        let sample2 = i16::from_le_bytes([data[4], data[5]]);
        assert!(sample2 > 30000, "Expected large positive, got {}", sample2);
    }

    #[test]
    fn test_samples_to_wav_large_data() {
        // Test with 5 seconds of 48kHz audio (240000 samples)
        let sample_rate = 48000u32;
        let duration_secs = 5;
        let num_samples = sample_rate as usize * duration_secs;

        // Generate sine wave
        let samples: Vec<f32> = (0..num_samples)
            .map(|i| {
                let t = i as f32 / sample_rate as f32;
                (2.0 * std::f32::consts::PI * 440.0 * t).sin() * 0.5
            })
            .collect();

        let wav = samples_to_wav(&samples, sample_rate).unwrap();

        // Verify WAV structure
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");

        // Verify size (44 header + num_samples * 2 bytes)
        assert_eq!(wav.len(), 44 + num_samples * 2);
    }

    #[test]
    fn test_samples_to_wav_edge_values() {
        // Test edge values including values outside [-1, 1] (should be clamped)
        let samples = vec![
            -2.0f32, // Should clamp to -32768
            -1.0,    // -32767
            -0.0001, // Small negative
            0.0,     // Zero
            0.0001,  // Small positive
            1.0,     // 32767
            2.0,     // Should clamp to 32767
        ];

        let wav = samples_to_wav(&samples, 44100).unwrap();
        let data = &wav[44..];
        assert_eq!(data.len(), 14); // 7 samples * 2 bytes

        // First sample should be clamped to -32768
        let sample0 = i16::from_le_bytes([data[0], data[1]]);
        assert_eq!(sample0, -32768);

        // Last sample should be clamped to 32767
        let sample6 = i16::from_le_bytes([data[12], data[13]]);
        assert_eq!(sample6, 32767);
    }

    #[test]
    fn test_samples_to_wav_empty() {
        let samples: Vec<f32> = vec![];
        let wav = samples_to_wav(&samples, 44100).unwrap();

        // Should still have valid WAV header
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        // Header only, no data
        assert_eq!(wav.len(), 44);
    }

    #[test]
    fn test_samples_to_wav_zero_sample_rate_panics() {
        // Zero sample rate causes hound to panic (divide by zero in byte rate calculation)
        let samples = vec![0.0f32; 10];
        let result = std::panic::catch_unwind(|| samples_to_wav(&samples, 0));
        // hound panics on zero sample rate - this documents the behavior
        assert!(
            result.is_err(),
            "Zero sample rate should cause a panic in hound"
        );
    }

    #[test]
    fn test_samples_to_wav_nan_values() {
        // NaN samples should be clamped and not crash
        let samples = vec![f32::NAN, f32::INFINITY, f32::NEG_INFINITY, 0.5];
        let result = samples_to_wav(&samples, 44100);
        // Should produce output (NaN clamp behavior is defined by the f32 -> i16 conversion)
        assert!(result.is_ok());
        let wav = result.unwrap();
        assert_eq!(&wav[0..4], b"RIFF");
    }

    #[test]
    fn test_samples_to_wav_single_sample() {
        let samples = vec![0.5f32];
        let wav = samples_to_wav(&samples, 16000).unwrap();
        assert_eq!(wav.len(), 44 + 2); // header + 1 sample * 2 bytes
        let sample = i16::from_le_bytes([wav[44], wav[45]]);
        // 0.5 * 32767 = 16383.5 -> 16383
        assert!((sample - 16383).abs() <= 1);
    }

    #[test]
    fn test_wav_duration_ms_one_second_16k_mono() {
        // 16000 samples @ 16kHz mono = 1000 ms
        let samples = vec![0.0f32; 16_000];
        let wav = samples_to_wav(&samples, 16_000).unwrap();
        let ms = wav_duration_ms(&wav).expect("should parse");
        assert!((ms as i64 - 1000).abs() <= 2, "got {ms} ms");
    }

    #[test]
    fn test_wav_duration_ms_short_clip() {
        // 1600 samples @ 16kHz = 100 ms
        let samples = vec![0.0f32; 1_600];
        let wav = samples_to_wav(&samples, 16_000).unwrap();
        let ms = wav_duration_ms(&wav).expect("should parse");
        assert!((ms as i64 - 100).abs() <= 2, "got {ms} ms");
    }

    #[test]
    fn test_wav_duration_ms_empty_samples_is_zero() {
        let wav = samples_to_wav(&[], 16_000).unwrap();
        assert_eq!(wav_duration_ms(&wav), Some(0));
    }

    #[test]
    fn test_wav_duration_ms_rejects_garbage() {
        assert_eq!(wav_duration_ms(&[0u8; 10]), None);
        assert_eq!(wav_duration_ms(b"not a wav file at all........"), None);
    }

    #[test]
    fn test_wav_duration_ms_44100_mono() {
        let samples = vec![0.0f32; 44_100]; // 1s @ 44.1k
        let wav = samples_to_wav(&samples, 44_100).unwrap();
        let ms = wav_duration_ms(&wav).expect("parse");
        assert!((ms as i64 - 1000).abs() <= 2, "got {ms} ms");
    }
}
