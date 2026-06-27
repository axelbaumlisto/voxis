//! Overlay-related Tauri commands.

use crate::overlay::{self, OverlayPosition, OverlayState};
use crate::overlay_native::{ThemeInfo, ThemeTestResult};
use crate::setup::ThemeEngineState;
use crate::storage::{AppPaths, StorageFactory};
use crate::theme_engine::{ThemeEngineLoader, ThemeManifest};
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

/// Get the currently configured overlay theme id (pull-after-subscribe).
/// Frontend calls this after subscribing to overlay://theme so it never
/// misses the initial event if it fired before the webview JS was ready.
#[tauri::command]
#[specta::specta]
pub fn get_current_overlay_theme(paths: State<'_, AppPaths>) -> String {
    let factory = StorageFactory::new(paths.inner().clone());
    let config = factory.config().load().unwrap_or_default();
    let theme_id = config.overlay.theme;
    tracing::info!("get_current_overlay_theme called, returning: {theme_id}");
    theme_id
}

/// Get all available visualization themes.
/// NOTE: this command reads from the *user* config themes dir (seeded by
/// Task 4.3 at startup). If seeding hasn't run yet (e.g. first launch before
/// Task 4.3 is merged), the list will be empty. No fallback hack — ordering
/// dependency is intentional.
///
/// Returns an error if theme scanning fails (e.g. themes dir is a file instead
/// of a directory). The frontend must surface this so the user sees a
/// concrete problem instead of a silently-empty dropdown.
#[tauri::command]
#[specta::specta]
pub fn get_visualization_themes(
    state: State<'_, ThemeEngineState>,
) -> Result<Vec<ThemeInfo>, String> {
    theme_infos(&state.loader).map_err(|e| {
        tracing::error!("failed to scan visualization themes: {}", e);
        e
    })
}

/// Pure helper: scan the loader and produce sorted ThemeInfo DTOs.
pub fn theme_infos(loader: &ThemeEngineLoader) -> Result<Vec<ThemeInfo>, String> {
    // Fresh scan to pick up newly-added themes.
    let manifests = loader.scan().map_err(|e| e.to_string())?;
    let mut infos: Vec<ThemeInfo> = manifests
        .into_iter()
        .map(|m| ThemeInfo {
            id: m.id,
            name: m.name,
            description: m.description,
        })
        .collect();
    infos.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(infos)
}

