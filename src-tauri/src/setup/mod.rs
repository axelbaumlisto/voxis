//! Application setup and initialization.

#[cfg(debug_assertions)]
mod debug_socket;
mod hotkey;
mod logging;
mod overlay;
mod permission_check;
mod process;
mod state;
mod window;

pub use state::ThemeEngineState;

#[cfg(test)]
mod tests;

use tauri::{App, Manager};

use crate::{storage, tray};

pub use logging::{init_logging, init_x11_threads};
pub use process::kill_existing_instances;
pub use window::handle_window_event;

/// Configure the Tauri application during setup.
/// This is called by `tauri::Builder::setup()`.
pub fn configure_app(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    tracing::debug!("Setup: initializing app paths...");
    let app_handle = app.handle();
    let paths = storage::AppPaths::new(app_handle)?;
    tracing::debug!("Setup: paths initialized at {:?}", paths.config_dir());

    tracing::debug!("Setup: checking system permissions...");
    let permissions_granted = permission_check::check_permissions_and_prompt();

    let sqlite_storage = storage::ConfigSqliteStorage::new(paths.config_db());
    state::migrate_config_if_needed(&paths, &sqlite_storage);
    let config = sqlite_storage.load().unwrap_or_default();

    app.manage(paths);

    let orchestrator = state::create_app_state(app, &config, permissions_granted);

    tracing::debug!("Setup: setting up system tray...");
    let paths_ref = app.state::<storage::AppPaths>();
    tray::setup_tray(app, &paths_ref)?;
    tracing::debug!("Setup: tray setup complete");

    hotkey::wire_hotkey_events(app, &orchestrator);
    overlay::init_overlay_on_startup(&orchestrator);

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        tracing::info!("Setup: main window shown with focus");
    }

    #[cfg(debug_assertions)]
    debug_socket::spawn(app.handle().clone());

    // T-C5 · apply recording-retention policy on startup. Best-effort,
    // never fatal — a corrupt history.db must not block app launch.
    // We clone the inner AppPaths (Clone) out of the State<> reference
    // so the spawned thread owns a 'static value.
    let history_path = paths_ref.history_file();
    let retention_policy = config.retention_period.clone();
    let retention_limit = config.retention_limit as usize;
    std::thread::spawn(move || {
        let storage =
            crate::storage::history_sqlite::HistorySqliteStorage::new(history_path);
        match storage.cleanup_by_retention(&retention_policy, retention_limit) {
            Ok(0) => {}
            Ok(n) => tracing::info!(
                "retention cleanup: deleted {n} history rows under policy '{retention_policy}'"
            ),
            Err(e) => tracing::warn!("retention cleanup failed: {e}"),
        }
    });

    tracing::info!("Setup: complete!");
    Ok(())
}

/// Generate the Tauri command handler with all registered commands.
pub fn command_handler() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    use crate::commands;

    tauri::generate_handler![
        commands::config::get_config,
        commands::config::save_config,
        commands::history::get_history,
        commands::history::add_history_entry,
        commands::history::clear_history,
        commands::history::delete_history_entry,
        commands::history::search_history,
        commands::dictionary::get_dictionary,
        commands::dictionary::add_dictionary_entry,
        commands::dictionary::delete_dictionary_entry,
        commands::dictionary::update_dictionary_entry,
        commands::suggestions::get_pending_suggestions,
        commands::suggestions::get_pending_count,
        commands::suggestions::approve_suggestion,
        commands::suggestions::approve_suggestion_by_source,
        commands::suggestions::reject_suggestion,
        commands::suggestions::reject_suggestion_by_source,
        commands::suggestions::reprocess_history_for_suggestions,
        commands::overlay::show_overlay,
        commands::overlay::hide_overlay,
        commands::overlay::update_overlay_position,
        commands::overlay::get_overlay_state,
        commands::overlay::get_current_overlay_theme,
        commands::overlay::get_visualization_themes,
        commands::overlay::validate_visualization_theme,
        commands::overlay::get_themes_dir,
        commands::overlay::export_builtin_theme,
        commands::overlay::reload_visualization_themes,
        commands::overlay::preview_visualization_theme,
        commands::overlay::read_theme_script,
        commands::overlay::get_theme_manifest,
        commands::overlay::debug_log_overlay,
        commands::overlay::debug_eval_overlay,
        commands::recording::cancel_operation,
        commands::recording::list_audio_devices,
        commands::recording::start_recording,
        commands::recording::stop_recording,
        commands::recording::get_recording_status,
        commands::recording::get_audio_level,
        commands::recording::get_spectrum_bins,
        commands::recording::transcribe_audio,
        commands::recording::copy_to_clipboard,
        commands::recording::type_text,
        commands::recording::manual_start_recording,
        commands::recording::manual_stop_recording,
        commands::debug::get_debug_entries,
        commands::debug::clear_debug,
        commands::debug::get_debug_dir,
        commands::debug::debug_set_handy_theme,
        commands::debug::debug_set_overlay_state,
        commands::debug::debug_emit_spectrum,
        commands::debug::debug_emit_silence,
        commands::providers::get_llm_providers,
        commands::providers::add_llm_provider,
        commands::providers::remove_llm_provider,
        commands::providers::update_llm_provider,
        commands::prompts::list_llm_prompts,
        commands::prompts::create_llm_prompt,
        commands::prompts::update_llm_prompt,
        commands::prompts::delete_llm_prompt,
        commands::prompts::get_active_llm_prompt_id,
        commands::prompts::set_active_llm_prompt_id,
        commands::shortcut_bindings::list_shortcut_bindings,
        commands::shortcut_bindings::update_shortcut_binding,
        commands::shortcut_bindings::reset_shortcut_binding,
        commands::onboarding::is_first_run,
        commands::onboarding::mark_first_run_complete,
        commands::permissions::check_permissions,
        commands::permissions::open_permission_settings,
        commands::permissions::request_microphone_permission,
        commands::permissions::request_accessibility_permission,
        commands::permissions::restart_app,
        commands::permissions::bring_to_front,
        commands::failed::get_failed_transcriptions,
        commands::failed::dismiss_failed_transcription,
        commands::failed::retry_transcription,
    ]
}
