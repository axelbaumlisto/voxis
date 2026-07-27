//! Diagnostics export — opt-in, 100% local, on-demand.
//!
//! Bundles the app's `logs/` directory and (when present) the `debug/`
//! directory into a fresh `diagnostics-export-<unix-timestamp>/` folder inside
//! the config directory, plus a redacted `config-summary.txt`. No network call
//! anywhere — the user hands the folder to a maintainer manually.
//!
//! ## Why a plain directory copy (not a zip)?
//! Per the project's KISS / avoid-unnecessary-deps preference: adding a `zip`
//! crate or `tauri-plugin-dialog` for a save-dialog is more machinery than this
//! feature warrants. Exporting into a well-known folder under the config dir
//! and returning that path to the UI is dependency-free (`std::fs` only) and
//! trivially discoverable.
//!
//! ## Redaction (security-critical)
//! The exported `config-summary.txt` NEVER contains secret values. Any config
//! field whose name looks key/secret-shaped (`api_key`, `*key*`, `*secret*`,
//! `*token*`, `*password*`) is emitted as `[REDACTED - present]` or `[not set]`
//! — only presence, never the value. Non-secret values (hotkey, model,
//! language, …) are included verbatim since they aid diagnosis and aren't
//! sensitive. `history.db` and `dictionary.txt` (personal content, not
//! diagnostics) are never copied — only `logs/` and `debug/` are.

use crate::diagnostics::{
    fatal, heartbeat,
    report::{
        self, CrashDiagnosticsInput, CrashDiagnosticsReport, CrashLogEvidence,
        FatalInstallErrorInput, HeartbeatEvidence, HeartbeatObservedInput, HeartbeatSnapshotInput,
        ReportedUncleanInput,
    },
};
use crate::error::{BoxedIntoCommandError, IntoCommandError};
use crate::storage::AppPaths;
use serde::Deserialize;
use serde_json::Value;
use std::fs;
use std::io;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

/// Export local diagnostics into a fresh timestamped folder under the config
/// directory and return the created folder's absolute path as a String.
#[tauri::command]
#[specta::specta]
pub fn export_diagnostics(paths: State<AppPaths>) -> Result<String, String> {
    let config = super::get_factory(&paths).config().load().cmd_err()?;
    let config_dir = paths.config_dir().clone();
    export_diagnostics_into(&config_dir, &config).cmd_err()
}

/// Return the current local crash-diagnostics evidence without requiring an export.
#[tauri::command]
#[specta::specta]
pub fn get_crash_diagnostics(paths: State<AppPaths>) -> Result<CrashDiagnosticsReport, String> {
    Ok(build_crash_diagnostics_report(paths.config_dir()))
}

/// Core implementation, decoupled from Tauri `State` so it is unit-testable.
fn export_diagnostics_into(
    config_dir: &Path,
    config: &crate::config::AppConfig,
) -> std::io::Result<String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let export_dir = config_dir.join(format!("diagnostics-export-{timestamp}"));
    fs::create_dir_all(&export_dir)?;

    // Logs live at <config>/logs (see setup::logging), debug at <config>/debug.
    let logs_dir = config_dir.join("logs");
    if logs_dir.is_dir() {
        copy_dir_contents(&logs_dir, &export_dir.join("logs"))?;
    }
    let debug_dir = config_dir.join("debug");
    if debug_dir.is_dir() {
        copy_dir_contents(&debug_dir, &export_dir.join("debug"))?;
    }

    let summary = build_config_summary(config);
    fs::write(export_dir.join("config-summary.txt"), summary)?;

    let crash_report = build_crash_diagnostics_report(config_dir);
    write_crash_diagnostics_files(&export_dir, &crash_report)?;

    Ok(export_dir.to_string_lossy().to_string())
}

fn write_crash_diagnostics_files(
    export_dir: &Path,
    crash_report: &CrashDiagnosticsReport,
) -> io::Result<()> {
    // Export only the sanitized summary, not personal history/dictionary data.
    // Fatal breadcrumbs are safe by construction: Task 3 records only Voxis-owned
    // &'static str literals, never transcription text, user paths, or API keys.
    let diagnostics_dir = export_dir.join("diagnostics");
    fs::create_dir_all(&diagnostics_dir)?;
    let json = serde_json::to_string_pretty(crash_report)
        .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))?;
    fs::write(diagnostics_dir.join("crash-diagnostics.json"), json)?;
    fs::write(
        diagnostics_dir.join("crash-diagnostics.txt"),
        report::render_report_text(crash_report),
    )?;
    Ok(())
}

