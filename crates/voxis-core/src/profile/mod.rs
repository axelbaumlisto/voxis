//! `VoxisProfile` \u2014 the versioned snapshot of "everything a plugin instance
//! needs to behave like the user's desktop Voxis" (Approach decision 6):
//! provider/model/guard settings, LLM providers + prompts, the dictionary,
//! the active theme id, and the hotkey string. Explicitly **not** included:
//! history, corrections/learning-suggestion state, debug settings, or any
//! desktop-only path/window-position field \u2014 see `ProfileConfig`'s doc
//! comment for the field-by-field exclusion list.
//!
//! Three responsibilities live here:
//! - the data model (`VoxisProfile`, `ProfileConfig`, `LlmProfile`) plus
//!   `serde` (forward-compatible: unknown fields are ignored, no
//!   `#[serde(deny_unknown_fields)]`; `version` is checked explicitly
//!   because serde alone can't express "reject `2`, not just `!= u32`");
//! - building one from storage (`from_storage`) and applying one back
//!   (`apply_to`), both against the `storage::traits` abstractions so this
//!   module never depends on a concrete SQLite/file layout beyond what
//!   those traits already expose;
//! - `[R1-Safety S1]` sealing/opening the whole thing for transport
//!   (`crypto.rs`, re-exported as `seal`/`open`).
//!
//! `[R1-Safety S8]` Secrets (`api_key`, `llm.api_key`) never live on
//! `VoxisProfile` itself \u2014 they travel in the sibling `ProfileSecrets`
//! struct (see `secret.rs`), which `apply_to` routes to a `SecretSink`
//! instead of any `ConfigStorage`.

mod crypto;
mod secret;

#[cfg(test)]
mod tests;

pub use crypto::{decode_base64url, encode_base64url, KeySource};
pub use secret::Secret;

use serde::{Deserialize, Serialize};

use crate::llm::prompts::LlmPrompt;
use crate::storage::traits::{ConfigStorage, DictionaryStorage, ProvidersStorage, StorageResult};
use crate::storage::{prompts_sqlite::LlmPromptsStorage, LlmProvider};

