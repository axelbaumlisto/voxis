//! Visual test for native overlay.
//!
//! Run with: cargo run --example test_native_overlay

use std::sync::{Arc, RwLock};
use std::thread;
use std::time::Duration;
use voice_lib::overlay_native::{NativeOverlay, OverlayState, ThemeLoader};

fn main() {
    // Initialize tracing
    tracing_subscriber::fmt().with_env_filter("info").init();

    println!("=== Native Overlay Visual Test ===\n");

    if !NativeOverlay::is_available() {
        println!("ERROR: Native overlay is not available on this system.");
        println!("Make sure DISPLAY is set and GLFW is installed.");
        return;
    }

    println!("Creating native overlay...");
    let themes_dir = dirs::config_dir()
        .unwrap_or_default()
        .join("soupawhisper")
        .join("themes");
    let theme_loader = Arc::new(RwLock::new(ThemeLoader::new(themes_dir)));
    let overlay = NativeOverlay::new(theme_loader);

    // Give the overlay thread time to initialize
    thread::sleep(Duration::from_millis(500));

    println!("\n1. Showing IDLE state (thin blue line)...");
    overlay.show(OverlayState::Idle);
    thread::sleep(Duration::from_secs(2));

    println!("2. Showing RECORDING state (32 bars)...");
    overlay.show(OverlayState::Recording);

    // Simulate audio levels
    println!("   Sending audio levels...");
    for i in 0..50 {
        let level = (i as f32 * 0.1).sin().abs() * 0.8;
        overlay.send_audio_level(level);
        thread::sleep(Duration::from_millis(80));
    }

    println!("3. Showing TRANSCRIBING state (5 pulsing green bars)...");
    overlay.show(OverlayState::Transcribing);
    thread::sleep(Duration::from_secs(3));

    println!("4. Back to IDLE state...");
    overlay.show(OverlayState::Idle);
    thread::sleep(Duration::from_secs(2));

    println!("5. Hiding overlay...");
    overlay.hide();
    thread::sleep(Duration::from_secs(1));

    println!("\n=== Test complete! ===");
}
