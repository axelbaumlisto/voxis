//! Theme engine front door: scan theme sources, read entry scripts, validate.
//! SRP: orchestration of `ThemeSource`s only — filesystem access lives in
//! source.rs, except seeding (`seed_from_bundle`, which still writes into the
//! user dir until it is removed), and schema rules in manifest.rs.
use super::manifest::ThemeManifest;
use super::source::{DirSource, ThemeSource};
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
    /// The user themes dir — the folder the app writes into (export, seeding).
    themes_dir: PathBuf,
    /// Theme sources in precedence order: a later source wins on id collision.
    sources: Vec<Box<dyn ThemeSource>>,
    /// id -> (index of the owning source, manifest) filled by scan().
    cache: RwLock<HashMap<String, (usize, ThemeManifest)>>,
}

impl ThemeEngineLoader {
    /// Loader over the user themes dir only — no builtin layer.
    pub fn new(themes_dir: PathBuf) -> Self {
        Self::from_sources(
            themes_dir.clone(),
            vec![Box::new(DirSource::new(themes_dir))],
        )
    }

    /// Loader layered as `[builtin, user]`: a user theme with a builtin's id
    /// shadows it. `themes_dir()` stays the user dir — the only folder the app
    /// writes into.
    pub fn with_builtin(builtin: Box<dyn ThemeSource>, user_dir: PathBuf) -> Self {
        Self::from_sources(
            user_dir.clone(),
            vec![builtin, Box::new(DirSource::new(user_dir))],
        )
    }

    fn from_sources(themes_dir: PathBuf, sources: Vec<Box<dyn ThemeSource>>) -> Self {
        Self {
            themes_dir,
            sources,
            cache: RwLock::new(HashMap::new()),
        }
    }

    pub fn themes_dir(&self) -> &PathBuf {
        &self.themes_dir
    }

    /// Scan all theme sources; cache and return manifests of valid themes.
    /// Invalid themes are skipped (logged), never fatal.
    ///
    /// The user dir is created when missing and probed strictly — but only a
    /// single-source loader fails on an unusable user dir. With builtins
    /// layered underneath, the same condition (a file instead of a folder, no
    /// permissions) is logged and scanning goes on: the builtins must stay
    /// visible. `DirSource::manifests` already returns nothing in that case.
    pub fn scan(&self) -> Result<Vec<ThemeManifest>, ThemeEngineError> {
        if let Err(e) = self.prepare_user_dir() {
            if self.sources.len() < 2 {
                return Err(e);
            }
            tracing::warn!(
                "theme_engine: user themes dir {:?} is unusable ({}), scanning builtin themes only",
                self.themes_dir,
                e
            );
        }
        let found = self.collect_manifests();
        let list: Vec<_> = found.values().map(|(_, m)| m.clone()).collect();
        *self.cache.write().expect("theme cache poisoned") = found;
        Ok(list)
    }

    /// Create the user themes dir when missing, then probe that it is a
    /// readable directory. An unreadable one (a file, no permissions) must
    /// surface as an error here rather than as an empty scan that wipes the
    /// cache; `scan` decides whether that error is fatal.
    fn prepare_user_dir(&self) -> Result<(), ThemeEngineError> {
        if !self.themes_dir.exists() {
            std::fs::create_dir_all(&self.themes_dir)?;
        }
        std::fs::read_dir(&self.themes_dir)?;
        Ok(())
    }

    /// Merge the manifests of every source. A later source shadows an earlier
    /// one with the same id.
    fn collect_manifests(&self) -> HashMap<String, (usize, ThemeManifest)> {
        let mut found = HashMap::new();
        for (index, source) in self.sources.iter().enumerate() {
            for manifest in source.manifests() {
                found.insert(manifest.id.clone(), (index, manifest));
            }
        }
        found
    }

    /// Return manifest for id (from cache filled by scan()).
    pub fn manifest(&self, id: &str) -> Option<ThemeManifest> {
        self.cache
            .read()
            .expect("theme cache poisoned")
            .get(id)
            .map(|(_, manifest)| manifest.clone())
    }

