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
use std::path::PathBuf;
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

    /// Writes `map` to `self.path` as 0600 from the moment the file is
    /// created, on unix — `OpenOptions::mode(0o600)` applies the
    /// permission atomically as part of `open(2)`'s `O_CREAT`, unlike a
    /// separate `create()` + `set_permissions()` pair, which leaves a
    /// window (however brief) where the file exists with the process's
    /// default umask-derived permissions before the chmod lands.
    fn save(&self, map: &HashMap<String, String>) -> SecretResult<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(map)?;
        #[cfg(unix)]
        {
            use std::io::Write;
            use std::os::unix::fs::OpenOptionsExt;
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .mode(0o600)
                .open(&self.path)?;
            file.write_all(json.as_bytes())?;
        }
        #[cfg(not(unix))]
        {
            fs::write(&self.path, json)?;
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
