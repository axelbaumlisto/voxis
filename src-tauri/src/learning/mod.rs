//! Learning module for dictionary self-learning — thin re-export shim.
//!
//! Task 1b moved the whole module (mode/result/tracker/normalizer) into
//! `voxis_core::learning` (pure Rust: uses `voxis_core::llm::
//! DictionarySuggestion` and `voxis_core::storage`'s traits, no Tauri/
//! cpal/rdev). Re-exported here under the exact original paths so every
//! existing `crate::learning::…` reference keeps resolving unchanged.
//!
//! Modes:
//! - disabled: No learning, suggestions are ignored
//! - pending: Suggestions are stored but require manual approval
//! - auto: Suggestions are automatically added to dictionary after threshold

pub use voxis_core::learning::{CorrectionTracker, LearningMode, SuggestionNormalizer};
pub use voxis_core::learning::SuggestionResult;
