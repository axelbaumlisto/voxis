//! Task 6: `VoxisProfile` sources/sinks for the plugin.
//!
//! Three jobs live here:
//! - `import_from_desktop`: locate an installed Voxis desktop's config
//!   directory (`voxis_core::storage::paths::voxis_desktop_config_dir()`,
//!   overridable via `VOXIS_DESKTOP_CONFIG_DIR` for tests/`host-min`'s own
//!   `profile-import` smoke scenario), open its four storage files
//!   **read-only** (`[R1-Safety S7]` \u2014 `sqlite_base::open_read_only`, no
//!   `init_schema`, 2s `busy_timeout` so a concurrently-running desktop
//!   Voxis holding a brief write transaction never fails the import with
//!   `SQLITE_BUSY`), and build a `VoxisProfile` from them.
//! - `PluginProfileStorage`: the plugin's OWN (read-write, normal, non-
//!   read-only) copy of the same four storage kinds, rooted at
//!   `<host-config>/voxis-plugin/` (`PluginState::profile_dir`) \u2014 never
//!   the desktop's files. `apply_imported_profile` is the one place that
//!   writes here (`VoxisProfile::apply_to`), `get_profile`/
//!   `current_profile` the one place that reads it back
//!   (`VoxisProfile::from_storage`) for the `get_profile` command.
//! - `import_from_qr`/`apply_profile_bytes`: the two other transports
//!   (Task 7's LAN+QR server, and a bare `apply_profile(bytes,
//!   key_source)` call for the `.vxp` file transport) \u2014 both end up
//!   calling the same `apply_imported_profile` this module's desktop path
//!   uses, so "what happens once we have a `(VoxisProfile,
//!   ProfileSecrets)`" is written exactly once.
//!
//! **Missing `prompts.db`** (an older Voxis install predating multi-prompt
//! support): `VoxisProfile::from_storage` takes a concrete
//! `&LlmPromptsStorage` (not a trait object, per Task 2's own scope note),
//! so there is no interface seam to substitute an "empty prompts" reader.
//! Instead, when `prompts.db` doesn't exist, this module points a fresh
//! (non-read-only) `LlmPromptsStorage` at the special SQLite database name
//! `":memory:"` \u2014 `init_schema`'s plain `CREATE TABLE`s run against a
//! brand-new, always-empty in-memory database (no data ever landed there,
//! nothing to leak, no real file touched), producing exactly the "no
//! prompts, no error" result the task calls for.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Deserialize;

use voxis_core::profile::{KeySource, ProfileSecrets, Secret, SecretSink, VoxisProfile};
use voxis_core::storage::prompts_sqlite::LlmPromptsStorage;
use voxis_core::storage::traits::{
    ConfigStorage as ConfigStorageTrait, DictionaryStorage as DictionaryStorageTrait,
};
use voxis_core::storage::{ConfigSqliteStorage, DictionaryStorage, ProvidersStorage};

use crate::error::PluginError;
use crate::models::{ImportSummary, KeySourceDto};
use crate::secrets::SecretStore;
use crate::PluginState;

/// The plugin's own persistent, non-secret profile storage \u2014
/// `<host-config>/voxis-plugin/{config.db,dictionary.txt,providers.db,
/// prompts.db}` (`PluginState::profile_dir`). Deliberately plain
/// read-write constructors (`ConfigSqliteStorage::new`, not `::read_only`):
/// this is storage the plugin owns outright, never the desktop's files.
struct PluginProfileStorage {
    config: ConfigSqliteStorage,
    dictionary: DictionaryStorage,
    providers: ProvidersStorage,
    prompts: LlmPromptsStorage,
}

impl PluginProfileStorage {
    /// Creates `profile_dir` if it doesn't exist yet (first import on a
    /// fresh host install) before pointing any storage at a file inside
    /// it — `Connection::open`/plain file writes both fail outright if
    /// their parent directory is missing.
    fn open(profile_dir: &Path) -> Result<Self, PluginError> {
        std::fs::create_dir_all(profile_dir).map_err(|e| PluginError::Profile {
            message: format!("creating plugin profile directory {}: {e}", profile_dir.display()),
        })?;
        Ok(Self {
            config: ConfigSqliteStorage::new(profile_dir.join("config.db")),
            dictionary: DictionaryStorage::new(profile_dir.join("dictionary.txt")),
            providers: ProvidersStorage::new(profile_dir.join("providers.db")),
            prompts: LlmPromptsStorage::new(profile_dir.join("prompts.db")),
        })
    }
}

/// Adapts `crate::secrets::SecretStore` (the plugin's own trait, `get`/
/// `set`/`delete`) to `voxis_core::profile::SecretSink` (`put` only) so
/// `VoxisProfile::apply_to` can write into it without `voxis-core`
/// depending on this crate's `SecretStore` type.
struct SecretStoreSink<'a> {
    store: &'a dyn SecretStore,
}

impl SecretSink for SecretStoreSink<'_> {
    fn put(&mut self, name: &str, value: &Secret) -> voxis_core::storage::traits::StorageResult<()> {
        self.store.set(name, value)
    }
}

/// Writes `profile`/`secrets` into the plugin's own storage
/// (`PluginState::profile_dir`) via `VoxisProfile::apply_to`, refreshes
/// `PluginState::pipeline_config` from what was just written (so the very
/// next `start()` sees the imported settings), and builds the
/// `ImportSummary` every import path (`import_from_desktop`,
/// `import_from_qr`, `apply_profile_bytes`) returns.
pub(crate) fn apply_imported_profile(
    state: &PluginState,
    source: &str,
    profile: VoxisProfile,
    secrets: ProfileSecrets,
) -> Result<ImportSummary, PluginError> {
    let plugin_storage = PluginProfileStorage::open(&state.profile_dir)?;
    let mut secret_sink = SecretStoreSink { store: state.secrets.as_ref() };

    profile.apply_to(
        &secrets,
        &plugin_storage.config,
        &plugin_storage.dictionary,
        &plugin_storage.providers,
        &plugin_storage.prompts,
        &mut secret_sink,
    )?;

    refresh_pipeline_config(state, &plugin_storage)?;

    Ok(ImportSummary {
        source: source.to_string(),
        dictionary_entries: profile.dictionary.len(),
        llm_providers: profile.llm.providers.len(),
        llm_prompts: profile.llm.prompts.len(),
        has_api_key: profile.config.api_key_ref.is_some(),
        theme: profile.theme.clone(),
        hotkey: profile.hotkey.clone(),
    })
}

/// Reloads `PluginState::pipeline_config` (`app_config` + `dictionary`)
/// from the plugin's own storage \u2014 called right after `apply_to` just
/// wrote there, so the pipeline's very next `start()` observes the
/// imported settings without requiring a plugin restart. Task 6b
/// (`[HW-GATE finding]`): also pushes `app_config.audio_device` into the
/// capture backend via `AudioCapture::set_device_id` \u2014 this is the ONE
/// place every import/apply transport (desktop directory, QR, file) goes
/// through (`apply_imported_profile`, below), so a device named in a
/// profile reaches `CpalCapture` regardless of which transport carried
/// the profile.
fn refresh_pipeline_config(
    state: &PluginState,
    plugin_storage: &PluginProfileStorage,
) -> Result<(), PluginError> {
    let app_config = ConfigStorageTrait::load(&plugin_storage.config)
        .map_err(|e| PluginError::Profile { message: format!("reloading plugin config: {e}") })?;
    let dictionary = DictionaryStorageTrait::load(&plugin_storage.dictionary)
        .map_err(|e| PluginError::Profile { message: format!("reloading plugin dictionary: {e}") })?;

    state.capture.set_device_id(&app_config.audio_device);

    let mut config = state.pipeline_config.lock().unwrap();
    config.app_config = app_config;
    config.dictionary = dictionary;
    Ok(())
}

