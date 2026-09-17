//! SOURCE-TEXT GATE: the plugin's OS-level hotkey listener must not be able to
//! observe a keystroke it did not match.
//!
//! WHY. `set_hotkey` installs a GLOBAL keyboard hook (`rdev::listen`): while it
//! is installed this process receives the machine's whole keystroke stream. The
//! only thing between that stream and "the app is a keylogger" is what the
//! callback does with an event that is NOT the configured hotkey — it must drop
//! it without logging it, without forwarding it to the host's `EventSink`, and
//! without reaching the host's `HotkeyActions`. That is a property of the order
//! of operations inside one closure, which the type system does not enforce, so
//! it is pinned by reading the file's own text.
//!
//! WHY THIS FILE IS SEPARATE FROM THE CRATE'S UNIT TESTS. The callback lives in
//! `src/hotkey_desktop.rs`, which already has an inline `#[cfg(test)] mod tests`
//! — a gate inside that module would read its own text and need to strip the
//! test half away (the trick `naked` uses). As an integration test the gate's
//! text is in a different file entirely, so there is nothing to strip, and it
//! runs under the project's own CI command `cargo test -p tauri-plugin-voxis`.
//!
//! WHY IT DUPLICATES THE HELPERS FROM `voxis-core`'s GATE. Each crate's gate
//! guards its own listener (`crates/voxis-core/tests/hotkey_listener_source_gate.rs`
//! for `voxis-core::hotkey`, this one for the plugin's `RdevHotkey`). Sharing
//! the scanner would mean a third crate or a dev-dependency purely for test
//! plumbing, and would couple two independent safety properties to one
//! implementation — the duplicated scanner is the cheaper mistake. Both gates
//! fail closed if their anchors move.
//!
//! WHAT IT CHECKS (each rule has a negative control below):
//!
//! 1. **The callback is silent.** No logging macro, `println!`/`dbg!`, and no
//!    `events.` call inside it: `events` is the host-visible `EventSink`, and
//!    reaching it for anything but a startup failure reports the event stream
//!    outward.
//! 2. **The host's actions only run on a MATCHED edge.** Every `actions.` call
//!    must sit inside a block opened by `Some((Edge::Pressed, …))` /
//!    `Some((Edge::Released, …))` — the arms that exist only because the
//!    tracker matched the configured hotkey.
//! 3. **The raw event is never handed to anything**: inside the callback, only
//!    the closure signature and the one `match event.event_type` may mention
//!    `event`.
//! 4. **One callback, and `rdev::listen` is given it** — a second `|event:`
//!    closure or a different `listen` argument would mean the inspected code is
//!    not the installed one.
//! 5. **The gate saw something**: all anchors found, or it is red.

/// The file under inspection — the plugin's desktop hotkey backend.
const SOURCE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/src/hotkey_desktop.rs"
));

/// Macros/calls that OBSERVE something, plus the host-visible event sink.
const OBSERVERS: &[&str] = &[
    "tracing::trace!",
    "tracing::debug!",
    "tracing::info!",
    "tracing::warn!",
    "tracing::error!",
    "println!",
    "print!",
    "eprintln!",
    "eprint!",
    "dbg!",
    "events.",
];

/// Conditions that establish "the tracker matched this event against the
/// configured hotkey" — the only edges the host may be told about.
const GUARDS: &[&str] = &["Some((Edge::Pressed", "Some((Edge::Released"];

/// Blank string literals and comments, preserving newlines so line numbers
/// stay usable. (Byte offsets inside `blanked` are self-consistent, which is
/// all the scanner needs; violation text is taken from `SOURCE` by line.)
fn blank_strings_and_comments(src: &str) -> String {
    let chars: Vec<char> = src.chars().collect();
    let mut out = String::with_capacity(src.len());
    let mut i = 0usize;
    let (mut in_str, mut in_line, mut in_block) = (false, false, false);
    while i < chars.len() {
        let c = chars[i];
        let next = chars.get(i + 1).copied();
        if in_line {
            if c == '\n' {
                in_line = false;
                out.push('\n');
            } else {
                out.push(' ');
            }
            i += 1;
        } else if in_block {
            if c == '*' && next == Some('/') {
                out.push_str("  ");
                i += 2;
                in_block = false;
            } else {
                out.push(if c == '\n' { '\n' } else { ' ' });
                i += 1;
            }
        } else if in_str {
            if c == '\\' {
                out.push(' ');
                if let Some(n) = next {
                    out.push(if n == '\n' { '\n' } else { ' ' });
                    i += 2;
                } else {
                    i += 1;
                }
            } else if c == '"' {
                out.push('"');
                in_str = false;
                i += 1;
            } else {
                out.push(if c == '\n' { '\n' } else { ' ' });
                i += 1;
            }
        } else if c == '/' && next == Some('/') {
            out.push_str("  ");
            i += 2;
            in_line = true;
        } else if c == '/' && next == Some('*') {
            out.push_str("  ");
            i += 2;
            in_block = true;
        } else if c == '"' {
            out.push('"');
            i += 1;
            in_str = true;
        } else {
            out.push(c);
            i += 1;
        }
    }
    out
}

