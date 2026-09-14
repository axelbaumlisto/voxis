//! Integration tests for `VoxisProfile`: building from storage, applying
//! back to storage, sealing/opening for transport, version handling, and
//! the `Secret` redaction contract. Crypto-primitive-level tests (KDF/AEAD
//! edge cases) live in `crypto::tests`; these exercise the whole
//! `from_storage` \u2192 `seal` \u2192 `open` \u2192 `apply_to` pipeline against real
//! (tempdir) SQLite/file storage.

use std::collections::HashMap;

use crate::llm::prompts::LlmPrompt;
use crate::storage::traits::StorageResult;
use crate::storage::{prompts_sqlite::LlmPromptsStorage, test_utils, LlmModel, LlmProvider, StorageFactory};

use super::*;

/// A full storage stack in a tempdir, matching what `voice_lib` wires up
/// for real (`StorageFactory` + the one storage it doesn't own yet,
/// `LlmPromptsStorage`).
struct TestStorage {
    _temp: tempfile::TempDir,
    factory: StorageFactory,
    prompts: LlmPromptsStorage,
}

fn test_storage() -> TestStorage {
    let (temp, paths) = test_utils::create_temp_paths();
    let factory = StorageFactory::new(paths.clone());
    let prompts = LlmPromptsStorage::new(paths.prompts_db());
    TestStorage {
        _temp: temp,
        factory,
        prompts,
    }
}

/// In-memory `SecretSink` test double \u2014 records what `apply_to` routed to
/// it instead of writing to any real keychain/keyring.
#[derive(Default)]
struct MockSecretSink {
    stored: HashMap<String, String>,
}

impl SecretSink for MockSecretSink {
    fn put(&mut self, name: &str, value: &Secret) -> StorageResult<()> {
        self.stored.insert(name.to_string(), value.expose().to_string());
        Ok(())
    }
}

fn sample_provider(id: &str) -> LlmProvider {
    LlmProvider {
        id: id.to_string(),
        name: format!("Provider {id}"),
        api_url: "https://example.test/v1".to_string(),
        models: vec![LlmModel {
            id: "model-a".to_string(),
            name: "Model A".to_string(),
        }],
        default_model: "model-a".to_string(),
        builtin: false,
    }
}

fn sample_prompt(id: &str) -> LlmPrompt {
    LlmPrompt {
        id: id.to_string(),
        name: format!("Prompt {id}"),
        prompt: format!("Do the {id} thing"),
    }
}

// ===========================================================================
// from_storage
// ===========================================================================

#[test]
fn from_storage_builds_expected_profile_and_secrets() {
    let ts = test_storage();
    let config_storage = ts.factory.config();
    let mut app_config = config_storage.load().unwrap();
    app_config.api_key = "sk-real-transcription-key".to_string();
    app_config.model = "whisper-large-v3".to_string();
    app_config.cloud_provider = "groq".to_string();
    app_config.language = "ru".to_string();
    app_config.translate_to_english = true;
    app_config.hotkey = "alt_r".to_string();
    app_config.overlay.theme = "waveform".to_string();
    app_config.llm.enabled = true;
    app_config.llm.api_key = "sk-real-llm-key".to_string();
    config_storage.save(&app_config).unwrap();

    ts.factory.dictionary().add("солид", "SOLID").unwrap();
    ts.factory
        .providers()
        .add(&sample_provider("custom-1"))
        .unwrap();
    ts.prompts.create("p1", "Prompt 1", "Do the thing").unwrap();
    ts.prompts.set_active_id(Some("p1")).unwrap();

    let (profile, secrets) = VoxisProfile::from_storage(
        &ts.factory.config(),
        &ts.factory.dictionary(),
        &ts.factory.providers(),
        &ts.prompts,
    )
    .unwrap();

    assert_eq!(profile.version, VoxisProfile::CURRENT_VERSION);
    assert_eq!(profile.config.model, "whisper-large-v3");
    assert_eq!(profile.config.provider, "groq");
    assert_eq!(profile.config.language, "ru");
    assert!(profile.config.translate_to_english);
    assert_eq!(profile.config.api_key_ref.as_deref(), Some(API_KEY_SECRET_NAME));
    assert_eq!(
        profile.config.llm_api_key_ref.as_deref(),
        Some(LLM_API_KEY_SECRET_NAME)
    );
    assert!(profile.config.llm_enabled);
    assert_eq!(profile.hotkey, "alt_r");
    assert_eq!(profile.theme, "waveform");
    assert!(profile
        .dictionary
        .iter()
        .any(|(s, r)| s == "солид" && r == "SOLID"));
    assert!(profile.llm.providers.iter().any(|p| p.id == "custom-1"));
    assert_eq!(profile.llm.active_prompt_id.as_deref(), Some("p1"));
    assert!(profile.llm.prompts.iter().any(|p| p.id == "p1"));

    assert_eq!(secrets.api_key.as_ref().unwrap().expose(), "sk-real-transcription-key");
    assert_eq!(secrets.llm_api_key.as_ref().unwrap().expose(), "sk-real-llm-key");

    // `ProfileConfig`/`VoxisProfile` never carry the raw key.
    let json = serde_json::to_string(&profile).unwrap();
    assert!(!json.contains("sk-real-transcription-key"));
    assert!(!json.contains("sk-real-llm-key"));
}

