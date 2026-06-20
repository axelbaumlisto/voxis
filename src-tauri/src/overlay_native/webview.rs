//! Cross-platform Tauri-webview overlay backend.
//!
//! Renders the same `overlay.html` (Handy pill UI) as the macOS NSPanel
//! backend, but using a **plain Tauri `WebviewWindow`** — no NSPanel,
//! no Cocoa, no private-API tricks. Works on:
//!
//!   * Linux  (webkit2gtk via Tauri)
//!   * Windows (WebView2 via Tauri)
//!   * macOS   (WKWebView via Tauri) — for parity / testing
//!
//! On macOS the [`nspanel`](super::nspanel) backend is still preferred
//! because it survives Mission Control / Spaces and refuses keyboard
//! focus. This backend is the chosen default everywhere else, replacing
//! the legacy egui subprocess / native overlay path for users who want
//! the Handy pill instead of the organic-ring family.
//!
//! ---- SOLID notes ----
//! * SRP: only window lifecycle + Tauri-event emission. All rendering
//!   logic is in the React/CSS bundle hosted by the webview.
//! * OCP: implements [`OverlayBackend`] so `create_overlay` swaps it in
//!   without touching the orchestrator.
//! * KISS: no IPC, no subprocess, no platform shims. Tauri does it all.

use super::backend::OverlayBackend;
use super::nspanel::{events, OVERLAY_PANEL_LABEL, PILL_HEIGHT, PILL_WIDTH};
use super::{OverlayPositionConfig, OverlayState};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl};

/// Cross-platform overlay backend backed by a plain Tauri `WebviewWindow`.
///
/// Construct with [`WebviewOverlay::new`] when an `AppHandle` is available.
/// All operations are non-blocking; the window itself lives inside the
/// Tauri runtime and is identified by [`OVERLAY_PANEL_LABEL`].
pub struct WebviewOverlay {
    running: Arc<AtomicBool>,
    app: AppHandle,
    label: String,
    /// User-configured position (e.g. BottomCenter). Used when resizing
    /// the window so the bottom edge stays anchored.
    position: OverlayPositionConfig,
    /// Margin from the screen edge, in logical pixels.
    margin: i32,
}

impl WebviewOverlay {
    /// Build the overlay window from `overlay.html` and place it according
    /// to `position` + `margin`. The window is created **invisible** so
    /// the WebKit/WebView2 content can finish loading before the user
    /// sees a flash of un-styled content; we re-show it via
    /// [`OverlayBackend::show`] once orchestrator transitions to recording
    /// — except we also call `window.show()` once eagerly after creation
    /// because, as the user requirement says, the pill must be visible
    /// at idle too (only the icon, transparent background).
    pub fn new(
        app: AppHandle,
        position: OverlayPositionConfig,
        margin: i32,
    ) -> Result<Self, String> {
        let label = OVERLAY_PANEL_LABEL.to_string();

        // Reuse an existing webview if registered (idempotent reinit).
        if app.get_webview_window(&label).is_some() {
            let (x, y) = compute_initial_position(&app, position, margin);
            if let Some(w) = app.get_webview_window(&label) {
                let _ = w.set_position(LogicalPosition::new(x, y));
                let _ = w.set_size(LogicalSize::new(
                    PILL_WIDTH as f64,
                    PILL_HEIGHT as f64,
                ));
                let _ = w.show();
            }
            return Ok(Self {
                running: Arc::new(AtomicBool::new(true)),
                app,
                label,
                position,
                margin,
            });
        }

        let (init_x, init_y) = compute_initial_position(&app, position, margin);

        // WebviewWindow::builder MUST run on the main thread on macOS (AppKit
        // invariant) and is safer to dispatch there everywhere. Use the same
        // mpsc-rendezvous pattern as NSPanel to be uniform.
        let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
        let label_for_thread = label.clone();
        let app_for_thread = app.clone();
        let dispatched = app.run_on_main_thread(move || {
            let result = build_overlay_window(
                &app_for_thread,
                &label_for_thread,
                init_x,
                init_y,
            );
            let _ = tx.send(result);
        });
        if let Err(e) = dispatched {
            return Err(format!("run_on_main_thread dispatch failed: {e}"));
        }
        rx.recv()
            .map_err(|e| format!("main-thread webview result channel closed: {e}"))??;

        Ok(Self {
            running: Arc::new(AtomicBool::new(true)),
            app,
            label,
            position,
            margin,
        })
    }