/// Errors from building, applying, sealing, or opening a `VoxisProfile`.
#[derive(Debug, thiserror::Error)]
pub enum ProfileError {
    /// `version` field is not `VoxisProfile::CURRENT_VERSION`.
    #[error("unsupported profile version {found} (this build supports version {})", VoxisProfile::CURRENT_VERSION)]
    UnsupportedVersion { found: u32 },
    /// `config::validation::validate_config` rejected the merged config.
    /// `apply_to` writes nothing when this variant is returned.
    #[error("profile validation failed: {0}")]
    Validation(String),
    /// A `ConfigStorage`/`DictionaryStorage`/`ProvidersStorage`/
    /// `LlmPromptsStorage`/`SecretSink` call failed.
    #[error("storage error: {0}")]
    Storage(String),
    /// A `seal`/`open` (crypto.rs) call failed \u2014 bad key, tampered bytes,
    /// truncated input, or an RNG/KDF failure. Never a panic.
    #[error("crypto error: {0}")]
    Crypto(String),
    /// The sealed/opened JSON payload itself didn't parse.
    #[error("profile (de)serialization error: {0}")]
    Serde(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, ProfileError>;

fn storage_err<E: std::fmt::Display>(e: E) -> ProfileError {
    ProfileError::Storage(e.to_string())
}

/// Name `apply_to` puts the transcription API key under in the
/// `SecretSink`; also the value of `ProfileConfig::api_key_ref` once a key
/// is present. `from_storage` and `apply_to` share this constant so the
/// `_ref` produced by one side is exactly the name the other resolves.
pub const API_KEY_SECRET_NAME: &str = "api_key";
/// Same as [`API_KEY_SECRET_NAME`] for the LLM post-processing API key.
pub const LLM_API_KEY_SECRET_NAME: &str = "llm_api_key";

/// The syncable subset of `AppConfig` \u2014 everything a plugin instance needs
/// to reproduce the desktop's transcription/LLM/guard behaviour, with both
/// API keys replaced by `_ref` markers (the actual secret travels in the
/// sibling `ProfileSecrets`, never through this struct).
///
/// **Included** (why): `provider`/`model`/`api_url_override`/`language`/
/// `translate_to_english` (what/how to transcribe); `min_recording_ms`/
/// `silence_timeout_ms`/`max_recording_ms`/`hotkey_hold_ms` (the guard/hold
/// timings `voxis_core::guard` needs, identical meaning on any host);
/// `llm_enabled`/`llm_provider`/`llm_api_url`/`llm_model`/`llm_prompt` (the
/// single legacy LLM config envelope \u2014 the multi-prompt list itself is
/// `VoxisProfile::llm.prompts`, not duplicated here).
///
/// **Excluded** (`AppConfig` fields NOT mirrored here, and why):
/// - `history_enabled`, `history_days`, `retention_period`, `retention_limit`
///   \u2014 history domain, explicitly out of scope (Approach decision 6).
/// - `dictionary.learning_mode`, `dictionary.learning_threshold`,
///   `dictionary.path` \u2014 corrections/learning-suggestion domain (the
///   actual word list is `VoxisProfile::dictionary`, a plain value, not this
///   config); explicitly out of scope alongside history.
/// - `debug` \u2014 explicitly out of scope.
/// - `always_on_microphone`, `vad` \u2014 desktop cpal capture specifics with
///   no plugin-side equivalent; the plugin's `AudioCapture` backends
///   (cpal on desktop, `AVAudioEngine` on iOS) own their own VAD
///   behaviour. `audio_device` itself moved OUT of this exclusion list
///   (`[HW-GATE finding]`/Task 6b) \u2014 see `audio_device`'s own field doc
///   below.
/// - `backend` \u2014 desktop display-server selection (`x11`/`wayland`/
///   `darwin`/`windows`), meaningless to a plugin.
/// - `active_provider`, `local_backend` \u2014 desktop's cloud-vs-local-whisper
///   toggle; the plugin is server-only in v1 (Approach decision 7), so only
///   `cloud_provider` (renamed `provider` here) is syncable.
/// - `auto_type`, `auto_enter`, `typing_delay`, `notifications`,
///   `audio_feedback`, `auto_submit_key`, `paste_shortcuts` \u2014 output/typing
///   mechanism; the plugin returns text to the host and never types/pastes
///   itself (Approach decision 2), so these have no meaning here.
///   `append_trailing_space` falls in the same bucket: it's a desktop
///   auto-type nicety, not a property of the transcription itself.
/// - `overlay` (all of it) \u2014 window-position-like desktop-only UI state;
///   only `overlay.theme` is syncable, and it is promoted to
///   `VoxisProfile::theme` (top-level, per the plan's model) instead of
///   living here.
/// - `hotkey`, `hotkey_mode`, `shortcut_bindings` \u2014 `hotkey` is promoted to
///   `VoxisProfile::hotkey` (top-level); `hotkey_mode`/`shortcut_bindings`
///   are desktop's multi-binding shortcut UI, superseded on the plugin side
///   by the explicit `start(mode: Hold|Toggle)` command parameter (Task 3).
/// - `first_run_completed` \u2014 desktop onboarding-wizard flag.
/// - `text_processing` \u2014 present in `AppConfig`/storage but not read by any
///   pipeline code we could find (`grep -rn text_processing` outside
///   storage round-trip code is empty); excluded as an unused legacy toggle
///   rather than guessed at.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileConfig {
    pub provider: String,
    pub model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_url_override: Option<String>,
    pub language: String,
    #[serde(default)]
    pub translate_to_english: bool,
    /// `[HW-GATE finding]`/Task 6b: the cpal input device name
    /// (`AppConfig::audio_device`), promoted from the exclusion list this
    /// struct's own doc comment used to carry it on. `None` means "system
    /// default" (`voxis_core::config::DEFAULT_AUDIO_DEVICE`, the literal
    /// string `"default"`) \u2014 `from_storage`/`apply_to` map between that
    /// sentinel string and `None` so this field is never the literal
    /// string `"default"` on the wire. Portable between the same user's
    /// Macs (a device NAME, not a persistent OS handle \u2014 `desktop.rs`'s
    /// `CpalCapture::with_device_id`/`open_device` already resolve by
    /// name, falling back to the system default if the named device
    /// isn't present on this machine); **ignored on iOS** (no cpal, no
    /// device-name concept \u2014 `AVAudioEngine`'s `.record` session always
    /// uses the system input, Task 8's own doc). Real desktop hardware
    /// case this fixes: a Mac whose system default input is a
    /// Bluetooth/lavalier mic that silently records zeros
    /// (`research/plugin-plan/HUMAN_GATE_3_5_headless.md`) \u2014 without this
    /// field, an imported profile could never steer the plugin away from
    /// that default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_device: Option<String>,
    pub min_recording_ms: u32,
    pub silence_timeout_ms: u32,
    pub max_recording_ms: u32,
    pub hotkey_hold_ms: u32,

    #[serde(default)]
    pub llm_enabled: bool,
    pub llm_provider: String,
    pub llm_api_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub llm_api_key_ref: Option<String>,
    pub llm_model: String,
    pub llm_prompt: String,
}

/// LLM providers + multi-prompt templates + the currently active prompt id.
/// Reuses the exact storage-layer types (`LlmProvider`, `LlmPrompt`) \u2014
/// neither carries secrets, so no redaction concern here (LLM API keys live
/// in `ProfileConfig::llm_api_key_ref` / `ProfileSecrets::llm_api_key`, not
/// per-provider).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmProfile {
    pub providers: Vec<LlmProvider>,
    pub prompts: Vec<LlmPrompt>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_prompt_id: Option<String>,
}

