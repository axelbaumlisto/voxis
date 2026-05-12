use cocoa::appkit::NSColor;
use cocoa::base::{id, nil};
use cocoa::foundation::{NSPoint, NSRect, NSSize};
use objc::{class, msg_send, sel, sel_impl};
use voice_lib::overlay::themes::VisualizationFamily;

use crate::overlay_bin::render::{amplify_level, pulse_factor, PULSE_HEIGHTS};
use crate::overlay_bin::types::{OverlayState, BAR_COUNT};

use super::ring;

pub fn clear_frame(bounds: NSRect) -> bool {
    unsafe {
        #[link(name = "AppKit", kind = "framework")]
        extern "C" {
            fn NSRectFillUsingOperation(rect: NSRect, op: u64);
        }

        let ctx: id = msg_send![class!(NSGraphicsContext), currentContext];
        let _: () = msg_send![ctx, saveGraphicsState];
        let clear: id = NSColor::clearColor(nil);
        let _: () = msg_send![clear, set];
        NSRectFillUsingOperation(bounds, 0);
        let _: () = msg_send![ctx, restoreGraphicsState];
    }

    true
}

pub fn draw_builtin(state: &super::ViewState, w: f64, h: f64, pulse_phase_bits: u64) {
    let center_y = h / 2.0;
    let theme_color = match state.state {
        OverlayState::Idle | OverlayState::Hidden => state.visual_theme.idle,
        OverlayState::Recording => state.visual_theme.recording,
        OverlayState::Transcribing => state.visual_theme.transcribing,
        OverlayState::Queued(_) => state.visual_theme.queued,
    };

    match state.visual_theme.family {
        VisualizationFamily::OrganicRing => {
            ring::draw_organic_ring(
                state,
                w,
                h,
                theme_color,
                set_ns_color,
                |x1, y1, x2, y2, width| unsafe {
                    let path: id = msg_send![class!(NSBezierPath), bezierPath];
                    let _: () = msg_send![path, setLineWidth: width];
                    let _: () = msg_send![path, moveToPoint: NSPoint::new(x1, y1)];
                    let _: () = msg_send![path, lineToPoint: NSPoint::new(x2, y2)];
                    let _: () = msg_send![path, stroke];
                },
            );
        }
        VisualizationFamily::Bars => match state.state {
            OverlayState::Hidden => {}
            OverlayState::Idle => unsafe {
                set_ns_color(theme_color);
                let rect = NSRect::new(
                    NSPoint::new(10.0, center_y - 1.0),
                    NSSize::new(w - 20.0, 2.0),
                );
                let _: () = msg_send![class!(NSBezierPath), fillRect: rect];
            },
            OverlayState::Recording => {
                let bar_w = w / BAR_COUNT as f64 * 0.8;
                let spacing = w / BAR_COUNT as f64;
                let max_h = h * 0.8;

                for i in 0..BAR_COUNT {
                    let amp = amplify_level(state.levels.get(i)) as f64;
                    let bar_h = (amp * max_h).max(2.0);
                    let x = (i as f64 + 0.5) * spacing - bar_w / 2.0;
                    let rect = NSRect::new(
                        NSPoint::new(x, center_y - bar_h / 2.0),
                        NSSize::new(bar_w, bar_h),
                    );

                    if state.visual_theme.use_gradient {
                        let t = ((bar_h / max_h) as f32).clamp(0.0, 1.0);
                        set_ns_color(state.visual_theme.gradient.color_at(t));
                    } else {
                        set_ns_color(theme_color);
                    }

                    unsafe {
                        let _: () = msg_send![class!(NSBezierPath), fillRect: rect];
                    }
                }
            }
            OverlayState::Transcribing | OverlayState::Queued(_) => unsafe {
                set_ns_color(theme_color);
                let bar_w = w / BAR_COUNT as f64 * 1.6;
                let spacing = w / BAR_COUNT as f64 * 2.0;
                let max_h = h * 0.8;
                let total_w = 5.0 * spacing;
                let start_x = w / 2.0 - total_w / 2.0;

                let phase = f64::from_bits(pulse_phase_bits);

                for (i, &base_h) in PULSE_HEIGHTS.iter().enumerate() {
                    let pulse = pulse_factor(phase as f32, i) as f64;
                    let bar_h = base_h as f64 * pulse * max_h;
                    let x = start_x + (i as f64 + 0.5) * spacing - bar_w / 2.0;
                    let rect = NSRect::new(
                        NSPoint::new(x, center_y - bar_h / 2.0),
                        NSSize::new(bar_w, bar_h),
                    );
                    let _: () = msg_send![class!(NSBezierPath), fillRect: rect];
                }
            },
        },
    }
}

fn set_ns_color(color: egui::Color32) {
    unsafe {
        let ns_color: id = msg_send![
            class!(NSColor),
            colorWithRed: color.r() as f64 / 255.0
            green: color.g() as f64 / 255.0
            blue: color.b() as f64 / 255.0
            alpha: color.a() as f64 / 255.0
        ];
        let _: () = msg_send![ns_color, set];
    }
}
