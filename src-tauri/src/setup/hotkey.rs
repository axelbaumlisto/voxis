use std::sync::Arc;

use tauri::{App, Listener};

use crate::orchestrator::Orchestrator;

/// Wire hotkey events to the orchestrator.
pub(super) fn wire_hotkey_events(app: &App, orchestrator: &Arc<Orchestrator>) {
    let orch_pressed = Arc::clone(orchestrator);
    app.listen("hotkey-pressed", move |_event| {
        let orch = Arc::clone(&orch_pressed);
        tauri::async_runtime::spawn(async move {
            orch.on_hotkey_pressed().await;
        });
    });

    let orch_released = Arc::clone(orchestrator);
    app.listen("hotkey-released", move |_event| {
        let orch = Arc::clone(&orch_released);
        tauri::async_runtime::spawn(async move {
            orch.on_hotkey_released().await;
        });
    });
}