    /// Emit `event` with `payload` to both the panel window (targeted) and
    /// the app-wide bus (belt-and-suspenders).
    fn emit<T: serde::Serialize + Clone>(&self, event: &str, payload: &T) {
        let window_result = self
            .app
            .get_webview_window(&self.label)
            .map(|w| w.emit(event, payload));
        let app_result = self.app.emit(event, payload);
        match (window_result, app_result) {
            (Some(Err(e)), _) => {
                tracing::warn!("webview: window.emit({event}) failed: {e}")
            }
            (_, Err(e)) => tracing::warn!("webview: app.emit({event}) failed: {e}"),
            _ => tracing::trace!("webview: emit {event} sent"),
        }
    }
}

/// Build a new transparent, borderless, always-on-top webview window for
/// the pill. Runs on the main thread.
fn build_overlay_window(
    app: &AppHandle,
    label: &str,
    x: f64,
    y: f64,
) -> Result<(), String> {
    // `inner_size` and `position` accept f64 in logical pixels; we use
    // explicit min_inner_size + max_inner_size to pin the pill to the
    // Handy 172×36 footprint on Linux/GTK which otherwise can ignore
    // size hints for transparent windows.
    // `mut` is only needed for the debug-only devtools toggle below.
    #[cfg_attr(not(debug_assertions), allow(unused_mut))]
    let mut builder = tauri::WebviewWindowBuilder::new(
        app,
        label,
        WebviewUrl::App("overlay.html".into()),
    )
    .title("Recording Overlay")
    .inner_size(PILL_WIDTH as f64, PILL_HEIGHT as f64)
    .min_inner_size(PILL_WIDTH as f64, PILL_HEIGHT as f64)
    .max_inner_size(PILL_WIDTH as f64, PILL_HEIGHT as f64)
    .position(x, y)
    .decorations(false)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .transparent(true)
    .visible(false);

    // On Linux click-through is provided by GTK; on Windows by WS_EX_LAYERED.
    // Tauri exposes the cross-platform shim through `WebviewWindowBuilder`
    // method `accept_first_mouse(false)` on macOS — irrelevant for Linux/Win.
    #[cfg(debug_assertions)]
    {
        builder = builder.devtools(true);
    }

    let window = builder
        .build()
        .map_err(|e| format!("Failed to build overlay webview: {e}"))?;

    // Some compositors (notably GNOME/Mutter, Plasma/KWin) ignore inner_size
    // for borderless transparent windows during build. Re-assert both size
    // and position explicitly post-build so the pill always lands at exactly
    // PILL_WIDTH x PILL_HEIGHT.
    let _ = window.set_size(LogicalSize::new(
        PILL_WIDTH as f64,
        PILL_HEIGHT as f64,
    ));
    let _ = window.set_position(LogicalPosition::new(x, y));

    // Tauri upstream #6125 / WebKitGTK hardcodes a 200×200 minimum natural
    // size on the WebKitWebView widget; wry packs it into a GtkBox without
    // overriding the size request, so the GTK window inherits the child's
    // minimum and WM_NORMAL_HINTS reports "minimum size: 200 by 200".
    //
    // Lift that minimum by setting size-request = (1, 1) directly on the
    // webkit2gtk widget inside `with_webview` (which dispatches on the GTK
    // main thread). Then resize the toplevel GTK window in the same callback
    // so the compositor sees the correct geometry immediately.
    #[cfg(target_os = "linux")]
    {
        let _ = window.with_webview(|webview| {
            use gtk::prelude::{Cast, GtkWindowExt, WidgetExt};
            let wv = webview.inner();
            wv.set_size_request(1, 1);
            // Also force-resize the toplevel GTK window in case the
            // compositor has already cached the 200×200 constraints.
            if let Some(toplevel) = wv.toplevel() {
                if let Ok(gtk_window) = toplevel.downcast::<gtk::Window>() {
                    gtk_window.resize(
                        PILL_WIDTH as i32,
                        PILL_HEIGHT as i32,
                    );
                    // Never steal keyboard focus from the active app: a click on
                    // the pill still delivers the pointer event to WebKit (so
                    // click-to-dictate works), but the WM must not transfer input
                    // focus here, or auto-typed text would no longer reach the
                    // user's focused window.
                    gtk_window.set_accept_focus(false);
                    gtk_window.set_can_focus(false);
                    gtk_window.set_focus_on_map(false);
                    gtk_window.set_type_hint(gtk::gdk::WindowTypeHint::Dock);
                }
            }
        });
        // Re-assert via Tauri's own set_size after the GTK-level fix so
        // the inner webview layout is also notified.
        let _ = window.set_size(LogicalSize::new(
            PILL_WIDTH as f64,
            PILL_HEIGHT as f64,
        ));
    }

    // Now that the GTK focus policy has been applied (before show),
    // make the pill visible on all platforms.
    let _ = window.show();

    Ok(())
}

