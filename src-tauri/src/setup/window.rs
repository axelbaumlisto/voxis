use std::sync::Arc;

use tauri::{Emitter, Manager, Window, WindowEvent};

use crate::OrchestratorState;

use super::overlay;

/// Handle window events, particularly for initializing the native overlay.
pub fn handle_window_event(window: &Window, event: &WindowEvent) {
    match event {
        WindowEvent::Focused(true) => {
            let app = window.app_handle();
            if let Some(state) = app.try_state::<OrchestratorState>() {
                overlay::init_overlay_on_window_focus(Arc::clone(&state.orchestrator));
            }
        }
        // OS-level pointer enter/leave for the overlay window. The overlay's
        // borderless Dock webview does NOT reliably deliver DOM pointerleave or
        // maintain CSS :hover, so hover-reveal of the drag/resize handles must
        // be driven from these windowing-system events instead. Emit a bool to
        // the overlay webview, which toggles handle visibility.
        WindowEvent::CursorEntered { .. }
            if window.label() == crate::overlay_native::OVERLAY_PANEL_LABEL =>
        {
            let _ = window.emit(crate::overlay_native::webview::events::POINTER_INSIDE, true);
        }
        WindowEvent::CursorLeft { .. }
            if window.label() == crate::overlay_native::OVERLAY_PANEL_LABEL =>
        {
            let _ = window.emit(crate::overlay_native::webview::events::POINTER_INSIDE, false);
        }
        _ => {}
    }
}