fn build_crash_diagnostics_report(config_dir: &Path) -> CrashDiagnosticsReport {
    let input = CrashDiagnosticsInput {
        crash_log: read_crash_log_evidence(config_dir),
        heartbeat: read_heartbeat_evidence(config_dir),
        fatal_install_error: fatal::last_install_error().map(|error| FatalInstallErrorInput {
            step: format!("{:?}", error.step),
            os_error: error.os_error,
        }),
        now_wall_ts: now_unix(),
        now_monotonic_ms: Some(crate::diagnostics::breadcrumbs::monotonic_ms_now()),
    };
    report::crash_diagnostics_report(&input)
}

fn read_crash_log_evidence(config_dir: &Path) -> CrashLogEvidence {
    let diagnostics_dir = config_dir.join("diagnostics");
    let current = diagnostics_dir.join("crash.log");
    let backup = diagnostics_dir.join("crash.log.1");
    let existing: Vec<_> = [&backup, &current]
        .into_iter()
        .filter(|path| path.exists())
        .collect();

    if existing.is_empty() {
        return CrashLogEvidence::Missing;
    }

    let mut combined = String::new();
    for path in existing {
        match fs::read_to_string(path) {
            Ok(text) => {
                if !combined.is_empty() && !combined.ends_with('\n') {
                    combined.push('\n');
                }
                combined.push_str(&text);
            }
            Err(error) => {
                return CrashLogEvidence::Unreadable {
                    error: report::redact_sensitive_text(&error.to_string()),
                };
            }
        }
    }

    CrashLogEvidence::Present(report::parse_crash_log(&combined))
}

#[derive(Deserialize)]
struct ReportedUncleanShutdownOnDisk {
    reported_at_wall_ts: u64,
    snapshot: heartbeat::HeartbeatSnapshot,
}

fn read_heartbeat_evidence(config_dir: &Path) -> HeartbeatEvidence {
    let diagnostics_dir = config_dir.join("diagnostics");
    let heartbeat_path = diagnostics_dir.join("heartbeat.json");
    let crashed_path = diagnostics_dir.join("heartbeat.crashed.json");

    let heartbeat_present = heartbeat_path.exists();
    let reported_unclean_present = crashed_path.exists();
    if !heartbeat_present && !reported_unclean_present {
        return HeartbeatEvidence::MissingAll;
    }

    let heartbeat_snapshot = if heartbeat_present {
        read_json_file::<heartbeat::HeartbeatSnapshot>(&heartbeat_path).ok()
    } else {
        None
    };
    let reported_unclean = if reported_unclean_present {
        read_json_file::<ReportedUncleanShutdownOnDisk>(&crashed_path).ok()
    } else {
        None
    };

    HeartbeatEvidence::Observed(Box::new(HeartbeatObservedInput {
        heartbeat: heartbeat_snapshot.as_ref().map(heartbeat_snapshot_input),
        heartbeat_parse_error: heartbeat_present && heartbeat_snapshot.is_none(),
        reported_unclean: reported_unclean.as_ref().map(|reported| ReportedUncleanInput {
            reported_at_wall_ts: reported.reported_at_wall_ts,
            snapshot: heartbeat_snapshot_input(&reported.snapshot),
        }),
        reported_unclean_parse_error: reported_unclean_present && reported_unclean.is_none(),
    }))
}

fn read_json_file<T: for<'de> Deserialize<'de>>(path: &Path) -> io::Result<T> {
    let bytes = fs::read(path)?;
    serde_json::from_slice(&bytes).map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))
}

fn heartbeat_snapshot_input(snapshot: &heartbeat::HeartbeatSnapshot) -> HeartbeatSnapshotInput {
    HeartbeatSnapshotInput {
        pid: snapshot.pid,
        wall_ts: snapshot.wall_ts,
        uptime_s: snapshot.monotonic_uptime_s,
        process_start_unix_s: snapshot.process_start_unix_s,
        last_breadcrumb: snapshot
            .last_breadcrumb
            .as_deref()
            .map(report::redact_sensitive_text),
        rss_kb: snapshot.rss_kb,
        recording_state: snapshot
            .recording_state
            .as_deref()
            .map(report::redact_sensitive_text),
        queue_depth: snapshot.queue_depth,
        last_transcription_outcome: snapshot
            .last_transcription_outcome
            .as_deref()
            .map(report::redact_sensitive_text),
        overlay_backend: snapshot
            .overlay_backend
            .as_deref()
            .map(report::redact_sensitive_text),
    }
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

/// Recursively copy the regular files under `source` into `destination`.
/// Non-regular files (sockets, FIFOs) are skipped — they carry no diagnostics.
fn copy_dir_contents(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let dest_path = destination.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_contents(&entry.path(), &dest_path)?;
        } else if file_type.is_file() {
            fs::copy(entry.path(), &dest_path)?;
        }
    }
    Ok(())
}

