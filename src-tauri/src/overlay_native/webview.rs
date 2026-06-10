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
    .visible(true);

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

    Ok(())
}

/// Resolve initial (x, y) for the pill based on the active monitor and
/// the user's `PositionConfig` + `margin`. Returns LOGICAL GLOBAL pixels
/// (includes the monitor's position offset so external displays work).
///
/// Kept local (not shared with nspanel.rs) to avoid pulling tauri-nspanel
/// types into this file. The math is identical and unit-tested via the
/// nspanel module.
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
        position.calculate(mw, mh, PILL_WIDTH as i32, PILL_HEIGHT as i32, margin);
    (mx + local_x as f64, my + local_y as f64)
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

    fn shutdown(&mut self) {
        self.running.store(false, Ordering::SeqCst);
        let label = self.label.clone();
        let app = self.app.clone();
        let _ = app.clone().run_on_main_thread(move || {
            if let Some(w) = app.get_webview_window(&label) {
                let _ = w.close();
            }
        });
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
