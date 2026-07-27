use std::fs;
use std::path::Path;

#[test]
fn release_profile_keeps_symbol_table_for_crash_diagnostics() {
    let cargo_toml_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml");
    let cargo_toml = fs::read_to_string(&cargo_toml_path)
        .unwrap_or_else(|err| panic!("failed to read {}: {err}", cargo_toml_path.display()));

    let strip_value = release_profile_value(&cargo_toml, "strip")
        .unwrap_or_else(|| panic!("[profile.release] must set strip explicitly"));

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
