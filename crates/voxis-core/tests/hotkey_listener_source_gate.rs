//! SOURCE-TEXT GATE: the global hotkey listener must not be able to observe a
//! keystroke it did not match.
//!
//! WHY THIS EXISTS AT ALL. `rdev::listen` hands our process the machine's WHOLE
//! keyboard stream — that is what a global hotkey costs — and the only thing
//! standing between that stream and "Voxis is a keylogger" is the order of
//! operations inside one closure in `src/hotkey/mod.rs`: stop-flag, then the
//! comparison against the configured target key, and only then any logging or
//! sink notification. Nothing about that order is enforced by the type system,
//! and the single most tempting debugging edit in the world ("let me log what
//! arrives") silently inverts it. So the order is pinned by reading the file's
//! own text.
//!
//! WHY AN INTEGRATION TEST (`tests/`, not `#[cfg(test)] mod` in the module):
//! the `hotkey` module is behind the `rdev` Cargo feature, and the project's
//! CI job runs `cargo test -p voxis-core` with DEFAULT features — a gate living
//! inside that module would never run in CI at all. This file is part of the
//! package's default test targets, so it runs in the default feature set, and
//! `include_str!` reads the hotkey source regardless of whether the module is
//! compiled. (It also cannot self-match: the gate's own text lives here, not in
//! the file it inspects.)
//!
//! WHAT IT CHECKS, in four rules — each has a negative control below, because a
//! gate whose red path is never exercised proves nothing:
//!
//! 1. **Only the target key reaches an observer.** Every logging macro
//!    (`tracing::*!`, `println!`, `dbg!`, …) and every `sink.` call in the
//!    callback must sit INSIDE a block opened by a target-key guard
//!    (`key_id == current_target` for presses, `last_pressed_key == Some(key)`
//!    for releases). A log placed before the guard, in the catch-all arm, or
//!    after the match is a violation.
//! 2. **The raw event is never handed to anything.** Inside the callback, the
//!    only lines allowed to mention `event` are the closure signature and the
//!    one `match event.event_type` that immediately destructures it — so
//!    `observe(&event)` or `tracing::debug!("{:?}", event)` cannot be smuggled
//!    in, in a guarded branch or anywhere else.
//! 3. **There is exactly one such callback, and `listen` is given it.** One
//!    `|event: Event|` closure in the file, one `listen(` call, and its argument
//!    must be the `callback` bound from `hotkey_callback` — otherwise a second,
//!    uninspected closure could be installed while this one stays clean.
//! 4. **The gate actually looked at something.** The callback, both guard
//!    conditions, at least two guarded observer lines and the `listen(callback)`
//!    wiring must all have been found; if a refactor renames them, this gate
//!    goes RED rather than silently passing over an empty region. Fail-closed on
//!    purpose: a moved anchor is a question, not an answer.

/// The file under inspection — the listener itself.
const SOURCE: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/src/hotkey/mod.rs"));

/// Macros/calls that OBSERVE something. Any of these reached with a key the
/// user did not configure is the failure this gate exists to prevent.
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
    "sink.",
];

/// Conditions that establish "this event IS the configured hotkey".
const GUARDS: &[&str] = &["== current_target", "last_pressed_key == Some(key)"];

/// Blank out string literals and comments, keeping every offset and newline in
/// place, so braces and identifiers can be scanned without the compiler.
///
/// Offsets are preserved exactly (each consumed byte yields one byte), which is
/// what lets a violation found here be reported with the REAL line text.
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

/// Offset range of the `{ ... }` block that starts at the first `{` at or after
/// `from`, or `None` if the braces never balance.
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

/// Offset of the body of the function whose signature starts with `signature`.
fn fn_body_span(blanked: &str, signature: &str) -> Option<(usize, usize)> {
    let at = blanked.find(signature)?;
    block_span(blanked, at)
}

/// `(start, end)` offsets of every line, in order.
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

/// What the gate found while reading: the anti-vacuity half of the verdict.
#[derive(Debug, Default, PartialEq, Eq)]
struct Reviewed {
    callback_found: bool,
    guard_blocks: usize,
    observer_lines: usize,
    event_closures: usize,
    listen_calls: usize,
    listen_takes_callback: bool,
}

