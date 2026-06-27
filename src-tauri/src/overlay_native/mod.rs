mod backend;
pub mod theme;
pub mod webview;

pub use backend::{NoopOverlay, OverlayBackend};
pub use webview::OVERLAY_PANEL_LABEL;
pub use theme::{ThemeInfo, ThemeTestResult};

pub type OverlayState = crate::overlay::types::OverlayState;
pub type OverlayPositionConfig = crate::overlay::types::PositionConfig;
pub type OverlaySizeConfig = crate::overlay::types::SizeConfig;

pub const BAR_COUNT: usize = 32;

/// Parameter Object for `create_overlay` (SOLID: groups related params; clippy:
/// avoids `too_many_arguments`).
pub struct CreateOverlayParams<'a> {
    pub enabled: bool,
    pub position: OverlayPositionConfig,
    pub size: OverlaySizeConfig,
    pub margin: i32,
    pub theme: &'a str,
    pub audio_boost: f32,
    pub backend: &'a str,
    pub app_handle: Option<tauri::AppHandle>,
}

/// Create an overlay backend based on configuration.
///
/// `params.backend` selects implementation:
/// - `"auto"` (default) — Tauri WebviewWindow on all platforms
/// - `"webview"` — plain Tauri WebviewWindow (cross-platform)
/// - `"none"` — NoopOverlay
///
/// On macOS the webview keeps the overlay behaviours that matter (no focus
/// steal, all-Spaces, over-fullscreen) via `.focusable(false)` + a thin
/// AppKit `NSWindow` tuning helper instead of a separate NSPanel backend.
///
/// Phase 7 cleanup: the legacy `native` (in-process egui+glfw) and
/// `subprocess` (separate egui binary) backends were removed. They
/// were superseded by React ThemeHost code themes running inside the
/// webview backend, which now covers all platforms.
pub fn create_overlay(params: CreateOverlayParams<'_>) -> Box<dyn OverlayBackend> {
    if !params.enabled || params.backend == "none" {
        return Box::new(NoopOverlay::new());
    }

    let try_webview = || -> Option<Box<dyn OverlayBackend>> {
        let app = params.app_handle.as_ref()?;
        match webview::WebviewOverlay::new(
            app.clone(),
            params.position,
            params.margin,
        ) {
            Ok(o) => Some(Box::new(o)),
            Err(e) => {
                tracing::warn!("Webview overlay failed: {}", e);
                None
            }
        }
    };

    // Explicit backend selection.
    match params.backend {
        "webview" => {
            if let Some(o) = try_webview() {
                return o;
            }
        }
        "auto" => {} // fall through to auto chain
        other => {
            // Covers Phase 7-removed values 'native' and 'subprocess'
            // for users upgrading from older configs, plus anything
            // typo'd into the kv table. All paths drop to the auto
            // chain below.
            tracing::warn!(
                "Unknown overlay backend '{}'; falling back to auto",
                other
            );
        }
    }

    // ----------------------------------------------------------------
    // Auto chain (all platforms):
    //   1. Tauri Webview overlay (the single rendering path)
    //   2. NoopOverlay if no AppHandle available
    // ----------------------------------------------------------------
    if let Some(o) = try_webview() {
        return o;
    }

    Box::new(NoopOverlay::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params<'a>(backend: &'a str, enabled: bool) -> CreateOverlayParams<'a> {
        CreateOverlayParams {
            enabled,
            position: OverlayPositionConfig::default(),
            size: OverlaySizeConfig::default(),
            margin: 30,
            theme: "default",
            audio_boost: 800.0,
            backend,
            app_handle: None,
        }
    }

    #[test]
    fn test_create_overlay_disabled_returns_noop() {
        let overlay = create_overlay(params("auto", false));
        assert!(!overlay.is_running());
    }

    #[test]
    fn test_create_overlay_backend_none_returns_noop() {
        let overlay = create_overlay(params("none", true));
        assert!(!overlay.is_running());
    }

    #[test]
    fn test_create_overlay_nspanel_without_handle_falls_back() {
        // No AppHandle → NSPanel can't construct → fallback to auto chain.
        let _overlay = create_overlay(params("nspanel", true));
    }

    #[test]
    fn test_create_overlay_unknown_backend_falls_through_to_auto() {
        let _overlay = create_overlay(params("exotic-unknown", true));
    }

    #[test]
    fn test_create_overlay_legacy_backend_strings_fall_through_to_auto() {
        // Phase 7-removed backends ('native', 'subprocess') and any
        // typo all route through the same `other =>` arm. The test
        // also covers a clearly-invalid string to lock the back-compat
        // contract: unknown -> auto -> Noop (when no AppHandle).
        for backend in ["native", "subprocess", "", "xx-random"] {
            let overlay = create_overlay(params(backend, true));
            assert!(
                !overlay.is_running(),
                "backend '{backend}' should fall through to Noop without AppHandle"
            );
        }
    }
}
