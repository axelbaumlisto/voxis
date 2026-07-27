//! Always-on crash heartbeat snapshot.
//!
//! Origin: adapted from Clipshot's Task-4 crash heartbeat witness
//! (`/home/sham/work/clipshot/src/diagnostics/heartbeat.rs`). Keep this note so
//! fixes to durable unclean-shutdown detection can be mirrored deliberately.
//!
//! This is the only deliberate steady-state diagnostics writer: one compact
//! JSON file, atomically replaced every 10 seconds. It exists because SIGKILL is
//! uncatchable; the last heartbeat is the only in-process evidence that can
//! survive that class of death.
//!
//! # PID-liveness honesty
//!
//! Startup staleness uses `kill(pid, 0)` on Unix (`EPERM` counts as alive) and
//! treats a Linux `/proc/<pid>/stat` process-start mismatch as PID reuse. Linux
//! exposes start time in clock ticks; this module stores the derived Unix second,
//! so there is a residual same-second PID-reuse window. On non-Linux Unix the
//! fallback is `kill(pid, 0)` only, which proves only that some process with that
//! PID exists. Windows currently uses a best-effort `tasklist` probe with the
//! same PID-reuse limitation.

use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::diagnostics::breadcrumbs::{self, BreadcrumbRecord};

pub const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(10);
const HEARTBEAT_FILE_NAME: &str = "heartbeat.json";
const CLEAN_MARKER_FILE_NAME: &str = "heartbeat.clean.json";
const CRASHED_HEARTBEAT_FILE_NAME: &str = "heartbeat.crashed.json";
const BREADCRUMB_SNAPSHOT_CAPACITY: usize = 80;

