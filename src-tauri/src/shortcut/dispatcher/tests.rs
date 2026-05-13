use super::*;
use crate::shortcut::binding::{default_bindings, ShortcutAction, ShortcutBinding};

#[test]
fn resolve_default_transcribe_binding() {
    let bindings = default_bindings();
    let action = resolve(&bindings, "transcribe");
    assert_eq!(action, Some(ResolvedAction::Transcribe));
}

#[test]
fn resolve_default_post_process_binding() {
    let bindings = default_bindings();
    let action = resolve(&bindings, "transcribe_post_process");
    assert_eq!(
        action,
        Some(ResolvedAction::TranscribePostProcess { prompt_id: None })
    );
}

#[test]
fn resolve_returns_none_for_unknown_id() {
    let bindings = default_bindings();
    assert!(resolve(&bindings, "definitely_not_a_real_binding").is_none());
}

#[test]
fn resolve_returns_none_for_empty_list() {
    assert!(resolve(&[], "anything").is_none());
}

#[test]
fn resolve_post_process_propagates_prompt_id() {
    // Custom binding with a specific prompt_id pinned (e.g. UI lets
    // user wire AltGr+1 -> email_tone). The dispatcher must hand the
    // exact id through to the orchestrator.
    let bindings = vec![ShortcutBinding {
        id: "email_quick".to_string(),
        name: "Quick email".to_string(),
        description: "".to_string(),
        default_binding: "alt+1".to_string(),
        current_binding: "alt+1".to_string(),
        action: ShortcutAction::TranscribePostProcess {
            prompt_id: Some("email_tone".to_string()),
        },
    }];
    let action = resolve(&bindings, "email_quick");
    assert_eq!(
        action,
        Some(ResolvedAction::TranscribePostProcess {
            prompt_id: Some("email_tone".to_string())
        })
    );
}