/// `import_profile_from_desktop`: locate an installed Voxis desktop on
/// this machine and import its profile. `PluginError::NotFound` if there
/// is none (no `config.db` under the resolved config directory) \u2014 never
/// a generic storage error for that specific, expected case.
pub fn import_from_desktop(state: &PluginState) -> Result<ImportSummary, PluginError> {
    let desktop_config_dir =
        voxis_core::storage::paths::voxis_desktop_config_dir().ok_or_else(|| PluginError::NotFound {
            message: "no OS config directory resolvable on this platform".to_string(),
        })?;

    let config_db = desktop_config_dir.join("config.db");
    if !config_db.exists() {
        return Err(PluginError::NotFound {
            message: format!(
                "no installed Voxis desktop found at {} (config.db missing)",
                desktop_config_dir.display()
            ),
        });
    }

    let config_storage = ConfigSqliteStorage::read_only(config_db);
    let dictionary_storage = DictionaryStorage::read_only(desktop_config_dir.join("dictionary.txt"));
    let providers_storage = ProvidersStorage::read_only(desktop_config_dir.join("providers.db"));

    let prompts_db = desktop_config_dir.join("prompts.db");
    let prompts_storage = if prompts_db.exists() {
        LlmPromptsStorage::read_only(prompts_db)
    } else {
        // Older Voxis install, no multi-prompt storage at all -- see this
        // module's doc comment for why ":memory:" (not a missing-file
        // read_only()) is the "empty prompts, not an error" seam.
        LlmPromptsStorage::new(PathBuf::from(":memory:"))
    };

    let (profile, secrets) = VoxisProfile::from_storage(
        &config_storage,
        &dictionary_storage,
        &providers_storage,
        &prompts_storage,
    )?;

    apply_imported_profile(state, "desktop", profile, secrets)
}

/// `get_profile`: the plugin's own currently-applied `VoxisProfile`
/// (`api_key_ref` only \u2014 `ProfileConfig` never carries the raw secret;
/// the `ProfileSecrets` half of `from_storage`'s return is intentionally
/// discarded here, never serialized back to the caller).
/// The STT provider host consent applies to RIGHT NOW: derived from the
/// active profile's `api_url_override` (Groq when unset or when no profile
/// exists yet). `PluginState::provider_host` used to be a hardcoded
/// "api.groq.com", so a self-hosted profile was gated (and consented) under
/// Groq's name — `set_provider` made that visible.
pub(crate) fn current_provider_host(state: &PluginState) -> String {
    match current_profile(state) {
        Ok(profile) => provider_host_of(profile.config.api_url_override.as_deref()),
        Err(_) => state.provider_host.clone(),
    }
}

pub fn current_profile(state: &PluginState) -> Result<VoxisProfile, PluginError> {
    let plugin_storage = PluginProfileStorage::open(&state.profile_dir)?;
    let (mut profile, _secrets) = VoxisProfile::from_storage(
        &plugin_storage.config,
        &plugin_storage.dictionary,
        &plugin_storage.providers,
        &plugin_storage.prompts,
    )?;

    // `from_storage` derives `*_api_key_ref` from `AppConfig.api_key`/
    // `llm.api_key` -- but `apply_to` unconditionally blanks BOTH before
    // ever writing the plugin's own `config.db` (`[R1-Safety S2]`: secrets
    // never touch sqlite, not even the plugin's own), so those fields are
    // always empty on this storage and `from_storage` would always report
    // `None` here regardless of whether a key was actually imported.
    // Override both refs from the actual source of truth instead: whether
    // `state.secrets` currently holds a value under that name.
    profile.config.api_key_ref = has_secret(state, voxis_core::profile::API_KEY_SECRET_NAME)?
        .then(|| voxis_core::profile::API_KEY_SECRET_NAME.to_string());
    profile.config.llm_api_key_ref = has_secret(state, voxis_core::profile::LLM_API_KEY_SECRET_NAME)?
        .then(|| voxis_core::profile::LLM_API_KEY_SECRET_NAME.to_string());

    Ok(profile)
}

pub(crate) fn has_secret(state: &PluginState, name: &str) -> Result<bool, PluginError> {
    Ok(state
        .secrets
        .get(name)
        .map_err(|e| PluginError::Profile { message: format!("reading secret store: {e}") })?
        .is_some())
}

/// `apply_profile(bytes, key_source)`: open a sealed `.vxp`-shaped blob
/// (file transport, `KeySourceDto::Passphrase`, or a raw `Qr` key/code
/// pair supplied out of band) and apply it the same way every other
/// import path does.
pub fn apply_profile_bytes(
    state: &PluginState,
    bytes: &[u8],
    key_source: KeySourceDto,
) -> Result<ImportSummary, PluginError> {
    let source = match &key_source {
        KeySourceDto::Qr { .. } => "qr",
        KeySourceDto::Passphrase { .. } => "passphrase",
    };
    let core_key_source = core_key_source(key_source)?;
    let (profile, secrets) = voxis_core::profile::open(bytes, &core_key_source)?;
    apply_imported_profile(state, source, profile, secrets)
}

