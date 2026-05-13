mod backend;
pub mod nspanel;
pub mod theme;
pub mod webview;

use std::sync::{Arc, RwLock};

pub use backend::{NoopOverlay, OverlayBackend};
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
/// - `"auto"` (default) — NSPanel on macOS (if AppHandle), Webview elsewhere
/// - `"nspanel"` — macOS-only NSPanel webview (requires `app_handle`)
/// - `"webview"` — plain Tauri WebviewWindow (cross-platform)
/// - `"none"` — NoopOverlay
///
/// Phase 7 cleanup: the legacy `native` (in-process egui+glfw) and
/// `subprocess` (separate egui binary) backends were removed. They
/// were superseded by the React HandyPill / ClassicBars / OrganicRing
/// running inside the webview backend, which now covers all platforms.
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
            if let Some(o) = try_webview() {
                return o;
            }
        }
        "auto" => {} // fall through to auto chain
        // Phase 7 removed backends — fall through to auto chain.
        "native" | "subprocess" => {
            tracing::warn!(
                "backend '{}' removed in Phase 7 cleanup; using auto (webview)",
                params.backend
            );
        }
        other => {
            tracing::warn!("Unknown overlay backend '{}'; falling back to auto", other);
        }
    }

    // ----------------------------------------------------------------
    // Auto chain:
    //   1. NSPanel webview on macOS (preferred for borderless pill)
    //   2. Tauri Webview overlay everywhere else
    //   3. NoopOverlay if no AppHandle available
    // ----------------------------------------------------------------
    #[cfg(target_os = "macos")]
    if let Some(app) = params.app_handle.as_ref() {
        match nspanel::NsPanelOverlay::new(
            app.clone(),
            params.position,
            params.margin,
        ) {
            Ok(o) => return Box::new(o),
            Err(e) => tracing::warn!("auto: NSPanel failed ({e}); trying webview"),
        }
    }

    if let Some(o) = try_webview() {
        return o;
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

    #[test]
    fn test_create_overlay_removed_backends_fall_through_to_auto() {
        // Phase 7: 'native' and 'subprocess' were removed; both must
        // resolve cleanly to the auto chain (Noop in this test env
        // since AppHandle is absent).
        for backend in ["native", "subprocess"] {
            let overlay = create_overlay(params(backend, true));
            assert!(
                !overlay.is_running(),
                "backend '{backend}' should fall through to Noop without AppHandle"
            );
        }
    }
}
