//! Config change handlers for save_config (SRP).
//!
//! Each handler is responsible for a single type of config change detection and response.
//! This follows the Single Responsibility Principle by separating config change handling
//! from the save_config command.

use crate::config::AppConfig;
use crate::{HotkeyState, OrchestratorState};
use tauri::AppHandle;

/// Trait for handling config changes.
/// SRP: Each handler focuses on one specific type of change.
#[async_trait::async_trait]
pub trait ConfigChangeHandler: Send + Sync {
    /// Check if this handler should process the config change.
    fn should_handle(&self, old: &AppConfig, new: &AppConfig) -> bool;

    /// Handle the config change.
    async fn handle(
        &self,
        app: &AppHandle,
        hotkey_state: &HotkeyState,
        orchestrator_state: &OrchestratorState,
        new: &AppConfig,
    ) -> Result<(), String>;
}

/// Handler for hotkey configuration changes.
/// Restarts the hotkey listener when hotkey changes.
pub struct HotkeyChangeHandler;

#[async_trait::async_trait]
impl ConfigChangeHandler for HotkeyChangeHandler {
    fn should_handle(&self, old: &AppConfig, new: &AppConfig) -> bool {
        old.hotkey != new.hotkey
    }

    async fn handle(
        &self,
        app: &AppHandle,
        hotkey_state: &HotkeyState,
        _orchestrator_state: &OrchestratorState,
        new: &AppConfig,
    ) -> Result<(), String> {
        tracing::info!("Hotkey changed, restarting listener");
        let mut listener = hotkey_state.hotkey_listener.lock().await;
        listener.restart(app.clone(), &new.hotkey);
        Ok(())
    }
}

/// Handler for overlay configuration changes.
/// Reinitializes the overlay when overlay settings change.
pub struct OverlayChangeHandler;

#[async_trait::async_trait]
impl ConfigChangeHandler for OverlayChangeHandler {
    fn should_handle(&self, old: &AppConfig, new: &AppConfig) -> bool {
        old.overlay != new.overlay
    }

    async fn handle(
        &self,
        _app: &AppHandle,
        _hotkey_state: &HotkeyState,
        orchestrator_state: &OrchestratorState,
        new: &AppConfig,
    ) -> Result<(), String> {
        tracing::info!("Overlay settings changed, reinitializing");
        orchestrator_state.orchestrator.reinit_overlay(new).await;
        Ok(())
    }
}

/// Apply all registered config change handlers.
/// KISS: Simple iteration over handlers with early continue for non-matching.
pub async fn apply_config_changes(
    handlers: &[&dyn ConfigChangeHandler],
    app: &AppHandle,
    hotkey_state: &HotkeyState,
    orchestrator_state: &OrchestratorState,
    old: &AppConfig,
    new: &AppConfig,
) -> Result<(), String> {
    for handler in handlers {
        if handler.should_handle(old, new) {
            handler
                .handle(app, hotkey_state, orchestrator_state, new)
                .await?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_config() -> AppConfig {
        AppConfig::default()
    }

    #[test]
    fn test_hotkey_handler_should_handle_different() {
        let handler = HotkeyChangeHandler;
        let old = create_test_config();
        let mut new = create_test_config();
        new.hotkey = "alt_r".to_string();

        assert!(handler.should_handle(&old, &new));
    }

    #[test]
    fn test_hotkey_handler_should_not_handle_same() {
        let handler = HotkeyChangeHandler;
        let old = create_test_config();
        let new = create_test_config();

        assert!(!handler.should_handle(&old, &new));
    }

    #[test]
    fn test_overlay_handler_should_handle_different_position() {
        let handler = OverlayChangeHandler;
        let old = create_test_config();
        let mut new = create_test_config();
        new.overlay.position = "top_right".to_string();

        assert!(handler.should_handle(&old, &new));
    }

    #[test]
    fn test_overlay_handler_should_handle_different_margin() {
        let handler = OverlayChangeHandler;
        let old = create_test_config();
        let mut new = create_test_config();
        new.overlay.margin = 50;

        assert!(handler.should_handle(&old, &new));
    }

    #[test]
    fn test_overlay_handler_should_handle_different_enabled() {
        let handler = OverlayChangeHandler;
        let old = create_test_config();
        let mut new = create_test_config();
        new.overlay.enabled = false;

        assert!(handler.should_handle(&old, &new));
    }

    #[test]
    fn test_overlay_handler_should_not_handle_same() {
        let handler = OverlayChangeHandler;
        let old = create_test_config();
        let new = create_test_config();

        assert!(!handler.should_handle(&old, &new));
    }

    #[test]
    fn test_overlay_handler_should_handle_different_size() {
        let handler = OverlayChangeHandler;
        let old = create_test_config();
        let mut new = create_test_config();
        new.overlay.size = "large".to_string();

        assert!(handler.should_handle(&old, &new));
    }

    #[test]
    fn test_overlay_handler_should_handle_different_audio_boost() {
        let handler = OverlayChangeHandler;
        let old = create_test_config();
        let mut new = create_test_config();
        new.overlay.audio_boost = 1000.0;

        assert!(handler.should_handle(&old, &new));
    }

    #[test]
    fn test_overlay_handler_should_handle_different_theme() {
        let handler = OverlayChangeHandler;
        let old = create_test_config();
        let mut new = create_test_config();
        new.overlay.theme = "neon".to_string();

        assert!(handler.should_handle(&old, &new));
    }
}
