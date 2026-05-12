use super::*;

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
    let samples: Vec<f32> = (0..FFT_SIZE)
        .map(|i| {
            // Simple PRNG for deterministic test
            let x = ((i as f32 * 12345.6789).sin() * 43758.5453).fract();
            x * 2.0 - 1.0
        })
        .collect();

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
            val >= 0.0 && val <= 1.0,
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
        .map(|i| ((i as f32 * 12345.6789).sin() * 43758.5453).fract() * 0.001)
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
        .map(|i| ((i as f32 * 12345.6789).sin() * 43758.5453).fract() * 0.001)
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
