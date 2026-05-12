//! macOS permission checking implementation.
//!
//! Uses native macOS APIs to check and request permissions:
//! - Input Monitoring: IOHIDCheckAccess for keyboard event monitoring (rdev)
//! - Microphone: AVCaptureDevice authorization status
//!
//! KISS: Uses std::process::Command for opening System Preferences (simple, reliable).

use super::checker::{Permission, PermissionChecker, PermissionStatus};
use std::process::Command;

// FFI bindings for IOKit HID access checking
#[allow(non_camel_case_types)]
type IOHIDAccessType = u32;
const IOHID_ACCESS_TYPE_GRANTED: IOHIDAccessType = 0;
const IOHID_ACCESS_TYPE_DENIED: IOHIDAccessType = 1;

#[allow(non_camel_case_types)]
type IOHIDRequestType = u32;
const IOHID_REQUEST_TYPE_LISTEN_EVENT: IOHIDRequestType = 1;

#[link(name = "IOKit", kind = "framework")]
extern "C" {
    fn IOHIDCheckAccess(requestType: IOHIDRequestType) -> IOHIDAccessType;
    fn IOHIDRequestAccess(requestType: IOHIDRequestType) -> bool;
}

// FFI bindings for Accessibility (AXIsProcessTrusted)
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
}

/// Check if Accessibility permission is granted.
/// Uses AXIsProcessTrusted() from ApplicationServices framework.
pub fn check_accessibility_permission() -> bool {
    unsafe { AXIsProcessTrusted() }
}

/// Trigger Accessibility permission request (shows system dialog).
/// Uses System Events via osascript to trigger the permission prompt.
pub fn trigger_accessibility_permission_request() {
    use std::process::Command;

    // If already granted, no need to trigger
    if check_accessibility_permission() {
        return;
    }

    // Use System Events to trigger accessibility permission request
    // This query triggers the permission dialog if not yet granted
    let _ = Command::new("osascript")
        .args([
            "-e",
            r#"tell application "System Events"
                return (exists (processes whose name is "Finder"))
            end tell"#,
        ])
        .output();
}

/// Trigger Input Monitoring permission request (shows system dialog).
/// Must be called before opening Privacy settings so app appears in list.
pub fn trigger_input_monitoring_permission_request() {
    unsafe {
        IOHIDRequestAccess(IOHID_REQUEST_TYPE_LISTEN_EVENT);
    }
}

/// macOS permission checker using native APIs.
pub struct MacOSPermissionChecker {
    _private: (), // Prevent construction outside this module
}

impl MacOSPermissionChecker {
    /// Create a new macOS permission checker.
    pub fn new() -> Self {
        Self { _private: () }
    }

    /// Check Input Monitoring permission using IOHIDCheckAccess.
    /// This is required for rdev to monitor keyboard events.
    fn check_input_monitoring(&self) -> PermissionStatus {
        // Use FFI to call IOHIDCheckAccess directly (fast, no subprocess)
        let result = unsafe { IOHIDCheckAccess(IOHID_REQUEST_TYPE_LISTEN_EVENT) };
        tracing::debug!(
            "IOHIDCheckAccess returned: {} (0=granted, 1=denied)",
            result
        );

        match result {
            IOHID_ACCESS_TYPE_GRANTED => PermissionStatus::Granted,
            IOHID_ACCESS_TYPE_DENIED => PermissionStatus::Denied,
            _ => PermissionStatus::Unknown,
        }
    }

    /// Check Accessibility permission using AXIsProcessTrusted.
    /// This is required for enigo auto-typing.
    fn check_accessibility(&self) -> PermissionStatus {
        if check_accessibility_permission() {
            PermissionStatus::Granted
        } else {
            PermissionStatus::Denied
        }
    }

    /// Check Microphone permission.
    /// Uses AVCaptureDevice authorization status via swift command.
    fn check_microphone(&self) -> PermissionStatus {
        // Check microphone by attempting to list audio input devices
        // This approach uses AVFoundation via a swift inline script
        let output = Command::new("osascript")
            .args([
                "-e",
                r#"use framework "AVFoundation"
                set authStatus to current application's AVCaptureDevice's authorizationStatusForMediaType:(current application's AVMediaTypeAudio)
                if authStatus is 3 then
                    return "granted"
                else if authStatus is 2 then
                    return "denied"
                else
                    return "unknown"
                end if"#,
            ])
            .output();

        match output {
            Ok(result) => {
                let stdout = String::from_utf8_lossy(&result.stdout);
                let status_str = stdout.trim().to_lowercase();

                if status_str.contains("granted") {
                    PermissionStatus::Granted
                } else if status_str.contains("denied") {
                    PermissionStatus::Denied
                } else {
                    // Not determined or restricted
                    PermissionStatus::Unknown
                }
            }
            Err(_) => PermissionStatus::Unknown,
        }
    }

    /// Get the System Preferences URL for a permission type.
    fn settings_url(&self, permission: Permission) -> &'static str {
        match permission {
            Permission::InputMonitoring => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent"
            }
            Permission::Microphone => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
            }
            Permission::Accessibility => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
            }
        }
    }
}

