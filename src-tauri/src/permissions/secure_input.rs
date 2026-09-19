//! D3 (`.pi/plans/ideal.md`): "the keyboard is not reaching Voxis" made
//! visible. macOS *Secure Event Input* is a session-wide state a password
//! field (Terminal's `sudo`, a browser's password box, 1Password's lock
//! screen…) turns on; while it is on, NO process gets keyboard events from
//! the HID tap `rdev` uses — the global hotkey goes dead with no error
//! anywhere. This module asks the OS (`IsSecureEventInputEnabled`, HIToolbox)
//! and names the process holding it (`kCGSSessionSecureInputPID` in IOKit's
//! console-users record, via `ioreg`), so the banner can say "Secure Input is
//! on — held by Terminal (pid 812)" instead of the user reinstalling Voxis.
//!
//! The parser is pure and tested; the two probes are thin and macOS-only.

/// What the banner shows.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
pub struct SecureInputStatus {
    /// `true` while some process holds Secure Event Input.
    pub enabled: bool,
    /// The holder's pid, when the console-users record names one.
    pub holder_pid: Option<u32>,
    /// The holder's process name (`ps -o comm=`), when the pid resolved.
    pub holder_name: Option<String>,
}

impl SecureInputStatus {
    pub const OFF: SecureInputStatus = SecureInputStatus { enabled: false, holder_pid: None, holder_name: None };
}

/// Pulls `kCGSSessionSecureInputPID` out of an `ioreg -l -w 0` dump.
/// The record looks like `"kCGSSessionSecureInputPID"=812` inside the
/// `IOConsoleUsers` array; `0`/absent means nobody holds it.
pub fn parse_secure_input_pid(ioreg_dump: &str) -> Option<u32> {
    const KEY: &str = "\"kCGSSessionSecureInputPID\"=";
    let start = ioreg_dump.find(KEY)? + KEY.len();
    let digits: String = ioreg_dump[start..].chars().take_while(|c| c.is_ascii_digit()).collect();
    match digits.parse::<u32>() {
        Ok(0) | Err(_) => None,
        Ok(pid) => Some(pid),
    }
}

#[cfg(target_os = "macos")]
mod probe {
    use super::{parse_secure_input_pid, SecureInputStatus};
    use std::process::Command;

    #[link(name = "Carbon", kind = "framework")]
    extern "C" {
        fn IsSecureEventInputEnabled() -> bool;
    }

    fn holder_pid() -> Option<u32> {
        let out = Command::new("ioreg").args(["-l", "-w", "0", "-d", "1", "-c", "IOHIDSystem"]).output().ok()?;
        parse_secure_input_pid(&String::from_utf8_lossy(&out.stdout))
    }

    fn process_name(pid: u32) -> Option<String> {
        let out = Command::new("ps").args(["-o", "comm=", "-p", &pid.to_string()]).output().ok()?;
        let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if name.is_empty() {
            None
        } else {
            Some(name.rsplit('/').next().unwrap_or(&name).to_string())
        }
    }

    pub fn check() -> SecureInputStatus {
        let enabled = unsafe { IsSecureEventInputEnabled() };
        if !enabled {
            return SecureInputStatus::OFF;
        }
        let holder_pid = holder_pid();
        let holder_name = holder_pid.and_then(process_name);
        SecureInputStatus { enabled, holder_pid, holder_name }
    }
}

/// Current Secure Event Input state. Always `OFF` off macOS: the concept
/// does not exist there, and saying so beats a stub that pretends to probe.
pub fn check_secure_input() -> SecureInputStatus {
    #[cfg(target_os = "macos")]
    {
        probe::check()
    }
    #[cfg(not(target_os = "macos"))]
    {
        SecureInputStatus::OFF
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_holder_pid_out_of_an_ioreg_console_users_record() {
        let dump = r#"
    | |   "IOConsoleUsers" = ({"kCGSSessionOnConsoleKey"=Yes,"kCGSSessionUserIDKey"=501,"kCGSSessionSecureInputPID"=812,"kCGSSessionLoginDoneKey"=Yes})
"#;
        assert_eq!(parse_secure_input_pid(dump), Some(812));
    }

    #[test]
    fn zero_or_absent_pid_means_nobody_holds_secure_input() {
        assert_eq!(parse_secure_input_pid(r#""kCGSSessionSecureInputPID"=0,"x"=1"#), None);
        assert_eq!(parse_secure_input_pid(r#""kCGSSessionOnConsoleKey"=Yes"#), None);
        assert_eq!(parse_secure_input_pid(""), None);
    }

    #[test]
    fn a_malformed_value_is_not_a_pid() {
        assert_eq!(parse_secure_input_pid(r#""kCGSSessionSecureInputPID"=abc"#), None);
    }

    #[test]
    fn off_is_the_all_none_status() {
        assert_eq!(SecureInputStatus::OFF, SecureInputStatus { enabled: false, holder_pid: None, holder_name: None });
    }
}
