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

/// What a CONFIGURED hotkey means for the OS-level listener.
///
/// Split out as a pure decision so it can be tested without an `AppHandle`:
/// whether dictation's hotkey is armed is a property of the setting, and the
/// case that matters most is the one that was previously missing — a hotkey
/// that has been cleared must DISARM, not leave the listener running with a
/// stale target.
#[derive(Debug, PartialEq, Eq)]
enum ListenerAction {
    /// A real key name is configured: make sure a listener is running on it.
    Arm,
    /// Nothing is configured: the hook must not be armed at all.
    Disarm,
}

fn listener_action_for(hotkey: &str) -> ListenerAction {
    if voxis_core::hotkey::hotkey_is_configured(hotkey) {
        ListenerAction::Arm
    } else {
        ListenerAction::Disarm
    }
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
    /// Returns whether this call armed a listener: `false` means no OS-level
    /// hook was installed — either the hotkey is empty (see
    /// [`Self::apply_configured`]) or one was already running, because a
    /// second `rdev::listen` would report every press twice.
    pub fn start(&self, app: AppHandle, hotkey: &str) -> bool {
        let sink: Arc<dyn HotkeySink> = Arc::new(TauriHotkeySink(app));
        self.inner.start_with_thread_init(sink, hotkey, || {
            crate::diagnostics::fatal::install_thread_altstack_best_effort();
        })
    }

    /// Apply the hotkey that is currently CONFIGURED: arm the listener for a
    /// real key, disarm it when the setting is empty.
    ///
    /// This is what a config change goes through, and it is why clearing the
    /// hotkey is now a real "stop watching the keyboard" rather than a
    /// rebind to a key the user cannot press: the process sees every keystroke
    /// on the machine while the hook is installed, so an unconfigured hotkey
    /// must not leave it installed.
    ///
    /// Arm is idempotent and prefers rebinding over a second hook: a running
    /// listener changes its target in place (`set_hotkey`), a stopped one is
    /// started fresh.
    pub fn apply_configured(&self, app: AppHandle, hotkey: &str) {
        match listener_action_for(hotkey) {
            ListenerAction::Arm => {
                if self.inner.is_armed() {
                    self.inner.set_hotkey(hotkey);
                } else {
                    self.start(app, hotkey);
                }
            }
            ListenerAction::Disarm => self.stop(),
        }
    }

    /// Stop the hotkey listener.
    ///
    /// The OS hook is released when the listener thread takes its next event
    /// (`rdev::listen` cannot be interrupted — see
    /// `voxis_core::hotkey`'s module doc); from this call on it notifies
    /// nothing.
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

#[cfg(test)]
mod tests {
    use super::*;

    /// The decision that matters for privacy: an empty hotkey must DISARM the
    /// OS-level hook, not leave it armed against a key nobody configured.
    #[test]
    fn a_configured_hotkey_arms_and_a_cleared_one_disarms() {
        assert_eq!(listener_action_for("ctrl_r"), ListenerAction::Arm);
        assert_eq!(listener_action_for("  alt_r  "), ListenerAction::Arm);

        assert_eq!(listener_action_for(""), ListenerAction::Disarm);
        assert_eq!(listener_action_for("   "), ListenerAction::Disarm);
        assert_eq!(listener_action_for("\t"), ListenerAction::Disarm);
    }

    /// A misspelled but non-empty name is NOT "nothing configured": the core
    /// listener keeps its historical fallback (warn + `ctrl_r`), so this must
    /// stay `Arm` — changing it would silently stop a working hotkey for
    /// someone whose config has a typo.
    #[test]
    fn a_misspelled_hotkey_still_arms() {
        assert_eq!(listener_action_for("ctrll_r"), ListenerAction::Arm);
        assert_eq!(listener_action_for("not-a-key"), ListenerAction::Arm);
    }
}
