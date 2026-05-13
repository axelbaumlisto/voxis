use super::*;
use std::cell::RefCell;

/// In-memory emitter that records every press/release in order.
/// Tests assert against this transcript.
struct Recorder {
    calls: RefCell<Vec<String>>,
}

impl Recorder {
    fn new() -> Self {
        Self {
            calls: RefCell::new(Vec::new()),
        }
    }
    fn transcript(&self) -> Vec<String> {
        self.calls.borrow().clone()
    }
}

impl KeyboardEmitter for Recorder {
    fn press(&self, name: &'static str) -> Result<(), String> {
        self.calls.borrow_mut().push(format!("press:{name}"));
        Ok(())
    }
    fn release(&self, name: &'static str) -> Result<(), String> {
        self.calls.borrow_mut().push(format!("release:{name}"));
        Ok(())
    }
}

#[test]
fn off_emits_no_keystrokes() {
    let rec = Recorder::new();
    emit(AutoSubmitKey::Off, &rec).unwrap();
    assert!(rec.transcript().is_empty());
}

#[test]
fn enter_emits_press_then_release() {
    let rec = Recorder::new();
    emit(AutoSubmitKey::Enter, &rec).unwrap();
    assert_eq!(rec.transcript(), ["press:Enter", "release:Enter"]);
}

#[test]
fn cmd_enter_emits_chord_in_canonical_order() {
    // Modifier presses BEFORE the key, releases AFTER \u2014 every
    // keyboard library expects this shape. Wrong order = lost
    // modifier on some platforms.
    let rec = Recorder::new();
    emit(AutoSubmitKey::CmdEnter, &rec).unwrap();
    assert_eq!(
        rec.transcript(),
        ["press:Meta", "press:Enter", "release:Enter", "release:Meta"]
    );
}

#[test]
fn shift_enter_emits_chord_in_canonical_order() {
    let rec = Recorder::new();
    emit(AutoSubmitKey::ShiftEnter, &rec).unwrap();
    assert_eq!(
        rec.transcript(),
        ["press:Shift", "press:Enter", "release:Enter", "release:Shift"]
    );
}

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
