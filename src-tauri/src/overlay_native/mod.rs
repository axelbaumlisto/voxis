mod backend;
mod native;
pub mod nspanel;
mod subprocess;
pub mod theme;
pub mod webview;

use std::sync::{Arc, RwLock};

pub use backend::{NoopOverlay, OverlayBackend};
pub use native::{amplify_level, NativeOverlay, Position, WaveformLevels};
pub use subprocess::SubprocessOverlay;
pub use theme::{
    OverlayThemeData, ThemeColors, ThemeInfo, ThemeLoader, ThemeTestResult, VisualizationTheme,
};

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

/// Parameter Object for `create_overlay` (SOLID: groups related params; clippy:
/// avoids `too_many_arguments`).
pub struct CreateOverlayParams<'a> {
    pub enabled: bool,
    pub position: OverlayPositionConfig,
    pub size: OverlaySizeConfig,
    pub margin: i32,
    pub theme: &'a str,
    pub audio_boost: f32,
    pub theme_loader: ThemeLoaderHandle,
    pub backend: &'a str,
    pub app_handle: Option<tauri::AppHandle>,
}

/// Create an overlay backend based on configuration.
///
/// `params.backend` selects implementation:
/// - `"auto"` (default) — Linux: NativeOverlay; macOS/Windows: Subprocess fallback
/// - `"native"` — NativeOverlay (egui, all platforms when available)
/// - `"subprocess"` — SubprocessOverlay (separate binary)
/// - `"nspanel"` — NSPanel webview on macOS (opt-in, requires `app_handle`)
/// - `"webview"` — plain Tauri WebviewWindow (cross-platform, default on Linux/Win)
/// - `"none"` — NoopOverlay
 pub fn create_overlay(params: CreateOverlayParams<'_>) -> Box<dyn OverlayBackend> {
    if !params.enabled || params.backend == "none" {
        return Box::new(NoopOverlay::new());
    }

    let make_native = || -> Box<dyn OverlayBackend> {
        Box::new(NativeOverlay::new_with_config(
            params.position,
            params.size,
            params.margin,
            params.theme,
            params.audio_boost,
            Arc::clone(&params.theme_loader),
        ))
    };
    let make_subprocess = || -> Option<Box<dyn OverlayBackend>> {
        SubprocessOverlay::new().map(|s| Box::new(s) as Box<dyn OverlayBackend>)
    };

    // Explicit backend selection.
    match params.backend {
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
            if let Some(app) = params.app_handle.as_ref() {
                match nspanel::NsPanelOverlay::new(
                    app.clone(),
                    params.position,
                    params.margin,
                ) {
                    Ok(o) => return Box::new(o),
                    Err(e) => tracing::warn!("NSPanel overlay failed: {}; falling back", e),
                }
            } else {
                tracing::warn!("NSPanel requires app_handle; falling back to auto");
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = &params.app_handle;
                tracing::warn!("NSPanel is macOS-only; falling back to auto");
            }
        }
        "webview" => {
            if let Some(app) = params.app_handle.as_ref() {
                match webview::WebviewOverlay::new(
                    app.clone(),
                    params.position,
                    params.margin,
                ) {
                    Ok(o) => return Box::new(o),
                    Err(e) => {
                        tracing::warn!("Webview overlay failed: {}; falling back", e)
                    }
                }
            } else {
                tracing::warn!("Webview overlay requires app_handle; falling back");
            }
        }
        "auto" => {} // fall through to auto chain
        other => {
            tracing::warn!("Unknown overlay backend '{}'; falling back to auto", other);
        }
    }

    // ----------------------------------------------------------------
    // Auto chain (Linux / Windows / macOS-as-fallback):
    //   1. Tauri Webview overlay (Handy pill)  — preferred if we have AppHandle
    //   2. Native egui overlay (organic ring)  — if compositor supports passthrough
    //   3. Subprocess overlay                  — last-resort separate binary
    //   4. NoopOverlay                         — absolutely nothing renders
    // On macOS the explicit "nspanel" branch above is the preferred path.
    // ----------------------------------------------------------------
    if let Some(app) = params.app_handle.as_ref() {
        match webview::WebviewOverlay::new(
            app.clone(),
            params.position,
            params.margin,
        ) {
            Ok(o) => return Box::new(o),
            Err(e) => tracing::warn!(
                "auto: webview backend unavailable ({e}); trying native / subprocess"
            ),
        }
    }

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

    fn params<'a>(backend: &'a str, enabled: bool) -> CreateOverlayParams<'a> {
        CreateOverlayParams {
            enabled,
            position: OverlayPositionConfig::default(),
            size: OverlaySizeConfig::default(),
            margin: 30,
            theme: "default",
            audio_boost: 800.0,
            theme_loader: test_loader(),
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
}
