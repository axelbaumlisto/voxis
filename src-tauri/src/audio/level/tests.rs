use super::*;

/// Pseudo-random hash seeds (f32-truncated to fit precision).
/// Used to deterministically generate noise samples in spectrum tests.
const HASH_SEED_X: f32 = 12_345.679;
const HASH_SEED_Y: f32 = 43_758.547;

/// Deterministic PRNG: produces values in [-1.0, 1.0] from index `i`.
fn hash_sample(i: usize) -> f32 {
    let x = ((i as f32 * HASH_SEED_X).sin() * HASH_SEED_Y).fract();
    x * 2.0 - 1.0
}

#[test]
fn test_analyzer_creation() {
    let analyzer = SpectrumAnalyzer::new();
    assert_eq!(analyzer.window.len(), FFT_SIZE);
}

#[test]
fn test_empty_samples() {
    let mut analyzer = SpectrumAnalyzer::new();
    let result = analyzer.analyze(&[], 4.0);
    assert!(result.iter().all(|&v| v == 0.0));
}

#[test]
fn test_insufficient_samples() {
    let mut analyzer = SpectrumAnalyzer::new();
    let samples = vec![0.0; FFT_SIZE / 2]; // Not enough samples
    let result = analyzer.analyze(&samples, 4.0);
    assert!(result.iter().all(|&v| v == 0.0));
}

#[test]
fn test_sine_wave_peak() {
    let mut analyzer = SpectrumAnalyzer::new();

    // Generate 440 Hz sine wave (A4 note)
    let freq = 440.0;
    let samples: Vec<f32> = (0..FFT_SIZE)
        .map(|i| (2.0 * PI * freq * i as f32 / SAMPLE_RATE).sin())
        .collect();

    let result = analyzer.analyze(&samples, 4.0);

    // Should have non-zero values
    assert!(result.iter().any(|&v| v > 0.0));
}

#[test]
fn test_logarithmic_frequency_mapping() {
    // Bar 0 should cover low frequencies (20-~40 Hz)
    let low0 = SpectrumAnalyzer::bar_to_freq_low(0, 32);
    assert!((low0 - 20.0).abs() < 1.0);

    // Bar 31 should cover high frequencies (up to 20kHz)
    let high31 = SpectrumAnalyzer::bar_to_freq_high(31, 32);
    assert!((high31 - 20000.0).abs() < 100.0);
}

#[test]
fn test_frequency_increases_with_bar_index() {
    for bar in 0..31 {
        let freq_low = SpectrumAnalyzer::bar_to_freq_low(bar, 32);
        let freq_high = SpectrumAnalyzer::bar_to_freq_low(bar + 1, 32);
        assert!(
            freq_high > freq_low,
            "Bar {} freq {} should be < bar {} freq {}",
            bar,
            freq_low,
            bar + 1,
            freq_high
        );
    }
}

#[test]
fn test_bass_200hz_activates_low_bars() {
    let mut analyzer = SpectrumAnalyzer::new();

    // Generate 200 Hz sine wave
    let samples: Vec<f32> = (0..FFT_SIZE)
        .map(|i| (2.0 * PI * 200.0 * i as f32 / SAMPLE_RATE).sin())
        .collect();

    let bars = analyzer.analyze(&samples, 4.0);

    // Bars 4-6 should be active (200 Hz is in low frequency range)
    let bass_energy: f32 = bars[3..7].iter().sum();
    let high_energy: f32 = bars[20..].iter().sum();

    assert!(bass_energy > 0.01, "Bass bars should be active");
    assert!(
        bass_energy > high_energy * 2.0,
        "Bass should dominate over highs"
    );
}

#[test]
fn test_mid_1000hz_activates_mid_bars() {
    let mut analyzer = SpectrumAnalyzer::new();

    // Generate 1000 Hz sine wave
    let samples: Vec<f32> = (0..FFT_SIZE)
        .map(|i| (2.0 * PI * 1000.0 * i as f32 / SAMPLE_RATE).sin())
        .collect();

    let bars = analyzer.analyze(&samples, 4.0);

    // Bars 14-16 should be most active (1000 Hz is midrange)
    let mid_energy: f32 = bars[12..18].iter().sum();
    let low_energy: f32 = bars[0..5].iter().sum();

    assert!(mid_energy > 0.01, "Mid bars should be active");
    assert!(mid_energy > low_energy, "Mid should dominate over lows");
}

