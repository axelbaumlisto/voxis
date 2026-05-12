//! Permission types and traits.
//!
//! Defines the abstract interface for permission checking (DIP).
//! Platform-specific implementations are in separate modules.

/// System permissions required by the app.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Permission {
    /// Input Monitoring permission for global hotkey detection (rdev).
    /// On macOS this is Privacy > Input Monitoring, not Accessibility.
    InputMonitoring,
    /// Microphone permission for audio recording (cpal).
    Microphone,
    /// Accessibility permission for auto-typing (enigo).
    /// On macOS this is Privacy > Accessibility.
    Accessibility,
}

impl Permission {
    /// Get all required permissions.
    pub fn all() -> &'static [Permission] {
        &[
            Permission::InputMonitoring,
            Permission::Microphone,
            Permission::Accessibility,
        ]
    }

    /// Human-readable name for display.
    pub fn display_name(&self) -> &'static str {
        match self {
            Permission::InputMonitoring => "Input Monitoring",
            Permission::Microphone => "Microphone",
            Permission::Accessibility => "Accessibility",
        }
    }

    /// Description of why this permission is needed.
    pub fn description(&self) -> &'static str {
        match self {
            Permission::InputMonitoring => "Required for global hotkey detection",
            Permission::Microphone => "Required for audio recording",
            Permission::Accessibility => "Required for auto-typing output",
        }
    }
}

/// Status of a permission.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionStatus {
    /// Permission has been granted.
    Granted,
    /// Permission has been explicitly denied.
    Denied,
    /// Permission status is unknown (not yet requested or platform doesn't report).
    Unknown,
}

impl PermissionStatus {
    /// Check if permission is granted.
    pub fn is_granted(&self) -> bool {
        matches!(self, PermissionStatus::Granted)
    }
}

/// Trait for checking and requesting permissions (DIP).
/// Platform-specific implementations provide the actual checks.
pub trait PermissionChecker: Send + Sync {
    /// Check the current status of a permission.
    fn check(&self, permission: Permission) -> PermissionStatus;

    /// Request a permission from the user.
    /// Returns true if the request dialog was shown (not necessarily granted).
    fn request(&self, permission: Permission) -> bool;

    /// Open system settings to the appropriate permission panel.
    fn open_settings(&self, permission: Permission);

    /// Check if all required permissions are granted.
    fn all_granted(&self) -> bool {
        Permission::all()
            .iter()
            .all(|p| self.check(*p).is_granted())
    }

    /// Get list of missing (non-granted) permissions.
    fn missing_permissions(&self) -> Vec<Permission> {
        Permission::all()
            .iter()
            .filter(|p| !self.check(**p).is_granted())
            .copied()
            .collect()
    }
}

/// Stub permission checker for non-macOS platforms.
/// Always reports permissions as granted.
pub struct StubPermissionChecker;

impl PermissionChecker for StubPermissionChecker {
    fn check(&self, _permission: Permission) -> PermissionStatus {
        PermissionStatus::Granted
    }

    fn request(&self, _permission: Permission) -> bool {
        true
    }

