//! `RdevHotkey`: the desktop hotkey backend (Task 4), gated behind this
//! crate's `desktop` feature. Parses `HotkeySpec.key` via
//! `voxis_core::hotkey::{parse_hotkey, HotkeyCombo}` (plan
//! `[R1-Migration S6]`: single-modifier parity with desktop Voxis's
//! default `ctrl_r`/`alt_r`, plus `"Mod+Mod+Key"` combos), then tracks
//! press/release itself against raw `rdev` key events \u2014 it does not
//! reuse `voxis_core::hotkey::HotkeyListener` as its OS-level listener,
//! because that type only ever matches a *single* target key (no
//! modifier bookkeeping), which cannot express a combo like
//! `"Ctrl+Shift+V"`. Combo *syntax* still goes through
//! `voxis_core::hotkey::HotkeyCombo::parse` (one parser, shared with the
//! guest-js side's own combo format); this module only adds the
//! trailing key's rdev mapping for the letters/digits
//! `voxis_core::hotkey::KEY_TABLE` doesn't cover (modifiers and named
//! keys still resolve through `parse_hotkey`).
//!
//! **Never block the hotkey press path on a permission check**: the
//! original stuck-recording incident traced back to a synchronous
//! `osascript`-based Accessibility check gating the press handler
//! itself. This module never does that \u2014 permission failure is detected
//! purely from `rdev::listen`'s own return value (which fails fast, at
//! listener-startup time, not per keypress) and surfaced through
//! `set_hotkey`'s one-time, bounded (300ms) wait for that outcome, never
//! from inside the press/release callback.

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use rdev::Key;

use voxis_core::hotkey::{parse_hotkey, HotkeyCombo, HotkeyModifier};

use crate::error::PluginError;
use crate::events::EventSink;
use crate::models::{HotkeySpec, Mode, ERROR_EVENT};

/// A parsed, rdev-ready hotkey target: the trailing trigger key plus any
/// modifiers that must be held (empty for a plain single-key spec like
/// `"alt_r"`).
#[derive(Debug, Clone, PartialEq)]
pub struct HotkeyMatch {
    pub modifiers: Vec<HotkeyModifier>,
    pub key: Key,
}

/// Parses a `HotkeySpec.key` string into an `rdev`-ready target.
/// Tries a single named key first (`voxis_core::hotkey::parse_hotkey` \u2014
/// covers every `KEY_TABLE` alias: modifiers, function keys, common
/// keys), then a `"Mod+Mod+Key"` combo (`HotkeyCombo::parse` for syntax,
/// `combo_trailing_key` for the final key's rdev mapping). Never panics;
/// an unrecognized spec or a combo whose trailing key has no rdev
/// mapping is `Err(PluginError::InvalidHotkey)`.
pub fn parse_hotkey_spec(spec: &str) -> Result<HotkeyMatch, PluginError> {
    if let Some(key) = parse_hotkey(spec) {
        return Ok(HotkeyMatch { modifiers: Vec::new(), key });
    }
    let combo = HotkeyCombo::parse(spec).map_err(|e| PluginError::InvalidHotkey { message: e.to_string() })?;
    let key = combo_trailing_key(&combo.key)
        .ok_or_else(|| PluginError::InvalidHotkey { message: format!("unsupported key in combo: '{}'", combo.key) })?;
    Ok(HotkeyMatch { modifiers: combo.modifiers, key })
}

/// Maps a combo's trailing key (e.g. `"V"`, `"1"`, but also named keys
/// like `"F5"`) to an `rdev::Key`. Single ASCII letters/digits go through
/// a small table of their own (`voxis_core::hotkey::KEY_TABLE` has none
/// \u2014 the plugin's `desktop` feature is the only consumer that has ever
/// needed a letter/digit key, no reason to widen core's table for one
/// caller); anything else falls back to `parse_hotkey` so e.g.
/// `"Ctrl+F5"` still resolves through the shared table.
fn combo_trailing_key(name: &str) -> Option<Key> {
    let lower = name.to_ascii_lowercase();
    if lower.chars().count() == 1 {
        if let Some(key) = letter_or_digit_key(lower.chars().next().unwrap()) {
            return Some(key);
        }
    }
    parse_hotkey(name)
}

