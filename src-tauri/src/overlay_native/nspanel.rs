//! NSPanel-based overlay backend (macOS only).
//!
//! Alternative to [`SubprocessOverlay`](super::subprocess::SubprocessOverlay) that
//! uses [`tauri-nspanel`](https://github.com/ahkohd/tauri-nspanel) to render the
//! overlay inside a borderless [`NSPanel`]. Compared to the standalone subprocess
//! overlay, an NSPanel:
//!
//! - never steals keyboard focus from the active app (`can_become_key_window: false`)
//! - is visible across all Spaces (via `CanJoinAllSpaces`) and stays on top
//! - lives inside the main app process, so we avoid the spawn/heartbeat dance
//!
//! This backend is **not** wired into [`create_overlay`](super::create_overlay)
//! yet — it ships as an opt-in module so it can be developed and tested in
//! isolation. On non-macOS platforms it compiles as a stub.
//!
//! Design notes (SOLID):
//! - SRP: this module only owns the panel lifecycle. Rendering of audio/spectrum
//!   data is delegated to the webview hosted inside the panel via Tauri events.
//! - OCP: implementing [`OverlayBackend`](super::OverlayBackend) means callers can
//!   swap it in without changes elsewhere.
//! - DIP: this type depends on the Tauri abstractions (`AppHandle`, events) only.
//! - KISS: minimal surface; non-macOS path is a deliberate no-op (no `unimplemented!`).

use super::backend::OverlayBackend;
use super::OverlayState;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Tauri webview label assigned to the overlay panel.
pub const OVERLAY_PANEL_LABEL: &str = "overlay";

/// Tauri event names emitted by the overlay backend to the panel webview.
pub mod events {
    /// Recording state changes (`OverlayState` JSON).
    pub const STATE: &str = "overlay://state";
    /// Audio level updates (`f32` JSON).
    pub const AUDIO_LEVEL: &str = "overlay://audio-level";
    /// Spectrum bin updates (`[f32; SPECTRUM_BARS]` JSON).
    pub const SPECTRUM_BINS: &str = "overlay://spectrum-bins";
    /// Theme name updates (`String` JSON).
    pub const THEME: &str = "overlay://theme";
}

/// NSPanel-based overlay backend.
///
/// Construct with [`NsPanelOverlay::new`] when an `AppHandle` is available (macOS),
/// or with [`NsPanelOverlay::unavailable`] for tests and non-macOS platforms.
pub struct NsPanelOverlay {
    running: Arc<AtomicBool>,
    #[cfg(target_os = "macos")]
    inner: imp::Inner,
}

impl NsPanelOverlay {
    /// Create an "unavailable" overlay — every method becomes a no-op and
    /// [`is_running`](OverlayBackend::is_running) returns `false`.
    ///
    /// Used by tests (no live `AppHandle`) and on non-macOS platforms.
    pub fn unavailable() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            #[cfg(target_os = "macos")]
            inner: imp::Inner::Unavailable,
        }
    }

    /// Create a real NSPanel-backed overlay.
    ///
    /// On macOS this:
    /// 1. Creates a borderless webview window for the overlay HTML.
    /// 2. Converts it into an `NSPanel` with `can_become_key_window=false`
    ///    and `is_floating_panel=true`.
    /// 3. Applies a collection behavior of
    ///    `CanJoinAllSpaces | Stationary | IgnoresCycle`.
    ///
    /// On non-macOS this is equivalent to [`Self::unavailable`].
    ///
    /// macOS note: `WebviewWindowBuilder::build()` and `to_panel()` must run
    /// on the main thread (AppKit invariant). When called from any other
    /// thread (e.g. a Tauri command's async task), Tauri panics on the
    /// `[NSWindow init]` assertion. We therefore dispatch the webview/panel
    /// creation through `app.run_on_main_thread` and synchronously wait for
    /// the result over a `std::sync::mpsc` channel. If we are already on the
    /// main thread, the closure executes inline — still safe.
    #[cfg(target_os = "macos")]
    pub fn new(app: tauri::AppHandle) -> Result<Self, String> {
        let (tx, rx) = std::sync::mpsc::channel::<Result<imp::Inner, String>>();
        let app_for_thread = app.clone();
        let dispatched = app.run_on_main_thread(move || {
            let _ = tx.send(imp::Inner::create(app_for_thread));
        });
        if let Err(e) = dispatched {
            return Err(format!("run_on_main_thread dispatch failed: {e}"));
        }
        let inner = rx
            .recv()
            .map_err(|e| format!("main-thread NSPanel result channel closed: {e}"))??;
        Ok(Self {
            running: Arc::new(AtomicBool::new(true)),
            inner,
        })
    }

    /// Stub constructor on non-macOS — mirrors [`Self::unavailable`].
    #[cfg(not(target_os = "macos"))]
    pub fn new() -> Result<Self, String> {
        Err("NSPanel overlay is only supported on macOS".to_string())
    }
}

