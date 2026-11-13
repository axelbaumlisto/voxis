//! Theme digest — the fingerprint of one theme folder's regular files.
//!
//! SPEC (identical in `scripts/gen-known-theme-digests.ts`; the two
//! implementations must agree byte for byte — the
//! `test_theme_digest_of_every_bundled_theme_is_known` test cross-checks this
//! implementation against digests the script derived from git history):
//!
//! 1. input: the theme folder's **regular** files — no symlinks, no
//!    subdirectories — as `(file name, bytes)`;
//! 2. normalize each file's bytes: remove **every** ASCII whitespace byte —
//!    space `0x20`, tab `0x09`, LF `0x0A`, CR `0x0D`, VT `0x0B`, FF `0x0C`;
//!    release builds re-bundle the themes with a different bun that formats
//!    differently (`} catch {\n    }` vs `} catch {}`), so a **shipped** copy
//!    of a theme differs from its git blob in whitespace only. Canonical JSON
//!    is not an option (Rust and JS print numbers differently, `1.0` vs `1`),
//!    and the rule is applied to every file, whatever its extension;
//! 3. sort by file name, byte-wise (`String::cmp` == JS's default `Array.sort`
//!    on ASCII names; all theme file names are ASCII);
//! 4. sha256 over the concatenation, per file, of: the name bytes, `0x00`,
//!    the decimal byte length of the **normalized** content as ASCII, `0x00`,
//!    the **normalized** bytes;
//! 5. digest = the lowercase hex encoding of that sha256.
use sha2::{Digest, Sha256};

/// The ASCII whitespace bytes the spec removes: `u8::is_ascii_whitespace`
/// **plus** VT (`0x0B`), which std excludes. Do not replace this with
/// `u8::is_ascii_whitespace` — that would drop VT and break agreement with
/// `scripts/gen-known-theme-digests.ts`.
const ASCII_WHITESPACE: [u8; 6] = [b' ', b'\t', b'\n', 0x0b, 0x0c, b'\r'];

