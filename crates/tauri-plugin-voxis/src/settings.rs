//! 0.7.0: the two generic settings commands a host's config-driven
//! settings wrapper talks to (`settings_get`/`settings_set`), mapped onto
//! the plugin's EXISTING profile/provider/hotkey/theme storage — there is
//! no second settings store. The field list and its behaviour (labels,
//! required/enabledWhen rules, kinds) live in the guest-js settings
//! manifest (`guest-js/src/voxis-settings-manifest.json`); this module only
//! owns the `store: "plugin"` values and the `status` object the manifest's
//! conditions read. `tests::manifest_*` below pin the two together.
//!
//! Wire shapes (camelCase):
//! - `settings_get() -> { values, status }`
//! - `settings_set(values) -> { values, status }` — `values` is a PARTIAL
//!   patch: only the keys present change. Unknown keys and bad values are
//!   rejected with `{ kind: "invalid", field, message }` before anything
//!   is written.
//!
//! Secrets: `apiKey` is write-only. `settings_get` never carries it (not
//! even masked) — `status.hasApiKey` says set/unset. In `settings_set`,
//! `apiKey` absent, `null` or empty/whitespace keeps the stored key
//! ("leave empty to keep"); any other string replaces it.

use serde::Serialize;
use serde_json::{Map, Value};

use crate::error::PluginError;
use crate::models::{HotkeySpec, Mode, State};
use crate::profile_source;
use crate::PluginState;

/// Every `store: "plugin"` key `settings_set` accepts (and the manifest
/// declares). `apiKey` is the only one `settings_get` never returns.
pub const PLUGIN_SETTING_KEYS: &[&str] = &["provider", "apiKey", "apiUrlOverride", "model", "hotkey", "theme"];

/// `values.provider` for the built-in Groq endpoint (no URL override).
pub const PROVIDER_GROQ: &str = "groq";
/// `values.provider` for a self-hosted Whisper-compatible server
/// (`apiUrlOverride` required).
pub const PROVIDER_SELF_HOSTED: &str = "selfHosted";

/// Ids of the builtin overlay themes this plugin ships
/// (`guest-js/src/themes/generated/<id>/`). Rust has no theme engine, so
/// the list is spelled out; `tests::builtin_theme_ids_match_guest_js` fails
/// when a theme is added or removed there without updating it here.
pub const BUILTIN_THEME_IDS: &[&str] = &[
    "all_aquarium",
    "default",
    "didinium_drift",
    "drifting_contour",
    "duo_aquarium",
    "euglena_drift",
    "handy_pill",
    "lavalamp",
    "living_reed",
    "metaballs",
    "metaballs25d",
    "metaballs3d",
    "neon",
    "paramecium_solo",
    "quiet_reed",
    "radiolarian",
    "vorticella_bloom",
    "winamp_classic",
];

/// The readable `store: "plugin"` values. `apiKey` is deliberately absent.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsValues {
    /// `"groq"` | `"selfHosted"`.
    pub provider: String,
    /// `""` for Groq.
    pub api_url_override: String,
    pub model: String,
    /// Global hotkey spec string (`"alt_r"`, `"Cmd+Shift+V"`); desktop only.
    pub hotkey: String,
    pub theme: String,
}

/// Read-only facts the manifest's `status` fields and conditions read
/// (`{ query: "status", path: "<field>" }`). Never carries a secret.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsStatus {
    /// A transcription API key is stored (set/unset only, never the key).
    pub has_api_key: bool,
    /// Same as `values.provider`.
    pub provider: String,
    /// `"Groq"` or `"Self-hosted <host>"`.
    pub provider_label: String,
    /// The host consent is keyed on (`api.groq.com` or the override's host).
    pub provider_host: String,
    /// `std::env::consts::OS` of this build: `macos`, `windows`, `linux`,
    /// `ios`, `android`, ...
    pub platform: String,
    /// A desktop OS (macOS/Windows/Linux) — where a Voxis desktop install
    /// can exist to import from.
    pub desktop: bool,
    /// This build has an OS-level global hotkey backend.
    pub hotkey_supported: bool,
    /// This build can record on this platform.
    pub dictation_supported: bool,
    pub unsupported_reason: Option<String>,
    /// Plugin session state (`idle`/`recording`/`transcribing`/`error`).
    pub state: State,
    /// Selectable theme ids (`BUILTIN_THEME_IDS`).
    pub theme_ids: Vec<String>,
    /// This crate's version.
    pub plugin_version: String,
    /// One line for bug reports: version · platform · state · key · provider.
    pub diagnostics: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSnapshot {
    pub values: SettingsValues,
    pub status: SettingsStatus,
}