static STARTUP_CHECK_DONE: AtomicBool = AtomicBool::new(false);
static WRITER_STARTED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HeartbeatSnapshot {
    pub pid: u32,
    pub version: String,
    pub monotonic_uptime_s: u64,
    pub wall_ts: u64,
    pub process_start_unix_s: Option<u64>,
    pub last_breadcrumb: Option<String>,
    pub rss_kb: Option<u64>,
    pub recording_state: Option<String>,
    pub queue_depth: Option<usize>,
    pub last_transcription_outcome: Option<String>,
    pub overlay_backend: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct CleanShutdownMarker {
    pid: u32,
    wall_ts: u64,
    heartbeat_wall_ts: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct ReportedUncleanShutdown {
    pid: u32,
    wall_ts: u64,
    process_start_unix_s: Option<u64>,
    reported_at_wall_ts: u64,
    snapshot: HeartbeatSnapshot,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReportedUncleanShutdownDiagnostic {
    pub reported_at_wall_ts: u64,
    pub snapshot: HeartbeatSnapshot,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HeartbeatDiagnosticState {
    pub heartbeat_present: bool,
    pub heartbeat: Option<HeartbeatSnapshot>,
    pub heartbeat_parse_error: bool,
    pub reported_unclean_present: bool,
    pub reported_unclean: Option<ReportedUncleanShutdownDiagnostic>,
    pub reported_unclean_parse_error: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreviousRunVerdict {
    NoWarning,
    DiedUncleanly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StartupWarningDecision {
    Suppress,
    Emit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PidLiveness {
    AliveSameProcess,
    Dead,
    ReusedOrDifferentProcess,
}

/// Pure marker-validity decision. I/O parses the marker file; this function
/// decides only whether the parsed marker is allowed to suppress a warning.
fn clean_marker_is_valid(snapshot: &HeartbeatSnapshot, marker: Option<&CleanShutdownMarker>) -> bool {
    let Some(marker) = marker else {
        return false;
    };
    if marker.pid != snapshot.pid {
        return false;
    }
    if marker.heartbeat_wall_ts == Some(snapshot.wall_ts) {
        return true;
    }
    marker.wall_ts >= snapshot.wall_ts
}

/// Pure staleness decision. I/O decides pid liveness and parses the marker;
/// this core is deterministic and testable.
pub fn stale_heartbeat_verdict(
    heartbeat: Option<&HeartbeatSnapshot>,
    pid_liveness: PidLiveness,
    valid_clean_marker: bool,
) -> PreviousRunVerdict {
    let Some(_) = heartbeat else {
        return PreviousRunVerdict::NoWarning;
    };
    if valid_clean_marker || matches!(pid_liveness, PidLiveness::AliveSameProcess) {
        PreviousRunVerdict::NoWarning
    } else {
        PreviousRunVerdict::DiedUncleanly
    }
}

/// Log the previous unclean shutdown warning once per process. The durable
/// `heartbeat.crashed.json` record suppresses the same death across restarts.
/// Missing, empty, or corrupt heartbeat files are ignored.
pub fn log_previous_unclean_shutdown_once() {
    if STARTUP_CHECK_DONE.swap(true, Ordering::AcqRel) {
        return;
    }

    let Some(path) = heartbeat_path() else {
        return;
    };
    let Some(snapshot) = read_snapshot_best_effort(&path) else {
        return;
    };

    let marker = clean_marker_path().and_then(|path| read_clean_marker_best_effort(&path));
    let marker_valid = clean_marker_is_valid(&snapshot, marker.as_ref());
    let pid_liveness = pid_liveness_for_snapshot(&snapshot);
    let reported = crashed_heartbeat_path()
        .as_deref()
        .and_then(read_reported_unclean_shutdown_best_effort);

    if startup_warning_decision(
        Some(&snapshot),
        pid_liveness,
        marker_valid,
        reported.as_ref(),
    ) == StartupWarningDecision::Emit
    {
        tracing::warn!(
            "previous instance died without shutdown; last heartbeat: {}",
            snapshot_summary(&snapshot)
        );
        if let Err(err) = write_reported_unclean_shutdown(&snapshot) {
            tracing::debug!("unclean-shutdown report marker write failed: {err}");
        }
    }
}

/// Best-effort read of heartbeat diagnostics files for later reporting surfaces.
pub fn read_diagnostic_state() -> HeartbeatDiagnosticState {
    let heartbeat_path = heartbeat_path();
    let heartbeat_present = heartbeat_path.as_deref().is_some_and(Path::exists);
    let heartbeat = heartbeat_path.as_deref().and_then(read_snapshot_best_effort);
    let heartbeat_parse_error = heartbeat_present && heartbeat.is_none();

    let reported_path = crashed_heartbeat_path();
    let reported_unclean_present = reported_path.as_deref().is_some_and(Path::exists);
    let reported_unclean = reported_path
        .as_deref()
        .and_then(read_reported_unclean_shutdown_best_effort)
        .map(|reported| ReportedUncleanShutdownDiagnostic {
            reported_at_wall_ts: reported.reported_at_wall_ts,
            snapshot: reported.snapshot,
        });
    let reported_unclean_parse_error = reported_unclean_present && reported_unclean.is_none();

    HeartbeatDiagnosticState {
        heartbeat_present,
        heartbeat,
        heartbeat_parse_error,
        reported_unclean_present,
        reported_unclean,
        reported_unclean_parse_error,
    }
}

/// Start the low-rate heartbeat writer on a single sleeping OS thread. Multiple
/// calls in one process are ignored. The thread installs its own altstack and
/// failures are best-effort/debug-logged only.
pub fn spawn_background_writer() {
    let Some(path) = heartbeat_path() else {
        tracing::debug!("heartbeat writer not started: config directory is unavailable");
        return;
    };
    if WRITER_STARTED.swap(true, Ordering::AcqRel) {
        return;
    }

    if let Some(marker) = clean_marker_path() {
        let _ = remove_clean_marker_at(&marker);
    }

    if let Err(err) = std::thread::Builder::new()
        .name("voxis-heartbeat".to_string())
        .spawn(move || {
            crate::diagnostics::fatal::install_thread_altstack_best_effort();
            loop {
                if let Err(err) = write_current_snapshot(&path) {
                    tracing::debug!("heartbeat write failed: {err}");
                }
                std::thread::sleep(HEARTBEAT_INTERVAL);
            }
        })
    {
        tracing::debug!("heartbeat writer thread failed to start: {err}");
    }
}

/// Write the graceful-exit marker. Best-effort: failures never change shutdown
/// behavior.
pub fn write_clean_shutdown_marker() {
    if let Err(err) = write_clean_shutdown_marker_inner() {
        tracing::debug!("clean-shutdown marker write failed: {err}");
    }
}

fn write_clean_shutdown_marker_inner() -> io::Result<()> {
    let marker_path = clean_marker_path().ok_or_else(|| {
        io::Error::new(io::ErrorKind::NotFound, "config directory is unavailable")
    })?;
    let heartbeat = heartbeat_path()
        .as_deref()
        .and_then(read_snapshot_best_effort);
    let marker = CleanShutdownMarker {
        pid: std::process::id(),
        wall_ts: now_unix(),
        heartbeat_wall_ts: heartbeat.map(|snapshot| snapshot.wall_ts),
    };
    let json = serialize_clean_marker(&marker)?;
    persist_bytes_atomic(&marker_path, &json)
}

fn heartbeat_path() -> Option<PathBuf> {
    diagnostics_dir().map(|dir| dir.join(HEARTBEAT_FILE_NAME))
}

fn clean_marker_path() -> Option<PathBuf> {
    diagnostics_dir().map(|dir| dir.join(CLEAN_MARKER_FILE_NAME))
}

fn crashed_heartbeat_path() -> Option<PathBuf> {
    diagnostics_dir().map(|dir| dir.join(CRASHED_HEARTBEAT_FILE_NAME))
}

fn diagnostics_dir() -> Option<PathBuf> {
    let config_dir = crate::storage::paths::app_config_dir()?;
    let paths = crate::storage::AppPaths::from_config_dir(config_dir);
    Some(paths.config_dir().join("diagnostics"))
}

fn write_current_snapshot(path: &Path) -> io::Result<()> {
    let snapshot = collect_snapshot();
    write_snapshot_atomic(path, &snapshot)
}

fn remove_clean_marker_at(path: &Path) -> io::Result<()> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err),
    }
}

fn collect_snapshot() -> HeartbeatSnapshot {
    // Voxis-specific async state (recording state, queue depth, overlay backend)
    // lives behind Tauri/Tokio state and locks. The heartbeat writer must never
    // block the app or add new instrumentation outside this task, so these fields
    // are emitted as null; `last_breadcrumb` carries the cheap recent milestone.
    HeartbeatSnapshot {
        pid: std::process::id(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        monotonic_uptime_s: breadcrumbs::monotonic_ms_now() / 1000,
        wall_ts: now_unix(),
        process_start_unix_s: process_start_unix_s(std::process::id()),
        last_breadcrumb: last_breadcrumb_name(),
        rss_kb: current_rss_kb(),
        recording_state: None,
        queue_depth: None,
        last_transcription_outcome: None,
        overlay_backend: None,
    }
}

fn last_breadcrumb_name() -> Option<String> {
    let mut records = [BreadcrumbRecord::EMPTY; BREADCRUMB_SNAPSHOT_CAPACITY];
    let count = breadcrumbs::snapshot(&mut records);
    records[..count]
        .iter()
        .rev()
        .find(|record| !record.name.is_empty())
        .map(|record| record.name.to_string())
}

fn write_snapshot_atomic(path: &Path, snapshot: &HeartbeatSnapshot) -> io::Result<()> {
    let json = serialize_snapshot(snapshot)?;
    persist_bytes_atomic(path, &json)
}

fn serialize_snapshot(snapshot: &HeartbeatSnapshot) -> io::Result<Vec<u8>> {
    serde_json::to_vec(snapshot).map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))
}

fn serialize_clean_marker(marker: &CleanShutdownMarker) -> io::Result<Vec<u8>> {
    serde_json::to_vec(marker).map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))
}

/// Atomic, Windows/EXDEV-safe replacement: create the temp file in the
/// destination directory, write+sync it, then persist over the fixed target.
fn persist_bytes_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("heartbeat path has no parent dir: {}", path.display()),
            )
        })?;
    std::fs::create_dir_all(parent)?;

    let mut temp = tempfile::NamedTempFile::new_in(parent)?;
    set_owner_only(temp.as_file())?;
    temp.write_all(bytes)?;
    temp.as_file().sync_all()?;
    temp.persist(path).map_err(|err| err.error)?;
    Ok(())
}