/// Digest of one theme folder per the module spec.
///
/// `files` is the shape [`super::source::ThemeSource::files`] returns (already
/// sorted); the sort is repeated here so the order of the slice never matters.
pub fn theme_digest(files: &[(String, Vec<u8>)]) -> String {
    let mut sorted: Vec<&(String, Vec<u8>)> = files.iter().collect();
    sorted.sort_by(|a, b| a.0.cmp(&b.0));

    let mut hasher = Sha256::new();
    for (name, bytes) in sorted {
        let normalized: Vec<u8> = bytes
            .iter()
            .copied()
            .filter(|byte| !ASCII_WHITESPACE.contains(byte))
            .collect();
        hasher.update(name.as_bytes());
        hasher.update([0u8]);
        hasher.update(normalized.len().to_string().as_bytes());
        hasher.update([0u8]);
        hasher.update(&normalized);
    }
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::theme_engine::source::{DirSource, ThemeSource};
    use std::collections::HashMap;
    use std::path::Path;

    fn owned(files: &[(&str, &[u8])]) -> Vec<(String, Vec<u8>)> {
        files
            .iter()
            .map(|(name, bytes)| ((*name).to_string(), bytes.to_vec()))
            .collect()
    }

    #[test]
    fn test_theme_digest_matches_a_hand_computed_sha256() {
        // Both inputs carry whitespace, which normalization strips before
        // hashing: `export function mount() {\n}` -> `exportfunctionmount(){}`
        // (23 bytes) and `{\n  "id": "x"\n}\n` -> `{"id":"x"}` (10 bytes).
        // The expected hex was derived without this code, straight from the
        // module spec (name, NUL, length, NUL, normalized bytes; files sorted
        // by name):
        //   $ printf 'theme.js\00023\000exportfunctionmount(){}theme.json\00010\000{"id":"x"}' | sha256sum
        //   0730e9266181a6394469e07f5270e096d5f1d14cb1fb5bc28f3cf740bd64b68a
        let files = owned(&[
            ("theme.json", b"{\n  \"id\": \"x\"\n}\n"),
            ("theme.js", b"export function mount() {\n}\n"),
        ]);
        assert_eq!(
            theme_digest(&files),
            "0730e9266181a6394469e07f5270e096d5f1d14cb1fb5bc28f3cf740bd64b68a"
        );
    }

    #[test]
    fn test_theme_digest_ignores_whitespace_only_differences() {
        // The reason for normalization: a release build's bundler formats the
        // same theme differently, so a pristine seeded copy must still match.
        let shipped = owned(&[("theme.js", b"try { mount(); } catch {\n    }\n")]);
        let from_git = owned(&[("theme.js", b"try { mount(); } catch {} ")]);
        assert_ne!(
            shipped[0].1, from_git[0].1,
            "the inputs must differ in bytes"
        );
        assert_eq!(theme_digest(&shipped), theme_digest(&from_git));

        // Every ASCII whitespace byte is stripped, and nothing else is.
        let spaced = owned(&[("theme.js", b"a b\tc\nd\re\x0bf\x0cg")]);
        assert_eq!(
            theme_digest(&spaced),
            theme_digest(&owned(&[("theme.js", b"abcdefg")]))
        );

        // A non-whitespace difference still changes the digest.
        assert_ne!(
            theme_digest(&from_git),
            theme_digest(&owned(&[("theme.js", b"try { mount(); } catch {;}")]))
        );
    }

    #[test]
    fn test_theme_digest_is_order_independent() {
        let files = owned(&[
            ("theme.json", br#"{"id":"x"}"#),
            ("theme.js", b"export function mount(){}"),
            ("extra.css", b"body{}"),
        ]);
        let reversed: Vec<_> = files.iter().rev().cloned().collect();
        assert_eq!(theme_digest(&files), theme_digest(&reversed));

        // A different content must change the digest (a non-whitespace byte:
        // whitespace itself is normalized away, see
        // `test_theme_digest_ignores_whitespace_only_differences`).
        let mut other = files.clone();
        other[1].1.push(b';');
        assert_ne!(theme_digest(&files), theme_digest(&other));
    }

    #[test]
    fn test_theme_digest_of_every_bundled_theme_is_known() {
        // `known-builtin-digests.json` is produced by
        // `scripts/gen-known-theme-digests.ts` from the git history of
        // `src-tauri/themes`. Finding the current bundle there proves the two
        // digest implementations agree and that this bundle is recognised as
        // pristine (so its old copy can be retired instead of shadowing).
        let known: HashMap<String, Vec<String>> =
            serde_json::from_str(include_str!("../../known-builtin-digests.json"))
                .expect("known-builtin-digests.json must be a JSON object");

        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("themes");
        // `DirSource::files` is the reader the retirement migration will use,
        // so this test proves the digests of what the app will actually read
        // (not of some test-only reimplementation) are in the list.
        let source = DirSource::new(root.clone());
        let mut themes = 0;
        for entry in std::fs::read_dir(&root)
            .unwrap_or_else(|e| panic!("cannot read {root:?}: {e}"))
            .flatten()
        {
            if !entry.path().is_dir() {
                continue;
            }
            let id = entry.file_name().to_string_lossy().into_owned();
            // Whitespace-insensitive, so a copy seeded from a release build
            // (formatted by another bun) matches this bundle's digest.
            let digest = theme_digest(&source.files(&id));
            let digests = known
                .get(&id)
                .unwrap_or_else(|| panic!("no known digests for bundled theme '{id}'"));
            assert!(
                digests.contains(&digest),
                "digest {digest} of bundled theme '{id}' is missing from known-builtin-digests.json"
            );
            themes += 1;
        }
        assert!(themes > 0, "no themes under {root:?}");
    }
}
