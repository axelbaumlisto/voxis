//! Config-related Tauri commands.

use crate::config::AppConfig;
use crate::error::BoxedIntoCommandError;
use crate::storage::AppPaths;
use crate::{HotkeyState, OrchestratorState};
use tauri::{AppHandle, Emitter, State};

use super::get_factory;

/// Get the current app configuration.
#[tauri::command]
#[specta::specta]
pub fn get_config(paths: State<AppPaths>) -> Result<AppConfig, String> {
    get_factory(&paths).config().load().cmd_err()
}

/// Save the app configuration.
/// SRP: Uses ConfigChangeHandler trait for change detection and response.
#[tauri::command]
#[specta::specta]
pub async fn save_config(
    config: AppConfig,
    paths: State<'_, AppPaths>,
    hotkey_state: State<'_, HotkeyState>,
    orchestrator_state: State<'_, OrchestratorState>,
    app: AppHandle,
) -> Result<(), String> {
    use crate::config::{apply_config_changes, HotkeyChangeHandler, OverlayChangeHandler};

    tracing::info!("save_config called, hotkey: {}", config.hotkey);

    let factory = get_factory(&paths);
    let old_config = factory.config().load().unwrap_or_default();

    // Validate before saving
    let errors = crate::config::validate_config(&config);
    if !errors.is_empty() {
        let error_messages: Vec<String> = errors.iter().map(|e| e.to_string()).collect();
        return Err(error_messages.join("; "));
    }

    factory.config().save(&config).cmd_err()?;

    // Apply config change handlers (SRP: each handler handles one type of change)
    let handlers: &[&dyn crate::config::ConfigChangeHandler] =
        &[&HotkeyChangeHandler, &OverlayChangeHandler];
    apply_config_changes(
        handlers,
        &app,
        hotkey_state.inner(),
        orchestrator_state.inner(),
        &old_config,
        &config,
    )
    .await?;

    // Emit config-changed event for UI updates
    if let Err(e) = app.emit("config-changed", ()) {
        tracing::warn!("Failed to emit config-changed: {}", e);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    #[allow(unused_imports)]
    use super::*;
    use crate::config::AppConfig;
    use crate::storage::test_utils::create_temp_paths;

    #[test]
    fn test_get_config_returns_default_when_no_storage() {
        let (_temp_dir, paths) = create_temp_paths();
        // Access the storage directly since get_config requires State
        let factory = crate::storage::StorageFactory::new(paths);
        let config = factory.config().load().unwrap();
        assert_eq!(config, AppConfig::default());
    }

    #[test]
    fn test_config_save_and_load_roundtrip() {
        let (_temp_dir, paths) = create_temp_paths();
        let factory = crate::storage::StorageFactory::new(paths);

        let config = AppConfig {
            api_key: "test-api-key".to_string(),
            hotkey: "f12".to_string(),
            ..AppConfig::default()
        };

        factory.config().save(&config).unwrap();
        let loaded = factory.config().load().unwrap();

        assert_eq!(loaded.api_key, "test-api-key");
        assert_eq!(loaded.hotkey, "f12");
    }

    #[test]
    fn test_config_validates_hotkey() {
        let config = AppConfig {
            hotkey: "invalid_key_combo".to_string(),
            ..Default::default()
        };

        let errors = crate::config::validate_config(&config);
        assert!(
            !errors.is_empty(),
            "Invalid hotkey should produce validation errors"
        );
    }

    #[test]
    fn test_config_default_values() {
        let config = AppConfig::default();
        assert_eq!(config.hotkey, "ctrl_r");
        assert!(config.notifications);
        assert!(config.auto_type);
    }

    #[test]
    fn test_config_validates_valid_hotkey() {
        let config = AppConfig {
            hotkey: "ctrl_r".to_string(),
            ..Default::default()
        };

        let errors = crate::config::validate_config(&config);
        assert!(errors.is_empty(), "Valid hotkey should pass validation");
    }
}