/// Resolve initial (x, y) for the pill based on the active monitor and
/// the user's `PositionConfig` + `margin`. Returns LOGICAL GLOBAL pixels
/// (includes the monitor's position offset so external displays work).
///
/// Delegates to `compute_position_for` with `PILL_WIDTH × PILL_HEIGHT`.
fn compute_initial_position(
    app: &AppHandle,
    position: OverlayPositionConfig,
    margin: i32,
) -> (f64, f64) {
    compute_position_for(app, position, margin, PILL_WIDTH, PILL_HEIGHT)
}

/// Resolve (x, y) for the overlay window at size `w × h`.
/// Larger `h` moves the top upward, keeping the bottom edge fixed — the
/// window grows toward the top of the screen, not downward off-screen.
///
/// Uses the work area (desktop without panels/taskbars/docks) so bottom
/// positions sit above the panel.
pub(crate) fn compute_position_for(
    app: &AppHandle,
    position: OverlayPositionConfig,
    margin: i32,
    w: u32,
    h: u32,
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
    let scale = monitor.scale_factor().max(1.0);
    // Use the work area (desktop without panels / taskbars / docks)
    // so bottom positions sit above the panel, not behind it.
    // work_area().position and .size are in physical pixels,
    // same coordinate space as monitor.position()/size().
    let wa = monitor.work_area();
    let phys_size = wa.size;
    let phys_pos = wa.position;
    let mx = phys_pos.x as f64 / scale;
    let my = phys_pos.y as f64 / scale;
    let mw = (phys_size.width as f64 / scale) as i32;
    let mh = (phys_size.height as f64 / scale) as i32;
    let (local_x, local_y) =
        position.calculate(mw, mh, w as i32, h as i32, margin);
    (mx + local_x as f64, my + local_y as f64)
}

/// Apply a theme-declared overlay size to the OS window, bottom-anchored.
///
/// Re-applies min/max size + set_size + recomputed bottom-anchored
/// position. On Linux, re-runs the WebKitGTK `size_request(1,1)` +
/// `toplevel.resize` lift so sizes below the 200×200 GTK default are
/// not clamped.
///
/// The focus policy (`set_accept_focus(false)`, `set_can_focus(false)`,
/// `set_focus_on_map(false)`, `Dock` type hint) is already applied at
/// `build_overlay_window` time. This function re-asserts it on Linux as
/// a belt-and-suspenders measure — calling `set_accept_focus(false)` on
/// an already-unfocusable window is a harmless no-op.
pub(crate) fn apply_overlay_size(
    window: &tauri::WebviewWindow,
    app: &AppHandle,
    position: OverlayPositionConfig,
    margin: i32,
    w: u32,
    h: u32,
) {
    let _ = window.set_min_size(Some(LogicalSize::new(w as f64, h as f64)));
    let _ = window.set_max_size(Some(LogicalSize::new(w as f64, h as f64)));
    let _ = window.set_size(LogicalSize::new(w as f64, h as f64));

    // Recompute bottom-anchored position so the window grows upward,
    // keeping the bottom edge fixed.
    let (x, y) = compute_position_for(app, position, margin, w, h);
    let _ = window.set_position(LogicalPosition::new(x, y));

    // On Linux, lift the WebKitGTK 200×200 default natural minimum so
    // the compositor respects per-theme sizes smaller than that.
    #[cfg(target_os = "linux")]
    {
        let _ = window.with_webview(move |webview| {
            use gtk::prelude::{Cast, GtkWindowExt, WidgetExt};
            let wv = webview.inner();
            wv.set_size_request(1, 1);
            if let Some(toplevel) = wv.toplevel() {
                if let Ok(gtk_window) = toplevel.downcast::<gtk::Window>() {
                    gtk_window.resize(w as i32, h as i32);
                    // Re-assert focus policy (already applied at build;
                    // these are harmless no-ops on an already-
                    // unfocusable window).
                    gtk_window.set_accept_focus(false);
                    gtk_window.set_can_focus(false);
                    gtk_window.set_focus_on_map(false);
                    gtk_window.set_type_hint(gtk::gdk::WindowTypeHint::Dock);
                }
            }
        });
        // Re-assert via Tauri's own set_size after the GTK-level fix.
        let _ = window.set_size(LogicalSize::new(w as f64, h as f64));
    }
}

