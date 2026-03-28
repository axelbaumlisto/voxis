//! Transcription handling facade for the orchestrator.
//!
//! SRP: Public API stays here, implementation details live in
//! `orchestrator/transcription/*` submodules.

mod client;
mod config;
mod context;
mod debug;
mod error;
mod output;
mod pipeline;

pub use client::run_transcription;
pub use config::validate_config;
pub use context::TranscriptionContext;
pub use debug::{save_debug_audio, save_debug_log};
pub use error::{handle_transcription_error, show_idle_overlay};
pub use output::finalize_output;
pub use pipeline::transcribe_and_output;

#[cfg(test)]
mod tests;