#[test]
fn from_storage_excludes_history() {
    let ts = test_storage();
    // A history row exists in the same config-dir the profile is built
    // from \u2014 `from_storage`'s signature has no history parameter at all,
    // so this asserts the field-level guarantee end to end: nothing about
    // the history entry appears anywhere in the resulting JSON.
    ts.factory
        .history()
        .add("this transcription must not leak into the profile", Some("en"), Some(3.5))
        .unwrap();

    let (profile, _secrets) = VoxisProfile::from_storage(
        &ts.factory.config(),
        &ts.factory.dictionary(),
        &ts.factory.providers(),
        &ts.prompts,
    )
    .unwrap();

    let json = serde_json::to_string(&profile).unwrap();
    assert!(!json.to_lowercase().contains("history"));
    assert!(!json.contains("this transcription must not leak into the profile"));
}

// ===========================================================================
// apply_to
// ===========================================================================

fn minimal_profile() -> VoxisProfile {
    VoxisProfile {
        version: VoxisProfile::CURRENT_VERSION,
        config: ProfileConfig {
            provider: "groq".to_string(),
            model: "whisper-large-v3".to_string(),
            api_key_ref: Some(API_KEY_SECRET_NAME.to_string()),
            api_url_override: None,
            language: "en".to_string(),
            translate_to_english: false,
            min_recording_ms: 300,
            silence_timeout_ms: 60_000,
            max_recording_ms: 600_000,
            hotkey_hold_ms: 300,
            llm_enabled: false,
            llm_provider: "groq".to_string(),
            llm_api_url: "https://api.groq.com/openai/v1/chat/completions".to_string(),
            llm_api_key_ref: Some(LLM_API_KEY_SECRET_NAME.to_string()),
            llm_model: "llama-3.1-8b-instant".to_string(),
            llm_prompt: "fix grammar".to_string(),
        },
        dictionary: vec![("солид".to_string(), "SOLID".to_string())],
        llm: LlmProfile {
            providers: vec![sample_provider("imported-provider")],
            prompts: vec![sample_prompt("imported")],
            active_prompt_id: Some("imported".to_string()),
        },
        theme: "waveform".to_string(),
        hotkey: "alt_r".to_string(),
    }
}

fn minimal_secrets() -> ProfileSecrets {
    ProfileSecrets {
        api_key: Some(Secret::new("sk-imported-transcription-key")),
        llm_api_key: Some(Secret::new("sk-imported-llm-key")),
    }
}