/// Read `source` and return every reason the listener's callback breaks the
/// "no unmatched keystroke can reach an observer" property. An empty vector is
/// a pass; `Reviewed` says whether the gate found anything to judge at all.
fn inspect(source: &str) -> (Vec<String>, Reviewed) {
    let blanked = blank_strings_and_comments(source);
    let mut violations = Vec::new();
    let mut reviewed = Reviewed {
        event_closures: blanked.matches("|event: Event|").count(),
        listen_calls: blanked.matches("listen(").count(),
        listen_takes_callback: blanked.contains("listen(callback)"),
        ..Reviewed::default()
    };

    let Some((body_open, body_close)) = fn_body_span(&blanked, "fn hotkey_callback(") else {
        violations.push(format!(
            "the listener callback is gone: no `fn hotkey_callback(` with a balanced body in {}. \
             The whole leak-safety property is stated about that function, so this gate cannot \
             judge anything until it is back (or this gate is updated deliberately).",
            "src/hotkey/mod.rs"
        ));
        return (violations, reviewed);
    };
    reviewed.callback_found = true;
    let body = &blanked[body_open..=body_close];

    // The ONE closure that receives OS events must be the callback's own.
    let closure_inside = body.contains("|event: Event|");
    if reviewed.event_closures != 1 {
        violations.push(format!(
            "expected exactly one `|event: Event|` closure in the file (the callback's), found {}: \
             a second event closure is a second place OS events can be observed, and this gate \
             only judges the one it knows about",
            reviewed.event_closures
        ));
    } else if !closure_inside {
        violations.push(
            "the file's `|event: Event|` closure is NOT inside `hotkey_callback` — the callback \
             this gate inspects is not the one receiving OS events"
                .to_string(),
        );
    }

    // `listen` must be handed that callback, not some other callable.
    if reviewed.listen_calls != 1 {
        violations.push(format!(
            "expected exactly one `listen(` call in the file, found {} — with more than one, the \
             inspected callback may not be the installed one",
            reviewed.listen_calls
        ));
    }
    if !reviewed.listen_takes_callback {
        violations.push(
            "no `listen(callback)` call: the OS hook must be installed with the `callback` bound \
             from `hotkey_callback`, otherwise the safe callback can sit unused while another \
             (uninspected) closure receives every keystroke"
                .to_string(),
        );
    }

    // Rule 1: the blocks a target-key guard opens are the only places an
    // observer may live. Everything below stays in ONE coordinate system —
    // offsets into `body` — because `blanked` is self-consistent but NOT
    // byte-identical to `source` (blanking a multi-byte character inside a
    // comment or string collapses it to one space). Line NUMBERS and line TEXT
    // are taken from `blanked`/`source` by index instead, which is safe: both
    // texts have exactly the same newlines.
    let body_lines = line_spans(body);
    let mut guard_block_spans: Vec<(usize, usize)> = Vec::new();
    for (s, e) in &body_lines {
        let line = &body[*s..*e];
        if GUARDS.iter().any(|g| line.contains(g)) {
            if let Some((open, close)) = block_span(body, *s) {
                guard_block_spans.push((open, close));
            }
        }
    }
    reviewed.guard_blocks = guard_block_spans.len();

    // Rule 2: the raw event may only be destructured by the guarded match.
    for (i, (s, e)) in body_lines.iter().enumerate() {
        let line = &body[*s..*e];
        let trimmed = line.trim();
        let mentions_event = trimmed
            .split(|c: char| !(c.is_alphanumeric() || c == '_'))
            .any(|w| w == "event");
        let is_signature = trimmed.starts_with("move |event:");
        let is_destructure = trimmed.starts_with("match event.");
        if mentions_event && !is_signature && !is_destructure {
            violations.push(format!(
                "line {}: the raw OS event is passed around outside the guarded match (`{}`). The \
                 event carries the key that was actually pressed, so it may only be destructured \
                 where the target-key guard has already matched — nothing else may receive it, \
                 log it, or forward it.",
                file_line_no(&blanked, body_open, *s),
                source_line(source, file_line_no(&blanked, body_open, *s)).trim()
            ));
        }
        let _ = i;
    }

    // Rule 1, continued: no observer may run outside a guard block.
    for (s, e) in &body_lines {
        let line = &body[*s..*e];
        let hit = OBSERVERS.iter().find(|o| line.contains(**o));
        let Some(observer) = hit else { continue };
        reviewed.observer_lines += 1;
        let guarded = guard_block_spans
            .iter()
            .any(|(open, close)| *s >= *open && *e <= *close);
        if !guarded {
            let n = file_line_no(&blanked, body_open, *s);
            violations.push(format!(
                "line {}: `{}` runs OUTSIDE a target-key guard (`{}`). Anything an unmatched \
                 keystroke can reach — a log, a sink call — is the keylogger this listener must \
                 never become. Move it inside the guard, or drop it.",
                n,
                observer,
                source_line(source, n).trim()
            ));
        }
    }

    // Rule 4: fail closed when the anchors a refactor could rename vanish.
    if reviewed.guard_blocks == 0 {
        violations.push(
            "no target-key guard condition was found in the callback (`== current_target` / \
             `last_pressed_key == Some(key)`): this gate cannot tell a guarded observer from an \
             unguarded one, so it refuses to pass"
                .to_string(),
        );
    }
    if reviewed.observer_lines == 0 {
        violations.push(
            "no logging or sink call was found in the callback: either the notification path \
             moved out of `hotkey_callback`, or this gate is reading the wrong function — both \
             mean it no longer proves anything"
                .to_string(),
        );
    }

    (violations, reviewed)
}

/// 1-based line number in the FILE of a `body`-relative offset.
///
/// Line numbers are taken from `blanked` (which shares `source`'s newlines) so
/// they stay right even where blanking changed a line's byte length.
fn file_line_no(blanked: &str, body_open: usize, body_offset: usize) -> usize {
    line_no(blanked, body_open + body_offset)
}