fn read_snapshot_best_effort(path: &Path) -> Option<HeartbeatSnapshot> {
    std::fs::read(path)
        .ok()
        .and_then(|bytes| parse_snapshot_bytes(&bytes))
}

fn parse_snapshot_bytes(bytes: &[u8]) -> Option<HeartbeatSnapshot> {
    if bytes.is_empty() {
        return None;
    }
    serde_json::from_slice(bytes).ok()
}

fn read_clean_marker_best_effort(path: &Path) -> Option<CleanShutdownMarker> {
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
}

fn read_reported_unclean_shutdown_best_effort(path: &Path) -> Option<ReportedUncleanShutdown> {
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
}

fn startup_warning_decision(
    heartbeat: Option<&HeartbeatSnapshot>,
    pid_liveness: PidLiveness,
    valid_clean_marker: bool,
    previous_report: Option<&ReportedUncleanShutdown>,
) -> StartupWarningDecision {
    let Some(snapshot) = heartbeat else {
        return StartupWarningDecision::Suppress;
    };
    if stale_heartbeat_verdict(Some(snapshot), pid_liveness, valid_clean_marker)
        != PreviousRunVerdict::DiedUncleanly
    {
        return StartupWarningDecision::Suppress;
    }
    if previous_report.is_some_and(|report| report.matches_snapshot(snapshot)) {
        return StartupWarningDecision::Suppress;
    }
    StartupWarningDecision::Emit
}

