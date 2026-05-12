//! Output module for clipboard and auto-typing.
//!
//! Handles copying text to clipboard and auto-typing via platform tools.
//! Follows SRP: Only handles text output, no transcription logic.
//! DRY/OCP: Platform-specific typing extracted to PlatformTyper trait.

mod platform;
mod xkb;

use arboard::Clipboard;
pub use platform::{create_typer, PlatformTyper};
use std::sync::Arc;
use thiserror::Error;

/// Output errors.
#[derive(Error, Debug)]
pub enum OutputError {
    #[error("Clipboard error: {0}")]
    ClipboardError(String),
    #[error("Typing error: {0}")]
    TypingError(String),
    #[error("Platform not supported for auto-typing")]
    PlatformNotSupported,
}

/// Saved clipboard contents for backup/restore.
#[derive(Debug)]
pub enum ClipboardContents {
    Text(String),
    Empty,
}

/// Platform detection for typing method.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Platform {
    Linux,
    LinuxWayland,
    MacOS,
    Windows,
}

impl Platform {
    /// Detect current platform.
    pub fn detect() -> Self {
        #[cfg(target_os = "macos")]
        {
            return Platform::MacOS;
        }
        #[cfg(target_os = "windows")]
        {
            return Platform::Windows;
        }
        #[cfg(target_os = "linux")]
        {
            if std::env::var("WAYLAND_DISPLAY").is_ok() {
                Platform::LinuxWayland
            } else {
                Platform::Linux
            }
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        {
            Platform::Linux // Fallback
        }
    }
}

type ClipboardFactory = Arc<dyn Fn() -> Result<Box<dyn ClipboardBackend>, OutputError> + Send + Sync>;

trait ClipboardBackend {
    fn set_text(&mut self, text: &str) -> Result<(), OutputError>;
    fn get_text(&mut self) -> Result<String, OutputError>;
}

struct ArboardClipboard {
    clipboard: Clipboard,
}

impl ArboardClipboard {
    fn new() -> Result<Self, OutputError> {
        let clipboard =
            Clipboard::new().map_err(|e| OutputError::ClipboardError(e.to_string()))?;
        Ok(Self { clipboard })
    }
}

impl ClipboardBackend for ArboardClipboard {
    fn set_text(&mut self, text: &str) -> Result<(), OutputError> {
        self.clipboard
            .set_text(text)
            .map_err(|e| OutputError::ClipboardError(e.to_string()))
    }

    fn get_text(&mut self) -> Result<String, OutputError> {
        self.clipboard
            .get_text()
            .map_err(|e| OutputError::ClipboardError(e.to_string()))
    }
}

/// Output handler for clipboard and typing.
/// DRY/OCP: Uses PlatformTyper trait for platform-specific typing.
pub struct OutputHandler {
    typer: Box<dyn PlatformTyper>,
    typing_delay_ms: u32,
    clipboard_factory: ClipboardFactory,
}

impl Default for OutputHandler {
    fn default() -> Self {
        Self::new(12)
    }
}

impl OutputHandler {
    /// Create a new output handler.
    pub fn new(typing_delay_ms: u32) -> Self {
        let platform = Platform::detect();
        Self::with_dependencies(
            create_typer(platform),
            typing_delay_ms,
            Arc::new(|| Ok(Box::new(ArboardClipboard::new()?) as Box<dyn ClipboardBackend>)),
        )
    }

    fn with_dependencies(
        typer: Box<dyn PlatformTyper>,
        typing_delay_ms: u32,
        clipboard_factory: ClipboardFactory,
    ) -> Self {
        Self {
            typer,
            typing_delay_ms,
            clipboard_factory,
        }
    }

    fn create_clipboard(&self) -> Result<Box<dyn ClipboardBackend>, OutputError> {
        (self.clipboard_factory)()
    }

    /// Copy text to clipboard.
    pub fn copy_to_clipboard(&self, text: &str) -> Result<(), OutputError> {
        let mut clipboard = self.create_clipboard()?;
        clipboard.set_text(text)
    }