/// `set_provider`: manual provider entry for the iPad case with no Voxis
/// desktop to import from (`apply_profile`/QR/desktop all need a *sealed*
/// profile from somewhere) — a host can offer "paste your Groq key /
/// self-hosted URL" and land it through the exact same persistence path
/// every import uses (`apply_imported_profile`), source `"manual"`.
///
/// - `api_url_override`: `None` = Groq default (`ProfileConfig::
///   api_url_override = None`); `Some` is trimmed and must be an http(s)
///   URL with a host (`validate_http_url` — `config::validate_config`
///   does NOT check this field, so the check lives here).
/// - `model`: applied only when `Some`.
/// - `api_key`: `None` keeps whatever key is already stored; `Some`
///   trimmed to empty clears it; any other `Some` stores it through the
///   same `SecretStore` path `apply_imported_profile` uses — never
///   plaintext on disk, and carried as a `Secret` (`ZeroizeOnDrop`) from
///   here to the store, never copied into the profile/summary.
///
/// Rejected while a session is active (`AlreadyRecording`): this rewrites
/// the plugin's own `config.db` and the `PipelineConfig` snapshot the
/// in-flight `start()` already read, and can revoke consent for a changed
/// provider host — none of which is safe to swap out from under a
/// recording/transcribing session. (`apply_profile` has no such guard;
/// `set_provider` adds one because it is expected to be called
/// interactively from a settings screen, exactly when a stray active
/// session is most likely.)
///
/// Consent is per `(host_id, provider_host)` (`consent.rs`): when the
/// provider host derived from `api_url_override` changes, consent for the
/// new host is reset to `false` so the user must re-consent before the
/// next dictation to that provider. (`PluginState::provider_host` — what
/// `start`'s consent gate actually reads — is still the hardcoded Groq
/// default until a later task sources it from the active profile; this
/// reset operates at the consent-store level the gate ultimately
/// consults.)
pub fn set_provider(
    state: &PluginState,
    api_key: Option<String>,
    api_url_override: Option<String>,
    model: Option<String>,
) -> Result<ImportSummary, PluginError> {
    if state.sessions.has_active() {
        return Err(PluginError::AlreadyRecording);
    }

    let mut profile = current_profile(state)?;

    // `None` = Groq default; `Some` must be a trimmed http(s) URL.
    let new_url = match api_url_override {
        Some(raw) => {
            let trimmed = raw.trim().to_string();
            validate_http_url(&trimmed)?;
            Some(trimmed)
        }
        None => None,
    };
    let old_host = provider_host_of(profile.config.api_url_override.as_deref());
    let new_host = provider_host_of(new_url.as_deref());
    profile.config.api_url_override = new_url;

    if let Some(model) = model {
        profile.config.model = model;
    }

    // API key: keep (None) / clear (Some, empty after trim) / set (Some).
    // `api_key_ref` is set to reflect the *resulting* stored state so
    // `ImportSummary::has_api_key` is accurate. The key travels as a
    // `Secret` into `ProfileSecrets` (for the set case) or is deleted
    // directly (clear case) — it never lands in `profile.config`.
    let mut secrets = ProfileSecrets::default();
    let mut clear_existing = false;
    let api_key_present = match api_key {
        None => has_secret(state, voxis_core::profile::API_KEY_SECRET_NAME)?,
        Some(raw) => {
            if raw.trim().is_empty() {
                clear_existing = true;
                false
            } else {
                secrets.api_key = Some(Secret::new(raw.trim().to_owned()));
                true
            }
        }
    };
    profile.config.api_key_ref =
        api_key_present.then(|| voxis_core::profile::API_KEY_SECRET_NAME.to_string());

    // Persist exactly like every import path (config write + secret sink +
    // pipeline-config refresh + `ImportSummary`), source `"manual"`.
    let summary = apply_imported_profile(state, "manual", profile, secrets)?;

    // `apply_to` only ever *writes* secrets, never deletes — so an
    // explicit clear is a separate `SecretStore::delete` after the profile
    // was persisted.
    if clear_existing {
        state
            .secrets
            .delete(voxis_core::profile::API_KEY_SECRET_NAME)
            .map_err(|e| PluginError::Store { message: format!("clearing api key: {e}") })?;
    }

    // Consent is per provider host: force re-consent when the host changed.
    if old_host != new_host {
        state
            .consent
            .set_consent(&state.host_id, &new_host, false)
            .map_err(|e| PluginError::Store { message: format!("resetting consent: {e}") })?;
    }

    Ok(summary)
}

/// Groq's transcription host — the value `PluginState::provider_host`
/// defaults to, and what `provider_host_of` reports for a `None`
/// (default-provider) `api_url_override`.
const GROQ_PROVIDER_HOST: &str = "api.groq.com";

/// Validates a caller-supplied `apiUrlOverride` is a syntactically valid
/// http(s) URL with a host — `config::validate_config` does not check this
/// field, so `set_provider` enforces it here before persisting.
pub(crate) fn validate_http_url(url: &str) -> Result<(), PluginError> {
    let parsed = reqwest::Url::parse(url)
        .map_err(|e| PluginError::Profile { message: format!("apiUrlOverride is not a valid URL: {e}") })?;
    match parsed.scheme() {
        "http" | "https" if parsed.host_str().is_some() => Ok(()),
        "http" | "https" => {
            Err(PluginError::Profile { message: format!("apiUrlOverride {url:?} has no host") })
        }
        other => Err(PluginError::Profile {
            message: format!("apiUrlOverride must be an http(s) URL, got scheme {other:?}"),
        }),
    }
}

/// The provider host consent is keyed on (`consent.rs`, per `(host_id,
/// provider_host)`): the URL's host for a custom `api_url_override`, or
/// the Groq default host when none is set. Parsing never fails for the
/// `Some` case in `set_provider`'s own use — it only calls this after
/// `validate_http_url` has already accepted the URL — but the
/// `unwrap_or_else` keeps this total for any other caller.
pub(crate) fn provider_host_of(api_url_override: Option<&str>) -> String {
    match api_url_override {
        None => GROQ_PROVIDER_HOST.to_string(),
        Some(url) => reqwest::Url::parse(url)
            .ok()
            .and_then(|u| u.host_str().map(str::to_string))
            .unwrap_or_else(|| url.to_string()),
    }
}

/// Converts the wire-format `KeySourceDto` to `voxis_core::profile::
/// KeySource`. The only fallible step is base64url-decoding `k` into
/// exactly 32 bytes for the `Qr` variant.
fn core_key_source(dto: KeySourceDto) -> Result<KeySource, PluginError> {
    match dto {
        KeySourceDto::Qr { k, code } => Ok(KeySource::Qr { k_qr: k_qr_from_base64url(&k)?, code }),
        KeySourceDto::Passphrase { phrase } => Ok(KeySource::Passphrase(phrase)),
    }
}

/// `[ADO-2/3 minors]`/Task 6b: the one place `k_qr`'s wire form
/// (base64url, `contract/fixtures/profile-qr.json`'s `k` field) is
/// decoded into the fixed-size key `KeySource::Qr` actually needs —
/// `core_key_source` (`apply_profile`'s `KeySourceDto::Qr`) and
/// `import_from_qr` (the QR payload's own `k`) used to each inline an
/// identical decode-then-length-check, so a change to the error message
/// or the 32-byte requirement itself only needs to happen once.
fn k_qr_from_base64url(k: &str) -> Result<[u8; 32], PluginError> {
    let bytes = voxis_core::profile::decode_base64url(k)?;
    bytes.try_into().map_err(|bytes: Vec<u8>| PluginError::Profile {
        message: format!("QR key material must be exactly 32 bytes, got {}", bytes.len()),
    })
}

// ---------------------------------------------------------------------
// import_profile_from_qr (Task 7 wire contract: contract/fixtures/
// profile-qr.json + profile-qr.README.md)
// ---------------------------------------------------------------------

/// `contract/fixtures/profile-qr.json`'s shape: what a scanned/pasted QR
/// payload deserializes to. `k` is `k_qr` (256-bit key), base64url
/// (`voxis_core::profile::decode_base64url`) \u2014 the 6-digit second-factor
/// `code` is deliberately NOT part of this payload (`[R1-Safety T1]`: it
/// is read off the sharing device's screen and passed to this command
/// separately, never carried in the QR itself).
#[derive(Debug, Deserialize)]
struct QrPayload {
    v: u32,
    host: String,
    port: u16,
    token: String,
    k: String,
}

/// GET timeout for the desktop's LAN profile-share server \u2014 the plan's
/// own number (Task 7 acceptance: "120 с или до первого успешного GET"
/// server-side lifetime; this is the client-side single-request budget).
const QR_FETCH_TIMEOUT: Duration = Duration::from_secs(10);

