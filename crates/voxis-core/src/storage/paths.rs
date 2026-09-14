//! Application paths management.
//!
//! Uses XDG on Linux, standard locations on macOS/Windows.

use std::ffi::OsStr;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

/// Name of the application data directory within the OS config directory.
pub const APP_CONFIG_DIR: &str = "voxis";
/// Legacy application data directory used for one-time migration.
pub const LEGACY_CONFIG_DIR: &str = "soupawhisper";

/// Resolve the canonical application data directory.
///
/// Storage, logging, themes, and the debug socket must all use this resolver
/// rather than Tauri's identifier-derived `app_config_dir()`.
pub fn app_config_dir() -> Option<PathBuf> {
    dirs::config_dir().map(|dir| dir.join(APP_CONFIG_DIR))
}

/// Migrate the legacy application data directory to the canonical location.
///
/// `config.db` is the completion marker. A destination containing only logs or
/// other partial data is merged with the legacy directory. The legacy data is
/// removed only after a rename or complete recursive copy succeeds.
pub fn migrate_legacy_config_dir() -> std::io::Result<()> {
    let Some(base_dir) = dirs::config_dir() else {
        return Ok(());
    };
    let legacy_dir = base_dir.join(LEGACY_CONFIG_DIR);
    let legacy_existed = legacy_dir.exists();
    let result = migrate_legacy_config_dir_in(&base_dir);
    if result.is_ok() && legacy_existed && !legacy_dir.exists() {
        eprintln!("Migrated application data from {LEGACY_CONFIG_DIR} to {APP_CONFIG_DIR}");
    }
    result
}

fn migrate_legacy_config_dir_in(base_dir: &Path) -> std::io::Result<()> {
    migrate_legacy_config_dir_with(base_dir, |from, to| fs::rename(from, to))
}

/// Migration core with an injectable rename operation so the cross-device
/// (EXDEV) and rename-error branches are unit-testable without a real second
/// filesystem.
fn migrate_legacy_config_dir_with(
    base_dir: &Path,
    rename: impl Fn(&Path, &Path) -> std::io::Result<()>,
) -> std::io::Result<()> {
    let new_dir = base_dir.join(APP_CONFIG_DIR);
    let old_dir = base_dir.join(LEGACY_CONFIG_DIR);

    if !old_dir.exists() || new_dir.join("config.db").exists() {
        return Ok(());
    }

    match rename(&old_dir, &new_dir) {
        Ok(()) => Ok(()),
        Err(error) if error.raw_os_error() == Some(libc::EXDEV) => {
            copy_dir_then_swap(&old_dir, &new_dir)
        }
        Err(error) if error.kind() == ErrorKind::AlreadyExists => merge_dirs(&old_dir, &new_dir),
        // Some platforms report a non-empty destination using an error kind
        // other than AlreadyExists. It is still the logs-only merge case as
        // long as the destination appeared and has no completion marker.
        Err(_) if new_dir.exists() && !new_dir.join("config.db").exists() => {
            merge_dirs(&old_dir, &new_dir)
        }
        // Another process may have completed the migration after our guards.
        Err(_) if !old_dir.exists() && new_dir.join("config.db").exists() => Ok(()),
        Err(error) => Err(error),
    }
}

fn copy_dir_then_swap(old_dir: &Path, new_dir: &Path) -> std::io::Result<()> {
    let parent = new_dir
        .parent()
        .ok_or_else(|| std::io::Error::other("config directory has no parent"))?;
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temp_dir = parent.join(format!(
        ".{APP_CONFIG_DIR}.migration-{}-{unique}",
        std::process::id()
    ));

    let copied = (|| {
        copy_dir_recursive(old_dir, &temp_dir)?;
        match fs::rename(&temp_dir, new_dir) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == ErrorKind::AlreadyExists || new_dir.exists() => {
                copy_dir_recursive(&temp_dir, new_dir)?;
                fs::remove_dir_all(&temp_dir)
            }
            Err(error) => Err(error),
        }
    })();

    if copied.is_err() {
        let _ = fs::remove_dir_all(&temp_dir);
    }
    copied?;
    fs::remove_dir_all(old_dir)
}