/// Offset range of the `{ … }` block starting at the first `{` at or after
/// `from`.
fn block_span(text: &str, from: usize) -> Option<(usize, usize)> {
    let open = text[from..].find('{')? + from;
    let mut depth = 0i32;
    for (i, ch) in text[open..].char_indices() {
        match ch {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some((open, open + i));
                }
            }
            _ => {}
        }
    }
    None
}

/// `(start, end)` of every line.
fn line_spans(text: &str) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    let mut start = 0usize;
    for (i, ch) in text.char_indices() {
        if ch == '\n' {
            spans.push((start, i));
            start = i + 1;
        }
    }
    if start < text.len() {
        spans.push((start, text.len()));
    }
    spans
}

fn line_no(text: &str, offset: usize) -> usize {
    text[..offset.min(text.len())].matches('\n').count() + 1
}

fn source_line(source: &str, n: usize) -> &str {
    source.lines().nth(n.saturating_sub(1)).unwrap_or("")
}

/// Anti-vacuity half of the verdict.
#[derive(Debug, Default, PartialEq, Eq)]
struct Reviewed {
    callback_found: bool,
    guard_blocks: usize,
    observer_lines: usize,
    event_closures: usize,
    listen_calls: usize,
    listen_takes_callback: bool,
}

/// Read `source`; an empty violation list is a pass.
fn inspect(source: &str) -> (Vec<String>, Reviewed) {
    let blanked = blank_strings_and_comments(source);
    let mut violations = Vec::new();
    let mut reviewed = Reviewed {
        event_closures: blanked.matches("|event:").count(),
        listen_calls: blanked.matches("listen(").count(),
        listen_takes_callback: blanked.contains("listen(callback)"),
        ..Reviewed::default()
    };

    // The callback: the one `move |event: …|` closure in the file.
    let closure_at = blanked.find("move |event:");
    let Some(closure_at) = closure_at else {
        violations.push(
            "the event callback (`move |event: …|`) is gone: this gate states the whole \
             leak-safety property about that closure and cannot judge anything without it"
                .to_string(),
        );
        return (violations, reviewed);
    };
    let Some((body_open, body_close)) = block_span(&blanked, closure_at) else {
        violations.push("the event callback's body braces do not balance".to_string());
        return (violations, reviewed);
    };
    reviewed.callback_found = true;
    let body = &blanked[body_open..=body_close];

    if reviewed.event_closures != 1 {
        violations.push(format!(
            "expected exactly one `|event:` closure in the file, found {} — a second event \
             closure is a second place OS events can be observed, and this gate only judges the \
             one it knows about",
            reviewed.event_closures
        ));
    }
    if reviewed.listen_calls != 1 {
        violations.push(format!(
            "expected exactly one `listen(` call, found {} — with more than one, the inspected \
             callback may not be the installed one",
            reviewed.listen_calls
        ));
    }
    if !reviewed.listen_takes_callback {
        violations.push(
            "no `listen(callback)`: the OS hook must be installed with the `callback` bound to \
             the closure this gate inspects, or a safe callback can sit unused while another \
             closure receives every keystroke"
                .to_string(),
        );
    }

    let body_lines = line_spans(body);

    // Guarded blocks: the matched-edge arms.
    let mut guard_blocks: Vec<(usize, usize)> = Vec::new();
    for (s, _) in &body_lines {
        let line = &body[*s..];
        let line = &line[..line.find('\n').unwrap_or(line.len())];
        if GUARDS.iter().any(|g| line.contains(g)) {
            if let Some(span) = block_span(body, *s) {
                guard_blocks.push(span);
            }
        }
    }
    reviewed.guard_blocks = guard_blocks.len();

    // Rule 3: the raw event may only be destructured by the guarded match.
    for (s, e) in &body_lines {
        let trimmed = body[*s..*e].trim();
        let mentions_event = trimmed
            .split(|c: char| !(c.is_alphanumeric() || c == '_'))
            .any(|w| w == "event");
        let is_signature = trimmed.starts_with("move |event:");
        // The destructuring match is written as `let edge = match event.event_type`
        // in this file (and as a bare `match event.event_type` elsewhere), so the
        // test is "this line IS the guarded match", not "this line starts with it".
        // A call that merely mentions the event — `note_event(&event)`, or a log
        // of it — contains neither form and is a violation.
        let is_destructure = trimmed.contains("match event.");
        if mentions_event && !is_signature && !is_destructure {
            let n = line_no(&blanked, body_open + *s);
            violations.push(format!(
                "line {}: the raw OS event is passed around outside the guarded match (`{}`). \
                 The event carries the key that was actually pressed; nothing but the one \
                 `match event.event_type` may look at it.",
                n,
                source_line(source, n).trim()
            ));
        }
    }

    // Rules 1 + 2: nothing observes an unmatched event. The action calls must be
    // inside a matched-edge arm; every other observer is banned outright.
    for (s, e) in &body_lines {
        let line = &body[*s..*e];
        let Some(observer) = OBSERVERS.iter().find(|o| line.contains(**o)) else {
            continue;
        };
        reviewed.observer_lines += 1;
        let inside_guard = guard_blocks
            .iter()
            .any(|(open, close)| *s >= *open && *e <= *close);
        if !inside_guard {
            let n = line_no(&blanked, body_open + *s);
            violations.push(format!(
                "line {}: `{}` runs outside a matched-edge arm (`{}`). The callback is reached \
                 by EVERY keystroke on the machine; anything an unmatched event can reach is the \
                 keylogger this listener must never become.",
                n,
                observer,
                source_line(source, n).trim()
            ));
        }
    }

    if reviewed.guard_blocks == 0 {
        violations.push(
            "no matched-edge arm was found (`Some((Edge::Pressed` / `Some((Edge::Released`): \
             this gate cannot tell a guarded action call from an unguarded one, so it refuses to \
             pass"
                .to_string(),
        );
    }

    (violations, reviewed)
}

