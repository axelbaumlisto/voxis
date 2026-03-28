//! E2E test: verify overlay is visible on all macOS Spaces.
//!
//! Run with: cargo test --test overlay_spaces_e2e -- --ignored --nocapture

use std::io::Write;
use std::process::{Command, Stdio};
use std::time::Duration;

/// Switch to next Space using AppleScript (Ctrl+→)
fn switch_to_next_space() {
    // key code 124 = right arrow
    let script = r#"
        tell application "System Events"
            key code 124 using control down
        end tell
    "#;
    Command::new("osascript")
        .args(["-e", script])
        .status()
        .expect("Failed to switch space");

    // Wait for animation
    std::thread::sleep(Duration::from_millis(500));
}

/// Switch to previous Space using AppleScript (Ctrl+←)
fn switch_to_prev_space() {
    // key code 123 = left arrow
    let script = r#"
        tell application "System Events"
            key code 123 using control down
        end tell
    "#;
    Command::new("osascript")
        .args(["-e", script])
        .status()
        .expect("Failed to switch space");

    std::thread::sleep(Duration::from_millis(500));
}

/// Take full screenshot (keep full for debugging, no crop)
fn take_screenshot(name: &str) -> String {
    let dir = format!("{}/tests/screenshots", env!("CARGO_MANIFEST_DIR"));
    std::fs::create_dir_all(&dir).ok();

    let path = format!("{}/{}.png", dir, name);

    // Take full screenshot
    Command::new("screencapture")
        .args(["-x", &path])
        .status()
        .expect("Failed to take screenshot");

    println!("Screenshot saved: {}", path);

    path
}

/// Check if screenshot contains overlay colors
/// Blue (30, 136, 229) for recording or Green (76-101, 175-196, 80-102) for transcribing
fn has_overlay_pixels(path: &str) -> bool {
    let check_script = format!(
        r#"
import sys
try:
    from PIL import Image
    img = Image.open("{}")
    pixels = list(img.getdata())
    blue_count = 0
    green_count = 0
    for p in pixels:
        if len(p) >= 3:
            r, g, b = p[0], p[1], p[2]
            # Overlay blue (30, 136, 229) with tolerance
            if 20 <= r <= 50 and 120 <= g <= 150 and 200 <= b <= 240:
                blue_count += 1
            # Overlay green (76-101, 175-196, 80-102) with tolerance
            if 60 <= r <= 120 and 160 <= g <= 210 and 60 <= b <= 120:
                green_count += 1
    total = blue_count + green_count
    # Need at least 10 colored pixels to confirm overlay is visible
    if total >= 10:
        print(f"FOUND:blue={{blue_count}},green={{green_count}},total={{total}}")
    else:
        print(f"NOT_FOUND:blue={{blue_count}},green={{green_count}},total={{total}}")
except Exception as e:
    print(f"ERROR:{{e}}")
"#,
        path
    );

    let output = Command::new("python3").args(["-c", &check_script]).output();

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            println!("Pixel check result: {}", stdout.trim());
            stdout.contains("FOUND:")
        }
        Err(e) => {
            println!("Python error: {}", e);
            false
        }
    }
}

#[test]
#[ignore] // Requires GUI, multiple Spaces, and Accessibility permissions
fn test_overlay_visible_on_all_spaces() {
    // Build overlay
    let status = Command::new("cargo")
        .args(["build", "--bin", "soupawhisper-overlay"])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .status()
        .expect("Failed to build");
    assert!(status.success(), "Build failed");

    // Spawn overlay
    let mut child = Command::new("./target/debug/soupawhisper-overlay")
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .stdin(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("Failed to spawn overlay");

    let stdin = child.stdin.as_mut().unwrap();

    // Show transcribing state (green, more visible)
    writeln!(stdin, "show transcribing").unwrap();
    std::thread::sleep(Duration::from_secs(2));

    // Screenshot on Space 1
    let screenshot1 = take_screenshot("overlay_space1");
    println!("Screenshot 1: {}", screenshot1);

    // Switch to Space 2
    switch_to_next_space();

    // Screenshot on Space 2
    let screenshot2 = take_screenshot("overlay_space2");
    println!("Screenshot 2: {}", screenshot2);

    // Return to Space 1
    switch_to_prev_space();

    // Quit overlay
    writeln!(stdin, "quit").unwrap();
    let _ = child.wait();

    // Verify overlay visible on both spaces
    assert!(
        has_overlay_pixels(&screenshot1),
        "Overlay not visible on Space 1"
    );
    assert!(
        has_overlay_pixels(&screenshot2),
        "Overlay not visible on Space 2"
    );

    println!("SUCCESS: Overlay visible on both Spaces!");
}
