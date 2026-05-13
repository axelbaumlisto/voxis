//! Debug-related Tauri commands.
//!
//! Some commands are only present in `debug_assertions` builds (E2E test
//! support: theme override, spectrum injection, overlay state poke).
//! These let live screenshot suites (`e2e/handy-themes-live-gallery.spec.ts`)
//! exercise the overlay's full visual surface without depending on a real
//! microphone or the user's keyboard.

use crate::error::IntoCommandError;
use crate::storage::AppPaths;
use tauri::{Emitter, State};

/// Get recent debug entries.
#[tauri::command]
#[specta::specta]
pub fn get_debug_entries(
    limit: Option<usize>,
    paths: State<AppPaths>,
) -> Result<Vec<crate::storage::DebugEntry>, String> {
    let debug_dir = paths.debug_dir();
    if !debug_dir.exists() {
        return Ok(Vec::new());
    }

    let storage = crate::storage::DebugStorage::new(debug_dir).cmd_err()?;
    storage.get_recent_entries(limit.unwrap_or(10)).cmd_err()
}

/// Clear all debug files.
#[tauri::command]
#[specta::specta]
pub fn clear_debug(paths: State<AppPaths>) -> Result<(), String> {
    let debug_dir = paths.debug_dir();
    if !debug_dir.exists() {
        return Ok(());
    }

    let storage = crate::storage::DebugStorage::new(debug_dir).cmd_err()?;
    storage.clear().cmd_err()
}

/// Get debug directory path.
#[tauri::command]
#[specta::specta]
pub fn get_debug_dir(paths: State<AppPaths>) -> String {
    paths.debug_dir().to_string_lossy().to_string()
}

// =============================================================================
// E2E test helpers — visual surface drivers
// =============================================================================
//
// All four commands below are thin pass-throughs to `app.emit(…)` for the
// overlay event channel. They DON'T touch config.db, the orchestrator state
// machine, or the audio recorder — they purely drive what the webview pill
// renders. Safe in release builds (no privileged effects) but intended
// primarily for live-screenshot test suites against a running voice.
//
// Naming convention: `debug_*` prefix marks them as testing tools so they
// surface as a clearly-separated cluster in the auto-generated bindings.

/// Switch the overlay theme at runtime by emitting `overlay://theme`.
///
/// Effect:
///   - the overlay webview's `useOverlayState` listener pulls `themeId`
///     from the payload → `useFetchedHandyTheme` re-fetches → the
///     `HandyThemeProvider` republishes 19 CSS variables on `:root`
///     → the pill repaints in the new palette + animation timings.
///
/// Does NOT persist to config.db, so the user's stored preference is
/// preserved.
#[tauri::command]
#[specta::specta]
pub fn debug_set_handy_theme(
    theme_id: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    app.emit("overlay://theme", &theme_id)
        .map_err(|e| format!("emit overlay://theme failed: {e}"))
}

/// Force the overlay into a specific {@link OverlayState} mode by
/// emitting `overlay://state`. Bypasses orchestrator gating so test
/// suites can capture every visual state (idle / recording /
/// transcribing / error) without driving real audio.
#[tauri::command]
#[specta::specta]
pub fn debug_set_overlay_state(
    state: crate::overlay_native::OverlayState,
    app: tauri::AppHandle,
) -> Result<(), String> {
    app.emit("overlay://state", &state)
        .map_err(|e| format!("emit overlay://state failed: {e}"))
}

/// Inject synthetic spectrum bins into the overlay (e.g. simulate a
/// loud burst for peak-decay screenshots).
///
/// `bins` must have exactly `crate::audio::SPECTRUM_BARS` entries
/// (currently 32) or the command returns an error.
#[tauri::command]
#[specta::specta]
pub fn debug_emit_spectrum(
    bins: Vec<f32>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let expected = crate::audio::SPECTRUM_BARS;
    if bins.len() != expected {
        return Err(format!(
            "expected {expected} spectrum bins, got {}",
            bins.len()
        ));
    }
    // Clamp every bin to [0, 1] — the pill assumes normalised input.
    let normalised: Vec<f32> = bins.iter().map(|v| v.clamp(0.0, 1.0)).collect();
    app.emit("overlay://spectrum-bins", &normalised)
        .map_err(|e| format!("emit overlay://spectrum-bins failed: {e}"))
}

/// Sugar over [`debug_emit_spectrum`] with all zeros — makes the bars
/// fall back to the configured peak-decay rate so a slow theme like
/// `quiet_reed` (peak_decay=0.95) keeps high bars visible while `neon`
/// (peak_decay=0.70) drops them fast.
#[tauri::command]
#[specta::specta]
pub fn debug_emit_silence(app: tauri::AppHandle) -> Result<(), String> {
    let zeros = vec![0.0f32; crate::audio::SPECTRUM_BARS];
    app.emit("overlay://spectrum-bins", &zeros)
        .map_err(|e| format!("emit overlay://spectrum-bins failed: {e}"))
}

#[cfg(test)]
mod tests {
    #[allow(unused_imports)]
    use super::*;
    use crate::storage::test_utils::create_temp_paths;

    #[test]
    fn test_debug_dir_path() {
        let (temp_dir, paths) = create_temp_paths();
        let debug_dir = paths.debug_dir();
        let expected_suffix = "debug";
        assert!(
            debug_dir.to_string_lossy().contains(expected_suffix)
                || debug_dir.parent().unwrap() == temp_dir.path()
        );
    }

    #[test]
    fn test_debug_entries_empty_when_no_dir() {
        let (_temp_dir, paths) = create_temp_paths();
        // Debug dir doesn't exist yet
        let debug_dir = paths.debug_dir();
        assert!(!debug_dir.exists());
    }

    #[test]
    fn test_debug_storage_creation() {
        let (temp_dir, _paths) = create_temp_paths();
        let debug_dir = temp_dir.path().join("debug");
        std::fs::create_dir_all(&debug_dir).unwrap();

        let storage = crate::storage::DebugStorage::new(debug_dir);
        assert!(storage.is_ok());
    }

    #[test]
    fn test_debug_storage_get_recent_empty() {
        let (temp_dir, _paths) = create_temp_paths();
        let debug_dir = temp_dir.path().join("debug");
        std::fs::create_dir_all(&debug_dir).unwrap();

        let storage = crate::storage::DebugStorage::new(debug_dir).unwrap();
        let entries = storage.get_recent_entries(10).unwrap();
        assert!(entries.is_empty());
    }
}
