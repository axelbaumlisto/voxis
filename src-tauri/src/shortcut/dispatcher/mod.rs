//! Pure action dispatcher for shortcut bindings.
//!
//! Resolves shortcut bindings into executable transcription actions.
//!
//! Translates a binding_id (from the hotkey listener) into a
//! `ResolvedAction` that the orchestrator can execute. Kept as a pure
//! function so the resolution logic is testable without spinning up
//! the full hotkey + orchestrator stack.
//!
//! SOLID:
//!  - SRP: ONLY id\u2192action resolution. Does not start recording, does
//!    not own state, does not talk to the orchestrator.
//!  - DIP: callers depend on the `ResolvedAction` enum, not on internal
//!    `ShortcutBinding` field layout.
//!  - KISS: zero state, zero allocations beyond the prompt_id String
//!    clone.

use super::binding::{find_by_id, ShortcutAction, ShortcutBinding};

/// Concrete instruction the orchestrator should follow. `prompt_id`
/// for `TranscribePostProcess` is already resolved: `None` means
/// "fall back to the currently-active LlmPrompt" (handled in
/// `orchestrator::post_process::resolve_prompt`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolvedAction {
    Transcribe,
    TranscribePostProcess { prompt_id: Option<String> },
}

/// Resolve a binding by id. Returns `None` for unknown ids so the
/// hotkey layer can fall back to the legacy single-hotkey path.
pub fn resolve(bindings: &[ShortcutBinding], binding_id: &str) -> Option<ResolvedAction> {
    let b = find_by_id(bindings, binding_id)?;
    Some(match &b.action {
        ShortcutAction::Transcribe => ResolvedAction::Transcribe,
        ShortcutAction::TranscribePostProcess { prompt_id } => {
            ResolvedAction::TranscribePostProcess {
                prompt_id: prompt_id.clone(),
            }
        }
    })
}

#[cfg(test)]
mod tests;
