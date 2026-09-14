use super::*;
use crate::storage::test_utils::create_temp_paths;

fn fresh() -> LlmPromptsStorage {
    let (_dir, paths) = create_temp_paths();
    // Keep _dir alive by leaking — these are unit tests, short-lived.
    let _ = Box::leak(Box::new(_dir));
    LlmPromptsStorage::new(paths.prompts_db())
}

#[test]
fn seeds_4_default_prompts_when_empty() {
    let s = fresh();
    s.seed_defaults_if_empty().expect("seed");
    let list = s.list().expect("list");
    assert_eq!(list.len(), 4);
    let ids: Vec<&str> = list.iter().map(|p| p.id.as_str()).collect();
    assert_eq!(
        ids,
        ["fix_grammar", "email_tone", "bullet_list", "summarize"]
    );
}

#[test]
fn seed_is_idempotent() {
    let s = fresh();
    s.seed_defaults_if_empty().expect("seed 1");
    s.seed_defaults_if_empty().expect("seed 2");
    assert_eq!(s.list().expect("list").len(), 4);
}

#[test]
fn create_then_list_returns_new_prompt() {
    let s = fresh();
    s.seed_defaults_if_empty().expect("seed");
    s.create("custom1", "My custom", "Do X to: ${output}")
        .expect("create");
    let list = s.list().expect("list");
    assert_eq!(list.len(), 5);
    let last = list.last().unwrap();
    assert_eq!(last.id, "custom1");
    assert_eq!(last.name, "My custom");
}

#[test]
fn update_modifies_existing_entry() {
    let s = fresh();
    s.seed_defaults_if_empty().expect("seed");
    s.update("fix_grammar", "Fix grammar v2", "New prompt body")
        .expect("update");
    let got = s.get("fix_grammar").expect("get").expect("some");
    assert_eq!(got.name, "Fix grammar v2");
    assert_eq!(got.prompt, "New prompt body");
}

#[test]
fn update_returns_error_for_unknown_id() {
    let s = fresh();
    s.seed_defaults_if_empty().expect("seed");
    let res = s.update("ghost", "x", "y");
    assert!(res.is_err());
}

#[test]
fn delete_removes_entry_and_clears_active_pointer() {
    let s = fresh();
    s.seed_defaults_if_empty().expect("seed");
    s.set_active_id(Some("fix_grammar")).expect("set active");
    s.delete("fix_grammar").expect("delete");
    assert_eq!(s.list().expect("list").len(), 3);
    assert!(s.get("fix_grammar").expect("get").is_none());
    // Active pointer must be cleared (no ghost reference).
    assert!(s.get_active_id().expect("get_active").is_none());
}

#[test]
fn active_id_roundtrip() {
    let s = fresh();
    s.seed_defaults_if_empty().expect("seed");
    assert!(s.get_active_id().expect("initial").is_none());
    s.set_active_id(Some("email_tone")).expect("set");
    assert_eq!(
        s.get_active_id().expect("get"),
        Some("email_tone".to_string())
    );
    s.set_active_id(None).expect("clear");
    assert!(s.get_active_id().expect("after clear").is_none());
}