// =============================================================================
// The gate
// =============================================================================

#[test]
fn the_plugin_callback_was_actually_reviewed() {
    let (violations, reviewed) = inspect(SOURCE);

    assert!(reviewed.callback_found, "{violations:#?}");
    assert_eq!(
        reviewed.guard_blocks, 2,
        "both matched edges (Pressed/Released) must be present, found {}. Violations: {violations:#?}",
        reviewed.guard_blocks
    );
    assert_eq!(reviewed.event_closures, 1, "{violations:#?}");
    assert!(reviewed.listen_takes_callback, "{violations:#?}");
}

#[test]
fn no_action_or_log_call_can_run_outside_a_matched_edge() {
    let (violations, _) = inspect(SOURCE);
    assert!(
        violations.is_empty(),
        "the plugin's hotkey listener can observe an unmatched keystroke or tell the host about \
         one:\n{:#?}",
        violations
    );
}

/// Surgery on the REAL source, so a control exercises the real shape.
fn planted(from: &str, to: &str) -> String {
    assert!(
        SOURCE.contains(from),
        "the control's anchor moved, so this control plants nothing: {from:?}"
    );
    SOURCE.replacen(from, to, 1)
}

#[test]
fn negative_control_a_log_inside_the_callback_is_caught() {
    let text = planted(
        "                let dispatch = {\n",
        "                tracing::debug!(\"event: {:?}\", event);\n                let dispatch = {\n",
    );
    let (violations, _) = inspect(&text);
    assert!(
        violations
            .iter()
            .any(|v| v.contains("runs outside a matched-edge arm")),
        "a log inside the callback runs for EVERY keystroke and must be caught, got: {violations:#?}"
    );
}

#[test]
fn negative_control_reporting_every_event_to_the_host_is_caught() {
    let text = planted(
        "                let dispatch = {\n",
        "                events.emit(\"every-key\", ());\n                let dispatch = {\n",
    );
    let (violations, _) = inspect(&text);
    assert!(
        violations.iter().any(|v| v.contains("events.")),
        "forwarding raw events to the host's EventSink must be caught, got: {violations:#?}"
    );
}

#[test]
fn negative_control_the_raw_event_handed_to_a_call_is_caught() {
    let text = planted(
        "                match dispatch {",
        "                note_event(&event);\n                match dispatch {",
    );
    let (violations, _) = inspect(&text);
    assert!(
        violations
            .iter()
            .any(|v| v.contains("the raw OS event is passed around")),
        "the raw event must not be handed to any call, got: {violations:#?}"
    );
}

#[test]
fn negative_control_a_second_event_closure_is_caught() {
    let text = planted(
        "            let callback = move |event: rdev::Event| {",
        "            let _shadow = move |event: rdev::Event| {\n                \
         tracing::debug!(\"{:?}\", event);\n            };\n            \
         let callback = move |event: rdev::Event| {",
    );
    let (violations, reviewed) = inspect(&text);
    assert_eq!(reviewed.event_closures, 2, "the control must plant a second closure");
    assert!(
        violations
            .iter()
            .any(|v| v.contains("exactly one `|event:` closure")),
        "a second event closure is a second observer, got: {violations:#?}"
    );
}
