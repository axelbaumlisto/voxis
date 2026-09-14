//! Transcription module for Groq Whisper API — thin re-export shim.
//!
//! Task 1b moved the whole module (HTTP client, error types, size-limit
//! predicate) into `voxis_core::transcription` (pure Rust: reqwest/
//! rustls-tls, no Tauri/cpal/rdev — see that module's own doc comment).
//! Re-exported here under the exact original paths, including the two
//! items that were `pub(crate)` before the move (`MAX_AUDIO_BYTES`,
//! `exceeds_size_limit`) — now `pub` in `voxis_core::transcription` since
//! they cross a crate boundary, but re-exported as `pub(crate)` here so
//! `voice_lib`'s own crate-internal-only visibility is unchanged from
//! every existing call site's perspective (`orchestrator::transcription::
//! pipeline`, `commands::recording`).

pub(crate) use voxis_core::transcription::{exceeds_size_limit, MAX_AUDIO_BYTES};
pub use voxis_core::transcription::{TranscriptionClient, TranscriptionError, TranscriptionResult};