impl ReportedUncleanShutdown {
    fn for_snapshot(snapshot: &HeartbeatSnapshot, reported_at_wall_ts: u64) -> Self {
        Self {
            pid: snapshot.pid,
            wall_ts: snapshot.wall_ts,
            process_start_unix_s: snapshot.process_start_unix_s,
            reported_at_wall_ts,
            snapshot: snapshot.clone(),
        }
    }

    fn matches_snapshot(&self, snapshot: &HeartbeatSnapshot) -> bool {
        self.pid == snapshot.pid
            && self.wall_ts == snapshot.wall_ts
            && self.process_start_unix_s == snapshot.process_start_unix_s
    }
}

fn write_reported_unclean_shutdown(snapshot: &HeartbeatSnapshot) -> io::Result<()> {
    let path = crashed_heartbeat_path().ok_or_else(|| {
        io::Error::new(io::ErrorKind::NotFound, "config directory is unavailable")
    })?;
    write_reported_unclean_shutdown_at(&path, snapshot, now_unix())
}

fn write_reported_unclean_shutdown_at(
    path: &Path,
    snapshot: &HeartbeatSnapshot,
    reported_at_wall_ts: u64,
) -> io::Result<()> {
    let report = ReportedUncleanShutdown::for_snapshot(snapshot, reported_at_wall_ts);
    let json = serde_json::to_vec(&report)
        .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))?;
    persist_bytes_atomic(path, &json)
}

