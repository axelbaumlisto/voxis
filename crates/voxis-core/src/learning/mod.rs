//! Learning module for dictionary self-learning.
//!
//! Architecture (SRP - Round 8):
//! - mode.rs: LearningMode enum (disabled/pending/auto)
//! - result.rs: SuggestionResult enum
//! - tracker.rs: CorrectionTracker coordinator
//! - normalizer.rs: SuggestionNormalizer with TERM_MAPPINGS
//!
//! Modes:
//! - disabled: No learning, suggestions are ignored
//! - pending: Suggestions are stored but require manual approval
//! - auto: Suggestions are automatically added to dictionary after threshold
//!
//! Task 1b moved this module here from `voice_lib::learning` (mechanical
//! extraction — depends only on `crate::llm::DictionarySuggestion` and
//! `crate::storage`'s traits, both already in this crate). `voice_lib`
//! re-exports every public item under its original path.

mod mode;
mod normalizer;
mod result;
mod tracker;

pub use mode::LearningMode;
pub use normalizer::SuggestionNormalizer;
pub use result::SuggestionResult;
pub use tracker::CorrectionTracker;
