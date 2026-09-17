use super::*;

#[test]
fn test_hotkey_parsing() {
    let parsed = HotkeyCombo::parse("Cmd+Shift+R").expect("hotkey should parse");

    assert_eq!(
        parsed.modifiers,
        vec![HotkeyModifier::Cmd, HotkeyModifier::Shift]
    );
    assert_eq!(parsed.key, "R");
}

#[test]
fn test_hotkey_to_string() {
    let hotkey = HotkeyCombo {
        modifiers: vec![HotkeyModifier::Cmd, HotkeyModifier::Shift],
        key: "R".to_string(),
    };

    assert_eq!(hotkey.to_string(), "Cmd+Shift+R");
}

#[test]
fn test_invalid_hotkey_format() {
    let invalid = HotkeyCombo::parse("Cmd+");
    assert!(invalid.is_err());

    let unknown_modifier = HotkeyCombo::parse("Hyper+R");
    assert!(matches!(
        unknown_modifier,
        Err(HotkeyParseError::UnknownModifier(modifier)) if modifier == "hyper"
    ));
}

// =============================================================================
// The listener callback, driven directly.
//
// `rdev::listen` blocks forever and cannot be fed synthetic events, so a
// filter that lived inside the thread closure could only be read, never
// tested. These tests drive `hotkey_callback` itself with synthetic `Event`s:
// no OS hook is installed, no thread is spawned, and the assertions are about
// the exact code the listener thread installs.
// =============================================================================

use std::sync::atomic::AtomicUsize;

/// Counts what the listener asked us to do.
#[derive(Default)]
struct RecordingSink {
    pressed: AtomicUsize,
    released: AtomicUsize,
}

impl RecordingSink {
    fn pressed(&self) -> usize {
        self.pressed.load(Ordering::SeqCst)
    }

    fn released(&self) -> usize {
        self.released.load(Ordering::SeqCst)
    }
}

impl HotkeySink for RecordingSink {
    fn on_pressed(&self) {
        self.pressed.fetch_add(1, Ordering::SeqCst);
    }

    fn on_released(&self) {
        self.released.fetch_add(1, Ordering::SeqCst);
    }
}

/// One OS event, shaped exactly as `listen` delivers it. The `name`/`time`
/// fields are unused by the callback and carry no key information.
fn key_event(event_type: EventType) -> Event {
    Event {
        time: std::time::SystemTime::now(),
        name: None,
        event_type,
    }
}

fn sink_and_callback(
    listener: &HotkeyListener,
) -> (Arc<RecordingSink>, impl FnMut(Event) + Send + 'static) {
    let sink = Arc::new(RecordingSink::default());
    let callback = hotkey_callback(
        Arc::clone(&sink) as Arc<dyn HotkeySink>,
        Arc::clone(&listener.target_key),
        Arc::clone(&listener.stop_flag.lock().unwrap()),
    );
    (sink, callback)
}

fn listen_for(listener: &HotkeyListener, key: Key) {
    listener.target_key.store(key_to_u32(key), Ordering::SeqCst);
}

#[test]
fn only_the_configured_key_ever_reaches_the_sink() {
    let listener = HotkeyListener::new();
    listen_for(&listener, Key::ControlRight);
    let (sink, mut callback) = sink_and_callback(&listener);

    // The configured key: press, then release.
    callback(key_event(EventType::KeyPress(Key::ControlRight)));
    assert_eq!(sink.pressed(), 1, "the configured key must notify");
    callback(key_event(EventType::KeyRelease(Key::ControlRight)));
    assert_eq!(sink.released(), 1, "its release must notify");

    // Any OTHER key: the whole point of the filter. This process sees every
    // keystroke on the machine, so a press that is not the hotkey must die
    // here — before any log, any sink call, any state change.
    callback(key_event(EventType::KeyPress(Key::KeyA)));
    callback(key_event(EventType::KeyPress(Key::Escape)));
    callback(key_event(EventType::KeyPress(Key::Return)));
    assert_eq!(
        sink.pressed(),
        1,
        "a key that is not the configured hotkey must notify nothing"
    );

    // …and releasing an unrelated key must not look like OUR release either.
    callback(key_event(EventType::KeyRelease(Key::KeyA)));
    assert_eq!(
        sink.released(),
        1,
        "an unrelated key's release is not the hotkey's release"
    );
}

#[test]
fn a_held_key_reports_once_and_rearms_after_its_release() {
    let listener = HotkeyListener::new();
    listen_for(&listener, Key::ControlRight);
    let (sink, mut callback) = sink_and_callback(&listener);

    callback(key_event(EventType::KeyPress(Key::ControlRight)));
    callback(key_event(EventType::KeyPress(Key::ControlRight)));
    assert_eq!(
        sink.pressed(),
        1,
        "OS key repeat must not start dictation twice while the key is held"
    );

    callback(key_event(EventType::KeyRelease(Key::ControlRight)));
    callback(key_event(EventType::KeyPress(Key::ControlRight)));
    assert_eq!(
        sink.pressed(),
        2,
        "a fresh press after the release notifies"
    );
}