fn snapshot_summary(snapshot: &HeartbeatSnapshot) -> String {
    serde_json::to_string(snapshot).unwrap_or_else(|_| format!("pid={}", snapshot.pid))
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

#[cfg(target_os = "linux")]
fn current_rss_kb() -> Option<u64> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    for line in status.lines() {
        let Some(rest) = line.strip_prefix("VmRSS:") else {
            continue;
        };
        return rest.split_whitespace().next()?.parse().ok();
    }
    None
}

#[cfg(not(target_os = "linux"))]
fn current_rss_kb() -> Option<u64> {
    None
}

#[cfg(unix)]
fn pid_liveness_for_snapshot(snapshot: &HeartbeatSnapshot) -> PidLiveness {
    if snapshot.pid == 0 {
        return PidLiveness::Dead;
    }

    // SAFETY: `kill(pid, 0)` performs permission/existence checks only; it does
    // not send a signal. `snapshot.pid` is a u32 captured from `process::id()`.
    let alive = unsafe { libc::kill(snapshot.pid as libc::pid_t, 0) == 0 };
    if !alive {
        let errno = io::Error::last_os_error().raw_os_error();
        if errno != Some(libc::EPERM) {
            return PidLiveness::Dead;
        }
    }

    if let (Some(expected), Some(actual)) = (
        snapshot.process_start_unix_s,
        process_start_unix_s(snapshot.pid),
    ) {
        if expected != actual {
            return PidLiveness::ReusedOrDifferentProcess;
        }
    }

    PidLiveness::AliveSameProcess
}

#[cfg(windows)]
fn pid_liveness_for_snapshot(snapshot: &HeartbeatSnapshot) -> PidLiveness {
    if snapshot.pid == 0 {
        return PidLiveness::Dead;
    }
    let alive = std::process::Command::new("tasklist")
        .args(["/FI", &format!("PID eq {}", snapshot.pid), "/NH"])
        .output()
        .map(|output| String::from_utf8_lossy(&output.stdout).contains(&snapshot.pid.to_string()))
        .unwrap_or(false);
    if alive {
        PidLiveness::AliveSameProcess
    } else {
        PidLiveness::Dead
    }
}

#[cfg(not(any(unix, windows)))]
fn pid_liveness_for_snapshot(_snapshot: &HeartbeatSnapshot) -> PidLiveness {
    PidLiveness::Dead
}

#[cfg(target_os = "linux")]
fn process_start_unix_s(pid: u32) -> Option<u64> {
    let ticks = process_start_ticks(pid)?;
    let boot = boot_time_unix_s()?;
    // SAFETY: sysconf with _SC_CLK_TCK has no memory-safety preconditions.
    let ticks_per_second = unsafe { libc::sysconf(libc::_SC_CLK_TCK) };
    if ticks_per_second <= 0 {
        return None;
    }
    Some(boot.saturating_add(ticks / ticks_per_second as u64))
}

#[cfg(not(target_os = "linux"))]
fn process_start_unix_s(_pid: u32) -> Option<u64> {
    None
}

#[cfg(target_os = "linux")]
fn process_start_ticks(pid: u32) -> Option<u64> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let close = stat.rfind(')')?;
    let rest = stat.get(close + 2..)?;
    // After the comm field, the first split field is kernel field 3 (`state`).
    // Kernel field 22 (`starttime`) is therefore split index 19.
    rest.split_whitespace().nth(19)?.parse().ok()
}

#[cfg(target_os = "linux")]
fn boot_time_unix_s() -> Option<u64> {
    let stat = std::fs::read_to_string("/proc/stat").ok()?;
    for line in stat.lines() {
        let Some(rest) = line.strip_prefix("btime ") else {
            continue;
        };
        return rest.trim().parse().ok();
    }
    None
}