/// Validate a visualization theme.
#[tauri::command]
#[specta::specta]
pub fn validate_visualization_theme(
    theme_id: String,
    state: State<'_, ThemeEngineState>,
) -> ThemeTestResult {
    let v = state.loader.validate(&theme_id);
    ThemeTestResult {
        valid: v.valid,
        warnings: v.warnings,
        errors: v.errors,
    }
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
pub fn export_builtin_theme(
    theme_id: String,
    state: State<'_, ThemeEngineState>,
) -> Result<String, String> {
    export_theme_dir(&state.loader, &theme_id)
}

/// Pure helper: copy a theme directory from themes_dir/<id> to
/// themes_dir/<id>_custom (with counter-suffix loop for collisions).
pub fn export_theme_dir(loader: &ThemeEngineLoader, theme_id: &str) -> Result<String, String> {
    let themes_dir = loader.themes_dir();
    let src_dir = themes_dir.join(theme_id);
    if !src_dir.is_dir() {
        return Err(format!("unknown theme: '{theme_id}' not found in themes dir"));
    }

    let base_name = format!("{}_custom", theme_id);
    let mut folder_name = base_name.clone();
    let mut counter = 1;

    while themes_dir.join(&folder_name).exists() {
        folder_name = format!("{}_{}", base_name, counter);
        counter += 1;
    }

    let dest_dir = themes_dir.join(&folder_name);
    std::fs::create_dir_all(&dest_dir).map_err(|e| format!("create dest dir: {e}"))?;

    // Copy all children (theme.json, theme.js, etc.) — skip symlinks for security.
    for entry in std::fs::read_dir(&src_dir).map_err(|e| format!("read src dir: {e}"))? {
        let entry = entry.map_err(|e| format!("dir entry: {e}"))?;
        let src_path = entry.path();
        let fname = entry.file_name();
        let dest_path = dest_dir.join(&fname);

        // Use symlink_metadata to avoid following symlinks — a symlink in a
        // theme dir could exfiltrate content from outside the themes_dir.
        let meta = std::fs::symlink_metadata(&src_path)
            .map_err(|e| format!("stat {fname:?}: {e}"))?;
        if meta.file_type().is_symlink() {
            tracing::warn!(
                "export_theme_dir: skipping symlink {fname:?} in theme {theme_id}"
            );
            continue;
        }
        if !meta.file_type().is_file() {
            // Skip directories, sockets, devices, etc.
            continue;
        }
        std::fs::copy(&src_path, &dest_path).map_err(|e| format!("copy {fname:?}: {e}"))?;
    }

    // Rewrite the copied theme.json so the copy has a unique id and
    // a distinct name. Without this, the copied dir would either be
    // invisible (id mismatch between folder name and manifest) or
    // shadow the original (duplicate id).
    let copied_manifest_path = dest_dir.join("theme.json");
    if copied_manifest_path.is_file() {
        match std::fs::read_to_string(&copied_manifest_path) {
            Ok(raw) => {
                if let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&raw) {
                    json["id"] = serde_json::Value::String(folder_name.clone());
                    if let Some(name) = json.get_mut("name") {
                        if let Some(s) = name.as_str() {
                            *name = serde_json::Value::String(format!("{} (custom)", s));
                        }
                    }
                    let rewritten = serde_json::to_string_pretty(&json)
                        .unwrap_or(raw);
                    let _ = std::fs::write(&copied_manifest_path, &rewritten);
                }
            }
            Err(e) => tracing::warn!(
                "export_theme_dir: cannot read copied manifest {:?}: {}",
                copied_manifest_path,
                e
            ),
        }
    }

    tracing::info!("Exported theme {} to {}", theme_id, folder_name);
    Ok(dest_dir.to_string_lossy().to_string())
}

/// Reload visualization themes from disk.
#[tauri::command]
#[specta::specta]
pub fn reload_visualization_themes(
    state: State<'_, ThemeEngineState>,
) -> Result<(), String> {
    state.loader.scan().map_err(|e| e.to_string())?;
    Ok(())
}

/// Preview a visualization theme without saving config.
#[tauri::command]
#[specta::specta]
pub async fn preview_visualization_theme(
    theme_id: String,
    reload_from_disk: Option<bool>,
    state: State<'_, OrchestratorState>,
    theme_engine: State<'_, ThemeEngineState>,
) -> Result<(), String> {
    if reload_from_disk.unwrap_or(false) {
        theme_engine.loader.scan().map_err(|e| e.to_string())?;
    }

    state.orchestrator.preview_overlay_theme(&theme_id).await
}

/// Read the entry script source for a theme id.
#[tauri::command]
#[specta::specta]
pub fn read_theme_script(
    theme_id: String,
    state: State<'_, ThemeEngineState>,
) -> Result<String, String> {
    state.loader.read_script(&theme_id).map_err(|e| e.to_string())
}

/// Get the manifest (params included) for a theme id.
#[tauri::command]
#[specta::specta]
pub fn get_theme_manifest(
    theme_id: String,
    state: State<'_, ThemeEngineState>,
) -> Option<ThemeManifest> {
    state.loader.manifest(&theme_id)
}

/// Diagnostic command — lets the overlay webview log a marker to the Rust
/// tracing stream. Used during E2E development to verify that the React
/// app inside the overlay webview actually runs and receives state events.
#[tauri::command]
#[specta::specta]
pub fn debug_log_overlay(message: String) {
    tracing::info!("overlay-diag: {}", message);
}