fn provider_label(api_url_override: Option<&str>) -> String {
    match api_url_override {
        None => "Groq".to_string(),
        Some(url) => format!("Self-hosted {}", profile_source::provider_host_of(Some(url))),
    }
}

/// `settings_get`.
pub fn get(state: &PluginState) -> Result<SettingsSnapshot, PluginError> {
    let profile = profile_source::current_profile(state)?;
    let url = profile.config.api_url_override.clone();
    let provider = if url.is_some() { PROVIDER_SELF_HOSTED } else { PROVIDER_GROQ }.to_string();
    let has_api_key = profile.config.api_key_ref.is_some();
    let unsupported_reason = state.capture.unsupported_reason();
    let session_state = crate::commands::do_state(state);
    let platform = std::env::consts::OS.to_string();
    let plugin_version = env!("CARGO_PKG_VERSION").to_string();
    let label = provider_label(url.as_deref());
    let diagnostics = format!(
        "voxis {plugin_version} · {platform} · {} · key {} · {label}",
        serde_json::to_value(session_state).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default(),
        if has_api_key { "set" } else { "missing" },
    );
    Ok(SettingsSnapshot {
        values: SettingsValues {
            provider: provider.clone(),
            api_url_override: url.clone().unwrap_or_default(),
            model: profile.config.model.clone(),
            hotkey: profile.hotkey.clone(),
            theme: profile.theme.clone(),
        },
        status: SettingsStatus {
            has_api_key,
            provider,
            provider_label: label,
            provider_host: profile_source::provider_host_of(url.as_deref()),
            platform,
            desktop: cfg!(any(target_os = "macos", target_os = "windows", target_os = "linux")),
            hotkey_supported: state.hotkey.is_some(),
            dictation_supported: unsupported_reason.is_none(),
            unsupported_reason,
            state: session_state,
            theme_ids: BUILTIN_THEME_IDS.iter().map(|s| s.to_string()).collect(),
            plugin_version,
            diagnostics,
        },
    })
}

fn invalid(field: &str, message: impl Into<String>) -> PluginError {
    PluginError::Invalid { field: field.to_string(), message: message.into() }
}

/// Reads `values[key]` as an optional string: absent/`null` -> `None`,
/// a string -> `Some`, anything else -> `invalid(key)`.
fn opt_string(values: &Map<String, Value>, key: &str) -> Result<Option<String>, PluginError> {
    match values.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.clone())),
        Some(_) => Err(invalid(key, "must be a string")),
    }
}

