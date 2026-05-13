//! Auto-submit: emit Enter / Cmd+Enter / Shift+Enter after typing.
//!
//! Closes #4 from `.pi/plans/handy-recommendations-cloud-only.md`.
//!
//! After a transcription is typed or pasted, the user usually has to
//! reach for the keyboard to send the message (chat clients, Slack,
//! email, AI assistants). This module simulates the appropriate
//! key combo automatically when the user opts in.
//!
//! SOLID:
//!  - SRP: this file owns the enum + the pure dispatch logic. No
//!    persistence, no config reading.
//!  - DIP: the dispatcher takes a `KeyboardEmitter` trait so unit
//!    tests don't actually press keys.
//!  - OCP: new variants append to the enum + match arm; nothing else
//!    changes.
//!  - KISS: zero state, pure functions, no async.
//!
//! Wiring (separate file): `orchestrator::transcription::output`
//! calls `auto_submit::emit(config.auto_submit_key, &real_emitter)`
//! at the end of the output pipeline.
use serde::{Deserialize, Serialize};
use specta::Type;

/// Which key combo to fire after typing. `Off` skips entirely \u2014 this
/// is the safe default for users who don't want their messages
/// auto-sent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, Default)]
#[serde(rename_all = "snake_case")]
pub enum AutoSubmitKey {
    #[default]
    Off,
    Enter,
    CmdEnter,
    ShiftEnter,
}

/// Minimal abstraction over a keyboard backend. Concrete impl uses
/// enigo (already a dep); tests use an in-memory recorder.
pub trait KeyboardEmitter {
    fn press(&self, name: &'static str) -> Result<(), String>;
    fn release(&self, name: &'static str) -> Result<(), String>;
}

/// Emit the configured combo. No-op when `Off`. Errors from the
/// underlying emitter are propagated so the caller can log them.
pub fn emit(key: AutoSubmitKey, emitter: &dyn KeyboardEmitter) -> Result<(), String> {
    let combo: &[&str] = match key {
        AutoSubmitKey::Off => return Ok(()),
        AutoSubmitKey::Enter => &["Enter"],
        AutoSubmitKey::CmdEnter => &["Meta", "Enter"],
        AutoSubmitKey::ShiftEnter => &["Shift", "Enter"],
    };
    // Press in order (modifier first), release in reverse \u2014 the
    // canonical chord shape every keyboard implementation expects.
    for name in combo {
        emitter.press(name)?;
    }
    for name in combo.iter().rev() {
        emitter.release(name)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests;