/// Diagnostic command — injects arbitrary JS into the overlay panel webview
/// via `WebviewWindow::eval`. This bypasses the Tauri event bus and lets us
/// verify whether the panel's JS execution context is alive at all.
///
/// The injected script is expected to call back into the host via
/// `__TAURI_INTERNALS__.invoke('debug_log_overlay', { message })`. If we see
/// the corresponding `overlay-diag` log line, JS is running. If not, the
/// panel webview is silent.
#[tauri::command]
#[specta::specta]
pub fn debug_eval_overlay(app: tauri::AppHandle, script: String) -> Result<(), String> {
    use tauri::Manager;
    let label = crate::overlay_native::OVERLAY_PANEL_LABEL;
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| format!("overlay webview '{label}' not found"))?;
    window
        .eval(&script)
        .map_err(|e| format!("eval failed: {e}"))
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
    fn test_export_builtin_theme_writes_theme_json_in_folder() {
        // Legacy test — uses the pure export_theme_dir helper with a seeded dir.
        let temp = tempfile::tempdir().unwrap();
        // Seed a theme so the export has something to copy.
        let src = temp.path().join("winamp_classic");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(src.join("theme.json"), "{}").unwrap();
        std::fs::write(src.join("theme.js"), "export function mount(){}").unwrap();

        let loader = crate::theme_engine::ThemeEngineLoader::new(temp.path().to_path_buf());
        let exported_path = export_theme_dir(&loader, "winamp_classic").unwrap();
        let exported_path = std::path::PathBuf::from(exported_path);

        assert!(exported_path.is_dir());
        assert_eq!(
            exported_path.file_name().and_then(|n| n.to_str()),
            Some("winamp_classic_custom")
        );
        assert!(exported_path.join("theme.json").exists());
        assert!(exported_path.join("theme.js").exists());
    }

    #[test]
    fn test_export_builtin_theme_rejects_non_builtin_theme_ids() {
        let temp = tempfile::tempdir().unwrap();
        let loader = crate::theme_engine::ThemeEngineLoader::new(temp.path().to_path_buf());

        let err = export_theme_dir(&loader, "nonexistent_theme_xyz").unwrap_err();
        assert!(err.contains("unknown theme"));
    }
}

#[cfg(test)]
mod theme_engine_command_tests {
    use crate::theme_engine::ThemeEngineLoader;
    use std::fs;
    use tempfile::TempDir;

    fn seed(dir: &std::path::Path, id: &str) {
        let d = dir.join(id);
        fs::create_dir_all(&d).unwrap();
        fs::write(
            d.join("theme.json"),
            format!(
                r#"{{"manifest_version":2,"id":"{id}","name":"N","api_version":1,"entry":"theme.js"}}"#
            ),
        )
        .unwrap();
        fs::write(d.join("theme.js"), "export function mount(){}").unwrap();
    }

    #[test]
    fn test_theme_infos_come_from_manifests() {
        let tmp = TempDir::new().unwrap();
        seed(tmp.path(), "abc");
        let loader = ThemeEngineLoader::new(tmp.path().to_path_buf());
        let infos = super::theme_infos(&loader).unwrap();
        assert_eq!(infos.len(), 1);
        assert_eq!(infos[0].id, "abc");
    }

    #[test]
    fn test_export_theme_dir_copies_entry_and_manifest() {
        let tmp = TempDir::new().unwrap();
        seed(tmp.path(), "abc");
        let loader = ThemeEngineLoader::new(tmp.path().to_path_buf());
        loader.scan().unwrap();
        let new_dir = super::export_theme_dir(&loader, "abc").unwrap();
        assert!(std::path::Path::new(&new_dir).join("theme.js").is_file());
        assert!(std::path::Path::new(&new_dir).join("theme.json").is_file());
    }

    #[test]
    fn test_export_theme_dir_unknown_id_errors() {
        let tmp = TempDir::new().unwrap();
        seed(tmp.path(), "abc");
        let loader = ThemeEngineLoader::new(tmp.path().to_path_buf());
        loader.scan().unwrap();
        let err = super::export_theme_dir(&loader, "nope").unwrap_err();
        assert!(err.contains("unknown theme"));
    }

    #[test]
    fn test_read_script_through_loader_helper() {
        let tmp = TempDir::new().unwrap();
        seed(tmp.path(), "abc");
        let loader = ThemeEngineLoader::new(tmp.path().to_path_buf());
        loader.scan().unwrap();
        let src = loader.read_script("abc").unwrap();
        assert!(src.contains("function mount()"));
    }