/// `settings_set(values)`: validate the whole patch first (nothing is
/// written if any key is bad), then persist through the same path every
/// profile import uses (`profile_source::apply_imported_profile`, source
/// `"manual"`), apply a changed hotkey to the OS backend, and return the
/// fresh `{ values, status }`.
///
/// Refused with `alreadyRecording` while a session is live (it rewrites
/// the pipeline config an in-flight session already read). A provider-host
/// change resets consent for the new host, as `set_provider` does.
/// A hotkey the OS backend rejects as unparseable is `invalid` on
/// `hotkey`; a `permissionDenied` from the backend is returned AFTER the
/// values were saved (the spec is fine, the OS grant is missing).
pub fn set(state: &PluginState, values: Value) -> Result<SettingsSnapshot, PluginError> {
    let Value::Object(values) = values else {
        return Err(invalid("", "settings must be an object"));
    };
    if let Some(unknown) = values.keys().find(|k| !PLUGIN_SETTING_KEYS.contains(&k.as_str())) {
        return Err(invalid(unknown, "unknown setting"));
    }
    if state.sessions.has_active() {
        return Err(PluginError::AlreadyRecording);
    }

    let mut profile = profile_source::current_profile(state)?;

    // provider + apiUrlOverride -> Option<url>.
    let provider = opt_string(&values, "provider")?;
    let url_patch = opt_string(&values, "apiUrlOverride")?.map(|u| u.trim().to_string());
    let provider = provider.unwrap_or_else(|| {
        if profile.config.api_url_override.is_some() { PROVIDER_SELF_HOSTED } else { PROVIDER_GROQ }.to_string()
    });
    let new_url = match provider.as_str() {
        PROVIDER_GROQ => None,
        PROVIDER_SELF_HOSTED => {
            // An explicit "" is an error; an absent URL keeps the stored one.
            let url = match url_patch {
                Some(u) => Some(u).filter(|u| !u.is_empty()),
                None => profile.config.api_url_override.clone(),
            }
            .ok_or_else(|| invalid("apiUrlOverride", "a self-hosted provider needs a server URL"))?;
            profile_source::validate_http_url(&url).map_err(|e| match e {
                PluginError::Profile { message } => invalid("apiUrlOverride", message),
                other => other,
            })?;
            Some(url)
        }
        other => return Err(invalid("provider", format!("unknown provider {other:?} (expected \"groq\" or \"selfHosted\")"))),
    };

    // model: empty keeps the current one.
    if let Some(model) = opt_string(&values, "model")?.map(|m| m.trim().to_string()) {
        if !model.is_empty() {
            profile.config.model = model;
        }
    }

    // theme: a builtin id, or the one already stored (an imported custom
    // theme stays selectable without being re-validated).
    if let Some(theme) = opt_string(&values, "theme")?.map(|t| t.trim().to_string()) {
        if theme != profile.theme {
            if !BUILTIN_THEME_IDS.contains(&theme.as_str()) {
                return Err(invalid("theme", format!("unknown theme {theme:?}")));
            }
            profile.theme = theme;
        }
    }

    // hotkey: only a CHANGED value is applied to the OS backend. Applied
    // before persisting so an unparseable spec saves nothing.
    let mut hotkey_permission_error = None;
    if let Some(hotkey) = opt_string(&values, "hotkey")?.map(|h| h.trim().to_string()) {
        if hotkey != profile.hotkey {
            if hotkey.is_empty() {
                return Err(invalid("hotkey", "choose a key"));
            }
            if let Some(backend) = &state.hotkey {
                match backend.set_hotkey(&HotkeySpec { key: hotkey.clone(), mode: Mode::Hold }) {
                    Ok(()) => {}
                    Err(PluginError::InvalidHotkey { message }) => return Err(invalid("hotkey", message)),
                    Err(e @ PluginError::PermissionDenied { .. }) => hotkey_permission_error = Some(e),
                    Err(e) => return Err(e),
                }
            }
            profile.hotkey = hotkey;
        }
    }

    // apiKey: absent/null/empty keeps the stored key.
    let mut secrets = voxis_core::profile::ProfileSecrets::default();
    if let Some(key) = opt_string(&values, "apiKey")? {
        let key = key.trim();
        if !key.is_empty() {
            secrets.api_key = Some(voxis_core::profile::Secret::new(key.to_owned()));
            profile.config.api_key_ref = Some(voxis_core::profile::API_KEY_SECRET_NAME.to_string());
        }
    }

    let old_host = profile_source::provider_host_of(profile.config.api_url_override.as_deref());
    let new_host = profile_source::provider_host_of(new_url.as_deref());
    profile.config.api_url_override = new_url;

    profile_source::apply_imported_profile(state, "manual", profile, secrets)?;

    if old_host != new_host {
        state
            .consent
            .set_consent(&state.host_id, &new_host, false)
            .map_err(|e| PluginError::Store { message: format!("resetting consent: {e}") })?;
    }

    if let Some(e) = hotkey_permission_error {
        return Err(e);
    }
    get(state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::MockCapture;
    use crate::consent::ConsentStore;
    use crate::events::RecordingSink;
    use crate::secrets::InMemorySecretStore;
    use crate::{HotkeyController, PipelineConfig};
    use serde_json::json;
    use std::sync::{Arc, Mutex};

    const KEY: &str = "gsk_super_secret_value_123";

    #[derive(Default)]
    struct RecordingHotkey {
        specs: Mutex<Vec<String>>,
    }
    impl HotkeyController for RecordingHotkey {
        fn set_hotkey(&self, spec: &HotkeySpec) -> Result<(), PluginError> {
            if spec.key == "not-a-key" {
                return Err(PluginError::InvalidHotkey { message: "unrecognized hotkey".to_string() });
            }
            self.specs.lock().unwrap().push(spec.key.clone());
            Ok(())
        }
    }

    fn state(tmp: &tempfile::TempDir, hotkey: Option<Arc<dyn HotkeyController>>) -> PluginState {
        PluginState {
            sessions: Arc::new(crate::session::SessionGuard::new()),
            consent: ConsentStore::new(tmp.path().join("consent.json")),
            secrets: Arc::new(InMemorySecretStore::new()),
            rec_dir: crate::capture::RecDir::new(tmp.path().to_path_buf()),
            capture: Arc::new(MockCapture::new()),
            events: Arc::new(RecordingSink::new()),
            pipeline_config: std::sync::Mutex::new(PipelineConfig::default()),
            hotkey,
            host_id: "test-host".to_string(),
            provider_host: "api.groq.com".to_string(),
            profile_dir: tmp.path().join("voxis-plugin"),
        }
    }

    #[test]
    fn fresh_get_reports_groq_and_no_key() {
        let tmp = tempfile::tempdir().unwrap();
        let s = state(&tmp, None);
        let snap = get(&s).unwrap();
        assert_eq!(snap.values.provider, "groq");
        assert_eq!(snap.values.api_url_override, "");
        assert!(!snap.status.has_api_key);
        assert_eq!(snap.status.provider_label, "Groq");
        assert!(!snap.status.hotkey_supported);
        assert!(snap.status.dictation_supported);
        assert_eq!(snap.status.theme_ids.len(), BUILTIN_THEME_IDS.len());
        assert_eq!(snap.status.plugin_version, env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn round_trip_persists_every_plugin_value() {
        let tmp = tempfile::tempdir().unwrap();
        let hk = Arc::new(RecordingHotkey::default());
        let s = state(&tmp, Some(hk.clone()));
        let after_set = set(
            &s,
            json!({
                "provider": "selfHosted",
                "apiUrlOverride": " http://10.0.0.5:8000/v1/audio/transcriptions ",
                "apiKey": KEY,
                "model": "whisper-1",
                "hotkey": "shift_r",
                "theme": "neon",
            }),
        )
        .unwrap();
        let after_get = get(&s).unwrap();
        assert_eq!(after_set, after_get, "settings_set returns exactly what settings_get then reads");
        let v = &after_get.values;
        assert_eq!(v.provider, "selfHosted");
        assert_eq!(v.api_url_override, "http://10.0.0.5:8000/v1/audio/transcriptions");
        assert_eq!(v.model, "whisper-1");
        assert_eq!(v.hotkey, "shift_r");
        assert_eq!(v.theme, "neon");
        assert!(after_get.status.has_api_key);
        assert_eq!(after_get.status.provider_host, "10.0.0.5");
        assert_eq!(after_get.status.provider_label, "Self-hosted 10.0.0.5");
        assert_eq!(*hk.specs.lock().unwrap(), vec!["shift_r".to_string()], "a changed hotkey is armed once");
        assert_eq!(
            s.secrets.get(voxis_core::profile::API_KEY_SECRET_NAME).unwrap().unwrap().expose(),
            KEY
        );
        // The pipeline sees the new provider without a restart.
        let cfg = s.pipeline_config.lock().unwrap();
        assert_eq!(cfg.app_config.api_url_override.as_deref(), Some("http://10.0.0.5:8000/v1/audio/transcriptions"));

        // Back to Groq clears the override.
        drop(cfg);
        let back = set(&s, json!({ "provider": "groq" })).unwrap();
        assert_eq!(back.values.provider, "groq");
        assert_eq!(back.values.api_url_override, "");
        assert!(back.status.has_api_key, "switching provider keeps the key");
    }

    #[test]
    fn secret_is_never_in_get_or_set_output() {
        let tmp = tempfile::tempdir().unwrap();
        let s = state(&tmp, None);
        let set_out = serde_json::to_string(&set(&s, json!({ "apiKey": KEY })).unwrap()).unwrap();
        let get_out = serde_json::to_string(&get(&s).unwrap()).unwrap();
        for out in [&set_out, &get_out] {
            assert!(!out.contains(KEY), "secret leaked: {out}");
            assert!(!out.contains("apiKey\""), "no apiKey value key at all: {out}");
            assert!(out.contains("\"hasApiKey\":true"));
        }
    }

    #[test]
    fn empty_or_missing_secret_keeps_the_stored_key() {
        let tmp = tempfile::tempdir().unwrap();
        let s = state(&tmp, None);
        set(&s, json!({ "apiKey": KEY })).unwrap();
        for patch in [json!({ "apiKey": "" }), json!({ "apiKey": "   " }), json!({ "apiKey": null }), json!({ "model": "m2" })] {
            let snap = set(&s, patch.clone()).unwrap();
            assert!(snap.status.has_api_key, "{patch} must keep the key");
            assert_eq!(s.secrets.get(voxis_core::profile::API_KEY_SECRET_NAME).unwrap().unwrap().expose(), KEY);
        }
    }

    #[test]
    fn invalid_url_is_a_field_error_and_saves_nothing() {
        let tmp = tempfile::tempdir().unwrap();
        let s = state(&tmp, None);
        let before = get(&s).unwrap();
        for url in ["not a url", "ftp://example.com/x", "http://"] {
            let err = set(&s, json!({ "provider": "selfHosted", "apiUrlOverride": url, "model": "changed" })).unwrap_err();
            match &err {
                PluginError::Invalid { field, .. } => assert_eq!(field, "apiUrlOverride", "{url}"),
                other => panic!("{url}: expected invalid, got {other:?}"),
            }
            let wire = serde_json::to_value(&err).unwrap();
            assert_eq!(wire["kind"], "invalid");
            assert_eq!(wire["field"], "apiUrlOverride");
        }
        assert_eq!(get(&s).unwrap(), before, "a rejected patch writes nothing");
    }

    #[test]
    fn self_hosted_without_url_is_a_field_error() {
        let tmp = tempfile::tempdir().unwrap();
        let s = state(&tmp, None);
        for patch in [json!({ "provider": "selfHosted" }), json!({ "provider": "selfHosted", "apiUrlOverride": "  " })] {
            let err = set(&s, patch).unwrap_err();
            assert!(matches!(err, PluginError::Invalid { ref field, .. } if field == "apiUrlOverride"), "{err:?}");
        }
    }

    #[test]
    fn other_bad_values_carry_their_field() {
        let tmp = tempfile::tempdir().unwrap();
        let hk: Arc<dyn HotkeyController> = Arc::new(RecordingHotkey::default());
        let s = state(&tmp, Some(hk));
        let cases = [
            (json!({ "theme": "no_such_theme" }), "theme"),
            (json!({ "provider": "openai" }), "provider"),
            (json!({ "hotkey": "not-a-key" }), "hotkey"),
            (json!({ "hotkey": "" }), "hotkey"),
            (json!({ "model": 5 }), "model"),
            (json!({ "enabled": true }), "enabled"),
        ];
        for (patch, expected) in cases {
            match set(&s, patch.clone()) {
                Err(PluginError::Invalid { field, .. }) => assert_eq!(field, expected, "{patch}"),
                other => panic!("{patch}: expected invalid {expected}, got {other:?}"),
            }
        }
    }

    #[tokio::test]
    async fn set_is_refused_while_recording() {
        let tmp = tempfile::tempdir().unwrap();
        let s = state(&tmp, None);
        s.secrets.set(voxis_core::profile::API_KEY_SECRET_NAME, &voxis_core::profile::Secret::new("k")).unwrap();
        s.consent.set_consent("test-host", "api.groq.com", true).unwrap();
        crate::commands::do_start(&s, Mode::Hold).await.unwrap();
        assert!(matches!(set(&s, json!({ "model": "x" })), Err(PluginError::AlreadyRecording)));
    }

    #[test]
    fn provider_host_change_resets_consent() {
        let tmp = tempfile::tempdir().unwrap();
        let s = state(&tmp, None);
        s.consent.set_consent("test-host", "10.0.0.9", true).unwrap();
        set(&s, json!({ "provider": "selfHosted", "apiUrlOverride": "http://10.0.0.9:8000/x" })).unwrap();
        assert!(!s.consent.is_consented("test-host", "10.0.0.9").unwrap());
    }

    #[test]
    fn builtin_theme_ids_match_guest_js() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("guest-js/src/themes/generated");
        let mut ids: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().join("theme.json").exists())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        ids.sort();
        assert_eq!(ids, BUILTIN_THEME_IDS.iter().map(|s| s.to_string()).collect::<Vec<_>>());
    }

    fn manifest() -> Value {
        serde_json::from_str(include_str!("../guest-js/src/voxis-settings-manifest.json")).unwrap()
    }

    fn manifest_fields() -> Vec<Value> {
        manifest()["sections"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|s| s["fields"].as_array().unwrap().clone())
            .collect()
    }

    /// The manifest's `store: "plugin"` input fields are exactly the keys
    /// `settings_set` accepts.
    #[test]
    fn manifest_plugin_fields_match_settings_keys() {
        let mut keys: Vec<String> = manifest_fields()
            .iter()
            .filter(|f| f["store"] == "plugin" && !matches!(f["kind"].as_str(), Some("status" | "action" | "file-import")))
            .map(|f| f["key"].as_str().unwrap().to_string())
            .collect();
        keys.sort();
        let mut expected: Vec<String> = PLUGIN_SETTING_KEYS.iter().map(|s| s.to_string()).collect();
        expected.sort();
        assert_eq!(keys, expected);
    }

    /// Every `status` path the manifest declares exists on the wire
    /// `status` object, and vice versa.
    #[test]
    fn manifest_status_paths_match_settings_status() {
        let tmp = tempfile::tempdir().unwrap();
        let status = serde_json::to_value(get(&state(&tmp, None)).unwrap().status).unwrap();
        let mut wire: Vec<String> = status.as_object().unwrap().keys().cloned().collect();
        wire.sort();
        let mut declared: Vec<String> = manifest()["status"].as_object().unwrap().keys().cloned().collect();
        declared.sort();
        assert_eq!(declared, wire);
    }

    /// Every command an action/file-import field invokes is a registered
    /// command (build.rs `COMMANDS`).
    #[test]
    fn manifest_commands_are_registered() {
        let build_rs = include_str!("../build.rs");
        for field in manifest_fields() {
            if let Some(cmd) = field.get("command").and_then(Value::as_str) {
                assert!(build_rs.contains(&format!("\"{cmd}\"")), "manifest command {cmd} not in build.rs COMMANDS");
            }
        }
    }
}