/// `import_profile_from_qr(payload, code)`: parse the QR JSON payload,
/// fetch the sealed profile bytes from the desktop's LAN server
/// (`http://{host}:{port}/profile?token={token}`, plain HTTP by design \u2014
/// see `Cargo.toml`'s `reqwest` dependency comment), open it under
/// `KeySource::Qr { k_qr, code }`, and apply.
pub async fn import_from_qr(
    state: &PluginState,
    payload: &str,
    code: String,
) -> Result<ImportSummary, PluginError> {
    let qr: QrPayload = serde_json::from_str(payload)
        .map_err(|e| PluginError::Profile { message: format!("invalid QR payload JSON: {e}") })?;
    if qr.v != 1 {
        return Err(PluginError::Profile {
            message: format!("unsupported QR payload version {} (expected 1)", qr.v),
        });
    }
    let k_qr = k_qr_from_base64url(&qr.k)?;

    let url = build_qr_url(&qr)?;
    let response = fetch_sealed_profile(url).await?;

    let (profile, secrets) =
        voxis_core::profile::open(&response, &KeySource::Qr { k_qr, code })?;
    apply_imported_profile(state, "qr", profile, secrets)
}

/// `[REJECT-FIX F3]` `host`/`token` come from a scanned/pasted QR payload
/// \u2014 untrusted input \u2014 and must not be trusted to build a URL by naive
/// string interpolation:
/// - `host` must be a literal IPv4 address (Task 7's server only ever
///   emits one, bound to a single LAN interface it chose itself; a
///   hostname or a `user@host` authority-injection string is rejected
///   outright rather than handed to a resolver/URL parser).
/// - `token` is restricted to `[A-Za-z0-9_-]{1,64}` \u2014 the same charset a
///   UUID/random-slug token generator would ever produce; this also
///   means it can never contain `&`/`#`/etc. that could otherwise inject
///   extra query parameters or fragments once placed in the URL.
///
/// The URL itself is assembled via `reqwest::Url`'s own query-pair
/// builder (`query_pairs_mut().append_pair`), not `format!`, so this
/// isn't just "validate then still string-interpolate".
fn build_qr_url(qr: &QrPayload) -> Result<reqwest::Url, PluginError> {
    qr.host.parse::<std::net::Ipv4Addr>().map_err(|_| PluginError::Profile {
        message: format!("QR payload host {:?} is not a literal IPv4 address", qr.host),
    })?;

    let token_is_valid = !qr.token.is_empty()
        && qr.token.len() <= 64
        && qr.token.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    if !token_is_valid {
        return Err(PluginError::Profile {
            message: "QR payload token must be 1-64 characters of [A-Za-z0-9_-]".to_string(),
        });
    }

    let mut url = reqwest::Url::parse(&format!("http://{}:{}/profile", qr.host, qr.port))
        .map_err(|e| PluginError::Profile { message: format!("building profile-share URL: {e}") })?;
    url.query_pairs_mut().append_pair("token", &qr.token);
    Ok(url)
}

/// The actual HTTP call, split out so it's the one place that turns a
/// non-2xx response (in particular Task 7's `410 Gone` for an already-
/// used/expired token) into a `PluginError` with a message that names the
/// status \u2014 never leaks `token`/`k` (those are already in `url`/the
/// caller's own logs at whatever level the host chooses, not repeated
/// here). `[REJECT-FIX F3]` `.no_proxy()` (this is a LAN-only, direct
/// connection \u2014 a configured system HTTP(S) proxy must never see this
/// request) and `.redirect(Policy::none())` (the server contract is a
/// direct `200`/`410`; a redirect is never legitimate and must not be
/// silently followed to an attacker-chosen location).
async fn fetch_sealed_profile(url: reqwest::Url) -> Result<Vec<u8>, PluginError> {
    let client = reqwest::Client::builder()
        .timeout(QR_FETCH_TIMEOUT)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| PluginError::Profile { message: format!("building HTTP client: {e}") })?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| PluginError::Profile { message: format!("fetching profile from desktop: {e}") })?;

    let status = response.status();
    if status == reqwest::StatusCode::GONE {
        return Err(PluginError::Profile {
            message: "profile share token already used or expired (410 Gone)".to_string(),
        });
    }
    if !status.is_success() {
        return Err(PluginError::Profile {
            message: format!("desktop profile-share server returned HTTP {status}"),
        });
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| PluginError::Profile { message: format!("reading profile response body: {e}") })?;
    Ok(bytes.to_vec())
}

