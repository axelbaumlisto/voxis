use super::load_config_from_app;
use crate::config::AppConfig;
use crate::overlay_native::{
    create_overlay, OverlayBackend, OverlayPositionConfig, OverlaySizeConfig, OverlayState,
    ThemeLoaderHandle,
};
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::Mutex;

pub struct OverlayManager {
    app: AppHandle,
    overlay: Arc<Mutex<Box<dyn OverlayBackend>>>,
    theme_loader: ThemeLoaderHandle,
}

impl OverlayManager {
    pub fn new(
        app: AppHandle,
        overlay: Arc<Mutex<Box<dyn OverlayBackend>>>,
        theme_loader: ThemeLoaderHandle,
    ) -> Self {
        Self {
            app,
            overlay,
            theme_loader,
        }
    }

    pub async fn init(&self, config: &AppConfig) {
        let position = OverlayPositionConfig::parse(&config.overlay.position);
        let size = OverlaySizeConfig::parse(&config.overlay.size);
        let new_overlay = create_overlay(
            config.overlay.enabled,
            position,
            size,
            config.overlay.margin,
            &config.overlay.theme,
            config.overlay.audio_boost,
            Arc::clone(&self.theme_loader),
            &config.overlay.backend,
            Some(self.app.clone()),
        );
        *self.overlay.lock().await = new_overlay;

        if config.overlay.enabled {
            self.overlay.lock().await.set_theme(&config.overlay.theme);
        }
    }

    pub async fn reinit(&self, config: &AppConfig) {
        tracing::info!(
            "reinit_overlay: margin={}, position={}, size={}",
            config.overlay.margin,
            config.overlay.position,
            config.overlay.size
        );

        self.overlay.lock().await.shutdown();
        self.init(config).await;

        if config.overlay.enabled {
            self.overlay.lock().await.show(OverlayState::Idle);
        }
    }

    pub async fn preview_theme(&self, theme_id: &str) -> Result<(), String> {
        let config = load_config_from_app(&self.app);
        if !config.overlay.enabled {
            return Err("Enable overlay to preview themes".to_string());
        }

        if !self.overlay.lock().await.is_running() {
            self.init(&config).await;
        }

        let overlay = self.overlay.lock().await;
        overlay.set_theme(theme_id);
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
