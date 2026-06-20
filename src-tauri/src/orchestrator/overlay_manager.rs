use super::load_config_from_app;
use crate::config::AppConfig;
use crate::overlay_native::{
    create_overlay, CreateOverlayParams, OverlayBackend, OverlayPositionConfig, OverlaySizeConfig,
    OverlayState,
};
use crate::setup::ThemeEngineState;
use std::sync::Arc;
use tauri::AppHandle;
use tauri::Manager;
use tokio::sync::Mutex;

pub struct OverlayManager {
    app: AppHandle,
    overlay: Arc<Mutex<Box<dyn OverlayBackend>>>,
    /// Serializes overlay (re)initialization so the startup and
    /// window-focus paths can't race and both call `create_overlay`,
    /// which would fail with `webview 'overlay' already exists`.
    init_lock: Arc<Mutex<()>>,
}

/// Validate theme overlay dimensions against sane inclusive range.
/// Returns `Some((w, h))` when both are Some and inside 16..=4096.
fn validate_overlay_dimensions(w: Option<u32>, h: Option<u32>) -> Option<(u32, u32)> {
    match (w, h) {
        (Some(w), Some(h)) if (16..=4096).contains(&w) && (16..=4096).contains(&h) => Some((w, h)),
        _ => None,
    }
}

impl OverlayManager {
    pub fn new(app: AppHandle, overlay: Arc<Mutex<Box<dyn OverlayBackend>>>) -> Self {
        Self {
            app,
            overlay,
            init_lock: Arc::new(Mutex::new(())),
        }
    }

    /// Idempotent init: creates the overlay only if it isn't already
    /// running. The whole check-and-create is serialized by `init_lock`
    /// so concurrent callers (startup + window focus) can't both build
    /// the webview.
    pub async fn ensure_init(&self, config: &AppConfig) {
        let _guard = self.init_lock.lock().await;
        if self.overlay.lock().await.is_running() {
            return;
        }
        self.init(config).await;
    }

    /// Resolve the overlay size declared by a theme's manifest.
    /// Returns `Some((w, h))` only when BOTH `overlay_width` and
    /// `overlay_height` are present AND within sane inclusive range
    /// 16..=4096; returns `None` otherwise so the caller can fall
    /// back to `PILL_WIDTH × PILL_HEIGHT` defaults.
    fn theme_overlay_size(&self, theme_id: &str) -> Option<(u32, u32)> {
        let loader = self.app.state::<ThemeEngineState>().loader.clone();
        let manifest = loader.manifest(theme_id)?;
        validate_overlay_dimensions(manifest.overlay_width, manifest.overlay_height)
    }

    async fn init(&self, config: &AppConfig) {
        let position = OverlayPositionConfig::parse(&config.overlay.position);
        let size = OverlaySizeConfig::parse(&config.overlay.size);
        let new_overlay = create_overlay(CreateOverlayParams {
            enabled: config.overlay.enabled,
            position,
            size,
            margin: config.overlay.margin,
            theme: &config.overlay.theme,
            audio_boost: config.overlay.audio_boost,
            backend: &config.overlay.backend,
            app_handle: Some(self.app.clone()),
        });
        *self.overlay.lock().await = new_overlay;

        if config.overlay.enabled {
            {
                self.overlay.lock().await.set_theme(&config.overlay.theme);
            }
            let size = self.theme_overlay_size(&config.overlay.theme);
            self.overlay.lock().await.resize_for_theme(size);
        }
    }

    pub async fn reinit(&self, config: &AppConfig) {
        tracing::info!(
            "reinit_overlay: margin={}, position={}, size={}",
            config.overlay.margin,
            config.overlay.position,
            config.overlay.size
        );

        let _guard = self.init_lock.lock().await;
        self.overlay.lock().await.shutdown();
        self.init(config).await;

        if config.overlay.enabled {
            self.overlay.lock().await.show(OverlayState::Idle);
        } else {
            // enabled -> disabled: backends no longer close/hide the shared
            // window on shutdown (to avoid reinit races), so the manager
            // explicitly hides the singleton overlay window here.
            self.hide_overlay_window();
        }
    }

    /// Hide the singleton overlay OS window (label `overlay`) on the main
    /// thread. Used when the overlay is turned off; backends intentionally
    /// leave the window registered on `shutdown` so it can be reused across
    /// reinit without a close/show race.
    fn hide_overlay_window(&self) {
        let app = self.app.clone();
        let _ = app.clone().run_on_main_thread(move || {
            if let Some(w) = app.get_webview_window(crate::overlay_native::OVERLAY_PANEL_LABEL) {
                let _ = w.hide();
            }
        });
    }

    pub async fn preview_theme(&self, theme_id: &str) -> Result<(), String> {
        let config = load_config_from_app(&self.app);
        if !config.overlay.enabled {
            return Err("Enable overlay to preview themes".to_string());
        }

        self.ensure_init(&config).await;

        let overlay = self.overlay.lock().await;
        overlay.set_theme(theme_id);
        let size = self.theme_overlay_size(theme_id);
        overlay.resize_for_theme(size);
        overlay.show(OverlayState::Idle);
        Ok(())
    }

    pub async fn is_running(&self) -> bool {
        self.overlay.lock().await.is_running()
    }

    #[cfg(debug_assertions)]
    pub async fn run_demo(&self) {
        self.overlay.lock().await.run_demo();
    }
}

#[cfg(test)]
mod tests {
    use super::validate_overlay_dimensions;

    #[test]
    fn valid_range_accepted() {
        assert_eq!(
            validate_overlay_dimensions(Some(16), Some(16)),
            Some((16, 16))
        );
        assert_eq!(
            validate_overlay_dimensions(Some(172), Some(36)),
            Some((172, 36))
        );
        assert_eq!(
            validate_overlay_dimensions(Some(4096), Some(4096)),
            Some((4096, 4096))
        );
    }

    #[test]
    fn missing_dimension_returns_none() {
        assert_eq!(validate_overlay_dimensions(None, Some(100)), None);
        assert_eq!(validate_overlay_dimensions(Some(100), None), None);
        assert_eq!(validate_overlay_dimensions(None, None), None);
    }

    #[test]
    fn out_of_range_rejected() {
        // Zero
        assert_eq!(validate_overlay_dimensions(Some(0), Some(100)), None);
        assert_eq!(validate_overlay_dimensions(Some(100), Some(0)), None);
        // Below minimum
        assert_eq!(validate_overlay_dimensions(Some(15), Some(100)), None);
        assert_eq!(validate_overlay_dimensions(Some(1), Some(1)), None);
        // Above maximum
        assert_eq!(validate_overlay_dimensions(Some(4097), Some(100)), None);
        assert_eq!(validate_overlay_dimensions(Some(100), Some(4097)), None);
        // Absurdly large
        assert_eq!(validate_overlay_dimensions(Some(u32::MAX), Some(100)), None);
        assert_eq!(validate_overlay_dimensions(Some(100), Some(u32::MAX)), None);
    }
}
