#[cfg(target_os = "macos")]
use crate::permissions;

#[cfg(target_os = "macos")]
pub(super) fn check_permissions_and_prompt() -> bool {
    use crate::permissions::{Permission, PermissionChecker};

    let checker = permissions::create_permission_checker();

    for permission in Permission::all() {
        let status = checker.check(*permission);
        if status.is_granted() {
            tracing::info!("{} permission: granted", permission.display_name());
        } else {
            tracing::warn!("{} permission: NOT granted", permission.display_name());
        }
    }

    let all_granted = checker.all_granted();
    if !all_granted {
        let missing = checker.missing_permissions();
        tracing::info!(
            "Missing permissions will be shown in UI banner: {:?}",
            missing.iter().map(|p| p.display_name()).collect::<Vec<_>>()
        );
    }

    all_granted
}

#[cfg(not(target_os = "macos"))]
pub(super) fn check_permissions_and_prompt() -> bool {
    true
}