// `storage::LlmProvider` (out of this module's edit scope, see the task's
// `MODIFY ONLY` list) doesn't derive `PartialEq`, so `LlmProfile` can't
// `#[derive(PartialEq)]` either. Compare through canonical JSON instead —
// exactly what the round-trip tests care about ("same profile after a
// seal/open or from_storage/apply_to/from_storage cycle").
impl PartialEq for LlmProfile {
    fn eq(&self, other: &Self) -> bool {
        serde_json::to_value(self).ok() == serde_json::to_value(other).ok()
    }
}

/// The full exportable/importable snapshot. See module docs for what is
/// (and, in `ProfileConfig`, is deliberately not) included.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoxisProfile {
    pub version: u32,
    pub config: ProfileConfig,
    /// (source, replacement) pairs \u2014 same shape as
    /// `DictionaryStorage::load()`.
    pub dictionary: Vec<(String, String)>,
    pub llm: LlmProfile,
    /// Overlay theme id (`AppConfig.overlay.theme`), promoted to the top
    /// level \u2014 see `ProfileConfig`'s exclusion list.
    pub theme: String,
    /// Hotkey spec string (`AppConfig.hotkey`), promoted to the top level
    /// for the same reason.
    pub hotkey: String,
}

/// A tiny trait the plugin's `SecretStore` implements so `apply_to` can
/// hand secrets to it without this crate depending on that concrete type
/// (which lives in `tauri-plugin-voxis`, a separate crate). Intentionally
/// minimal \u2014 `apply_to` only ever needs to *write* secrets, never read them
/// back.
pub trait SecretSink {
    /// Store `value` under `name` (e.g. `API_KEY_SECRET_NAME`). Must not
    /// leak `value` into any log/error message it returns.
    fn put(&mut self, name: &str, value: &Secret) -> StorageResult<()>;
}

/// The two API keys a `VoxisProfile` can reference. Kept separate from
/// `VoxisProfile`/`ProfileConfig` \u2014 both of which are safe to log/serialize
/// to disk unencrypted \u2014 so a stray `Debug`/`Serialize` of the profile can
/// never include key material (`ProfileConfig` only ever holds the `_ref`
/// marker string). `Debug` is derived and therefore redacted for free:
/// `Option<Secret>`'s `Debug` defers to `Secret`'s `[REDACTED]` impl.
#[derive(Debug, Clone, Default)]
pub struct ProfileSecrets {
    pub api_key: Option<Secret>,
    pub llm_api_key: Option<Secret>,
}

/// The on-the-wire DTO sealed by `seal`/opened by `open`. Not public: this
/// is the one place secrets are allowed to touch `serde::Serialize`
/// (`Secret::expose()`'d into plain `String` fields), which is why it's a
/// distinct type instead of adding `#[derive(Serialize)]` to
/// `ProfileSecrets`/`Secret` themselves.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SealedPayload {
    profile: VoxisProfile,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    api_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    llm_api_key: Option<String>,
}

impl VoxisProfile {
    /// The only version this build understands. `apply_to` and `open`
    /// (both via `check_version`) reject anything else with an explicit,
    /// version-naming error rather than silently coercing or
    /// `#[serde(deny_unknown_fields)]`-rejecting on unrelated new fields
    /// (forward-compat: a newer profile's *unknown* fields are ignored,
    /// but a version bump is a deliberate breaking change the importer
    /// must refuse).
    pub const CURRENT_VERSION: u32 = 1;

