//! RED-first tests for the Handy-pill theme parser (Rust side).
//!
//! Mirrors the contract exercised by `src/themes/__tests__/handy.test.ts`
//! on the frontend. Tests live in a separate file so they can be wired
//! by a single `#[cfg(test)] mod themes_handy_tests` line in
//! `src-tauri/src/overlay/mod.rs`.
//!
//! These tests MUST fail on first run (the module
//! `crate::overlay::themes::handy` does not exist yet) — T3.2 then
//! implements `handy.rs` to turn them green.
//!
//! Wired via `#[cfg(test)] mod themes_handy_tests;` in overlay/mod.rs;
//! no inner `#![cfg(test)]` needed.

use crate::overlay::themes::handy::{
    HandyPillAnimation, HandyPillPalette, HandyPillTheme, resolve_from_json,
    DEFAULT_HANDY_THEME,
};

fn default_theme() -> HandyPillTheme {
    DEFAULT_HANDY_THEME.clone()
}

fn json(s: &str) -> serde_json::Value {
    serde_json::from_str(s).expect("test fixture must be valid JSON")
}

#[test]
fn missing_handy_pill_block_returns_default_palette_and_animation() {
    // Even without a `handy_pill` block, the legacy `family` field at
    // the JSON root is honoured (organic_ring → OrganicRing family).
    // Palette and animation still fall back to DEFAULT.
    let v = json(r#"{ "name": "anything", "family": "organic_ring" }"#);
    let t = resolve_from_json(&v);
    assert_eq!(t.palette, default_theme().palette);
    assert_eq!(t.animation, default_theme().animation);
    // Family is taken from the legacy root field.
    assert_eq!(
        t.family,
        crate::overlay::themes::handy::HandyPillFamily::OrganicRing
    );
}

#[test]
fn empty_json_falls_back_to_handy_family() {
    let v = json(r#"{ }"#);
    let t = resolve_from_json(&v);
    assert_eq!(
        t.family,
        crate::overlay::themes::handy::HandyPillFamily::Handy
    );
}

#[test]
fn legacy_bars_family_root_field_resolves_to_bars_family() {
    let v = json(r#"{ "family": "bars" }"#);
    let t = resolve_from_json(&v);
    assert_eq!(
        t.family,
        crate::overlay::themes::handy::HandyPillFamily::Bars
    );
}

#[test]
fn handy_pill_family_override_wins_over_legacy() {
    let v = json(
        r#"{ "family": "organic_ring", "handy_pill": { "family": "handy" } }"#,
    );
    let t = resolve_from_json(&v);
    assert_eq!(
        t.family,
        crate::overlay::themes::handy::HandyPillFamily::Handy
    );
}

#[test]
fn legacy_gradient_block_feeds_handy_pill_bars() {
    let v = json(
        r##"{ "gradient": { "bottom": "#001100", "middle": "#005500", "top": "#00ff00" } }"##,
    );
    let t = resolve_from_json(&v);
    assert_eq!(t.bars.gradient_bottom.to_lowercase(), "#001100");
    assert_eq!(t.bars.gradient_middle.to_lowercase(), "#005500");
    assert_eq!(t.bars.gradient_top.to_lowercase(), "#00ff00");
}

#[test]
fn empty_handy_pill_returns_default() {
    let v = json(r#"{ "handy_pill": {} }"#);
    let t = resolve_from_json(&v);
    assert_eq!(t, default_theme());
}

#[test]
fn partial_palette_keeps_default_animation() {
    let v = json(
        r##"{ "handy_pill": { "palette": { "icon_color": "#7cc287" } } }"##,
    );
    let t = resolve_from_json(&v);
    assert_eq!(t.palette.icon_color, "#7cc287");
    // remaining palette → defaults
    let d = default_theme();
    assert_eq!(t.palette.bar_color, d.palette.bar_color);
    // animation block untouched
    assert!((t.animation.smoothing_alpha - d.animation.smoothing_alpha).abs() < f32::EPSILON);
    assert!((t.animation.idle_breathing_amplitude - d.animation.idle_breathing_amplitude).abs() < f32::EPSILON);
}

#[test]
fn partial_animation_keeps_default_palette() {
    let v = json(
        r#"{ "handy_pill": { "animation": { "smoothing_alpha": 0.55 } } }"#,
    );
    let t = resolve_from_json(&v);
    assert!((t.animation.smoothing_alpha - 0.55).abs() < f32::EPSILON);
    assert_eq!(t.palette.icon_color, default_theme().palette.icon_color);
}

#[test]
fn full_payload_round_trips_every_field() {
    // Use r##"..."## because hex values contain the sequence `"#`
    // (closing quote of a JSON string followed by `#` of a hex color),
    // which would otherwise terminate a single-hash raw string.
    let v = json(
        r##"{
          "handy_pill": {
            "palette": {
              "icon_color": "#abc123",
              "bar_color": "#def456",
              "bar_glow": "#012345",
              "shadow": "rgba(1, 2, 3, 0.4)",
              "transcribing_text": "#ffffff",
              "cancel_hover_bg": "rgba(1, 2, 3, 0.2)"
            },
            "animation": {
              "smoothing_alpha": 0.42,
              "power_curve": 0.65,
              "peak_decay": 0.9,
              "bar_min_height_px": 5,
              "bar_min_opacity": 0.25,
              "bar_opacity_gain": 1.8,
              "bar_height_ms": 75,
              "bar_opacity_ms": 130,
              "pill_fade_ms": 280,
              "transcribing_pulse_ms": 1600,
              "idle_breathing_amplitude": 0.12,
              "idle_breathing_period_ms": 3500,
              "cancel_hover_ms": 160
            }
          }
        }"##,
    );
    let t = resolve_from_json(&v);
    assert_eq!(t.palette.icon_color, "#abc123");
    assert_eq!(t.palette.cancel_hover_bg, "rgba(1, 2, 3, 0.2)");
    assert!((t.animation.idle_breathing_amplitude - 0.12).abs() < f32::EPSILON);
    assert_eq!(t.animation.bar_height_ms, 75);
    assert_eq!(t.animation.cancel_hover_ms, 160);
}

#[test]
fn clamps_amplitude_alpha_and_ms_ranges() {
    let v = json(
        r#"{
          "handy_pill": {
            "animation": {
              "smoothing_alpha": -5,
              "idle_breathing_amplitude": 99,
              "bar_height_ms": -10,
              "pill_fade_ms": 0
            }
          }
        }"#,
    );
    let t = resolve_from_json(&v);
    assert!((t.animation.smoothing_alpha - 0.05).abs() < f32::EPSILON);
    assert!((t.animation.idle_breathing_amplitude - 0.3).abs() < f32::EPSILON);
    assert!(t.animation.bar_height_ms >= 1);
    assert!(t.animation.pill_fade_ms >= 1);
}

#[test]
fn all_repository_themes_parse_without_panic() {
    let themes_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("themes");
    let entries = std::fs::read_dir(&themes_dir)
        .expect("themes dir must exist")
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .collect::<Vec<_>>();
    assert!(
        !entries.is_empty(),
        "expected at least one theme in {themes_dir:?}"
    );
    let mut parsed = 0usize;
    for entry in entries {
        let json_path = entry.path().join("theme.json");
        if !json_path.exists() {
            continue;
        }
        let raw = std::fs::read_to_string(&json_path)
            .unwrap_or_else(|e| panic!("read {json_path:?}: {e}"));
        let v: serde_json::Value = serde_json::from_str(&raw)
            .unwrap_or_else(|e| panic!("parse {json_path:?}: {e}"));
        // Should never panic — missing handy_pill block falls back to defaults.
        let _t: HandyPillTheme = resolve_from_json(&v);
        parsed += 1;
    }
    assert!(
        parsed >= 8,
        "expected to parse >= 8 theme files (incl. winamp_classic), got {parsed}"
    );
}

#[test]
fn winamp_classic_uses_legacy_bars_palette() {
    // The Winamp Classic theme is a 'bars' family theme, not organic_ring.
    // Its handy_pill block should still use the recording-red color (#ef3110)
    // so the migrated pill remains recognisable as the Winamp legacy theme.
    use crate::overlay::themes::handy::builtin_handy_theme;
    let t = builtin_handy_theme("winamp_classic")
        .expect("winamp_classic must be in the builtin registry");
    assert_eq!(t.palette.icon_color.to_lowercase(), "#ef3110");
    assert_eq!(t.palette.bar_color.to_lowercase(), "#ffffff");
    // No idle breathing for a classic-EQ feel.
    assert!((t.animation.idle_breathing_amplitude - 0.0).abs() < f32::EPSILON);
    // Faster animation than the default (40 ms vs 60).
    assert!(t.animation.bar_height_ms <= 50);
}

#[test]
fn all_repository_themes_have_distinct_icon_colors() {
    // After T4.1 every repository theme declares its own `handy_pill.palette`.
    // Distinct icon colours guarantee that pixel-diff e2e (Phase 5.5) can
    // tell the themes apart.
    let themes_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("themes");
    let mut icon_colors = std::collections::HashSet::new();
    for entry in std::fs::read_dir(&themes_dir).unwrap().flatten() {
        let json_path = entry.path().join("theme.json");
        if !json_path.exists() {
            continue;
        }
        let raw = std::fs::read_to_string(&json_path).unwrap();
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let t = resolve_from_json(&v);
        icon_colors.insert(t.palette.icon_color.to_lowercase());
    }
    assert!(
        icon_colors.len() >= 8,
        "expected >= 8 distinct icon_color values across themes, got {} ({:?})",
        icon_colors.len(),
        icon_colors
    );
}

#[test]
fn default_palette_uses_handy_pink() {
    let d = default_theme();
    let p: &HandyPillPalette = &d.palette;
    assert_eq!(p.icon_color, "#FAA2CA");
    assert_eq!(p.bar_color, "#ffe5ee");
}

#[test]
fn default_animation_matches_handy_reference() {
    let d = default_theme();
    let a: &HandyPillAnimation = &d.animation;
    assert!((a.smoothing_alpha - 0.3).abs() < f32::EPSILON);
    assert!((a.power_curve - 0.7).abs() < f32::EPSILON);
    assert!((a.peak_decay - 0.85).abs() < f32::EPSILON);
    assert_eq!(a.bar_height_ms, 60);
    assert_eq!(a.pill_fade_ms, 300);
    assert_eq!(a.transcribing_pulse_ms, 1500);
    assert!((a.idle_breathing_amplitude - 0.0).abs() < f32::EPSILON);
}
