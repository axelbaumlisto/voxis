//! Configuration module for Voice app — thin re-export shim.
//!
//! Task 1a moved `AppConfig` + nested config structs + constants +
//! validation into `voxis_core::config` (mechanical extraction, pure Rust,
//! no Tauri deps — see `crates/voxis-core/src/config/mod.rs`). This module
//! re-exports the exact same types so every existing `crate::config::…`
//! path keeps resolving unchanged.
//!
//! `change_handler` stays here: it is Tauri-state coupled (`AppHandle`,
//! `HotkeyState`, `OrchestratorState`).

mod change_handler;

pub use change_handler::{
    apply_config_changes, ConfigChangeHandler, HotkeyChangeHandler, OverlayChangeHandler,
};
pub use voxis_core::config::*;
