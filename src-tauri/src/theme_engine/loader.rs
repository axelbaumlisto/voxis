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
}