fn letter_or_digit_key(c: char) -> Option<Key> {
    use Key::*;
    Some(match c {
        'a' => KeyA,
        'b' => KeyB,
        'c' => KeyC,
        'd' => KeyD,
        'e' => KeyE,
        'f' => KeyF,
        'g' => KeyG,
        'h' => KeyH,
        'i' => KeyI,
        'j' => KeyJ,
        'k' => KeyK,
        'l' => KeyL,
        'm' => KeyM,
        'n' => KeyN,
        'o' => KeyO,
        'p' => KeyP,
        'q' => KeyQ,
        'r' => KeyR,
        's' => KeyS,
        't' => KeyT,
        'u' => KeyU,
        'v' => KeyV,
        'w' => KeyW,
        'x' => KeyX,
        'y' => KeyY,
        'z' => KeyZ,
        '0' => Num0,
        '1' => Num1,
        '2' => Num2,
        '3' => Num3,
        '4' => Num4,
        '5' => Num5,
        '6' => Num6,
        '7' => Num7,
        '8' => Num8,
        '9' => Num9,
        _ => return None,
    })
}

/// Records a failed `rdev::listen` outcome and notifies the host app.
/// `set_hotkey`'s own bounded (300ms) wait only catches this if it's
/// still polling (first call) or if a *later* `set_hotkey` call happens
/// to check `startup_result` again (the "L2" branch in `set_hotkey`) --
/// neither is guaranteed for a listener that dies well after
/// registration with no further `set_hotkey` call ever coming in
/// (`[ADO-4]`). Emitting `ERROR_EVENT` here means the host app learns
/// about it either way, instead of the user quietly believing the
/// hotkey still works. Split out from `spawn_listener`'s closure so it's
/// callable directly from a test with a fabricated error string, no real
/// `rdev::listen`/OS permission dependency required.
fn report_listen_failure(startup_result: &Mutex<Option<Result<(), String>>>, events: &Arc<dyn EventSink>, message: String) {
    tracing::error!(message = %message, "rdev::listen failed to start (Accessibility/Input Monitoring permission?)");
    *startup_result.lock().unwrap() = Some(Err(message.clone()));
    events.emit(ERROR_EVENT, serde_json::to_value(PluginError::PermissionDenied { message }).unwrap());
}

fn modifier_matches(modifier: HotkeyModifier, key: Key) -> bool {
    match modifier {
        HotkeyModifier::Ctrl => matches!(key, Key::ControlLeft | Key::ControlRight),
        HotkeyModifier::Alt => matches!(key, Key::Alt | Key::AltGr),
        HotkeyModifier::Shift => matches!(key, Key::ShiftLeft | Key::ShiftRight),
        HotkeyModifier::Cmd | HotkeyModifier::Super => matches!(key, Key::MetaLeft | Key::MetaRight),
    }
}

/// One edge of the hotkey's own Pressed/Released state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Edge {
    Pressed,
    Released,
}

/// Pure press/release state machine for one `HotkeyMatch` + `Mode`,
/// driven by raw `rdev::EventType::{KeyPress,KeyRelease}` \u2014 no OS
/// listener involved, so this is fully unit-testable with synthetic
/// events.
///
/// - Auto-repeat safe: a repeated `KeyPress` for an already-active target
///   key is a no-op (mirrors `voxis_core::hotkey::HotkeyListener`'s own
///   `!is_pressed` guard).
/// - Combo release rule (parity with `hotkey.ts`'s `buildMatcher` doc:
///   releasing a multi-key combo essentially never means "every key came
///   up in the same event"): release fires on the **first** keyup of
///   *any* key that is part of the combo \u2014 the trigger key itself, or
///   any required modifier (side-agnostic: either the left or right
///   variant satisfies a `Ctrl`/`Alt`/`Shift`/`Cmd` requirement).
pub struct HotkeyTracker {
    target: HotkeyMatch,
    mode: Mode,
    held: HashSet<Key>,
    active: bool,
}

impl HotkeyTracker {
    pub fn new(target: HotkeyMatch, mode: Mode) -> Self {
        Self { target, mode, held: HashSet::new(), active: false }
    }

