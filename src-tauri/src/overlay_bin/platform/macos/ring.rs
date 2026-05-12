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

#[cfg(test)]
mod tests {
    //! Geometry contract tests for the organic ring overlay rendering.
    //!
    //! These tests cover the pure-Rust geometry functions independently of
    //! NSBezierPath/AppKit. If a test here fails, the geometry pipeline is
    //! broken. If they all pass but the rendered PNG is blank, the bug is in
    //! the AppKit drawing layer (`draw.rs` / `set_ns_color` / msg_send) or in
    //! how themes are loaded into the binary.

    use super::*;
    use crate::overlay_bin::types::BAR_COUNT;
    use voice_lib::overlay::themes::{
        OrganicRingMotion, OrganicRingShape, OrganicRingTheme, VisualizationFamily,
        VisualizationTheme,
    };

    /// Build a synthetic OrganicRing theme with the given shape/motion overrides.
    /// SRP helper — keeps each test focused on the assertion, not setup.
    fn organic_theme(shape: OrganicRingShape, motion: OrganicRingMotion) -> VisualizationTheme {
        let mut t = VisualizationTheme::builtin_living_reed();
        t.family = VisualizationFamily::OrganicRing;
        t.organic_ring = Some(OrganicRingTheme { shape, motion });
        t
    }

    fn default_organic_shape() -> OrganicRingShape {
        OrganicRingShape {
            gap_degrees: 42.0,
            base_thickness: 7.2,
            taper: 0.7,
            roundness: 0.9,
            active_zones: 3,
        }
    }

    fn default_organic_motion() -> OrganicRingMotion {
        OrganicRingMotion {
            idle_breathing: 0.1,
            speech_responsiveness: 0.92,
            drift: 0.38,
            settle_speed: 0.6,
        }
    }

    fn default_organic_theme() -> VisualizationTheme {
        organic_theme(default_organic_shape(), default_organic_motion())
    }

    // ------------------------------------------------------------------
    // infer_overlay_size / organic_base_radius
    // ------------------------------------------------------------------

    #[test]
    fn test_infer_overlay_size_small_for_default_window() {
        // The default overlay window is 250x60 (DEFAULT_WIDTH x DEFAULT_HEIGHT).
        assert!(matches!(
            infer_overlay_size(250.0, 60.0),
            SizeConfig::Small
        ));
    }

    #[test]
    fn test_infer_overlay_size_medium_for_e2e_harness() {
        // The E2E harness uses 400x100; that should be Medium per current thresholds.
        assert!(matches!(
            infer_overlay_size(400.0, 100.0),
            SizeConfig::Medium
        ));
    }

    #[test]
    fn test_infer_overlay_size_large_for_big_window() {
        assert!(matches!(
            infer_overlay_size(500.0, 200.0),
            SizeConfig::Large
        ));
    }

    #[test]
    fn test_organic_base_radius_is_visible_for_400x100() {
        // For the E2E harness window (400x100, classified as Medium), the ring
        // must be visually meaningful — at least ~15 px so 7px stroke is
        // contained inside the window vertically.
        let r = organic_base_radius(SizeConfig::Medium, 400.0, 100.0);
        assert!(
            r >= 12.0,
            "organic_base_radius for 400x100 Medium = {r} (expected ≥ 12 px)"
        );
        // And not exceed available half-height (50).
        assert!(
            r <= 50.0,
            "organic_base_radius for 400x100 Medium = {r} (expected ≤ 50 px)"
        );
    }

    #[test]
    fn test_organic_base_radius_is_visible_for_250x60_small() {
        // For the default overlay window (Small), radius should also be visible.
        let r = organic_base_radius(SizeConfig::Small, 250.0, 60.0);
        assert!(
            r >= 12.0,
            "organic_base_radius for 250x60 Small = {r} (expected ≥ 12 px)"
        );
        assert!(
            r <= 30.0,
            "organic_base_radius for 250x60 Small = {r} (expected ≤ 30 px = h/2)"
        );
    }

    // ------------------------------------------------------------------
    // apply_ring_gap
    // ------------------------------------------------------------------

    #[test]
    fn test_apply_ring_gap_centered_around_zero() {
        // 42° gap means ±21° from center angle (0 rad after the
        // -π/2 + i/N * 2π mapping puts ring start at angle 0 = top).
        assert!(apply_ring_gap(0.0, 42.0)); // dead center
        assert!(apply_ring_gap(20f32.to_radians(), 42.0)); // just inside
        assert!(!apply_ring_gap(22f32.to_radians(), 42.0)); // just outside
    }

    #[test]
    fn test_apply_ring_gap_zero_degrees_passes_all() {
        // A 0° gap means no gap. Only angle == 0 exactly falls inside |a| < 0,
        // which is unreachable for finite floats.
        assert!(!apply_ring_gap(0.001, 0.0));
        assert!(!apply_ring_gap(-0.001, 0.0));
    }

    // ------------------------------------------------------------------
    // ring_stroke_width
    // ------------------------------------------------------------------