    /// Read the entry-script source for a theme id.
    pub fn read_script(&self, id: &str) -> Result<String, ThemeEngineError> {
        if !super::manifest::is_safe_path_component(id) {
            return Err(ThemeEngineError::UnknownTheme(id.to_string()));
        }
        let (source_index, entry) = {
            let cache = self.cache.read().expect("theme cache poisoned");
            let (index, manifest) = cache
                .get(id)
                .ok_or_else(|| ThemeEngineError::UnknownTheme(id.to_string()))?;
            (*index, manifest.entry.clone())
        };
        let bytes = self.sources[source_index].read(id, &entry).ok_or_else(|| {
            ThemeEngineError::Io(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("entry file '{entry}' of theme '{id}' is unreadable"),
            ))
        })?;
        String::from_utf8(bytes).map_err(|e| {
            ThemeEngineError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e))
        })
    }

    /// All files of theme `id` as `(file name, bytes)`, read from the source
    /// that owns the id in the scan cache.
    ///
    /// An empty Vec means unknown: the id was not in the last scan, its folder
    /// disappeared since then, or the owning source cannot read it. Callers
    /// must treat an empty result as "no such theme", never as a theme that
    /// happens to have no files.
    pub fn files(&self, id: &str) -> Vec<(String, Vec<u8>)> {
        let source_index = self
            .cache
            .read()
            .expect("theme cache poisoned")
            .get(id)
            .map(|(index, _)| *index);
        match source_index {
            Some(index) => self.sources[index].files(id),
            None => Vec::new(),
        }
    }

    /// Validate one theme id; mirrors legacy ThemeTestResult semantics.
    ///
    /// Reads the sources fresh (not the cache), so a theme edited on disk
    /// validates without an explicit re-scan. Sources are asked in reverse
    /// (later wins): the first source that contains the id decides the answer —
    /// valid, or its own invalidity reason.
    ///
    /// This is deliberately asymmetric with [`scan`](Self::scan): scanning
    /// skips a broken theme and leaves the valid copy it shadows visible (the
    /// app must keep working), while validation blames the topmost copy — the
    /// one the user actually put there — so a broken override is reported
    /// instead of being masked by the builtin underneath it.
    pub fn validate(&self, id: &str) -> ThemeValidation {
        if !super::manifest::is_safe_path_component(id) {
            return ThemeValidation {
                valid: false,
                warnings: vec![],
                errors: vec!["invalid theme id".into()],
            };
        }
        for source in self.sources.iter().rev() {
            // Presence probe: a source contains the theme when it has its
            // manifest file — whether or not that manifest turns out to be
            // valid (that is what `load` reports).
            if source.read(id, "theme.json").is_none() {
                continue;
            }
            return match source.load(id) {
                Ok(_) => ThemeValidation {
                    valid: true,
                    ..Default::default()
                },
                Err(e) => ThemeValidation {
                    valid: false,
                    warnings: vec![],
                    errors: vec![e],
                },
            };
        }
        ThemeValidation {
            valid: false,
            warnings: vec![],
            errors: vec![format!("theme not found: {id}")],
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
                            // Detect manifest_version independently of full
                            // validation. A user-edited v2 manifest that is
                            // temporarily invalid (bad entry, wrong api_version,
                            // missing field) still has manifest_version:2 and
                            // must be preserved — not overwritten.
                            let is_v2 = serde_json::from_str::<serde_json::Value>(existing_raw)
                                .ok()
                                .is_some_and(|v| is_manifest_v2(&v));
                            if is_v2 {
                                // Warn if the v2 manifest fails full parse —
                                // user may have broken something, but we
                                // must not destroy their edits.
                                if ThemeManifest::parse(existing_raw).is_err() {
                                    tracing::warn!(
                                        "seed_from_bundle: '{}' has manifest_version 2 but parse failed — preserving user edits",
                                        manifest.id
                                    );
                                } else {
                                    tracing::debug!(
                                        "seed_from_bundle: '{}' already has v2 theme — skipping",
                                        manifest.id
                                    );
                                }
                                continue;
                            }
                            // No manifest_version:2 — legacy v1 format — overwrite with v2.
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

            // Verify the bundled entry file exists BEFORE copying anything.
            // This prevents leaving a broken partial theme dir (v2 json, no entry).
            let bundle_entry = bundle_theme_dir.join(&manifest.entry);
            if !bundle_entry.is_file() {
                tracing::warn!(
                    "seed_from_bundle: entry file '{}' missing in bundle for '{}' — skipping",
                    manifest.entry,
                    manifest.id
                );
                continue;
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

            // Copy entry script first, then manifest — atomic order:
            // if either fails we end up with nothing or a valid-but-incomplete
            // dir, never a v2 json with a missing entry.
            if let Err(e) = std::fs::copy(&bundle_entry, user_theme_dir.join(&manifest.entry)) {
                tracing::warn!(
                    "seed_from_bundle: cannot copy entry for '{}': {}",
                    manifest.id,
                    e
                );
                continue;
            }

            if let Err(e) = std::fs::copy(&manifest_path, user_theme_dir.join("theme.json")) {
                tracing::warn!(
                    "seed_from_bundle: cannot copy manifest for '{}': {}",
                    manifest.id,
                    e
                );
                continue;
            }
        }

        Ok(())
    }
}