    pub fn mode(&self) -> Mode {
        self.mode
    }

    pub fn on_key_press(&mut self, key: Key) -> Option<Edge> {
        self.held.insert(key);
        if !self.active && key == self.target.key && self.modifiers_satisfied() {
            self.active = true;
            return Some(Edge::Pressed);
        }
        None
    }

    pub fn on_key_release(&mut self, key: Key) -> Option<Edge> {
        self.held.remove(&key);
        if self.active && self.is_release_trigger(key) {
            self.active = false;
            // Minor (review fix): a combo's release fires on the first
            // keyup of any member (see doc above) while the OS may still
            // be holding the rest as "pressed" in `held` from this
            // tracker's point of view (their own keyup events never
            // arrive because the release already ended the session) --
            // clear it so a stale modifier can't linger and immediately
            // satisfy `modifiers_satisfied()` for the *next* press.
            self.held.clear();
            return Some(Edge::Released);
        }
        None
    }

    fn modifiers_satisfied(&self) -> bool {
        self.target.modifiers.iter().all(|m| self.held.iter().any(|k| modifier_matches(*m, *k)))
    }

    fn is_release_trigger(&self, key: Key) -> bool {
        key == self.target.key || self.target.modifiers.iter().any(|m| modifier_matches(*m, key))
    }
}

/// Notified on the hotkey's Pressed/Released edges, together with the
/// `Mode` the currently-registered `HotkeySpec` carries \u2014 `set_hotkey`'s
/// caller (`lib.rs`) supplies an implementation that starts/stops (Hold)
/// or toggles (Toggle) the plugin's active dictation session.
pub trait HotkeyActions: Send + Sync + 'static {
    fn on_pressed(&self, mode: Mode);
    fn on_released(&self, mode: Mode);
}

/// Desktop hotkey backend: owns (at most) one background `rdev::listen`
/// thread for the whole plugin lifetime, and a live-swappable
/// `HotkeyTracker` behind one lock that the listener thread's callback
/// reads on every event.
pub struct RdevHotkey {
    tracker: Arc<Mutex<Option<HotkeyTracker>>>,
    actions: Arc<dyn HotkeyActions>,
    events: Arc<dyn EventSink>,
    started: AtomicBool,
    startup_result: Arc<Mutex<Option<Result<(), String>>>>,
    thread_handle: Mutex<Option<JoinHandle<()>>>,
}

/// Bounded, one-time wait (`set_hotkey`'s registration path, never the
/// press path \u2014 see module doc) for `rdev::listen` to fail fast on a
/// permission problem before its first real key event.
const STARTUP_GRACE: Duration = Duration::from_millis(300);

impl RdevHotkey {
    pub fn new(actions: Arc<dyn HotkeyActions>, events: Arc<dyn EventSink>) -> Self {
        Self {
            tracker: Arc::new(Mutex::new(None)),
            actions,
            events,
            started: AtomicBool::new(false),
            startup_result: Arc::new(Mutex::new(None)),
            thread_handle: Mutex::new(None),
        }
    }

