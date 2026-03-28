use std::sync::Arc;

use crate::orchestrator::Orchestrator;

pub(super) fn init_overlay_on_startup(orchestrator: &Arc<Orchestrator>) {
    let config = orchestrator.load_config();
    if config.overlay.enabled {
        let orch = Arc::clone(orchestrator);
        tauri::async_runtime::spawn(async move {
            tracing::info!("Initializing overlay at startup");
            orch.init_overlay(&config).await;
        });
    }
}

pub(super) fn init_overlay_on_window_focus(orchestrator: Arc<Orchestrator>) {
    let config = orchestrator.load_config();
    if config.overlay.enabled {
        tauri::async_runtime::spawn(async move {
            if orchestrator.is_overlay_running().await {
                return;
            }
            tracing::info!("Initializing native overlay (window focused)");
            orchestrator.init_overlay(&config).await;
        });
    }
}
