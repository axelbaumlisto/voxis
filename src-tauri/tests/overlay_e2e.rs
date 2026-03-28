//! E2E tests for native overlay on macOS.
//!
//! Run with: cargo test --test overlay_e2e
//!
//! These tests verify that the overlay is available and can be created on macOS.

use std::sync::{Arc, RwLock};
use voice_lib::overlay_native::{NativeOverlay, OverlayState, ThemeLoader};

/// Test that overlay is available on the current platform (macOS or Linux with X11).
#[test]
fn test_overlay_is_available_on_this_platform() {
    let available = NativeOverlay::is_available();

    // On macOS, is_available() returns false because we use subprocess-based overlay.
    // The subprocess binary (soupawhisper-overlay) handles overlay display.
    #[cfg(target_os = "macos")]
    {
        // In-process overlay is intentionally disabled on macOS due to GLFW main thread requirement.
        // Subprocess-based overlay is used instead.
        assert!(
            !available,
            "In-process overlay should NOT be available on macOS (subprocess is used instead)"
        );
    }

    // On Linux, depends on X11 display
    #[cfg(target_os = "linux")]
    {
        if std::env::var("DISPLAY").is_ok() {
            assert!(
                available,
                "Overlay should be available on Linux with X11 DISPLAY set"
            );
        }
    }
}

/// Test that overlay can be created and receives commands.
/// Note: This test creates a real overlay window, which may require GUI environment.
#[test]
#[ignore] // Run manually: cargo test --test overlay_e2e -- --ignored
fn test_overlay_shows_on_recording() {
    if !NativeOverlay::is_available() {
        eprintln!("Skipping test: overlay not available on this platform");
        return;
    }

    // Create overlay
    let theme_loader = Arc::new(RwLock::new(ThemeLoader::new(std::path::PathBuf::from(
        "/tmp/nonexistent_themes",
    ))));
    let mut overlay = NativeOverlay::new(theme_loader);

    // Show recording state
    overlay.show(OverlayState::Recording);

    // Send some audio levels to trigger animation
    for i in 0..10 {
        overlay.send_audio_level((i as f32) / 10.0);
        std::thread::sleep(std::time::Duration::from_millis(50));
    }

    // Keep overlay visible for visual inspection
    std::thread::sleep(std::time::Duration::from_millis(500));

    // Show transcribing state
    overlay.show(OverlayState::Transcribing);
    std::thread::sleep(std::time::Duration::from_millis(300));

    // Hide overlay
    overlay.hide();
    std::thread::sleep(std::time::Duration::from_millis(100));

    // Cleanup
    overlay.shutdown();
}
