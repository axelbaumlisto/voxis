use super::*;

#[test]
fn default_prompts_has_4_entries() {
    let p = default_prompts();
    assert_eq!(p.len(), 4, "ship with 4 seeded templates");
}

#[test]
fn default_prompts_have_unique_ids() {
    let p = default_prompts();
    let mut ids: Vec<&str> = p.iter().map(|x| x.id.as_str()).collect();
    ids.sort();
    let len_before = ids.len();
    ids.dedup();
    assert_eq!(ids.len(), len_before, "all ids must be unique");
}

#[test]
fn default_prompts_have_stable_ids() {
    // These ids are persisted in user config and referenced from docs.
    // Renaming/removing is a migration, NOT a code edit. Lock the
    // contract here.
    let prompts = default_prompts();
    let ids: Vec<&str> = prompts.iter().map(|p| p.id.as_str()).collect();
    assert_eq!(
        ids,
        ["fix_grammar", "email_tone", "bullet_list", "summarize"]
    );
}

#[test]
fn default_prompts_have_nonempty_name_and_prompt() {
    for p in default_prompts() {
        assert!(!p.name.is_empty(), "name for {} must not be empty", p.id);
        assert!(
            !p.prompt.is_empty(),
            "prompt for {} must not be empty",
            p.id
        );
    }
}

#[test]
fn find_by_id_returns_match() {
    let p = default_prompts();
    let found = find_by_id(&p, "email_tone");
    assert!(found.is_some());
    assert_eq!(found.unwrap().name, "Email tone");
}

#[test]
fn find_by_id_returns_none_for_unknown() {
    let p = default_prompts();
    assert!(find_by_id(&p, "definitely_not_a_real_id").is_none());
}

#[test]
fn serde_roundtrip_preserves_fields() {
    let prompts = default_prompts();
    let json = serde_json::to_string(&prompts).expect("serialize");
    let restored: Vec<LlmPrompt> =
        serde_json::from_str(&json).expect("deserialize");
    assert_eq!(prompts, restored);
}
