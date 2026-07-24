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

use crate::error::{BoxedIntoCommandError, IntoCommandError};
use crate::storage::AppPaths;
use serde_json::Value;
use std::fs;
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

    Ok(export_dir.to_string_lossy().to_string())
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
    let leaf = key.rsplit('.').next().unwrap_or(key).to_lowercase();
    leaf.contains("api_key")
        || leaf.contains("apikey")
        || leaf.contains("secret")
        || leaf.contains("token")
        || leaf.contains("password")
        // Catch any lone "key"-suffixed field, but not innocuous ones like
        // "hotkey" / "auto_submit_key" which are not credentials.
        || leaf == "key"
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