    #[test]
    fn test_theme_infos_empty_dir() {
        let tmp = TempDir::new().unwrap();
        let loader = ThemeEngineLoader::new(tmp.path().to_path_buf());
        let infos = super::theme_infos(&loader).unwrap();
        assert!(infos.is_empty());
    }

    #[test]
    fn test_validate_via_loader() {
        let tmp = TempDir::new().unwrap();
        seed(tmp.path(), "valid");
        let loader = ThemeEngineLoader::new(tmp.path().to_path_buf());
        loader.scan().unwrap();
        let result = loader.validate("valid");
        assert!(result.valid);

drop(result);
        let result = loader.validate("missing");
        assert!(!result.valid);
    }

    #[test]
    #[cfg(unix)]
    fn test_export_theme_dir_skips_symlinks() {
        let tmp = TempDir::new().unwrap();
        seed(tmp.path(), "abc");
        // Create a symlink inside the theme dir pointing outside.
        let outside = tmp.path().join("outside.txt");
        std::fs::write(&outside, "sensitive").unwrap();
        std::os::unix::fs::symlink(&outside, tmp.path().join("abc/evil_link")).unwrap();

        let loader = ThemeEngineLoader::new(tmp.path().to_path_buf());
        loader.scan().unwrap();
        let new_dir = super::export_theme_dir(&loader, "abc").unwrap();
        let exported = std::path::Path::new(&new_dir);

        // Regular files should be copied.
        assert!(exported.join("theme.json").is_file());
        assert!(exported.join("theme.js").is_file());
        // The symlink must NOT be copied.
        assert!(!exported.join("evil_link").exists());
    }

    #[test]
    fn test_export_theme_dir_rewrites_id_and_name_in_copied_manifest() {
        let tmp = TempDir::new().unwrap();
        seed(tmp.path(), "abc");
        let loader = ThemeEngineLoader::new(tmp.path().to_path_buf());
        loader.scan().unwrap();
        let new_dir = super::export_theme_dir(&loader, "abc").unwrap();
        let exported = std::path::Path::new(&new_dir);

        // Verify the copied theme.json was rewritten.
        let manifest_raw =
            std::fs::read_to_string(exported.join("theme.json")).unwrap();
        let manifest: serde_json::Value =
            serde_json::from_str(&manifest_raw).unwrap();
        // id must be the new folder name (abc_custom), not the original.
        assert_eq!(manifest["id"].as_str(), Some("abc_custom"));
        // name must have " (custom)" appended.
        let name = manifest["name"].as_str().unwrap();
        assert!(name.contains("(custom)"), "expected '(custom)' in name, got: {name}");
    }

    #[test]
    fn test_theme_infos_propagates_scan_error() {
        let tmp = TempDir::new().unwrap();
        // Create a FILE where a themes_dir would be — scan will IO-error.
        let not_a_dir = tmp.path().join("notadir");
        std::fs::write(&not_a_dir, "i am a file").unwrap();
        let loader = ThemeEngineLoader::new(not_a_dir);
        let result = super::theme_infos(&loader);
        assert!(
            result.is_err(),
            "theme_infos on a file (not dir) must propagate the scan error"
        );
    }

    #[test]
    fn test_scan_after_export_finds_both_with_distinct_ids() {
        let tmp = TempDir::new().unwrap();
        seed(tmp.path(), "abc");
        let loader = ThemeEngineLoader::new(tmp.path().to_path_buf());
        loader.scan().unwrap();

        // Export to abc_custom (rewrites id in theme.json).
        let exported = super::export_theme_dir(&loader, "abc").unwrap();
        assert!(exported.ends_with("_custom"));

        // Re-scan: both should appear as distinct manifests.
        let themes = loader.scan().unwrap();
        let mut ids: Vec<_> = themes.iter().map(|t| t.id.clone()).collect();
        ids.sort();
        assert!(
            ids.contains(&"abc".to_string()),
            "original id must appear after scan"
        );
        assert!(
            ids.iter().any(|id| id.ends_with("_custom")),
            "exported custom id must appear after scan"
        );
        // Verify the exported theme is reachable by its new id.
        let custom_id = ids.iter().find(|id| id.ends_with("_custom")).unwrap();
        assert!(loader.manifest(custom_id).is_some());
    }
}