/// Build the redacted `config-summary.txt` body from an `AppConfig`.
///
/// Serialises the config to JSON and walks it, flattening nested objects to
/// dotted keys (`llm.api_key`). Secret-shaped keys never leak their value.
fn build_config_summary(config: &crate::config::AppConfig) -> String {
    let mut lines = vec![
        "# Voxis diagnostics — redacted config summary".to_string(),
        "# Secret-shaped fields show presence only, never their value.".to_string(),
        String::new(),
    ];
    let value = serde_json::to_value(config).unwrap_or(Value::Null);
    let mut flat: Vec<String> = Vec::new();
    flatten_value("", &value, &mut flat);
    flat.sort();
    lines.extend(flat);
    lines.push(String::new());
    lines.join("\n")
}

/// Recursively flatten a JSON value into `key = value` lines, redacting the
/// values of secret-shaped keys.
fn flatten_value(prefix: &str, value: &Value, out: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                let path = if prefix.is_empty() {
                    key.clone()
                } else {
                    format!("{prefix}.{key}")
                };
                flatten_value(&path, child, out);
            }
        }
        _ => {
            if is_secret_key(prefix) {
                let present = !is_empty_value(value);
                out.push(format!(
                    "{prefix} = {}",
                    if present {
                        "[REDACTED - present]"
                    } else {
                        "[not set]"
                    }
                ));
            } else {
                out.push(format!("{prefix} = {}", render_scalar(value)));
            }
        }
    }
}

/// Whether a (possibly dotted) config key is secret-shaped and must be redacted.
fn is_secret_key(key: &str) -> bool {
    report::is_secret_key_name(key)
}

/// True when the value is "unset" for presence purposes (empty string / null).
fn is_empty_value(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::String(s) => s.is_empty(),
        _ => false,
    }
}

