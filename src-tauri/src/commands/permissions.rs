//! Permission commands - exposed to frontend via invoke().
//!
//! Commands for checking and opening system permission settings.

use crate::permissions::{
    create_permission_checker, Permission, PermissionChecker, PermissionStatus,
};
use serde::Serialize;

/// Permission status response for frontend.
#[derive(Debug, Serialize)]
pub struct PermissionInfo {
    pub name: String,
    pub status: String,
    pub description: String,
}

/// Check all required permissions and return their status.
#[tauri::command]
pub fn check_permissions() -> Vec<PermissionInfo> {
    let checker = create_permission_checker();

    Permission::all()
        .iter()
        .map(|p| PermissionInfo {
            name: p.display_name().to_string(),
            status: match checker.check(*p) {
                PermissionStatus::Granted => "granted".to_string(),
                PermissionStatus::Denied => "denied".to_string(),
                PermissionStatus::Unknown => "unknown".to_string(),
            },
            description: p.description().to_string(),
        })
        .collect()
}

/// Open system settings for a specific permission.
#[tauri::command]
pub fn open_permission_settings(permission: String) {
    let checker = create_permission_checker();

    let perm = match permission.to_lowercase().as_str() {
        "input monitoring" | "inputmonitoring" => Permission::InputMonitoring,
        "microphone" => Permission::Microphone,
        "accessibility" => Permission::Accessibility,
        _ => return,
    };

    checker.open_settings(perm);
}

/// Request microphone permission (triggers system dialog on macOS).
/// This is needed for the app to appear in Privacy > Microphone list.
/// Uses AVFoundation via osascript to safely trigger permission dialog without crash.
#[tauri::command]
pub async fn request_microphone_permission() -> bool {
    request_microphone_permission_impl()
}

#[cfg(target_os = "macos")]
fn request_microphone_permission_impl() -> bool {
    use std::process::Command;

    // Use AVFoundation via osascript (safe, no crash)
    // authStatus: 0 = not determined, 1 = restricted, 2 = denied, 3 = authorized
    let output = Command::new("osascript")
        .args([
            "-e",
            r#"use framework "AVFoundation"
            set authStatus to current application's AVCaptureDevice's authorizationStatusForMediaType:(current application's AVMediaTypeAudio)
            if authStatus is 0 then
                -- Not determined: trigger permission request
                current application's AVCaptureDevice's requestAccessForMediaType:(current application's AVMediaTypeAudio) completionHandler:(missing value)
                return "requested"
            else if authStatus is 3 then
                return "granted"
            else
                return "denied"
            end if"#,
        ])
        .output();

    match output {
        Ok(result) => {
            let stdout = String::from_utf8_lossy(&result.stdout);
            let status = stdout.trim().to_lowercase();
            status.contains("granted") || status.contains("requested")
        }
        Err(_) => false,
    }
}

#[cfg(not(target_os = "macos"))]
fn request_microphone_permission_impl() -> bool {
    true
}

/// Trigger microphone permission request (for wizard flow).
/// Must be called before opening Privacy settings so app appears in list.
pub fn trigger_microphone_permission_request() {
    request_microphone_permission_impl();
}

/// Request accessibility permission (triggers system dialog on macOS).
/// This is needed for auto-typing functionality.
/// Uses System Events via osascript to safely trigger permission dialog.
#[tauri::command]
pub async fn request_accessibility_permission() -> bool {
    request_accessibility_permission_impl()
}

#[cfg(target_os = "macos")]
fn request_accessibility_permission_impl() -> bool {
    use crate::permissions::macos::check_accessibility_permission;
    use std::process::Command;

    if check_accessibility_permission() {
        tracing::debug!("Accessibility permission already granted, skipping osascript trigger");
        return true;
    }

    // Use System Events to trigger accessibility permission request
    // This query triggers the permission dialog if not yet granted
    let output = Command::new("osascript")
        .args([
            "-e",
            r#"tell application "System Events"
                return (exists (processes whose name is "Finder"))
            end tell"#,
        ])
        .output();

    match output {
        Ok(result) => result.status.success(),
        Err(_) => false,
    }
}

#[cfg(not(target_os = "macos"))]
fn request_accessibility_permission_impl() -> bool {
    true
}

/// Restart the application to apply permission changes.
/// macOS requires restart for Accessibility and Input Monitoring permissions
/// to take effect (TCC loads permissions at process start).
#[tauri::command]
pub fn restart_app() {
    #[cfg(target_os = "macos")]
    crate::permissions::macos::restart_app();

    #[cfg(not(target_os = "macos"))]
    {
        // On other platforms, just log a warning
        tracing::warn!("restart_app called on non-macOS platform - no action taken");
    }
}

/// Bring the app window to the front.
/// Useful after returning from System Settings.
#[tauri::command]
pub fn bring_to_front() {
    #[cfg(target_os = "macos")]
    crate::permissions::macos::bring_app_to_front();
}
