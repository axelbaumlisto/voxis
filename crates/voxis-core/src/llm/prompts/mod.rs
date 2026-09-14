//! Multi-prompt LLM template registry.
//!
//! Builtin prompt templates for LLM post-processing.
//!
//! Until now the LLM post-processor read a single `llm.prompt` string
//! from config — to switch from "fix grammar" to "bullet list" the user
//! had to manually re-type the prompt. This module introduces a
//! versioned, addressable list of prompts with stable string ids so the
//! UI can present a switcher and back-end can resolve the active
//! prompt at request time.
//!
//! SOLID:
//!  - SRP: this file owns ONLY the schema + defaults + resolver. No
//!    storage I/O, no Tauri commands.
//!  - OCP: extension by appending to `default_prompts()` or via SQLite
//!    rows — never by editing the resolver.
//!  - DIP: callers depend on the `&[LlmPrompt]` slice, not on a
//!    concrete database.

use serde::{Deserialize, Serialize};
use specta::Type;

/// A single named LLM prompt template. `id` is the stable string key
/// used by the rest of the system (config selection, SQLite primary
/// key). `name` is the human-readable label rendered in the UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct LlmPrompt {
    pub id: String,
    pub name: String,
    pub prompt: String,
}

/// The seeded list of templates a fresh install ships with. Each entry
/// MUST keep its `id` stable forever — they are persisted in user
/// config and referenced from telemetry / docs. New entries append at
/// the bottom; deletions go through a migration, not a code edit.
pub fn default_prompts() -> Vec<LlmPrompt> {
    vec![
        LlmPrompt {
            id: "fix_grammar".to_string(),
            name: "Fix grammar".to_string(),
            prompt:
                "Fix grammar and punctuation in transcribed speech. \
                 Return ONLY the corrected text, no commentary."
                    .to_string(),
        },
        LlmPrompt {
            id: "email_tone".to_string(),
            name: "Email tone".to_string(),
            prompt:
                "Rewrite the transcribed speech as a polite professional email body. \
                 Preserve the user's intent. Return ONLY the rewritten text."
                    .to_string(),
        },
        LlmPrompt {
            id: "bullet_list".to_string(),
            name: "Bullet list".to_string(),
            prompt:
                "Turn the transcribed speech into a concise bullet list \
                 (one '- ' per point). Preserve the order. Return ONLY the list."
                    .to_string(),
        },
        LlmPrompt {
            id: "summarize".to_string(),
            name: "Summarize".to_string(),
            prompt:
                "Summarize the transcribed speech in 1–3 sentences. \
                 Return ONLY the summary."
                    .to_string(),
        },
    ]
}

/// Look up a prompt by its stable string id. Returns `None` if no
/// entry matches — caller decides whether to fall back to the legacy
/// `llm.prompt` string or to a default.
pub fn find_by_id<'a>(list: &'a [LlmPrompt], id: &str) -> Option<&'a LlmPrompt> {
    list.iter().find(|p| p.id == id)
}

#[cfg(test)]
mod tests;
