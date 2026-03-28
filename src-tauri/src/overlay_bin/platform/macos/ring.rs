use voice_lib::overlay::themes::VisualizationTheme;
use voice_lib::overlay::types::SizeConfig;

use crate::overlay_bin::types::{OverlayState, WaveformLevels};

fn ring_state_energy(
    state: OverlayState,
    speech_energy: f32,
    animation_time: f32,
    theme: &VisualizationTheme,
) -> f32 {
    let organic = match &theme.organic_ring {
        Some(organic) => organic,
        None => return 0.0,
    };

    match state {
        OverlayState::Idle | OverlayState::Hidden => {
            organic.motion.idle_breathing * (1.0 + (animation_time * 0.8).sin() * 0.25)
        }
        OverlayState::Recording => (organic.motion.idle_breathing
            + speech_energy * organic.motion.speech_responsiveness * 1.18)
            .clamp(0.0, 1.0),
        OverlayState::Transcribing | OverlayState::Queued(_) => {
            (organic.motion.idle_breathing * 0.72 + speech_energy * 0.12).clamp(0.0, 1.0)
        }
    }
}

fn apply_ring_gap(angle: f32, gap_degrees: f32) -> bool {
    angle.abs() < gap_degrees.to_radians() / 2.0
}

fn ring_oscillation(
    angle: f32,
    levels: &WaveformLevels,
    animation_time: f32,
    state_energy: f32,
    active_zones: u8,
    drift: f32,
) -> f32 {
    let normalized_angle = (angle + std::f32::consts::PI / 2.0).rem_euclid(std::f32::consts::TAU)
        / std::f32::consts::TAU;
    let level_index = if levels.is_empty() {
        0
    } else {
        ((normalized_angle * levels.len() as f32) as usize).min(levels.len() - 1)
    };
    let level = if levels.is_empty() {
        0.0
    } else {
        levels.get(level_index)
    };

    let mut wave = 0.0;
    let zones = active_zones.max(1) as usize;
    for zone in 0..zones {
        let phase = animation_time * (0.4 + zone as f32 * 0.17) + zone as f32 * 1.3;
        wave += ((normalized_angle * std::f32::consts::TAU * (zone as f32 + 1.0)) + phase).sin();
    }
    wave /= zones as f32;

    (wave * (0.35 + level * 0.65) * (state_energy + drift * 0.2)).clamp(-1.0, 1.0)
}

fn ring_stroke_width(angle: f32, theme: &VisualizationTheme) -> f32 {
    let organic = match &theme.organic_ring {
        Some(organic) => organic,
        None => return 1.0,
    };
    let normalized = (angle + std::f32::consts::PI / 2.0).rem_euclid(std::f32::consts::TAU)
        / std::f32::consts::TAU;
    let taper_wave =
        ((normalized * std::f32::consts::TAU).sin() * 0.5 + 0.5).powf(1.0 + organic.shape.taper);
    (organic.shape.base_thickness * (0.45 + taper_wave * 0.55)).max(1.0)
}

fn infer_overlay_size(width: f64, height: f64) -> SizeConfig {
    if height <= 75.0 || width <= 250.0 {
        SizeConfig::Small
    } else if height <= 150.0 || width <= 450.0 {
        SizeConfig::Medium
    } else {
        SizeConfig::Large
    }
}

fn organic_base_radius(size_config: SizeConfig, width: f64, height: f64) -> f32 {
    let radius = width.min(height) as f32 * 0.34;
    match size_config {
        SizeConfig::Medium => radius / 2.0,
        SizeConfig::Small | SizeConfig::Large => radius,
    }
}

fn build_ring_points(
    width: f64,
    height: f64,
    levels: &WaveformLevels,
    animation_time: f32,
    speech_energy: f32,
    theme: &VisualizationTheme,
    state: OverlayState,
) -> Vec<(f64, f64)> {
    let organic = match &theme.organic_ring {
        Some(organic) => organic,
        None => return Vec::new(),
    };
    let sample_count = 120usize;
    let center_x = width as f32 / 2.0;
    let center_y = height as f32 / 2.0;
    let base_radius = organic_base_radius(infer_overlay_size(width, height), width, height);
    let state_energy = ring_state_energy(state, speech_energy, animation_time, theme);

    (0..sample_count)
        .filter_map(|index| {
            let angle = -std::f32::consts::PI / 2.0
                + (index as f32 / sample_count as f32) * std::f32::consts::TAU;
            if apply_ring_gap(angle, organic.shape.gap_degrees) {
                return None;
            }

            let oscillation = ring_oscillation(
                angle,
                levels,
                animation_time,
                state_energy,
                organic.shape.active_zones,
                organic.motion.drift,
            );
            let pulse_multiplier = match state {
                OverlayState::Transcribing | OverlayState::Queued(_) => {
                    1.0 + (animation_time * 4.2).sin() * 0.12
                }
                _ => 1.0,
            };
            let radius = (base_radius * pulse_multiplier * (1.0 + oscillation * 0.51))
                .max(base_radius * 0.6);

            Some((
                (center_x + radius * angle.cos()) as f64,
                (center_y + radius * angle.sin()) as f64,
            ))
        })
        .collect()
}

pub fn draw_organic_ring(
    state: &super::ViewState,
    width: f64,
    height: f64,
    color: egui::Color32,
    mut set_ns_color: impl FnMut(egui::Color32),
    mut draw_segment: impl FnMut(f64, f64, f64, f64, f64),
) {
    let points = build_ring_points(
        width,
        height,
        &state.levels,
        state.animation_time,
        state.speech_energy,
        &state.visual_theme,
        state.state,
    );
    if points.len() < 2 {
        return;
    }

    set_ns_color(color);
    let center_x = width / 2.0;
    let center_y = height / 2.0;

    for window in points.windows(2) {
        let (x1, y1) = window[0];
        let (x2, y2) = window[1];
        let angle = ((y1 + y2) as f32 / 2.0 - center_y as f32)
            .atan2((x1 + x2) as f32 / 2.0 - center_x as f32);
        draw_segment(
            x1,
            y1,
            x2,
            y2,
            ring_stroke_width(angle, &state.visual_theme) as f64,
        );
    }
}

pub fn calm_interpolate(current: f32, target: f32, speed: f32) -> f32 {
    let factor = speed.clamp(0.0, 1.0);
    current + (target - current) * factor
}
