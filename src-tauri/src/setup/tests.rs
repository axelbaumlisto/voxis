use super::*;
use crate::theme_engine::{DirSource, ThemeEngineLoader};
use std::path::{Path, PathBuf};

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

/// Architectural lock: every command registered with specta
/// (collect_commands! in lib.rs) MUST also be registered with the
/// runtime dispatcher (generate_handler! in setup/mod.rs), otherwise
/// the frontend gets 'Command X not found' at runtime even though the
/// TS bindings look fine.
///
/// This test parses both source files and asserts the two command lists
/// match (modulo ordering). Catches the kind of bug where we add a new
/// Tauri command to one list but forget the other.
#[test]
fn specta_commands_match_generate_handler_commands() {
    fn extract_commands(
        path: &str,
        start_marker: &str,
        end_marker: &str,
    ) -> std::collections::BTreeSet<String> {
        let src = std::fs::read_to_string(path)
            .unwrap_or_else(|e| panic!("read {path}: {e}"));
        let start = src
            .find(start_marker)
            .unwrap_or_else(|| panic!("start marker '{start_marker}' not found in {path}"));
        let after_start = &src[start + start_marker.len()..];
        let end = after_start
            .find(end_marker)
            .unwrap_or_else(|| panic!("end marker '{end_marker}' not found in {path}"));
        let block = &after_start[..end];
        block
            .lines()
            .filter_map(|line| {
                // Strip comment, trailing comma, whitespace.
                let line = line.split("//").next().unwrap_or(line).trim();
                let line = line.trim_end_matches(',').trim();
                if line.is_empty() || line.starts_with('#') {
                    return None;
                }
                // Only keep lines that look like a path::to::command.
                if !line.contains("::") {
                    return None;
                }
                // Normalize: strip 'crate::' prefix so the two files
                // can use different prefixes (lib.rs uses crate::,
                // setup/mod.rs uses 'commands' via `use crate::commands`).
                let normalized = line
                    .strip_prefix("crate::commands::")
                    .or_else(|| line.strip_prefix("commands::"))
                    .unwrap_or(line);
                Some(normalized.to_string())
            })
            .collect()
    }

    let specta = extract_commands(
        "src/lib.rs",
        "tauri_specta::collect_commands![",
        "])",
    );
    let runtime = extract_commands(
        "src/setup/mod.rs",
        "tauri::generate_handler![",
        "]\n}",
    );

    let only_in_specta: Vec<&String> = specta.difference(&runtime).collect();
    let only_in_runtime: Vec<&String> = runtime.difference(&specta).collect();

    assert!(
        only_in_specta.is_empty() && only_in_runtime.is_empty(),
        "specta / generate_handler! command lists drift detected:\n\
         only in specta (will fail at runtime with 'Command X not found'):\n  {:#?}\n\
         only in generate_handler (missing from TS bindings):\n  {:#?}",
        only_in_specta,
        only_in_runtime,
    );
}

// --- builtin theme source ---

/// A debug build must read the themes from `src-tauri/themes` on disk, so
/// `bun run build:themes` plus Reload shows edits without a rebuild.
#[cfg(debug_assertions)]
#[test]
fn test_builtin_theme_source_in_debug_reads_the_dev_themes_folder() {
    let ids: Vec<String> = state::builtin_theme_source()
        .manifests()
        .into_iter()
        .map(|manifest| manifest.id)
        .collect();
    assert!(
        ids.iter().any(|id| id == "default"),
        "dev themes folder must provide 'default', got: {ids:?}"
    );
}

// --- overlay theme fallback ---

/// A scanned `[builtin, user]` loader whose builtin layer carries exactly `ids`
/// and whose (initially empty) user dir is returned next to it — the startup
/// fallback check needs both.
fn scanned_loader(tmp: &tempfile::TempDir, ids: &[&str]) -> (ThemeEngineLoader, PathBuf) {
    let builtin = tmp.path().join("builtin");
    for id in ids {
        let dir = builtin.join(id);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("theme.json"),
            format!(
                r#"{{"manifest_version":2,"id":"{id}","name":"{id}","api_version":1,"entry":"theme.js"}}"#
            ),
        )
        .unwrap();
        std::fs::write(dir.join("theme.js"), "export function mount(){}").unwrap();
    }
    let user_dir = tmp.path().join("user");
    let loader =
        ThemeEngineLoader::with_builtin(Box::new(DirSource::new(builtin)), user_dir.clone());
    loader.scan().unwrap();
    (loader, user_dir)
}

/// Write `user_dir/<id>/theme.json` (+ entry script unless `manifest` is the
/// literal to write instead).
fn write_user_theme(user_dir: &Path, id: &str, manifest: &str) {
    let dir = user_dir.join(id);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("theme.json"), manifest).unwrap();
    std::fs::write(dir.join("theme.js"), "export function mount(){}").unwrap();
}

/// An id the loader no longer finds is replaced by `default`.
#[test]
fn overlay_theme_fallback_unknown_id_switches_to_default() {
    let tmp = tempfile::TempDir::new().unwrap();
    let (loader, user_dir) = scanned_loader(&tmp, &["default", "orb_falls"]);
    assert_eq!(
        state::fallback_overlay_theme("ghost", &loader, &user_dir),
        Some("default")
    );
}

