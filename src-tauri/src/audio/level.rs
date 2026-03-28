use cpal::FromSample;
use rustfft::{num_complex::Complex, FftPlanner};
use std::f32::consts::PI;
use std::sync::atomic::{AtomicU32, Ordering};

/// Number of frequency bins to display.
pub const SPECTRUM_BARS: usize = 32;

/// FFT size (must be power of 2).
const FFT_SIZE: usize = 1024;

/// Sample rate for frequency calculations.
const SAMPLE_RATE: f32 = 44100.0;

/// Minimum frequency (Hz) for spectrum display.
const MIN_FREQ: f32 = 20.0;

/// Maximum frequency (Hz) for spectrum display.
const MAX_FREQ: f32 = 20000.0;

/// Calculate audio level from current chunk and append mono samples to storage.
pub(crate) fn process_chunk<T>(
    data: &[T],
    channels: usize,
    samples: &mut Vec<f32>,
    audio_level: &AtomicU32,
    audio_boost: &AtomicU32,
) where
    T: cpal::Sample,
    f32: FromSample<T>,
{
    // Convert current chunk to mono f32 for RMS calculation
    let mut chunk_samples: Vec<f32> = Vec::with_capacity(data.len() / channels.max(1));

    // Convert to mono f32 and store
    for chunk in data.chunks(channels.max(1)) {
        let mono: f32 = chunk
            .iter()
            .map(|s| <f32 as FromSample<T>>::from_sample_(*s))
            .sum::<f32>()
            / channels.max(1) as f32;
        samples.push(mono);
        chunk_samples.push(mono);
    }

    // Calculate RMS from CURRENT chunk (not entire buffer) for responsive visualization
    if !chunk_samples.is_empty() {
        let rms: f32 =
            (chunk_samples.iter().map(|s| s * s).sum::<f32>() / chunk_samples.len() as f32).sqrt();
        // Scale to 0-100 with configurable boost for different microphone sensitivities
        let boost = audio_boost.load(Ordering::Relaxed) as f32 / 10.0;
        let level = (rms * boost).min(100.0) as u32;
        audio_level.store(level, Ordering::SeqCst);
    }
}

/// Spectrum analyzer using FFT.
///
/// Converts audio samples to frequency-domain spectrum for visualization.
/// Uses Hann windowing to reduce spectral leakage and logarithmic
/// frequency binning for perceptually accurate display.
pub struct SpectrumAnalyzer {
    planner: FftPlanner<f32>,
    window: Vec<f32>,
    scratch: Vec<Complex<f32>>,
}

impl SpectrumAnalyzer {
    pub fn new() -> Self {
        // Pre-compute Hann window
        let window: Vec<f32> = (0..FFT_SIZE)
            .map(|i| 0.5 * (1.0 - (2.0 * PI * i as f32 / FFT_SIZE as f32).cos()))
            .collect();

        Self {
            planner: FftPlanner::new(),
            window,
            scratch: vec![Complex::new(0.0, 0.0); FFT_SIZE],
        }
    }

    /// Compute spectrum from audio samples.
    ///
    /// Returns 32 frequency bin magnitudes (0.0 to 1.0).
    /// Requires at least FFT_SIZE samples for accurate results.
    /// The `boost` parameter amplifies the spectrum for visualization (typically audio_boost / 200.0).
    pub fn analyze(&mut self, samples: &[f32], boost: f32) -> [f32; SPECTRUM_BARS] {
        let mut result = [0.0f32; SPECTRUM_BARS];

        if samples.len() < FFT_SIZE {
            return result;
        }

        // Take last FFT_SIZE samples
        let recent = &samples[samples.len() - FFT_SIZE..];

        // Apply Hann window and convert to complex
        let mut buffer: Vec<Complex<f32>> = recent
            .iter()
            .zip(self.window.iter())
            .map(|(&s, &w)| Complex::new(s * w, 0.0))
            .collect();

        // Perform FFT
        let fft = self.planner.plan_fft_forward(FFT_SIZE);
        fft.process_with_scratch(&mut buffer, &mut self.scratch);

        // Convert to magnitudes (only positive frequencies: 0 to FFT_SIZE/2)
        let half = FFT_SIZE / 2;
        let magnitudes: Vec<f32> = buffer[..half]
            .iter()
            .map(|c| c.norm() / FFT_SIZE as f32)
            .collect();

        // Group into 32 bars with logarithmic frequency distribution
        Self::group_to_bars(&magnitudes, &mut result, boost);

        result
    }

    /// Group frequency bins into display bars using logarithmic scale.
    fn group_to_bars(magnitudes: &[f32], bars: &mut [f32; SPECTRUM_BARS], boost: f32) {
        let num_bins = magnitudes.len();

        for (bar_idx, bar) in bars.iter_mut().enumerate().take(SPECTRUM_BARS) {
            // Logarithmic frequency mapping
            let low_freq = Self::bar_to_freq_low(bar_idx, SPECTRUM_BARS);
            let high_freq = Self::bar_to_freq_high(bar_idx, SPECTRUM_BARS);

            let low_bin = Self::freq_to_bin(low_freq, num_bins);
            let high_bin = Self::freq_to_bin(high_freq, num_bins);

            // Average magnitudes in this range
            // Note: boost parameter controls sensitivity (audio_boost / 200.0 gives good range)
            if high_bin > low_bin {
                let sum: f32 = magnitudes[low_bin..=high_bin.min(num_bins - 1)]
                    .iter()
                    .sum();
                let avg = sum / (high_bin - low_bin + 1) as f32;
                // Scale for typical audio levels with configurable boost
                *bar = (avg * boost).min(1.0);
            } else if low_bin < num_bins {
                // Single bin
                *bar = (magnitudes[low_bin] * boost).min(1.0);
            }
        }
    }

    /// Convert bar index to low frequency boundary (Hz).
    fn bar_to_freq_low(bar: usize, total_bars: usize) -> f32 {
        let ratio = bar as f32 / total_bars as f32;
        MIN_FREQ * (MAX_FREQ / MIN_FREQ).powf(ratio)
    }

    /// Convert bar index to high frequency boundary (Hz).
    fn bar_to_freq_high(bar: usize, total_bars: usize) -> f32 {
        Self::bar_to_freq_low(bar + 1, total_bars)
    }

    /// Convert frequency to FFT bin index.
    fn freq_to_bin(freq: f32, num_bins: usize) -> usize {
        let bin = (freq * num_bins as f32 * 2.0 / SAMPLE_RATE) as usize;
        bin.min(num_bins - 1)
    }

    /// Get the FFT size used by this analyzer.
    pub const fn fft_size() -> usize {
        FFT_SIZE
    }
}

impl Default for SpectrumAnalyzer {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests;
