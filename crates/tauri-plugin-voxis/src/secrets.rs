//! `SecretStore` — the plugin never puts API keys/bearer credentials in
//! sqlite (`[R1-Safety S2]`); the host injects its own implementation via
//! `init_with` (naked already has `naked_core::SecretStore` with
//! envelope encryption), and this crate ships two of its own:
//! `InMemorySecretStore` for tests and `FileSecretStore` — a 0600 JSON
//! file, the *desktop default* until Task 4/8 add a real OS-keychain
//! (`keyring` crate) integration. `FileSecretStore` is deliberately not
//! that: adding the `keyring` dependency now is out of scope for a
//! contract/skeleton task (KISS) — see the `tracing::warn!` in
//! `FileSecretStore::new` and this module's doc comment as the recorded
//! follow-up.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use voxis_core::profile::Secret;

pub type SecretResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

/// `[R1-Safety S8]`: the trait carries `voxis_core::profile::Secret`, not a
/// plain `String` — hosts implement this trait (naked's own
/// `naked_core::SecretStore` via `init_with`), and a bare `String` in the
/// signature would let a secret slip into a stray `Debug`/log call at any
/// implementor's call site with no compiler help. `Secret`'s `Debug` is
/// `[REDACTED]` and the only way to read the wrapped value is
/// `Secret::expose()` — callers (this module's `FileSecretStore`, the
/// eventual profile-apply code in Task 2/6/7) call `expose()` only at the
/// actual serialization boundary (writing the JSON file / handing the key
/// to `TranscriptionClient`), which keeps every place a secret becomes a
/// plain string grep-able.
pub trait SecretStore: Send + Sync {
    fn get(&self, name: &str) -> SecretResult<Option<Secret>>;
    fn set(&self, name: &str, value: &Secret) -> SecretResult<()>;
    fn delete(&self, name: &str) -> SecretResult<()>;
}

/// In-memory `SecretStore` — unit tests only, never persisted.
#[derive(Default)]
pub struct InMemorySecretStore {
    values: Mutex<HashMap<String, Secret>>,
}

impl InMemorySecretStore {
    pub fn new() -> Self {
        Self::default()
    }
}

impl SecretStore for InMemorySecretStore {
    fn get(&self, name: &str) -> SecretResult<Option<Secret>> {
        Ok(self.values.lock().unwrap().get(name).cloned())
    }

    fn set(&self, name: &str, value: &Secret) -> SecretResult<()> {
        self.values.lock().unwrap().insert(name.to_string(), value.clone());
        Ok(())
    }

    fn delete(&self, name: &str) -> SecretResult<()> {
        self.values.lock().unwrap().remove(name);
        Ok(())
    }
}

/// Desktop fallback `SecretStore`: a single 0600 JSON file
/// (`<host-config>/voxis-plugin/secrets.json`) holding a flat
/// name -> value map, written wholesale on every mutation (KISS — this
/// file is expected to hold a handful of provider API keys, not a
/// database's worth of rows).
pub struct FileSecretStore {
    path: PathBuf,
}

impl FileSecretStore {
    /// `path` is the JSON file's own path, e.g.
    /// `<host-config>/voxis-plugin/secrets.json` — callers create the
    /// parent directory implicitly (see `set`/`save`, which calls
    /// `create_dir_all` on the parent).
    pub fn new(path: PathBuf) -> Self {
        tracing::warn!(
            path = %path.display(),
            "FileSecretStore: 0600 JSON fallback in use, not a real OS keychain \
             (Task 4/8 follow-up: `keyring` crate on desktop, Keychain on iOS)"
        );
        Self { path }
    }

    fn load(&self) -> SecretResult<HashMap<String, String>> {
        match fs::read_to_string(&self.path) {
            Ok(raw) => Ok(serde_json::from_str(&raw)?),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
            Err(e) => Err(Box::new(e)),
        }
    }

