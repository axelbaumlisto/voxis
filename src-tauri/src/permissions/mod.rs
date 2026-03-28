//! Permission checking module for macOS.
//!
//! Handles checking and requesting system permissions:
//! - Accessibility (required for global hotkey monitoring via rdev)
//! - Microphone (required for audio recording via cpal)
//!
//! Architecture (SOLID):
//! - SRP: Single responsibility - permission checking only
//! - OCP: Open for extension via PermissionChecker trait
//! - DIP: Depends on abstractions (PermissionChecker trait)

pub mod checker;

#[cfg(target_os = "macos")]
pub mod macos;

pub use checker::{Permission, PermissionChecker, PermissionStatus};

#[cfg(target_os = "macos")]
pub use macos::MacOSPermissionChecker;

/// Create the platform-appropriate permission checker.
#[cfg(target_os = "macos")]
pub fn create_permission_checker() -> impl PermissionChecker {
    MacOSPermissionChecker::new()
}

/// Stub for non-macOS platforms (permissions assumed granted).
#[cfg(not(target_os = "macos"))]
pub fn create_permission_checker() -> impl PermissionChecker {
    checker::StubPermissionChecker
}
