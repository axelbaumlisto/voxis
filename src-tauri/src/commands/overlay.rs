//! Overlay-related Tauri commands.

use crate::overlay::{self, OverlayPosition, OverlayState};
use crate::overlay_native::{
    ThemeColors, ThemeInfo, ThemeLoaderState, ThemeTestResult, VisualizationTheme,
};
use crate::storage::AppPaths;
use crate::OrchestratorState;
use tauri::AppHandle;
use tauri::State;

/// Show the overlay window with the given state.
#[tauri::command]
#[specta::specta]
pub fn show_overlay(state: OverlayState, app: AppHandle) -> Result<(), String> {
    overlay::show_overlay(&app, state)
}

/// Hide the overlay window.
#[tauri::command]
#[specta::specta]
pub fn hide_overlay(app: AppHandle) -> Result<(), String> {
    overlay::hide_overlay(&app)
}

/// Update the overlay position.
#[tauri::command]
#[specta::specta]
pub fn update_overlay_position(
    position: OverlayPosition,
    margin: i32,
    app: AppHandle,
) -> Result<(), String> {
    overlay::update_overlay_position(&app, position, margin)
}

/// Get the current overlay state (pull-based initialization).
/// Frontend calls this after setting up listeners to get missed state.
#[tauri::command]
#[specta::specta]
pub fn get_overlay_state() -> OverlayState {
    let state = overlay::get_current_state();
    tracing::info!("get_overlay_state called, returning: {:?}", state);
    state
}

/// Get all available visualization themes.
#[tauri::command]
#[specta::specta]
pub fn get_visualization_themes(theme_loader: State<'_, ThemeLoaderState>) -> Vec<ThemeInfo> {
    VisualizationTheme::available_themes(&theme_loader.handle)
}

/// Validate a visualization theme.
#[tauri::command]
#[specta::specta]
pub fn validate_visualization_theme(
    theme_id: String,
    theme_loader: State<'_, ThemeLoaderState>,
) -> ThemeTestResult {
    let theme = VisualizationTheme::by_name(&theme_id, &theme_loader.handle);
    theme.validate()
}

