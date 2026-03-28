use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;

use cocoa::appkit::{
    NSApp, NSApplicationActivationPolicyAccessory, NSBackingStoreBuffered, NSColor,
    NSWindowStyleMask,
};
use cocoa::base::{id, nil, NO, YES};
use cocoa::foundation::{NSAutoreleasePool, NSPoint, NSRect, NSSize, NSString};
use objc::declare::ClassDecl;
use objc::runtime::{Class, Object, Sel, BOOL};
use objc::{class, msg_send, sel, sel_impl};
use voice_lib::overlay::themes::{ThemeLoader, VisualizationTheme};

use crate::overlay_bin::theme::create_theme_loader;
use crate::overlay_bin::types::{
    Command, OverlayState, WaveformLevels, BAR_COUNT, DEFAULT_HEIGHT, DEFAULT_MARGIN, DEFAULT_WIDTH,
};

mod draw;
mod ring;

/// Shared state for the overlay view.
struct ViewState {
    state: OverlayState,
    visible: bool,
    levels: WaveformLevels,
    pulse_phase: f32,
    animation_time: f32,
    speech_energy: f32,
    visual_theme: VisualizationTheme,
}

// Global state (required for Objective-C callbacks)
static mut VIEW_STATE: Option<*mut ViewState> = None;
static RUNNING: AtomicBool = AtomicBool::new(true);
static NEEDS_DISPLAY: AtomicBool = AtomicBool::new(false);
static PULSE_PHASE_BITS: AtomicU64 = AtomicU64::new(0);

fn create_view_class() -> &'static Class {
    static mut CLASS: Option<&'static Class> = None;
    static INIT: std::sync::Once = std::sync::Once::new();

    INIT.call_once(|| {
        let superclass = class!(NSView);
        let mut decl = ClassDecl::new("OverlayView", superclass).unwrap();
        unsafe {
            decl.add_method(
                sel!(drawRect:),
                draw_rect as extern "C" fn(&Object, Sel, NSRect),
            );
            decl.add_method(
                sel!(isOpaque),
                is_opaque as extern "C" fn(&Object, Sel) -> BOOL,
            );
            CLASS = Some(decl.register());
        }
    });

    unsafe { CLASS.unwrap() }
}

extern "C" fn is_opaque(_: &Object, _: Sel) -> BOOL {
    NO
}

extern "C" fn draw_rect(this: &Object, _: Sel, _: NSRect) {
    unsafe {
        let state = match VIEW_STATE.and_then(|p| p.as_ref()) {
            Some(s) => s,
            None => return,
        };

        let bounds: NSRect = msg_send![this, bounds];
        if !draw::clear_frame(bounds) {
            return;
        }

        if !state.visible {
            return;
        }

        let w = bounds.size.width;
        let h = bounds.size.height;

        draw::draw_builtin(state, w, h, PULSE_PHASE_BITS.load(Ordering::Relaxed));
    }
}

