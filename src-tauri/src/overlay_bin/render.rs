use super::types::{colors, OverlayState};

/// Pulse animation heights for transcribing state.
pub const PULSE_HEIGHTS: [f32; 5] = [0.3, 0.6, 1.0, 0.6, 0.3];

/// Amplify audio level for visualization.
/// Linear scaling capped at 1.0.
#[inline]
pub fn amplify_level(level: f32) -> f32 {
    level.min(1.0)
}

/// Get color for overlay state.
pub fn state_color(state: OverlayState) -> (u8, u8, u8) {
    match state {
        OverlayState::Recording | OverlayState::Idle | OverlayState::Hidden => colors::BLUE,
        OverlayState::Transcribing | OverlayState::Queued(_) => colors::GREEN,
    }
}

/// Calculate pulse factor for animation.
#[inline]
pub fn pulse_factor(phase: f32, bar_index: usize) -> f32 {
    let offset = bar_index as f32 * 0.3;
    ((phase + offset).sin() * 0.5 + 0.5) * 0.5 + 0.5
}

/// Convert state enum into Lua-compatible state name.
#[inline]
#[allow(dead_code)] // Used by Lua bridge in production builds.
pub fn state_name(state: OverlayState) -> &'static str {
    match state {
        OverlayState::Idle | OverlayState::Hidden => "idle",
        OverlayState::Recording => "recording",
        OverlayState::Transcribing | OverlayState::Queued(_) => "transcribing",
    }
}