impl Default for NsPanelOverlay {
    fn default() -> Self {
        Self::unavailable()
    }
}

impl OverlayBackend for NsPanelOverlay {
    fn show(&self, state: OverlayState) {
        if !self.running.load(Ordering::SeqCst) {
            return;
        }
        #[cfg(target_os = "macos")]
        self.inner.show(state);
        #[cfg(not(target_os = "macos"))]
        let _ = state;
    }

    fn hide(&self) {
        if !self.running.load(Ordering::SeqCst) {
            return;
        }
        #[cfg(target_os = "macos")]
        self.inner.hide();
    }

    fn send_audio_level(&self, level: f32) {
        if !self.running.load(Ordering::SeqCst) {
            return;
        }
        #[cfg(target_os = "macos")]
        self.inner.send_audio_level(level);
        #[cfg(not(target_os = "macos"))]
        let _ = level;
    }

    fn send_spectrum_bins(&self, bins: [f32; crate::audio::SPECTRUM_BARS]) {
        if !self.running.load(Ordering::SeqCst) {
            return;
        }
        #[cfg(target_os = "macos")]
        self.inner.send_spectrum_bins(bins);
        #[cfg(not(target_os = "macos"))]
        let _ = bins;
    }

    fn update_position(&self, x: i32, y: i32, width: u32, height: u32) {
        if !self.running.load(Ordering::SeqCst) {
            return;
        }
        #[cfg(target_os = "macos")]
        self.inner.update_position(x, y, width, height);
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (x, y, width, height);
        }
    }

    fn set_theme(&self, theme_name: &str) {
        if !self.running.load(Ordering::SeqCst) {
            return;
        }
        #[cfg(target_os = "macos")]
        self.inner.set_theme(theme_name);
        #[cfg(not(target_os = "macos"))]
        let _ = theme_name;
    }

    fn shutdown(&mut self) {
        self.running.store(false, Ordering::SeqCst);
        #[cfg(target_os = "macos")]
        self.inner.shutdown();
    }

    fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }
}

impl Drop for NsPanelOverlay {
    fn drop(&mut self) {
        self.shutdown();
    }
}

// ---- macOS-only implementation -----------------------------------------------

#[cfg(target_os = "macos")]
mod imp {
    use super::{events, OverlayState, OVERLAY_PANEL_LABEL};
    use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
    use tauri_nspanel::{
        tauri_panel, CollectionBehavior, ManagerExt, PanelLevel, WebviewWindowExt,
    };

    tauri_panel! {
        panel!(RecordingOverlayPanel {
            config: {
                can_become_key_window: false,
                is_floating_panel: true
            }
        })
    }

    /// macOS-only state for [`super::NsPanelOverlay`].
    pub enum Inner {
        /// Backend constructed without a real `AppHandle` — all methods are no-ops.
        Unavailable,
        /// Live backend with an `AppHandle` and a created NSPanel.
        Live { app: AppHandle, label: String },
    }

    impl Inner {
        /// Build a borderless webview, convert it to an `NSPanel`, and apply
        /// the desired collection behaviour.
        pub fn create(app: AppHandle) -> Result<Self, String> {
            let label = OVERLAY_PANEL_LABEL.to_string();

            // Reuse an existing panel if one is already registered (e.g. across
            // backend reinit). We do not eagerly close it so a follow-up
            // wiring task can decide the right lifecycle.
            if app.get_webview_panel(&label).is_ok() {
                return Ok(Inner::Live { app, label });
            }

            // Create the underlying webview window. The HTML page itself lives
            // in the frontend bundle (e.g. `overlay.html`) and is not part of
            // this task — pointing the URL at it lets the panel render.
            let window = WebviewWindowBuilder::new(
                &app,
                &label,
                WebviewUrl::App("overlay.html".into()),
            )
            .title("Recording Overlay")
            .resizable(false)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .visible(false)
            .transparent(true)
            .build()
            .map_err(|e| format!("Failed to build overlay webview: {e}"))?;

            let panel = window
                .to_panel::<RecordingOverlayPanel>()
                .map_err(|e| format!("Failed to convert window to NSPanel: {e}"))?;

            panel.set_level(PanelLevel::Floating.value());
            panel.set_collection_behavior(
                CollectionBehavior::new()
                    .can_join_all_spaces()
                    .stationary()
                    .ignores_cycle()
                    .value(),
            );

            Ok(Inner::Live { app, label })
        }

        fn live(&self) -> Option<(&AppHandle, &str)> {
            match self {
                Inner::Live { app, label } => Some((app, label.as_str())),
                Inner::Unavailable => None,
            }
        }

        pub fn show(&self, state: OverlayState) {
            if let Some((app, label)) = self.live() {
                if let Err(e) = app.emit(events::STATE, &state) {
                    tracing::debug!("nspanel: emit state failed: {e}");
                }
                if let Ok(panel) = app.get_webview_panel(label) {
                    panel.show();
                }
            }
        }

