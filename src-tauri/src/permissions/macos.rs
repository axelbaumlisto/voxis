//! macOS permission checking implementation.
//!
//! Uses native macOS APIs to check and request permissions:
//! - Input Monitoring: IOHIDCheckAccess for keyboard event monitoring (rdev)
//! - Microphone: AVCaptureDevice authorization status
//!
//! KISS: Uses std::process::Command for opening System Preferences (simple, reliable).

use super::checker::{Permission, PermissionChecker, PermissionStatus};
use objc2::ffi::NSInteger;
use objc2::msg_send;
use objc2::runtime::{AnyClass, AnyObject};
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

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

// FFI binding for the native microphone-permission probe (plan Layer 0(b)).
//
// AVFoundation ships on every Mac (it backs Photos/QuickTime/Camera at the
// OS level), so this framework link is always satisfiable — there is no
// "AVFoundation missing" failure mode to guard against, only "the specific
// class/selector we want isn't there" (handled below via `AnyClass::get`
// returning `None` instead of the panicking `class!` macro).
#[link(name = "AVFoundation", kind = "framework")]
extern "C" {
    // `NSString * const AVMediaTypeAudio` — a read-only global owned by the
    // framework, initialized before any Rust code runs. We only ever read
    // this pointer and hand it to `authorizationStatusForMediaType:`, never
    // mutate or free it, so referencing it as `*const AnyObject` (the raw
    // untyped `id` representation) needs no `objc2-foundation` dependency.
    static AVMediaTypeAudio: *const AnyObject;
}

/// Map a raw `AVAuthorizationStatus` (AVFoundation/AVCaptureDevice.h) to our
/// platform-neutral `PermissionStatus`.
///
/// ```text
/// NotDetermined = 0  -> Unknown  (no decision recorded yet; must NOT block
///                                 recorder.start() — see PermissionStatus::
///                                 blocks_start and plan Layer 0(b) point 4)
/// Restricted    = 1  -> Denied   (parental controls / MDM; same as Denied
///                                 from the caller's point of view)
/// Denied        = 2  -> Denied
/// Authorized    = 3  -> Granted
/// ```
/// Any other raw value (a future OS adding a case we don't know about, or a
/// defensive catch-all) maps to `Unknown` rather than panicking or assuming
/// either extreme.
fn map_av_authorization_status(raw: NSInteger) -> PermissionStatus {
    match raw {
        3 => PermissionStatus::Granted,
        1 | 2 => PermissionStatus::Denied,
        _ => PermissionStatus::Unknown,
    }
}

/// Native microphone-permission probe: a single synchronous Objective-C
/// class-method call, no subprocess. Measured on this machine: ~41ms cold
/// (first call in the process — AVFoundation appears to do real work here,
/// not just a symbol/class lookup, likely a round-trip to the system media
/// daemon for the authorization decision) and ~9ms warm. Neither is
/// literally microseconds, but both are 10–100x faster than the osascript
/// path this replaces (measured 0.24–5.38s, see plan §1.1) — small enough
/// that it does not reopen the press/release race the plan is fixing.
///
/// Returns `None` if the `AVCaptureDevice` class cannot be found at runtime
/// (would require a corrupted/ancient system install — practically never
/// happens, but we check rather than assume) so the caller can fall back to
/// the `osascript` path instead of crashing.
fn check_microphone_native() -> Option<PermissionStatus> {
    // `AnyClass::get` performs a real runtime lookup and returns `None` on
    // a miss, unlike the `class!` macro (which panics / fails to link) — we
    // want the graceful fallback path, not a crash.
    let cls = AnyClass::get(c"AVCaptureDevice")?;

    // SAFETY: `cls` is a valid, registered class (checked above).
    // `AVMediaTypeAudio` is the framework's own constant, read-only and
    // non-null on every shipping macOS version (declared in the `extern`
    // block above; the link happens because AVFoundation is always
    // available). `authorizationStatusForMediaType:` is a synchronous,
    // side-effect-free class method — it only *reports* the current TCC
    // decision and never itself prompts the user (only
    // `requestAccessForMediaType:completionHandler:`, which we never call,
    // can show a system dialog) — so calling it from any thread at any
    // time is safe.
    let raw: NSInteger = unsafe {
        let media_type: *const AnyObject = AVMediaTypeAudio;
        msg_send![cls, authorizationStatusForMediaType: media_type]
    };
    Some(map_av_authorization_status(raw))
}

