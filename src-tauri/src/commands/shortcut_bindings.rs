//! Tauri commands for multi-binding shortcut management (#2).
//!
//! Reuses the existing config factory rather than reading SQLite
//! directly \u2014 keeps a single source of truth for AppConfig.

use crate::error::BoxedIntoCommandError;
use crate::shortcut::ShortcutBinding;
use crate::storage::AppPaths;
use tauri::State;

use super::get_factory;

#[tauri::command]
#[specta::specta]
pub fn list_shortcut_bindings(
    paths: State<AppPaths>,
) -> Result<Vec<ShortcutBinding>, String> {
    let config = get_factory(&paths).config().load().cmd_err()?;
    Ok(config.shortcut_bindings)
}

#[tauri::command]
#[specta::specta]
pub fn update_shortcut_binding(
    id: String,
    new_combo: String,
    paths: State<AppPaths>,
) -> Result<ShortcutBinding, String> {
    let factory = get_factory(&paths);
    let mut config = factory.config().load().cmd_err()?;
    let binding = config
        .shortcut_bindings
        .iter_mut()
        .find(|b| b.id == id)
        .ok_or_else(|| format!("shortcut binding id '{}' not found", id))?;
    binding.current_binding = new_combo;
    let updated = binding.clone();
    factory.config().save(&config).cmd_err()?;
    Ok(updated)
}

#[tauri::command]
#[specta::specta]
pub fn reset_shortcut_binding(
    id: String,
    paths: State<AppPaths>,
) -> Result<ShortcutBinding, String> {
    let factory = get_factory(&paths);
    let mut config = factory.config().load().cmd_err()?;
    let binding = config
        .shortcut_bindings
        .iter_mut()
        .find(|b| b.id == id)
        .ok_or_else(|| format!("shortcut binding id '{}' not found", id))?;
    binding.current_binding = binding.default_binding.clone();
    let updated = binding.clone();
    factory.config().save(&config).cmd_err()?;
    Ok(updated)
}