    /// Copy text to clipboard and paste it, keeping the clipboard handle alive
    /// until paste completes. On Linux X11, dropping the clipboard handle loses
    /// ownership, so this method ensures the handle survives through the paste.
    pub fn copy_and_paste(&self, text: &str) -> Result<(), OutputError> {
        self.copy_and_paste_with_shortcuts(text, "ctrl_shift_v")
    }

    /// Copy text to clipboard and paste with specified shortcuts.
    /// shortcuts: comma-separated list, e.g. "ctrl_shift_v,shift_insert"
    pub fn copy_and_paste_with_shortcuts(
        &self,
        text: &str,
        shortcuts: &str,
    ) -> Result<(), OutputError> {
        let mut clipboard = self.create_clipboard()?;
        clipboard.set_text(text)?;

        // Small delay for clipboard sync
        std::thread::sleep(std::time::Duration::from_millis(20));

        // Paste with specified shortcuts while clipboard handle is still alive
        self.paste_with_shortcuts(shortcuts)?;

        // Keep handle alive long enough for slow apps (e.g. Electron) to read
        // the clipboard. 500ms is safe because copy_and_paste runs on a blocking thread.
        std::thread::sleep(std::time::Duration::from_millis(500));
        drop(clipboard);

        Ok(())
    }

    /// Auto-type text using platform-specific tools.
    /// DRY: Delegates to PlatformTyper trait implementation.
    pub fn type_text(&self, text: &str) -> Result<(), OutputError> {
        match self.typer.type_text(text, self.typing_delay_ms) {
            Ok(()) => Ok(()),
            Err(e) => {
                // Fallback to copy+paste if supported (keeps clipboard handle alive)
                if self.typer.supports_clipboard_fallback() {
                    self.copy_and_paste(text)?;
                    Err(OutputError::TypingError(format!(
                        "{} (text pasted from clipboard)",
                        e
                    )))
                } else {
                    Err(e)
                }
            }
        }
    }

    /// Save current clipboard contents for later restoration.
    pub fn save_clipboard(&self) -> ClipboardContents {
        let Ok(mut clipboard) = self.create_clipboard() else {
            return ClipboardContents::Empty;
        };

        match clipboard.get_text() {
            Ok(text) => ClipboardContents::Text(text),
            Err(_) => ClipboardContents::Empty,
        }
    }

    /// Restore previously saved clipboard contents.
    ///
    /// On Linux, uses `wait_until()` to keep the handle alive until the
    /// clipboard manager acknowledges the contents (up to 500ms).
    /// Non-fatal on timeout — the user can still paste manually.
    pub fn restore_clipboard(&self, contents: ClipboardContents) -> Result<(), OutputError> {
        match contents {
            ClipboardContents::Text(text) => {
                #[cfg(target_os = "linux")]
                {
                    use arboard::SetExtLinux;
                    use std::time::{Duration, Instant};
                    let mut clipboard =
                        Clipboard::new().map_err(|e| OutputError::ClipboardError(e.to_string()))?;
                    if let Err(e) = clipboard
                        .set()
                        .wait_until(Instant::now() + Duration::from_millis(500))
                        .text(text)
                    {
                        tracing::debug!("Clipboard restore wait timed out: {}", e);
                    }
                    Ok(())
                }
                #[cfg(not(target_os = "linux"))]
                {
                    self.copy_to_clipboard(&text)
                }
            }
            ClipboardContents::Empty => Ok(()),
        }
    }

    /// Paste from clipboard using Cmd+V (macOS) or Ctrl+V (other platforms).
    pub fn paste(&self) -> Result<(), OutputError> {
        self.paste_with_shortcuts("ctrl_shift_v")
    }

