use std::fs;
use std::path::{Path, PathBuf};

/// `[profile.*]` tables are only honoured by Cargo when declared at the
/// **workspace root** manifest — a non-root package's `[profile.*]` is
/// silently ignored (`cargo build` prints "profiles for the non root
/// package will be ignored"). This crate (`voice`/`voice_lib`) is a
/// workspace member, not the root (the root is the repo-root `/Cargo.toml`,
/// see Task 1a's repo-root-workspace amendment) — so `[profile.release]`
/// lives there, not in this crate's own `Cargo.toml`. This test resolves
/// the real workspace root the same way Cargo does (walk up until a
/// `Cargo.toml` with a `[workspace]` table is found) instead of hardcoding
/// "one directory up", so it keeps working if the crate nesting ever
/// changes, and fails loudly if `[profile.release]` ever silently stops
/// applying again (this exact regression happened once already: moving the
/// workspace root out of `src-tauri/Cargo.toml` left a stale
/// `[profile.release]` behind that Cargo quietly ignored).
#[test]
fn release_profile_keeps_symbol_table_for_crash_diagnostics() {
    let workspace_root = find_workspace_root(Path::new(env!("CARGO_MANIFEST_DIR")));
    let workspace_cargo_toml_path = workspace_root.join("Cargo.toml");
    let workspace_cargo_toml =
        fs::read_to_string(&workspace_cargo_toml_path).unwrap_or_else(|err| {
            panic!(
                "failed to read {}: {err}",
                workspace_cargo_toml_path.display()
            )
        });

    let strip_value = release_profile_value(&workspace_cargo_toml, "strip").unwrap_or_else(|| {
        panic!(
            "[profile.release] must set strip explicitly in {}",
            workspace_cargo_toml_path.display()
        )
    });
    match strip_value.as_str() {
        "\"debuginfo\"" | "'debuginfo'" | "\"none\"" | "'none'" => {}
        "true" => panic!(
            "[profile.release] must not use strip = true; it removes the symbol table needed for crash backtraces"
        ),
        "\"symbols\"" | "'symbols'" => panic!(
            "[profile.release] must not use strip = \"symbols\"; it removes the symbol table needed for crash backtraces"
        ),
        other => panic!(
            "[profile.release] strip must be \"debuginfo\" or \"none\" so function names remain available, got {other}"
        ),
    }

    // `panic = "abort"` is load-bearing for the crash-diagnostics design:
    // panics become SIGABRT, caught by the fatal-signal handler
    // (diagnostics::fatal). Silently reverting to Cargo's default
    // (`panic = "unwind"`) would make that handler never fire.
    let panic_value = release_profile_value(&workspace_cargo_toml, "panic").unwrap_or_else(|| {
        panic!(
            "[profile.release] must set panic = \"abort\" explicitly in {}",
            workspace_cargo_toml_path.display()
        )
    });
    assert!(
        matches!(panic_value.as_str(), "\"abort\"" | "'abort'"),
        "[profile.release] panic must be \"abort\" (crash-diagnostics SIGABRT path depends on it), got {panic_value}"
    );

    // `lto = true` is the other half of the deliberate release-size/perf
    // trade-off calibrated in the comment above `[profile.release]`;
    // silently dropping it changes release binary characteristics without
    // anyone deciding that.
    let lto_value = release_profile_value(&workspace_cargo_toml, "lto").unwrap_or_else(|| {
        panic!(
            "[profile.release] must set lto explicitly in {}",
            workspace_cargo_toml_path.display()
        )
    });
    assert_eq!(
        lto_value, "true",
        "[profile.release] lto must stay enabled (true); got {lto_value}"
    );

    // Guard the other direction too: nobody should re-add a `[profile.*]`
    // table to this (non-root) package's own Cargo.toml — Cargo would
    // silently ignore it again, exactly the regression this test exists to
    // catch.
    let own_cargo_toml_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml");
    let own_cargo_toml = fs::read_to_string(&own_cargo_toml_path)
        .unwrap_or_else(|err| panic!("failed to read {}: {err}", own_cargo_toml_path.display()));
    assert!(
        !has_any_profile_table(&own_cargo_toml),
        "{} must not declare any [profile.*] table \u{2014} this package is a workspace \
         member, not the workspace root, so Cargo would silently ignore it (see the \
         doc comment on this test). Put profile tables in the workspace root Cargo.toml \
         ({}) instead.",
        own_cargo_toml_path.display(),
        workspace_cargo_toml_path.display()
    );
}

/// Walk up from `start` until a directory containing a `Cargo.toml` with a
/// top-level `[workspace]` table is found \u2014 the same resolution Cargo
/// itself uses to find the workspace root. Panics if none is found (would
/// mean this crate stopped being part of a workspace at all).
fn find_workspace_root(start: &Path) -> PathBuf {
    let mut dir = start;
    loop {
        let candidate = dir.join("Cargo.toml");
        if candidate.is_file() {
            if let Ok(contents) = fs::read_to_string(&candidate) {
                if contents.lines().any(|line| line.trim() == "[workspace]") {
                    return dir.to_path_buf();
                }
            }
        }
        match dir.parent() {
            Some(parent) => dir = parent,
            None => panic!(
                "walked up from {} to the filesystem root without finding a Cargo.toml \
                 with a [workspace] table",
                start.display()
            ),
        }
    }
}

/// True if any line (ignoring comments/whitespace) opens a `[profile...]`
/// table, e.g. `[profile.release]` or `[profile.dev]`.
fn has_any_profile_table(cargo_toml: &str) -> bool {
    cargo_toml.lines().any(|line| {
        let trimmed = line.trim();
        trimmed.starts_with("[profile.") || trimmed.starts_with("[profile]")
    })
}

fn release_profile_value(cargo_toml: &str, key: &str) -> Option<String> {
    let mut in_release_profile = false;

    for line in cargo_toml.lines() {
        let trimmed = line.trim();

        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            if in_release_profile {
                break;
            }
            in_release_profile = trimmed == "[profile.release]";
            continue;
        }

        if !in_release_profile {
            continue;
        }

        let Some((candidate_key, raw_value)) = trimmed.split_once('=') else {
            continue;
        };

        if candidate_key.trim() == key {
            return Some(strip_inline_comment(raw_value).trim().to_string());
        }
    }

    None
}

fn strip_inline_comment(value: &str) -> &str {
    let mut in_double_quoted_string = false;
    let mut previous_was_escape = false;

    for (index, character) in value.char_indices() {
        match character {
            '"' if !previous_was_escape => in_double_quoted_string = !in_double_quoted_string,
            '#' if !in_double_quoted_string => return &value[..index],
            _ => {}
        }

        previous_was_escape = character == '\\' && !previous_was_escape;
        if character != '\\' {
            previous_was_escape = false;
        }
    }

    value
}