// `[ADO-8 follow-up, resolved]`: the intermittent `import_from_qr_*`
// failure ("error sending request for url" — connection refused against a
// mockito server that had just reported itself listening), reproduced
// under `cargo test`'s default parallel harness (never in isolation) at
// roughly 1-in-8 to 1-in-15 full-crate runs. Root cause, confirmed by
// instrumenting a throwaway build to print `mockito`'s own reported
// listening host:port per test and by observing that same port get
// reissued to a *different* test within a single `cargo test` process:
// each test below used the plain `mockito::Server::new_async()`
// constructor, which draws from mockito's own process-wide pool of
// pre-warmed servers (reused across tests to avoid the overhead of
// spinning up a fresh listener every time) rather than owning a dedicated
// listener. Under this crate's parallel test load, a server checked back
// into the pool by one finishing test and immediately checked back out by
// another has a narrow window — between the pool marking it available and
// its listener actually being reset/re-armed for the next borrower —
// where a connect attempt against that same host:port sees nothing
// listening yet, i.e. exactly the observed "connection refused" against a
// port mockito had just reported as its own.
//
// Fix: every QR test below now calls `mockito::Server::new_with_opts_async`
// with an explicit `port: 0` instead of the pooled `new_async()` — this is
// mockito's own documented non-pooled constructor, so each test gets a
// listener it exclusively owns for its whole lifetime with no pool
// checkout/reset race possible, while `port: 0` still asks the OS for a
// fresh ephemeral port per test (no fixed-port collisions either).
#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::{MockCapture, RecDir};
    use crate::consent::ConsentStore;
    use crate::events::RecordingSink;
    use crate::secrets::InMemorySecretStore;
    use crate::session::SessionGuard;
    use crate::PipelineConfig;
    use sha2::{Digest, Sha256};
    use std::sync::Arc;
    use std::time::SystemTime;
    use voxis_core::storage::LlmProvider;

    /// Builds a bare `PluginState` for these tests \u2014 same shape as
    /// `commands.rs`'s own `test_state`, minus consent (irrelevant here).
    fn test_state(tmp: &tempfile::TempDir) -> PluginState {
        test_state_with_mock(tmp).0
    }

    /// Same as `test_state`, also returning the `Arc<MockCapture>` so a
    /// test can assert on it directly (Task 6b: `AudioCapture::
    /// set_device_id` wiring) — mirrors `commands.rs`'s own
    /// `test_state_with_mock`.
    fn test_state_with_mock(tmp: &tempfile::TempDir) -> (PluginState, Arc<MockCapture>) {
        let mock = Arc::new(MockCapture::new());
        let state = PluginState {
            sessions: Arc::new(SessionGuard::new()),
            consent: ConsentStore::new(tmp.path().join("consent.json")),
            secrets: Arc::new(InMemorySecretStore::new()),
            rec_dir: RecDir::new(tmp.path().join("rec")),
            capture: mock.clone(),
            events: Arc::new(RecordingSink::new()),
            pipeline_config: std::sync::Mutex::new(PipelineConfig::default()),
            hotkey: None,
            host_id: "test-host".to_string(),
            provider_host: "api.groq.com".to_string(),
            profile_dir: tmp.path().join("voxis-plugin"),
        };
        (state, mock)
    }

    /// Seeds a tempdir Voxis-desktop-format config dir (real
    /// `voxis_core::storage` writers -- `ConfigSqliteStorage::save`,
    /// `DictionaryStorage::add`, `ProvidersStorage::add`,
    /// `LlmPromptsStorage::create`/`set_active_id` -- exactly what a real
    /// desktop install's own code paths produce) and points
    /// `VOXIS_DESKTOP_CONFIG_DIR` at it for the duration of the guard.
    struct DesktopFixture {
        _tmp: tempfile::TempDir,
        dir: PathBuf,
        _lock: std::sync::MutexGuard<'static, ()>,
    }

    static DESKTOP_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    impl DesktopFixture {
        fn seed(with_prompts_db: bool) -> Self {
            let lock = DESKTOP_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            let tmp = tempfile::tempdir().unwrap();
            let dir = tmp.path().to_path_buf();

            let mut config = voxis_core::config::AppConfig {
                api_key: "desktop-secret-api-key".to_string(),
                hotkey: "alt_r".to_string(),
                // Task 6b (`[HW-GATE finding]`): a named (non-default)
                // device, so `import_from_desktop_sets_capture_device_
                // from_profile` below can assert the plugin's capture
                // backend actually picked it up.
                audio_device: "Mock Device".to_string(),
                ..voxis_core::config::AppConfig::default()
            };
            config.overlay.theme = "waveform".to_string();
            config.llm.api_key = "desktop-secret-llm-key".to_string();
            ConfigSqliteStorage::new(dir.join("config.db")).save(&config).unwrap();

            DictionaryStorage::new(dir.join("dictionary.txt")).add("солид", "SOLID").unwrap();

            let providers = ProvidersStorage::new(dir.join("providers.db"));
            providers.get_all().unwrap(); // seeds builtins
            providers
                .add(&LlmProvider {
                    id: "custom-fixture".to_string(),
                    name: "Fixture Provider".to_string(),
                    api_url: "https://example.invalid/v1".to_string(),
                    models: vec![],
                    default_model: "m".to_string(),
                    builtin: false,
                })
                .unwrap();

            if with_prompts_db {
                let prompts = LlmPromptsStorage::new(dir.join("prompts.db"));
                prompts.seed_defaults_if_empty().unwrap();
                prompts.set_active_id(Some("fix_grammar")).unwrap();
            }

            std::env::set_var("VOXIS_DESKTOP_CONFIG_DIR", &dir);
            Self { _tmp: tmp, dir, _lock: lock }
        }
    }

    impl Drop for DesktopFixture {
        fn drop(&mut self) {
            std::env::remove_var("VOXIS_DESKTOP_CONFIG_DIR");
        }
    }

    fn sha256_of(path: &Path) -> Vec<u8> {
        let bytes = std::fs::read(path).unwrap();
        Sha256::digest(bytes).to_vec()
    }

    // -- import_from_desktop ---------------------------------------

    #[test]
    fn import_from_desktop_populates_plugin_storage_and_secrets_not_desktop_files() {
        let fixture = DesktopFixture::seed(true);
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);

        let summary = import_from_desktop(&state).unwrap();

        assert_eq!(summary.source, "desktop");
        assert_eq!(summary.dictionary_entries, 1);
        assert!(summary.llm_providers >= 1, "must include at least the seeded builtin providers");
        assert_eq!(summary.llm_prompts, 4);
        assert!(summary.has_api_key);
        assert_eq!(summary.theme, "waveform");
        assert_eq!(summary.hotkey, "alt_r");

        // Secrets landed in the SecretStore...
        let stored_key = state.secrets.get(pipeline_api_key_name()).unwrap().unwrap();
        assert_eq!(stored_key.expose(), "desktop-secret-api-key");

        // The plugin's own config.db must actually have been created by
        // this import (not just "no assertion failed", which a
        // do-nothing apply_to would also satisfy).
        assert!(state.profile_dir.join("config.db").exists(), "import must create the plugin's own config.db");

        // ...and NEITHER secret (transcription API key NOR the LLM
        // post-processing key) ever lands in the plugin's own sqlite
        // (byte-grep for both raw key values across every file this
        // import touched) `[R1-Safety S2]`.
        for name in ["config.db", "providers.db", "prompts.db"] {
            let path = state.profile_dir.join(name);
            if !path.exists() {
                continue;
            }
            let bytes = std::fs::read(&path).unwrap();
            assert!(
                !contains_subslice(&bytes, b"desktop-secret-api-key"),
                "{name} must never contain the raw transcription API key"
            );
            assert!(
                !contains_subslice(&bytes, b"desktop-secret-llm-key"),
                "{name} must never contain the raw LLM API key"
            );
        }

        // pipeline_config was refreshed from the import.
        let cfg = state.pipeline_config.lock().unwrap();
        assert_eq!(cfg.app_config.hotkey, "alt_r");
        assert_eq!(cfg.app_config.audio_device, "Mock Device");
        assert_eq!(cfg.dictionary, vec![("солид".to_string(), "SOLID".to_string())]);
        drop(fixture);
    }

    /// Task 6b / `[HW-GATE finding]` end to end: an imported profile's
    /// `audio_device` must reach the capture backend, not just
    /// `pipeline_config.app_config` — `refresh_pipeline_config` calls
    /// `AudioCapture::set_device_id` on every apply/import
    /// (`apply_imported_profile`'s one shared path), so the very next
    /// `start()` after this import would use it. Exercised here through
    /// `MockCapture` (this crate's own `AudioCapture` test double) rather
    /// than a real `CpalCapture`, per this task's own "do not open real
    /// devices in unit tests" constraint — `desktop.rs`'s own
    /// `set_device_id_updates_what_the_next_start_will_read` test covers
    /// the `CpalCapture`-specific half (that the device it reads at
    /// `start()` time is exactly what `set_device_id` last wrote).
    #[test]
    fn import_from_desktop_sets_capture_device_from_profile() {
        let fixture = DesktopFixture::seed(true);
        let tmp = tempfile::tempdir().unwrap();
        let (state, mock) = test_state_with_mock(&tmp);
        assert_eq!(mock.device_id(), None, "no device selected before any import");

        import_from_desktop(&state).unwrap();

        assert_eq!(mock.device_id(), Some("Mock Device".to_string()));
        drop(fixture);
    }

    #[test]
    fn import_from_desktop_missing_prompts_db_is_not_an_error() {
        let _fixture = DesktopFixture::seed(false);
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);

        let summary = import_from_desktop(&state).unwrap();

        assert_eq!(summary.llm_prompts, 0, "an older Voxis install without prompts.db imports as zero prompts, not an error");
    }

    #[test]
    fn import_from_desktop_without_an_installed_voxis_is_not_found() {
        let lock = DESKTOP_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let empty_dir = tempfile::tempdir().unwrap();
        std::env::set_var("VOXIS_DESKTOP_CONFIG_DIR", empty_dir.path());
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);

        let result = import_from_desktop(&state);

        std::env::remove_var("VOXIS_DESKTOP_CONFIG_DIR");
        drop(lock);
        assert!(matches!(result, Err(PluginError::NotFound { .. })));
    }

    #[test]
    fn import_from_desktop_leaves_desktop_files_byte_identical() {
        let fixture = DesktopFixture::seed(true);
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);

        let config_path = fixture.dir.join("config.db");
        let providers_path = fixture.dir.join("providers.db");
        let prompts_path = fixture.dir.join("prompts.db");
        let before: Vec<(PathBuf, SystemTime, Vec<u8>)> = [&config_path, &providers_path, &prompts_path]
            .into_iter()
            .map(|p| (p.clone(), std::fs::metadata(p).unwrap().modified().unwrap(), sha256_of(p)))
            .collect();

        import_from_desktop(&state).unwrap();

        for (path, mtime, hash) in before {
            assert_eq!(std::fs::metadata(&path).unwrap().modified().unwrap(), mtime, "{path:?} mtime changed");
            assert_eq!(sha256_of(&path), hash, "{path:?} contents changed");
        }
    }

    /// `[R1-Safety S7]` plugin-level smoke, one layer above
    /// `sqlite_base`'s own `open_read_only_waits_out_a_writers_exclusive_
    /// lock_within_the_busy_timeout` (which is the real regression test
    /// for `busy_timeout` itself). Task 6b fix (review_6_r2 minor #2):
    /// this used to `BEGIN IMMEDIATE` + a small `UPDATE`, which in
    /// SQLite's default rollback-journal mode only takes a RESERVED lock
    /// — readers are still admitted, so the import never actually
    /// blocked and the test would have passed identically with
    /// `busy_timeout` deleted entirely. `BEGIN EXCLUSIVE` genuinely denies
    /// concurrent readers, so `import_from_desktop` (which goes through
    /// `open_read_only`'s `busy_timeout(2s)`) must actually WAIT here —
    /// asserted via elapsed time, not just "did it eventually succeed"
    /// (a lucky non-blocking race could satisfy that too). The old
    /// `released` assert (redundant with `handle.join()` succeeding at
    /// all) is dropped.
    #[test]
    fn import_from_desktop_succeeds_while_desktop_holds_an_exclusive_write_lock() {
        let fixture = DesktopFixture::seed(true);
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);

        let writer = rusqlite::Connection::open(fixture.dir.join("config.db")).unwrap();
        writer.execute("BEGIN EXCLUSIVE", []).unwrap();
        // A genuinely different, still-VALID hotkey (unlike sqlite_base.rs's
        // own EXCLUSIVE test, which writes into an unvalidated scratch
        // column) -- apply_imported_profile runs the imported config through
        // config::validate_config before import_from_desktop returns, so an
        // arbitrary placeholder string like "mid-write" would fail
        // validation instead of proving anything about blocking.
        writer
            .execute("UPDATE config SET value = 'ctrl_r' WHERE key = 'hotkey'", [])
            .unwrap();

        const HOLD_MS: u64 = 200;
        let handle = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(HOLD_MS));
            writer.execute("COMMIT", []).unwrap();
        });

        let started = std::time::Instant::now();
        let summary = import_from_desktop(&state).unwrap();
        let elapsed = started.elapsed();

        handle.join().unwrap();
        assert!(
            elapsed >= std::time::Duration::from_millis(150),
            "the import must have actually blocked on the writer's EXCLUSIVE lock (busy_timeout \
             retrying), not returned immediately — elapsed only {elapsed:?} against a {HOLD_MS}ms hold"
        );
        assert_eq!(
            summary.hotkey, "ctrl_r",
            "import must observe the POST-commit hotkey -- proves the read genuinely waited for the writer's commit rather than seeing a pre-transaction snapshot"
        );
    }

    // -- get_profile round-trip --------------------------------------

    #[test]
    fn current_profile_round_trips_what_import_from_desktop_wrote() {
        let fixture = DesktopFixture::seed(true);
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);
        import_from_desktop(&state).unwrap();

        let profile = current_profile(&state).unwrap();

        assert_eq!(profile.hotkey, "alt_r");
        assert_eq!(profile.theme, "waveform");
        assert_eq!(profile.config.api_key_ref.as_deref(), Some(voxis_core::profile::API_KEY_SECRET_NAME));
        assert_eq!(profile.dictionary, vec![("солид".to_string(), "SOLID".to_string())]);
        drop(fixture);
    }

    // -- apply_profile_bytes (file/passphrase transport) --------------

    #[test]
    fn apply_profile_bytes_round_trips_through_passphrase() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);
        let mut profile = sample_profile();
        profile.hotkey = "ctrl_r".to_string();
        let secrets = ProfileSecrets { api_key: Some(Secret::new("passphrase-secret")), llm_api_key: None };
        let key_source = KeySource::Passphrase("correct horse battery staple".to_string());
        let sealed = voxis_core::profile::seal(&profile, &secrets, &key_source).unwrap();

        let summary = apply_profile_bytes(
            &state,
            &sealed,
            KeySourceDto::Passphrase { phrase: "correct horse battery staple".to_string() },
        )
        .unwrap();

        assert_eq!(summary.source, "passphrase");
        assert_eq!(summary.hotkey, "ctrl_r");
        assert!(summary.has_api_key);
        let stored = state.secrets.get(pipeline_api_key_name()).unwrap().unwrap();
        assert_eq!(stored.expose(), "passphrase-secret");
    }

    #[test]
    fn apply_profile_bytes_wrong_phrase_is_an_error() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);
        let profile = sample_profile();
        let secrets = ProfileSecrets::default();
        let key_source = KeySource::Passphrase("correct horse battery staple".to_string());
        let sealed = voxis_core::profile::seal(&profile, &secrets, &key_source).unwrap();

        let result = apply_profile_bytes(
            &state,
            &sealed,
            KeySourceDto::Passphrase { phrase: "wrong phrase entirely".to_string() },
        );

        assert!(matches!(result, Err(PluginError::Profile { .. })));
    }

    // -- set_provider (manual key entry, no desktop/QR) --------------

    #[test]
    fn set_provider_persists_url_and_model_and_reads_key_back_through_the_secret_store_only() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);

        let summary = set_provider(
            &state,
            Some("gsk_manual_secret_key".to_string()),
            Some("https://self.hosted.example/v1/audio/transcriptions".to_string()),
            Some("whisper-manual".to_string()),
        )
        .unwrap();

        assert_eq!(summary.source, "manual");
        assert!(summary.has_api_key);

        // Persisted to the plugin's own profile storage.
        let profile = current_profile(&state).unwrap();
        assert_eq!(
            profile.config.api_url_override.as_deref(),
            Some("https://self.hosted.example/v1/audio/transcriptions")
        );
        assert_eq!(profile.config.model, "whisper-manual");
        assert_eq!(profile.config.api_key_ref.as_deref(), Some(pipeline_api_key_name()));

        // The key is readable back only through the SecretStore...
        let stored = state.secrets.get(pipeline_api_key_name()).unwrap().unwrap();
        assert_eq!(stored.expose(), "gsk_manual_secret_key");

        // ...and never lands in the plugin's own sqlite (`[R1-Safety S2]`).
        let config_db = state.profile_dir.join("config.db");
        assert!(config_db.exists(), "set_provider must have written the plugin's own config.db");
        let bytes = std::fs::read(&config_db).unwrap();
        assert!(
            !contains_subslice(&bytes, b"gsk_manual_secret_key"),
            "config.db must never contain the raw API key"
        );
    }

    #[test]
    fn set_provider_trims_the_key_and_url() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);

        set_provider(
            &state,
            Some("  gsk_padded  ".to_string()),
            Some("  https://trim.example/v1  ".to_string()),
            None,
        )
        .unwrap();

        assert_eq!(state.secrets.get(pipeline_api_key_name()).unwrap().unwrap().expose(), "gsk_padded");
        assert_eq!(
            current_profile(&state).unwrap().config.api_url_override.as_deref(),
            Some("https://trim.example/v1")
        );
    }

    #[test]
    fn set_provider_null_url_is_the_groq_default_none() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);
        set_provider(&state, None, Some("https://self.hosted.example/v1".to_string()), None).unwrap();
        assert!(current_profile(&state).unwrap().config.api_url_override.is_some());

        set_provider(&state, None, None, None).unwrap();

        assert_eq!(
            current_profile(&state).unwrap().config.api_url_override,
            None,
            "a null apiUrlOverride resets to the Groq default (None)"
        );
    }

    #[test]
    fn set_provider_null_key_keeps_the_existing_key() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);
        set_provider(&state, Some("gsk_first".to_string()), None, None).unwrap();

        // A later call that only changes the model must not disturb the key.
        let summary = set_provider(&state, None, None, Some("whisper-2".to_string())).unwrap();

        assert!(summary.has_api_key);
        assert_eq!(state.secrets.get(pipeline_api_key_name()).unwrap().unwrap().expose(), "gsk_first");
        assert_eq!(current_profile(&state).unwrap().config.model, "whisper-2");
    }

    #[test]
    fn set_provider_empty_key_clears_the_existing_key() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);
        set_provider(&state, Some("gsk_to_be_cleared".to_string()), None, None).unwrap();
        assert!(state.secrets.get(pipeline_api_key_name()).unwrap().is_some());

        // Whitespace-only counts as empty after trimming.
        let summary = set_provider(&state, Some("   ".to_string()), None, None).unwrap();

        assert!(!summary.has_api_key, "clearing the key leaves has_api_key false");
        assert!(state.secrets.get(pipeline_api_key_name()).unwrap().is_none(), "the stored key must be gone");
        assert_eq!(current_profile(&state).unwrap().config.api_key_ref, None);
    }

    #[test]
    fn set_provider_rejects_a_non_http_url() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);

        for bad in ["ftp://example.com/v1", "not a url", "file:///etc/passwd", "http://"] {
            let result = set_provider(&state, None, Some(bad.to_string()), None);
            assert!(matches!(result, Err(PluginError::Profile { .. })), "{bad:?} must be rejected");
        }

        // A rejected URL must not have persisted anything.
        assert_eq!(current_profile(&state).unwrap().config.api_url_override, None);
    }

    #[test]
    fn set_provider_resets_consent_only_when_the_provider_host_changes() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);

        // Consent granted for both the Groq default host and a self-hosted host.
        state.consent.set_consent(&state.host_id, "api.groq.com", true).unwrap();
        state.consent.set_consent(&state.host_id, "self.hosted.example", true).unwrap();

        // Same host (still Groq default -- only the model changes): consent kept.
        set_provider(&state, None, None, Some("whisper-3".to_string())).unwrap();
        assert!(state.consent.is_consented(&state.host_id, "api.groq.com").unwrap());

        // Host changes groq -> self.hosted.example: consent for the NEW host reset.
        set_provider(&state, None, Some("https://self.hosted.example/v1".to_string()), None).unwrap();
        assert!(
            !state.consent.is_consented(&state.host_id, "self.hosted.example").unwrap(),
            "changing the provider host must reset consent for the new host"
        );
    }

    /// The consent gate follows the ACTIVE profile's host: after switching
    /// to a self-hosted URL, a Groq consent no longer opens the mic, and
    /// `do_start` names the new host in `ConsentRequired`.
    #[tokio::test]
    async fn start_gates_consent_on_the_active_profiles_host_not_the_hardcoded_groq_one() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);
        state.consent.set_consent(&state.host_id, "api.groq.com", true).unwrap();
        set_provider(&state, Some("k".to_string()), Some("https://self.hosted.example/v1/audio/transcriptions".to_string()), None).unwrap();

        let err = crate::commands::do_start(&state, crate::models::Mode::Toggle).await.unwrap_err();
        assert!(
            matches!(&err, PluginError::ConsentRequired { provider_host } if provider_host == "self.hosted.example"),
            "expected ConsentRequired for the self-hosted host, got {err:?}"
        );

        crate::commands::do_set_consent(&state, true).unwrap();
        assert!(state.consent.is_consented(&state.host_id, "self.hosted.example").unwrap(), "set_consent must key on the live host too");
        let id = crate::commands::do_start(&state, crate::models::Mode::Toggle).await.unwrap();
        crate::commands::do_cancel(&state, &id).await.unwrap();
    }

    #[tokio::test]
    async fn set_provider_is_refused_while_a_session_is_active() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);
        state.consent.set_consent(&state.host_id, &state.provider_host, true).unwrap();
        state.secrets.set(crate::pipeline::API_KEY_SECRET_NAME, &Secret::new("k")).unwrap();
        let id = crate::commands::do_start(&state, crate::models::Mode::Hold).await.unwrap();
        assert!(state.sessions.has_active());

        let result = set_provider(&state, Some("gsk_new".to_string()), None, None);

        assert!(matches!(result, Err(PluginError::AlreadyRecording)));
        crate::commands::do_cancel(&state, &id).await.unwrap();
    }

    // -- import_from_qr -----------------------------------------------

    fn sample_profile() -> VoxisProfile {
        VoxisProfile {
            version: VoxisProfile::CURRENT_VERSION,
            config: voxis_core::profile::ProfileConfig {
                provider: "groq".to_string(),
                model: "whisper-large-v3".to_string(),
                api_key_ref: Some(voxis_core::profile::API_KEY_SECRET_NAME.to_string()),
                api_url_override: None,
                language: "en".to_string(),
                translate_to_english: false,
                audio_device: None,
                min_recording_ms: 300,
                silence_timeout_ms: 60_000,
                max_recording_ms: 600_000,
                hotkey_hold_ms: 300,
                llm_enabled: false,
                llm_provider: String::new(),
                llm_api_url: String::new(),
                llm_api_key_ref: None,
                llm_model: String::new(),
                llm_prompt: String::new(),
            },
            dictionary: vec![],
            llm: voxis_core::profile::LlmProfile { providers: vec![], prompts: vec![], active_prompt_id: None },
            theme: "default".to_string(),
            hotkey: "alt_r".to_string(),
        }
    }

    #[tokio::test]
    async fn import_from_qr_happy_path_fetches_opens_and_applies() {
        // Dedicated (non-pooled) listener -- see this module's doc comment
        // above `mod tests` for why `new_async()` (mockito's pooled
        // constructor) is flaky under this crate's parallel test load.
        let mut server =
            mockito::Server::new_with_opts_async(mockito::ServerOpts { port: 0, ..Default::default() }).await;
        let k_qr = [7u8; 32];
        let code = "123456".to_string();
        let mut profile = sample_profile();
        profile.hotkey = "cmd_r".to_string();
        let secrets = ProfileSecrets { api_key: Some(Secret::new("qr-secret-key")), llm_api_key: None };
        let sealed =
            voxis_core::profile::seal(&profile, &secrets, &KeySource::Qr { k_qr, code: code.clone() }).unwrap();

        let mock = server
            .mock("GET", "/profile")
            .match_query(mockito::Matcher::UrlEncoded("token".into(), "tok-1".into()))
            .with_status(200)
            .with_body(sealed)
            .create_async()
            .await;

        let host = server.host_with_port();
        let (host_only, port_str) = host.split_once(':').unwrap();
        let payload = serde_json::json!({
            "v": 1,
            "host": host_only,
            "port": port_str.parse::<u16>().unwrap(),
            "token": "tok-1",
            "k": voxis_core::profile::encode_base64url(&k_qr),
        })
        .to_string();

        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);

        let summary = import_from_qr(&state, &payload, code).await.unwrap();

        mock.assert_async().await;
        assert_eq!(summary.source, "qr");
        assert_eq!(summary.hotkey, "cmd_r");
        let stored = state.secrets.get(pipeline_api_key_name()).unwrap().unwrap();
        assert_eq!(stored.expose(), "qr-secret-key");
    }

    #[tokio::test]
    async fn import_from_qr_wrong_code_is_an_error() {
        // Dedicated (non-pooled) listener -- see this module's doc comment
        // above `mod tests` for why `new_async()` (mockito's pooled
        // constructor) is flaky under this crate's parallel test load.
        let mut server =
            mockito::Server::new_with_opts_async(mockito::ServerOpts { port: 0, ..Default::default() }).await;
        let k_qr = [7u8; 32];
        let profile = sample_profile();
        let secrets = ProfileSecrets::default();
        let sealed = voxis_core::profile::seal(&profile, &secrets, &KeySource::Qr { k_qr, code: "123456".to_string() })
            .unwrap();

        let _mock = server
            .mock("GET", "/profile")
            .match_query(mockito::Matcher::Any)
            .with_status(200)
            .with_body(sealed)
            .create_async()
            .await;

        let host = server.host_with_port();
        let (host_only, port_str) = host.split_once(':').unwrap();
        let payload = serde_json::json!({
            "v": 1,
            "host": host_only,
            "port": port_str.parse::<u16>().unwrap(),
            "token": "tok-1",
            "k": voxis_core::profile::encode_base64url(&k_qr),
        })
        .to_string();

        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);

        let result = import_from_qr(&state, &payload, "000000".to_string()).await;

        assert!(matches!(result, Err(PluginError::Profile { .. })));
    }

    #[tokio::test]
    async fn import_from_qr_410_gone_is_an_error() {
        // Dedicated (non-pooled) listener -- see this module's doc comment
        // above `mod tests` for why `new_async()` (mockito's pooled
        // constructor) is flaky under this crate's parallel test load.
        let mut server =
            mockito::Server::new_with_opts_async(mockito::ServerOpts { port: 0, ..Default::default() }).await;
        let _mock = server
            .mock("GET", "/profile")
            .match_query(mockito::Matcher::Any)
            .with_status(410)
            .create_async()
            .await;

        let host = server.host_with_port();
        let (host_only, port_str) = host.split_once(':').unwrap();
        let payload = serde_json::json!({
            "v": 1,
            "host": host_only,
            "port": port_str.parse::<u16>().unwrap(),
            "token": "reused-token",
            "k": voxis_core::profile::encode_base64url(&[1u8; 32]),
        })
        .to_string();

        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);

        let result = import_from_qr(&state, &payload, "123456".to_string()).await;

        assert!(matches!(result, Err(PluginError::Profile { message }) if message.contains("410")));
    }

    #[tokio::test]
    async fn import_from_qr_rejects_a_k_of_the_wrong_length() {
        let payload = serde_json::json!({
            "v": 1,
            "host": "127.0.0.1",
            "port": 65535u16,
            "token": "tok-1",
            "k": voxis_core::profile::encode_base64url(&[1u8; 16]),
        })
        .to_string();

        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);

        let result = import_from_qr(&state, &payload, "123456".to_string()).await;

        assert!(matches!(result, Err(PluginError::Profile { .. })));
    }

    // -- build_qr_url validation [REJECT-FIX F3] ---------------------

    #[tokio::test]
    async fn import_from_qr_rejects_a_hostname_instead_of_an_ipv4_literal() {
        let payload = serde_json::json!({
            "v": 1,
            "host": "desktop.local",
            "port": 4217u16,
            "token": "tok-1",
            "k": voxis_core::profile::encode_base64url(&[1u8; 32]),
        })
        .to_string();

        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);

        let result = import_from_qr(&state, &payload, "123456".to_string()).await;

        assert!(matches!(result, Err(PluginError::Profile { .. })));
    }

    #[tokio::test]
    async fn import_from_qr_rejects_a_userinfo_authority_injection_host() {
        let payload = serde_json::json!({
            "v": 1,
            "host": "user@evil.example",
            "port": 4217u16,
            "token": "tok-1",
            "k": voxis_core::profile::encode_base64url(&[1u8; 32]),
        })
        .to_string();

        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);

        let result = import_from_qr(&state, &payload, "123456".to_string()).await;

        assert!(matches!(result, Err(PluginError::Profile { .. })));
    }

    #[tokio::test]
    async fn import_from_qr_rejects_a_token_with_query_injection_characters() {
        for bad_token in ["tok&extra=1", "tok#fragment", "tok token", ""] {
            let payload = serde_json::json!({
                "v": 1,
                "host": "127.0.0.1",
                "port": 4217u16,
                "token": bad_token,
                "k": voxis_core::profile::encode_base64url(&[1u8; 32]),
            })
            .to_string();

            let tmp = tempfile::tempdir().unwrap();
            let state = test_state(&tmp);

            let result = import_from_qr(&state, &payload, "123456".to_string()).await;

            assert!(
                matches!(result, Err(PluginError::Profile { .. })),
                "token {bad_token:?} must be rejected"
            );
        }
    }

    #[tokio::test]
    async fn import_from_qr_does_not_follow_a_redirect() {
        // Dedicated (non-pooled) listener -- see this module's doc comment
        // above `mod tests` for why `new_async()` (mockito's pooled
        // constructor) is flaky under this crate's parallel test load.
        let mut server =
            mockito::Server::new_with_opts_async(mockito::ServerOpts { port: 0, ..Default::default() }).await;
        let redirect_target = format!("{}/somewhere-else", server.url());
        let _mock = server
            .mock("GET", "/profile")
            .match_query(mockito::Matcher::Any)
            .with_status(302)
            .with_header("Location", &redirect_target)
            .create_async()
            .await;
        // If a redirect were ever followed, this second mock returning a
        // real 200 would make the import succeed -- proving the fix by
        // making the wrong behavior observable, not just "some error
        // occurred".
        let redirect_mock = server
            .mock("GET", "/somewhere-else")
            .with_status(200)
            .with_body(vec![0u8; 4])
            .expect(0)
            .create_async()
            .await;

        let host = server.host_with_port();
        let (host_only, port_str) = host.split_once(':').unwrap();
        let payload = serde_json::json!({
            "v": 1,
            "host": host_only,
            "port": port_str.parse::<u16>().unwrap(),
            "token": "tok-1",
            "k": voxis_core::profile::encode_base64url(&[1u8; 32]),
        })
        .to_string();

        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(&tmp);

        let result = import_from_qr(&state, &payload, "123456".to_string()).await;

        assert!(matches!(result, Err(PluginError::Profile { .. })), "a 302 must surface as an error, not be followed");
        redirect_mock.assert_async().await; // proves the redirect target was never actually fetched
    }

    fn pipeline_api_key_name() -> &'static str {
        voxis_core::profile::API_KEY_SECRET_NAME
    }

    fn contains_subslice(haystack: &[u8], needle: &[u8]) -> bool {
        haystack.windows(needle.len()).any(|w| w == needle)
    }
}

