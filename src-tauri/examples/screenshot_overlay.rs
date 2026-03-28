//! Screenshot test for native overlay.
//!
//! Run with: DISPLAY=:0 cargo run --example screenshot_overlay

use std::process::Command;
use std::sync::{Arc, RwLock};
use std::thread;
use std::time::Duration;
use voice_lib::overlay_native::{
    NativeOverlay, OverlayPositionConfig, OverlaySizeConfig, OverlayState, ThemeLoader,
};

fn take_screenshot(name: &str) {
    let path = format!("/tmp/overlay_{}.png", name);
    let _ = Command::new("scrot")
        .args(["-u", "-d", "0", &path])
        .output();
    // Try with import if scrot doesn't work
    let _ = Command::new("import")
        .args(["-window", "root", &path])
        .output();
    println!("Screenshot saved: {}", path);
}

fn main() {
    tracing_subscriber::fmt().with_env_filter("warn").init();

    println!("=== Native Overlay Screenshot Test ===\n");

    if !NativeOverlay::is_available() {
        println!("ERROR: Native overlay not available");
        return;
    }

    let themes_dir = dirs::config_dir()
        .unwrap_or_default()
        .join("soupawhisper")
        .join("themes");
    let theme_loader = Arc::new(RwLock::new(ThemeLoader::new(themes_dir)));
    let overlay = NativeOverlay::new_with_config(
        OverlayPositionConfig::BottomLeft,
        OverlaySizeConfig::Medium,
        30,
        "default",
        800.0,
        theme_loader,
    );
    thread::sleep(Duration::from_millis(500));

    // Test 1: Idle state
    println!("1. IDLE state (blue line)");
    overlay.show(OverlayState::Idle);
    thread::sleep(Duration::from_secs(1));
    take_screenshot("1_idle");

    // Test 2: Recording with waveform
    println!("2. RECORDING state (32 blue bars)");
    overlay.show(OverlayState::Recording);
    for i in 0..20 {
        let level = (i as f32 * 0.3).sin().abs() * 0.9;
        overlay.send_audio_level(level);
        thread::sleep(Duration::from_millis(80));
    }
    take_screenshot("2_recording");

    // Test 3: Transcribing
    println!("3. TRANSCRIBING state (5 green pulsing bars)");
    overlay.show(OverlayState::Transcribing);
    thread::sleep(Duration::from_secs(1));
    take_screenshot("3_transcribing");

    // Done
    println!("\nTest complete!");
    overlay.hide();
    thread::sleep(Duration::from_millis(500));
}
