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

/// Visualisation family — picks which React component renders the pill.
/// Defaults to `Handy` (icon + bars + cancel) when omitted in JSON.
///
/// `Bars` — classic Winamp-style spectrum analyzer (full-width, no icon).
/// `OrganicRing` — breathing animated ring (legacy organic_ring rendering).
/// `Handy` — the compact icon + 9-bar + cancel pill ported from upstream.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum HandyPillFamily {
    Bars,
    OrganicRing,
    #[default]
    Handy,
}

/// Per-family `bars` configuration. Only consumed by `Family::Bars`
/// themes; ignored for the others. Pulled from `theme.json` block
/// `handy_pill.bars` with fallbacks to the legacy root `gradient` block.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct HandyPillBars {
    pub count: u32,
    pub gradient_bottom: String,
    pub gradient_middle: String,
    pub gradient_top: String,
}

/// Per-family `ring` configuration. Only consumed by
/// `Family::OrganicRing` themes. Pulled from `theme.json` block
/// `handy_pill.ring` with fallbacks to the legacy root
/// `organic_ring{shape, motion}` block.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct HandyPillRing {
    pub gap_degrees: f32,
    pub base_thickness: f32,
    pub taper: f32,
    pub roundness: f32,
    pub active_zones: u8,
    /// Multiplier for speech-driven jitter (mirrored from
    /// legacy `organic_ring.motion.speech_responsiveness`).
    pub speech_responsiveness: f32,
    /// Hue-drift speed (legacy `organic_ring.motion.drift`).
    pub drift: f32,
    /// How quickly the ring snaps back to its idle shape after a peak
    /// (legacy `organic_ring.motion.settle_speed`).
    pub settle_speed: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct HandyPillTheme {
    pub family: HandyPillFamily,
    pub palette: HandyPillPalette,
    pub animation: HandyPillAnimation,
    pub bars: HandyPillBars,
    pub ring: HandyPillRing,
}

// Manual Eq so f32-bearing animation field doesn't block PartialEq usage
// in test asserts.

impl HandyPillTheme {
    /// Build a fresh copy of the canonical Handy pink theme.
    fn handy_default() -> Self {
        Self {
            family: HandyPillFamily::default(),
            palette: default_palette(),
            animation: default_animation(),
            bars: default_bars(),
            ring: default_ring(),
        }
    }
}

fn default_ring() -> HandyPillRing {
    // Mirrors the `living_reed` defaults — a balanced organic profile.
    HandyPillRing {
        gap_degrees: 42.0,
        base_thickness: 7.2,
        taper: 0.7,
        roundness: 0.9,
        active_zones: 3,
        speech_responsiveness: 0.92,
        drift: 0.38,
        settle_speed: 0.6,
    }
}