pub fn run(cmd_rx: mpsc::Receiver<Command>) {
    unsafe {
        let _pool = NSAutoreleasePool::new(nil);
        let app = NSApp();
        let _: () = msg_send![app, setActivationPolicy: NSApplicationActivationPolicyAccessory];

        let frame = NSRect::new(
            NSPoint::new(DEFAULT_MARGIN as f64, DEFAULT_MARGIN as f64),
            NSSize::new(DEFAULT_WIDTH as f64, DEFAULT_HEIGHT as f64),
        );

        let window: id = msg_send![class!(NSWindow), alloc];
        let window: id = msg_send![
            window,
            initWithContentRect:frame
            styleMask:NSWindowStyleMask::NSBorderlessWindowMask
            backing:NSBackingStoreBuffered
            defer:NO
        ];

        const COLLECTION_BEHAVIOR: u64 = 1 | 16 | 256;
        let _: () = msg_send![window, setCollectionBehavior: COLLECTION_BEHAVIOR];
        let _: () = msg_send![window, setLevel: 24i32];
        let _: () = msg_send![window, setOpaque: NO];
        let _: () = msg_send![window, setBackgroundColor: NSColor::clearColor(nil)];
        let _: () = msg_send![window, setIgnoresMouseEvents: YES];
        let _: () = msg_send![window, setHidesOnDeactivate: NO];

        let view: id = msg_send![create_view_class(), alloc];
        let view: id = msg_send![view, initWithFrame: frame];
        let _: () = msg_send![window, setContentView: view];
        let _: () = msg_send![window, makeKeyAndOrderFront: nil];

        let mut theme_loader: ThemeLoader = create_theme_loader();
        let mut state = Box::new(ViewState {
            state: OverlayState::Idle,
            visible: true,
            levels: WaveformLevels::new(BAR_COUNT),
            pulse_phase: 0.0,
            animation_time: 0.0,
            speech_energy: 0.0,
            visual_theme: theme_loader.get_theme("default"),
        });
        VIEW_STATE = Some(&mut *state as *mut ViewState);

        let heartbeat_path = std::env::var("OVERLAY_HEARTBEAT_FILE").ok();
        let mut last_heartbeat = std::time::Instant::now();

        while RUNNING.load(Ordering::SeqCst) {
            while let Ok(cmd) = cmd_rx.try_recv() {
                match cmd {
                    Command::Show(s) => {
                        state.state = s;
                        state.visible = true;
                        NEEDS_DISPLAY.store(true, Ordering::SeqCst);
                    }
                    Command::Hide => {
                        state.visible = false;
                        NEEDS_DISPLAY.store(true, Ordering::SeqCst);
                    }
                    Command::AudioLevel(l) => {
                        state.levels.push(l);
                        state.speech_energy =
                            ring::calm_interpolate(state.speech_energy, l.clamp(0.0, 1.0), 0.35);
                        NEEDS_DISPLAY.store(true, Ordering::SeqCst);
                    }
                    Command::Spectrum(bins) => {
                        state.levels.set_from_bins(&bins);
                        let average = bins.iter().copied().sum::<f32>() / BAR_COUNT as f32;
                        state.speech_energy = ring::calm_interpolate(
                            state.speech_energy,
                            average.clamp(0.0, 1.0),
                            0.35,
                        );
                        NEEDS_DISPLAY.store(true, Ordering::SeqCst);
                    }
                    Command::Position(x, y, w, h) => {
                        let screen: id = msg_send![window, screen];
                        let screen_frame: NSRect = msg_send![screen, frame];
                        let mac_y = screen_frame.size.height - y as f64 - h as f64;
                        let f = NSRect::new(
                            NSPoint::new(x as f64, mac_y),
                            NSSize::new(w as f64, h as f64),
                        );
                        let _: () = msg_send![window, setFrame:f display:YES];
                    }
                    Command::Theme(name) => {
                        state.visual_theme = theme_loader.get_theme(&name);
                        NEEDS_DISPLAY.store(true, Ordering::SeqCst);
                    }
                    Command::Quit => {
                        RUNNING.store(false, Ordering::SeqCst);
                        break;
                    }
                }
            }

            state.animation_time += 0.016;
            state.speech_energy = ring::calm_interpolate(state.speech_energy, 0.0, 0.03);
            if state.state == OverlayState::Transcribing && state.visible {
                state.pulse_phase += 0.15;
                PULSE_PHASE_BITS.store((state.pulse_phase as f64).to_bits(), Ordering::Relaxed);
                NEEDS_DISPLAY.store(true, Ordering::SeqCst);
            }

            if NEEDS_DISPLAY.swap(false, Ordering::SeqCst) {
                let _: () = msg_send![view, setNeedsDisplay: YES];
            }

            loop {
                let event: id = msg_send![
                    app,
                    nextEventMatchingMask: u64::MAX
                    untilDate: nil
                    inMode: NSString::alloc(nil).init_str("kCFRunLoopDefaultMode")
                    dequeue: YES
                ];
                if event == nil {
                    break;
                }
                let _: () = msg_send![app, sendEvent: event];
            }

            if let Some(ref path) = heartbeat_path {
                if last_heartbeat.elapsed().as_secs() >= 1 {
                    let ts = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    let _ = std::fs::write(path, ts.to_string());
                    last_heartbeat = std::time::Instant::now();
                }
            }

            std::thread::sleep(std::time::Duration::from_millis(16));
        }

        VIEW_STATE = None;
        let _: () = msg_send![window, close];
    }
}