impl Default for MacOSPermissionChecker {
    fn default() -> Self {
        Self::new()
    }
}

impl PermissionChecker for MacOSPermissionChecker {
    fn check(&self, permission: Permission) -> PermissionStatus {
        match permission {
            Permission::InputMonitoring => self.check_input_monitoring(),
            Permission::Microphone => self.check_microphone(),
            Permission::Accessibility => self.check_accessibility(),
        }
    }

    fn request(&self, permission: Permission) -> bool {
        // For both permissions, open System Settings.
        // Microphone permission will be triggered automatically by cpal
        // when recording starts, since Info.plist has NSMicrophoneUsageDescription.
        self.open_settings(permission);
        true
    }

    fn open_settings(&self, permission: Permission) {
        let url = self.settings_url(permission);
        tracing::debug!("Opening settings for {:?} at {}", permission, url);
        // AppleScript: quit, delay, open, delay - wait for completion to avoid race conditions
        let script = format!(
            r#"tell application "System Settings" to quit
            delay 0.3
            do shell script "open '{}'"
            delay 0.5
            "#,
            url
        );
        // Use output() to wait for script completion (prevents race condition with dialog)
        let _ = Command::new("osascript").args(["-e", &script]).output();
    }
}

/// Show a permission dialog for multiple missing permissions.
/// Returns true if user clicked "Open Settings", false if "Quit".
pub fn show_permission_dialog(missing: &[Permission]) -> bool {
    let permission_names: Vec<&str> = missing.iter().map(|p| p.display_name()).collect();
    let permission_list = permission_names.join(" and ");

    let script = format!(
        r#"display dialog "SoupaWhisper needs {} permission to function properly.

Please grant permission in System Preferences, then restart the app." buttons {{"Quit", "Open Settings"}} default button "Open Settings" with icon caution with title "Permission Required""#,
        permission_list
    );

    let output = Command::new("osascript").args(["-e", &script]).output();

    match output {
        Ok(result) => {
            let stdout = String::from_utf8_lossy(&result.stdout);
            stdout.contains("Open Settings")
        }
        Err(_) => false,
    }
}

/// Bring the app window to the front.
/// Uses process PID for reliable activation regardless of app name.
pub fn bring_app_to_front() {
    let pid = std::process::id();
    let script = format!(
        r#"
        tell application "System Events"
            set frontmost of (first process whose unix id is {}) to true
        end tell
    "#,
        pid
    );
    let _ = Command::new("osascript").args(["-e", &script]).output();
}

/// Wait for user to grant permission in System Settings.
/// Waits until System Settings is closed, then brings app to front.
pub fn wait_for_app_focus() {
    // Wait for System Settings to close (user finished granting permission)
    let script = r#"
        repeat while application "System Settings" is running
            delay 0.5
        end repeat
    "#;
    let _ = Command::new("osascript").args(["-e", script]).output();

    // Bring our app to the front after System Settings closes
    bring_app_to_front();
}

/// Restart the application.
/// Spawns a new instance and exits the current one.
pub fn restart_app() {
    if let Ok(exe) = std::env::current_exe() {
        tracing::info!("Restarting app from: {:?}", exe);
        let _ = Command::new(&exe).spawn();
        std::process::exit(0);
    } else {
        tracing::error!("Failed to get current executable path for restart");
    }
}