fn default_bars() -> HandyPillBars {
    // Material Blue gradient — matches the legacy `default` theme look.
    HandyPillBars {
        count: 16,
        gradient_bottom: "#1e88e5".to_string(),
        gradient_middle: "#42a5f5".to_string(),
        gradient_top: "#64b5f6".to_string(),
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
struct PartialBars {
    count: Option<u32>,
    gradient_bottom: Option<String>,
    gradient_middle: Option<String>,
    gradient_top: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct PartialRing {
    gap_degrees: Option<f32>,
    base_thickness: Option<f32>,
    taper: Option<f32>,
    roundness: Option<f32>,
    active_zones: Option<u8>,
    speech_responsiveness: Option<f32>,
    drift: Option<f32>,
    settle_speed: Option<f32>,
}

#[derive(Debug, Default, Deserialize)]
struct LegacyRingShape {
    gap_degrees: Option<f32>,
    base_thickness: Option<f32>,
    taper: Option<f32>,
    roundness: Option<f32>,
    active_zones: Option<u8>,
}

#[derive(Debug, Default, Deserialize)]
struct LegacyRingMotion {
    speech_responsiveness: Option<f32>,
    drift: Option<f32>,
    settle_speed: Option<f32>,
}

#[derive(Debug, Default, Deserialize)]
struct LegacyOrganicRing {
    shape: Option<LegacyRingShape>,
    motion: Option<LegacyRingMotion>,
}

#[derive(Debug, Default, Deserialize)]
struct PartialHandyPill {
    family: Option<HandyPillFamily>,
    palette: Option<PartialPalette>,
    animation: Option<PartialAnimation>,
    bars: Option<PartialBars>,
    ring: Option<PartialRing>,
}

#[derive(Debug, Default, Deserialize)]
struct LegacyGradient {
    bottom: Option<String>,
    middle: Option<String>,
    top: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct PartialThemeFile {
    /// Legacy family field at the root of theme.json ("bars",
    /// "organic_ring"). Used as a fallback when `handy_pill.family`
    /// is omitted.
    family: Option<String>,
    /// Legacy `gradient` block; consumed as a fallback for
    /// `handy_pill.bars.gradient_*`.
    gradient: Option<LegacyGradient>,
    /// Legacy `organic_ring{shape, motion}` block; consumed as a
    /// fallback for `handy_pill.ring.*`.
    organic_ring: Option<LegacyOrganicRing>,
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

fn resolve_family(
    handy_family: Option<HandyPillFamily>,
    legacy_family: Option<String>,
) -> HandyPillFamily {
    if let Some(f) = handy_family {
        return f;
    }
    match legacy_family.as_deref() {
        Some("bars") => HandyPillFamily::Bars,
        Some("organic_ring") => HandyPillFamily::OrganicRing,
        Some("handy") | None | Some(_) => HandyPillFamily::Handy,
    }
}

fn resolve_ring(
    ring: Option<PartialRing>,
    legacy: Option<LegacyOrganicRing>,
) -> HandyPillRing {
    let d = default_ring();
    let ring = ring.unwrap_or_default();
    let legacy = legacy.unwrap_or_default();
    let legacy_shape = legacy.shape.unwrap_or_default();
    let legacy_motion = legacy.motion.unwrap_or_default();
    HandyPillRing {
        gap_degrees: ring
            .gap_degrees
            .or(legacy_shape.gap_degrees)
            .unwrap_or(d.gap_degrees)
            .clamp(0.0, 359.0),
        base_thickness: ring
            .base_thickness
            .or(legacy_shape.base_thickness)
            .unwrap_or(d.base_thickness)
            .max(0.1),
        taper: ring
            .taper
            .or(legacy_shape.taper)
            .unwrap_or(d.taper)
            .clamp(0.0, 1.0),
        roundness: ring
            .roundness
            .or(legacy_shape.roundness)
            .unwrap_or(d.roundness)
            .clamp(0.0, 1.0),
        active_zones: ring
            .active_zones
            .or(legacy_shape.active_zones)
            .unwrap_or(d.active_zones)
            .clamp(1, 12),
        speech_responsiveness: ring
            .speech_responsiveness
            .or(legacy_motion.speech_responsiveness)
            .unwrap_or(d.speech_responsiveness)
            .clamp(0.0, 2.0),
        drift: ring
            .drift
            .or(legacy_motion.drift)
            .unwrap_or(d.drift)
            .clamp(0.0, 2.0),
        settle_speed: ring
            .settle_speed
            .or(legacy_motion.settle_speed)
            .unwrap_or(d.settle_speed)
            .clamp(0.0, 2.0),
    }
}

fn resolve_bars(
    bars: Option<PartialBars>,
    legacy_gradient: Option<LegacyGradient>,
) -> HandyPillBars {
    let d = default_bars();
    let bars = bars.unwrap_or_default();
    let legacy = legacy_gradient.unwrap_or_default();
    HandyPillBars {
        count: bars.count.unwrap_or(d.count).clamp(2, 64),
        gradient_bottom: bars
            .gradient_bottom
            .or(legacy.bottom)
            .unwrap_or(d.gradient_bottom),
        gradient_middle: bars
            .gradient_middle
            .or(legacy.middle)
            .unwrap_or(d.gradient_middle),
        gradient_top: bars.gradient_top.or(legacy.top).unwrap_or(d.gradient_top),
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
        family: resolve_family(block.family, partial.family),
        palette: resolve_palette(block.palette),
        animation: resolve_animation(block.animation),
        bars: resolve_bars(block.bars, partial.gradient),
        ring: resolve_ring(block.ring, partial.organic_ring),
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
