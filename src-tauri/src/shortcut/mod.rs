//! Shortcut binding management.
//!
//! Distinct from `crate::hotkey` (low-level OS key listener via rdev):
//! this module owns the *configuration* of which named bindings exist
//! and what each does. The hotkey listener is the transport; this is
//! the schema + dispatch layer.
//!
//! See `binding::ShortcutBinding` for the row shape and
//! `binding::ShortcutAction` for the action enum.

pub mod binding;

pub use binding::{default_bindings, find_by_id, ShortcutAction, ShortcutBinding};
