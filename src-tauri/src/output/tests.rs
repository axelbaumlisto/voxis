use super::*;
use std::sync::{Arc, Mutex};

struct MockClipboard {
    store: Arc<Mutex<Option<String>>>,
}

impl ClipboardBackend for MockClipboard {
    fn set_text(&mut self, text: &str) -> Result<(), OutputError> {
        *self.store.lock().expect("clipboard lock poisoned") = Some(text.to_string());
        Ok(())
    }

    fn get_text(&mut self) -> Result<String, OutputError> {
        self.store
            .lock()
            .expect("clipboard lock poisoned")
            .clone()
            .ok_or_else(|| OutputError::ClipboardError("clipboard is empty".to_string()))
    }
}

struct MockTyper {
    typed: Arc<Mutex<Vec<String>>>,
}

impl PlatformTyper for MockTyper {
    fn type_text(&self, text: &str, _delay_ms: u32) -> Result<(), OutputError> {
        self.typed
            .lock()
            .expect("typed lock poisoned")
            .push(text.to_string());
        Ok(())
    }

    fn paste(&self) -> Result<(), OutputError> {
        Ok(())
    }

    fn supports_clipboard_fallback(&self) -> bool {
        false
    }

    fn name(&self) -> &'static str {
        "MockTyper"
    }
}

fn test_handler(
    typed: Arc<Mutex<Vec<String>>>,
    clipboard_store: Arc<Mutex<Option<String>>>,
) -> OutputHandler {
    OutputHandler::with_dependencies(
        Box::new(MockTyper { typed }),
        0,
        Arc::new(move || {
            Ok(Box::new(MockClipboard {
                store: Arc::clone(&clipboard_store),
            }) as Box<dyn ClipboardBackend>)
        }),
    )
}

#[test]
fn test_clipboard_copy() {
    let typed = Arc::new(Mutex::new(Vec::new()));
    let clipboard_store = Arc::new(Mutex::new(None));
    let handler = test_handler(typed, Arc::clone(&clipboard_store));

    handler
        .copy_to_clipboard("mock clipboard text")
        .expect("copy should succeed");

    assert_eq!(
        clipboard_store
            .lock()
            .expect("clipboard lock poisoned")
            .clone(),
        Some("mock clipboard text".to_string())
    );
}

#[test]
fn test_type_text_basic() {
    let typed = Arc::new(Mutex::new(Vec::new()));
    let clipboard_store = Arc::new(Mutex::new(None));
    let handler = test_handler(Arc::clone(&typed), clipboard_store);

    handler.type_text("hello").expect("typing should succeed");

    assert_eq!(
        typed.lock().expect("typed lock poisoned").as_slice(),
        ["hello"]
    );
}

#[test]
fn test_type_text_with_special_chars() {
    let typed = Arc::new(Mutex::new(Vec::new()));
    let clipboard_store = Arc::new(Mutex::new(None));
    let handler = test_handler(Arc::clone(&typed), clipboard_store);

    let text = "line1\n\tline2";
    handler.type_text(text).expect("typing should succeed");

    assert_eq!(
        typed.lock().expect("typed lock poisoned").as_slice(),
        ["line1\n\tline2"]
    );
}

// --- T-A7 \xb7 append_trailing_space ----------------------------------------
//
// `format_output_text(text, append_trailing_space)` is the pure output-shaping
// step the OutputHandler runs before copy/type. Keeping it side-effect-free
// lets us cover the toggle in isolation without exercising clipboard / typer
// plumbing (SOLID-SRP).

#[test]
fn output_with_trailing_space_appends_one_space() {
    assert_eq!(format_output_text("hello", true), "hello ");
}

#[test]
fn output_without_trailing_space_unchanged() {
    assert_eq!(format_output_text("hello", false), "hello");
}

#[test]
fn output_trailing_space_idempotent_on_already_trailing() {
    // If the transcript already ends with whitespace we MUST NOT append
    // a second space — otherwise repeated dictations accumulate ugly
    // gaps. The function is intentionally idempotent on the right edge.
    assert_eq!(format_output_text("hello ", true), "hello ");
    assert_eq!(format_output_text("hello\n", true), "hello\n");
}

#[test]
fn output_trailing_space_preserves_empty_input() {
    // Empty in -> empty out regardless of flag. We don't want to type
    // a stray space when the transcription pipeline produced nothing.
    assert_eq!(format_output_text("", true), "");
    assert_eq!(format_output_text("", false), "");
}
