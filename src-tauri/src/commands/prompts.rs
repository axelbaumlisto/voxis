//! Tauri commands for multi-prompt LLM templates (#1 from Handy
//! recommendations).
//!
//! Each command is a single verb (KISS); no `manage_prompts` aggregator.
//! The state pointer (`active_id`) is updated through its own command so
//! the UI can switch templates without touching the list contents.
//!
//! SOLID:
//!  - SRP: each command does one DB op + maps errors.
//!  - DIP: depends on `LlmPromptsStorage`, not on rusqlite primitives.

use crate::llm::prompts::LlmPrompt;
use crate::storage::prompts_sqlite::LlmPromptsStorage;
use crate::storage::AppPaths;
use tauri::State;

fn store(paths: &AppPaths) -> LlmPromptsStorage {
    let s = LlmPromptsStorage::new(paths.prompts_db());
    // Best-effort seed on every call — idempotent and cheap.
    let _ = s.seed_defaults_if_empty();
    s
}

#[tauri::command]
#[specta::specta]
pub fn list_llm_prompts(paths: State<AppPaths>) -> Result<Vec<LlmPrompt>, String> {
    store(&paths).list().map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn create_llm_prompt(
    id: String,
    name: String,
    prompt: String,
    paths: State<AppPaths>,
) -> Result<LlmPrompt, String> {
    store(&paths)
        .create(&id, &name, &prompt)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn update_llm_prompt(
    id: String,
    name: String,
    prompt: String,
    paths: State<AppPaths>,
) -> Result<LlmPrompt, String> {
    store(&paths)
        .update(&id, &name, &prompt)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn delete_llm_prompt(id: String, paths: State<AppPaths>) -> Result<(), String> {
    store(&paths).delete(&id).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn get_active_llm_prompt_id(paths: State<AppPaths>) -> Result<Option<String>, String> {
    store(&paths).get_active_id().map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn set_active_llm_prompt_id(
    id: Option<String>,
    paths: State<AppPaths>,
) -> Result<(), String> {
    store(&paths)
        .set_active_id(id.as_deref())
        .map_err(|e| e.to_string())
}
