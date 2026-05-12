mod backend;
mod native;
pub mod nspanel;
mod subprocess;
pub mod theme;

use std::sync::{Arc, RwLock};

pub use backend::{NoopOverlay, OverlayBackend};
pub use native::{amplify_level, NativeOverlay, Position, WaveformLevels};
pub use subprocess::SubprocessOverlay;
pub use theme::{ThemeColors, ThemeInfo, ThemeLoader, ThemeTestResult, VisualizationTheme};

pub type OverlayState = crate::overlay::types::OverlayState;
pub type OverlayPositionConfig = crate::overlay::types::PositionConfig;
pub type OverlaySizeConfig = crate::overlay::types::SizeConfig;

pub type ThemeLoaderHandle = Arc<RwLock<ThemeLoader>>;

pub struct ThemeLoaderState {
    pub handle: ThemeLoaderHandle,
}

impl ThemeLoaderState {
    pub fn new(themes_dir: std::path::PathBuf) -> Self {
        let mut loader = ThemeLoader::new(themes_dir);
        if let Err(e) = loader.scan() {
            tracing::warn!("Failed to scan themes directory: {}", e);
        }
        Self {
            handle: Arc::new(RwLock::new(loader)),
        }
    }
}

pub const BAR_COUNT: usize = 32;

/// Create an overlay backend based on configuration.
///
/// `backend` selects implementation:
/// - `"auto"` (default) — Linux: NativeOverlay; macOS/Windows: Subprocess fallback
/// - `"native"` — NativeOverlay (egui, all platforms when available)
/// - `"subprocess"` — SubprocessOverlay (separate binary)
/// - `"nspanel"` — NSPanel webview on macOS (opt-in, requires `app_handle`)
/// - `"none"` — NoopOverlay
///
/// `app_handle` is required only for `"nspanel"` backend; otherwise pass `None`.
pub fn create_overlay(
    enabled: bool,
    position: OverlayPositionConfig,
    size: OverlaySizeConfig,
    margin: i32,
    theme: &str,
    audio_boost: f32,
    theme_loader: ThemeLoaderHandle,
    backend: &str,
    app_handle: Option<tauri::AppHandle>,
) -> Box<dyn OverlayBackend> {
    if !enabled || backend == "none" {
        return Box::new(NoopOverlay::new());
    }

    let make_native = || -> Box<dyn OverlayBackend> {
        Box::new(NativeOverlay::new_with_config(
            position.clone(),
            size.clone(),
            margin,
            theme,
            audio_boost,
            Arc::clone(&theme_loader),
        ))
    };
    let make_subprocess = || -> Option<Box<dyn OverlayBackend>> {
        SubprocessOverlay::new().map(|s| Box::new(s) as Box<dyn OverlayBackend>)
    };

    // Explicit backend selection.
    match backend {
        "native" => {
            if NativeOverlay::is_available() {
                return make_native();
            }
            tracing::warn!("native overlay unavailable; falling back to auto");
        }
        "subprocess" => {
            if let Some(s) = make_subprocess() {
                return s;
            }
            tracing::warn!("subprocess overlay unavailable; falling back to auto");
        }
        "nspanel" => {
            #[cfg(target_os = "macos")]
            if let Some(app) = app_handle.as_ref() {
                match nspanel::NsPanelOverlay::new(app.clone()) {
                    Ok(o) => return Box::new(o),
                    Err(e) => tracing::warn!("NSPanel overlay failed: {}; falling back", e),
                }
            } else {
                tracing::warn!("NSPanel requires app_handle; falling back to auto");
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = &app_handle;
                tracing::warn!("NSPanel is macOS-only; falling back to auto");
            }
        }
        "auto" | _ => {} // fall through to auto chain
    }

    // Auto chain: Linux prefers Native, others prefer Subprocess.
    #[cfg(target_os = "linux")]
    if NativeOverlay::is_available() {
        return make_native();
    }

    if let Some(s) = make_subprocess() {
        return s;
    }

    if NativeOverlay::is_available() {
        return make_native();
    }

    Box::new(NoopOverlay::new())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn test_loader() -> ThemeLoaderHandle {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("themes");
        let mut loader = ThemeLoader::new(dir);
        let _ = loader.scan();
        Arc::new(RwLock::new(loader))
    }

    #[test]
    fn test_create_overlay_disabled_returns_noop() {
        let overlay = create_overlay(
            false,
            OverlayPositionConfig::default(),
            OverlaySizeConfig::default(),
            30,
            "default",
            800.0,
            test_loader(),
            "auto",
            None,
        );
        assert!(!overlay.is_running());
    }

    #[test]
    fn test_create_overlay_backend_none_returns_noop() {
        let overlay = create_overlay(
            true,
            OverlayPositionConfig::default(),
            OverlaySizeConfig::default(),
            30,
            "default",
            800.0,
            test_loader(),
            "none",
            None,
        );
        assert!(!overlay.is_running());
    }

    #[test]
    fn test_create_overlay_nspanel_without_handle_falls_back() {
        // No AppHandle provided → NSPanel can't construct → fallback to auto chain.
        // Test must not panic. is_running() may be true or false depending on
        // whether subprocess/native overlays are available in the test env.
        let _overlay = create_overlay(
            true,
            OverlayPositionConfig::default(),
            OverlaySizeConfig::default(),
            30,
            "default",
            800.0,
            test_loader(),
            "nspanel",
            None,
        );
    }

    #[test]
    fn test_create_overlay_unknown_backend_falls_through_to_auto() {
        // Unknown backend should not panic, should fall through to auto chain.
        let _overlay = create_overlay(
            true,
            OverlayPositionConfig::default(),
            OverlaySizeConfig::default(),
            30,
            "default",
            800.0,
            test_loader(),
            "exotic-unknown",
            None,
        );
    }
}
