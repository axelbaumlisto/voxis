use super::OverlayState;
use crate::audio::SPECTRUM_BARS;

/// Trait for overlay backend implementations.
///
/// All methods are non-blocking. Implementations should handle
/// communication with the overlay asynchronously.
pub trait OverlayBackend: Send + Sync {
    fn show(&self, state: OverlayState);
    fn hide(&self);
    fn send_audio_level(&self, level: f32);
    fn send_spectrum_bins(&self, bins: [f32; SPECTRUM_BARS]);
    fn update_position(&self, x: i32, y: i32, width: u32, height: u32);
    fn set_theme(&self, theme_name: &str);
    /// Resize the OS window to `(width, height)` if `Some`, or reset to the
    /// default pill size (PILL_WIDTH × PILL_HEIGHT) if `None`.
    /// No-op on backends that don't support dynamic resizing (Noop).
    fn resize_for_theme(&self, _size: Option<(u32, u32)>) {}
    fn shutdown(&mut self);
    fn is_running(&self) -> bool;

    #[cfg(debug_assertions)]
    fn run_demo(&self) {}
}

/// No-op overlay implementation.
#[derive(Debug, Default)]
pub struct NoopOverlay;

impl NoopOverlay {
    pub fn new() -> Self {
        Self
    }
}

impl OverlayBackend for NoopOverlay {
    fn show(&self, _state: OverlayState) {}
    fn hide(&self) {}
    fn send_audio_level(&self, _level: f32) {}
    fn send_spectrum_bins(&self, _bins: [f32; crate::audio::SPECTRUM_BARS]) {}
    fn update_position(&self, _x: i32, _y: i32, _width: u32, _height: u32) {}
    fn set_theme(&self, _theme_name: &str) {}
    fn resize_for_theme(&self, _size: Option<(u32, u32)>) {}
    fn shutdown(&mut self) {}
    fn is_running(&self) -> bool {
        false
    }
}