        pub fn hide(&self) {
            if let Some((app, label)) = self.live() {
                if let Ok(panel) = app.get_webview_panel(label) {
                    panel.hide();
                }
            }
        }

        pub fn send_audio_level(&self, level: f32) {
            if let Some((app, _)) = self.live() {
                let _ = app.emit(events::AUDIO_LEVEL, level);
            }
        }

        pub fn send_spectrum_bins(&self, bins: [f32; crate::audio::SPECTRUM_BARS]) {
            if let Some((app, _)) = self.live() {
                let _ = app.emit(events::SPECTRUM_BINS, bins);
            }
        }

        pub fn update_position(&self, x: i32, y: i32, width: u32, height: u32) {
            if let Some((app, label)) = self.live() {
                if let Some(window) = app.get_webview_window(label) {
                    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
                    let _ = window.set_size(tauri::PhysicalSize::new(width, height));
                }
            }
        }

        pub fn set_theme(&self, theme_name: &str) {
            if let Some((app, _)) = self.live() {
                let _ = app.emit(events::THEME, theme_name.to_string());
            }
        }

        pub fn shutdown(&mut self) {
            if let Inner::Live { app, label } = self {
                if let Ok(panel) = app.get_webview_panel(label) {
                    panel.hide();
                }
                // Leave the panel registered; closing it requires the runtime
                // to be alive and crossing FFI boundaries here would risk a
                // deadlock if shutdown runs on a non-main thread.
            }
            *self = Inner::Unavailable;
        }
    }
}

// ---- tests --------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_send_sync<T: Send + Sync>() {}

    #[test]
    fn test_nspanel_overlay_is_send_sync() {
        // Compile-time assertion: backend implementations must be Send + Sync
        // so they can be stored in `Box<dyn OverlayBackend>` shared state.
        assert_send_sync::<NsPanelOverlay>();
    }

    #[test]
    fn test_unavailable_overlay_creates_without_panic() {
        let overlay = NsPanelOverlay::unavailable();
        assert!(!overlay.is_running(), "unavailable overlay should not be running");
    }

    #[test]
    fn test_default_uses_unavailable() {
        let overlay = NsPanelOverlay::default();
        assert!(!overlay.is_running());
    }

    #[test]
    fn test_unavailable_overlay_methods_are_noop() {
        // Every backend method must be safe to call on an unavailable overlay.
        let mut overlay = NsPanelOverlay::unavailable();
        overlay.show(OverlayState::Recording);
        overlay.show(OverlayState::Transcribing);
        overlay.show(OverlayState::Idle);
        overlay.show(OverlayState::Hidden);
        overlay.show(OverlayState::Queued(3));
        overlay.hide();
        overlay.send_audio_level(0.5);
        overlay.send_audio_level(-0.1);
        overlay.send_audio_level(1.5);
        overlay.send_spectrum_bins([0.0; crate::audio::SPECTRUM_BARS]);
        overlay.update_position(10, 20, 300, 100);
        overlay.update_position(-5, -5, 0, 0);
        overlay.set_theme("default");
        overlay.set_theme("");
        assert!(!overlay.is_running());
        overlay.shutdown();
        assert!(!overlay.is_running());
    }

    #[test]
    fn test_state_transitions_via_show() {
        // Walking through all state transitions must never panic, regardless
        // of whether the backend has a live AppHandle.
        let overlay = NsPanelOverlay::unavailable();
        let states = [
            OverlayState::Idle,
            OverlayState::Recording,
            OverlayState::Transcribing,
            OverlayState::Queued(0),
            OverlayState::Queued(5),
            OverlayState::Hidden,
        ];
        for state in states {
            overlay.show(state);
        }
        overlay.hide();
    }

    #[test]
    fn test_drop_is_idempotent() {
        // Dropping after explicit shutdown must not double-cleanup.
        let mut overlay = NsPanelOverlay::unavailable();
        overlay.shutdown();
        drop(overlay);
    }

    #[test]
    fn test_overlay_label_constant_is_stable() {
        // The label is part of the public contract with the frontend; freeze it.
        assert_eq!(OVERLAY_PANEL_LABEL, "overlay");
    }

    #[test]
    fn test_event_names_are_stable() {
        // Event names are part of the public contract with the frontend.
        assert_eq!(events::STATE, "overlay://state");
        assert_eq!(events::AUDIO_LEVEL, "overlay://audio-level");
        assert_eq!(events::SPECTRUM_BINS, "overlay://spectrum-bins");
        assert_eq!(events::THEME, "overlay://theme");
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn test_nspanel_overlay_stub_on_other_platforms() {
        // On non-macOS, `new()` always returns an error and `unavailable()`
        // remains the only constructor.
        let result = NsPanelOverlay::new();
        assert!(result.is_err(), "expected stub error on non-macOS");
        let overlay = NsPanelOverlay::unavailable();
        assert!(!overlay.is_running());
    }
}
