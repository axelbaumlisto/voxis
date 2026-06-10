//! Filesystem side of the theme engine: scan dir, read entry scripts, validate.
//! SRP: I/O only — schema rules live in manifest.rs.
use super::manifest::ThemeManifest;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::RwLock;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ThemeEngineError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("unknown theme id: {0}")]
    UnknownTheme(String),
}

/// Mirrors the existing ThemeTestResult DTO (valid/warnings/errors).
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct ThemeValidation {
    pub valid: bool,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
}

pub struct ThemeEngineLoader {
    themes_dir: PathBuf,
    cache: RwLock<HashMap<String, ThemeManifest>>,
}

impl ThemeEngineLoader {
    pub fn new(themes_dir: PathBuf) -> Self {
        Self {
            themes_dir,
            cache: RwLock::new(HashMap::new()),
        }
    }

    pub fn themes_dir(&self) -> &PathBuf {
        &self.themes_dir
    }

    /// Scan themes dir; cache and return manifests of valid themes.
    /// Invalid themes are skipped (logged), never fatal.
    pub fn scan(&self) -> Result<Vec<ThemeManifest>, ThemeEngineError> {
        if !self.themes_dir.exists() {
            std::fs::create_dir_all(&self.themes_dir)?;
        }
        let mut found = HashMap::new();
        for entry in std::fs::read_dir(&self.themes_dir)?.flatten() {
            let dir = entry.path();
            if !dir.is_dir() {
                continue;
            }
            match Self::load_dir(&dir) {
                Ok(m) => {
                    found.insert(m.id.clone(), m);
                }
                Err(e) => tracing::warn!("skipping theme at {:?}: {}", dir, e),
            }
        }
        let list: Vec<_> = found.values().cloned().collect();
        *self.cache.write().expect("theme cache poisoned") = found;
        Ok(list)
    }

    fn load_dir(dir: &std::path::Path) -> Result<ThemeManifest, String> {
        let manifest_path = dir.join("theme.json");
        let raw =
            std::fs::read_to_string(&manifest_path).map_err(|e| e.to_string())?;
        let manifest = ThemeManifest::parse(&raw).map_err(|e| e.to_string())?;
        let entry = dir.join(&manifest.entry);
        if !entry.is_file() {
            return Err(format!("entry file missing: {}", manifest.entry));
        }
        Ok(manifest)
    }

    /// Return manifest for id (from cache filled by scan()).
    pub fn manifest(&self, id: &str) -> Option<ThemeManifest> {
        self.cache
            .read()
            .expect("theme cache poisoned")
            .get(id)
            .cloned()
    }

    /// Read the entry-script source for a theme id.
    pub fn read_script(&self, id: &str) -> Result<String, ThemeEngineError> {
        if !super::manifest::is_safe_path_component(id) {
            return Err(ThemeEngineError::UnknownTheme(id.to_string()));
        }
        let manifest = self
            .manifest(id)
            .ok_or_else(|| ThemeEngineError::UnknownTheme(id.to_string()))?;
        let path = self.themes_dir.join(id).join(&manifest.entry);
        Ok(std::fs::read_to_string(path)?)
    }

    /// Validate one theme dir; mirrors legacy ThemeTestResult semantics.
    pub fn validate(&self, id: &str) -> ThemeValidation {
        if !super::manifest::is_safe_path_component(id) {
            return ThemeValidation {
                valid: false,
                warnings: vec![],
                errors: vec!["invalid theme id".into()],
            };
        }
        let dir = self.themes_dir.join(id);
        match Self::load_dir(&dir) {
            Ok(_) => ThemeValidation {
                valid: true,
                ..Default::default()
            },
            Err(e) => ThemeValidation {
                valid: false,
                warnings: vec![],
                errors: vec![e],
            },
        }
    }

