//! Application paths management.
//!
//! Uses XDG on Linux, standard locations on macOS/Windows.

use std::path::PathBuf;
use tauri::AppHandle;

/// App paths for config, history, dictionary files.
#[derive(Debug, Clone)]
pub struct AppPaths {
    config_dir: PathBuf,
}

impl AppPaths {
    /// Create AppPaths from a config directory path.
    /// Useful for testing and when AppHandle is not available.
    pub fn from_config_dir(config_dir: PathBuf) -> Self {
        Self { config_dir }
    }

    /// Create AppPaths from Tauri AppHandle.
    pub fn new(_app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        // Use standard config directory
        let config_dir = dirs::config_dir()
            .ok_or("Cannot find config directory")?
            .join("soupawhisper");

        // Ensure directory exists
        std::fs::create_dir_all(&config_dir)?;

        Ok(Self { config_dir })
    }

    /// Path to config.ini file (legacy, for migration).
    pub fn config_file(&self) -> PathBuf {
        self.config_dir.join("config.ini")
    }

    /// Path to config.db SQLite database.
    pub fn config_db(&self) -> PathBuf {
        self.config_dir.join("config.db")
    }

    /// Path to history.db SQLite database.
    pub fn history_file(&self) -> PathBuf {
        self.config_dir.join("history.db")
    }

    /// Path to history.md file (legacy/export).
    pub fn history_md_file(&self) -> PathBuf {
        self.config_dir.join("history.md")
    }

    /// Path to dictionary.txt file.
    pub fn dictionary_file(&self) -> PathBuf {
        self.config_dir.join("dictionary.txt")
    }

    /// Path to corrections_stats.json file (legacy).
    pub fn corrections_file(&self) -> PathBuf {
        self.config_dir.join("corrections_stats.json")
    }

    /// Path to corrections.db SQLite database.
    pub fn corrections_db(&self) -> PathBuf {
        self.config_dir.join("corrections.db")
    }

    /// Get the config directory path.
    pub fn config_dir(&self) -> &PathBuf {
        &self.config_dir
    }

    /// Path to debug directory for storing audio files, logs, etc.
    pub fn debug_dir(&self) -> PathBuf {
        self.config_dir.join("debug")
    }

    /// Ensure debug directory exists.
    pub fn ensure_debug_dir(&self) -> std::io::Result<PathBuf> {
        let dir = self.debug_dir();
        std::fs::create_dir_all(&dir)?;
        Ok(dir)
    }

    /// Path to providers.db SQLite database.
    pub fn providers_db(&self) -> PathBuf {
        self.config_dir.join("providers.db")
    }

    /// Path to themes directory for external visualization themes.
    pub fn themes_dir(&self) -> PathBuf {
        self.config_dir.join("themes")
    }

    /// Ensure themes directory exists.
    pub fn ensure_themes_dir(&self) -> std::io::Result<PathBuf> {
        let dir = self.themes_dir();
        std::fs::create_dir_all(&dir)?;
        Ok(dir)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_paths_structure() {
        // Test that path methods return expected file names
        let paths = AppPaths {
            config_dir: PathBuf::from("/tmp/test"),
        };
        assert!(paths.config_file().ends_with("config.ini"));
        assert!(paths.config_db().ends_with("config.db"));
        assert!(paths.history_file().ends_with("history.db"));
        assert!(paths.dictionary_file().ends_with("dictionary.txt"));
    }

    #[test]
    fn test_from_config_dir() {
        let paths = AppPaths::from_config_dir(PathBuf::from("/custom/path"));
        assert_eq!(paths.config_dir(), &PathBuf::from("/custom/path"));
    }

    #[test]
    fn test_all_paths_under_config_dir() {
        let paths = AppPaths::from_config_dir(PathBuf::from("/test"));
        assert!(paths.config_db().starts_with("/test"));
        assert!(paths.history_file().starts_with("/test"));
        assert!(paths.dictionary_file().starts_with("/test"));
        assert!(paths.corrections_db().starts_with("/test"));
        assert!(paths.providers_db().starts_with("/test"));
        assert!(paths.debug_dir().starts_with("/test"));
    }

    #[test]
    fn test_history_md_file() {
        let paths = AppPaths::from_config_dir(PathBuf::from("/test"));
        assert!(paths.history_md_file().ends_with("history.md"));
    }

    #[test]
    fn test_corrections_file_legacy() {
        let paths = AppPaths::from_config_dir(PathBuf::from("/test"));
        assert!(paths.corrections_file().ends_with("corrections_stats.json"));
    }

    #[test]
    fn test_ensure_debug_dir() {
        let temp = tempfile::tempdir().unwrap();
        let paths = AppPaths::from_config_dir(temp.path().to_path_buf());
        let debug_dir = paths.ensure_debug_dir().unwrap();
        assert!(debug_dir.exists());
    }
}