/// The text of 1-based line `n` in `source`, for violation messages.
fn source_line(source: &str, n: usize) -> &str {
    source.lines().nth(n.saturating_sub(1)).unwrap_or("")
}

/// 1-based line number of `offset` in `text`.
fn line_no(text: &str, offset: usize) -> usize {
    text[..offset.min(text.len())].matches('\n').count() + 1
}

// =============================================================================
// The gate itself
// =============================================================================

#[test]
fn the_callback_was_actually_reviewed_and_not_silently_skipped() {
    let (violations, reviewed) = inspect(SOURCE);

    assert!(reviewed.callback_found, "{violations:#?}");
    assert_eq!(
        reviewed.guard_blocks, 2,
        "the callback must guard BOTH edges with a target-key check (press and release); \
         found {} guarded block(s). Violations: {violations:#?}",
        reviewed.guard_blocks
    );
    assert!(
        reviewed.observer_lines >= 2,
        "expected the press and release notifications inside the callback, found {} observer \
         line(s). Violations: {violations:#?}",
        reviewed.observer_lines
    );
    assert_eq!(reviewed.event_closures, 1, "{violations:#?}");
    assert!(reviewed.listen_takes_callback, "{violations:#?}");
}

#[test]
fn no_log_or_sink_call_can_run_outside_a_target_key_guard() {
    let (violations, _) = inspect(SOURCE);
    assert!(
        violations.is_empty(),
        "the hotkey listener can observe an unmatched keystroke:\n{:#?}",
        violations
    );
}

// =============================================================================
// Negative controls — each one plants the exact edit this gate must catch
// =============================================================================

/// Surgery on the REAL source, so the control exercises the real shape.
fn planted(from: &str, to: &str) -> String {
    assert!(
        SOURCE.contains(from),
        "the control's anchor moved, so this control no longer plants anything: {from:?}"
    );
    SOURCE.replacen(from, to, 1)
}

#[test]
fn negative_control_a_log_before_the_guard_is_caught() {
    let text = planted(
        "                let key_id = key_to_u32(key);\n                if key_id == current_target",
        "                let key_id = key_to_u32(key);\n                \
         tracing::debug!(\"probe: {:?}\", key);\n                \
         if key_id == current_target",
    );
    let (violations, _) = inspect(&text);
    assert!(
        violations
            .iter()
            .any(|v| v.contains("OUTSIDE a target-key guard")),
        "a log placed ahead of the target-key comparison must be a violation, got: {violations:#?}"
    );
}

#[test]
fn negative_control_a_log_in_the_catch_all_arm_is_caught() {
    let text = planted(
        "            _ => {}\n",
        "            _ => {\n                tracing::debug!(\"unmatched: {:?}\", event);\n            }\n",
    );
    let (violations, _) = inspect(&text);
    assert!(
        violations.iter().any(|v| v.contains("OUTSIDE a target-key guard")),
        "logging the events that did NOT match is the worst version of this bug, got: {violations:#?}"
    );
}

#[test]
fn negative_control_the_raw_event_handed_to_a_call_is_caught() {
    let text = planted(
        "        match event.event_type {",
        "        observe_event(&event);\n        match event.event_type {",
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
        "fn hotkey_callback(",
        "fn smuggled(prefix: u8) -> impl FnMut(Event) + Send + 'static {\n    \
         move |event: Event| {\n        tracing::debug!(\"{:?}\", event);\n    }\n}\n\n\
         fn hotkey_callback(prefix",
    )
    .replacen(
        ") -> impl FnMut(Event) + Send + 'static {",
        ", prefix: u8) -> impl FnMut(Event) + Send + 'static {",
        1,
    );
    let (violations, reviewed) = inspect(&text);
    assert_eq!(
        reviewed.event_closures, 2,
        "the control must actually plant a second event closure"
    );
    assert!(
        violations
            .iter()
            .any(|v| v.contains("exactly one `|event: Event|` closure")),
        "a second event closure is a second place OS events are observed, got: {violations:#?}"
    );
}

#[test]
fn negative_control_listen_handed_something_other_than_the_callback_is_caught() {
    let text = planted("listen(callback)", "listen(other_sink)");
    let (violations, _) = inspect(&text);
    assert!(
        violations
            .iter()
            .any(|v| v.contains("no `listen(callback)` call")),
        "installing anything but the inspected callback must be a violation, got: {violations:#?}"
    );
}

#[test]
fn negative_control_a_renamed_guard_fails_closed_instead_of_passing() {
    // A refactor that renames the target variable must NOT quietly turn this
    // gate into a no-op: no guards found is a violation, not a pass.
    let text = planted("key_id == current_target", "key_id == active_target");
    let (violations, reviewed) = inspect(&text);
    assert_eq!(reviewed.guard_blocks, 1, "one of the two guards is left");
    assert!(
        violations
            .iter()
            .any(|v| v.contains("OUTSIDE a target-key guard")),
        "the press-branch observers lose their guard, which must be reported, got: {violations:#?}"
    );
}