#[test]
fn mouse_and_other_event_types_are_ignored_entirely() {
    let listener = HotkeyListener::new();
    listen_for(&listener, Key::ControlRight);
    let (sink, mut callback) = sink_and_callback(&listener);

    // rdev delivers these on the same hook; the `_ => {}` arm must drop them.
    callback(key_event(EventType::MouseMove { x: 10.0, y: 20.0 }));
    callback(key_event(EventType::ButtonPress(rdev::Button::Left)));
    callback(key_event(EventType::ButtonRelease(rdev::Button::Left)));
    callback(key_event(EventType::Wheel {
        delta_x: 0,
        delta_y: 1,
    }));

    assert_eq!(sink.pressed(), 0);
    assert_eq!(sink.released(), 0);
}

#[test]
fn after_stop_the_callback_notifies_nothing_even_when_events_arrive() {
    let listener = HotkeyListener::new();
    listen_for(&listener, Key::ControlRight);
    let (sink, mut callback) = sink_and_callback(&listener);

    callback(key_event(EventType::KeyPress(Key::ControlRight)));
    assert_eq!(sink.pressed(), 1, "armed: the hotkey works");

    listener.stop();

    // The thread itself is still alive (rdev::listen cannot be interrupted —
    // see the module doc: it exits on its next event), so the events DO keep
    // arriving. What must never happen again is a notification.
    for _ in 0..5 {
        callback(key_event(EventType::KeyPress(Key::ControlRight)));
        callback(key_event(EventType::KeyRelease(Key::ControlRight)));
    }
    assert_eq!(sink.pressed(), 1, "a stopped listener must notify nothing");
    assert_eq!(sink.released(), 0, "not even the release of a held key");
    assert!(!listener.is_armed(), "stop() disarms the listener");
}

#[test]
fn a_new_arm_does_not_revive_the_abandoned_callback() {
    // The two-hooks hazard the per-thread stop flag exists for: stop() cannot
    // kill the thread, and re-arming must not clear the flag that thread is
    // still reading — otherwise the abandoned thread wakes up and every press
    // is reported twice.
    let listener = HotkeyListener::new();
    listen_for(&listener, Key::ControlRight);
    let (sink, mut abandoned) = sink_and_callback(&listener);

    abandoned(key_event(EventType::KeyPress(Key::ControlRight)));
    assert_eq!(sink.pressed(), 1);

    listener.stop();
    // Re-arm exactly the way `start_with_thread_init` does: a FRESH flag for
    // the thread it is about to spawn (see `stop_flag`'s field doc).
    *listener.stop_flag.lock().unwrap() = Arc::new(AtomicBool::new(false));
    let (fresh_sink, mut fresh) = sink_and_callback(&listener);

    abandoned(key_event(EventType::KeyPress(Key::ControlRight)));
    fresh(key_event(EventType::KeyPress(Key::ControlRight)));

    assert_eq!(
        sink.pressed(),
        1,
        "the thread abandoned by stop() must stay inert after a re-arm"
    );
    assert_eq!(fresh_sink.pressed(), 1, "the newly armed thread works");
}

#[test]
fn hotkey_is_configured_only_accepts_a_real_key_name() {
    assert!(!hotkey_is_configured(""));
    assert!(!hotkey_is_configured("   "));
    assert!(!hotkey_is_configured("\t\n"));
    assert!(hotkey_is_configured("ctrl_r"));
    assert!(hotkey_is_configured("  ctrl_r  "));
}

#[test]
fn start_refuses_to_arm_the_os_hook_without_a_hotkey() {
    // Refusal happens BEFORE the thread is spawned, so this test installs no
    // OS-level hook — which is the entire point of the refusal.
    let listener = HotkeyListener::new();
    let sink: Arc<dyn HotkeySink> = Arc::new(RecordingSink::default());

    assert!(
        !listener.start(Arc::clone(&sink), ""),
        "an empty hotkey must not arm a global keyboard hook"
    );
    assert!(!listener.start(Arc::clone(&sink), "   "));
    assert!(
        !listener.is_armed(),
        "nothing may be armed after a refused start"
    );
}

#[test]
fn start_is_idempotent_and_never_installs_a_second_hook() {
    // The `armed` precondition is set directly instead of by a real `start`:
    // a real one would call `rdev::listen` in the test process and install a
    // keyboard hook for the whole run. The branch under test is the refusal.
    let listener = HotkeyListener::new();
    let sink: Arc<dyn HotkeySink> = Arc::new(RecordingSink::default());
    listener.armed.store(true, Ordering::SeqCst);

    assert!(
        !listener.start(Arc::clone(&sink), "ctrl_r"),
        "a second start must not install a second hook (every press would be \
         reported twice by two threads)"
    );
}
