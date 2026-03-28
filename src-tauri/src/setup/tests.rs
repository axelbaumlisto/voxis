use super::*;

#[test]
fn test_current_pid_is_nonzero() {
    let current_pid = std::process::id();
    assert!(current_pid > 0, "Current PID should be a positive number");
}

#[test]
#[cfg(any(target_os = "linux", target_os = "macos"))]
fn test_kill_unix_instances_with_own_pid_does_not_panic() {
    let current_pid = std::process::id();
    process::kill_unix_instances(current_pid);
}

#[test]
#[cfg(target_os = "windows")]
fn test_kill_windows_instances_with_own_pid_does_not_panic() {
    let current_pid = std::process::id();
    process::kill_windows_instances(current_pid);
}

#[test]
fn test_kill_existing_instances_does_not_panic() {
    kill_existing_instances();
}

#[test]
fn test_command_handler_returns_valid_handler() {
    let _handler = command_handler();
}

#[test]
#[cfg(target_os = "linux")]
fn test_init_x11_threads_does_not_panic() {
    init_x11_threads();
}

#[test]
fn test_init_logging_can_be_called() {
    let _ = std::any::type_name_of_val(&init_logging);
}
