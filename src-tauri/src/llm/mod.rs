//! LLM post-processing module for grammar correction and suggestions —
//! thin re-export shim.
//!
//! Task 1a moved `prompts` (pure serde/specta data) into
//! `voxis_core::llm::prompts` since `storage::prompts_sqlite` depends on
//! it — see `prompts/mod.rs`'s own doc comment (unchanged by this step).
//! Task 1b moved the rest of this module (client/config/engine/parser/
//! provider/types — the HTTP-based `LlmProvider` implementation, no
//! Tauri/cpal/rdev) into `voxis_core::llm` too. Re-exported here under the
//! exact original paths so every existing `crate::llm::…` reference
//! (including `crate::llm::parser::…`, `crate::llm::provider::…`) keeps
//! resolving unchanged.

pub mod prompts;

pub use voxis_core::llm::{parser, provider};
pub use voxis_core::llm::{DictionarySuggestion, LlmConfig, LlmResult};
pub use voxis_core::llm::{HttpLlmProvider, LlmProvider};