#[test]
fn test_high_8000hz_activates_high_bars() {
    let mut analyzer = SpectrumAnalyzer::new();

    // Generate 8000 Hz sine wave
    let samples: Vec<f32> = (0..FFT_SIZE)
        .map(|i| (2.0 * PI * 8000.0 * i as f32 / SAMPLE_RATE).sin())
        .collect();

    let bars = analyzer.analyze(&samples, 4.0);

    // Bars 26-28 should be most active (8000 Hz is high frequency)
    let high_energy: f32 = bars[24..30].iter().sum();
    let low_energy: f32 = bars[0..10].iter().sum();

    assert!(high_energy > 0.01, "High bars should be active");
    assert!(high_energy > low_energy, "Highs should dominate over lows");
}

#[test]
fn test_hello_speech_pattern() {
    let mut analyzer = SpectrumAnalyzer::new();

    // Simulate "hello" - fundamental 200 Hz + formants at 500, 1500 Hz
    let samples: Vec<f32> = (0..FFT_SIZE)
        .map(|i| {
            let t = i as f32 / SAMPLE_RATE;
            0.5 * (2.0 * PI * 200.0 * t).sin() // fundamental
                + 0.3 * (2.0 * PI * 500.0 * t).sin() // first formant
                + 0.2 * (2.0 * PI * 1500.0 * t).sin() // second formant
        })
        .collect();

    let bars = analyzer.analyze(&samples, 4.0);

    // Voice range (100-2000 Hz) should be active
    let voice_energy: f32 = bars[3..18].iter().sum();
    let silence_high: f32 = bars[25..].iter().sum();

    assert!(voice_energy > 0.02, "Voice frequencies should be active");
    assert!(voice_energy > silence_high * 3.0, "Voice should dominate");
}

#[test]
fn test_silence_produces_zero_bars() {
    let mut analyzer = SpectrumAnalyzer::new();
    let samples: Vec<f32> = vec![0.0; FFT_SIZE];

    let bars = analyzer.analyze(&samples, 4.0);

    let total_energy: f32 = bars.iter().sum();
    assert!(total_energy < 0.01, "Silence should produce near-zero bars");
}

#[test]
fn test_white_noise_produces_distributed_spectrum() {
    let mut analyzer = SpectrumAnalyzer::new();

    // Generate pseudo-random noise
    let samples: Vec<f32> = (0..FFT_SIZE).map(hash_sample).collect();

    let bars = analyzer.analyze(&samples, 4.0);

    // Multiple bars should have some energy
    let active_bars = bars.iter().filter(|&&v| v > 0.01).count();
    assert!(active_bars > 10, "Noise should activate multiple bars");
}

#[test]
fn test_fft_size_constant() {
    assert_eq!(SpectrumAnalyzer::fft_size(), 1024);
}

#[test]
fn test_spectrum_bars_constant() {
    assert_eq!(SPECTRUM_BARS, 32);
}

#[test]
fn test_default_trait() {
    let analyzer = SpectrumAnalyzer::default();
    assert_eq!(analyzer.window.len(), FFT_SIZE);
}

#[test]
fn test_bar_values_in_valid_range() {
    let mut analyzer = SpectrumAnalyzer::new();

    // Generate loud signal
    let samples: Vec<f32> = (0..FFT_SIZE)
        .map(|i| (2.0 * PI * 440.0 * i as f32 / SAMPLE_RATE).sin())
        .collect();

    let bars = analyzer.analyze(&samples, 4.0);

    for (i, &val) in bars.iter().enumerate() {
        assert!(
            (0.0..=1.0).contains(&val),
            "Bar {} value {} should be in [0, 1]",
            i,
            val
        );
    }
}

#[test]
fn test_noise_floor_adapts_to_ambient() {
    let mut analyzer = SpectrumAnalyzer::new();

    // Feed 50 frames of low-level noise to let noise floor adapt
    let noise: Vec<f32> = (0..FFT_SIZE)
        .map(|i| hash_sample(i) * 0.001)
        .collect();
    for _ in 0..50 {
        analyzer.analyze(&noise, 4.0);
    }
    let noise_floor_after_quiet = analyzer.noise_floor.clone();

    // Now feed a loud signal — noise floor should NOT jump up
    // (it only adapts when signal is quiet)
    let loud: Vec<f32> = (0..FFT_SIZE)
        .map(|i| (2.0 * PI * 440.0 * i as f32 / SAMPLE_RATE).sin())
        .collect();
    analyzer.analyze(&loud, 4.0);
    let noise_floor_after_loud = analyzer.noise_floor.clone();

    // Noise floor should barely move when loud signal plays
    for (bucket, (&quiet, &loud_val)) in noise_floor_after_quiet
        .iter()
        .zip(noise_floor_after_loud.iter())
        .enumerate()
    {
        let delta = (loud_val - quiet).abs();
        assert!(
            delta < 5.0,
            "Bucket {} noise floor jumped by {} dB (quiet={}, loud={})",
            bucket, delta, quiet, loud_val
        );
    }
}

