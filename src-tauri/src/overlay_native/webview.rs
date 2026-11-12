//! Cross-platform Tauri-webview overlay backend.
//!
//! Renders `overlay.html` (Handy pill UI) using a **plain Tauri
//! `WebviewWindow`** — no NSPanel, no Cocoa subclass, no private-API
//! tricks. This is the single overlay rendering path on every platform:
//!
//!   * Linux  (webkit2gtk via Tauri)
//!   * Windows (WebView2 via Tauri)
//!   * macOS   (WKWebView via Tauri)
//!
//! On macOS the important overlay behaviours (never steal keyboard focus,
//! survive Mission Control / Spaces, float over fullscreen) are preserved
//! via `.focusable(false)` on the builder plus a thin AppKit `NSWindow`
//! tuning helper ([`apply_macos_overlay_window_tuning`]) — no separate
//! NSPanel backend. This backend replaced the legacy egui subprocess /
//! native overlay path.
//!
//! ---- SOLID notes ----
//! * SRP: only window lifecycle + Tauri-event emission. All rendering
//!   logic is in the React/CSS bundle hosted by the webview.
//! * OCP: implements [`OverlayBackend`] so `create_overlay` swaps it in
//!   without touching the orchestrator.
//! * KISS: no IPC, no subprocess, no platform shims. Tauri does it all.

use super::backend::OverlayBackend;
use super::{OverlayPositionConfig, OverlayState};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl};

use crate::orchestrator::overlay_resize::{MAX_OVERLAY_SIZE as MAX_OVERLAY_EDGE, MIN_OVERLAY_SIZE as MIN_OVERLAY_EDGE};

/// Fixed 172×36 pill canvas. The panel hosts the React ThemeHost code-theme
/// overlay, and the theme-engine contract uses this fixed size.
pub const PILL_WIDTH: u32 = 320;
pub const PILL_HEIGHT: u32 = 108;

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
    /// Pointer entered (`true`) / left (`false`) the overlay window, from GTK
    /// enter/leave-notify. The frontend settle-debounces it to reveal/hide the
    /// drag/resize handles without flapping.
    pub const POINTER_INSIDE: &str = "overlay://pointer-inside";
}

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
    /// User-dragged absolute position (logical px). When `Some`, overrides
    /// the computed `position` + `margin` placement.
    custom_pos: Option<(i32, i32)>,
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
        custom_pos: Option<(i32, i32)>,
        init_size: Option<(u32, u32)>,
    ) -> Result<Self, String> {
        let label = OVERLAY_PANEL_LABEL.to_string();
        let (w, h) = init_size.unwrap_or((PILL_WIDTH, PILL_HEIGHT));

        // Start the pointer-inside poller (once) so the drag/resize handles
        // reveal on hover and hide on leave — reliably, unlike GTK crossing
        // events / DOM :hover in this borderless Dock webview.
        #[cfg(target_os = "linux")]
        start_overlay_pointer_poll(&app);

        // Reuse an existing webview ONLY if it is already the right size.
        // KWin/XWayland honours build-time geometry hints but ignores runtime
        // resizes of a Dock window, so a size change can't be applied in place
        // — the window must be destroyed and rebuilt at the new (w × h). When
        // the size already matches (the common reinit, e.g. a same-size theme
        // swap or a position/margin change), we reuse it and just reposition.
        if let Some(win) = app.get_webview_window(&label) {
            if window_logical_size_matches(&win, w, h) {
                let (x, y) = resolve_initial_position(&app, position, margin, custom_pos);
                let _ = win.set_position(LogicalPosition::new(x, y));
                let _ = win.show();
                return Ok(Self {
                    running: Arc::new(AtomicBool::new(true)),
                    app,
                    label,
                    position,
                    margin,
                    custom_pos,
                });
            }
            // Size differs → fall through to destroy + rebuild below.
        }

        let (init_x, init_y) = resolve_initial_position(&app, position, margin, custom_pos);

        // WebviewWindow::builder MUST run on the main thread on macOS (AppKit
        // invariant) and is safer to dispatch there everywhere. Use an
        // mpsc-rendezvous to wait for the build result. The window is BUILT at
        // (w × h): KWin/XWayland honours build-time geometry hints but ignores
        // later runtime resizes of a Dock window, so the initial size must be
        // right at build.
        let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
        let label_for_thread = label.clone();
        let app_for_thread = app.clone();
        let dispatched = app.run_on_main_thread(move || {
            // If a wrong-sized window exists, destroy it synchronously first so
            // the rebuild can reclaim the `overlay` label and get fresh
            // build-time geometry hints. `destroy()` (unlike `close()`) removes
            // the window immediately, so there's no label-already-exists race.
            if let Some(old) = app_for_thread.get_webview_window(&label_for_thread) {
                let _ = old.destroy();
            }
            let result = build_overlay_window(
                &app_for_thread,
                &label_for_thread,
                init_x,
                init_y,
                w,
                h,
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
            custom_pos,
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

/// Spawn (once) a background poller that reveals/hides the overlay handles.
///
/// Every crossing-event scheme failed on this borderless Dock webview: DOM
/// pointermove/:hover never arrive, the WebView child gets ENTER but not LEAVE,
/// and a glib timeout only ticks while the overlay already has GTK events. So a
/// std thread samples the pointer vs the overlay rect on a fixed interval and
/// wakes the Tauri loop with `run_on_main_thread` (which fires even when idle,
/// unlike a glib timeout). Emits `overlay://pointer-inside` only on a real
/// transition; a sampled boolean cannot flap.
#[cfg(target_os = "linux")]
fn start_overlay_pointer_poll(app: &AppHandle) {
    use std::sync::Once;
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let app = app.clone();
        let latch = std::sync::Arc::new(AtomicBool::new(false));
        std::thread::spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_millis(180));
            let app_main = app.clone();
            let latch_main = latch.clone();
            let _ = app.run_on_main_thread(move || {
                match overlay_pointer_inside(&app_main) {
                    Some(now) => {
                        if now != latch_main.swap(now, Ordering::SeqCst) {
                            tracing::info!("overlay POLL inside -> {now}");
                            let _ = app_main.emit(events::POINTER_INSIDE, now);
                        }
                    }
                    None => tracing::info!("overlay POLL none"),
                }
            });
        });
    });
}

