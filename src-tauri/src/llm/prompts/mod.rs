//! Multi-prompt LLM template registry — thin re-export shim.
//!
//! Task 1a moved this entire module (pure serde/specta data + defaults, no
//! HTTP/storage I/O) into `voxis_core::llm::prompts` since
//! `storage::prompts_sqlite` (also moved to voxis-core in the same task)
//! depends on `LlmPrompt` / `default_prompts`. Re-exported here under its
//! original path so every existing `llm::prompts::…` reference keeps
//! resolving to the same types. Tests moved with the implementation — see
//! `crates/voxis-core/src/llm/prompts/tests.rs`.

pub use voxis_core::llm::prompts::{default_prompts, find_by_id, LlmPrompt};