fn merge_dirs(old_dir: &Path, new_dir: &Path) -> std::io::Result<()> {
    copy_dir_recursive(old_dir, new_dir)?;
    fs::remove_dir_all(old_dir)
}

fn copy_dir_recursive(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::create_dir_all(destination)?;
    let mut entries = fs::read_dir(source)?.collect::<Result<Vec<_>, _>>()?;
    // Copy the completion marker last so concurrent starts never treat a
    // partially copied directory as fully migrated.
    entries.sort_by_key(|entry| entry.file_name() == OsStr::new("config.db"));

    for entry in entries {
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            copy_dir_recursive(&source_path, &destination_path)?;
        } else if file_type.is_file() {
            fs::copy(&source_path, &destination_path)?;
        }
        // Skip non-regular files (unix sockets like a stale debug.sock, FIFOs,
        // symlinks): they carry no user data and fs::copy cannot handle them.
    }
    Ok(())
}

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
        // Use the canonical application data directory.
        let config_dir = app_config_dir().ok_or("Cannot find config directory")?;

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

    /// Path to prompts.db SQLite database (multi-prompt LLM templates).
    pub fn prompts_db(&self) -> PathBuf {
        self.config_dir.join("prompts.db")
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

    #[test]
    fn migrate_legacy_config_dir_happy_path() {
        let temp = tempfile::tempdir().unwrap();
        let legacy = temp.path().join(LEGACY_CONFIG_DIR);
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("config.db"), b"legacy config").unwrap();

        migrate_legacy_config_dir_in(temp.path()).unwrap();

        assert!(!legacy.exists());
        assert_eq!(
            fs::read(temp.path().join(APP_CONFIG_DIR).join("config.db")).unwrap(),
            b"legacy config"
        );
    }

    #[test]
    fn migrate_legacy_config_dir_merges_into_logs_only_destination() {
        let temp = tempfile::tempdir().unwrap();
        let legacy = temp.path().join(LEGACY_CONFIG_DIR);
        let destination = temp.path().join(APP_CONFIG_DIR);
        fs::create_dir_all(legacy.join("logs")).unwrap();
        fs::create_dir_all(destination.join("logs")).unwrap();
        fs::write(legacy.join("config.db"), b"legacy config").unwrap();
        fs::write(legacy.join("logs/legacy.log"), b"legacy log").unwrap();
        fs::write(destination.join("logs/current.log"), b"current log").unwrap();

        migrate_legacy_config_dir_in(temp.path()).unwrap();

        assert!(!legacy.exists());
        assert_eq!(
            fs::read(destination.join("config.db")).unwrap(),
            b"legacy config"
        );
        assert!(destination.join("logs/legacy.log").exists());
        assert!(destination.join("logs/current.log").exists());
    }

    #[test]
    fn migrate_legacy_config_dir_keeps_legacy_when_both_have_data() {
        let temp = tempfile::tempdir().unwrap();
        let legacy = temp.path().join(LEGACY_CONFIG_DIR);
        let destination = temp.path().join(APP_CONFIG_DIR);
        fs::create_dir_all(&legacy).unwrap();
        fs::create_dir_all(&destination).unwrap();
        fs::write(legacy.join("config.db"), b"legacy config").unwrap();
        fs::write(destination.join("config.db"), b"current config").unwrap();

        migrate_legacy_config_dir_in(temp.path()).unwrap();

        assert_eq!(
            fs::read(legacy.join("config.db")).unwrap(),
            b"legacy config"
        );
        assert_eq!(
            fs::read(destination.join("config.db")).unwrap(),
            b"current config"
        );
    }

    #[test]
    fn migrate_legacy_config_dir_is_idempotent() {
        let temp = tempfile::tempdir().unwrap();
        let legacy = temp.path().join(LEGACY_CONFIG_DIR);
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("config.db"), b"legacy config").unwrap();

        migrate_legacy_config_dir_in(temp.path()).unwrap();
        migrate_legacy_config_dir_in(temp.path()).unwrap();

        assert_eq!(
            fs::read(temp.path().join(APP_CONFIG_DIR).join("config.db")).unwrap(),
            b"legacy config"
        );
    }

    // Forces the cross-device fallback by injecting a rename that returns EXDEV,
    // exercising copy_dir_then_swap end-to-end (the branch that deletes legacy
    // data only after a complete copy).
    #[test]
    fn migrate_uses_copy_fallback_on_exdev() {
        let temp = tempfile::tempdir().unwrap();
        let legacy = temp.path().join(LEGACY_CONFIG_DIR);
        fs::create_dir_all(legacy.join("logs")).unwrap();
        fs::write(legacy.join("config.db"), b"legacy config").unwrap();
        fs::write(legacy.join("logs/app.log"), b"log data").unwrap();

        migrate_legacy_config_dir_with(temp.path(), |_, _| {
            Err(std::io::Error::from_raw_os_error(libc::EXDEV))
        })
        .unwrap();

        let destination = temp.path().join(APP_CONFIG_DIR);
        assert!(!legacy.exists(), "legacy removed only after full copy");
        assert_eq!(
            fs::read(destination.join("config.db")).unwrap(),
            b"legacy config"
        );
        assert_eq!(
            fs::read(destination.join("logs/app.log")).unwrap(),
            b"log data"
        );
    }

    // A non-EXDEV, non-AlreadyExists rename failure (e.g. EPERM) with no
    // destination present must surface Err and leave legacy data untouched.
    #[test]
    fn migrate_preserves_legacy_on_rename_error() {
        let temp = tempfile::tempdir().unwrap();
        let legacy = temp.path().join(LEGACY_CONFIG_DIR);
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("config.db"), b"legacy config").unwrap();

        let result = migrate_legacy_config_dir_with(temp.path(), |_, _| {
            Err(std::io::Error::from_raw_os_error(libc::EPERM))
        });

        assert!(result.is_err(), "rename failure must propagate");
        assert_eq!(
            fs::read(legacy.join("config.db")).unwrap(),
            b"legacy config"
        );
        assert!(
            !temp.path().join(APP_CONFIG_DIR).exists(),
            "rename failure must not create an empty or partial destination"
        );
    }

    // copy_dir_inner must skip non-regular files (a stale debug.sock) instead of
    // erroring, so the EXDEV/merge paths survive leftover debug sockets.
    #[cfg(unix)]
    #[test]
    fn copy_fallback_skips_unix_socket() {
        use std::os::unix::net::UnixListener;
        let temp = tempfile::tempdir().unwrap();
        let legacy = temp.path().join(LEGACY_CONFIG_DIR);
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("config.db"), b"legacy config").unwrap();
        let _listener = UnixListener::bind(legacy.join("debug.sock")).unwrap();

        migrate_legacy_config_dir_with(temp.path(), |_, _| {
            Err(std::io::Error::from_raw_os_error(libc::EXDEV))
        })
        .unwrap();

        let destination = temp.path().join(APP_CONFIG_DIR);
        assert_eq!(
            fs::read(destination.join("config.db")).unwrap(),
            b"legacy config"
        );
        assert!(!destination.join("debug.sock").exists(), "socket skipped");
    }

    // A barrier inside the injected rename guarantees both calls pass the
    // preflight checks before either attempts the same-parent fast-path rename.
    #[test]
    fn migrate_is_safe_under_concurrency() {
        use std::sync::{Arc, Barrier};

        let temp = tempfile::tempdir().unwrap();
        let legacy = temp.path().join(LEGACY_CONFIG_DIR);
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("config.db"), b"legacy config").unwrap();
        fs::write(legacy.join("dictionary.txt"), b"legacy dictionary").unwrap();

        let base = temp.path().to_path_buf();
        let barrier = Arc::new(Barrier::new(2));
        let handles: Vec<_> = (0..2)
            .map(|_| {
                let base = base.clone();
                let barrier = Arc::clone(&barrier);
                std::thread::spawn(move || {
                    migrate_legacy_config_dir_with(&base, move |from, to| {
                        barrier.wait();
                        fs::rename(from, to)
                    })
                })
            })
            .collect();

        for handle in handles {
            handle.join().unwrap().unwrap();
        }

        let destination = temp.path().join(APP_CONFIG_DIR);
        assert!(!legacy.exists());
        assert_eq!(
            fs::read(destination.join("config.db")).unwrap(),
            b"legacy config"
        );
        assert_eq!(
            fs::read(destination.join("dictionary.txt")).unwrap(),
            b"legacy dictionary"
        );
    }
}