    /// Explicit version gate -- serde's `#[serde(default)]`/type system has
    /// no way to express "any u32 except 2 is fine, but 2 must error with
    /// its own value in the message", so this is a plain post-deserialize
    /// check. `apply_to` and `open` both call this before doing anything
    /// else with a `VoxisProfile` they didn't just build via
    /// `from_storage` themselves; importers must never bypass it by
    /// deserializing a `VoxisProfile` with a bare
    /// `serde_json::from_str`/`from_slice` and skipping straight to field
    /// access -- `version` is not otherwise validated by serde (no
    /// `#[serde(deny_unknown_fields)]`, no `TryFrom`-style constructor).
    pub fn check_version(&self) -> Result<()> {
        if self.version != Self::CURRENT_VERSION {
            return Err(ProfileError::UnsupportedVersion { found: self.version });
        }
        Ok(())
    }

    /// Build a profile + its secrets from the four storage abstractions.
    /// Never touches history/corrections storage \u2014 there is no parameter
    /// for either, so "history doesn't leak into the profile" is a
    /// signature-level guarantee, not just a field omission.
    pub fn from_storage(
        config_storage: &dyn ConfigStorage,
        dictionary_storage: &dyn DictionaryStorage,
        providers_storage: &dyn ProvidersStorage,
        prompts_storage: &LlmPromptsStorage,
    ) -> Result<(VoxisProfile, ProfileSecrets)> {
        let app_config = config_storage.load().map_err(storage_err)?;
        let dictionary = dictionary_storage.load().map_err(storage_err)?;
        let providers = providers_storage.get_all().map_err(storage_err)?;
        let prompts = prompts_storage.list().map_err(storage_err)?;
        let active_prompt_id = prompts_storage.get_active_id().map_err(storage_err)?;

        let api_key_ref = (!app_config.api_key.is_empty()).then(|| API_KEY_SECRET_NAME.to_string());
        let llm_api_key_ref =
            (!app_config.llm.api_key.is_empty()).then(|| LLM_API_KEY_SECRET_NAME.to_string());

        let profile = VoxisProfile {
            version: Self::CURRENT_VERSION,
            config: ProfileConfig {
                provider: app_config.cloud_provider.clone(),
                model: app_config.model.clone(),
                api_key_ref,
                api_url_override: app_config.api_url_override.clone(),
                language: app_config.language.clone(),
                translate_to_english: app_config.translate_to_english,
                audio_device: (app_config.audio_device != crate::config::DEFAULT_AUDIO_DEVICE)
                    .then(|| app_config.audio_device.clone()),
                min_recording_ms: app_config.min_recording_ms,
                silence_timeout_ms: app_config.silence_timeout_ms,
                max_recording_ms: app_config.max_recording_ms,
                hotkey_hold_ms: app_config.hotkey_hold_ms,
                llm_enabled: app_config.llm.enabled,
                llm_provider: app_config.llm.provider.clone(),
                llm_api_url: app_config.llm.api_url.clone(),
                llm_api_key_ref,
                llm_model: app_config.llm.model.clone(),
                llm_prompt: app_config.llm.prompt.clone(),
            },
            dictionary,
            llm: LlmProfile {
                providers,
                prompts,
                active_prompt_id,
            },
            theme: app_config.overlay.theme.clone(),
            hotkey: app_config.hotkey.clone(),
        };

        let secrets = ProfileSecrets {
            api_key: (!app_config.api_key.is_empty()).then(|| Secret::new(app_config.api_key)),
            llm_api_key: (!app_config.llm.api_key.is_empty())
                .then(|| Secret::new(app_config.llm.api_key)),
        };

        Ok((profile, secrets))
    }

