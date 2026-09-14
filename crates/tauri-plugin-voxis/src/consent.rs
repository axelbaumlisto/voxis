//! Per-(host id, provider host) consent gate — App Store 5.1.2(i) requires
//! explicit consent before audio/text leave the device to a third-party
//! STT/LLM provider (plan decision 8, `[R1-Safety S6]`). The `start`
//! command refuses to begin a session until `set_consent(true)` has been
//! recorded for the plugin's current (host, provider) pair.
//!
//! Persistence: KISS, matching the plan's Task 3 step 4 ("consent.rs:
//! ... keyed by (host id, provider host)") — a small JSON file living
//! next to `secrets.rs`'s `FileSecretStore` file, NOT sqlite. `ConsentState`
//! is the pure, directly-testable in-memory model; `ConsentStore` is the
//! thin file-IO wrapper around it. Never stores secret *values* — only
//! `true`/`false` per key, which `secret_never_written_to_consent_json`
//! below asserts directly.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

pub type ConsentResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

fn consent_key(host_id: &str, provider_host: &str) -> String {
    format!("{host_id}::{provider_host}")
}

/// Pure in-memory consent model — no file IO, fully unit-testable.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ConsentState {
    /// `"<host_id>::<provider_host>"` -> whether the user has consented.
    granted: HashMap<String, bool>,
}

impl ConsentState {
    pub fn is_consented(&self, host_id: &str, provider_host: &str) -> bool {
        self.granted.get(&consent_key(host_id, provider_host)).copied().unwrap_or(false)
    }

    pub fn set_consent(&mut self, host_id: &str, provider_host: &str, consented: bool) {
        self.granted.insert(consent_key(host_id, provider_host), consented);
    }
}

/// File-backed `ConsentState` — one JSON file per plugin instance.
pub struct ConsentStore {
    path: PathBuf,
}

impl ConsentStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    fn load(&self) -> ConsentResult<ConsentState> {
        match fs::read_to_string(&self.path) {
            Ok(raw) => Ok(serde_json::from_str(&raw)?),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(ConsentState::default()),
            Err(e) => Err(Box::new(e)),
        }
    }

    fn save(&self, state: &ConsentState) -> ConsentResult<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(state)?;
        fs::write(&self.path, json)?;
        Ok(())
    }

    pub fn is_consented(&self, host_id: &str, provider_host: &str) -> ConsentResult<bool> {
        Ok(self.load()?.is_consented(host_id, provider_host))
    }

    pub fn set_consent(&self, host_id: &str, provider_host: &str, consented: bool) -> ConsentResult<()> {
        let mut state = self.load()?;
        state.set_consent(host_id, provider_host, consented);
        self.save(&state)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_state_has_no_consent() {
        let state = ConsentState::default();
        assert!(!state.is_consented("naked", "api.groq.com"));
    }

    #[test]
    fn set_consent_is_keyed_by_host_and_provider() {
        let mut state = ConsentState::default();
        state.set_consent("naked", "api.groq.com", true);

        assert!(state.is_consented("naked", "api.groq.com"));
        assert!(!state.is_consented("naked", "api.openai.com"), "different provider, no consent");
        assert!(!state.is_consented("other-host", "api.groq.com"), "different host, no consent");
    }

    #[test]
    fn set_consent_can_revoke() {
        let mut state = ConsentState::default();
        state.set_consent("naked", "api.groq.com", true);
        state.set_consent("naked", "api.groq.com", false);
        assert!(!state.is_consented("naked", "api.groq.com"));
    }

    #[test]
    fn consent_store_persists_across_instances() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("voxis-plugin").join("consent.json");

        ConsentStore::new(path.clone()).set_consent("naked", "api.groq.com", true).unwrap();

        let reopened = ConsentStore::new(path);
        assert!(reopened.is_consented("naked", "api.groq.com").unwrap());
    }

    #[test]
    fn consent_json_never_contains_a_secret_value() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("consent.json");
        let store = ConsentStore::new(path.clone());
        store.set_consent("naked", "api.groq.com", true).unwrap();

        let raw = fs::read_to_string(&path).unwrap();
        assert!(!raw.contains("sk-"), "consent store must never contain API-key-shaped values");
        // Structurally: only string keys mapping to booleans.
        let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let granted = parsed.get("granted").unwrap().as_object().unwrap();
        for (_key, value) in granted {
            assert!(value.is_boolean());
        }
    }
}
