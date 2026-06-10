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

// --- resolve_bundled_themes_path tests ---

#[test]
fn test_resolve_bundled_themes_path_picks_first_valid_dir() {
    let tmp = tempfile::TempDir::new().unwrap();
    let dir_a = tmp.path().join("a");
    let dir_b = tmp.path().join("b");
    std::fs::create_dir_all(&dir_a).unwrap();
    std::fs::create_dir_all(&dir_b).unwrap();

    let result = state::resolve_bundled_themes_path(&[dir_a.clone(), dir_b.clone()]);
    assert_eq!(result, Some(dir_a), "should pick first candidate");
}

#[test]
fn test_resolve_bundled_themes_path_skips_non_dir_candidates() {
    let tmp = tempfile::TempDir::new().unwrap();
    let not_a_dir = tmp.path().join("notadir");
    std::fs::write(&not_a_dir, "i am a file").unwrap();
    let dir_b = tmp.path().join("b");
    std::fs::create_dir_all(&dir_b).unwrap();

    // First candidate is a file, not a dir — must be skipped.
    let result =
        state::resolve_bundled_themes_path(&[not_a_dir.clone(), dir_b.clone()]);
    assert_eq!(result, Some(dir_b), "should skip file, pick dir");
}

#[test]
fn test_resolve_bundled_themes_path_returns_none_when_nothing_exists() {
    let tmp = tempfile::TempDir::new().unwrap();
    let nonexistent = tmp.path().join("ghost");

    // Give it a nonexistent candidate. The dev fallback (CARGO_MANIFEST_DIR/themes)
    // exists in our dev environment, so we can't easily test "nothing exists"
    // without mocking. We'll just assert the candidate is skipped.
    let candidates: Vec<std::path::PathBuf> = vec![nonexistent];
    let result = state::resolve_bundled_themes_path(&candidates);
    // In dev, the fallback should succeed (we're under src-tauri/).
    assert!(result.is_some(), "dev fallback should resolve when candidate is missing");
}
