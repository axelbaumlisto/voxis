//! LLM post-processing module for grammar correction and suggestions.
//!
//! Processes transcribed text through LLM to:
//! 1. Fix grammar and punctuation
//! 2. Extract dictionary suggestions for tech terms
//!
//! Returns structured result with corrected text and suggestions.
//!
//! Architecture (KISS pipeline):
//! - types.rs: DictionarySuggestion, LlmResult types
//! - config.rs: LlmConfig struct
//! - client.rs: Shared HTTP request/response DTOs
//! - engine.rs: Pipeline orchestration + request execution
//! - parser.rs: JSON parsing strategies + result parsing facade
//! - processor.rs: LlmProcessor facade

mod client;
mod config;
mod engine;
mod parser;
mod processor;
mod types;

pub use config::LlmConfig;
pub use processor::LlmProcessor;
pub use types::{DictionarySuggestion, LlmResult};
