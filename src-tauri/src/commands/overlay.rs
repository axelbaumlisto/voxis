//! Overlay-related Tauri commands.

use crate::overlay::{self, OverlayPosition, OverlayState};
use crate::overlay_native::{ThemeInfo, ThemeTestResult};
use crate::setup::ThemeEngineState;
use crate::error::BoxedIntoCommandError;
use crate::overlay_native::OVERLAY_PANEL_LABEL;
use crate::storage::{AppPaths, StorageFactory};
use crate::theme_engine::{ThemeEngineLoader, ThemeManifest};
use crate::OrchestratorState;
use tauri::AppHandle;
use tauri::Manager;
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
/// NOTE: the list is the loader's scan over `[builtin, user]` — builtin themes
/// come from the binary (dev: `src-tauri/themes` on disk), the user themes dir
/// contributes the user's own themes and overrides. Nothing has to be copied
/// into the user themes dir first, so a fresh install already lists the
/// builtins.
///
/// Returns an error if theme scanning fails. The app's loader cannot fail that
/// way — with builtins layered underneath, an unusable user themes dir (a file
/// instead of a directory, no permissions) is logged and the builtins stay
/// listed — so the `Err` arm covers a user-only loader (tests, tooling); the
/// frontend surfaces it instead of showing a silently-empty dropdown.
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
pub fn get_themes_dir(_app: AppHandle) -> Result<String, String> {
    let paths = AppPaths::for_desktop().map_err(|e| e.to_string())?;
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

/// Pure helper: copy a theme's files from the source that owns it to
/// themes_dir/<id>_custom (with counter-suffix loop for collisions). Works for
/// any source the loader knows — builtin themes (embedded or a dev dir) as
/// well as user themes — because the files come from the owning
/// `ThemeSource`, while the copy is written into the user themes dir.
pub fn export_theme_dir(loader: &ThemeEngineLoader, theme_id: &str) -> Result<String, String> {
    // `files()` answers from the scan cache, so a single lookup would tie the
    // export to the caller's scan timing: a theme added since the last scan is
    // not cached at all, and a cached id whose folder vanished (a deleted user
    // copy that shadowed a builtin) yields no files. Both need one fresh scan —
    // the retry is what lets the id fall back to the source that still has it.
    let mut files = loader.files(theme_id);
    if files.is_empty() {
        loader.scan().map_err(|e| format!("scan themes: {e}"))?;
        files = loader.files(theme_id);
    }

    // An empty file list means "no such theme" (see `ThemeEngineLoader::files`).
    // Bail out before creating anything, so a failed export never leaves an
    // empty `<id>_custom` folder behind.
    if files.is_empty() {
        return Err(format!("unknown theme: '{theme_id}' not found"));
    }

    let themes_dir = loader.themes_dir();

    let base_name = format!("{}_custom", theme_id);
    let mut folder_name = base_name.clone();
    let mut counter = 1;

    while themes_dir.join(&folder_name).exists() {
        folder_name = format!("{}_{}", base_name, counter);
        counter += 1;
    }

    let dest_dir = themes_dir.join(&folder_name);
    std::fs::create_dir_all(&dest_dir).map_err(|e| format!("create dest dir: {e}"))?;

    // Only plain file names arrive here: the sources skip symlinks and
    // non-files and return regular files of one theme, so a plain join is safe.
    for (fname, bytes) in &files {
        std::fs::write(dest_dir.join(fname), bytes).map_err(|e| format!("write {fname:?}: {e}"))?;
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

/// Live-move the overlay window to `(x, y)` in LOGICAL px WITHOUT persisting.
/// Called on every pointer-move of an interactive grip drag; the frontend has
/// already clamped `(x, y)` to the screen. Dispatched to the main thread
/// because window geometry mutation must run there on macOS/GTK.
#[tauri::command]
#[specta::specta]
pub fn move_overlay_window(x: i32, y: i32, app: AppHandle) -> Result<(), String> {
    let app2 = app.clone();
    app.run_on_main_thread(move || {
        if let Some(w) = app2.get_webview_window(OVERLAY_PANEL_LABEL) {
            let _ = w.set_position(tauri::LogicalPosition::new(x as f64, y as f64));
        }
    })
    .map_err(|e| e.to_string())
}

/// Live-resize the overlay window to `(w, h)` in LOGICAL px WITHOUT
/// persisting — called on every pointer-move of the corner grip (the frontend
/// keeps it square and clamped). Main thread for the same reason as
/// `move_overlay_window`: window geometry mutation must run there on
/// macOS/GTK.
/// The one place an overlay size is applied to the live window. Both the
/// per-frame gesture (`resize_overlay_window`) and the persisted value
/// (`set_overlay_custom_size`) go through here, so "how the window is resized"
/// cannot drift between the two.
fn apply_overlay_size(app: &AppHandle, side: u32) -> Result<(), String> {
    let app2 = app.clone();
    let side = side as f64;
    app.run_on_main_thread(move || {
        if let Some(w) = app2.get_webview_window(OVERLAY_PANEL_LABEL) {
            let _ = w.set_size(tauri::LogicalSize::new(side, side));
        }
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn resize_overlay_window(width: u32, height: u32, app: AppHandle) -> Result<(), String> {
    use crate::orchestrator::overlay_resize::clamp_overlay_size;
    apply_overlay_size(&app, clamp_overlay_size(width.max(height)))
}

/// Current overlay window top-left in LOGICAL px — the drag start reference.
#[tauri::command]
#[specta::specta]
pub fn get_overlay_window_position(app: AppHandle) -> Result<(i32, i32), String> {
    let w = app
        .get_webview_window(OVERLAY_PANEL_LABEL)
        .ok_or_else(|| "overlay window not found".to_string())?;
    let pos = w.outer_position().map_err(|e| e.to_string())?;
    let scale = w.scale_factor().unwrap_or(1.0).max(1.0);
    Ok(((pos.x as f64 / scale) as i32, (pos.y as f64 / scale) as i32))
}

/// Persist a user-dragged overlay position and re-pin the overlay there so it
/// survives restarts and theme changes.
#[tauri::command]
#[specta::specta]
pub async fn set_overlay_custom_position(
    x: i32,
    y: i32,
    paths: State<'_, AppPaths>,
    orchestrator_state: State<'_, OrchestratorState>,
) -> Result<(), String> {
    let factory = StorageFactory::new(paths.inner().clone());
    let mut config = factory.config().load().unwrap_or_default();
    config.overlay.custom_x = Some(x);
    config.overlay.custom_y = Some(y);
    factory.config().save(&config).cmd_err()?;
    orchestrator_state.orchestrator.reinit_overlay(&config).await;
    Ok(())
}

/// Clear the user-dragged position; the overlay returns to its configured
/// preset placement (`position` + `margin`).
#[tauri::command]
#[specta::specta]
pub async fn clear_overlay_custom_position(
    paths: State<'_, AppPaths>,
    orchestrator_state: State<'_, OrchestratorState>,
) -> Result<(), String> {
    let factory = StorageFactory::new(paths.inner().clone());
    let mut config = factory.config().load().unwrap_or_default();
    config.overlay.custom_x = None;
    config.overlay.custom_y = None;
    factory.config().save(&config).cmd_err()?;
    orchestrator_state.orchestrator.reinit_overlay(&config).await;
    Ok(())
}

/// Persist a user-resized overlay size (logical px, square) and rebuild the
/// overlay at it. Mirrors `set_overlay_custom_position`: the size is applied by
/// `reinit_overlay`, so it survives restarts and theme switches.
#[tauri::command]
#[specta::specta]
pub async fn set_overlay_custom_size(
    width: u32,
    height: u32,
    app_handle: AppHandle,
    paths: State<'_, AppPaths>,
) -> Result<(), String> {
    use crate::orchestrator::overlay_resize::clamp_overlay_size;
    // The grip drags a SQUARE: the larger side wins so a persisted pair can
    // never leave the theme drawing into a non-square canvas.
    let side = clamp_overlay_size(width.max(height));
    let factory = StorageFactory::new(paths.inner().clone());
    let mut config = factory.config().load().unwrap_or_default();
    config.overlay.custom_w = Some(side);
    config.overlay.custom_h = Some(side);
    factory.config().save(&config).cmd_err()?;
    // NO `reinit_overlay` here: the grip already moved the live window to this
    // size (one `resize_overlay_window` per frame), and re-initialising the
    // overlay would destroy and rebuild it — a visible flash, and it would cut
    // a recording that is in flight. Persisting is all that is left to do; the
    // config is what the next build/theme switch reads.
    apply_overlay_size(&app_handle, side)?;
    Ok(())
}

/// Drop the user-resized size: the overlay returns to the active theme's
/// manifest footprint (double-click on the corner grip).
#[tauri::command]
#[specta::specta]
pub async fn clear_overlay_custom_size(
    paths: State<'_, AppPaths>,
    orchestrator_state: State<'_, OrchestratorState>,
) -> Result<(), String> {
    // Re-init on purpose: dropping the size means reverting to the ACTIVE
    // theme's manifest footprint, which only the overlay manager can resolve.
    // This is a deliberate double-click, never a recording gesture.
    let factory = StorageFactory::new(paths.inner().clone());
    let mut config = factory.config().load().unwrap_or_default();
    config.overlay.custom_w = None;
    config.overlay.custom_h = None;
    factory.config().save(&config).cmd_err()?;
    orchestrator_state.orchestrator.reinit_overlay(&config).await;
    Ok(())
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
        // Seed a theme so the export has something to copy. The manifest must be
        // a valid v2 one: export reads from the loader, which only knows themes
        // it could scan.
        let src = temp.path().join("winamp_classic");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(
            src.join("theme.json"),
            r#"{"manifest_version":2,"id":"winamp_classic","name":"Winamp Classic","api_version":1,"entry":"theme.js"}"#,
        )
        .unwrap();
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

    /// A loader layered as `[builtin, user]`, like the app's own.
    fn layered_loader(builtin: &std::path::Path, user: &std::path::Path) -> ThemeEngineLoader {
        ThemeEngineLoader::with_builtin(
            Box::new(crate::theme_engine::DirSource::new(builtin.to_path_buf())),
            user.to_path_buf(),
        )
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

    /// Exporting a builtin works with an empty user folder: the files come from
    /// the builtin source, the rewritten copy lands in the user dir.
    #[test]
    fn test_export_builtin_theme_copies_builtin_with_empty_user_dir() {
        let builtin = TempDir::new().unwrap();
        seed(builtin.path(), "orb");
        fs::write(builtin.path().join("orb/palette.css"), ":root{}").unwrap();
        let user = TempDir::new().unwrap();
        let loader = layered_loader(builtin.path(), user.path());

        let exported = super::export_theme_dir(&loader, "orb").unwrap();
        let exported = std::path::Path::new(&exported);
        assert_eq!(exported.parent(), Some(user.path()));
        assert_eq!(
            exported.file_name().and_then(|n| n.to_str()),
            Some("orb_custom")
        );
        for name in ["theme.json", "theme.js", "palette.css"] {
            assert!(exported.join(name).is_file(), "{name} must be exported");
        }

        let manifest: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(exported.join("theme.json")).unwrap())
                .unwrap();
        assert_eq!(manifest["id"].as_str(), Some("orb_custom"));
        assert_eq!(manifest["name"].as_str(), Some("N (custom)"));

        // Neither source is mutated by the export.
        assert!(builtin.path().join("orb/theme.json").is_file());
        assert!(!user.path().join("orb").exists());
    }

    /// An unknown id errors out before anything is created: a failed export
    /// must not leave an empty `<id>_custom` folder in the user dir.
    #[test]
    fn test_export_theme_dir_unknown_id_creates_no_folder() {
        let builtin = TempDir::new().unwrap();
        seed(builtin.path(), "orb");
        let user = TempDir::new().unwrap();
        let loader = layered_loader(builtin.path(), user.path());

        let err = super::export_theme_dir(&loader, "ghost").unwrap_err();
        assert!(err.contains("unknown theme"), "got: {err}");
        let left: Vec<_> = fs::read_dir(user.path())
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name())
            .collect();
        assert!(left.is_empty(), "no folder may be created, got: {left:?}");
    }

    /// A second export of the same theme takes the next free folder name.
    #[test]
    fn test_export_builtin_theme_twice_uses_custom_1() {
        let builtin = TempDir::new().unwrap();
        seed(builtin.path(), "orb");
        let user = TempDir::new().unwrap();
        let loader = layered_loader(builtin.path(), user.path());

        let first = super::export_theme_dir(&loader, "orb").unwrap();
        let second = super::export_theme_dir(&loader, "orb").unwrap();

        assert!(first.ends_with("orb_custom"), "got: {first}");
        assert!(second.ends_with("orb_custom_1"), "got: {second}");
        assert!(std::path::Path::new(&second).join("theme.js").is_file());
    }

    /// A cached user copy that disappears between scan and export must not
    /// fail: the id falls back to the builtin it was shadowing.
    #[test]
    fn test_export_theme_dir_deleted_user_shadow_falls_back_to_builtin() {
        let builtin = TempDir::new().unwrap();
        seed(builtin.path(), "orb");
        fs::write(builtin.path().join("orb/builtin_only.css"), "b{}").unwrap();
        let user = TempDir::new().unwrap();
        seed(user.path(), "orb");
        fs::write(user.path().join("orb/user_only.css"), "u{}").unwrap();
        let loader = layered_loader(builtin.path(), user.path());
        // Cache says "orb" is owned by the user dir.
        loader.scan().unwrap();

        // The user copy vanishes without a rescan.
        fs::remove_dir_all(user.path().join("orb")).unwrap();

        let exported = super::export_theme_dir(&loader, "orb").unwrap();
        let exported = std::path::Path::new(&exported);
        assert_eq!(exported.parent(), Some(user.path()));
        assert_eq!(
            exported.file_name().and_then(|n| n.to_str()),
            Some("orb_custom")
        );
        assert!(
            exported.join("builtin_only.css").is_file(),
            "the copy must come from the builtin after the fallback"
        );
        assert!(!exported.join("user_only.css").exists());
    }

    /// The release path: builtins come from the binary itself (`include_dir!`),
    /// not from the user folder. Exporting the embedded `default` theme must
    /// produce the same usable `<id>_custom` copy.
    #[test]
    fn test_export_theme_dir_from_embedded_builtin() {
        let user = TempDir::new().unwrap();
        let loader = ThemeEngineLoader::with_builtin(
            Box::new(crate::theme_engine::source::EmbeddedSource::builtin()),
            user.path().to_path_buf(),
        );

        let exported = super::export_theme_dir(&loader, "default").unwrap();
        let exported = std::path::Path::new(&exported);
        assert_eq!(exported, user.path().join("default_custom"));
        assert!(exported.join("theme.js").is_file());

        let manifest: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(exported.join("theme.json")).unwrap())
                .unwrap();
        assert_eq!(manifest["id"].as_str(), Some("default_custom"));
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