/// A theme that still resolves must not be touched.
#[test]
fn overlay_theme_fallback_existing_id_is_kept() {
    let tmp = tempfile::TempDir::new().unwrap();
    let (loader, user_dir) = scanned_loader(&tmp, &["default", "orb_falls"]);
    assert_eq!(
        state::fallback_overlay_theme("orb_falls", &loader, &user_dir),
        None
    );
}

/// `default` selected is already the fallback: nothing to rewrite.
#[test]
fn overlay_theme_fallback_default_selected_is_kept() {
    let tmp = tempfile::TempDir::new().unwrap();
    let (loader, user_dir) = scanned_loader(&tmp, &["default"]);
    assert_eq!(
        state::fallback_overlay_theme("default", &loader, &user_dir),
        None
    );
}

/// Without a `default` to fall back to, the configured value stays: never pick
/// another theme, never retry.
#[test]
fn overlay_theme_fallback_without_default_changes_nothing() {
    let tmp = tempfile::TempDir::new().unwrap();
    let (loader, user_dir) = scanned_loader(&tmp, &["orb_falls"]);
    assert_eq!(
        state::fallback_overlay_theme("ghost", &loader, &user_dir),
        None
    );
    assert_eq!(
        state::fallback_overlay_theme("default", &loader, &user_dir),
        None
    );
}

/// A user theme folder the loader does not know yet still counts as present:
/// the user's own theme is not "gone", so the selection is kept.
#[test]
fn overlay_theme_fallback_user_folder_keeps_the_selection() {
    let tmp = tempfile::TempDir::new().unwrap();
    let (loader, user_dir) = scanned_loader(&tmp, &["default"]);
    write_user_theme(
        &user_dir,
        "ghost_custom",
        r#"{"manifest_version":2,"id":"ghost_custom","name":"Ghost","api_version":1,"entry":"theme.js"}"#,
    );
    assert_eq!(
        state::fallback_overlay_theme("ghost_custom", &loader, &user_dir),
        None
    );
}

/// The regression this guards: a user theme that is momentarily unparsable is
/// skipped by the scan. Falling back here would persist `default` and throw the
/// user's selection away — the folder says the theme is still there.
#[test]
fn overlay_theme_fallback_broken_user_theme_keeps_the_selection() {
    let tmp = tempfile::TempDir::new().unwrap();
    let (loader, user_dir) = scanned_loader(&tmp, &["default"]);
    write_user_theme(&user_dir, "ghost_custom", "{not json");
    assert!(
        loader
            .scan()
            .unwrap()
            .iter()
            .all(|m| m.id != "ghost_custom"),
        "a broken user theme must be invisible to the loader"
    );
    assert_eq!(
        state::fallback_overlay_theme("ghost_custom", &loader, &user_dir),
        None,
        "a present-but-broken user theme must keep its selection"
    );
}

/// An unusable user dir hides every user theme from the scan. That is "cannot
/// tell", not "gone": persisting a fallback there would destroy the selection
/// of a theme that is merely unreachable right now.
#[test]
fn overlay_theme_fallback_unusable_user_dir_keeps_the_selection() {
    let tmp = tempfile::TempDir::new().unwrap();
    std::fs::write(tmp.path().join("user"), "not a directory").unwrap();
    let (loader, user_dir) = scanned_loader(&tmp, &["default"]);
    assert!(!user_dir.is_dir(), "the user dir must be unusable here");
    assert_eq!(
        state::fallback_overlay_theme("mine", &loader, &user_dir),
        None
    );
}

/// An id that is not a single path component is never used to probe the
/// filesystem: `user_dir/../x` exists here, and it must still fall back.
#[test]
fn overlay_theme_fallback_unsafe_id_never_probes_outside_the_user_dir() {
    let tmp = tempfile::TempDir::new().unwrap();
    let (loader, user_dir) = scanned_loader(&tmp, &["default"]);
    write_user_theme(
        tmp.path(),
        "x",
        r#"{"manifest_version":2,"id":"x","name":"X","api_version":1,"entry":"theme.js"}"#,
    );
    assert!(
        user_dir.join("../x").exists(),
        "the traversal target must exist for this test to mean anything"
    );
    assert_eq!(
        state::fallback_overlay_theme("../x", &loader, &user_dir),
        Some("default")
    );
}

/// The real builtin set: a removed orb falls back, a shipped one is kept.
#[test]
fn overlay_theme_fallback_removed_builtin_against_real_theme_source() {
    let tmp = tempfile::TempDir::new().unwrap();
    let loader =
        ThemeEngineLoader::with_builtin(state::builtin_theme_source(), tmp.path().to_path_buf());
    loader.scan().unwrap();

    assert_eq!(
        state::fallback_overlay_theme("orb_shdr_25", &loader, tmp.path()),
        Some("default"),
        "a removed builtin theme must fall back to 'default'"
    );
    assert_eq!(
        state::fallback_overlay_theme("orb_falls", &loader, tmp.path()),
        None,
        "a shipped builtin theme must keep its selection"
    );
}