impl OverlayBackend for WebviewOverlay {
    fn show(&self, state: OverlayState) {
        if !self.running.load(Ordering::SeqCst) {
            return;
        }
        tracing::info!("webview: emit overlay state -> {state:?}");
        self.emit(events::STATE, &state);
        // Ensure the OS window is actually shown — Tauri may have kept it
        // hidden until the WebKit page settled.
        if let Some(w) = self.app.get_webview_window(&self.label) {
            let _ = w.show();
        }
    }

    fn hide(&self) {
        if !self.running.load(Ordering::SeqCst) {
            return;
        }
        // We don't actually hide the OS window — the pill must remain
        // visible at idle (only the small icon shows). Just emit Idle
        // so the React app transitions to the idle state.
        tracing::info!("webview: emit overlay state -> Idle (hide)");
        self.emit(events::STATE, &OverlayState::Idle);
    }

    fn send_audio_level(&self, level: f32) {
        if !self.running.load(Ordering::SeqCst) {
            return;
        }
        self.emit(events::AUDIO_LEVEL, &level);
    }

    fn send_spectrum_bins(&self, bins: [f32; crate::audio::SPECTRUM_BARS]) {
        if !self.running.load(Ordering::SeqCst) {
            return;
        }
        self.emit(events::SPECTRUM_BINS, &bins.to_vec());
    }

    fn update_position(&self, x: i32, y: i32, width: u32, height: u32) {
        if !self.running.load(Ordering::SeqCst) {
            return;
        }
        let label = self.label.clone();
        let app = self.app.clone();
        let _ = app.clone().run_on_main_thread(move || {
            if let Some(w) = app.get_webview_window(&label) {
                let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
                let _ = w.set_size(tauri::PhysicalSize::new(width, height));
            }
        });
    }

    fn set_theme(&self, theme_name: &str) {
        if !self.running.load(Ordering::SeqCst) {
            return;
        }
        self.emit(events::THEME, &theme_name.to_string());
    }

    fn resize_for_theme(&self, size: Option<(u32, u32)>) {
        if !self.running.load(Ordering::SeqCst) {
            return;
        }
        let (w, h) = size.unwrap_or((PILL_WIDTH, PILL_HEIGHT));
        tracing::info!("webview: resize_for_theme -> {w}x{h}");
        if let Some(window) = self.app.get_webview_window(&self.label) {
            apply_overlay_size(
                &window,
                &self.app,
                self.position,
                self.margin,
                w,
                h,
            );
        }
    }

    fn shutdown(&mut self) {
        // ONLY mark this backend instance inactive. Do NOT touch the OS
        // window here.
        //
        // The overlay window is a singleton keyed by `label` and is reused
        // across reinit (e.g. theme change). `reinit` does shutdown(old) +
        // create(new), and the old backend is also dropped (Drop ->
        // shutdown). If shutdown closed/hid the window, those hides —
        // dispatched async to the main thread — would run AFTER the new
        // backend has already reused and shown the same window on the
        // caller thread, leaving the overlay invisible.
        //
        // Actually hiding the window when the overlay is disabled is the
        // OverlayManager's job (`hide_overlay_window`), invoked only on the
        // enabled -> disabled transition.
        self.running.store(false, Ordering::SeqCst);
    }

    fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }
}

impl Drop for WebviewOverlay {
    fn drop(&mut self) {
        self.shutdown();
    }
}
