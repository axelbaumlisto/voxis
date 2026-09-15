//! Deterministic room-floor-noise generator for `fixtures/audio/silence.wav`
//! (`examples/gen_silence.rs` writes the file; `tests/silence_fixture.rs`
//! asserts the committed file's stats). Pure, seeded, dependency-light —
//! no `rand` crate: a tiny xorshift64* PRNG is enough for "same seed,
//! same bytes, every run" determinism and there is no reason to pull in
//! a whole RNG crate for one fixture generator.
//!
//! Target (measured MacBook Air mic floor, hardware session 2026-09-07,
//! see the plan's "Гейты консистентности" #4 and `voxis_core::guard`'s own
//! `SILENCE_RMS` calibration doc): per-250ms-window RMS median ≈ 0.0061,
//! p90 ≈ 0.0104, max ≤ 0.0156 — all comfortably below `SILENCE_RMS`
//! (0.02), so the guard's silence detector reads every window as silent.
//!
//! Approach: per-window (250ms = `window_ms`) target RMS drawn from a
//! log-normal distribution (`median = exp(mu)`, calibrated `sigma` so the
//! 90th percentile lands at the measured p90), each window's samples then
//! generated as scaled uniform white noise hitting that target RMS (up to
//! ordinary per-window sampling variance) — median/p90 fall out of the
//! log-normal draw by construction; the fixed post-hoc clip at `max_rms`
//! enforces the hard ceiling regardless of any single draw's tail.

/// xorshift64* — deterministic, splittable-enough PRNG for this one use.
struct Xorshift64Star {
    state: u64,
}

impl Xorshift64Star {
    fn new(seed: u64) -> Self {
        // xorshift64* requires a nonzero seed.
        Self { state: seed | 1 }
    }