    /// Apply this profile back to storage. Validates the *whole* merged
    /// config via `config::validation::validate_config` first and writes
    /// nothing at all if that fails (`ProfileError::Validation`, storage
    /// untouched) -- no partial application *up to that point*. This
    /// atomicity is a validation boundary only, not a transaction across
    /// the whole call: once validation passes, `config_storage.save` and
    /// the `sync_dictionary`/`sync_providers`/`sync_prompts`/`secret_sink`
    /// writes that follow are separate fallible steps with no rollback --
    /// an I/O error partway through (as opposed to a validation error
    /// before any write) can leave storage partially updated.
    ///
    /// Write order on success: config, then dictionary, then providers,
    /// then prompts, then (only then) secrets to `secret_sink`. Secrets
    /// are never written to `config_storage`: the merged
    /// `AppConfig.api_key`/`llm.api_key` are always blanked before `save`,
    /// regardless of what the *previous* stored config held.
    ///
    /// `secrets.api_key == None` (respectively `llm_api_key == None`) is
    /// treated as "this profile doesn't carry that secret", not "delete
    /// it": `secret_sink.put` is only called for a `Some` value, so any
    /// secret already stored under `API_KEY_SECRET_NAME`/
    /// `LLM_API_KEY_SECRET_NAME` from a previous `apply_to` is left alone.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_to(
        &self,
        secrets: &ProfileSecrets,
        config_storage: &dyn ConfigStorage,
        dictionary_storage: &dyn DictionaryStorage,
        providers_storage: &dyn ProvidersStorage,
        prompts_storage: &LlmPromptsStorage,
        secret_sink: &mut dyn SecretSink,
    ) -> Result<()> {
        self.check_version()?;

        let mut new_config = config_storage.load().map_err(storage_err)?;
        new_config.model = self.config.model.clone();
        new_config.cloud_provider = self.config.provider.clone();
        new_config.api_url_override = self.config.api_url_override.clone();
        new_config.language = self.config.language.clone();
        new_config.translate_to_english = self.config.translate_to_english;
        new_config.audio_device = self
            .config
            .audio_device
            .clone()
            .unwrap_or_else(|| crate::config::DEFAULT_AUDIO_DEVICE.to_string());
        new_config.min_recording_ms = self.config.min_recording_ms;
        new_config.silence_timeout_ms = self.config.silence_timeout_ms;
        new_config.max_recording_ms = self.config.max_recording_ms;
        new_config.hotkey_hold_ms = self.config.hotkey_hold_ms;
        new_config.hotkey = self.hotkey.clone();
        new_config.overlay.theme = self.theme.clone();
        new_config.llm.enabled = self.config.llm_enabled;
        new_config.llm.provider = self.config.llm_provider.clone();
        new_config.llm.api_url = self.config.llm_api_url.clone();
        new_config.llm.model = self.config.llm_model.clone();
        new_config.llm.prompt = self.config.llm_prompt.clone();
        // `[R1-Safety S2]` Secrets never reach sqlite: blank both fields
        // unconditionally before validation/save, regardless of the ref
        // markers above or whatever the previously-stored config held.
        new_config.api_key = String::new();
        new_config.llm.api_key = String::new();

        let errors = crate::config::validate_config(&new_config);
        if !errors.is_empty() {
            let message = errors
                .iter()
                .map(|e| e.to_string())
                .collect::<Vec<_>>()
                .join("; ");
            return Err(ProfileError::Validation(message));
        }

        // Validation passed for the whole merged config \u2014 now write. Config
        // first, then the collections, then secrets.
        config_storage.save(&new_config).map_err(storage_err)?;
        Self::sync_dictionary(dictionary_storage, &self.dictionary)?;
        Self::sync_providers(providers_storage, &self.llm.providers)?;
        Self::sync_prompts(prompts_storage, &self.llm.prompts, &self.llm.active_prompt_id)?;

        if let Some(key) = &secrets.api_key {
            secret_sink.put(API_KEY_SECRET_NAME, key).map_err(storage_err)?;
        }
        if let Some(key) = &secrets.llm_api_key {
            secret_sink.put(LLM_API_KEY_SECRET_NAME, key).map_err(storage_err)?;
        }

        Ok(())
    }

    /// Full replace: delete every existing entry, then add the profile's.
    /// `DictionaryStorage` has no bulk-replace primitive, so this is built
    /// from `load`/`delete`/`add`; deleting highest-index-first keeps each
    /// `delete(index)` call valid without needing to recompute indices
    /// mid-loop (each call re-reads the file fresh).
    fn sync_dictionary(storage: &dyn DictionaryStorage, entries: &[(String, String)]) -> Result<()> {
        let existing = storage.load().map_err(storage_err)?;
        for index in (0..existing.len()).rev() {
            storage.delete(index).map_err(storage_err)?;
        }
        for (source, replacement) in entries {
            storage.add(source, replacement).map_err(storage_err)?;
        }
        Ok(())
    }

    /// Full replace, with two data-integrity exceptions driven entirely by
    /// the *locally stored* `builtin` flag — never the incoming profile's:
    /// - a builtin id missing from `providers` is left as-is (removal is
    ///   skipped) rather than surfacing an error for a case the storage
    ///   layer already treats as normal (`remove` refuses builtins anyway);
    /// - a provider whose *local* copy is builtin is never updated from the
    ///   profile: `ProvidersStorage::update` has no builtin guard of its
    ///   own (unlike `remove`), so without this check an imported profile
    ///   could silently rewrite a seeded builtin's `api_url`/models;
    /// - a brand-new id (not present locally) is always added with
    ///   `builtin: false`, ignoring whatever `builtin` value the incoming
    ///   `LlmProvider` claims — otherwise a profile could plant an
    ///   un-removable "builtin" provider that was never actually seeded
    ///   locally (`remove` refuses anything with `builtin: true`).
    fn sync_providers(storage: &dyn ProvidersStorage, providers: &[LlmProvider]) -> Result<()> {
        let existing = storage.get_all().map_err(storage_err)?;
        let incoming_ids: std::collections::HashSet<&str> =
            providers.iter().map(|p| p.id.as_str()).collect();

        for existing_provider in &existing {
            if !existing_provider.builtin && !incoming_ids.contains(existing_provider.id.as_str()) {
                storage.remove(&existing_provider.id).map_err(storage_err)?;
            }
        }

        let existing_by_id: std::collections::HashMap<&str, &LlmProvider> =
            existing.iter().map(|p| (p.id.as_str(), p)).collect();
        for provider in providers {
            match existing_by_id.get(provider.id.as_str()) {
                Some(local) if local.builtin => {
                    tracing::debug!(
                        provider_id = %provider.id,
                        "sync_providers: skipping profile update of local builtin provider"
                    );
                }
                Some(_) => {
                    storage.update(provider).map_err(storage_err)?;
                }
                None => {
                    storage
                        .add(&LlmProvider {
                            builtin: false,
                            ..provider.clone()
                        })
                        .map_err(storage_err)?;
                }
            }
        }
        Ok(())
    }

    /// Full replace of prompts + the active-prompt pointer. `LlmPromptsStorage`
    /// is a concrete type (no trait in `storage::traits`, per this step's
    /// scope note), so this calls its inherent methods directly.
    fn sync_prompts(
        storage: &LlmPromptsStorage,
        prompts: &[LlmPrompt],
        active_prompt_id: &Option<String>,
    ) -> Result<()> {
        let existing = storage.list().map_err(storage_err)?;
        let incoming_ids: std::collections::HashSet<&str> =
            prompts.iter().map(|p| p.id.as_str()).collect();

        for existing_prompt in &existing {
            if !incoming_ids.contains(existing_prompt.id.as_str()) {
                storage.delete(&existing_prompt.id).map_err(storage_err)?;
            }
        }

        let existing_ids: std::collections::HashSet<&str> =
            existing.iter().map(|p| p.id.as_str()).collect();
        for prompt in prompts {
            if existing_ids.contains(prompt.id.as_str()) {
                storage
                    .update(&prompt.id, &prompt.name, &prompt.prompt)
                    .map_err(storage_err)?;
            } else {
                storage
                    .create(&prompt.id, &prompt.name, &prompt.prompt)
                    .map_err(storage_err)?;
            }
        }

        storage
            .set_active_id(active_prompt_id.as_deref())
            .map_err(storage_err)?;
        Ok(())
    }
}

