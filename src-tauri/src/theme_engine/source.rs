//! Theme sources — where theme files come from. The loader never touches the
//! filesystem itself: it layers `ThemeSource` implementations in precedence
//! order. SRP: I/O only — schema rules live in manifest.rs.
use super::manifest::{is_safe_path_component, ThemeManifest};
use std::path::{Path, PathBuf};

/// A place themes can be read from.
///
/// `id` is always a theme id (the folder name, see `parse_theme`), `file` a
/// plain file name inside that theme. Both are validated with
/// `is_safe_path_component`; implementations reject anything else rather than
/// letting a name escape their root. Validation is name-only, not
/// link-aware: reading resolves whatever sits at the validated path, so
/// `DirSource` still follows a symlinked file inside a theme (legacy
/// behavior).
pub trait ThemeSource: Send + Sync {
    /// Manifests of all valid themes in this source. Invalid themes are
    /// skipped (logged), never fatal — the source keeps serving the rest.
    fn manifests(&self) -> Vec<ThemeManifest>;

    /// Load one theme of this source as fully as the source can judge it:
    /// manifest parsed and entry file present. `Err` carries the reason the
    /// theme is invalid, so callers can show it verbatim.
    fn load(&self, id: &str) -> Result<ThemeManifest, String>;

    /// Bytes of `file` inside theme `id`; `None` when the theme, the file or
    /// either name is missing/unsafe.
    fn read(&self, id: &str, file: &str) -> Option<Vec<u8>>;

    /// All regular files of theme `id` as `(file name, bytes)`, sorted by file
    /// name. Symlinked files and non-files are skipped.
    fn files(&self, id: &str) -> Vec<(String, Vec<u8>)>;
}

/// A folder of theme folders on disk.
pub struct DirSource {
    root: PathBuf,
}

impl DirSource {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    /// Path of `file` inside theme `id`; `None` when either name is unsafe.
    fn theme_file(&self, id: &str, file: &str) -> Option<PathBuf> {
        if !is_safe_path_component(id) || !is_safe_path_component(file) {
            return None;
        }
        Some(self.root.join(id).join(file))
    }
}

impl ThemeSource for DirSource {
    fn manifests(&self) -> Vec<ThemeManifest> {
        let mut found = Vec::new();
        let entries = match std::fs::read_dir(&self.root) {
            Ok(entries) => entries,
            Err(e) => {
                tracing::warn!("DirSource: cannot read {:?}: {}", self.root, e);
                return found;
            }
        };
        for entry in entries.flatten() {
            let dir = entry.path();
            // `is_dir()` follows symlinks: a symlinked theme folder is scanned,
            // same as before the source split.
            if !dir.is_dir() {
                continue;
            }
            match load_theme(&dir) {
                Ok(manifest) => found.push(manifest),
                Err(e) => tracing::warn!("DirSource: skipping theme at {:?}: {}", dir, e),
            }
        }
        found
    }

    fn load(&self, id: &str) -> Result<ThemeManifest, String> {
        if !is_safe_path_component(id) {
            return Err(format!("invalid theme id: {id}"));
        }
        load_theme(&self.root.join(id))
    }

    fn read(&self, id: &str, file: &str) -> Option<Vec<u8>> {
        let path = self.theme_file(id, file)?;
        std::fs::read(path).ok()
    }

    fn files(&self, id: &str) -> Vec<(String, Vec<u8>)> {
        let mut files = Vec::new();
        if !is_safe_path_component(id) {
            return files;
        }
        let dir = self.root.join(id);
        let entries = match std::fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(e) => {
                tracing::warn!("DirSource: cannot read theme dir {:?}: {}", dir, e);
                return files;
            }
        };
        for entry in entries.flatten() {
            let path = entry.path();
            // Symlink metadata, not `is_file()`: a link inside a theme dir
            // could point at content outside it.
            let meta = match std::fs::symlink_metadata(&path) {
                Ok(meta) => meta,
                Err(e) => {
                    tracing::warn!("DirSource: cannot stat {:?}: {}", path, e);
                    continue;
                }
            };
            if !meta.is_file() {
                continue;
            }
            let name = match entry.file_name().to_str() {
                Some(name) => name.to_string(),
                None => continue,
            };
            match std::fs::read(&path) {
                Ok(bytes) => files.push((name, bytes)),
                Err(e) => tracing::warn!("DirSource: cannot read {:?}: {}", path, e),
            }
        }
        files.sort_by(|a, b| a.0.cmp(&b.0));
        files
    }
}

/// Load one theme folder from disk.
fn load_theme(dir: &Path) -> Result<ThemeManifest, String> {
    let folder_name = dir
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "theme dir has no valid name".to_string())?;
    let manifest_raw =
        std::fs::read_to_string(dir.join("theme.json")).map_err(|e| e.to_string())?;
    parse_theme(folder_name, &manifest_raw, |entry| {
        dir.join(entry).is_file()
    })
}

