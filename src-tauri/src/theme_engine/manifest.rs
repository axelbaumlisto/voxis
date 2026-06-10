//! Theme manifest (v2) — schema + pure validation. No filesystem I/O here (SRP).
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const MANIFEST_VERSION: u32 = 2;
pub const SUPPORTED_API_VERSION: u32 = 1;

#[derive(Debug, Error)]
pub enum ManifestError {
    #[error("invalid JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("unsupported manifest_version {0} (expected {MANIFEST_VERSION})")]
    ManifestVersion(u32),
    #[error("unsupported api_version {0} (expected {SUPPORTED_API_VERSION})")]
    ApiVersion(u32),
    #[error("entry must be a plain filename, got: {0}")]
    BadEntry(String),
    #[error("invalid theme id: {0}")]
    BadId(String),
}

/// Reject empty, slashes, or parent-dir segments — shared by id and entry checks.
pub fn is_safe_path_component(s: &str) -> bool {
    !s.is_empty() && !s.contains('/') && !s.contains('\\') && !s.contains("..")
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ThemeManifest {
    pub manifest_version: u32,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub api_version: u32,
    pub entry: String,
    #[serde(default)]
    #[specta(skip)]
    pub params: Option<serde_json::Value>,
}

impl ThemeManifest {
    pub fn parse(json: &str) -> Result<Self, ManifestError> {
        let m: ThemeManifest = serde_json::from_str(json)?;
        if m.manifest_version != MANIFEST_VERSION {
            return Err(ManifestError::ManifestVersion(m.manifest_version));
        }
        if m.api_version != SUPPORTED_API_VERSION {
            return Err(ManifestError::ApiVersion(m.api_version));
        }
        if !is_safe_path_component(&m.id) {
            return Err(ManifestError::BadId(m.id));
        }
        if !is_safe_path_component(&m.entry) {
            return Err(ManifestError::BadEntry(m.entry));
        }
        Ok(m)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_json() -> &'static str {
        r#"{
            "manifest_version": 2, "id": "my_theme", "name": "My Theme",
            "description": "d", "api_version": 1, "entry": "theme.js"
        }"#
    }

    #[test]
    fn test_parse_valid_manifest() {
        let m = ThemeManifest::parse(valid_json()).unwrap();
        assert_eq!(m.id, "my_theme");
        assert_eq!(m.api_version, 1);
        assert_eq!(m.entry, "theme.js");
    }

    #[test]
    fn test_reject_wrong_manifest_version() {
        let bad =
            valid_json().replace("\"manifest_version\": 2", "\"manifest_version\": 1");
        assert!(ThemeManifest::parse(&bad).is_err());
    }

    #[test]
    fn test_reject_unsupported_api_version() {
        let bad = valid_json().replace("\"api_version\": 1", "\"api_version\": 99");
        assert!(ThemeManifest::parse(&bad).is_err());
    }

    #[test]
    fn test_reject_entry_with_path_traversal() {
        let bad = valid_json().replace("theme.js", "../evil.js");
        assert!(ThemeManifest::parse(&bad).is_err());
    }

    #[test]
    fn test_reject_id_with_path_traversal() {
        let bad = valid_json().replace("my_theme", "../evil");
        assert!(ThemeManifest::parse(&bad).is_err());
    }

    #[test]
    fn test_reject_empty_id() {
        let bad = valid_json().replace("my_theme", "");
        assert!(ThemeManifest::parse(&bad).is_err());
    }

    #[test]
    fn test_params_roundtrip() {
        let with_params = valid_json().replace(
            "\"entry\": \"theme.js\"",
            "\"entry\": \"theme.js\", \"params\": {\"speed\": 2}",
        );
        let m = ThemeManifest::parse(&with_params).unwrap();
        assert!(m.params.is_some());
    }
}