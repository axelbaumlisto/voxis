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

/// dB range for visualization mapping.
const DB_MIN: f32 = -55.0;
const DB_MAX: f32 = -8.0;
/// Post-normalization gain.
const VIS_GAIN: f32 = 1.3;
/// Curve shaping exponent (< 1.0 boosts quiet signals).
const CURVE_POWER: f32 = 0.7;
/// Noise floor adaptation rate (very slow).
const NOISE_ALPHA: f32 = 0.001;
/// Initial noise floor estimate (dB).
const NOISE_FLOOR_INIT: f32 = -40.0;

/// Spectrum analyzer using FFT.
///
/// Converts audio samples to frequency-domain spectrum for visualization.
/// Uses Hann windowing, adaptive noise floor, dB-domain processing,
/// gain/curve shaping, and neighbor smoothing for perceptually accurate display.
pub struct SpectrumAnalyzer {
    planner: FftPlanner<f32>,
    window: Vec<f32>,
    scratch: Vec<Complex<f32>>,
    /// Per-bucket adaptive noise floor (dB). Updated only on quiet signals.
    pub(crate) noise_floor: Vec<f32>,
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
            noise_floor: vec![NOISE_FLOOR_INIT; SPECTRUM_BARS],
        }
    }

    /// Reset analyzer state (noise floor back to defaults).
    pub fn reset(&mut self) {
        self.noise_floor.fill(NOISE_FLOOR_INIT);
    }

    /// Compute spectrum from audio samples.
    ///
    /// Returns 32 frequency bin magnitudes (0.0 to 1.0).
    /// Requires at least FFT_SIZE samples for accurate results.
    /// The `boost` parameter is a legacy multiplier kept for API compat
    /// (1.0 = neutral; higher = more sensitive).
    pub fn analyze(&mut self, samples: &[f32], boost: f32) -> [f32; SPECTRUM_BARS] {
        let mut result = [0.0f32; SPECTRUM_BARS];

        if samples.len() < FFT_SIZE {
            return result;
        }

        // Take last FFT_SIZE samples
        let recent = &samples[samples.len() - FFT_SIZE..];

        // Remove DC component
        let mean = recent.iter().sum::<f32>() / FFT_SIZE as f32;

        // Apply Hann window, subtract DC, convert to complex
        let mut buffer: Vec<Complex<f32>> = recent
            .iter()
            .zip(self.window.iter())
            .map(|(&s, &w)| Complex::new((s - mean) * w, 0.0))
            .collect();

        // Perform FFT
        let fft = self.planner.plan_fft_forward(FFT_SIZE);
        fft.process_with_scratch(&mut buffer, &mut self.scratch);

        // Group into bars, process in dB domain with adaptive noise floor
        let half = FFT_SIZE / 2;
        self.compute_bars(&buffer[..half], &mut result, boost);

        // Light neighbor smoothing to reduce jitter
        Self::smooth_bars(&mut result);

        result
    }

    /// Compute bar values from FFT output using dB-domain processing.
    fn compute_bars(
        &mut self,
        fft_out: &[Complex<f32>],
        bars: &mut [f32; SPECTRUM_BARS],
        boost: f32,
    ) {
        let num_bins = fft_out.len();

        for (bar_idx, bar) in bars.iter_mut().enumerate().take(SPECTRUM_BARS) {
            let low_freq = Self::bar_to_freq_low(bar_idx, SPECTRUM_BARS);
            let high_freq = Self::bar_to_freq_high(bar_idx, SPECTRUM_BARS);

            let low_bin = Self::freq_to_bin(low_freq, num_bins);
            let high_bin = Self::freq_to_bin(high_freq, num_bins).min(num_bins - 1);

            // Average power in this frequency range
            let bin_count = if high_bin >= low_bin { high_bin - low_bin + 1 } else { 1 };
            let mut power_sum = 0.0f32;
            for bin_idx in low_bin..=high_bin.min(num_bins - 1) {
                let mag = fft_out[bin_idx].norm();
                power_sum += mag * mag;
            }
            let avg_power = power_sum / bin_count as f32;

            // Convert to dB
            let db = if avg_power > 1e-12 {
                20.0 * (avg_power.sqrt() / FFT_SIZE as f32).log10()
            } else {
                -80.0
            };

            // Adaptive noise floor: only update when signal is quiet
            if db < self.noise_floor[bar_idx] + 10.0 {
                self.noise_floor[bar_idx] =
                    NOISE_ALPHA * db + (1.0 - NOISE_ALPHA) * self.noise_floor[bar_idx];
            }

            // Map dB range → 0..1, apply gain and curve shaping
            let normalized = ((db - DB_MIN) / (DB_MAX - DB_MIN)).clamp(0.0, 1.0);
            let shaped = (normalized * VIS_GAIN * boost.max(0.1) / 4.0)
                .powf(CURVE_POWER)
                .clamp(0.0, 1.0);
            *bar = shaped;
        }
    }

    /// Light neighbor smoothing to reduce visual jitter.
    fn smooth_bars(bars: &mut [f32; SPECTRUM_BARS]) {
        // Work on a copy to avoid cascading updates
        let orig = *bars;
        for i in 1..SPECTRUM_BARS - 1 {
            bars[i] = orig[i] * 0.7 + orig[i - 1] * 0.15 + orig[i + 1] * 0.15;
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