#[cfg(unix)]
fn set_owner_only(file: &std::fs::File) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    file.set_permissions(std::fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn set_owner_only(_file: &std::fs::File) -> io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_snapshot(pid: u32) -> HeartbeatSnapshot {
        HeartbeatSnapshot {
            pid,
            version: "0.1.1-test".to_string(),
            monotonic_uptime_s: 42,
            wall_ts: 1_800_000_000,
            process_start_unix_s: Some(1_799_999_900),
            last_breadcrumb: Some("transcription:completed".to_string()),
            rss_kb: Some(12_345),
            recording_state: None,
            queue_depth: None,
            last_transcription_outcome: None,
            overlay_backend: None,
        }
    }

    #[test]
    fn heartbeat_stale_detection_dead_pid_without_marker_warns() {
        let snapshot = sample_snapshot(999_999);
        let verdict = stale_heartbeat_verdict(Some(&snapshot), PidLiveness::Dead, false);
        assert_eq!(verdict, PreviousRunVerdict::DiedUncleanly);
    }

    #[test]
    fn heartbeat_valid_marker_suppresses_warning() {
        let snapshot = sample_snapshot(999_999);
        let marker = CleanShutdownMarker {
            pid: snapshot.pid,
            wall_ts: snapshot.wall_ts + 1,
            heartbeat_wall_ts: Some(snapshot.wall_ts),
        };
        let verdict = stale_heartbeat_verdict(
            Some(&snapshot),
            PidLiveness::Dead,
            clean_marker_is_valid(&snapshot, Some(&marker)),
        );
        assert_eq!(verdict, PreviousRunVerdict::NoWarning);
    }

    #[test]
    fn heartbeat_live_pid_suppresses_warning() {
        let mut snapshot = sample_snapshot(std::process::id());
        snapshot.process_start_unix_s = process_start_unix_s(snapshot.pid);
        let liveness = pid_liveness_for_snapshot(&snapshot);
        let verdict = stale_heartbeat_verdict(Some(&snapshot), liveness, false);
        assert_eq!(liveness, PidLiveness::AliveSameProcess);
        assert_eq!(verdict, PreviousRunVerdict::NoWarning);
    }

    #[test]
    fn heartbeat_same_death_suppressed_across_independent_checks() {
        let dir = tempfile::tempdir().unwrap();
        let report_path = dir.path().join("heartbeat.crashed.json");
        let snapshot = sample_snapshot(777);

        assert_eq!(
            startup_warning_decision(Some(&snapshot), PidLiveness::Dead, false, None),
            StartupWarningDecision::Emit
        );

        write_reported_unclean_shutdown_at(&report_path, &snapshot, snapshot.wall_ts + 2)
            .unwrap();
        let reported = read_reported_unclean_shutdown_best_effort(&report_path).unwrap();

        assert_eq!(
            startup_warning_decision(
                Some(&snapshot),
                PidLiveness::Dead,
                false,
                Some(&reported),
            ),
            StartupWarningDecision::Suppress
        );
    }

    #[test]
    fn heartbeat_new_death_still_reports() {
        let dir = tempfile::tempdir().unwrap();
        let report_path = dir.path().join("heartbeat.crashed.json");
        let previous = sample_snapshot(777);
        write_reported_unclean_shutdown_at(&report_path, &previous, previous.wall_ts + 2)
            .unwrap();
        let reported = read_reported_unclean_shutdown_best_effort(&report_path).unwrap();

        let mut newer = sample_snapshot(777);
        newer.wall_ts = previous.wall_ts + 10;
        assert_eq!(
            startup_warning_decision(Some(&newer), PidLiveness::Dead, false, Some(&reported)),
            StartupWarningDecision::Emit
        );

        let mut other_start = previous.clone();
        other_start.process_start_unix_s = Some(previous.process_start_unix_s.unwrap() + 1);
        assert_eq!(
            startup_warning_decision(
                Some(&other_start),
                PidLiveness::Dead,
                false,
                Some(&reported),
            ),
            StartupWarningDecision::Emit
        );
    }

    #[test]
    fn heartbeat_missing_corrupt_empty_file_is_ignored() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("missing.json");
        assert!(read_snapshot_best_effort(&missing).is_none());
        assert!(parse_snapshot_bytes(b"").is_none());
        assert!(parse_snapshot_bytes(b"not json").is_none());
    }

    #[test]
    fn heartbeat_marker_wrong_pid_or_older_than_snapshot_is_invalid() {
        let snapshot = sample_snapshot(123);
        let wrong_pid = CleanShutdownMarker {
            pid: 456,
            wall_ts: snapshot.wall_ts + 1,
            heartbeat_wall_ts: Some(snapshot.wall_ts),
        };
        assert!(!clean_marker_is_valid(&snapshot, Some(&wrong_pid)));

        let older = CleanShutdownMarker {
            pid: snapshot.pid,
            wall_ts: snapshot.wall_ts - 1,
            heartbeat_wall_ts: None,
        };
        assert!(!clean_marker_is_valid(&snapshot, Some(&older)));
    }

    #[test]
    fn heartbeat_atomic_replacement_leaves_no_partial_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("heartbeat.json");
        std::fs::write(&path, b"partial").unwrap();

        let snapshot = sample_snapshot(123);
        write_snapshot_atomic(&path, &snapshot).unwrap();

        let bytes = std::fs::read(&path).unwrap();
        let parsed: HeartbeatSnapshot = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(parsed, snapshot);
        assert!(!String::from_utf8_lossy(&bytes).contains("partial"));
    }

    #[test]
    fn heartbeat_snapshot_serialization_stays_small() {
        let snapshot = sample_snapshot(123);
        let bytes = serialize_snapshot(&snapshot).unwrap();
        assert!(
            bytes.len() <= 320,
            "heartbeat snapshot should stay within a few hundred bytes, got {}: {}",
            bytes.len(),
            String::from_utf8_lossy(&bytes)
        );
        let parsed: HeartbeatSnapshot = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(parsed, snapshot);
    }

    #[test]
    fn heartbeat_report_preserves_evidence_files_for_task5() {
        let dir = tempfile::tempdir().unwrap();
        let heartbeat_path = dir.path().join("heartbeat.json");
        let report_path = dir.path().join("heartbeat.crashed.json");
        let snapshot = sample_snapshot(321);
        write_snapshot_atomic(&heartbeat_path, &snapshot).unwrap();

        write_reported_unclean_shutdown_at(&report_path, &snapshot, snapshot.wall_ts + 2)
            .unwrap();

        let heartbeat_after_report = read_snapshot_best_effort(&heartbeat_path).unwrap();
        assert_eq!(heartbeat_after_report, snapshot);

        let report = read_reported_unclean_shutdown_best_effort(&report_path).unwrap();
        assert_eq!(report.snapshot, snapshot);
        assert!(report.matches_snapshot(&snapshot));
    }

    #[test]
    fn heartbeat_writer_start_removes_stale_clean_marker_only() {
        let dir = tempfile::tempdir().unwrap();
        let marker_path = dir.path().join(CLEAN_MARKER_FILE_NAME);
        let heartbeat_path = dir.path().join(HEARTBEAT_FILE_NAME);
        let report_path = dir.path().join(CRASHED_HEARTBEAT_FILE_NAME);
        let snapshot = sample_snapshot(654);

        std::fs::write(&marker_path, b"stale clean marker").unwrap();
        write_snapshot_atomic(&heartbeat_path, &snapshot).unwrap();
        write_reported_unclean_shutdown_at(&report_path, &snapshot, snapshot.wall_ts + 2)
            .unwrap();

        remove_clean_marker_at(&marker_path).unwrap();

        assert!(!marker_path.exists());
        assert_eq!(read_snapshot_best_effort(&heartbeat_path).unwrap(), snapshot);
        assert!(read_reported_unclean_shutdown_best_effort(&report_path).is_some());
    }
}
