//! Handy-pill theme schema (Rust side).
//!
//! Mirror of `src/themes/handy.ts` so that the same JSON `theme.json`
//! file is the single source of truth: each theme declares a
//! `handy_pill` block (palette + animation) and both the React side
//! and the Tauri side read it identically.
//!
//! SOLID/DRY/KISS:
//!  - SRP: pure schema + resolver. No I/O, no commands.
//!  - DRY: hex values and animation defaults match `DEFAULT_HANDY_THEME`
//!    in `src/themes/handy.ts` exactly. If you change one, change both.
//!  - OCP: extending the schema = add an `Option<T>` field and a
//!    fallback line in `resolve_animation`/`resolve_palette`.
//!  - DIP: callers depend on the public structs (`HandyPillTheme` &c)
//!    and the `resolve_from_json` helper, never on serde internals.

use serde::{Deserialize, Serialize};
use specta::Type;

/// Six palette colours drive every coloured pixel in the pill UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct HandyPillPalette {
    pub icon_color: String,
    pub bar_color: String,
    pub bar_glow: String,
    pub shadow: String,
    pub transcribing_text: String,
    pub cancel_hover_bg: String,
}

/// Thirteen animation knobs.
///
/// Three of them (`smoothing_alpha`, `power_curve`, `peak_decay`) drive
/// JS bar math; the remaining surface as `--hp-*` CSS variables.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct HandyPillAnimation {
    pub smoothing_alpha: f32,
    pub power_curve: f32,
    pub peak_decay: f32,
    pub bar_min_height_px: u32,
    pub bar_min_opacity: f32,
    pub bar_opacity_gain: f32,
    pub bar_height_ms: u32,
    pub bar_opacity_ms: u32,
    pub pill_fade_ms: u32,
    pub transcribing_pulse_ms: u32,
    /// 0 disables idle breathing; 0.3 is the upper visual bound.
    pub idle_breathing_amplitude: f32,
    pub idle_breathing_period_ms: u32,
    pub cancel_hover_ms: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct HandyPillTheme {
    pub palette: HandyPillPalette,
    pub animation: HandyPillAnimation,
}

// Manual Eq so f32-bearing animation field doesn't block PartialEq usage
// in test asserts.

impl HandyPillTheme {
    /// Build a fresh copy of the canonical Handy pink theme.
    fn handy_default() -> Self {
        Self {
            palette: default_palette(),
            animation: default_animation(),
        }
    }
}

fn default_palette() -> HandyPillPalette {
    HandyPillPalette {
        icon_color: "#FAA2CA".to_string(),
        bar_color: "#ffe5ee".to_string(),
        bar_glow: "#FAA2CA".to_string(),
        shadow: "rgba(0, 0, 0, 0.45)".to_string(),
        transcribing_text: "#ffffff".to_string(),
        cancel_hover_bg: "rgba(250, 162, 202, 0.2)".to_string(),
    }
}

fn default_animation() -> HandyPillAnimation {
    HandyPillAnimation {
        smoothing_alpha: 0.3,
        power_curve: 0.7,
        peak_decay: 0.85,
        bar_min_height_px: 4,
        bar_min_opacity: 0.2,
        bar_opacity_gain: 1.7,
        bar_height_ms: 60,
        bar_opacity_ms: 120,
        pill_fade_ms: 300,
        transcribing_pulse_ms: 1500,
        idle_breathing_amplitude: 0.0,
        idle_breathing_period_ms: 3000,
        cancel_hover_ms: 150,
    }
}

/// Canonical default — Handy pink palette + reference animation timings.
/// Lazily constructed via a `Lazy` so tests can compare by reference and
/// callers can clone a fresh copy when needed.
pub static DEFAULT_HANDY_THEME: once_cell::sync::Lazy<HandyPillTheme> =
    once_cell::sync::Lazy::new(HandyPillTheme::handy_default);