/// Parse one theme folder into a manifest.
///
/// The folder name is the **authoritative** id — if the manifest's "id" field
/// disagrees, we WARN and override it with the folder name. This ensures
/// hand-copied or renamed directories Just Work instead of being silently
/// invisible or shadowing the original id. Same rule applies to
/// copied/exported themes whose manifest was rewritten by export_theme_dir.
///
/// `manifest_raw` is theme.json's contents, `entry_exists` reports whether the
/// entry file named by the manifest is present in the folder. Shared by every
/// `ThemeSource` so these rules cannot drift apart.
fn parse_theme(
    folder_name: &str,
    manifest_raw: &str,
    entry_exists: impl Fn(&str) -> bool,
) -> Result<ThemeManifest, String> {
    let mut manifest = ThemeManifest::parse(manifest_raw).map_err(|e| e.to_string())?;
    if manifest.id != folder_name {
        tracing::warn!(
            "parse_theme: manifest id '{}' != folder name '{}' — using folder name as authoritative id",
            manifest.id,
            folder_name
        );
        manifest.id = folder_name.to_string();
    }
    if !entry_exists(&manifest.entry) {
        return Err(format!("entry file missing: {}", manifest.entry));
    }
    Ok(manifest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn write_theme(root: &Path, id: &str, entry_content: &str) {
        let dir = root.join(id);
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("theme.json"),
            format!(
                r#"{{"manifest_version":2,"id":"{id}","name":"{id}","api_version":1,"entry":"theme.js"}}"#
            ),
        )
        .unwrap();
        fs::write(dir.join("theme.js"), entry_content).unwrap();
    }

    #[test]
    fn test_dir_source_manifests_lists_valid_themes() {
        let tmp = TempDir::new().unwrap();
        write_theme(tmp.path(), "alpha", "export function mount(){}");
        write_theme(tmp.path(), "beta", "export function mount(){}");
        let source = DirSource::new(tmp.path().to_path_buf());
        let mut ids: Vec<_> = source.manifests().into_iter().map(|m| m.id).collect();
        ids.sort();
        assert_eq!(ids, vec!["alpha", "beta"]);
    }

    #[test]
    fn test_dir_source_manifests_skips_entries_and_broken_themes() {
        let tmp = TempDir::new().unwrap();
        write_theme(tmp.path(), "good", "export function mount(){}");
        // Invalid manifest.
        let bad = tmp.path().join("bad");
        fs::create_dir_all(&bad).unwrap();
        fs::write(bad.join("theme.json"), "{not json").unwrap();
        // Valid manifest, missing entry file.
        let noentry = tmp.path().join("noentry");
        fs::create_dir_all(&noentry).unwrap();
        fs::write(
            noentry.join("theme.json"),
            r#"{"manifest_version":2,"id":"noentry","name":"x","api_version":1,"entry":"theme.js"}"#,
        )
        .unwrap();
        // A plain file in the themes root is not a theme.
        fs::write(tmp.path().join("stray.js"), "x").unwrap();

        let source = DirSource::new(tmp.path().to_path_buf());
        let ids: Vec<_> = source.manifests().into_iter().map(|m| m.id).collect();
        assert_eq!(ids, vec!["good"]);
    }

    #[test]
    fn test_dir_source_uses_folder_name_as_authoritative_id() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path().join("real_id");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("theme.json"),
            r#"{"manifest_version":2,"id":"fake_id","name":"N","api_version":1,"entry":"theme.js"}"#,
        )
        .unwrap();
        fs::write(dir.join("theme.js"), "export function mount(){}").unwrap();

        let source = DirSource::new(tmp.path().to_path_buf());
        let ids: Vec<_> = source.manifests().into_iter().map(|m| m.id).collect();
        assert_eq!(ids, vec!["real_id"]);
    }

    #[cfg(unix)]
    #[test]
    fn test_dir_source_follows_symlinked_theme_dir() {
        // Legacy behavior: the scanner uses `is_dir()`, which follows a
        // symlinked theme folder. The folder name stays authoritative, so the
        // linked theme is listed under the link's name.
        let tmp = TempDir::new().unwrap();
        write_theme(tmp.path(), "safe", "export function mount(){}");
        std::os::unix::fs::symlink(tmp.path().join("safe"), tmp.path().join("linked")).unwrap();

        let source = DirSource::new(tmp.path().to_path_buf());
        let mut ids: Vec<_> = source.manifests().into_iter().map(|m| m.id).collect();
        ids.sort();
        assert_eq!(
            ids,
            vec!["linked", "safe"],
            "a symlinked theme dir is scanned"
        );
    }

    #[test]
    fn test_dir_source_manifests_on_missing_root_is_empty() {
        let tmp = TempDir::new().unwrap();
        let source = DirSource::new(tmp.path().join("does_not_exist"));
        assert!(source.manifests().is_empty());
    }

    #[test]
    fn test_dir_source_load_reports_why_a_theme_is_invalid() {
        let tmp = TempDir::new().unwrap();
        write_theme(tmp.path(), "alpha", "export function mount(){}");
        // Valid manifest, but the entry file it names is missing.
        let noentry = tmp.path().join("noentry");
        fs::create_dir_all(&noentry).unwrap();
        fs::write(
            noentry.join("theme.json"),
            r#"{"manifest_version":2,"id":"noentry","name":"x","api_version":1,"entry":"theme.js"}"#,
        )
        .unwrap();

        let source = DirSource::new(tmp.path().to_path_buf());
        assert_eq!(source.load("alpha").unwrap().id, "alpha");
        let err = source.load("noentry").unwrap_err();
        assert!(err.contains("entry file missing"), "got: {err}");
        assert!(source.load("ghost").is_err());
        assert!(source.load("../alpha").is_err());
    }

    #[test]
    fn test_dir_source_read_returns_file_bytes() {
        let tmp = TempDir::new().unwrap();
        write_theme(tmp.path(), "alpha", "export function mount(){/*alpha*/}");

        let source = DirSource::new(tmp.path().to_path_buf());
        let bytes = source.read("alpha", "theme.js").unwrap();
        assert!(String::from_utf8(bytes).unwrap().contains("/*alpha*/"));
    }

    #[test]
    fn test_dir_source_read_rejects_unsafe_and_missing_names() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("themes");
        write_theme(&root, "alpha", "export function mount(){}");
        // Both files exist and are reachable only by stepping out of the root,
        // so a `None` proves the names were rejected rather than merely absent.
        fs::write(tmp.path().join("outside.txt"), "secret").unwrap();
        fs::write(root.join("outside.txt"), "secret").unwrap();

        let source = DirSource::new(root);
        assert!(source.read("alpha", "theme.js").is_some());
        assert!(
            source.read("..", "outside.txt").is_none(),
            "parent-dir id must be rejected"
        );
        assert!(
            source.read("alpha", "../outside.txt").is_none(),
            "traversal file must be rejected"
        );
        assert!(
            source.read("alpha", "C:theme.js").is_none(),
            "drive prefix must be rejected"
        );
        assert!(
            source.read("ghost", "theme.js").is_none(),
            "unknown id must yield None"
        );
        assert!(
            source.read("alpha", "nope.js").is_none(),
            "missing file must yield None"
        );
    }

    #[cfg(unix)]
    #[test]
    fn test_dir_source_files_skips_symlinked_file() {
        // A symlinked file inside a theme dir is never returned by `files()`.
        let tmp = TempDir::new().unwrap();
        write_theme(tmp.path(), "alpha", "export function mount(){}");
        let outside = tmp.path().join("outside.txt");
        fs::write(&outside, "secret").unwrap();
        std::os::unix::fs::symlink(&outside, tmp.path().join("alpha/evil_link")).unwrap();

        let source = DirSource::new(tmp.path().to_path_buf());
        let names: Vec<_> = source.files("alpha").into_iter().map(|(n, _)| n).collect();
        assert!(!names.contains(&"evil_link".to_string()));
    }

    #[test]
    fn test_dir_source_files_returns_regular_files_sorted() {
        let tmp = TempDir::new().unwrap();
        write_theme(tmp.path(), "alpha", "export function mount(){}");
        fs::write(tmp.path().join("alpha/extra.css"), "body{}").unwrap();
        fs::create_dir_all(tmp.path().join("alpha/sub")).unwrap();
        fs::write(tmp.path().join("alpha/sub/skip.js"), "x").unwrap();

        let source = DirSource::new(tmp.path().to_path_buf());
        let files = source.files("alpha");
        let names: Vec<_> = files.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(names, vec!["extra.css", "theme.js", "theme.json"]);
        let css = files
            .iter()
            .find(|(n, _)| n == "extra.css")
            .map(|(_, b)| String::from_utf8(b.clone()).unwrap())
            .unwrap();
        assert_eq!(css, "body{}");
    }

    #[test]
    fn test_dir_source_files_unknown_or_unsafe_id_is_empty() {
        let tmp = TempDir::new().unwrap();
        write_theme(tmp.path(), "alpha", "export function mount(){}");
        let source = DirSource::new(tmp.path().to_path_buf());
        assert!(source.files("ghost").is_empty());
        assert!(source.files("../alpha").is_empty());
    }
}
