/// Kill processes on Unix systems (Linux & macOS).
/// Uses pgrep to find processes and kill -9 to terminate them.
#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(super) fn kill_unix_instances(current_pid: u32) {
    use std::process::Command;

    if let Ok(output) = Command::new("pgrep").args(["-x", "voice"]).output() {
        let pids = String::from_utf8_lossy(&output.stdout);
        for pid_str in pids.lines() {
            if let Ok(pid) = pid_str.trim().parse::<u32>() {
                if pid != current_pid {
                    let _ = Command::new("kill").args(["-9", &pid.to_string()]).output();
                    tracing::info!("Killed existing instance with PID {}", pid);
                }
            }
        }
    }
}

/// Kill processes on Windows.
/// Uses tasklist to find processes and taskkill to terminate them.
#[cfg(target_os = "windows")]
pub(super) fn kill_windows_instances(current_pid: u32) {
    use std::process::Command;

    if let Ok(output) = Command::new("tasklist")
        .args(["/FI", "IMAGENAME eq voice.exe", "/FO", "CSV", "/NH"])
        .output()
    {
        let lines = String::from_utf8_lossy(&output.stdout);
        for line in lines.lines() {
            if let Some(pid_str) = line.split(',').nth(1) {
                let pid_str = pid_str.trim().trim_matches('"');
                if let Ok(pid) = pid_str.parse::<u32>() {
                    if pid != current_pid {
                        let _ = Command::new("taskkill")
                            .args(["/F", "/PID", &pid.to_string()])
                            .output();
                        tracing::info!("Killed existing instance with PID {}", pid);
                    }
                }
            }
        }
    }
}

/// Kill any existing instances of the app.
/// This ensures only one instance runs at a time.
pub fn kill_existing_instances() {
    let current_pid = std::process::id();

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    kill_unix_instances(current_pid);

    #[cfg(target_os = "windows")]
    kill_windows_instances(current_pid);
}
