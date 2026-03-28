//! Platform-specific typing implementations using enigo.
//!
//! Enigo provides cross-platform text input that's much faster than
//! shell-based tools like xdotool (~100ms vs ~5sec for 100 chars).

use super::xkb::XkbGroupManager;
use super::OutputError;
use enigo::{Enigo, Keyboard, Settings};

/// Trait for platform-specific text typing (OCP: Open for extension).
pub trait PlatformTyper: Send + Sync {
    /// Type the given text using platform-specific tools.
    fn type_text(&self, text: &str, delay_ms: u32) -> Result<(), OutputError>;

    /// Paste from clipboard using Ctrl+V (instant, ~10ms).
    /// This is much faster than type_text for long texts.
    fn paste(&self) -> Result<(), OutputError>;

    /// Whether this platform supports clipboard fallback on typing failure.
    fn supports_clipboard_fallback(&self) -> bool {
        true
    }

    /// Get the name of this platform for logging.
    fn name(&self) -> &'static str;
}

/// Cross-platform typer using enigo library.
/// Much faster than xdotool/wtype/osascript/PowerShell.
pub struct EnigoTyper;

impl PlatformTyper for EnigoTyper {
    fn type_text(&self, text: &str, _delay_ms: u32) -> Result<(), OutputError> {
        let settings = Settings::default();

        // Switch to US layout for correct punctuation on non-Latin layouts
        let xkb = XkbGroupManager::new();

        if let Some(ref manager) = xkb {
            manager.with_us_layout(|| Self::do_type(text, &settings))
        } else {
            Self::do_type(text, &settings)
        }
    }

    fn paste(&self) -> Result<(), OutputError> {
        use enigo::{Direction, Key, Keyboard};

        let settings = Settings::default();
        let mut enigo = Enigo::new(&settings)
            .map_err(|e| OutputError::TypingError(format!("Failed to initialize enigo: {}", e)))?;

        #[cfg(target_os = "macos")]
        {
            enigo
                .key(Key::Meta, Direction::Press)
                .map_err(|e| OutputError::TypingError(format!("{}", e)))?;
            enigo
                .key(Key::Unicode('v'), Direction::Click)
                .map_err(|e| OutputError::TypingError(format!("{}", e)))?;
            enigo
                .key(Key::Meta, Direction::Release)
                .map_err(|e| OutputError::TypingError(format!("{}", e)))?;
        }

        // Linux: Shift+Insert reads from PRIMARY selection — works in terminals AND GUI apps.
        #[cfg(target_os = "linux")]
        {
            enigo
                .key(Key::Shift, Direction::Press)
                .map_err(|e| OutputError::TypingError(format!("{}", e)))?;
            enigo
                .key(Key::Insert, Direction::Click)
                .map_err(|e| OutputError::TypingError(format!("{}", e)))?;
            enigo
                .key(Key::Shift, Direction::Release)
                .map_err(|e| OutputError::TypingError(format!("{}", e)))?;
        }

        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        {
            enigo
                .key(Key::Control, Direction::Press)
                .map_err(|e| OutputError::TypingError(format!("{}", e)))?;
            enigo
                .key(Key::Unicode('v'), Direction::Click)
                .map_err(|e| OutputError::TypingError(format!("{}", e)))?;
            enigo
                .key(Key::Control, Direction::Release)
                .map_err(|e| OutputError::TypingError(format!("{}", e)))?;
        }

        // Small delay for paste to complete
        std::thread::sleep(std::time::Duration::from_millis(50));

        Ok(())
    }

    fn name(&self) -> &'static str {
        "Enigo"
    }
}

impl EnigoTyper {
    /// Internal helper for typing (DRY).
    fn do_type(text: &str, settings: &Settings) -> Result<(), OutputError> {
        let mut enigo = Enigo::new(settings)
            .map_err(|e| OutputError::TypingError(format!("Failed to initialize enigo: {}", e)))?;

        enigo
            .text(text)
            .map_err(|e| OutputError::TypingError(format!("Enigo typing failed: {}", e)))?;

        Ok(())
    }
}

/// Create the appropriate typer for the current platform.
/// Now uses enigo for all platforms - unified and fast.
pub fn create_typer(_platform: super::Platform) -> Box<dyn PlatformTyper> {
    Box::new(EnigoTyper)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_platform_typer_name() {
        assert_eq!(EnigoTyper.name(), "Enigo");
    }

    #[test]
    fn test_clipboard_fallback_default() {
        assert!(EnigoTyper.supports_clipboard_fallback());
    }

    #[test]
    fn test_paste_method_exists() {
        // Paste method should exist and work (may fail without display)
        let result = EnigoTyper.paste();
        // Either succeeds or fails due to display - but method exists
        println!("Paste result: {:?}", result);
    }
}
