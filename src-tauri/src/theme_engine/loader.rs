//! Theme engine front door: scan theme sources, read entry scripts, validate.
//! SRP: orchestration of `ThemeSource`s only — filesystem access lives in
//! source.rs, schema rules in manifest.rs.
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
    /// The user themes dir — the folder the app writes into (export).
    themes_dir: PathBuf,
    /// Theme sources in precedence order: a later source wins on id collision.
    sources: Vec<Box<dyn ThemeSource>>,
    /// Whether an unusable user dir fails [`scan`](Self::scan). True for a
    /// user-only loader (there is nothing else to show), false once builtins
    /// are layered underneath.
    user_dir_fatal: bool,
    /// id -> (index of the owning source, manifest) filled by scan().
    cache: RwLock<HashMap<String, (usize, ThemeManifest)>>,
}

impl ThemeEngineLoader {
    /// Loader over the user themes dir only — no builtin layer.
    pub fn new(themes_dir: PathBuf) -> Self {
        Self::from_sources(
            themes_dir.clone(),
            vec![Box::new(DirSource::new(themes_dir))],
            true,
        )
    }

    /// Loader layered as `[builtin, user]`: a user theme with a builtin's id
    /// shadows it. `themes_dir()` stays the user dir — the only folder the app
    /// writes into.
    pub fn with_builtin(builtin: Box<dyn ThemeSource>, user_dir: PathBuf) -> Self {
        Self::from_sources(
            user_dir.clone(),
            vec![builtin, Box::new(DirSource::new(user_dir))],
            false,
        )
    }

    fn from_sources(
        themes_dir: PathBuf,
        sources: Vec<Box<dyn ThemeSource>>,
        user_dir_fatal: bool,
    ) -> Self {
        Self {
            themes_dir,
            sources,
            user_dir_fatal,
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
            if self.user_dir_fatal {
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