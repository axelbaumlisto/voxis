//! Pure LLM data types shared with voice_lib.
//!
//! Only `prompts` (multi-prompt template schema — pure serde/specta data,
//! no HTTP client) lives here today. The rest of `voice_lib::llm` (HTTP
//! client, provider trait, parsing) stays in voice_lib until Task 1b.

pub mod prompts;
