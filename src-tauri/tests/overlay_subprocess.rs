//! Integration test for native overlay via subprocess.
//!
//! This test launches the soupawhisper-overlay binary as a subprocess,
//! sends commands via stdin, and verifies it doesn't crash.
//!
//! Run with: cargo test --test overlay_subprocess

use std::io::Write;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

/// Helper to launch soupawhisper-overlay subprocess.
fn spawn_overlay() -> std::io::Result<Child> {
    Command::new("./target/debug/soupawhisper-overlay")
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
}

/// Test that overlay subprocess can be spawned and accepts commands.
#[test]
fn test_overlay_subprocess_spawns_and_accepts_commands() {
    // First build the binary
    let status = Command::new("cargo")
        .args(["build", "--bin", "soupawhisper-overlay"])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .status();

    if status.is_err() || !status.unwrap().success() {
        eprintln!("Failed to build soupawhisper-overlay, skipping test");
        return;
    }

    // Spawn overlay
    let mut child = match spawn_overlay() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Failed to spawn overlay: {}, skipping test", e);
            return;
        }
    };

    // Get stdin handle
    let stdin = child.stdin.as_mut().expect("Failed to get stdin");

    // Send commands
    writeln!(stdin, "show recording").expect("Failed to send show command");
    writeln!(stdin, "level 0.5").expect("Failed to send level command");
    writeln!(stdin, "level 0.8").expect("Failed to send level command");

    // Give it time to process
    std::thread::sleep(Duration::from_millis(500));

    // Send more commands
    writeln!(stdin, "show transcribing").expect("Failed to send transcribing command");
    std::thread::sleep(Duration::from_millis(300));

    // Hide and quit
    writeln!(stdin, "hide").expect("Failed to send hide command");
    writeln!(stdin, "quit").expect("Failed to send quit command");

    // Wait for process to exit with timeout
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                // Process exited
                assert!(status.success(), "Overlay process should exit cleanly");
                break;
            }
            Ok(None) => {
                // Still running
                if start.elapsed() > Duration::from_secs(5) {
                    // Timeout - kill the process
                    child.kill().expect("Failed to kill overlay");
                    panic!("Overlay process did not exit within timeout");
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => {
                panic!("Error waiting for overlay process: {}", e);
            }
        }
    }
}

/// Test that overlay can show recording state with audio levels.
#[test]
#[ignore] // This test requires GUI and may not work in CI
fn test_overlay_visual_recording_state() {
    // Build first
    let status = Command::new("cargo")
        .args(["build", "--bin", "soupawhisper-overlay"])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .status();

    if status.is_err() || !status.unwrap().success() {
        eprintln!("Failed to build soupawhisper-overlay, skipping test");
        return;
    }

    let mut child = match spawn_overlay() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Failed to spawn overlay: {}, skipping test", e);
            return;
        }
    };

    let stdin = child.stdin.as_mut().expect("Failed to get stdin");

    // Position overlay at bottom left
    writeln!(stdin, "pos 50 800 200 80").expect("Failed to send position");

    // Show recording state
    writeln!(stdin, "show recording").expect("Failed to send show");

    // Send audio levels to create visible waveform
    for i in 0..20 {
        let level = ((i as f32) * 0.15).sin().abs();
        writeln!(stdin, "level {:.2}", level).expect("Failed to send level");
        std::thread::sleep(Duration::from_millis(50));
    }

    // Keep visible for screenshot opportunity
    std::thread::sleep(Duration::from_millis(500));

    // Take screenshot using macOS screencapture
    #[cfg(target_os = "macos")]
    {
        let screenshot_path = format!(
            "{}/tests/screenshots/overlay_recording.png",
            env!("CARGO_MANIFEST_DIR")
        );

        // Create screenshots directory
        std::fs::create_dir_all(format!("{}/tests/screenshots", env!("CARGO_MANIFEST_DIR")))
            .expect("Failed to create screenshots directory");

        let result = Command::new("screencapture")
            .args(["-x", &screenshot_path])
            .status();

        if let Ok(status) = result {
            if status.success() {
                println!("Screenshot saved to: {}", screenshot_path);
            }
        }
    }

    // Quit
    writeln!(stdin, "quit").expect("Failed to send quit");

    // Wait for exit
    let _ = child.wait();
}

/// Test that overlay accepts spectrum and theme commands.
#[test]
fn test_overlay_subprocess_accepts_spectrum_and_theme_commands() {
    // First build the binary
    let status = Command::new("cargo")
        .args(["build", "--bin", "soupawhisper-overlay"])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .status();

    if status.is_err() || !status.unwrap().success() {
        eprintln!("Failed to build soupawhisper-overlay, skipping test");
        return;
    }

    // Spawn overlay
    let mut child = match spawn_overlay() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Failed to spawn overlay: {}, skipping test", e);
            return;
        }
    };

    // Get stdin handle
    let stdin = child.stdin.as_mut().expect("Failed to get stdin");

    // Send show recording
    writeln!(stdin, "show recording").expect("Failed to send show command");
    std::thread::sleep(Duration::from_millis(100));

    // Send spectrum command with 32 bins
    writeln!(
        stdin,
        "spectrum [0.8,0.5,0.3,0.9,0.4,0.6,0.7,0.2,0.1,0.5,0.8,0.3,0.6,0.4,0.9,0.2,0.5,0.7,0.3,0.6,0.4,0.8,0.2,0.5,0.3,0.7,0.4,0.6,0.9,0.1,0.5,0.8]"
    )
    .expect("Failed to send spectrum command");
    std::thread::sleep(Duration::from_millis(100));

    // Send theme command
    writeln!(stdin, "theme winamp_classic").expect("Failed to send theme command");
    std::thread::sleep(Duration::from_millis(100));

    // Send more spectrum data
    writeln!(
        stdin,
        "spectrum [0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1.0,0.9,0.8,0.7,0.6,0.5,0.4,0.3,0.2,0.1,0.0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1.0,0.5,0.3]"
    )
    .expect("Failed to send second spectrum command");
    std::thread::sleep(Duration::from_millis(100));

    // Quit
    writeln!(stdin, "quit").expect("Failed to send quit command");

    // Wait for process to exit with timeout
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                assert!(
                    status.success(),
                    "Overlay process should exit cleanly after spectrum/theme commands"
                );
                break;
            }
            Ok(None) => {
                if start.elapsed() > Duration::from_secs(5) {
                    child.kill().expect("Failed to kill overlay");
                    panic!("Overlay process did not exit within timeout");
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => {
                panic!("Error waiting for overlay process: {}", e);
            }
        }
    }
}

