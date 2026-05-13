//! Tauri commands for the first-run onboarding flow (#10).
//!
//! Two commands; both touch only the `first_run_completed` bool so
//! they're trivial (KISS):
//!   is_first_run()                  -> bool
//!   mark_first_run_complete()       -> ()

use crate::error::BoxedIntoCommandError;
use crate::storage::AppPaths;
use tauri::State;

use super::get_factory;

#[tauri::command]
#[specta::specta]
pub fn is_first_run(paths: State<AppPaths>) -> Result<bool, String> {
    let config = get_factory(&paths).config().load().cmd_err()?;
    Ok(!config.first_run_completed)
}

#[tauri::command]
#[specta::specta]
pub fn mark_first_run_complete(paths: State<AppPaths>) -> Result<(), String> {
    let factory = get_factory(&paths);
    let mut config = factory.config().load().cmd_err()?;
    config.first_run_completed = true;
    factory.config().save(&config).cmd_err()?;
    Ok(())
}
