//! NSPanel-based overlay backend (macOS only).
//!
//! Uses [`tauri-nspanel`](https://github.com/ahkohd/tauri-nspanel) to render
//! the overlay inside a borderless [`NSPanel`]. Compared to a plain Tauri
//! WebviewWindow, an NSPanel:
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
use super::{OverlayPositionConfig, OverlayState};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Fixed 172×36 pill canvas. The panel hosts the React ThemeHost code-theme
/// overlay, and the theme-engine contract uses this fixed size.
pub const PILL_WIDTH: u32 = 240;
pub const PILL_HEIGHT: u32 = 80;

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
    ///
    /// `position` + `margin` honour the user's overlay placement config so
    /// the pill appears where settings say (BottomCenter, TopRight, etc.).
    /// Window size is fixed at `PILL_WIDTH × PILL_HEIGHT` per the
    /// theme-engine contract (fixed-size pill canvas).
    #[cfg(target_os = "macos")]
    pub fn new(
        app: tauri::AppHandle,
        position: OverlayPositionConfig,
        margin: i32,
    ) -> Result<Self, String> {
        let (tx, rx) = std::sync::mpsc::channel::<Result<imp::Inner, String>>();
        let app_for_thread = app.clone();
        let dispatched = app.run_on_main_thread(move || {
            let _ = tx.send(imp::Inner::create(app_for_thread, position, margin));
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
    pub fn new(_position: OverlayPositionConfig, _margin: i32) -> Result<Self, String> {
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
        if self.running.load(Ordering::SeqCst) {
            #[cfg(target_os = "macos")]
            self.inner.hide();
        }
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

    /// NSPanel resize is a no-op.
    ///
    /// The NSPanel backend uses a fixed `PILL_WIDTH × PILL_HEIGHT` panel;
    /// aquarium-style per-theme resizing is handled by the webview backend.
    /// This method exists only to satisfy the `OverlayBackend` trait and
    /// compile on macOS.
    fn resize_for_theme(&self, _size: Option<(u32, u32)>) {
        #[cfg(target_os = "macos")]
        let _ = _size;
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
    use super::{
        events, OverlayPositionConfig, OverlayState, OVERLAY_PANEL_LABEL, PILL_HEIGHT, PILL_WIDTH,
    };
    use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Position, Size, WebviewUrl};
    use tauri_nspanel::{
        tauri_panel, CollectionBehavior, ManagerExt, PanelBuilder, PanelLevel,
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
        /// Resolve initial (x, y) for the pill based on the active monitor and
        /// the user's `PositionConfig` + `margin`. Returns LOGICAL GLOBAL pixels
        /// (includes the monitor's position offset, which matters when external
        /// displays are arranged to the left/right of the built-in one).
        ///
        /// Mirrors Handy's `calculate_overlay_position` (RecordingOverlay.rs).
        fn compute_initial_position(
            app: &AppHandle,
            position: OverlayPositionConfig,
            margin: i32,
        ) -> (f64, f64) {
            let monitor = app
                .get_webview_window("main")
                .and_then(|w| w.current_monitor().ok().flatten())
                .or_else(|| {
                    app.available_monitors()
                        .ok()
                        .and_then(|m| m.into_iter().next())
                });
            let Some(monitor) = monitor else {
                return (100.0, 100.0);
            };
            // Tauri returns physical pixels for monitor.position()/size();
            // dividing by scale yields logical coords. Both numbers need it,
            // including the monitor's top-left offset which is non-zero for
            // any monitor arranged to the left/above the built-in display.
            let scale = monitor.scale_factor().max(1.0);
            let phys_size = monitor.size();
            let phys_pos = monitor.position();
            let mx = phys_pos.x as f64 / scale;
            let my = phys_pos.y as f64 / scale;
            let mw = (phys_size.width as f64 / scale) as i32;
            let mh = (phys_size.height as f64 / scale) as i32;
            let (local_x, local_y) = position.calculate(
                mw,
                mh,
                PILL_WIDTH as i32,
                PILL_HEIGHT as i32,
                margin,
            );
            // Translate monitor-local coordinates into the global desktop space.
            (mx + local_x as f64, my + local_y as f64)
        }

        /// Build a borderless webview, convert it to an `NSPanel`, and apply
        /// the desired collection behaviour.
        pub fn create(
            app: AppHandle,
            position: OverlayPositionConfig,
            margin: i32,
        ) -> Result<Self, String> {
            let label = OVERLAY_PANEL_LABEL.to_string();

            let (init_x, init_y) = Self::compute_initial_position(&app, position, margin);

            // Reuse an existing panel if one is already registered (e.g. across
            // backend reinit). Re-apply position in case settings changed.
            if app.get_webview_panel(&label).is_ok() {
                if let Some(window) = app.get_webview_window(&label) {
                    let _ = window.set_position(tauri::LogicalPosition::new(init_x, init_y));
                    let _ = window.set_size(tauri::LogicalSize::new(
                        PILL_WIDTH as f64,
                        PILL_HEIGHT as f64,
                    ));
                }
                return Ok(Inner::Live { app, label });
            }

            // Match Handy's PanelBuilder usage exactly (RecordingOverlay.rs).
            // Key choices proven to render on macOS in Handy:
            //   - PanelLevel::Status (higher than Floating; survives Mission
            //     Control / Spaces)
            //   - transparent(true) at BOTH PanelBuilder and window builder
            //   - has_shadow(false)
            //   - corner_radius(0.0) (CSS handles visual radius)
            //   - no_activate(true) so the panel never steals focus
            //   - panel.hide() after build — displayed via window.show() later
            let panel = PanelBuilder::<_, RecordingOverlayPanel>::new(&app, &label)
                .url(WebviewUrl::App("overlay.html".into()))
                .title("Recording Overlay")
                .position(Position::Logical(LogicalPosition {
                    x: init_x,
                    y: init_y,
                }))
                .level(PanelLevel::Status)
                .size(Size::Logical(LogicalSize {
                    width: PILL_WIDTH as f64,
                    height: PILL_HEIGHT as f64,
                }))
                .has_shadow(false)
                .transparent(true)
                // no_activate(false) — with true, PanelBuilder temporarily sets
                // NSApplicationActivationPolicy::Prohibited which can leave
                // the entire voice app marked hidden=true. The panel window
                // still appears in CGWindowList but AppKit refuses to paint
                // its content. Skipping the trick keeps the app activated
                // long enough for the panel to receive a draw cycle.
                .no_activate(false)
                .corner_radius(0.0)
                .with_window(|w| {
                    let w = w.decorations(false).transparent(true);
                    #[cfg(debug_assertions)]
                    let w = w.devtools(true);
                    w
                })
                .collection_behavior(
                    CollectionBehavior::new()
                        .can_join_all_spaces()
                        .full_screen_auxiliary(),
                )
                .build()
                .map_err(|e| format!("Failed to build overlay panel: {e}"))?;

            // Always-visible pill (user requirement). Calling
            // `panel.show_and_make_key()` here is what gives the panel
            // its first draw cycle. Without this, the NSWindow is
            // registered in CGWindowList but never paints content and
            // screencapture returns "could not create image from window".
            panel.show_and_make_key();

            Ok(Inner::Live { app, label })
        }

        fn live(&self) -> Option<(&AppHandle, &str)> {
            match self {
                Inner::Live { app, label } => Some((app, label.as_str())),
                Inner::Unavailable => None,
            }
        }

        /// Dispatch a closure to the main thread (AppKit invariant).
        ///
        /// NSPanel show/hide and any NSWindow mutation MUST happen on the main
        /// thread or AppKit aborts the process with no Rust panic. We use
        /// `app.run_on_main_thread` which is a fire-and-forget queue — we
        /// intentionally don't wait for the closure to finish (avoids blocking
        /// the async caller). Closures only do thread-safe work: lookup the
        /// panel via `Manager::get_webview_panel` and call AppKit methods on it.
        fn on_main_thread<F: FnOnce(AppHandle) + Send + 'static>(app: &AppHandle, f: F) {
            let app_clone = app.clone();
            if let Err(e) = app.run_on_main_thread(move || f(app_clone)) {
                tracing::debug!("nspanel: run_on_main_thread dispatch failed: {e}");
            }
        }

        /// Emit to the overlay webview both via the window handle AND the
        /// app-wide bus (belt-and-suspenders). Some Tauri/tauri-nspanel
        /// builds silently drop events on panel-wrapped windows, but
        /// `app.emit` always reaches every webview listening for the event.
        fn emit_to_overlay<T: serde::Serialize + Clone>(
            app: &AppHandle,
            label: &str,
            event: &str,
            payload: &T,
        ) {
            let window_result = app
                .get_webview_window(label)
                .map(|w| w.emit(event, payload));
            let app_result = app.emit(event, payload);
            // Trace any failure so we can debug missing pill animation.
            match (window_result, app_result) {
                (Some(Err(e)), _) => {
                    tracing::warn!("nspanel: window.emit({event}) failed: {e}")
                }
                (_, Err(e)) => {
                    tracing::warn!("nspanel: app.emit({event}) failed: {e}")
                }
                _ => tracing::trace!("nspanel: emit {event} sent"),
            }
        }

        pub fn show(&self, state: OverlayState) {
            if let Some((app, label)) = self.live() {
                tracing::info!("nspanel: emit overlay state -> {state:?}");
                Self::emit_to_overlay(app, label, events::STATE, &state);
            }
        }

        pub fn hide(&self) {
            if let Some((app, label)) = self.live() {
                tracing::info!("nspanel: emit overlay state -> Idle (hide)");
                Self::emit_to_overlay(app, label, events::STATE, &OverlayState::Idle);
            }
        }

        pub fn send_audio_level(&self, level: f32) {
            if let Some((app, label)) = self.live() {
                Self::emit_to_overlay(app, label, events::AUDIO_LEVEL, &level);
            }
        }

        pub fn send_spectrum_bins(&self, bins: [f32; crate::audio::SPECTRUM_BARS]) {
            if let Some((app, label)) = self.live() {
                Self::emit_to_overlay(
                    app,
                    label,
                    events::SPECTRUM_BINS,
                    &bins.to_vec(),
                );
            }
        }

        pub fn update_position(&self, x: i32, y: i32, width: u32, height: u32) {
            if let Some((app, label)) = self.live() {
                let label = label.to_string();
                Self::on_main_thread(app, move |app| {
                    if let Some(window) = app.get_webview_window(&label) {
                        let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
                        let _ = window.set_size(tauri::PhysicalSize::new(width, height));
                    }
                });
            }
        }

        pub fn set_theme(&self, theme_name: &str) {
            if let Some((app, label)) = self.live() {
                Self::emit_to_overlay(
                    app,
                    label,
                    events::THEME,
                    &theme_name.to_string(),
                );
            }
        }

        pub fn shutdown(&mut self) {
            // Do NOT hide/close the panel here. The panel window is a
            // singleton reused across reinit (e.g. theme change). Hiding it
            // on the main-thread queue would race with the new backend's
            // reuse+show and leave the overlay invisible. The OverlayManager
            // hides the window explicitly on the enabled -> disabled
            // transition. The panel stays registered for reuse.
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
        let result =
            NsPanelOverlay::new(OverlayPositionConfig::default(), 0);
        assert!(result.is_err(), "expected stub error on non-macOS");
        let overlay = NsPanelOverlay::unavailable();
        assert!(!overlay.is_running());
    }

    /// Verify that bottom-anchored positions keep the bottom edge fixed
    /// when the window height grows — the window expands upward, not
    /// downward off-screen.
    #[test]
    fn test_bottom_anchor_resize_grows_upward() {
        use crate::overlay_native::OverlayPositionConfig;
        let mw: i32 = 1920;
        let mh: i32 = 1080;
        let margin: i32 = 8;
        let w: i32 = 172;

        // 36px pill (default)
        let (_, y36) =
            OverlayPositionConfig::BottomCenter.calculate(mw, mh, w, 36, margin);
        // 160px aquarium
        let (_, y160) =
            OverlayPositionConfig::BottomCenter.calculate(mw, mh, w, 160, margin);

        // y160 must be smaller (higher on screen) — window grows upward
        assert!(
            y160 < y36,
            "bottom-anchored: y160 ({y160}) should be less than y36 ({y36})"
        );
        // Bottom edges must be equal (fixed anchor)
        assert_eq!(
            y36 + 36,
            y160 + 160,
            "bottom-anchored: bottom edge must stay fixed"
        );

        // Also verify for BottomLeft and BottomRight
        let (_, y_bl_36) =
            OverlayPositionConfig::BottomLeft.calculate(mw, mh, w, 36, margin);
        let (_, y_bl_160) =
            OverlayPositionConfig::BottomLeft.calculate(mw, mh, w, 160, margin);
        assert_eq!(y_bl_36 + 36, y_bl_160 + 160);

        let (_, y_br_36) =
            OverlayPositionConfig::BottomRight.calculate(mw, mh, w, 36, margin);
        let (_, y_br_160) =
            OverlayPositionConfig::BottomRight.calculate(mw, mh, w, 160, margin);
        assert_eq!(y_br_36 + 36, y_br_160 + 160);
    }
}
