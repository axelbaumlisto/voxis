//! Pure shortcut-binding data types shared with voice_lib.
//!
//! Only `binding` (schema + defaults — pure serde/specta data, no
//! dispatch/execution logic) lives here today. `voice_lib::shortcut::dispatcher`
//! stays in voice_lib.

pub mod binding;