#[test]
fn test_noise_floor_initial_values() {
    let analyzer = SpectrumAnalyzer::new();
    assert_eq!(analyzer.noise_floor.len(), SPECTRUM_BARS);
    for &nf in &analyzer.noise_floor {
        assert!((nf - (-40.0)).abs() < f32::EPSILON, "Initial noise floor should be -40.0 dB");
    }
}

#[test]
fn test_hann_window_applied() {
    // Verify Hann window properties: edges near zero, center near 1.0
    let analyzer = SpectrumAnalyzer::new();

    // Hann window: first and last values should be ~0
    assert!(
        analyzer.window[0].abs() < 0.01,
        "Hann window start should be near 0, got {}",
        analyzer.window[0]
    );
    assert!(
        analyzer.window[FFT_SIZE - 1].abs() < 0.01,
        "Hann window end should be near 0, got {}",
        analyzer.window[FFT_SIZE - 1]
    );

    // Center should be ~1.0
    let center = analyzer.window[FFT_SIZE / 2];
    assert!(
        (center - 1.0).abs() < 0.01,
        "Hann window center should be near 1.0, got {}",
        center
    );
}

#[test]
fn test_gain_and_curve_shaping() {
    let mut analyzer = SpectrumAnalyzer::new();

    // Generate a moderate 440 Hz signal
    let samples: Vec<f32> = (0..FFT_SIZE)
        .map(|i| 0.3 * (2.0 * PI * 440.0 * i as f32 / SAMPLE_RATE).sin())
        .collect();

    let bars = analyzer.analyze(&samples, 4.0);

    // With gain (1.3) and curve shaping (pow 0.7), moderate signals
    // should produce visible output (not near-zero)
    let peak = bars.iter().cloned().fold(0.0f32, f32::max);
    assert!(
        peak > 0.05,
        "Gain+curve shaping should boost moderate signals, peak={}",
        peak
    );
}

#[test]
fn test_output_clamped_0_to_1() {
    let mut analyzer = SpectrumAnalyzer::new();

    // Very loud signal that could exceed range without clamping
    let samples: Vec<f32> = (0..FFT_SIZE)
        .map(|i| 5.0 * (2.0 * PI * 440.0 * i as f32 / SAMPLE_RATE).sin())
        .collect();

    // Use extreme boost
    let bars = analyzer.analyze(&samples, 100.0);

    for (i, &val) in bars.iter().enumerate() {
        assert!(
            (0.0..=1.0).contains(&val),
            "Bar {} value {} must be in [0.0, 1.0]",
            i,
            val
        );
    }
}

#[test]
fn test_dc_removal() {
    let mut analyzer = SpectrumAnalyzer::new();

    // Signal with large DC offset — should not leak into spectrum
    let samples: Vec<f32> = (0..FFT_SIZE)
        .map(|i| 10.0 + 0.1 * (2.0 * PI * 440.0 * i as f32 / SAMPLE_RATE).sin())
        .collect();

    let bars = analyzer.analyze(&samples, 4.0);

    // Bar 0 (lowest freq) should not be disproportionately large
    // because DC offset has been subtracted
    let bar0 = bars[0];
    let mid_energy: f32 = bars[8..16].iter().sum::<f32>() / 8.0;
    // With DC removal, bar 0 shouldn't dominate
    // (Without removal, DC component would overwhelm everything)
    assert!(
        bar0 < 0.5 || mid_energy > 0.01,
        "DC removal: bar0={} should not dominate, mid_energy={}",
        bar0, mid_energy
    );
}

#[test]
fn test_reset_clears_noise_floor() {
    let mut analyzer = SpectrumAnalyzer::new();

    // Feed some data to change noise floor
    let noise: Vec<f32> = (0..FFT_SIZE)
        .map(|i| hash_sample(i) * 0.001)
        .collect();
    for _ in 0..20 {
        analyzer.analyze(&noise, 4.0);
    }

    // Reset should restore initial values
    analyzer.reset();
    for &nf in &analyzer.noise_floor {
        assert!((nf - (-40.0)).abs() < f32::EPSILON, "After reset, noise floor should be -40.0");
    }
}