    #[test]
    fn test_ring_stroke_width_never_below_one_pixel() {
        // The .max(1.0) clamp must keep stroke visible at every angle.
        let theme = default_organic_theme();
        for i in 0..360 {
            let angle = (i as f32).to_radians() - std::f32::consts::PI / 2.0;
            let w = ring_stroke_width(angle, &theme);
            assert!(
                w >= 1.0,
                "ring_stroke_width at angle {i}° = {w} (must be ≥ 1.0)"
            );
        }
    }

    #[test]
    fn test_ring_stroke_width_uses_base_thickness() {
        // Stroke must scale with base_thickness; doubling thickness should at
        // least raise the peak stroke proportionally.
        let thin = organic_theme(
            OrganicRingShape { base_thickness: 2.0, ..default_organic_shape() },
            default_organic_motion(),
        );
        let thick = organic_theme(
            OrganicRingShape { base_thickness: 12.0, ..default_organic_shape() },
            default_organic_motion(),
        );
        // Sample at angle that yields the peak (taper_wave ≈ 1)
        let peak_angle = std::f32::consts::PI / 2.0;
        let w_thin = ring_stroke_width(peak_angle, &thin);
        let w_thick = ring_stroke_width(peak_angle, &thick);
        assert!(
            w_thick > w_thin * 2.0,
            "thick stroke ({w_thick}) should be > 2× thin stroke ({w_thin})"
        );
    }

    #[test]
    fn test_ring_stroke_width_no_organic_returns_one() {
        // Non-OrganicRing theme → default 1.0 (graceful fallback).
        let mut t = VisualizationTheme::builtin_winamp_classic();
        t.organic_ring = None;
        assert_eq!(ring_stroke_width(0.0, &t), 1.0);
    }

    // ------------------------------------------------------------------
    // build_ring_points
    // ------------------------------------------------------------------

    #[test]
    fn test_build_ring_points_emits_most_samples_for_42deg_gap() {
        // 120 samples × (1 - 42/360) ≈ 106. Gate at 95 to allow for boundary
        // sampling rounding.
        let theme = default_organic_theme();
        let levels = WaveformLevels::new(BAR_COUNT);
        let points = build_ring_points(
            400.0,
            100.0,
            &levels,
            0.0,
            0.0,
            &theme,
            OverlayState::Recording,
        );
        assert!(
            points.len() >= 95 && points.len() <= 120,
            "build_ring_points returned {} (expected ~106 for 42° gap)",
            points.len()
        );
    }

    #[test]
    fn test_build_ring_points_within_window_bounds() {
        let theme = default_organic_theme();
        let levels = WaveformLevels::new(BAR_COUNT);
        let points = build_ring_points(
            400.0,
            100.0,
            &levels,
            0.0,
            0.0,
            &theme,
            OverlayState::Recording,
        );
        for &(x, y) in &points {
            assert!(
                (0.0..=400.0).contains(&x),
                "point x={x} out of [0, 400] bounds"
            );
            assert!(
                (0.0..=100.0).contains(&y),
                "point y={y} out of [0, 100] bounds"
            );
        }
    }

    #[test]
    fn test_build_ring_points_returns_empty_for_non_organic() {
        let mut theme = VisualizationTheme::builtin_winamp_classic();
        theme.organic_ring = None;
        let levels = WaveformLevels::new(BAR_COUNT);
        let points = build_ring_points(
            400.0,
            100.0,
            &levels,
            0.0,
            0.0,
            &theme,
            OverlayState::Recording,
        );
        assert!(points.is_empty());
    }

    // ------------------------------------------------------------------
    // Theme differentiation contracts (will guide Phase 2.1).
    // These tests FAIL if all three organic themes produce identical geometry.
    // ------------------------------------------------------------------

    fn geometry_signature(theme: &VisualizationTheme) -> (usize, i64) {
        let levels = WaveformLevels::new(BAR_COUNT);
        let points = build_ring_points(
            400.0,
            100.0,
            &levels,
            0.0,
            0.0,
            theme,
            OverlayState::Recording,
        );
        // Sum coords rounded to int as a stable fingerprint.
        let sum: f64 = points.iter().map(|(x, y)| x + y).sum();
        (points.len(), (sum * 100.0) as i64)
    }

    #[test]
    fn test_organic_themes_have_distinct_geometry_signatures() {
        let quiet = VisualizationTheme::builtin_quiet_reed();
        let living = VisualizationTheme::builtin_living_reed();
        let drifting = VisualizationTheme::builtin_drifting_contour();

        let sig_q = geometry_signature(&quiet);
        let sig_l = geometry_signature(&living);
        let sig_d = geometry_signature(&drifting);

        // Pair-wise distinctness. If this fails, all three themes share
        // identical OrganicRingShape — see Phase 2.1 of the cleanup plan.
        assert_ne!(
            sig_q, sig_l,
            "quiet_reed and living_reed share geometry: {sig_q:?}"
        );
        assert_ne!(
            sig_q, sig_d,
            "quiet_reed and drifting_contour share geometry: {sig_q:?}"
        );
        assert_ne!(
            sig_l, sig_d,
            "living_reed and drifting_contour share geometry: {sig_l:?}"
        );
    }
}