/// `[R1-Safety S1]` Seal `profile` + `secrets` for transport under a key
/// derived from `key_source`. See `crypto` module docs for the wire
/// format.
pub fn seal(profile: &VoxisProfile, secrets: &ProfileSecrets, key_source: &KeySource) -> Result<Vec<u8>> {
    let payload = SealedPayload {
        profile: profile.clone(),
        api_key: secrets.api_key.as_ref().map(|s| s.expose().to_string()),
        llm_api_key: secrets.llm_api_key.as_ref().map(|s| s.expose().to_string()),
    };
    let plaintext = serde_json::to_vec(&payload)?;
    crypto::encrypt(&plaintext, key_source)
}

/// Inverse of [`seal`]. Returns `Err` \u2014 never panics \u2014 for a wrong key,
/// tampered bytes, truncated input, or an unsupported `version`.
pub fn open(data: &[u8], key_source: &KeySource) -> Result<(VoxisProfile, ProfileSecrets)> {
    let plaintext = crypto::decrypt(data, key_source)?;
    let payload: SealedPayload = serde_json::from_slice(&plaintext)?;
    payload.profile.check_version()?;
    let secrets = ProfileSecrets {
        api_key: payload.api_key.map(Secret::new),
        llm_api_key: payload.llm_api_key.map(Secret::new),
    };
    Ok((payload.profile, secrets))
}
