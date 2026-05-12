use super::render::{amplify_level, pulse_factor, state_color};
use super::types::{self, parse_command, Command, OverlayState, WaveformLevels, BAR_COUNT};

#[test]
fn test_parse_command_show_recording() {
    assert_eq!(
        parse_command("show recording"),
        Some(Command::Show(OverlayState::Recording))
    );
}

#[test]
fn test_parse_command_show_transcribing() {
    assert_eq!(
        parse_command("show transcribing"),
        Some(Command::Show(OverlayState::Transcribing))
    );
}

#[test]
fn test_parse_command_show_idle() {
    assert_eq!(
        parse_command("show"),
        Some(Command::Show(OverlayState::Idle))
    );
    assert_eq!(
        parse_command("show unknown"),
        Some(Command::Show(OverlayState::Idle))
    );
}

#[test]
fn test_parse_command_hide() {
    assert_eq!(parse_command("hide"), Some(Command::Hide));
}

#[test]
fn test_parse_command_level() {
    assert_eq!(parse_command("level 0.5"), Some(Command::AudioLevel(0.5)));
    assert_eq!(parse_command("level 1.0"), Some(Command::AudioLevel(1.0)));
    assert_eq!(parse_command("level invalid"), None);
    assert_eq!(parse_command("level"), None);
}

#[test]
fn test_parse_command_position() {
    assert_eq!(
        parse_command("pos 100 200 300 400"),
        Some(Command::Position(100, 200, 300, 400))
    );
    assert_eq!(parse_command("pos 1 2 3"), None);
    assert_eq!(parse_command("pos a b c d"), None);
}

#[test]
fn test_parse_command_quit() {
    assert_eq!(parse_command("quit"), Some(Command::Quit));
}

#[test]
fn test_parse_command_unknown() {
    assert_eq!(parse_command("unknown"), None);
    assert_eq!(parse_command(""), None);
    assert_eq!(parse_command("   "), None);
}

#[test]
fn test_waveform_levels_push_and_get() {
    let mut levels = WaveformLevels::new(4);
    assert_eq!(levels.get(0), 0.0);
    assert_eq!(levels.get(3), 0.0);

    levels.push(0.5);
    assert_eq!(levels.get(3), 0.5);
    assert_eq!(levels.get(2), 0.0);

    levels.push(0.8);
    assert_eq!(levels.get(3), 0.8);
    assert_eq!(levels.get(2), 0.5);
}

#[test]
fn test_waveform_levels_sliding_window() {
    let mut levels = WaveformLevels::new(3);
    levels.push(1.0);
    levels.push(2.0);
    levels.push(3.0);
    assert_eq!(
        (levels.get(0), levels.get(1), levels.get(2)),
        (1.0, 2.0, 3.0)
    );

    levels.push(4.0);
    assert_eq!(
        (levels.get(0), levels.get(1), levels.get(2)),
        (2.0, 3.0, 4.0)
    );
}

#[test]
fn test_amplify_level() {
    assert!((amplify_level(0.0) - 0.0).abs() < f32::EPSILON);
    assert!((amplify_level(0.5) - 0.5).abs() < f32::EPSILON);
    assert!((amplify_level(1.0) - 1.0).abs() < f32::EPSILON);
    assert!((amplify_level(2.0) - 1.0).abs() < f32::EPSILON);
}

#[test]
fn test_state_color() {
    assert_eq!(state_color(OverlayState::Recording), types::colors::BLUE);
    assert_eq!(state_color(OverlayState::Idle), types::colors::BLUE);
    assert_eq!(
        state_color(OverlayState::Transcribing),
        types::colors::GREEN
    );
}

#[test]
fn test_pulse_factor_range() {
    // Sample phases including approximate π and 2π — use std consts to avoid
    // clippy::approx_constant. The test verifies range invariants, not exact values.
    for phase in [0.0, 1.0, 2.0, std::f32::consts::PI, std::f32::consts::TAU] {
        for i in 0..5 {
            let f = pulse_factor(phase, i);
            assert!((0.5..=1.0).contains(&f), "pulse_factor out of range: {}", f);
        }
    }
}

#[test]
fn test_parse_command_spectrum() {
    let mut expected_bins = [0.0f32; BAR_COUNT];
    expected_bins[0] = 0.1;
    expected_bins[1] = 0.2;
    expected_bins[2] = 0.3;

    let result = parse_command("spectrum [0.1,0.2,0.3,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0]");
    assert_eq!(result, Some(Command::Spectrum(expected_bins)));

    assert_eq!(parse_command("spectrum"), None);
    assert_eq!(parse_command("spectrum invalid"), None);
}

#[test]
fn test_parse_command_theme() {
    assert_eq!(
        parse_command("theme default"),
        Some(Command::Theme("default".to_string()))
    );
    assert_eq!(
        parse_command("theme winamp_classic"),
        Some(Command::Theme("winamp_classic".to_string()))
    );
    assert_eq!(parse_command("theme"), None);
}

#[test]
fn test_waveform_levels_set_from_bins() {
    let mut levels = WaveformLevels::new(BAR_COUNT);
    let mut bins = [0.0f32; BAR_COUNT];
    bins[0] = 0.5;
    bins[15] = 0.8;
    bins[31] = 1.0;

    levels.set_from_bins(&bins);

    assert_eq!(levels.get(0), 0.5);
    assert_eq!(levels.get(15), 0.8);
    assert_eq!(levels.get(31), 1.0);
    assert_eq!(levels.get(10), 0.0);
}
