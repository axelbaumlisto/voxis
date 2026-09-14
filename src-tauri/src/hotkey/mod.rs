//! Hotkey module — thin Tauri adapter over `voxis_core::hotkey`.
//!
//! Task 1b moved the key-table, `HotkeyCombo`/`HotkeyModifier`/
//! `HotkeyParseError` parser, and the rdev press/release listener thread
//! into `voxis_core::hotkey` (behind the `rdev` feature) — that module has
//! no `tauri` dependency, so it notifies through the `HotkeySink` trait
//! instead of emitting Tauri events directly. This file keeps:
//! - `TauriHotkeySink`: adapts `HotkeySink` to `AppHandle::emit`, using the
//!   exact same event names/payloads the old rdev callback emitted
//!   directly (`"hotkey-pressed"`, `"hotkey-released"`).
//! - `HotkeyListener`: a thin wrapper preserving the pre-Task-1b public API
//!   (`new`, `start(app, hotkey)`, `stop`, `set_hotkey`, `restart`) so
//!   `setup/state.rs` and `config/change_handler.rs` compile unchanged,
//!   and installs the crash-diagnostics altstack on the listener's
//!   background thread (a voice_lib-only concern core has no module for)
//!   via `start_with_thread_init`.

use std::sync::Arc;
use tauri::{AppHandle, Emitter};

pub use voxis_core::hotkey::{
    parse_hotkey, HotkeyCombo, HotkeyModifier, HotkeyParseError, HotkeySink,
};

/// Adapts [`HotkeySink`] to Tauri events. See module doc.
struct TauriHotkeySink(AppHandle);

impl HotkeySink for TauriHotkeySink {
    fn on_pressed(&self) {
        if let Err(e) = self.0.emit("hotkey-pressed", ()) {
            tracing::error!("Failed to emit hotkey-pressed: {}", e);
        }
    }

    fn on_released(&self) {
        if let Err(e) = self.0.emit("hotkey-released", ()) {
            tracing::error!("Failed to emit hotkey-released: {}", e);
        }
    }
}

/// Hotkey listener state — thin wrapper over `voxis_core::hotkey::
/// HotkeyListener`. See module doc for why this wrapper exists.
pub struct HotkeyListener {
    inner: voxis_core::hotkey::HotkeyListener,
}

impl HotkeyListener {
    /// Create a new hotkey listener.
    pub fn new() -> Self {
        Self {
            inner: voxis_core::hotkey::HotkeyListener::new(),
        }
    }

    /// Start listening for hotkey events in a background thread.
    ///
    /// Emits "hotkey-pressed" and "hotkey-released" events to the app.
    pub fn start(&self, app: AppHandle, hotkey: &str) {
        let sink: Arc<dyn HotkeySink> = Arc::new(TauriHotkeySink(app));
        self.inner.start_with_thread_init(sink, hotkey, || {
            crate::diagnostics::fatal::install_thread_altstack_best_effort();
        });
    }

    /// Stop the hotkey listener.
    pub fn stop(&self) {
        self.inner.stop();
    }

    /// Change the hotkey without restarting the listener thread.
    pub fn set_hotkey(&self, hotkey: &str) {
        self.inner.set_hotkey(hotkey);
    }

    /// Restart the hotkey listener with a new hotkey.
    /// Note: This just updates the target key atomically, no thread restart needed.
    pub fn restart(&mut self, _app: AppHandle, hotkey: &str) {
        self.set_hotkey(hotkey);
    }
}

impl Default for HotkeyListener {
    fn default() -> Self {
        Self::new()
    }
}
