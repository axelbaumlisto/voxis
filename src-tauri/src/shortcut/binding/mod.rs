//! Multi-binding shortcut schema.
//!
//! Closes #2 from `.pi/plans/handy-recommendations-cloud-only.md`.
//!
//! Pre-Phase-B/2 we had ONE global hotkey (`AppConfig.hotkey`) that
//! always triggered the same action: record + transcribe + paste. This
//! module introduces multiple named bindings so each can fire a
//! different `ShortcutAction` (raw transcribe, or transcribe + LLM
//! post-process with a specific prompt id).
//!
//! SOLID:
//!  - SRP: schema + defaults + per-action enum + JSON serde. NO
//!    storage I/O, NO hotkey registration, NO action execution.
//!  - OCP: new action variants append to `ShortcutAction`. Adding a
//!    new prompt-bound binding is a config-row append, not code.
//!  - DIP: dispatcher (T-B2.3) depends on the trait + enum here, not
//!    on a concrete hotkey backend.

use serde::{Deserialize, Serialize};
use specta::Type;

/// What the orchestrator should do when this binding fires.
///
/// `Transcribe` is the legacy behaviour: record, transcribe, paste.
/// `TranscribePostProcess { prompt_id }` adds LLM post-processing
/// using the prompt with the given id (resolved against
/// `LlmPromptsStorage` at dispatch time \u2014 see T-A1.4). A `None`
/// prompt_id means "use the currently-active prompt" (UI default).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type, Default)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ShortcutAction {
    #[default]
    Transcribe,
    TranscribePostProcess {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        prompt_id: Option<String>,
    },
}

/// One configurable hotkey row. `id` is a stable string key (locked by
/// the `stable_ids` test); `current_binding` is what the listener
/// registers. `default_binding` is shown next to a "reset" button in
/// the UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ShortcutBinding {
    pub id: String,
    pub name: String,
    pub description: String,
    pub default_binding: String,
    pub current_binding: String,
    #[serde(default)]
    pub action: ShortcutAction,
}

/// Seeded list of bindings on a fresh install. Each entry MUST keep
/// its `id` forever \u2014 they're persisted in user config. Renaming or
/// dropping an existing id is a migration, NOT a code edit.
pub fn default_bindings() -> Vec<ShortcutBinding> {
    vec![
        ShortcutBinding {
            id: "transcribe".to_string(),
            name: "Transcribe".to_string(),
            description: "Record and paste the raw transcription".to_string(),
            default_binding: "alt_r".to_string(),
            current_binding: "alt_r".to_string(),
            action: ShortcutAction::Transcribe,
        },
        ShortcutBinding {
            id: "transcribe_post_process".to_string(),
            name: "Transcribe + LLM post-process".to_string(),
            description:
                "Record, transcribe, then run the LLM on the result using the active prompt"
                    .to_string(),
            default_binding: "ctrl+alt_r".to_string(),
            current_binding: "ctrl+alt_r".to_string(),
            action: ShortcutAction::TranscribePostProcess { prompt_id: None },
        },
    ]
}

/// Look up a binding by its stable id.
pub fn find_by_id<'a>(list: &'a [ShortcutBinding], id: &str) -> Option<&'a ShortcutBinding> {
    list.iter().find(|b| b.id == id)
}

#[cfg(test)]
mod tests;