#[test]
fn apply_to_routes_secrets_to_sink_not_storage() {
    let ts = test_storage();
    let profile = minimal_profile();
    let secrets = minimal_secrets();
    let mut sink = MockSecretSink::default();

    profile
        .apply_to(
            &secrets,
            &ts.factory.config(),
            &ts.factory.dictionary(),
            &ts.factory.providers(),
            &ts.prompts,
            &mut sink,
        )
        .unwrap();

    let stored_config = ts.factory.config().load().unwrap();
    assert!(stored_config.api_key.is_empty(), "api_key must never reach sqlite");
    assert!(
        stored_config.llm.api_key.is_empty(),
        "llm.api_key must never reach sqlite"
    );
    assert_eq!(stored_config.model, "whisper-large-v3");
    assert_eq!(stored_config.hotkey, "alt_r");
    assert_eq!(stored_config.overlay.theme, "waveform");

    assert_eq!(
        sink.stored.get(API_KEY_SECRET_NAME).map(String::as_str),
        Some("sk-imported-transcription-key")
    );
    assert_eq!(
        sink.stored.get(LLM_API_KEY_SECRET_NAME).map(String::as_str),
        Some("sk-imported-llm-key")
    );

    // Grep-style assertion mirroring the plan's own acceptance phrasing:
    // no `sk-` value ever reached the config database file's serialized
    // form.
    let db_bytes = std::fs::read(ts.factory.paths().config_db()).unwrap();
    let db_text = String::from_utf8_lossy(&db_bytes);
    assert!(!db_text.contains("sk-imported-transcription-key"));
    assert!(!db_text.contains("sk-imported-llm-key"));
}

#[test]
fn apply_to_syncs_dictionary_providers_and_prompts() {
    let ts = test_storage();
    // Pre-existing state that the profile should replace.
    ts.factory.dictionary().add("stale", "entry").unwrap();
    ts.factory
        .providers()
        .add(&sample_provider("stale-provider"))
        .unwrap();
    ts.prompts.create("stale-prompt", "Stale", "stale").unwrap();

    let profile = minimal_profile();
    let secrets = minimal_secrets();
    let mut sink = MockSecretSink::default();
    profile
        .apply_to(
            &secrets,
            &ts.factory.config(),
            &ts.factory.dictionary(),
            &ts.factory.providers(),
            &ts.prompts,
            &mut sink,
        )
        .unwrap();

    let dictionary = ts.factory.dictionary().load().unwrap();
    assert_eq!(dictionary, vec![("солид".to_string(), "SOLID".to_string())]);

    let providers = ts.factory.providers().get_all().unwrap();
    assert!(providers.iter().any(|p| p.id == "imported-provider"));
    assert!(!providers.iter().any(|p| p.id == "stale-provider"));

    let prompts = ts.prompts.list().unwrap();
    assert!(prompts.iter().any(|p| p.id == "imported"));
    assert!(!prompts.iter().any(|p| p.id == "stale-prompt"));
    assert_eq!(ts.prompts.get_active_id().unwrap().as_deref(), Some("imported"));
}

#[test]
fn apply_to_does_not_rewrite_local_builtin_provider_from_profile() {
    let ts = test_storage();
    // "groq" is a builtin, seeded automatically on first `connect()`
    // (`storage::providers::builtin::default_providers`).
    let seeded = ts.factory.providers().get_all().unwrap();
    let local_groq = seeded.iter().find(|p| p.id == "groq").unwrap().clone();
    assert!(local_groq.builtin);

    let mut profile = minimal_profile();
    // A profile claiming to carry an updated "groq" with a different
    // (attacker- or stale-desktop-controlled) api_url must not be able to
    // rewrite the locally seeded builtin's configuration.
    let mut spoofed_groq = local_groq.clone();
    spoofed_groq.api_url = "https://evil.example/v1/chat/completions".to_string();
    profile.llm.providers.push(spoofed_groq);

    let secrets = minimal_secrets();
    let mut sink = MockSecretSink::default();
    profile
        .apply_to(
            &secrets,
            &ts.factory.config(),
            &ts.factory.dictionary(),
            &ts.factory.providers(),
            &ts.prompts,
            &mut sink,
        )
        .unwrap();

    let after = ts.factory.providers().get_all().unwrap();
    let stored_groq = after.iter().find(|p| p.id == "groq").unwrap();
    assert_eq!(
        stored_groq.api_url, local_groq.api_url,
        "local builtin provider's api_url must survive a profile apply unchanged"
    );
    assert!(stored_groq.builtin, "builtin flag must be preserved");
}

