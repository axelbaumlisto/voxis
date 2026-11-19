//! D3 (`.pi/plans/ideal.md`): "the keyboard is not reaching Voxis" made
//! visible. macOS *Secure Event Input* is a session-wide state a password
//! field (Terminal's `sudo`, a browser's password box, 1Password's lock
//! screen…) turns on; while it is on, NO process gets keyboard events from
//! the HID tap `rdev` uses — the global hotkey goes dead with no error
//! anywhere. This module asks the OS (`IsSecureEventInputEnabled`, HIToolbox)
//! and reads the process macOS attributes it to (`kCGSSessionSecureInputPID`
//! in IOKit's console-users record, via `ioreg`), so the banner can say
//! "macOS points at Terminal" instead of the user reinstalling Voxis.
//!
//! That attribution is a HINT, not a fact. When macOS cannot attribute the
//! state it writes `loginwindow`'s pid; `credible_holder` turns that (and a
//! pid whose process no longer resolves) into "no holder named", so the
//! banner never sends a person after a system process they cannot act on.
//!
//! The parser is pure and tested; the two probes are thin and macOS-only.

/// What the banner shows.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
pub struct SecureInputStatus {
    /// `true` while some process holds Secure Event Input.
    pub enabled: bool,
    /// The pid macOS attributes the state to — `None` unless it names an
    /// app a person can act on (see `credible_holder`).
    pub holder_pid: Option<u32>,
    /// That process's name (`ps -o comm=`). Set exactly when `holder_pid` is.
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

/// macOS writes this process's pid into the record when it cannot attribute
/// Secure Input to an app (2026-11-19: the banner blamed it for an hour while
/// a browser password field held the state).
const UNATTRIBUTED_PLACEHOLDER: &str = "loginwindow";

/// The holder worth showing: a pid whose process resolved to a name that is
/// not the OS's "could not attribute" placeholder. Anything else is `None` —
/// a nameless pid or a system process gives the reader nothing to do.
pub fn credible_holder(pid: Option<u32>, name: Option<String>) -> Option<(u32, String)> {
    match (pid, name) {
        (Some(pid), Some(name)) if name != UNATTRIBUTED_PLACEHOLDER => Some((pid, name)),
        _ => None,
    }
}

#[cfg(target_os = "macos")]
mod probe {
    use super::{credible_holder, parse_secure_input_pid, SecureInputStatus};
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
        let pid = holder_pid();
        let (holder_pid, holder_name) = credible_holder(pid, pid.and_then(process_name)).unzip();
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

    /// Manual probe: `cargo test secure_input_live_probe -- --ignored --nocapture`
    /// while a Terminal `sudo` prompt is open should print `enabled: true`
    /// with Terminal as the holder; with nothing holding it, `OFF`.
    #[test]
    #[ignore]
    fn secure_input_live_probe() {
        println!("{:?}", check_secure_input());
    }

    #[test]
    fn loginwindow_is_the_os_placeholder_not_a_holder() {
        // 2026-11-19: the banner said "held by loginwindow (pid 421)" for an
        // hour while the real holder was a browser password field. macOS
        // writes loginwindow's pid when it cannot attribute the state.
        assert_eq!(credible_holder(Some(421), Some("loginwindow".into())), None);
    }

    #[test]
    fn a_named_app_is_a_credible_holder() {
        assert_eq!(credible_holder(Some(812), Some("Terminal".into())), Some((812, "Terminal".to_string())));
    }

    #[test]
    fn a_pid_whose_name_did_not_resolve_is_not_a_holder() {
        // A dead pid left in the record: nothing a person can act on.
        assert_eq!(credible_holder(Some(645), None), None);
        assert_eq!(credible_holder(None, None), None);
    }

    #[test]
    fn off_is_the_all_none_status() {
        assert_eq!(SecureInputStatus::OFF, SecureInputStatus { enabled: false, holder_pid: None, holder_name: None });
    }
}
