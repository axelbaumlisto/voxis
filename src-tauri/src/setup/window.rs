use std::sync::Arc;

use tauri::{Manager, Window, WindowEvent};

use crate::OrchestratorState;

use super::overlay;

/// Handle window events, particularly for initializing the native overlay.
pub fn handle_window_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::Focused(true) = event {
        let app = window.app_handle();
        if let Some(state) = app.try_state::<OrchestratorState>() {
            overlay::init_overlay_on_window_focus(Arc::clone(&state.orchestrator));
        }
    }
}