#[test]
fn apply_to_never_plants_an_unremovable_builtin_provider() {
    let ts = test_storage();
    let mut profile = minimal_profile();
    // A profile can claim `builtin: true` for a brand-new id that was
    // never actually seeded locally; `apply_to` must not honour that flag
    // (a real builtin can never be removed via `ProvidersStorage::remove`,
    // so trusting the incoming flag would plant a provider the user can
    // never delete again).
    let mut sneaky = sample_provider("sneaky");
    sneaky.builtin = true;
    profile.llm.providers.push(sneaky);

    let secrets = minimal_secrets();
    let mut sink = MockSecretSink::default();
    profile
        .apply_to(
            &secrets,
            &ts.factory.config(),
            &ts.factory.dictionary(),
            &ts.factory.providers(),
            &ts.prompts,
            &mut sink,
        )
        .unwrap();

    let after = ts.factory.providers().get_all().unwrap();
    let stored_sneaky = after.iter().find(|p| p.id == "sneaky").unwrap();
    assert!(
        !stored_sneaky.builtin,
        "a newly-added provider from a profile must never be stored as builtin"
    );
    // And, as a consequence (unlike a real builtin), it must actually be
    // removable through the concrete storage's own `remove`.
    let removed = ts.factory.providers().remove("sneaky");
    assert!(
        removed.is_ok(),
        "a non-builtin provider planted by a profile must be removable"
    );
}

#[test]
fn apply_to_validation_failure_leaves_storage_untouched() {
    let ts = test_storage();
    let before = ts.factory.config().load().unwrap();
    ts.factory.dictionary().add("kept", "asis").unwrap();
    let dictionary_before = ts.factory.dictionary().load().unwrap();

    let mut profile = minimal_profile();
    profile.config.language = "not-a-real-language".to_string();
    let secrets = minimal_secrets();
    let mut sink = MockSecretSink::default();

    let result = profile.apply_to(
        &secrets,
        &ts.factory.config(),
        &ts.factory.dictionary(),
        &ts.factory.providers(),
        &ts.prompts,
        &mut sink,
    );

    assert!(matches!(result, Err(ProfileError::Validation(_))));
    let after = ts.factory.config().load().unwrap();
    assert_eq!(before, after, "config must be untouched on validation failure");
    assert_eq!(
        ts.factory.dictionary().load().unwrap(),
        dictionary_before,
        "dictionary must be untouched on validation failure"
    );
    assert!(sink.stored.is_empty(), "no secret must be written on validation failure");
}

// ===========================================================================
// Secret redaction
// ===========================================================================

#[test]
fn profile_secrets_debug_redacts_key_material() {
    let secrets = ProfileSecrets {
        api_key: Some(Secret::new("sk-do-not-leak-me")),
        llm_api_key: Some(Secret::new("sk-also-do-not-leak-me")),
    };
    let debug = format!("{:?}", secrets);
    assert!(!debug.contains("sk-do-not-leak-me"));
    assert!(!debug.contains("sk-also-do-not-leak-me"));
}

// ===========================================================================
// seal / open
// ===========================================================================

fn qr_key_source() -> KeySource {
    KeySource::Qr {
        k_qr: [42u8; 32],
        code: "654321".to_string(),
    }
}