/// Poll `child` with `try_wait` until it exits or `timeout` elapses;
/// kills and reaps the child on timeout. Extracted from the osascript
/// fallback so the bounded-wait behaviour itself is unit-testable without
/// depending on AppleScript (see `test_wait_with_timeout_*` below).
fn wait_with_timeout(
    child: &mut std::process::Child,
    timeout: Duration,
) -> Option<std::process::ExitStatus> {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Some(status),
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait(); // reap so we don't leak a zombie
                    return None;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(_) => return None,
        }
    }
}

/// Fallback microphone probe when the native objc2 path is unavailable.
/// Same AppleScript this file always used, but now bounded to 1s total
/// (plan Layer 0(b) point 3): the whole reason this used to sit on the hot
/// path was that a plain `.output()` call can block for seconds, which is
/// exactly the window that lets a hotkey release race past `stop_recording`
/// (plan §1.1). A timeout that returns `Unknown` is safe because
/// `PermissionStatus::blocks_start` only refuses to start on `Denied`.
fn check_microphone_osascript_fallback() -> PermissionStatus {
    let mut child = match Command::new("osascript")
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
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(_) => return PermissionStatus::Unknown,
    };

    if wait_with_timeout(&mut child, Duration::from_secs(1)).is_none() {
        tracing::warn!(
            "osascript microphone permission probe timed out after 1s; treating as Unknown"
        );
        return PermissionStatus::Unknown;
    }

    let mut stdout_buf = Vec::new();
    if let Some(mut out) = child.stdout.take() {
        let _ = out.read_to_end(&mut stdout_buf);
    }
    let status_str = String::from_utf8_lossy(&stdout_buf).trim().to_lowercase();
    if status_str.contains("granted") {
        PermissionStatus::Granted
    } else if status_str.contains("denied") {
        PermissionStatus::Denied
    } else {
        PermissionStatus::Unknown
    }
}

/// Sticky cache: once the OS reports the microphone permission as
/// `Granted`, macOS does not silently revoke it out from under a running
/// process (a mid-session revoke in System Settings delivers zeroed audio
/// buffers instead — the Layer 2 silence guard is the correct backstop for
/// that, not a re-probe here). `Denied`/`Unknown` are deliberately never
/// cached: both can change at any time (user grants it in Settings; macOS
/// finishes recording an initial decision) and re-probing costs only a few
/// milliseconds once the native path is available (see
/// `check_microphone_native`'s doc comment), so there is no real cost to
/// always checking again.
static MICROPHONE_GRANTED_CACHE: AtomicBool = AtomicBool::new(false);

