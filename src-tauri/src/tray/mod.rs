//! System tray icon and menu.
//!
//! Provides quick access to recording, settings, and app control.

use arboard::Clipboard;
use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    App, Manager,
};

use crate::storage::{self, AppPaths, StorageFactory};
#[cfg(debug_assertions)]
use crate::OrchestratorState;
#[cfg(debug_assertions)]
use std::sync::Arc;

/// Setup the system tray icon and menu.
pub fn setup_tray(app: &App, paths: &AppPaths) -> Result<(), Box<dyn std::error::Error>> {
    // Load initial config state
    let factory = StorageFactory::new(paths.clone());
    let config = factory.config().load().unwrap_or_default();
    let llm_enabled = config.llm.enabled;

    // Create menu items
    let show_item = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;

    let copy_last_item =
        MenuItem::with_id(app, "copy_last", "Copy Last Message", true, None::<&str>)?;

    let postprocess_item = CheckMenuItem::with_id(
        app,
        "toggle_postprocess",
        "Post-processing",
        true,        // enabled (clickable)
        llm_enabled, // checked state from config
        None::<&str>,
    )?;

    let separator = PredefinedMenuItem::separator(app)?;

    #[cfg(debug_assertions)]
    let demo_item = MenuItem::with_id(app, "demo", "Demo Overlay", true, None::<&str>)?;

    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    // Build menu
    #[cfg(debug_assertions)]
    let menu = Menu::with_items(
        app,
        &[
            &show_item,
            &separator,
            &copy_last_item,
            &postprocess_item,
            &separator,
            &demo_item,
            &separator,
            &quit_item,
        ],
    )?;

    #[cfg(not(debug_assertions))]
    let menu = Menu::with_items(
        app,
        &[
            &show_item,
            &separator,
            &copy_last_item,
            &postprocess_item,
            &separator,
            &quit_item,
        ],
    )?;

    // Load icon
    let icon = load_tray_icon()?;

    // Create tray icon
    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .tooltip("Voice - Voice Dictation")
        .on_menu_event(|app, event| {
            let id = event.id.as_ref();
            match id {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }

                "copy_last" => {
                    if let Some(factory) = storage::get_storage_factory(app) {
                        match factory.history().load(Some(1)) {
                            Ok(entries) if !entries.is_empty() => {
                                let text = entries[0].text.clone();
                                // Spawn thread to avoid blocking UI
                                std::thread::spawn(move || {
                                    if let Ok(mut clipboard) = Clipboard::new() {
                                        #[cfg(target_os = "linux")]
                                        {
                                            use arboard::SetExtLinux;
                                            use std::time::{Duration, Instant};
                                            // Wait up to 2 seconds for clipboard manager to take ownership
                                            let deadline = Instant::now() + Duration::from_secs(2);
                                            match clipboard.set().wait_until(deadline).text(text) {
                                                Ok(_) => tracing::info!(
                                                    "Copied last message to clipboard"
                                                ),
                                                Err(e) => tracing::error!("Clipboard error: {}", e),
                                            }
                                        }
                                        #[cfg(not(target_os = "linux"))]
                                        {
                                            // macOS/Windows: clipboard is global, no wait needed
                                            match clipboard.set_text(&text) {
                                                Ok(_) => tracing::info!(
                                                    "Copied last message to clipboard"
                                                ),
                                                Err(e) => tracing::error!("Clipboard error: {}", e),
                                            }
                                        }
                                    }
                                });
                            }
                            _ => tracing::warn!("No history entries to copy"),
                        }
                    }
                }

                "toggle_postprocess" => {
                    // CheckMenuItem auto-updates its visual state
                    // We just need to persist the new value to config
                    if let Some(factory) = storage::get_storage_factory(app) {
                        if let Ok(mut config) = factory.config().load() {
                            config.llm.enabled = !config.llm.enabled;
                            let _ = factory.config().save(&config);
                            tracing::info!("Post-processing: {}", config.llm.enabled);
                        }
                    }
                }

                "quit" => app.exit(0),

                #[cfg(debug_assertions)]
                "demo" => {
                    if let Some(state) = app.try_state::<OrchestratorState>() {
                        let orch = Arc::clone(&state.orchestrator);
                        tauri::async_runtime::spawn(async move {
                            orch.run_demo().await;
                        });
                    }
                }

                _ => {}
            }
        })
        .build(app)?;

    Ok(())
}

/// Load the tray icon from PNG bytes.
fn load_tray_icon() -> Result<Image<'static>, Box<dyn std::error::Error>> {
    // Include the 32x32 icon as raw PNG
    let png_data = include_bytes!("../../icons/32x32.png");
    load_icon_from_png(png_data)
}

/// Load an icon from PNG bytes.
/// Extracted for testability (SRP).
fn load_icon_from_png(png_data: &[u8]) -> Result<Image<'static>, Box<dyn std::error::Error>> {
    // Decode PNG to RGBA
    let decoder = png::Decoder::new(std::io::Cursor::new(png_data));
    let mut reader = decoder.read_info()?;
    let mut buf = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf)?;

    // Create image from RGBA data
    let image = Image::new_owned(buf, info.width, info.height);
    Ok(image)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_load_tray_icon_valid() {
        // Load the actual embedded icon
        let result = load_tray_icon();
        assert!(
            result.is_ok(),
            "Should load embedded icon: {:?}",
            result.err()
        );
    }

    #[test]
    fn test_load_tray_icon_dimensions() {
        // Load and verify dimensions
        let icon = load_tray_icon().unwrap();
        // Image should have width and height
        assert!(icon.width() > 0, "Icon width should be > 0");
        assert!(icon.height() > 0, "Icon height should be > 0");
    }

    #[test]
    fn test_load_icon_from_png_invalid_data() {
        // Invalid PNG data should fail
        let invalid_data = b"not a valid png file";
        let result = load_icon_from_png(invalid_data);
        assert!(result.is_err(), "Should fail with invalid PNG data");
    }

    #[test]
    fn test_load_icon_from_png_empty_data() {
        // Empty data should fail
        let empty_data: &[u8] = &[];
        let result = load_icon_from_png(empty_data);
        assert!(result.is_err(), "Should fail with empty data");
    }
}