    /// Writes `map` to `self.path` via a temp-file-then-rename
    /// (`[ADO-2/3]`): the temp file is created 0600 from the moment it
    /// exists (on unix — same `OpenOptions::mode(0o600)`-on-`O_CREAT`
    /// reasoning as `RecFile::create` in `capture.rs`), written in full,
    /// `sync_all()`'d, then `fs::rename`d over `self.path`. `rename(2)`
    /// within the same directory is atomic **for visibility**: a
    /// crash/kill mid-write can never expose a half-written
    /// `secrets.json` to a concurrent `load()` — the rename either
    /// hasn't happened yet (previous file, fully intact) or has already
    /// completed (new file, fully written). This is a claim about what
    /// `load()` can ever *observe*, not about durability: `sync_all()`
    /// before the rename is what protects against the new file's bytes
    /// still sitting in a dirty page cache (and therefore vanishing) if
    /// the machine loses power between the rename returning and the OS
    /// actually flushing it — without it, `rename`'s atomicity alone
    /// would only guarantee "never half-written", not "never reverted to
    /// missing/stale after a power loss". On Windows, this same
    /// same-directory `fs::rename` goes through `MoveFileExW` with
    /// `MOVEFILE_REPLACE_EXISTING` (current Rust std behaviour) to get
    /// the equivalent "replace the destination atomically" semantics.
    /// The temp file lives alongside the real one (same directory)
    /// precisely so the rename is same-filesystem rather than a cross-
    /// filesystem copy.
    fn save(&self, map: &HashMap<String, String>) -> SecretResult<()> {
        let parent = self.path.parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("."));
        fs::create_dir_all(&parent)?;
        let json = serde_json::to_string_pretty(map)?;

        let file_name = self.path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "secrets.json".to_string());
        let tmp_path = parent.join(format!(".{file_name}.{}.tmp", uuid::Uuid::new_v4()));

        let write_result: SecretResult<()> = (|| {
            use std::io::Write;
            #[cfg(unix)]
            let mut file = {
                use std::os::unix::fs::OpenOptionsExt;
                fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(&tmp_path)?
            };
            #[cfg(not(unix))]
            let mut file = fs::OpenOptions::new().write(true).create(true).truncate(true).open(&tmp_path)?;
            file.write_all(json.as_bytes())?;
            // Flush to disk before the rename below makes this the
            // visible `secrets.json` — see this function's own doc
            // comment on why `rename`'s atomicity alone isn't durability.
            file.sync_all()?;
            Ok(())
        })();

        if let Err(e) = write_result {
            let _ = fs::remove_file(&tmp_path);
            return Err(e);
        }

        if let Err(e) = fs::rename(&tmp_path, &self.path) {
            let _ = fs::remove_file(&tmp_path);
            return Err(Box::new(e));
        }
        Ok(())
    }
}

impl SecretStore for FileSecretStore {
    fn get(&self, name: &str) -> SecretResult<Option<Secret>> {
        Ok(self.load()?.get(name).cloned().map(Secret::new))
    }

    fn set(&self, name: &str, value: &Secret) -> SecretResult<()> {
        let mut map = self.load()?;
        // `expose()` only at this serialization boundary — see the
        // `SecretStore` trait doc comment.
        map.insert(name.to_string(), value.expose().to_string());
        self.save(&map)
    }

    fn delete(&self, name: &str) -> SecretResult<()> {
        let mut map = self.load()?;
        map.remove(name);
        self.save(&map)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn in_memory_round_trips() {
        let store = InMemorySecretStore::new();
        assert_eq!(store.get("api_key").unwrap(), None);
        store.set("api_key", &Secret::new("sk-abc")).unwrap();
        assert_eq!(store.get("api_key").unwrap().map(|s| s.expose().to_string()), Some("sk-abc".to_string()));
        store.delete("api_key").unwrap();
        assert_eq!(store.get("api_key").unwrap(), None);
    }

    #[test]
    fn file_secret_store_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("voxis-plugin").join("secrets.json");
        let store = FileSecretStore::new(path.clone());

        assert_eq!(store.get("api_key").unwrap(), None);
        store.set("api_key", &Secret::new("sk-abc")).unwrap();
        assert_eq!(store.get("api_key").unwrap().map(|s| s.expose().to_string()), Some("sk-abc".to_string()));

        store.set("other", &Secret::new("value")).unwrap();
        store.delete("api_key").unwrap();
        assert_eq!(store.get("api_key").unwrap(), None);
        assert_eq!(store.get("other").unwrap().map(|s| s.expose().to_string()), Some("value".to_string()));
    }

    /// `[ADO-2/3]`: `save()` must not leave its temp file behind, on
    /// success -- the directory must contain exactly the real
    /// `secrets.json`, nothing else (no `.secrets.json.<uuid>.tmp`
    /// orphan).
    #[test]
    fn file_secret_store_save_leaves_no_temp_file_behind() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("secrets.json");
        let store = FileSecretStore::new(path.clone());

        store.set("api_key", &Secret::new("sk-abc")).unwrap();

        let entries: Vec<_> = fs::read_dir(dir.path()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(entries, vec![std::ffi::OsString::from("secrets.json")], "no temp file must survive a successful save()");
    }

    #[test]
    fn file_secret_store_file_is_0600_on_unix() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("secrets.json");
        let store = FileSecretStore::new(path.clone());
        store.set("api_key", &Secret::new("sk-abc")).unwrap();

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }
    }
}