/// `Some(true/false)` when the global pointer is inside / outside the overlay
/// window's rect; `None` if anything needed to decide is unavailable. Must run
/// on the GTK main thread (GDK access).
#[cfg(target_os = "linux")]
fn overlay_pointer_inside(app: &AppHandle) -> Option<bool> {
    use gtk::gdk::prelude::{DeviceExt, SeatExt};
    let win = app.get_webview_window(OVERLAY_PANEL_LABEL)?;
    let pos = win.outer_position().ok()?;
    let size = win.outer_size().ok()?;
    let pointer = gtk::gdk::Display::default()?.default_seat()?.pointer()?;
    let (_, px, py) = pointer.position();
    let inside = px >= pos.x
        && py >= pos.y
        && px < pos.x + size.width as i32
        && py < pos.y + size.height as i32;
    tracing::info!(
        "overlay POLL ptr={px},{py} win={},{} {}x{} inside={inside}",
        pos.x, pos.y, size.width, size.height
    );
    Some(inside)
}

/// Build a new transparent, borderless, always-on-top webview window for
/// the pill. Runs on the main thread.
fn build_overlay_window(
    app: &AppHandle,
    label: &str,
    x: f64,
    y: f64,
    w: u32,
    h: u32,
) -> Result<(), String> {
    // `inner_size` and `position` accept f64 in logical pixels; we use
    // explicit min_inner_size + max_inner_size to pin the window to the
    // theme footprint. This matters on Linux/GTK + KWin, which HONOURS the
    // build-time geometry hints but IGNORES later runtime resizes of a Dock
    // window — so the only reliable way to size the overlay is to build the
    // window at the right (w × h) and rebuild it when the theme size changes.
    // `mut` is only needed for the debug-only devtools toggle below.
    #[cfg_attr(not(debug_assertions), allow(unused_mut))]
    let mut builder = tauri::WebviewWindowBuilder::new(
        app,
        label,
        WebviewUrl::App("overlay.html".into()),
    )
    .title("Recording Overlay")
    .inner_size(w as f64, h as f64)
    // NOT pinned to the footprint any more: the overlay is resizable from its
    // bottom-right grip (user-chosen size persisted in `overlay.custom_w/h`),
    // so equal min/max would clamp every resize to zero. The window stays
    // `resizable(false)` — that only disables OS-drawn borders/gestures; our
    // own grip drives `set_size`, exactly like `resize_for_theme` already did.
    .min_inner_size(MIN_OVERLAY_EDGE as f64, MIN_OVERLAY_EDGE as f64)
    .max_inner_size(MAX_OVERLAY_EDGE as f64, MAX_OVERLAY_EDGE as f64)
    .position(x, y)
    .decorations(false)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    // HARD no-focus-steal guarantee on macOS: Tauri's window is a tao subclass
    // that overrides `canBecomeKeyWindow` to return the `focusable` ivar, so
    // `.focusable(false)` makes `[window canBecomeKeyWindow]` return NO (the
    // exact NSPanel nonactivating behaviour) via a safe, cross-platform API.
    // show()/makeKeyAndOrderFront then degrades to order-front — harmless.
    .focusable(false)
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
    // and position explicitly post-build so the window always lands at exactly
    // w × h.
    let _ = window.set_size(LogicalSize::new(w as f64, h as f64));
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
        let _ = window.with_webview(move |webview| {
            use gtk::prelude::{Cast, GtkWindowExt, WidgetExt};
            let wv = webview.inner();
            wv.set_size_request(1, 1);
            // Also force-resize the toplevel GTK window in case the
            // compositor has already cached the 200×200 constraints.
            if let Some(toplevel) = wv.toplevel() {
                if let Ok(gtk_window) = toplevel.downcast::<gtk::Window>() {
                    gtk_window.resize(w as i32, h as i32);
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
        let _ = window.set_size(LogicalSize::new(w as f64, h as f64));
    }

    // Now that the GTK focus policy has been applied (before show),
    // make the pill visible on all platforms.
    let _ = window.show();

    // macOS: apply the thin AppKit tuning (status level + all-Spaces /
    // over-fullscreen) for parity with the old NSPanel backend. Already on the
    // main thread here (build runs via run_on_main_thread).
    #[cfg(target_os = "macos")]
    apply_macos_overlay_window_tuning(&window);

    Ok(())
}

/// macOS-only: tune the overlay's native `NSWindow` so it floats above other
/// windows, survives Mission Control / Spaces, and shows over another app's
/// fullscreen space — matching the old NSPanel backend.
///
/// Focus-stealing is handled separately and more robustly by `.focusable(false)`
/// on the builder (hard `canBecomeKeyWindow = NO`), so this helper only touches
/// window level + collection behaviour. Tauri's own `always_on_top` maps to the
/// Floating(3) level and `set_visible_on_all_workspaces` only toggles
/// CanJoinAllSpaces, so we set the Status(25) level + FullScreenAuxiliary here.
///
/// These attributes persist on the NSWindow for its lifetime, so the reuse
/// fast-path does not need to re-apply them.
#[cfg(target_os = "macos")]
fn apply_macos_overlay_window_tuning(window: &tauri::WebviewWindow) {
    use objc2::{msg_send, sel};
    use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};

    let ptr = match window.ns_window() {
        Ok(p) if !p.is_null() => p,
        Ok(_) => {
            tracing::warn!("webview: ns_window() returned null; skipping macOS overlay tuning");
            return;
        }
        Err(e) => {
            tracing::warn!("webview: ns_window() failed ({e}); skipping macOS overlay tuning");
            return;
        }
    };

    // SAFETY: `ns_window()` returns the overlay window's live `NSWindow` id as a
    // `*mut c_void`. We only borrow it for two synchronous AppKit setter calls
    // on the main thread (the build path); we never take ownership or outlive
    // the borrow. The setters themselves are safe in objc2-app-kit 0.3.
    let ns: &NSWindow = unsafe { &*(ptr as *mut NSWindow) };
    // NSStatusWindowLevel (25): float above normal/floating windows and
    // survive Spaces / Mission Control.
    ns.setLevel(25);
    // Join every Space and render over another app's fullscreen space.
    ns.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary,
    );

    // Prevent the app from activating (coming to front) when the user clicks
    // the overlay pill. `canBecomeKeyWindow=false` (set via `.focusable(false)`)
    // stops key-focus theft, but a mouse-down on a plain NSWindow still ACTIVATES
    // the owning app — the nonactivating behaviour that NSPanel provides natively.
    // The private `-[NSWindow _setPreventsActivation:]` selector reproduces it on a
    // plain window. Guarded by `respondsToSelector:` so a future macOS that drops
    // the selector simply no-ops instead of crashing.
    //
    // SAFETY: same live main-thread NSWindow id; `respondsToSelector:` returns a
    // BOOL, and we only send `_setPreventsActivation:` when it is implemented.
    unsafe {
        let responds: bool = msg_send![ns, respondsToSelector: sel!(_setPreventsActivation:)];
        if responds {
            let _: () = msg_send![ns, _setPreventsActivation: true];
        } else {
            tracing::warn!(
                "webview: -[NSWindow _setPreventsActivation:] unavailable; \
                 overlay clicks may activate the app"
            );
        }
    }
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

/// True when `win`'s current inner size equals `(w, h)` in logical px.
/// Used to decide whether a reinit can reuse the window or must rebuild it at
/// a new size (KWin honours build-time hints, not runtime resizes).
fn window_logical_size_matches(win: &tauri::WebviewWindow, w: u32, h: u32) -> bool {
    match (win.inner_size(), win.scale_factor()) {
        (Ok(sz), Ok(scale)) => {
            let scale = scale.max(1.0);
            let lw = (sz.width as f64 / scale).round() as u32;
            let lh = (sz.height as f64 / scale).round() as u32;
            lw == w && lh == h
        }
        _ => false,
    }
}

/// Resolve the overlay's initial (x, y): the user-dragged `custom_pos`
/// (clamped to the monitor) when set, otherwise the configured placement.
fn resolve_initial_position(
    app: &AppHandle,
    position: OverlayPositionConfig,
    margin: i32,
    custom_pos: Option<(i32, i32)>,
) -> (f64, f64) {
    match custom_pos {
        Some((x, y)) => clamp_point_to_monitor(app, x as f64, y as f64, PILL_WIDTH, PILL_HEIGHT),
        None => compute_initial_position(app, position, margin),
    }
}

/// Clamp a top-left (x, y) in logical px so a `w Ã h` window stays fully on
/// the primary/main monitor. Mirrors the clamp in `compute_position_for`.
pub(crate) fn clamp_point_to_monitor(
    app: &AppHandle,
    x: f64,
    y: f64,
    w: u32,
    h: u32,
) -> (f64, f64) {
    let monitor = app
        .get_webview_window("main")
        .and_then(|win| win.current_monitor().ok().flatten())
        .or_else(|| {
            app.available_monitors()
                .ok()
                .and_then(|m| m.into_iter().next())
        });
    let Some(monitor) = monitor else {
        return (x.max(0.0), y.max(0.0));
    };
    let scale = monitor.scale_factor().max(1.0);
    let fp = monitor.position();
    let fs = monitor.size();
    let fx = fp.x as f64 / scale;
    let fy = fp.y as f64 / scale;
    let fw = (fs.width as f64 / scale) as i32;
    let fh = (fs.height as f64 / scale) as i32;
    let cx = x.clamp(fx, fx + (fw - w as i32).max(0) as f64);
    let cy = y.clamp(fy, fy + (fh - h as i32).max(0) as f64);
    (cx, cy)
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

    // Clamp to the FULL monitor bounds (not the work area): a negative margin
    // deliberately pushes the overlay past the work area (over the Dock /
    // taskbar zone), which is fine — but it must never slide off the physical
    // screen. With margin=-30 and BottomCenter the pill bottom lands exactly
    // on the screen's bottom edge instead of 30px below it (clipped).
    let full_pos = monitor.position();
    let full_size = monitor.size();
    let fx = full_pos.x as f64 / scale;
    let fy = full_pos.y as f64 / scale;
    let fw = (full_size.width as f64 / scale) as i32;
    let fh = (full_size.height as f64 / scale) as i32;
    let x = (mx + local_x as f64)
        .clamp(fx, fx + (fw - w as i32).max(0) as f64);
    let y = (my + local_y as f64)
        .clamp(fy, fy + (fh - h as i32).max(0) as f64);
    (x, y)
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
                    // CRITICAL: the window was built with min_inner_size ==
                    // max_inner_size == PILL (320×108), which bakes fixed
                    // WM_NORMAL_HINTS (min==max). Tauri's set_min_size/
                    // set_max_size above do NOT update those GTK geometry
                    // hints, so KWin/XWayland keeps enforcing 320×108 and the
                    // window never shrinks to the theme size (base_size moves
                    // but min/max don't). Re-pin the hints to (w, h) here so
                    // the compositor actually resizes the window.
                    let geo = gtk::gdk::Geometry::new(
                        w as i32, // min_width
                        h as i32, // min_height
                        w as i32, // max_width
                        h as i32, // max_height
                        w as i32, // base_width
                        h as i32, // base_height
                        1,        // width_inc
                        1,        // height_inc
                        0.0,      // min_aspect
                        0.0,      // max_aspect
                        gtk::gdk::Gravity::NorthWest,
                    );
                    gtk_window.set_geometry_hints(
                        None::<&gtk::Widget>,
                        Some(&geo),
                        gtk::gdk::WindowHints::MIN_SIZE | gtk::gdk::WindowHints::MAX_SIZE,
                    );
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
        crate::diagnostics::breadcrumbs::sites::overlay_state_transition();
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
        crate::diagnostics::breadcrumbs::sites::overlay_state_transition();
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
            // A user-dragged position wins over the bottom-anchored placement
            // apply_overlay_size just applied: re-pin to the dragged spot
            // (clamped to the monitor for the new size) so a theme change
            // doesn't snap the overlay back to its configured corner.
            if let Some((cx, cy)) = self.custom_pos {
                let (x, y) =
                    clamp_point_to_monitor(&self.app, cx as f64, cy as f64, w, h);
                let _ = window.set_position(LogicalPosition::new(x, y));
            }
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

// ---- tests --------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

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
}