/// Helper: detect manifest_version:2 in any JSON Number or String shape.
fn is_manifest_v2(value: &serde_json::Value) -> bool {
    value
        .get("manifest_version")
        .is_some_and(|ver| {
            ver.as_i64() == Some(2)
                || ver.as_f64().is_some_and(|f| (f - 2.0).abs() < f64::EPSILON)
                || ver.as_str().map(|s| s.trim()) == Some("2")
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::theme_engine::source::EmbeddedSource;
    use std::fs;
    use tempfile::TempDir;

    fn write_theme(dir: &std::path::Path, id: &str, entry_content: &str) {
        write_named_theme(dir, id, id, entry_content);
    }

    /// Write a theme whose manifest carries a distinguishing `name`, so a test
    /// can tell two copies of the same id apart.
    fn write_named_theme(
        dir: &std::path::Path,
        id: &str,
        name: &str,
        entry_content: &str,
    ) {
        let d = dir.join(id);
        fs::create_dir_all(&d).unwrap();
        fs::write(
            d.join("theme.json"),
            format!(
                r#"{{"manifest_version":2,"id":"{id}","name":"{name}","api_version":1,"entry":"theme.js"}}"#
            ),
        )
        .unwrap();
        fs::write(d.join("theme.js"), entry_content).unwrap();
    }

    /// A loader layered as `[builtin, user]` over two temp dirs.
    fn layered_loader(builtin: &std::path::Path, user: &std::path::Path) -> ThemeEngineLoader {
        ThemeEngineLoader::with_builtin(
            Box::new(DirSource::new(builtin.to_path_buf())),
            user.to_path_buf(),
        )
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

    /// validate() must report the precise reason a theme is invalid, e.g. a
    /// valid manifest whose entry file is missing.
    #[test]
    fn test_validate_reports_missing_entry_file() {
        let tmp = TempDir::new().unwrap();
        let d = tmp.path().join("noentry");
        fs::create_dir_all(&d).unwrap();
        fs::write(
            d.join("theme.json"),
            r#"{"manifest_version":2,"id":"noentry","name":"x","api_version":1,"entry":"theme.js"}"#,
        )
        .unwrap();
        let loader = ThemeEngineLoader::new(tmp.path().to_path_buf());
        let result = loader.validate("noentry");
        assert!(!result.valid);
        assert!(
            result
                .errors
                .iter()
                .any(|e| e.contains("entry file missing")),
            "expected the entry-file reason, got: {:?}",
            result.errors
        );
    }

    /// The entry file can disappear between scan() and read_script(); that must
    /// be an error, not a panic.
    #[test]
    fn test_read_script_errors_when_entry_deleted_after_scan() {
        let tmp = TempDir::new().unwrap();
        write_theme(tmp.path(), "alpha", "export function mount(){}");
        let loader = ThemeEngineLoader::new(tmp.path().to_path_buf());
        loader.scan().unwrap();
        fs::remove_file(tmp.path().join("alpha/theme.js")).unwrap();
        assert!(loader.read_script("alpha").is_err());
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

    /// A user-edited v2 manifest that fails full ThemeManifest::parse
    /// (e.g. wrong api_version) must STILL be detected as v2 via
    /// manifest_version field and preserved — not overwritten.
    #[test]
    fn test_seed_preserves_invalid_v2_manifest() {
        let bundle = TempDir::new().unwrap();
        let user = TempDir::new().unwrap();

        // Write a bundled v2 theme for "my_theme".
        write_bundle_theme(
            bundle.path(),
            "my_theme",
            "theme.js",
            "export function mount(){/*bundled*/}",
        );

        // User dir has a v2 manifest with an INVALID api_version (99).
        // Full ThemeManifest::parse will fail, but manifest_version is 2.
        let user_theme_dir = user.path().join("my_theme");
        fs::create_dir_all(&user_theme_dir).unwrap();
        let invalid_v2_json = r#"{
            "manifest_version": 2,
            "id": "my_theme",
            "name": "My Theme",
            "api_version": 99,
            "entry": "theme.js"
        }"#;
        fs::write(user_theme_dir.join("theme.json"), invalid_v2_json).unwrap();

        let loader = ThemeEngineLoader::new(user.path().to_path_buf());
        loader.seed_from_bundle(bundle.path()).unwrap();

        // The invalid v2 manifest must be UNCHANGED — preserved, not overwritten.
        let content = fs::read_to_string(user_theme_dir.join("theme.json")).unwrap();
        assert_eq!(content, invalid_v2_json, "invalid v2 manifest must be byte-identical");
    }

    #[test]
    fn test_is_manifest_v2_string_2_preserved() {
        // user-edited json with manifest_version as string "2"
        let json = r#"{"manifest_version":"2","id":"x","name":"X","api_version":1,"entry":"e.js"}"#;
        let v: serde_json::Value = serde_json::from_str(json).unwrap();
        assert!(is_manifest_v2(&v), "string '2' must be detected as v2");
    }

    #[test]
    fn test_is_manifest_v2_float_2_0_preserved() {
        // user-edited json with manifest_version as float 2.0
        let json = r#"{"manifest_version":2.0,"id":"x","name":"X","api_version":1,"entry":"e.js"}"#;
        let v: serde_json::Value = serde_json::from_str(json).unwrap();
        assert!(is_manifest_v2(&v), "float 2.0 must be detected as v2");
    }

    /// When a bundled theme has a valid manifest but its entry file is
    /// missing, seed_from_bundle must not leave a broken partial dir
    /// (theme.json without theme.js).
    #[test]
    fn test_seed_skips_bundle_with_missing_entry_does_not_leave_partial_dir() {
        let bundle = TempDir::new().unwrap();
        let user = TempDir::new().unwrap();

        // Create a bundled theme dir with a valid manifest but NO entry file.
        let bundle_theme_dir = bundle.path().join("orphan");
        fs::create_dir_all(&bundle_theme_dir).unwrap();
        fs::write(
            bundle_theme_dir.join("theme.json"),
            r#"{"manifest_version":2,"id":"orphan","name":"Orphan","api_version":1,"entry":"theme.js"}"#,
        )
        .unwrap();
        // Note: NO theme.js is written.

        let loader = ThemeEngineLoader::new(user.path().to_path_buf());
        loader.seed_from_bundle(bundle.path()).unwrap();

        // The orphan theme should NOT have created a user dir at all.
        assert!(
            !user.path().join("orphan").exists(),
            "missing-entry bundle must not leave a partial theme dir"
        );
    }

    /// When manifest.id disagrees with the folder name, the source must
    /// WARN and override to use folder name as the authoritative id.
    /// This ensures hand-copied or renamed dirs Just Work.
    #[test]
    fn test_load_dir_uses_folder_name_as_authoritative_id() {
        let tmp = TempDir::new().unwrap();
        // Create a dir named "real_id" but with manifest claiming "fake_id".
        let d = tmp.path().join("real_id");
        fs::create_dir_all(&d).unwrap();
        fs::write(
            d.join("theme.json"),
            r#"{"manifest_version":2,"id":"fake_id","name":"N","api_version":1,"entry":"theme.js"}"#,
        )
        .unwrap();
        fs::write(d.join("theme.js"), "export function mount(){}").unwrap();

        let loader = ThemeEngineLoader::new(tmp.path().to_path_buf());
        let themes = loader.scan().unwrap();
        assert_eq!(themes.len(), 1);
        // The id should be the folder name, not the manifest's "fake_id".
        assert_eq!(themes[0].id, "real_id");
        // Cache lookup by folder name works.
        assert!(loader.manifest("real_id").is_some());
        // Lookup by the stale manifest id returns None.
        assert!(loader.manifest("fake_id").is_none());
    }

    /// An empty user dir shows every builtin theme; scripts are read from the
    /// builtin source and `themes_dir()` still points at the user dir.
    #[test]
    fn test_builtin_only_lists_and_reads_builtin_themes() {
        let builtin = TempDir::new().unwrap();
        write_named_theme(
            builtin.path(),
            "alpha",
            "Alpha Builtin",
            "export function mount(){/*builtin alpha*/}",
        );
        write_named_theme(
            builtin.path(),
            "beta",
            "Beta Builtin",
            "export function mount(){/*builtin beta*/}",
        );
        let user = TempDir::new().unwrap();
        let loader = layered_loader(builtin.path(), user.path());

        let mut ids: Vec<_> = loader.scan().unwrap().into_iter().map(|m| m.id).collect();
        ids.sort();
        assert_eq!(ids, vec!["alpha", "beta"]);
        assert!(loader
            .read_script("alpha")
            .unwrap()
            .contains("/*builtin alpha*/"));
        assert_eq!(
            loader.themes_dir().as_path(),
            user.path(),
            "themes_dir() must stay the user dir"
        );
    }

    /// The real embedded builtins are visible with an empty user dir.
    #[test]
    fn test_builtin_embedded_source_lists_default_with_empty_user_dir() {
        let user = TempDir::new().unwrap();
        let loader = ThemeEngineLoader::with_builtin(
            Box::new(EmbeddedSource::builtin()),
            user.path().to_path_buf(),
        );

        let themes = loader.scan().unwrap();
        assert!(
            themes.iter().any(|m| m.id == "default"),
            "embedded builtins must include 'default', got: {:?}",
            themes.iter().map(|m| &m.id).collect::<Vec<_>>()
        );
        assert!(loader.read_script("default").unwrap().contains("mount"));
    }

    /// A user theme with an id of its own is listed next to the builtins and
    /// read from the user dir.
    #[test]
    fn test_user_only_theme_is_listed_alongside_builtins() {
        let builtin = TempDir::new().unwrap();
        write_named_theme(
            builtin.path(),
            "alpha",
            "Alpha Builtin",
            "export function mount(){/*builtin alpha*/}",
        );
        let user = TempDir::new().unwrap();
        write_named_theme(
            user.path(),
            "mine",
            "Mine",
            "export function mount(){/*user mine*/}",
        );
        let loader = layered_loader(builtin.path(), user.path());

        let mut ids: Vec<_> = loader.scan().unwrap().into_iter().map(|m| m.id).collect();
        ids.sort();
        assert_eq!(ids, vec!["alpha", "mine"]);
        assert!(loader
            .read_script("alpha")
            .unwrap()
            .contains("/*builtin alpha*/"));
        assert!(loader
            .read_script("mine")
            .unwrap()
            .contains("/*user mine*/"));
    }

    /// The user copy shadows the builtin: manifest, entry script and files all
    /// come from the user dir.
    #[test]
    fn test_user_theme_shadows_builtin_with_same_id() {
        let builtin = TempDir::new().unwrap();
        write_named_theme(
            builtin.path(),
            "alpha",
            "Alpha Builtin",
            "export function mount(){/*builtin alpha*/}",
        );
        fs::write(builtin.path().join("alpha/builtin_only.css"), "x{}").unwrap();
        let user = TempDir::new().unwrap();
        write_named_theme(
            user.path(),
            "alpha",
            "Alpha User",
            "export function mount(){/*user alpha*/}",
        );
        fs::write(user.path().join("alpha/user_only.css"), "y{}").unwrap();
        let loader = layered_loader(builtin.path(), user.path());

        let themes = loader.scan().unwrap();
        assert_eq!(themes.len(), 1, "one id, one manifest");
        assert_eq!(loader.manifest("alpha").unwrap().name, "Alpha User");
        assert!(loader
            .read_script("alpha")
            .unwrap()
            .contains("/*user alpha*/"));

        let names: Vec<_> = loader
            .files("alpha")
            .into_iter()
            .map(|(n, _)| n)
            .collect();
        assert!(
            names.contains(&"user_only.css".to_string()),
            "files must come from the user copy, got: {names:?}"
        );
        assert!(
            !names.contains(&"builtin_only.css".to_string()),
            "files must not mix in the shadowed builtin, got: {names:?}"
        );
    }

    /// Removing the shadowing user copy gives the id back to the builtin on the
    /// next scan: manifest and entry script are read from the builtin again.
    #[test]
    fn test_deleting_user_copy_restores_the_builtin() {
        let builtin = TempDir::new().unwrap();
        write_named_theme(
            builtin.path(),
            "alpha",
            "Alpha Builtin",
            "export function mount(){/*builtin alpha*/}",
        );
        let user = TempDir::new().unwrap();
        write_named_theme(
            user.path(),
            "alpha",
            "Alpha User",
            "export function mount(){/*user alpha*/}",
        );
        let loader = layered_loader(builtin.path(), user.path());
        loader.scan().unwrap();
        assert_eq!(loader.manifest("alpha").unwrap().name, "Alpha User");

        fs::remove_dir_all(user.path().join("alpha")).unwrap();
        loader.scan().unwrap();
        assert_eq!(loader.manifest("alpha").unwrap().name, "Alpha Builtin");
        assert!(loader
            .read_script("alpha")
            .unwrap()
            .contains("/*builtin alpha*/"));
    }

    /// A layered loader keeps serving the builtins when the user dir is
    /// unusable (here: a plain file where the folder should be). Only the
    /// single-source loader treats that as a fatal scan error.
    #[test]
    fn test_unusable_user_dir_does_not_hide_builtins() {
        let builtin = TempDir::new().unwrap();
        write_named_theme(
            builtin.path(),
            "alpha",
            "Alpha Builtin",
            "export function mount(){/*builtin alpha*/}",
        );
        let user = TempDir::new().unwrap();
        let user_dir = user.path().join("notadir");
        fs::write(&user_dir, "i am a file").unwrap();
        let loader = layered_loader(builtin.path(), &user_dir);

        let ids: Vec<_> = loader.scan().unwrap().into_iter().map(|m| m.id).collect();
        assert_eq!(ids, vec!["alpha"], "builtins must survive a broken user dir");
        assert!(loader
            .read_script("alpha")
            .unwrap()
            .contains("/*builtin alpha*/"));
    }

    /// A broken user copy of a builtin's id is skipped by scan(), so the
    /// builtin it shadows stays visible and readable (see `validate` for the
    /// deliberate asymmetry). Unparsable-manifest case.
    #[test]
    fn test_broken_user_manifest_does_not_hide_the_builtin() {
        let builtin = TempDir::new().unwrap();
        write_named_theme(
            builtin.path(),
            "alpha",
            "Alpha Builtin",
            "export function mount(){/*builtin alpha*/}",
        );
        let user = TempDir::new().unwrap();
        fs::create_dir_all(user.path().join("alpha")).unwrap();
        fs::write(user.path().join("alpha/theme.json"), "{not json").unwrap();
        let loader = layered_loader(builtin.path(), user.path());

        let themes = loader.scan().unwrap();
        assert_eq!(themes.len(), 1);
        assert_eq!(loader.manifest("alpha").unwrap().name, "Alpha Builtin");
        assert!(loader
            .read_script("alpha")
            .unwrap()
            .contains("/*builtin alpha*/"));

        // Asymmetry: validate() asks the topmost source that *has* the id, so
        // the broken user copy's reason surfaces instead of a false "valid"
        // from the builtin underneath it.
        let result = loader.validate("alpha");
        assert!(!result.valid, "the broken user copy must not validate");
        assert!(!result.errors.is_empty());
    }

    /// Same asymmetry for a user copy whose entry file is missing.
    #[test]
    fn test_user_copy_missing_entry_does_not_hide_the_builtin() {
        let builtin = TempDir::new().unwrap();
        write_named_theme(
            builtin.path(),
            "alpha",
            "Alpha Builtin",
            "export function mount(){/*builtin alpha*/}",
        );
        let user = TempDir::new().unwrap();
        fs::create_dir_all(user.path().join("alpha")).unwrap();
        fs::write(
            user.path().join("alpha/theme.json"),
            r#"{"manifest_version":2,"id":"alpha","name":"Broken","api_version":1,"entry":"theme.js"}"#,
        )
        .unwrap();
        let loader = layered_loader(builtin.path(), user.path());

        let themes = loader.scan().unwrap();
        assert_eq!(themes.len(), 1);
        assert_eq!(loader.manifest("alpha").unwrap().name, "Alpha Builtin");
        assert!(loader
            .read_script("alpha")
            .unwrap()
            .contains("/*builtin alpha*/"));

        let result = loader.validate("alpha");
        assert!(!result.valid);
        assert!(
            result
                .errors
                .iter()
                .any(|e| e.contains("entry file missing")),
            "expected the user copy's reason, got: {:?}",
            result.errors
        );
    }

    /// `files()` of an id no source has is empty, not an error.
    #[test]
    fn test_files_of_unknown_id_is_empty() {
        let builtin = TempDir::new().unwrap();
        write_theme(builtin.path(), "alpha", "export function mount(){}");
        let user = TempDir::new().unwrap();
        let loader = layered_loader(builtin.path(), user.path());
        loader.scan().unwrap();

        assert!(!loader.files("alpha").is_empty());
        assert!(loader.files("ghost").is_empty());
        assert!(loader.files("../alpha").is_empty());
    }

    /// After scan(), both the original theme and an exported copy must
    /// appear as distinct manifests with distinct ids.
    #[test]
    fn test_scan_finds_original_and_exported_copy_with_distinct_ids() {
        let tmp = TempDir::new().unwrap();
        write_theme(tmp.path(), "alpha", "export function mount(){}");

        // Simulate an exported copy: dir named "alpha_custom" with
        // theme.json still claiming "alpha" (the bug scenario).
        let copied = tmp.path().join("alpha_custom");
        fs::create_dir_all(&copied).unwrap();
        fs::write(
            copied.join("theme.json"),
            r#"{"manifest_version":2,"id":"alpha","name":"Alpha","api_version":1,"entry":"theme.js"}"#,
        )
        .unwrap();
        fs::write(copied.join("theme.js"), "export function mount(){}").unwrap();

        let loader = ThemeEngineLoader::new(tmp.path().to_path_buf());
        let themes = loader.scan().unwrap();
        // Both must be found with distinct ids.
        let mut ids: Vec<_> = themes.iter().map(|t| t.id.clone()).collect();
        ids.sort();
        assert_eq!(ids, vec!["alpha", "alpha_custom"]);
        assert!(loader.manifest("alpha").is_some());
        assert!(loader.manifest("alpha_custom").is_some());
    }
}