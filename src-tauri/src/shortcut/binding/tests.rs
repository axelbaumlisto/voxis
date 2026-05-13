use super::*;

#[test]
fn defaults_have_two_entries() {
    assert_eq!(default_bindings().len(), 2);
}

#[test]
fn defaults_have_unique_ids() {
    let bindings = default_bindings();
    let mut ids: Vec<&str> = bindings.iter().map(|b| b.id.as_str()).collect();
    ids.sort();
    let len_before = ids.len();
    ids.dedup();
    assert_eq!(ids.len(), len_before);
}

#[test]
fn defaults_have_stable_ids() {
    // These ids are persisted in user config. Renaming/removing is a
    // migration, NOT a code edit. Lock the contract here.
    let bindings = default_bindings();
    let ids: Vec<&str> = bindings.iter().map(|b| b.id.as_str()).collect();
    assert_eq!(ids, ["transcribe", "transcribe_post_process"]);
}

#[test]
fn default_action_is_transcribe() {
    // Locks the no-arg default \u2014 the safest behavior for a fresh
    // binding row created via UI.
    assert_eq!(ShortcutAction::default(), ShortcutAction::Transcribe);
}

#[test]
fn find_by_id_returns_match() {
    let bindings = default_bindings();
    let found = find_by_id(&bindings, "transcribe_post_process");
    assert!(found.is_some());
    assert_eq!(found.unwrap().name, "Transcribe + LLM post-process");
}

#[test]
fn find_by_id_returns_none_for_unknown() {
    assert!(find_by_id(&default_bindings(), "does_not_exist").is_none());
}

#[test]
fn shortcut_action_serializes_with_kind_tag() {
    // Tagged serialization makes the JSON stable when new variants
    // are added (no positional surprises).
    let raw = ShortcutAction::Transcribe;
    assert_eq!(serde_json::to_string(&raw).unwrap(), r#"{"kind":"transcribe"}"#);
    let pp = ShortcutAction::TranscribePostProcess { prompt_id: None };
    assert_eq!(
        serde_json::to_string(&pp).unwrap(),
        r#"{"kind":"transcribe_post_process"}"#
    );
    let pp_with = ShortcutAction::TranscribePostProcess {
        prompt_id: Some("email_tone".to_string()),
    };
    assert_eq!(
        serde_json::to_string(&pp_with).unwrap(),
        r#"{"kind":"transcribe_post_process","prompt_id":"email_tone"}"#
    );
}

#[test]
fn shortcut_binding_serde_roundtrip() {
    let bindings = default_bindings();
    let json = serde_json::to_string(&bindings).unwrap();
    let restored: Vec<ShortcutBinding> = serde_json::from_str(&json).unwrap();
    assert_eq!(bindings, restored);
}