    /// (Re-)registers `spec` as the active hotkey. Parses+validates
    /// first \u2014 an invalid spec is `Err` without touching any listener
    /// state, so a bad `set_hotkey` call leaves the previous hotkey (if
    /// any) active. On the very first successful call, spawns the
    /// background OS-level listener thread; every call (including the
    /// first) swaps the shared tracker to the new target under one lock
    /// \u2014 `[R1-Migration S6]` parity with `voxis_core::hotkey::
    /// HotkeyListener::set_hotkey`'s own atomic-swap "re-registration"
    /// (not a thread respawn: rdev exposes no supported way to tear down
    /// and rebuild its OS-level hook mid-process, so "stops the old
    /// listener first" here means the old target stops matching the
    /// instant the swap lands, not that the OS thread exits).
    pub fn set_hotkey(&self, spec: &HotkeySpec) -> Result<(), PluginError> {
        let target = parse_hotkey_spec(&spec.key)?;
        *self.tracker.lock().unwrap() = Some(HotkeyTracker::new(target, spec.mode));

        if !self.started.swap(true, Ordering::SeqCst) {
            self.spawn_listener();
            let deadline = Instant::now() + STARTUP_GRACE;
            loop {
                if let Some(result) = self.startup_result.lock().unwrap().clone() {
                    return result.map_err(|message| PluginError::PermissionDenied { message });
                }
                if Instant::now() >= deadline {
                    break;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        } else if let Some(result) = self.startup_result.lock().unwrap().clone() {
            // L2 (review fix): the listener thread was already spawned by
            // an earlier `set_hotkey` call, but `rdev::listen` can still
            // fail *after* that call's own bounded wait already gave up
            // (e.g. a permission grant revoked between two `set_hotkey`
            // calls). Without this check, a `set_hotkey` that overlaps a
            // late failure would report `Ok(())` even though the listener
            // is not actually running — check every call, not just the
            // one that spawned the thread.
            return result.map_err(|message| PluginError::PermissionDenied { message });
        }
        Ok(())
    }

    fn spawn_listener(&self) {
        let tracker = self.tracker.clone();
        let actions = self.actions.clone();
        let startup_result = self.startup_result.clone();
        let events = self.events.clone();
        let handle = std::thread::spawn(move || {
            #[cfg(target_os = "macos")]
            rdev::set_is_main_thread(false);

            let callback = move |event: rdev::Event| {
                let dispatch = {
                    let mut guard = tracker.lock().unwrap();
                    guard.as_mut().and_then(|t| {
                        let edge = match event.event_type {
                            rdev::EventType::KeyPress(key) => t.on_key_press(key),
                            rdev::EventType::KeyRelease(key) => t.on_key_release(key),
                            _ => None,
                        };
                        edge.map(|e| (e, t.mode()))
                    })
                };
                match dispatch {
                    Some((Edge::Pressed, mode)) => actions.on_pressed(mode),
                    Some((Edge::Released, mode)) => actions.on_released(mode),
                    None => {}
                }
            };

            if let Err(e) = rdev::listen(callback) {
                report_listen_failure(&startup_result, &events, format!("{e:?}"));
            }
        });
        *self.thread_handle.lock().unwrap() = Some(handle);
    }
}

impl crate::HotkeyController for RdevHotkey {
    fn set_hotkey(&self, spec: &HotkeySpec) -> Result<(), PluginError> {
        RdevHotkey::set_hotkey(self, spec)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(key: &str, mode: Mode) -> HotkeySpec {
        HotkeySpec { key: key.to_string(), mode }
    }

    #[test]
    fn parse_single_modifier_alt_r() {
        let m = parse_hotkey_spec("alt_r").unwrap();
        assert_eq!(m.key, Key::AltGr);
        assert!(m.modifiers.is_empty());
    }

    #[test]
    fn parse_single_modifier_ctrl_r() {
        let m = parse_hotkey_spec("ctrl_r").unwrap();
        assert_eq!(m.key, Key::ControlRight);
        assert!(m.modifiers.is_empty());
    }

    #[test]
    fn parse_combo_ctrl_shift_v() {
        let m = parse_hotkey_spec("Ctrl+Shift+V").unwrap();
        assert_eq!(m.key, Key::KeyV);
        assert_eq!(m.modifiers, vec![HotkeyModifier::Ctrl, HotkeyModifier::Shift]);
    }

    #[test]
    fn parse_combo_with_named_trailing_key() {
        let m = parse_hotkey_spec("Cmd+F5").unwrap();
        assert_eq!(m.key, Key::F5);
        assert_eq!(m.modifiers, vec![HotkeyModifier::Cmd]);
    }

    #[test]
    fn parse_rejects_unrecognized_single_key() {
        let err = parse_hotkey_spec("definitely_not_a_key").unwrap_err();
        assert!(matches!(err, PluginError::InvalidHotkey { .. }));
    }

    #[test]
    fn parse_rejects_combo_with_unknown_modifier() {
        let err = parse_hotkey_spec("Hyper+V").unwrap_err();
        assert!(matches!(err, PluginError::InvalidHotkey { .. }));
    }

    #[test]
    fn parse_rejects_combo_with_unmappable_trailing_key() {
        // "Ctrl+" alone has no trailing key at all.
        let err = parse_hotkey_spec("Ctrl+").unwrap_err();
        assert!(matches!(err, PluginError::InvalidHotkey { .. }));
    }

    /// Mapping table from the task's own acceptance list.
    #[test]
    fn hotkey_spec_strings_round_trip_through_the_parser() {
        for key in ["alt_r", "ctrl_r", "Ctrl+Shift+V"] {
            assert!(parse_hotkey_spec(key).is_ok(), "{key} should parse");
        }
    }

    #[test]
    fn tracker_single_key_press_then_release() {
        let mut t = HotkeyTracker::new(HotkeyMatch { modifiers: vec![], key: Key::ControlRight }, Mode::Hold);
        assert_eq!(t.on_key_press(Key::ControlRight), Some(Edge::Pressed));
        // Auto-repeat: pressing again while active must not re-fire.
        assert_eq!(t.on_key_press(Key::ControlRight), None);
        assert_eq!(t.on_key_release(Key::ControlRight), Some(Edge::Released));
    }

    #[test]
    fn tracker_ignores_unrelated_keys() {
        let mut t = HotkeyTracker::new(HotkeyMatch { modifiers: vec![], key: Key::ControlRight }, Mode::Hold);
        assert_eq!(t.on_key_press(Key::KeyA), None);
        assert_eq!(t.on_key_release(Key::KeyA), None);
    }

    #[test]
    fn tracker_combo_requires_all_modifiers_held_before_key_press() {
        let mut t = HotkeyTracker::new(
            HotkeyMatch { modifiers: vec![HotkeyModifier::Ctrl, HotkeyModifier::Shift], key: Key::KeyV },
            Mode::Hold,
        );
        // V pressed without modifiers held yet: no match.
        assert_eq!(t.on_key_press(Key::KeyV), None);
        t.on_key_release(Key::KeyV);
        // Hold Ctrl, then Shift, then V: matches (side-agnostic Ctrl).
        assert_eq!(t.on_key_press(Key::ControlLeft), None);
        assert_eq!(t.on_key_press(Key::ShiftRight), None);
        assert_eq!(t.on_key_press(Key::KeyV), Some(Edge::Pressed));
    }

    #[test]
    fn tracker_combo_releases_on_first_modifier_keyup_not_just_the_main_key() {
        let mut t = HotkeyTracker::new(
            HotkeyMatch { modifiers: vec![HotkeyModifier::Ctrl, HotkeyModifier::Shift], key: Key::KeyV },
            Mode::Hold,
        );
        t.on_key_press(Key::ControlLeft);
        t.on_key_press(Key::ShiftLeft);
        assert_eq!(t.on_key_press(Key::KeyV), Some(Edge::Pressed));
        // User lifts Shift first (common real-world release order), not V.
        assert_eq!(t.on_key_release(Key::ShiftLeft), Some(Edge::Released));
        // A second keyup from another combo member is a no-op (already released).
        assert_eq!(t.on_key_release(Key::ControlLeft), None);
    }

    #[test]
    fn tracker_second_press_after_release_fires_again() {
        let mut t = HotkeyTracker::new(HotkeyMatch { modifiers: vec![], key: Key::F5 }, Mode::Toggle);
        assert_eq!(t.on_key_press(Key::F5), Some(Edge::Pressed));
        assert_eq!(t.on_key_release(Key::F5), Some(Edge::Released));
        assert_eq!(t.on_key_press(Key::F5), Some(Edge::Pressed), "a fresh press after release must fire again");
    }

    #[test]
    fn tracker_reports_the_mode_it_was_registered_with() {
        let t = HotkeyTracker::new(HotkeyMatch { modifiers: vec![], key: Key::F5 }, Mode::Toggle);
        assert_eq!(t.mode(), Mode::Toggle);
    }

    struct RecordingActions {
        pressed: Mutex<Vec<Mode>>,
        released: Mutex<Vec<Mode>>,
    }

    impl RecordingActions {
        fn new() -> Self {
            Self { pressed: Mutex::new(Vec::new()), released: Mutex::new(Vec::new()) }
        }
    }

    impl HotkeyActions for RecordingActions {
        fn on_pressed(&self, mode: Mode) {
            self.pressed.lock().unwrap().push(mode);
        }
        fn on_released(&self, mode: Mode) {
            self.released.lock().unwrap().push(mode);
        }
    }

    /// Drives `RdevHotkey`'s own dispatch logic end-to-end *without* a
    /// real OS listener thread \u2014 exercises the tracker + `HotkeyActions`
    /// wiring the same way `spawn_listener`'s callback does, by calling
    /// the tracker directly through the same `Arc<Mutex<..>>` `RdevHotkey`
    /// itself would hand to the callback.
    #[test]
    fn fake_sink_drives_hold_start_and_toggle_flip() {
        let actions = Arc::new(RecordingActions::new());
        let hold_tracker = Arc::new(Mutex::new(Some(HotkeyTracker::new(
            HotkeyMatch { modifiers: vec![], key: Key::ControlRight },
            Mode::Hold,
        ))));
        {
            let mut guard = hold_tracker.lock().unwrap();
            let t = guard.as_mut().unwrap();
            if let Some(edge) = t.on_key_press(Key::ControlRight) {
                actions.on_pressed(t.mode());
                assert_eq!(edge, Edge::Pressed);
            }
        }
        {
            let mut guard = hold_tracker.lock().unwrap();
            let t = guard.as_mut().unwrap();
            if let Some(edge) = t.on_key_release(Key::ControlRight) {
                actions.on_released(t.mode());
                assert_eq!(edge, Edge::Released);
            }
        }
        assert_eq!(*actions.pressed.lock().unwrap(), vec![Mode::Hold]);
        assert_eq!(*actions.released.lock().unwrap(), vec![Mode::Hold]);

        let toggle_tracker = Arc::new(Mutex::new(Some(HotkeyTracker::new(
            HotkeyMatch { modifiers: vec![], key: Key::F5 },
            Mode::Toggle,
        ))));
        for _ in 0..2 {
            let mut guard = toggle_tracker.lock().unwrap();
            let t = guard.as_mut().unwrap();
            if let Some(Edge::Pressed) = t.on_key_press(Key::F5) {
                actions.on_pressed(t.mode());
            }
            t.on_key_release(Key::F5);
        }
        assert_eq!(*actions.pressed.lock().unwrap(), vec![Mode::Hold, Mode::Toggle, Mode::Toggle], "two physical taps of a toggle hotkey must flip twice");
    }

    #[test]
    fn set_hotkey_rejects_invalid_spec_without_starting_a_listener() {
        let actions = Arc::new(RecordingActions::new());
        let events = Arc::new(crate::events::RecordingSink::new());
        let hotkey = RdevHotkey::new(actions, events);
        let result = hotkey.set_hotkey(&spec("not+a+valid+combo+at+all+extra", Mode::Hold));
        assert!(result.is_err());
        assert!(!hotkey.started.load(Ordering::SeqCst), "an invalid spec must not spawn the listener thread");
    }

    /// `[ADO-4]`: a late `rdev::listen` failure (after the 300ms grace
    /// window this test drives directly by calling `spawn_listener`, no
    /// real OS listener/permission dependency) must emit `voxis://error`
    /// with `kind: "permissionDenied"` on the injected `EventSink`, not
    /// just update the (possibly never re-checked) internal
    /// `startup_result`.
    #[test]
    fn late_listener_failure_emits_an_error_event() {
        // Exercises the actual production helper `spawn_listener`'s
        // closure calls on a real `rdev::listen` failure -- no real OS
        // listener/permission dependency needed since `report_listen_failure`
        // takes the error message directly.
        let startup_result: Mutex<Option<Result<(), String>>> = Mutex::new(None);
        let recording = Arc::new(crate::events::RecordingSink::new());
        let events: Arc<dyn EventSink> = recording.clone();
        let message = "simulated listener failure".to_string();

        report_listen_failure(&startup_result, &events, message.clone());

        assert_eq!(*startup_result.lock().unwrap(), Some(Err(message.clone())));
        let last = recording.last(ERROR_EVENT).expect("an error event must have been emitted");
        assert_eq!(last, serde_json::json!({"kind": "permissionDenied", "message": message}));
    }
}