/// Cache-wrapping helper taking the cache and probe as parameters (rather
/// than reaching for the module `static` directly) so the caching policy
/// itself is unit-testable in isolation, with a fake probe and a
/// test-local `AtomicBool`, without touching AVFoundation or spawning
/// `osascript`.
fn check_microphone_with(cache: &AtomicBool, probe: impl Fn() -> PermissionStatus) -> PermissionStatus {
    if cache.load(Ordering::Acquire) {
        return PermissionStatus::Granted;
    }
    let status = probe();
    if status == PermissionStatus::Granted {
        cache.store(true, Ordering::Release);
    }
    status
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
    ///
    /// Primary path: a native `AVCaptureDevice authorizationStatusForMediaType:`
    /// call via objc2 — single-digit milliseconds, no subprocess (plan Layer
    /// 0(b); see `check_microphone_native`'s doc comment for measured
    /// numbers). Falls back to a bounded (1s) `osascript` probe only if the
    /// class lookup somehow misses. Successful `Granted` results are cached
    /// (see `MICROPHONE_GRANTED_CACHE`); `Denied`/`Unknown` are always
    /// re-probed.
    fn check_microphone(&self) -> PermissionStatus {
        check_microphone_with(&MICROPHONE_GRANTED_CACHE, || {
            check_microphone_native().unwrap_or_else(check_microphone_osascript_fallback)
        })
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
        r#"display dialog "Voxis needs {} permission to function properly.

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
        // Direct restart exits bypass Tauri exit events; mark this shutdown clean first.
        crate::diagnostics::heartbeat::write_clean_shutdown_marker();
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
        r#"display dialog "Voxis needs {name} permission.

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

    // ==========================================================================
    // Layer 0(b): native microphone-permission probe
    // ==========================================================================

    #[test]
    fn test_map_av_authorization_status_exhaustive() {
        // AVAuthorizationStatus: NotDetermined=0, Restricted=1, Denied=2, Authorized=3
        assert_eq!(
            map_av_authorization_status(0),
            PermissionStatus::Unknown,
            "NotDetermined must fall through, not block start"
        );
        assert_eq!(map_av_authorization_status(1), PermissionStatus::Denied);
        assert_eq!(map_av_authorization_status(2), PermissionStatus::Denied);
        assert_eq!(map_av_authorization_status(3), PermissionStatus::Granted);
    }

    #[test]
    fn test_map_av_authorization_status_out_of_range_is_unknown() {
        assert_eq!(map_av_authorization_status(99), PermissionStatus::Unknown);
        assert_eq!(map_av_authorization_status(-1), PermissionStatus::Unknown);
    }

    #[test]
    fn test_permission_status_blocks_start_only_denied() {
        assert!(!PermissionStatus::Granted.blocks_start());
        assert!(PermissionStatus::Denied.blocks_start());
        assert!(
            !PermissionStatus::Unknown.blocks_start(),
            "Unknown must fall through to recorder.start(), not block it"
        );
    }

    #[test]
    fn test_check_microphone_with_caches_granted() {
        let cache = AtomicBool::new(false);
        let calls = std::cell::Cell::new(0u32);
        let probe = || {
            calls.set(calls.get() + 1);
            PermissionStatus::Granted
        };
        assert_eq!(
            check_microphone_with(&cache, probe),
            PermissionStatus::Granted
        );
        assert_eq!(
            check_microphone_with(&cache, probe),
            PermissionStatus::Granted
        );
        assert_eq!(
            calls.get(),
            1,
            "probe must not be called again once cached Granted"
        );
    }

    #[test]
    fn test_check_microphone_with_never_caches_denied() {
        let cache = AtomicBool::new(false);
        let calls = std::cell::Cell::new(0u32);
        let probe = || {
            calls.set(calls.get() + 1);
            PermissionStatus::Denied
        };
        check_microphone_with(&cache, probe);
        check_microphone_with(&cache, probe);
        assert_eq!(calls.get(), 2, "Denied must always re-probe, never cache");
    }

    #[test]
    fn test_check_microphone_with_never_caches_unknown() {
        let cache = AtomicBool::new(false);
        let calls = std::cell::Cell::new(0u32);
        let probe = || {
            calls.set(calls.get() + 1);
            PermissionStatus::Unknown
        };
        check_microphone_with(&cache, probe);
        check_microphone_with(&cache, probe);
        assert_eq!(calls.get(), 2, "Unknown must always re-probe, never cache");
    }

    #[test]
    fn test_wait_with_timeout_kills_slow_child() {
        // Hermetic: plain POSIX `sleep`, not osascript — verifies the
        // bounded-wait loop itself, independent of AppleScript / AVFoundation.
        let mut child = Command::new("sleep")
            .arg("5")
            .spawn()
            .expect("spawn sleep 5");
        let start = Instant::now();
        let result = wait_with_timeout(&mut child, Duration::from_millis(300));
        let elapsed = start.elapsed();
        assert!(result.is_none(), "expected timeout (None), got {result:?}");
        assert!(
            elapsed < Duration::from_millis(2000),
            "wait_with_timeout took too long: {elapsed:?} (plan bound: < 2s)"
        );
    }

    #[test]
    fn test_wait_with_timeout_returns_status_for_fast_child() {
        let mut child = Command::new("true").spawn().expect("spawn true");
        let result = wait_with_timeout(&mut child, Duration::from_secs(1));
        assert!(result.is_some(), "a fast child must not be reported as timed out");
    }

    #[test]
    fn test_check_microphone_native_smoke() {
        // Not gated by #[ignore]: this is a pure, side-effect-free class-method
        // read (no permission prompt — see check_microphone_native's doc
        // comment), safe to run unconditionally in CI on macOS runners.
        //
        // Bound is 200ms, not the originally-hoped "microseconds": measured
        // on this machine the native path is ~41ms cold / ~9ms warm (see
        // check_microphone_native's doc comment for why). 200ms keeps a
        // wide margin against a loaded CI runner while still failing loudly
        // if this regresses back to osascript-scale latency (0.24–5.38s
        // measured for the fallback path, plan §1.1).
        let start = Instant::now();
        let result = check_microphone_native();
        let elapsed = start.elapsed();
        assert!(
            result.is_some(),
            "AVCaptureDevice must be found on any shipping macOS"
        );
        assert!(matches!(
            result.unwrap(),
            PermissionStatus::Granted | PermissionStatus::Denied | PermissionStatus::Unknown
        ));
        assert!(
            elapsed.as_millis() < 200,
            "native probe took {}ms, expected well under 200ms (no subprocess)",
            elapsed.as_millis()
        );
    }
}