    fn open_settings(&self, _permission: Permission) {
        // No-op on non-macOS
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ==========================================================================
    // Permission enum tests
    // ==========================================================================

    #[test]
    fn test_permission_all_returns_all_permissions() {
        let all = Permission::all();
        assert_eq!(all.len(), 3);
        assert!(all.contains(&Permission::InputMonitoring));
        assert!(all.contains(&Permission::Microphone));
        assert!(all.contains(&Permission::Accessibility));
    }

    #[test]
    fn test_permission_display_name() {
        assert_eq!(
            Permission::InputMonitoring.display_name(),
            "Input Monitoring"
        );
        assert_eq!(Permission::Microphone.display_name(), "Microphone");
        assert_eq!(Permission::Accessibility.display_name(), "Accessibility");
    }

    #[test]
    fn test_permission_description() {
        assert!(Permission::InputMonitoring.description().contains("hotkey"));
        assert!(Permission::Microphone.description().contains("recording"));
        assert!(Permission::Accessibility
            .description()
            .contains("auto-typing"));
    }

    #[test]
    fn test_permission_debug_impl() {
        // Verify Debug derive works
        let debug_str = format!("{:?}", Permission::InputMonitoring);
        assert!(debug_str.contains("InputMonitoring"));
    }

    #[test]
    fn test_permission_clone_and_copy() {
        let p = Permission::InputMonitoring;
        let p2 = p; // Copy
        // Explicitly test the Clone trait (Permission also implements Copy).
        let p3 = Clone::clone(&p);
        assert_eq!(p, p2);
        assert_eq!(p, p3);
    }

    #[test]
    fn test_permission_equality() {
        assert_eq!(Permission::InputMonitoring, Permission::InputMonitoring);
        assert_eq!(Permission::Microphone, Permission::Microphone);
        assert_ne!(Permission::InputMonitoring, Permission::Microphone);
    }

    #[test]
    fn test_permission_hash() {
        use std::collections::HashSet;
        let mut set = HashSet::new();
        set.insert(Permission::InputMonitoring);
        set.insert(Permission::Microphone);
        assert_eq!(set.len(), 2);
        assert!(set.contains(&Permission::InputMonitoring));
    }

    // ==========================================================================
    // PermissionStatus enum tests
    // ==========================================================================

    #[test]
    fn test_permission_status_is_granted() {
        assert!(PermissionStatus::Granted.is_granted());
        assert!(!PermissionStatus::Denied.is_granted());
        assert!(!PermissionStatus::Unknown.is_granted());
    }

    #[test]
    fn test_permission_status_debug_impl() {
        let debug_str = format!("{:?}", PermissionStatus::Granted);
        assert!(debug_str.contains("Granted"));
    }

    #[test]
    fn test_permission_status_clone_and_copy() {
        let s = PermissionStatus::Granted;
        let s2 = s; // Copy
        // Explicitly test the Clone trait (PermissionStatus also implements Copy).
        let s3 = Clone::clone(&s);
        assert_eq!(s, s2);
        assert_eq!(s, s3);
    }

    #[test]
    fn test_permission_status_equality() {
        assert_eq!(PermissionStatus::Granted, PermissionStatus::Granted);
        assert_eq!(PermissionStatus::Denied, PermissionStatus::Denied);
        assert_eq!(PermissionStatus::Unknown, PermissionStatus::Unknown);
        assert_ne!(PermissionStatus::Granted, PermissionStatus::Denied);
    }

    // ==========================================================================
    // StubPermissionChecker tests
    // ==========================================================================

    #[test]
    fn test_stub_checker_always_granted() {
        let checker = StubPermissionChecker;
        assert_eq!(
            checker.check(Permission::InputMonitoring),
            PermissionStatus::Granted
        );
        assert_eq!(
            checker.check(Permission::Microphone),
            PermissionStatus::Granted
        );
        assert_eq!(
            checker.check(Permission::Accessibility),
            PermissionStatus::Granted
        );
    }

    #[test]
    fn test_stub_checker_request_returns_true() {
        let checker = StubPermissionChecker;
        assert!(checker.request(Permission::InputMonitoring));
        assert!(checker.request(Permission::Microphone));
        assert!(checker.request(Permission::Accessibility));
    }

    #[test]
    fn test_stub_checker_open_settings_does_not_panic() {
        let checker = StubPermissionChecker;
        checker.open_settings(Permission::InputMonitoring);
        checker.open_settings(Permission::Microphone);
        checker.open_settings(Permission::Accessibility);
        // Test passes if no panic
    }

    #[test]
    fn test_stub_checker_all_granted() {
        let checker = StubPermissionChecker;
        assert!(checker.all_granted());
    }

    #[test]
    fn test_stub_checker_no_missing_permissions() {
        let checker = StubPermissionChecker;
        assert!(checker.missing_permissions().is_empty());
    }

    // ==========================================================================
    // Mock checker for trait method tests
    // ==========================================================================

    struct MockChecker {
        input_monitoring: PermissionStatus,
        microphone: PermissionStatus,
        accessibility: PermissionStatus,
    }

    impl PermissionChecker for MockChecker {
        fn check(&self, permission: Permission) -> PermissionStatus {
            match permission {
                Permission::InputMonitoring => self.input_monitoring,
                Permission::Microphone => self.microphone,
                Permission::Accessibility => self.accessibility,
            }
        }

        fn request(&self, _permission: Permission) -> bool {
            true
        }

        fn open_settings(&self, _permission: Permission) {}
    }

    #[test]
    fn test_trait_all_granted_all_granted() {
        let checker = MockChecker {
            input_monitoring: PermissionStatus::Granted,
            microphone: PermissionStatus::Granted,
            accessibility: PermissionStatus::Granted,
        };
        assert!(checker.all_granted());
    }

    #[test]
    fn test_trait_all_granted_one_denied() {
        let checker = MockChecker {
            input_monitoring: PermissionStatus::Granted,
            microphone: PermissionStatus::Denied,
            accessibility: PermissionStatus::Granted,
        };
        assert!(!checker.all_granted());
    }

    #[test]
    fn test_trait_all_granted_one_unknown() {
        let checker = MockChecker {
            input_monitoring: PermissionStatus::Unknown,
            microphone: PermissionStatus::Granted,
            accessibility: PermissionStatus::Granted,
        };
        assert!(!checker.all_granted());
    }

    #[test]
    fn test_trait_missing_permissions_none() {
        let checker = MockChecker {
            input_monitoring: PermissionStatus::Granted,
            microphone: PermissionStatus::Granted,
            accessibility: PermissionStatus::Granted,
        };
        assert!(checker.missing_permissions().is_empty());
    }

    #[test]
    fn test_trait_missing_permissions_one() {
        let checker = MockChecker {
            input_monitoring: PermissionStatus::Denied,
            microphone: PermissionStatus::Granted,
            accessibility: PermissionStatus::Granted,
        };
        let missing = checker.missing_permissions();
        assert_eq!(missing.len(), 1);
        assert!(missing.contains(&Permission::InputMonitoring));
    }

    #[test]
    fn test_trait_missing_permissions_multiple() {
        let checker = MockChecker {
            input_monitoring: PermissionStatus::Denied,
            microphone: PermissionStatus::Unknown,
            accessibility: PermissionStatus::Denied,
        };
        let missing = checker.missing_permissions();
        assert_eq!(missing.len(), 3);
        assert!(missing.contains(&Permission::InputMonitoring));
        assert!(missing.contains(&Permission::Microphone));
        assert!(missing.contains(&Permission::Accessibility));
    }
}