#[test]
fn seal_open_round_trip_qr() {
    let profile = minimal_profile();
    let secrets = minimal_secrets();
    let key_source = qr_key_source();

    let sealed = seal(&profile, &secrets, &key_source).unwrap();
    let (opened_profile, opened_secrets) = open(&sealed, &key_source).unwrap();

    assert_eq!(opened_profile, profile);
    assert_eq!(
        opened_secrets.api_key.as_ref().unwrap().expose(),
        secrets.api_key.as_ref().unwrap().expose()
    );
    assert_eq!(
        opened_secrets.llm_api_key.as_ref().unwrap().expose(),
        secrets.llm_api_key.as_ref().unwrap().expose()
    );
}

#[test]
fn seal_open_round_trip_passphrase() {
    let profile = minimal_profile();
    let secrets = minimal_secrets();
    let key_source = KeySource::Passphrase("correct horse battery staple".to_string());

    let sealed = seal(&profile, &secrets, &key_source).unwrap();
    let (opened_profile, opened_secrets) = open(&sealed, &key_source).unwrap();

    assert_eq!(opened_profile, profile);
    assert_eq!(
        opened_secrets.api_key.as_ref().unwrap().expose(),
        secrets.api_key.as_ref().unwrap().expose()
    );
}

#[test]
fn open_with_wrong_code_fails_without_panicking() {
    let profile = minimal_profile();
    let secrets = minimal_secrets();
    let sealed = seal(&profile, &secrets, &qr_key_source()).unwrap();

    let wrong = KeySource::Qr {
        k_qr: [42u8; 32],
        code: "000000".to_string(),
    };
    assert!(open(&sealed, &wrong).is_err());
}

#[test]
fn open_with_tampered_byte_fails_without_panicking() {
    let profile = minimal_profile();
    let secrets = minimal_secrets();
    let mut sealed = seal(&profile, &secrets, &qr_key_source()).unwrap();
    let mid = sealed.len() / 2;
    sealed[mid] ^= 0xFF;
    assert!(open(&sealed, &qr_key_source()).is_err());
}

#[test]
fn open_rejects_unsupported_version_explicitly() {
    let mut profile = minimal_profile();
    profile.version = 2;
    let secrets = minimal_secrets();
    let key_source = qr_key_source();
    let sealed = seal(&profile, &secrets, &key_source).unwrap();

    let err = open(&sealed, &key_source).unwrap_err();
    match err {
        ProfileError::UnsupportedVersion { found } => assert_eq!(found, 2),
        other => panic!("expected UnsupportedVersion(2), got {other:?}"),
    }
    assert!(err.to_string().contains('2'));
}

#[test]
fn check_version_rejects_version_two_by_name() {
    let mut profile = minimal_profile();
    profile.version = 2;
    let err = profile.check_version().unwrap_err();
    assert!(err.to_string().contains("version 2"));
}

// ===========================================================================
// Contract fixture (`contract/fixtures/profile-v1.json`)
// ===========================================================================

#[test]
fn fixture_profile_v1_deserializes_and_is_version_1() {
    let fixture = include_str!(
        "../../../tauri-plugin-voxis/contract/fixtures/profile-v1.json"
    );
    let profile: VoxisProfile = serde_json::from_str(fixture).expect("fixture must deserialize");
    profile.check_version().expect("fixture must be version 1");
    assert!(!profile.config.provider.is_empty());
    assert!(profile.config.api_key_ref.is_some(), "fixture must use a ref, not a raw key");
    assert!(profile.config.llm_api_key_ref.is_some());
    // Synthetic values only \u2014 no secret-shaped content anywhere in the file.
    assert!(!fixture.contains("sk-"));
}

#[test]
fn unknown_fields_are_ignored_forward_compat() {
    let fixture = include_str!(
        "../../../tauri-plugin-voxis/contract/fixtures/profile-v1.json"
    );
    let mut value: serde_json::Value = serde_json::from_str(fixture).unwrap();
    value["totallyNewFieldFromTheFuture"] = serde_json::json!("ignore me");
    let json = serde_json::to_string(&value).unwrap();
    let profile: VoxisProfile = serde_json::from_str(&json).expect("unknown fields must be ignored");
    profile.check_version().unwrap();
}
