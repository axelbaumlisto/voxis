//! Overlay window management.
//!
//! The overlay shows recording status and audio visualization.

pub mod themes;
pub mod types;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

pub use types::{OverlayState as NativeOverlayState, PositionConfig, SizeConfig};

/// Current overlay state (stored for pull-based access).
/// This solves the race condition where frontend listeners aren't ready
/// when the backend first emits state after window.show().
static CURRENT_STATE: Lazy<Mutex<OverlayState>> = Lazy::new(|| Mutex::new(OverlayState::Hidden));

/// Overlay state for display.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum OverlayState {
    Hidden,
    Idle,
    Recording,
    Transcribing,
    Error(String),
}

/// Overlay position on screen.
#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum OverlayPosition {
    #[default]
    BottomLeft,
    BottomRight,
    TopLeft,
    TopRight,
    Center,
    TopCenter,
    BottomCenter,
    LeftCenter,
    RightCenter,
}

impl OverlayPosition {
    /// Parse position from config string.
    pub fn parse(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "bottom_left" => Self::BottomLeft,
            "bottom_right" => Self::BottomRight,
            "top_left" => Self::TopLeft,
            "top_right" => Self::TopRight,
            "center" => Self::Center,
            "top_center" => Self::TopCenter,
            "bottom_center" => Self::BottomCenter,
            "left_center" => Self::LeftCenter,
            "right_center" => Self::RightCenter,
            _ => Self::default(),
        }
    }
}

/// Get the current overlay state (for pull-based initialization).
pub fn get_current_state() -> OverlayState {
    CURRENT_STATE.lock().unwrap().clone()
}

/// Set the current overlay state.
fn set_current_state(state: OverlayState) {
    *CURRENT_STATE.lock().unwrap() = state;
}

/// Get the overlay window.
pub fn get_overlay_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("overlay")
}

/// Show the overlay window with a specific state.
pub fn show_overlay(app: &AppHandle, state: OverlayState) -> Result<(), String> {
    let window = get_overlay_window(app).ok_or("Overlay window not found")?;

    // Store state FIRST so frontend can pull it
    set_current_state(state.clone());
    tracing::info!("Overlay state stored: {:?}", state);

    // Show the window
    window.show().map_err(|e| e.to_string())?;
    tracing::debug!("Overlay window shown");

    // Emit state directly to overlay window (in case listeners are ready)
    window
        .emit("overlay-state", &state)
        .map_err(|e| e.to_string())?;

    tracing::info!("Overlay state emitted: {:?}", state);

    Ok(())
}

/// Hide the overlay window.
pub fn hide_overlay(app: &AppHandle) -> Result<(), String> {
    let window = get_overlay_window(app).ok_or("Overlay window not found")?;
    set_current_state(OverlayState::Hidden);
    window.hide().map_err(|e| e.to_string())?;
    tracing::debug!("Overlay hidden");
    Ok(())
}

/// Update overlay position based on config.
pub fn update_overlay_position(
    app: &AppHandle,
    position: OverlayPosition,
    margin: i32,
) -> Result<(), String> {
    let window = get_overlay_window(app).ok_or("Overlay window not found")?;

    // Get screen size
    let monitor = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("No monitor found")?;

    let screen_size = monitor.size();
    let window_size = window.outer_size().map_err(|e| e.to_string())?;

    let screen_h = screen_size.height as i32;
    let screen_w = screen_size.width as i32;
    let win_h = window_size.height as i32;
    let win_w = window_size.width as i32;

    let (x, y) = match position {
        OverlayPosition::BottomLeft => (margin, screen_h - win_h - margin),
        OverlayPosition::BottomRight => (screen_w - win_w - margin, screen_h - win_h - margin),
        OverlayPosition::TopLeft => (margin, margin),
        OverlayPosition::TopRight => (screen_w - win_w - margin, margin),
        OverlayPosition::Center => ((screen_w - win_w) / 2, (screen_h - win_h) / 2),
        OverlayPosition::TopCenter => ((screen_w - win_w) / 2, margin),
        OverlayPosition::BottomCenter => ((screen_w - win_w) / 2, screen_h - win_h - margin),
        OverlayPosition::LeftCenter => (margin, (screen_h - win_h) / 2),
        OverlayPosition::RightCenter => (screen_w - win_w - margin, (screen_h - win_h) / 2),
    };

    window
        .set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }))
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Emit audio level to overlay for visualization.
pub fn emit_audio_level(app: &AppHandle, level: f32) -> Result<(), String> {
    // Emit directly to overlay window
    if let Some(window) = get_overlay_window(app) {
        window
            .emit("audio-level", level)
            .map_err(|e| e.to_string())?;
        tracing::debug!("Emitted audio-level {} to overlay", level);
    } else {
        tracing::warn!("Overlay window not found for audio-level emit");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_overlay_state_serialize() {
        let state = OverlayState::Recording;
        let json = serde_json::to_string(&state).unwrap();
        assert_eq!(json, "\"recording\"");
    }

    #[test]
    fn test_overlay_position_serialize() {
        let pos = OverlayPosition::BottomLeft;
        let json = serde_json::to_string(&pos).unwrap();
        assert_eq!(json, "\"bottom_left\"");
    }

    #[test]
    fn test_overlay_position_parse_left_right_center() {
        assert!(matches!(
            OverlayPosition::parse("left_center"),
            OverlayPosition::LeftCenter
        ));
        assert!(matches!(
            OverlayPosition::parse("right_center"),
            OverlayPosition::RightCenter
        ));
    }

    #[test]
    fn test_error_state() {
        let state = OverlayState::Error("Test error".into());
        let json = serde_json::to_string(&state).unwrap();
        assert!(json.contains("error"));
        assert!(json.contains("Test error"));
    }

    #[test]
    fn test_overlay_state_storage() {
        // Reset to known state first
        set_current_state(OverlayState::Hidden);

        // Initial state should be Hidden
        assert!(matches!(get_current_state(), OverlayState::Hidden));

        // After setting state, should return it
        set_current_state(OverlayState::Recording);
        assert!(matches!(get_current_state(), OverlayState::Recording));

        // Test Idle state
        set_current_state(OverlayState::Idle);
        assert!(matches!(get_current_state(), OverlayState::Idle));

        // Reset for other tests
        set_current_state(OverlayState::Hidden);
    }
}