/// Get path to themes directory.
#[tauri::command]
#[specta::specta]
pub fn get_themes_dir(app: AppHandle) -> Result<String, String> {
    let paths = AppPaths::new(&app).map_err(|e| e.to_string())?;
    let dir = paths.ensure_themes_dir().map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

/// Export a builtin theme to a theme folder for user customization.
#[tauri::command]
#[specta::specta]
pub fn export_builtin_theme(theme_id: String, app: AppHandle) -> Result<String, String> {
    let paths = AppPaths::new(&app).map_err(|e| e.to_string())?;
    let themes_dir = paths.ensure_themes_dir().map_err(|e| e.to_string())?;
    export_builtin_theme_to_dir(&theme_id, &themes_dir)
}

fn export_builtin_theme_to_dir(
    theme_id: &str,
    themes_dir: &std::path::Path,
) -> Result<String, String> {
    let theme = VisualizationTheme::builtin_by_id(theme_id)
        .ok_or_else(|| format!("theme '{theme_id}' is not a builtin theme"))?;
    let file_format = theme.to_file_format();

    let base_name = format!("{}_custom", theme_id);
    let mut folder_name = base_name.clone();
    let mut counter = 1;

    while themes_dir.join(&folder_name).exists() {
        folder_name = format!("{}_{}", base_name, counter);
        counter += 1;
    }

    let theme_dir = themes_dir.join(&folder_name);
    std::fs::create_dir_all(&theme_dir).map_err(|e| e.to_string())?;

    let file_path = theme_dir.join("theme.json");
    let json = serde_json::to_string_pretty(&file_format).map_err(|e| e.to_string())?;
    std::fs::write(&file_path, json).map_err(|e| e.to_string())?;

    tracing::info!("Exported theme {} to {:?}", theme_id, theme_dir);

    Ok(theme_dir.to_string_lossy().to_string())
}

/// Reload visualization themes from disk.
#[tauri::command]
#[specta::specta]
pub fn reload_visualization_themes(
    theme_loader: State<'_, ThemeLoaderState>,
) -> Result<(), String> {
    VisualizationTheme::reload_themes(&theme_loader.handle)
}

/// Preview a visualization theme without saving config.
#[tauri::command]
#[specta::specta]
pub async fn preview_visualization_theme(
    theme_id: String,
    reload_from_disk: Option<bool>,
    state: State<'_, OrchestratorState>,
    theme_loader: State<'_, ThemeLoaderState>,
) -> Result<(), String> {
    if reload_from_disk.unwrap_or(false) {
        VisualizationTheme::reload_themes(&theme_loader.handle)?;
    }

    state.orchestrator.preview_overlay_theme(&theme_id).await
}

/// Get theme colors for frontend CSS synchronization.
#[tauri::command]
#[specta::specta]
pub fn get_theme_colors(
    theme_id: String,
    theme_loader: State<'_, ThemeLoaderState>,
) -> ThemeColors {
    VisualizationTheme::by_name(&theme_id, &theme_loader.handle).to_colors()
}

/// Run overlay demo mode (debug only).
/// Shows recording state with simulated audio levels.
#[cfg(debug_assertions)]
#[tauri::command]
#[specta::specta]
pub async fn overlay_demo(state: State<'_, OrchestratorState>) -> Result<(), String> {
    state.orchestrator.run_demo().await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_overlay_state_hidden() {
        let state = OverlayState::Hidden;
        assert!(matches!(state, OverlayState::Hidden));
    }

    #[test]
    fn test_overlay_position_serialization() {
        let position = OverlayPosition::BottomRight;
        let json = serde_json::to_string(&position).unwrap();
        assert!(json.contains("bottom_right"));
    }

    #[test]
    fn test_overlay_position_all_variants() {
        let positions = vec![
            OverlayPosition::TopLeft,
            OverlayPosition::TopCenter,
            OverlayPosition::TopRight,
            OverlayPosition::LeftCenter,
            OverlayPosition::Center,
            OverlayPosition::RightCenter,
            OverlayPosition::BottomLeft,
            OverlayPosition::BottomCenter,
            OverlayPosition::BottomRight,
        ];
        assert_eq!(positions.len(), 9);
    }

    #[test]
    fn test_overlay_state_variants() {
        let states = [
            OverlayState::Hidden,
            OverlayState::Idle,
            OverlayState::Recording,
            OverlayState::Transcribing,
            OverlayState::Error("Error message".to_string()),
        ];
        assert_eq!(states.len(), 5);
    }

    #[test]
    fn test_get_visualization_themes() {
        use crate::overlay_native::ThemeLoaderHandle;
        let loader: ThemeLoaderHandle = std::sync::Arc::new(std::sync::RwLock::new(
            crate::overlay_native::ThemeLoader::new(std::path::PathBuf::from(
                "/tmp/nonexistent_themes",
            )),
        ));
        let themes = VisualizationTheme::available_themes(&loader);
        assert!(!themes.is_empty());
        assert!(themes.iter().any(|t| t.id == "winamp_classic"));
    }

    #[test]
    fn test_validate_visualization_theme() {
        use crate::overlay_native::ThemeLoaderHandle;
        let loader: ThemeLoaderHandle = std::sync::Arc::new(std::sync::RwLock::new(
            crate::overlay_native::ThemeLoader::new(std::path::PathBuf::from(
                "/tmp/nonexistent_themes",
            )),
        ));
        let result = VisualizationTheme::by_name("winamp_classic", &loader).validate();
        assert!(result.valid);

        // Unknown themes should fall back to winamp and remain valid.
        let result = VisualizationTheme::by_name("unknown_theme", &loader).validate();
        assert!(result.valid);
    }

    #[test]
    fn test_export_builtin_theme_writes_theme_json_in_folder() {
        let temp = tempfile::tempdir().unwrap();

        let exported_path = export_builtin_theme_to_dir("winamp_classic", temp.path()).unwrap();
        let exported_path = std::path::PathBuf::from(exported_path);

        assert!(exported_path.is_dir());
        assert_eq!(
            exported_path.file_name().and_then(|n| n.to_str()),
            Some("winamp_classic_custom")
        );
        assert!(exported_path.join("theme.json").exists());
    }

    #[test]
    fn test_export_builtin_theme_rejects_non_builtin_theme_ids() {
        let temp = tempfile::tempdir().unwrap();

        let err = export_builtin_theme_to_dir("nonexistent_theme_xyz", temp.path()).unwrap_err();
        assert!(err.contains("is not a builtin theme"));
    }
}