/// Show a permission dialog for a single permission (step-by-step wizard).
/// Returns true if user clicked "Open Settings", false if "Quit".
pub fn show_single_permission_dialog(permission: Permission) -> bool {
    let name = permission.display_name();
    let description = permission.description();

    let script = format!(
        r#"display dialog "SoupaWhisper needs {name} permission.

{description}

Click 'Open Settings' to grant permission, then return to this app." buttons {{"Quit", "Open Settings"}} default button "Open Settings" with icon caution with title "{name} Required""#,
    );

    let output = Command::new("osascript").args(["-e", &script]).output();

    match output {
        Ok(result) => {
            let stdout = String::from_utf8_lossy(&result.stdout);
            stdout.contains("Open Settings")
        }
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_macos_checker_creation() {
        let checker = MacOSPermissionChecker::new();
        // Should not panic
        let _ = checker;
    }

    #[test]
    fn test_macos_checker_default() {
        let checker = MacOSPermissionChecker::default();
        let _ = checker;
    }

    #[test]
    fn test_settings_url_input_monitoring() {
        let checker = MacOSPermissionChecker::new();
        let url = checker.settings_url(Permission::InputMonitoring);
        assert!(url.contains("Privacy_ListenEvent"));
        assert!(url.starts_with("x-apple.systempreferences:"));
    }

    #[test]
    fn test_settings_url_microphone() {
        let checker = MacOSPermissionChecker::new();
        let url = checker.settings_url(Permission::Microphone);
        assert!(url.contains("Privacy_Microphone"));
        assert!(url.starts_with("x-apple.systempreferences:"));
    }

    #[test]
    fn test_settings_url_accessibility() {
        let checker = MacOSPermissionChecker::new();
        let url = checker.settings_url(Permission::Accessibility);
        assert!(url.contains("Privacy_Accessibility"));
        assert!(url.starts_with("x-apple.systempreferences:"));
    }

    // Integration tests that actually check system permissions
    // These are marked as ignored because they depend on system state
    #[test]
    #[ignore]
    fn test_check_input_monitoring_integration() {
        let checker = MacOSPermissionChecker::new();
        let status = checker.check(Permission::InputMonitoring);
        // Just verify it returns a valid status
        assert!(matches!(
            status,
            PermissionStatus::Granted | PermissionStatus::Denied | PermissionStatus::Unknown
        ));
    }

    #[test]
    #[ignore]
    fn test_check_microphone_integration() {
        let checker = MacOSPermissionChecker::new();
        let status = checker.check(Permission::Microphone);
        assert!(matches!(
            status,
            PermissionStatus::Granted | PermissionStatus::Denied | PermissionStatus::Unknown
        ));
    }

    #[test]
    #[ignore]
    fn test_check_accessibility_integration() {
        let checker = MacOSPermissionChecker::new();
        let status = checker.check(Permission::Accessibility);
        // Accessibility returns only Granted or Denied (AXIsProcessTrusted is boolean)
        assert!(matches!(
            status,
            PermissionStatus::Granted | PermissionStatus::Denied
        ));
    }

    #[test]
    fn test_show_permission_dialog_format() {
        // Test that the dialog message is formatted correctly
        let missing = [Permission::InputMonitoring, Permission::Microphone];
        let permission_names: Vec<&str> = missing.iter().map(|p| p.display_name()).collect();
        let permission_list = permission_names.join(" and ");
        assert_eq!(permission_list, "Input Monitoring and Microphone");
    }

    #[test]
    fn test_show_permission_dialog_single() {
        let missing = [Permission::InputMonitoring];
        let permission_names: Vec<&str> = missing.iter().map(|p| p.display_name()).collect();
        let permission_list = permission_names.join(" and ");
        assert_eq!(permission_list, "Input Monitoring");
    }

    #[test]
    #[ignore] // This test opens System Settings - run manually
    fn test_open_settings_completes_within_timeout() {
        // Verify open_settings waits for script completion but doesn't hang
        let checker = MacOSPermissionChecker::new();
        let start = std::time::Instant::now();
        checker.open_settings(Permission::InputMonitoring);
        let elapsed = start.elapsed();
        // Should complete within 3 seconds (includes delays in AppleScript)
        assert!(
            elapsed.as_secs() < 3,
            "open_settings took too long: {}ms",
            elapsed.as_millis()
        );
    }

    #[test]
    fn test_single_permission_dialog_format() {
        // Verify the dialog text is formatted correctly
        let name = Permission::InputMonitoring.display_name();
        let desc = Permission::InputMonitoring.description();
        assert_eq!(name, "Input Monitoring");
        assert!(desc.contains("hotkey"));
    }

    #[test]
    #[ignore] // This test affects window focus - run manually
    fn test_bring_app_to_front_does_not_panic() {
        // Verify bring_app_to_front executes without panicking
        bring_app_to_front();
        // If we get here, the test passes
    }

    #[test]
    fn test_bring_app_to_front_uses_current_pid() {
        // Verify we can get the current PID (used by bring_app_to_front)
        let pid = std::process::id();
        assert!(pid > 0, "Current PID should be a positive number");
    }

    // Note: restart_app cannot be tested directly as it calls exit(0)
}