/// Render a non-secret scalar for the summary.
fn render_scalar(value: &Value) -> String {
    match value {
        Value::Null => "[not set]".to_string(),
        Value::String(s) if s.is_empty() => "[empty]".to_string(),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::AppConfig;

    /// SECURITY-CRITICAL: even with real secrets set, the exported summary must
    /// never contain their values — only presence markers.
    #[test]
    fn config_summary_never_contains_real_secrets() {
        let secret = "gsk_SUPER_SECRET_API_KEY_1234567890";
        let llm_secret = "sk-LLM_PROVIDER_SECRET_ABCDEF";
        let config = AppConfig {
            api_key: secret.to_string(),
            model: "whisper-large-v3".to_string(),
            hotkey: "ctrl_r".to_string(),
            llm: crate::config::LlmConfig {
                api_key: llm_secret.to_string(),
                ..Default::default()
            },
            ..AppConfig::default()
        };

        let summary = build_config_summary(&config);

        // The actual secret bytes must be absent.
        assert!(
            !summary.contains(secret),
            "top-level api_key value leaked into summary:\n{summary}"
        );
        assert!(
            !summary.contains(llm_secret),
            "llm.api_key value leaked into summary:\n{summary}"
        );
        // Presence is still recorded (redacted).
        assert!(
            summary.contains("api_key = [REDACTED - present]"),
            "expected redacted-present marker for set api_key:\n{summary}"
        );
        assert!(
            summary.contains("llm.api_key = [REDACTED - present]"),
            "expected redacted-present marker for set llm.api_key:\n{summary}"
        );
        // Non-secret values ARE included verbatim (they aid diagnosis).
        assert!(summary.contains("model = whisper-large-v3"));
        assert!(summary.contains("hotkey = ctrl_r"));
    }

    #[test]
    fn config_summary_marks_unset_secrets_not_set() {
        let config = AppConfig::default(); // empty api_key
        let summary = build_config_summary(&config);
        assert!(
            summary.contains("api_key = [not set]"),
            "expected [not set] for empty api_key:\n{summary}"
        );
    }

    #[test]
    fn is_secret_key_classifies_correctly() {
        assert!(is_secret_key("api_key"));
        assert!(is_secret_key("llm.api_key"));
        assert!(is_secret_key("some.provider.secret"));
        assert!(is_secret_key("access_token"));
        assert!(is_secret_key("password"));
        // Not secrets:
        assert!(!is_secret_key("hotkey"));
        assert!(!is_secret_key("auto_submit_key"));
        assert!(!is_secret_key("model"));
        assert!(!is_secret_key("language"));
    }

    #[test]
    fn export_copies_logs_and_debug_and_writes_summary() {
        let temp = tempfile::tempdir().unwrap();
        let config_dir = temp.path();

        // Seed logs/ and debug/ with sample files.
        let logs = config_dir.join("logs");
        fs::create_dir_all(&logs).unwrap();
        fs::write(logs.join("voice.log"), b"hello log").unwrap();
        let debug = config_dir.join("debug");
        fs::create_dir_all(&debug).unwrap();
        fs::write(debug.join("entry.jsonl"), b"{\"a\":1}").unwrap();

        let config = AppConfig {
            api_key: "gsk_secret_value".to_string(),
            ..AppConfig::default()
        };

        let out = export_diagnostics_into(config_dir, &config).unwrap();
        let out_dir = Path::new(&out);

        assert!(out_dir.is_dir());
        assert!(out_dir.file_name().unwrap().to_string_lossy().starts_with("diagnostics-export-"));
        assert_eq!(
            fs::read(out_dir.join("logs/voice.log")).unwrap(),
            b"hello log"
        );
        assert_eq!(
            fs::read(out_dir.join("debug/entry.jsonl")).unwrap(),
            b"{\"a\":1}"
        );
        let summary = fs::read_to_string(out_dir.join("config-summary.txt")).unwrap();
        assert!(!summary.contains("gsk_secret_value"));
        assert!(summary.contains("api_key = [REDACTED - present]"));
        assert!(out_dir.join("diagnostics/crash-diagnostics.json").exists());
        assert!(out_dir.join("diagnostics/crash-diagnostics.txt").exists());
    }

    #[test]
    fn crash_diagnostics_export_withholds_json_panic_payload_text() {
        let temp = tempfile::tempdir().unwrap();
        let config_dir = temp.path();
        let diagnostics = config_dir.join("diagnostics");
        fs::create_dir_all(&diagnostics).unwrap();
        fs::write(
            diagnostics.join("crash.log"),
            b"{\"panic_message\":\"boom api_key=gsk_SHOULD_NOT_LEAK_12345 token=sk-LEAKLEAKLEAK transcript private dictated phrase zebra\",\"timestamp\":\"2026-07-27T00:00:00Z\"}\n",
        )
        .unwrap();

        let out = export_diagnostics_into(config_dir, &AppConfig::default()).unwrap();
        let out_dir = Path::new(&out);
        let text = fs::read_to_string(out_dir.join("diagnostics/crash-diagnostics.txt")).unwrap();
        let json = fs::read_to_string(out_dir.join("diagnostics/crash-diagnostics.json")).unwrap();

        for exported in [&text, &json] {
            assert!(!exported.contains("boom"), "{exported}");
            assert!(!exported.contains("gsk_SHOULD_NOT_LEAK_12345"), "{exported}");
            assert!(!exported.contains("sk-LEAKLEAKLEAK"), "{exported}");
            assert!(!exported.contains("private dictated phrase zebra"), "{exported}");
            assert!(exported.contains("message withheld"), "{exported}");
        }
    }

    #[test]
    fn crash_diagnostics_reads_malformed_files_without_panicking() {
        let temp = tempfile::tempdir().unwrap();
        let diagnostics = temp.path().join("diagnostics");
        fs::create_dir_all(&diagnostics).unwrap();
        fs::write(diagnostics.join("crash.log"), b"not-json\n").unwrap();
        fs::write(diagnostics.join("heartbeat.json"), b"not-json").unwrap();
        fs::write(diagnostics.join("heartbeat.crashed.json"), b"not-json").unwrap();

        let report = build_crash_diagnostics_report(temp.path());
        let details = report.details.join("; ");
        assert!(details.contains("malformed/corrupt"), "{details}");
        assert!(details.contains("heartbeat.json corrupt"), "{details}");
        assert!(details.contains("heartbeat.crashed.json corrupt"), "{details}");
    }

    #[test]
    fn export_works_when_debug_dir_absent() {
        let temp = tempfile::tempdir().unwrap();
        let config_dir = temp.path();
        let logs = config_dir.join("logs");
        fs::create_dir_all(&logs).unwrap();
        fs::write(logs.join("voice.log"), b"log only").unwrap();

        let out = export_diagnostics_into(config_dir, &AppConfig::default()).unwrap();
        let out_dir = Path::new(&out);
        assert!(out_dir.join("logs/voice.log").exists());
        assert!(!out_dir.join("debug").exists());
        assert!(out_dir.join("config-summary.txt").exists());
    }
}
