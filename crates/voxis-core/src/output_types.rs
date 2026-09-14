//! Pure data type shared with `voice_lib::output::auto_submit`.
//!
//! Split out of `voice_lib::output::auto_submit` in Task 1a: `AppConfig`
//! (moved to `crate::config`) embeds this enum, but the enigo-backed
//! dispatch logic (`emit`, `KeyboardEmitter`, `EnigoEmitter`) stays in
//! voice_lib since voxis-core must not depend on enigo. `voice_lib`
//! re-exports this exact type as `output::auto_submit::AutoSubmitKey` so
//! every existing path keeps resolving.

use serde::{Deserialize, Serialize};
use specta::Type;

/// Which key combo to fire after typing. `Off` skips entirely — this
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_value_is_off() {
        // Locks the default so silent-by-default privacy is preserved
        // when a fresh config rolls out.
        assert_eq!(AutoSubmitKey::default(), AutoSubmitKey::Off);
    }

    #[test]
    fn serde_roundtrip_uses_snake_case() {
        // Stable string form for the SQLite kv table.
        let json = serde_json::to_string(&AutoSubmitKey::CmdEnter).unwrap();
        assert_eq!(json, "\"cmd_enter\"");
        let back: AutoSubmitKey = serde_json::from_str(&json).unwrap();
        assert_eq!(back, AutoSubmitKey::CmdEnter);
    }
}