    fn next_u64(&mut self) -> u64 {
        let mut x = self.state;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.state = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    /// Uniform f64 in `[0, 1)`.
    fn next_f64(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }

    /// Uniform f64 in `(-1, 1)`.
    fn next_signed(&mut self) -> f64 {
        self.next_f64() * 2.0 - 1.0
    }

    /// Standard-normal-ish sample via Box-Muller (good enough for a
    /// log-normal RMS draw, not used for the per-sample audio itself).
    fn next_standard_normal(&mut self) -> f64 {
        let u1 = self.next_f64().max(f64::MIN_POSITIVE);
        let u2 = self.next_f64();
        (-2.0 * u1.ln()).sqrt() * (std::f64::consts::TAU * u2).cos()
    }
}

/// Generation parameters, exposed so the example and the fixture-stats
/// test share one source of truth for the calibration constants instead
/// of duplicating magic numbers.
pub struct SilenceGenParams {
    pub seed: u64,
    pub sample_rate: u32,
    pub duration_ms: u32,
    pub window_ms: u32,
    /// Target median per-window RMS.
    pub median_rms: f64,
    /// Target 90th-percentile per-window RMS.
    pub p90_rms: f64,
    /// Hard ceiling — any window's target RMS above this is clamped
    /// down to it before samples are generated.
    pub max_rms: f64,
    /// `sub_chunk_ms` for the `windowed_peak_rms` metric this generator
    /// actually calibrates against (see that function's doc comment) —
    /// matched to `10` (a representative cpal callback size) both here
    /// and by `host-min`'s own `wav_to_level_script` so the mock capture
    /// path and this fixture's own stats test agree on what "the guard's
    /// peak metric" means for the same WAV bytes.
    pub sub_chunk_ms: u32,
    /// Empirical correction (`[R2-Exec]`, tuned against this generator's
    /// own stats test): taking the MAX of several sub-chunk RMS draws
    /// per window reads systematically higher than the window's true
    /// underlying noise level — this divides the log-normal draw's
    /// target down before scaling samples so the FINAL
    /// `windowed_peak_rms` output (not the raw per-sample noise level)
    /// lands on `median_rms`/`p90_rms`.
    pub peak_inflation_correction: f64,
}

impl Default for SilenceGenParams {
    fn default() -> Self {
        Self {
            seed: 0x564F_5849_535F_5353, // "VOXIS_SS"-ish, arbitrary fixed constant
            sample_rate: 16_000,
            duration_ms: 17_000,
            window_ms: 250,
            median_rms: 0.0061,
            p90_rms: 0.0104,
            max_rms: 0.0156,
            sub_chunk_ms: 10,
            peak_inflation_correction: 1.3,
        }
    }
}

/// Generates the full sample buffer (f32, `[-1.0, 1.0]`) deterministically
/// from `params`.
pub fn generate_samples(params: &SilenceGenParams) -> Vec<f32> {
    let mut rng = Xorshift64Star::new(params.seed);

    // Log-normal calibration: median = exp(mu); p90 = exp(mu + sigma * z90).
    let z90 = 1.2815515655446004_f64; // 90th percentile of the standard normal
    let mu = params.median_rms.ln();
    let sigma = ((params.p90_rms.ln() - mu) / z90).max(1e-9);

    let samples_per_window = ((params.window_ms as u64 * params.sample_rate as u64) / 1000) as usize;
    let total_windows = (params.duration_ms as u64 * 1000 / (params.window_ms as u64 * 1000) + 1) as usize;
    // Exact total sample count from duration_ms/sample_rate, independent
    // of how evenly `window_ms` divides it (last partial window just
    // gets whatever samples remain).
    let total_samples = ((params.duration_ms as u64 * params.sample_rate as u64) / 1000) as usize;

    let mut samples = Vec::with_capacity(total_samples);
    // Uniform(-1,1) has population std = 1/sqrt(3); scaling a unit
    // uniform draw by `target_rms * sqrt(3)` makes the window's own
    // TRUE underlying RMS converge to `target_rms` -- `peak_inflation_
    // correction` then accounts for `windowed_peak_rms` (max of several
    // sub-chunk RMS draws) reading higher than that true RMS.
    let uniform_to_rms_scale = 3f64.sqrt();

    for _ in 0..total_windows {
        if samples.len() >= total_samples {
            break;
        }
        let z = rng.next_standard_normal();
        let mut target_peak = (mu + sigma * z).exp();
        if target_peak > params.max_rms {
            target_peak = params.max_rms;
        }
        let target_rms = target_peak / params.peak_inflation_correction;
        let scale = target_rms * uniform_to_rms_scale;
        let remaining = total_samples - samples.len();
        let n = samples_per_window.min(remaining);
        for _ in 0..n {
            samples.push((rng.next_signed() * scale) as f32);
        }
    }

    debug_assert_eq!(samples.len(), total_samples);
    samples
}

/// Per-window RMS of `samples`, windowed at `window_ms` (last partial
/// window, if any, is measured over however many samples remain).
fn windowed_rms(samples: &[f32], sample_rate: u32, window_ms: u32) -> Vec<f64> {
    let samples_per_window = ((window_ms as u64 * sample_rate as u64) / 1000).max(1) as usize;
    samples
        .chunks(samples_per_window)
        .map(|chunk| {
            let sum_sq: f64 = chunk.iter().map(|&s| (s as f64) * (s as f64)).sum();
            (sum_sq / chunk.len() as f64).sqrt()
        })
        .collect()
}

/// The actual metric the guard decides on (`guard_adapter::poll`'s
/// `sample.peak`, compared against `SILENCE_RMS`) is NOT a single
/// whole-250ms-window RMS — the real desktop capture backend
/// (`desktop.rs`'s `WindowPeakAccumulator`) computes RMS over each cpal
/// audio callback (a much smaller sub-chunk than 250ms) and reports the
/// MAX of those sub-chunk RMS values since the last poll ("peak-RMS",
/// consistently higher than the window's own overall RMS for any noisy
/// signal). `sub_chunk_ms` (10ms here — a representative cpal callback
/// size, not a value real hardware is contractually pinned to) is this
/// module's stand-in for that same computation so `host-min`'s
/// `wav_to_level_script` and this generator's own calibration measure
/// the SAME thing the guard actually acts on, not a systematically lower
/// whole-window RMS that would under-represent how "peaky" real (or
/// synthetic) noise reads to the guard.
pub fn windowed_peak_rms(samples: &[f32], sample_rate: u32, window_ms: u32, sub_chunk_ms: u32) -> Vec<f64> {
    let samples_per_window = ((window_ms as u64 * sample_rate as u64) / 1000).max(1) as usize;
    samples
        .chunks(samples_per_window)
        .map(|window| windowed_rms(window, sample_rate, sub_chunk_ms).into_iter().fold(0f64, f64::max))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_seed_is_fully_deterministic() {
        let params = SilenceGenParams::default();
        let a = generate_samples(&params);
        let b = generate_samples(&params);
        assert_eq!(a, b, "same seed/params must produce byte-identical samples every run");
    }

    #[test]
    fn generates_the_expected_sample_count() {
        let params = SilenceGenParams::default();
        let samples = generate_samples(&params);
        assert_eq!(samples.len(), 17_000 * 16_000 / 1000);
    }

    #[test]
    fn per_window_rms_matches_the_measured_mac_book_floor_within_tolerance() {
        let params = SilenceGenParams::default();
        let samples = generate_samples(&params);
        let windows = windowed_peak_rms(&samples, params.sample_rate, params.window_ms, params.sub_chunk_ms);

        let mut sorted = windows.clone();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let median = sorted[sorted.len() / 2];
        let p90 = sorted[(sorted.len() as f64 * 0.9) as usize];
        let max = *sorted.last().unwrap();

        assert!(max <= params.max_rms + 1e-6, "max window RMS {max} must not exceed the {} ceiling", params.max_rms);
        assert!((median - params.median_rms).abs() / params.median_rms < 0.35, "median {median} too far from target {}", params.median_rms);
        assert!((p90 - params.p90_rms).abs() / params.p90_rms < 0.35, "p90 {p90} too far from target {}", params.p90_rms);
        assert!(max < 0.02, "every window must read as silent under SILENCE_RMS=0.02, got max={max}");
    }
}
