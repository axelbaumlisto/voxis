//! XKB group management for correct punctuation on non-Latin layouts.
//!
//! Problem: When typing via XTest on Russian layout, ASCII punctuation
//! produces wrong characters (e.g., ',' -> 'б', '.' -> 'ю').
//!
//! Solution: Temporarily switch XKB group to 0 (US layout) before typing,
//! then restore the original group.

#[cfg(target_os = "linux")]
use x11rb::{
    protocol::xkb::{self, ConnectionExt as XkbConnectionExt},
    protocol::xproto::ModMask,
    rust_connection::RustConnection,
    wrapper::ConnectionExt as _,
};

/// XKB group manager for temporary layout switching (SRP).
#[cfg(target_os = "linux")]
pub struct XkbGroupManager {
    connection: RustConnection,
}

#[cfg(target_os = "linux")]
impl XkbGroupManager {
    /// Create a new XKB group manager.
    pub fn new() -> Option<Self> {
        let (connection, _) = x11rb::connect(None).ok()?;

        // Initialize XKB extension
        connection.xkb_use_extension(1, 0).ok()?.reply().ok()?;

        Some(Self { connection })
    }

    /// Get current XKB group (keyboard layout index).
    pub fn get_group(&self) -> Option<u8> {
        self.connection
            .xkb_get_state(xkb::ID::USE_CORE_KBD.into())
            .ok()?
            .reply()
            .ok()
            .map(|s| s.group.into())
    }

    /// Set XKB group (keyboard layout index).
    pub fn set_group(&self, group: u8) {
        let _ = self.connection.xkb_latch_lock_state(
            xkb::ID::USE_CORE_KBD.into(),
            ModMask::from(0u8),
            ModMask::from(0u8),
            true,
            xkb::Group::from(group),
            ModMask::from(0u8),
            false,
            0u16,
        );
        let _ = self.connection.sync();
    }

    /// Execute closure with US layout (group 0), restore original after.
    pub fn with_us_layout<T, F>(&self, f: F) -> T
    where
        F: FnOnce() -> T,
    {
        let original = self.get_group();

        if original != Some(0) {
            self.set_group(0);
        }

        let result = f();

        if let Some(g) = original {
            if g != 0 {
                self.set_group(g);
            }
        }

        result
    }
}

#[cfg(not(target_os = "linux"))]
pub struct XkbGroupManager;

#[cfg(not(target_os = "linux"))]
impl XkbGroupManager {
    pub fn new() -> Option<Self> {
        None
    }

    pub fn with_us_layout<T, F>(&self, f: F) -> T
    where
        F: FnOnce() -> T,
    {
        f()
    }
}

#[cfg(test)]
mod tests {
    #[allow(unused_imports)]
    use super::*;

    #[test]
    #[cfg(target_os = "linux")]
    fn test_xkb_manager_creation() {
        // May fail if no X11 display
        let _manager = XkbGroupManager::new();
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn test_with_us_layout_executes_closure() {
        if let Some(manager) = XkbGroupManager::new() {
            let result = manager.with_us_layout(|| 42);
            assert_eq!(result, 42);
        }
    }

    /// This test inherently requires a live X display and is flaky in parallel runs.
    /// Run manually with: cargo test --lib -- --ignored
    #[test]
    #[ignore = "requires live X display; run with --ignored"]
    #[cfg(target_os = "linux")]
    fn test_group_restored_after_closure() {
        if let Some(manager) = XkbGroupManager::new() {
            let before = manager.get_group();
            manager.with_us_layout(|| {});
            let after = manager.get_group();
            assert_eq!(before, after);
        }
    }
}