// ---------------------------------------------------------------------
// `process_chunk` primitives — boost-independent peak RMS + sample cap.
// ---------------------------------------------------------------------

/// One `StreamSignals` per simulated stream — the struct the callback now
/// receives instead of nine separate atomics (review: parameter creep).
fn signals_with_boost(tenths: u32) -> StreamSignals {
    let s = StreamSignals::default();
    s.audio_boost.store(tenths, Ordering::Relaxed);
    s
}

#[test]
fn test_process_chunk_rms_peak_is_boost_independent() {
    let mut samples_high: Vec<f32> = Vec::new();
    let high = signals_with_boost(10_000); // 1000.0x — max clamp
    process_chunk(&[0.1f32; 64], 1, &mut samples_high, &high);
    let peak_with_high_boost = f32::from_bits(high.rms_peak_bits.load(Ordering::SeqCst));

    let mut samples_low: Vec<f32> = Vec::new();
    let low = signals_with_boost(1_000); // 100.0x — min clamp
    process_chunk(&[0.1f32; 64], 1, &mut samples_low, &low);
    let peak_with_low_boost = f32::from_bits(low.rms_peak_bits.load(Ordering::SeqCst));

    assert!(
        (peak_with_high_boost - peak_with_low_boost).abs() < 1e-6,
        "peak RMS must not depend on audio_boost: high={} low={}",
        peak_with_high_boost,
        peak_with_low_boost
    );
    assert!(
        (peak_with_high_boost - 0.1).abs() < 1e-4,
        "expected raw RMS ≈0.1, got {}",
        peak_with_high_boost
    );
}

#[test]
fn test_process_chunk_peak_tracks_loudest_chunk_then_take_resets() {
    let sig = signals_with_boost(8000);
    let mut samples: Vec<f32> = Vec::new();

    process_chunk(&[0.1f32; 64], 1, &mut samples, &sig);
    process_chunk(&[0.02f32; 64], 1, &mut samples, &sig);

    let peak = f32::from_bits(sig.rms_peak_bits.load(Ordering::SeqCst));
    assert!(
        (peak - 0.1).abs() < 1e-4,
        "fetch_max must retain the louder chunk's RMS across calls, got {}",
        peak
    );

    // This is exactly what AudioRecorder::take_rms_peak does.
    let taken = f32::from_bits(sig.rms_peak_bits.swap(0, Ordering::AcqRel));
    assert!((taken - 0.1).abs() < 1e-4);
    assert_eq!(
        sig.rms_peak_bits.load(Ordering::SeqCst),
        0,
        "peak must read back 0 immediately after draining"
    );
}

#[test]
fn test_process_chunk_respects_sample_cap() {
    let sig = signals_with_boost(8000);
    sig.max_samples.store(25, Ordering::SeqCst);
    let mut samples: Vec<f32> = Vec::new();

    // 4 chunks of 10 samples each = 40 raw samples pushed against a cap of 25.
    for _ in 0..4 {
        process_chunk(&[0.05f32; 10], 1, &mut samples, &sig);
    }

    assert_eq!(
        samples.len(),
        25,
        "buffer must never exceed the cap (per-sample check)"
    );
    assert!(
        sig.cap_hit.load(Ordering::SeqCst),
        "cap_hit must be set once the cap is reached"
    );
    assert!(
        sig.audio_level.load(Ordering::SeqCst) > 0,
        "level must still be computed for capped-out chunks (visualizer keeps working)"
    );
}

#[test]
fn test_process_chunk_no_cap_by_default() {
    let sig = signals_with_boost(8000);
    let mut samples: Vec<f32> = Vec::new();

    for _ in 0..50 {
        process_chunk(&[0.05f32; 100], 1, &mut samples, &sig);
    }

    assert_eq!(samples.len(), 5000);
    assert!(!sig.cap_hit.load(Ordering::SeqCst));
}

#[test]
fn test_process_chunk_marks_nonzero_seen_only_for_real_signal() {
    // The detector behind `StopReason::DeviceSilent` / `NoAudioFromDevice`.
    let sig = signals_with_boost(8000);
    let mut samples: Vec<f32> = Vec::new();
    for _ in 0..8 {
        process_chunk(&[0.0f32; 64], 1, &mut samples, &sig);
    }
    assert!(
        !sig.nonzero_seen.load(Ordering::SeqCst),
        "exact zeros must never count as signal"
    );
    process_chunk(&[0.0001f32; 64], 1, &mut samples, &sig);
    assert!(
        sig.nonzero_seen.load(Ordering::SeqCst),
        "one non-zero sample (a mic's noise floor) is enough"
    );
}