    /// Paste from clipboard with specified shortcuts (comma-separated).
    /// Valid shortcuts: "ctrl_shift_v", "ctrl_v", "shift_insert". Ignored on macOS.
    pub fn paste_with_shortcuts(&self, #[allow(unused_variables)] shortcuts: &str) -> Result<(), OutputError> {
        #[cfg(target_os = "macos")]
        {
            // macOS always uses Cmd+V, shortcuts parameter ignored
            use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
            use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

            const KEY_V: u16 = 0x09; // Virtual key code for 'V'

            let source = CGEventSource::new(CGEventSourceStateID::Private)
                .map_err(|_| OutputError::TypingError("Failed to create event source".into()))?;

            let key_down = CGEvent::new_keyboard_event(source.clone(), KEY_V, true)
                .map_err(|_| OutputError::TypingError("Failed to create key down event".into()))?;
            key_down.set_flags(CGEventFlags::CGEventFlagCommand);

            let key_up = CGEvent::new_keyboard_event(source, KEY_V, false)
                .map_err(|_| OutputError::TypingError("Failed to create key up event".into()))?;

            key_down.post(CGEventTapLocation::HID);
            key_up.post(CGEventTapLocation::HID);

            Ok(())
        }

        #[cfg(not(target_os = "macos"))]
        {
            use enigo::{Direction, Enigo, Key, Keyboard, Settings};

            let mut enigo = Enigo::new(&Settings::default())
                .map_err(|e| OutputError::TypingError(e.to_string()))?;

            #[cfg(target_os = "linux")]
            {
                // Parse comma-separated shortcuts and execute each
                let shortcut_list: Vec<&str> = shortcuts.split(',').map(|s| s.trim()).collect();
                let mut first = true;

                for shortcut in shortcut_list {
                    if !first {
                        // Delay between shortcuts - must be long enough for X11
                        std::thread::sleep(std::time::Duration::from_millis(100));
                    }
                    first = false;

                    match shortcut {
                        "ctrl_v" => {
                            enigo
                                .key(Key::Control, Direction::Press)
                                .map_err(|e| OutputError::TypingError(e.to_string()))?;
                            enigo
                                .key(Key::Unicode('v'), Direction::Click)
                                .map_err(|e| OutputError::TypingError(e.to_string()))?;
                            enigo
                                .key(Key::Control, Direction::Release)
                                .map_err(|e| OutputError::TypingError(e.to_string()))?;
                        }
                        "shift_insert" => {
                            enigo
                                .key(Key::Shift, Direction::Press)
                                .map_err(|e| OutputError::TypingError(e.to_string()))?;
                            enigo
                                .key(Key::Insert, Direction::Click)
                                .map_err(|e| OutputError::TypingError(e.to_string()))?;
                            enigo
                                .key(Key::Shift, Direction::Release)
                                .map_err(|e| OutputError::TypingError(e.to_string()))?;
                        }
                        _ => {
                            // "ctrl_shift_v" (default)
                            enigo
                                .key(Key::Control, Direction::Press)
                                .map_err(|e| OutputError::TypingError(e.to_string()))?;
                            enigo
                                .key(Key::Shift, Direction::Press)
                                .map_err(|e| OutputError::TypingError(e.to_string()))?;
                            enigo
                                .key(Key::Unicode('v'), Direction::Click)
                                .map_err(|e| OutputError::TypingError(e.to_string()))?;
                            enigo
                                .key(Key::Shift, Direction::Release)
                                .map_err(|e| OutputError::TypingError(e.to_string()))?;
                            enigo
                                .key(Key::Control, Direction::Release)
                                .map_err(|e| OutputError::TypingError(e.to_string()))?;
                        }
                    }
                }
            }

            #[cfg(not(target_os = "linux"))]
            {
                // Windows: always Ctrl+V
                enigo
                    .key(Key::Control, Direction::Press)
                    .map_err(|e| OutputError::TypingError(e.to_string()))?;
                enigo
                    .key(Key::Unicode('v'), Direction::Click)
                    .map_err(|e| OutputError::TypingError(e.to_string()))?;
                enigo
                    .key(Key::Control, Direction::Release)
                    .map_err(|e| OutputError::TypingError(e.to_string()))?;
            }

            Ok(())
        }
    }
}

#[cfg(test)]
mod tests;