// ---- partial-payload structs for serde with skip-on-error semantics ----

#[derive(Debug, Default, Deserialize)]
struct PartialPalette {
    icon_color: Option<String>,
    bar_color: Option<String>,
    bar_glow: Option<String>,
    shadow: Option<String>,
    transcribing_text: Option<String>,
    cancel_hover_bg: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct PartialAnimation {
    smoothing_alpha: Option<f32>,
    power_curve: Option<f32>,
    peak_decay: Option<f32>,
    bar_min_height_px: Option<i64>,
    bar_min_opacity: Option<f32>,
    bar_opacity_gain: Option<f32>,
    bar_height_ms: Option<i64>,
    bar_opacity_ms: Option<i64>,
    pill_fade_ms: Option<i64>,
    transcribing_pulse_ms: Option<i64>,
    idle_breathing_amplitude: Option<f32>,
    idle_breathing_period_ms: Option<i64>,
    cancel_hover_ms: Option<i64>,
}

#[derive(Debug, Default, Deserialize)]
struct PartialHandyPill {
    palette: Option<PartialPalette>,
    animation: Option<PartialAnimation>,
}

#[derive(Debug, Default, Deserialize)]
struct PartialThemeFile {
    handy_pill: Option<PartialHandyPill>,
}

#[inline]
fn clamp_f32(v: f32, lo: f32, hi: f32) -> f32 {
    v.clamp(lo, hi)
}

/// Force ms-fields to be >= 1 (zero or negative durations are nonsense).
#[inline]
fn ms(v: i64, fallback: u32) -> u32 {
    if v >= 1 {
        v as u32
    } else if v <= 0 {
        // Negative or zero → use fallback (mirrors the TS clamp behaviour).
        fallback.max(1)
    } else {
        fallback
    }
}

fn resolve_palette(p: Option<PartialPalette>) -> HandyPillPalette {
    let d = default_palette();
    let p = p.unwrap_or_default();
    HandyPillPalette {
        icon_color: p.icon_color.unwrap_or(d.icon_color),
        bar_color: p.bar_color.unwrap_or(d.bar_color),
        bar_glow: p.bar_glow.unwrap_or(d.bar_glow),
        shadow: p.shadow.unwrap_or(d.shadow),
        transcribing_text: p.transcribing_text.unwrap_or(d.transcribing_text),
        cancel_hover_bg: p.cancel_hover_bg.unwrap_or(d.cancel_hover_bg),
    }
}

fn resolve_animation(a: Option<PartialAnimation>) -> HandyPillAnimation {
    let d = default_animation();
    let a = a.unwrap_or_default();
    HandyPillAnimation {
        smoothing_alpha: clamp_f32(a.smoothing_alpha.unwrap_or(d.smoothing_alpha), 0.05, 1.0),
        power_curve: clamp_f32(a.power_curve.unwrap_or(d.power_curve), 0.05, 4.0),
        peak_decay: clamp_f32(a.peak_decay.unwrap_or(d.peak_decay), 0.1, 1.0),
        bar_min_height_px: a
            .bar_min_height_px
            .map(|v| if v >= 0 { v as u32 } else { d.bar_min_height_px })
            .unwrap_or(d.bar_min_height_px),
        bar_min_opacity: clamp_f32(a.bar_min_opacity.unwrap_or(d.bar_min_opacity), 0.0, 1.0),
        bar_opacity_gain: a
            .bar_opacity_gain
            .map(|v| if v >= 0.0 { v } else { d.bar_opacity_gain })
            .unwrap_or(d.bar_opacity_gain),
        bar_height_ms: a
            .bar_height_ms
            .map(|v| ms(v, d.bar_height_ms))
            .unwrap_or(d.bar_height_ms),
        bar_opacity_ms: a
            .bar_opacity_ms
            .map(|v| ms(v, d.bar_opacity_ms))
            .unwrap_or(d.bar_opacity_ms),
        pill_fade_ms: a
            .pill_fade_ms
            .map(|v| ms(v, d.pill_fade_ms))
            .unwrap_or(d.pill_fade_ms),
        transcribing_pulse_ms: a
            .transcribing_pulse_ms
            .map(|v| ms(v, d.transcribing_pulse_ms))
            .unwrap_or(d.transcribing_pulse_ms),
        idle_breathing_amplitude: clamp_f32(
            a.idle_breathing_amplitude
                .unwrap_or(d.idle_breathing_amplitude),
            0.0,
            0.3,
        ),
        idle_breathing_period_ms: a
            .idle_breathing_period_ms
            .map(|v| ms(v, d.idle_breathing_period_ms))
            .unwrap_or(d.idle_breathing_period_ms),
        cancel_hover_ms: a
            .cancel_hover_ms
            .map(|v| ms(v, d.cancel_hover_ms))
            .unwrap_or(d.cancel_hover_ms),
    }
}

/// Normalise an arbitrary parsed JSON value into a full
/// [`HandyPillTheme`]. Falls back to [`DEFAULT_HANDY_THEME`] for any
/// missing or malformed field. Never returns an error.
pub fn resolve_from_json(value: &serde_json::Value) -> HandyPillTheme {
    let partial: PartialThemeFile =
        serde_json::from_value(value.clone()).unwrap_or_default();
    let block = partial.handy_pill.unwrap_or_default();
    HandyPillTheme {
        palette: resolve_palette(block.palette),
        animation: resolve_animation(block.animation),
    }
}

// =============================================================================
// Built-in themes (compile-time embedded JSON)
// =============================================================================
//
// We `include_str!` every repository theme so the Rust side has the same
// 7-theme registry the TS side gets through Vite's `import.meta.glob`.
// This avoids the legacy code path that hardcodes one `builtin_by_id`
// match arm per theme and lets `get_handy_theme(id)` resolve any
// repository theme without copying files to ~/Library/Application Support.
//
// Drift safeguard: `all_builtin_themes_have_handy_pill` test in
// `overlay/themes_handy_tests.rs` parses every entry and asserts the
// resolved `icon_color` matches the JSON value (not the DEFAULT pink).

const BUILTIN_THEME_FILES: &[(&str, &str)] = &[
    ("winamp_classic",   include_str!("../../../themes/winamp_classic/theme.json")),
    ("default",          include_str!("../../../themes/default/theme.json")),
    ("dark",             include_str!("../../../themes/dark/theme.json")),
    ("monochrome",       include_str!("../../../themes/monochrome/theme.json")),
    ("neon",             include_str!("../../../themes/neon/theme.json")),
    ("drifting_contour", include_str!("../../../themes/drifting_contour/theme.json")),
    ("living_reed",      include_str!("../../../themes/living_reed/theme.json")),
    ("quiet_reed",       include_str!("../../../themes/quiet_reed/theme.json")),
];

/// Returns the embedded built-in theme by id, or `None` if no such id
/// exists. Used by `commands::overlay::get_handy_theme` so that the
/// Tauri command can resolve any of the 7 repository themes regardless
/// of whether the user has a copy under their config dir.
pub fn builtin_handy_theme(theme_id: &str) -> Option<HandyPillTheme> {
    let (_, raw) = BUILTIN_THEME_FILES.iter().find(|(id, _)| *id == theme_id)?;
    let value: serde_json::Value = serde_json::from_str(raw).ok()?;
    Some(resolve_from_json(&value))
}

/// Sorted list of every built-in theme id. Convenient for selectors /
/// e2e gallery suites that want to iterate all themes.
pub fn list_builtin_handy_theme_ids() -> Vec<&'static str> {
    let mut ids: Vec<&'static str> = BUILTIN_THEME_FILES.iter().map(|(id, _)| *id).collect();
    ids.sort_unstable();
    ids
}
