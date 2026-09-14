//! Multi-binding shortcut schema — thin re-export shim.
//!
//! Task 1a moved this entire module (pure serde/specta data + defaults, no
//! dispatch/execution logic) into `voxis_core::shortcut::binding` since
//! `AppConfig::shortcut_bindings` (moved to voxis-core in the same task)
//! embeds `ShortcutBinding`. Re-exported here under its original path so
//! every existing `shortcut::binding::…` / `shortcut::ShortcutBinding`
//! reference keeps resolving to the same types. Tests moved with the
//! implementation — see `crates/voxis-core/src/shortcut/binding/tests.rs`.

pub use voxis_core::shortcut::binding::{
    default_bindings, find_by_id, ShortcutAction, ShortcutBinding,
};
