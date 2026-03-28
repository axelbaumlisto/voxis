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