    /// Seed the user themes dir from a bundled themes directory.
    ///
    /// Iterates `bundle_dir` subdirectories. For each directory whose
    /// `theme.json` parses as a valid v2 manifest:
    ///
    /// - If the corresponding user dir does **not** exist → copy entire dir.
    /// - If the user dir exists and contains a **legacy v1** theme.json
    ///   (no `manifest_version: 2`) → overwrite with the bundled v2 version.
    ///   This handles upgrade from older TALRI versions that seeded v1 themes.
    /// - If the user dir exists and contains a **v2** theme.json → skip
    ///   (preserve user edits).
    ///
    /// Symlinks in the bundle dir are skipped (symlink_metadata check).
    /// Subdirectories whose manifest fails to parse are skipped with a
    /// `tracing::warn`.
    pub fn seed_from_bundle(&self, bundle_dir: &std::path::Path) -> Result<(), ThemeEngineError> {
        if !bundle_dir.is_dir() {
            tracing::warn!(
                "seed_from_bundle: bundle dir {:?} does not exist or is not a directory",
                bundle_dir
            );
            return Ok(());
        }

        for entry in std::fs::read_dir(bundle_dir)? {
            let entry = match entry {
                Ok(e) => e,
                Err(e) => {
                    tracing::warn!("seed_from_bundle: read_dir entry error: {}", e);
                    continue;
                }
            };

            // Skip symlinks — must not follow them (use symlink_metadata).
            let entry_path = entry.path();
            match std::fs::symlink_metadata(&entry_path) {
                Ok(meta) if meta.file_type().is_symlink() => {
                    tracing::warn!(
                        "seed_from_bundle: skipping symlink {:?}",
                        entry_path
                    );
                    continue;
                }
                Ok(meta) if !meta.is_dir() => continue,
                Err(e) => {
                    tracing::warn!(
                        "seed_from_bundle: cannot stat {:?}: {}",
                        entry_path,
                        e
                    );
                    continue;
                }
                _ => {} // is_dir, proceed
            }

            let bundle_theme_dir = entry.path();

            // Parse the bundled manifest to get id and entry filename.
            let manifest_path = bundle_theme_dir.join("theme.json");
            let manifest_raw = match std::fs::read_to_string(&manifest_path) {
                Ok(r) => r,
                Err(e) => {
                    tracing::warn!(
                        "seed_from_bundle: cannot read {:?}: {}",
                        manifest_path,
                        e
                    );
                    continue;
                }
            };
            let manifest = match ThemeManifest::parse(&manifest_raw) {
                Ok(m) => m,
                Err(e) => {
                    tracing::warn!(
                        "seed_from_bundle: skipping {:?} — invalid manifest: {}",
                        bundle_theme_dir,
                        e
                    );
                    continue;
                }
            };

            let user_theme_dir = self.themes_dir.join(&manifest.id);

            if user_theme_dir.exists() {
                // Existing user dir — decide what to do.
                let existing_manifest_path = user_theme_dir.join("theme.json");
                if existing_manifest_path.is_file() {
                    match std::fs::read_to_string(&existing_manifest_path) {
                        Ok(ref existing_raw) => {
                            // If the existing file parses as v2, it's a user edit — skip.
                            if ThemeManifest::parse(existing_raw).is_ok() {
                                tracing::debug!(
                                    "seed_from_bundle: '{}' already has v2 theme — skipping",
                                    manifest.id
                                );
                                continue;
                            }
                            // Legacy v1 format (parse failed) — overwrite with v2.
                            tracing::info!(
                                "seed_from_bundle: '{}' has legacy v1 theme — upgrading to v2",
                                manifest.id
                            );
                        }
                        Err(e) => {
                            tracing::warn!(
                                "seed_from_bundle: cannot read existing {:?}: {} — skipping",
                                existing_manifest_path,
                                e
                            );
                            continue;
                        }
                    }
                }
                // Dir exists but maybe has no theme.json, or has a v1 one — (re)create.
            } else {
                tracing::info!(
                    "seed_from_bundle: seeding new theme '{}' from bundle",
                    manifest.id
                );
            }

            // Ensure user dir exists.
            if let Err(e) = std::fs::create_dir_all(&user_theme_dir) {
                tracing::warn!(
                    "seed_from_bundle: cannot create {:?}: {}",
                    user_theme_dir,
                    e
                );
                continue;
            }

            // Copy manifest (theme.json).
            if let Err(e) = std::fs::copy(&manifest_path, user_theme_dir.join("theme.json")) {
                tracing::warn!(
                    "seed_from_bundle: cannot copy manifest for '{}': {}",
                    manifest.id,
                    e
                );
                continue;
            }

            // Copy the entry script.
            let bundle_entry = bundle_theme_dir.join(&manifest.entry);
            if !bundle_entry.is_file() {
                tracing::warn!(
                    "seed_from_bundle: entry file '{}' missing in bundle for '{}'",
                    manifest.entry,
                    manifest.id
                );
                continue;
            }
            if let Err(e) = std::fs::copy(&bundle_entry, user_theme_dir.join(&manifest.entry)) {
                tracing::warn!(
                    "seed_from_bundle: cannot copy entry for '{}': {}",
                    manifest.id,
                    e
                );
                continue;
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn write_theme(dir: &std::path::Path, id: &str, entry_content: &str) {
        let d = dir.join(id);
        fs::create_dir_all(&d).unwrap();
        fs::write(
            d.join("theme.json"),
            format!(
                r#"{{"manifest_version":2,"id":"{id}","name":"{id}","api_version":1,"entry":"theme.js"}}"#
            ),
        )
        .unwrap();
        fs::write(d.join("theme.js"), entry_content).unwrap();
    }

    #[test]
    fn test_scan_finds_valid_themes() {
        let tmp = TempDir::new().unwrap();
        write_theme(tmp.path(), "alpha", "export function mount(){}");
        write_theme(tmp.path(), "beta", "export function mount(){}");
        let loader = ThemeEngineLoader::new(tmp.path().to_path_buf());
        let themes = loader.scan().unwrap();
        let mut ids: Vec<_> = themes.iter().map(|t| t.id.clone()).collect();
        ids.sort();
        assert_eq!(ids, vec!["alpha", "beta"]);
    }

    #[test]
    fn test_scan_skips_invalid_manifest() {
        let tmp = TempDir::new().unwrap();
        write_theme(tmp.path(), "good", "export function mount(){}");
        let bad = tmp.path().join("bad");
        fs::create_dir_all(&bad).unwrap();
        fs::write(bad.join("theme.json"), "{not json").unwrap();
        let loader = ThemeEngineLoader::new(tmp.path().to_path_buf());
        let themes = loader.scan().unwrap();
        assert_eq!(themes.len(), 1);
    }

    #[test]
    fn test_scan_skips_theme_missing_entry_file() {
        let tmp = TempDir::new().unwrap();
        let d = tmp.path().join("noentry");
        fs::create_dir_all(&d).unwrap();
        fs::write(
            d.join("theme.json"),
            r#"{"manifest_version":2,"id":"noentry","name":"x","api_version":1,"entry":"theme.js"}"#,
        )
        .unwrap();
        let loader = ThemeEngineLoader::new(tmp.path().to_path_buf());
        assert_eq!(loader.scan().unwrap().len(), 0);
    }

    #[test]
    fn test_read_script_returns_entry_content() {
        let tmp = TempDir::new().unwrap();
        write_theme(tmp.path(), "alpha", "export function mount(){/*alpha*/}");
        let loader = ThemeEngineLoader::new(tmp.path().to_path_buf());
        loader.scan().unwrap();
        let src = loader.read_script("alpha").unwrap();
        assert!(src.contains("/*alpha*/"));
    }

    #[test]
    fn test_read_script_unknown_id_errors() {
        let tmp = TempDir::new().unwrap();
        let loader = ThemeEngineLoader::new(tmp.path().to_path_buf());
        loader.scan().unwrap();
        assert!(loader.read_script("ghost").is_err());
    }

    #[test]
    fn test_read_script_rejects_path_traversal_id() {
        let tmp = TempDir::new().unwrap();
        // Pre-populate a valid theme so the cache has entries; we must
        // still reject a traversal id before consulting the cache/path.
        write_theme(tmp.path(), "safe_theme", "export function mount(){}");
        let loader = ThemeEngineLoader::new(tmp.path().to_path_buf());
        loader.scan().unwrap();
        let result = loader.read_script("../../../etc");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_rejects_path_traversal_id() {
        let tmp = TempDir::new().unwrap();
        let loader = ThemeEngineLoader::new(tmp.path().to_path_buf());
        let result = loader.validate("../../../etc");
        assert!(!result.valid);
        assert!(result.errors.iter().any(|e| e.contains("invalid theme id")));
    }

    #[test]
    fn test_validate_reports_errors_for_broken_theme() {
        let tmp = TempDir::new().unwrap();
        let bad = tmp.path().join("bad");
        fs::create_dir_all(&bad).unwrap();
        fs::write(bad.join("theme.json"), "{not json").unwrap();
        let loader = ThemeEngineLoader::new(tmp.path().to_path_buf());
        let result = loader.validate("bad");
        assert!(!result.valid);
        assert!(!result.errors.is_empty());
    }

    /// Write a bundled-style theme (theme.json + theme.js) into a dir.
    fn write_bundle_theme(dir: &std::path::Path, id: &str, entry: &str, content: &str) {
        let d = dir.join(id);
        fs::create_dir_all(&d).unwrap();
        fs::write(
            d.join("theme.json"),
            format!(
                r#"{{"manifest_version":2,"id":"{id}","name":"{id}","api_version":1,"entry":"{entry}"}}"#
            ),
        )
        .unwrap();
        fs::write(d.join(entry), content).unwrap();
    }

    #[test]
    fn test_seed_from_bundle_copies_missing_themes_only() {
        let bundle = TempDir::new().unwrap();
        let user = TempDir::new().unwrap();

        // Pre-create "alpha" in user dir (simulating user-edited theme).
        write_theme(user.path(), "alpha", "export function mount(){/*user-edited*/}");
        // Bundle has "alpha" (different content) and "beta" (missing from user).
        write_bundle_theme(bundle.path(), "alpha", "theme.js", "export function mount(){/*bundled alpha*/}");
        write_bundle_theme(bundle.path(), "beta", "theme.js", "export function mount(){/*bundled beta*/}");

        let loader = ThemeEngineLoader::new(user.path().to_path_buf());
        loader.seed_from_bundle(bundle.path()).unwrap();

        // User's edited alpha NOT overwritten.
        let alpha = fs::read_to_string(user.path().join("alpha/theme.js")).unwrap();
        assert!(alpha.contains("user-edited"), "user-edited theme must not be overwritten");
        // Missing beta copied.
        assert!(user.path().join("beta/theme.js").is_file(), "missing theme must be copied");
        let beta = fs::read_to_string(user.path().join("beta/theme.js")).unwrap();
        assert!(beta.contains("bundled beta"));
    }

    #[test]
    fn test_seed_from_bundle_skips_symlinks() {
        let bundle = TempDir::new().unwrap();
        let user = TempDir::new().unwrap();

        // Create a normal bundled theme.
        write_bundle_theme(bundle.path(), "safe", "theme.js", "export function mount(){}");

        // Try to create a symlink as a "theme" — only works on unix.
        #[cfg(unix)]
        {
            let safe_dir = bundle.path().join("safe");
            let sym_dir = bundle.path().join("evil_link");
            std::os::unix::fs::symlink(&safe_dir, &sym_dir).unwrap();
        }

        let loader = ThemeEngineLoader::new(user.path().to_path_buf());
        loader.seed_from_bundle(bundle.path()).unwrap();

        // "safe" should be copied.
        assert!(user.path().join("safe/theme.js").is_file());
        // Symlinked "dir" should NOT create a corresponding user dir.
        assert!(!user.path().join("evil_link").exists());
    }

    #[test]
    fn test_seed_over_legacy_v1_dir_v2_wins() {
        let bundle = TempDir::new().unwrap();
        let user = TempDir::new().unwrap();

        // Simulate a legacy v1 theme: directory exists with theme.json lacking manifest_version:2.
        let legacy_dir = user.path().join("old_theme");
        fs::create_dir_all(&legacy_dir).unwrap();
        fs::write(
            legacy_dir.join("theme.json"),
            "{\"name\":\"Old Theme\",\"colors\":{\"idle\":\"#fff\"}}",
        )
        .unwrap();

        // Bundle has a v2 version of the same theme.
        write_bundle_theme(bundle.path(), "old_theme", "theme.js", "export function mount(){/*v2*/}");

        let loader = ThemeEngineLoader::new(user.path().to_path_buf());
        loader.seed_from_bundle(bundle.path()).unwrap();

        // Legacy v1 theme.json should be overwritten with v2 format.
        let rewritten = fs::read_to_string(user.path().join("old_theme/theme.json")).unwrap();
        assert!(
            rewritten.contains("\"manifest_version\":2"),
            "legacy v1 theme should be upgraded to v2, got: {rewritten}"
        );
        assert!(user.path().join("old_theme/theme.js").is_file());
    }

    #[test]
    fn test_seed_over_user_edited_v2_dir_untouched() {
        let bundle = TempDir::new().unwrap();
        let user = TempDir::new().unwrap();

        // Simulate user-edited v2 theme.
        write_theme(user.path(), "my_theme", "export function mount(){/*user v2 edits*/}");

        // Bundle has same theme with different content.
        write_bundle_theme(bundle.path(), "my_theme", "theme.js", "export function mount(){/*bundled original*/}");

        let loader = ThemeEngineLoader::new(user.path().to_path_buf());
        loader.seed_from_bundle(bundle.path()).unwrap();

        // User-edited v2 theme must NOT be touched.
        let content = fs::read_to_string(user.path().join("my_theme/theme.js")).unwrap();
        assert!(
            content.contains("user v2 edits"),
            "user-edited v2 theme must remain untouched"
        );
    }

    #[test]
    fn test_seed_skips_bundle_entries_with_invalid_manifest() {
        let bundle = TempDir::new().unwrap();
        let user = TempDir::new().unwrap();

        // A valid bundled theme.
        write_bundle_theme(bundle.path(), "good", "theme.js", "export function mount(){}");
        // A dir without a valid v2 manifest — should be skipped, not panic.
        let bad_dir = bundle.path().join("bad");
        fs::create_dir_all(&bad_dir).unwrap();
        fs::write(bad_dir.join("theme.json"), "{not valid json").unwrap();

        let loader = ThemeEngineLoader::new(user.path().to_path_buf());
        // Must not panic, just skip the bad entry.
        loader.seed_from_bundle(bundle.path()).unwrap();
        assert!(user.path().join("good/theme.js").is_file());
        assert!(!user.path().join("bad").exists());
    }
}