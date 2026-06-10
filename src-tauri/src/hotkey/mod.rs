//! Hotkey module using rdev for low-level keyboard events.
//!
//! Unlike tauri-plugin-global-shortcut, rdev can detect single modifier
//! key presses/releases (e.g., alt_r, ctrl_r) which is required for
//! Python soupawhisper compatibility.
//!
//! Follows SRP: Only handles hotkey detection, no recording logic.
//! DRY: Uses KEY_TABLE for both parsing and u32 conversion.

use rdev::{listen, Event, EventType, Key};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter};

// =============================================================================
// Key Table (DRY: Single source of truth for key mappings)
// =============================================================================

/// Key mapping entry: (aliases, Key variant, u32 id for atomic storage)
struct KeyEntry {
    aliases: &'static [&'static str],
    key: Key,
    id: u32,
}

/// Static table of all supported keys.
/// DRY: Both parse_hotkey() and key_to_u32() use this table.
static KEY_TABLE: &[KeyEntry] = &[
    // Modifiers (IDs 1-8)
    KeyEntry {
        aliases: &["alt_r", "alt_gr", "altgr"],
        key: Key::AltGr,
        id: 2,
    },
    KeyEntry {
        aliases: &["ctrl_r", "control_r"],
        key: Key::ControlRight,
        id: 4,
    },
    KeyEntry {
        aliases: &["shift_r"],
        key: Key::ShiftRight,
        id: 6,
    },
    KeyEntry {
        aliases: &["alt_l", "alt"],
        key: Key::Alt,
        id: 1,
    },
    KeyEntry {
        aliases: &["ctrl_l", "ctrl", "control_l", "control"],
        key: Key::ControlLeft,
        id: 3,
    },
    KeyEntry {
        aliases: &["shift_l", "shift"],
        key: Key::ShiftLeft,
        id: 5,
    },
    KeyEntry {
        aliases: &["super_r", "cmd_r", "meta_r"],
        key: Key::MetaRight,
        id: 8,
    },
    KeyEntry {
        aliases: &["super_l", "super", "cmd_l", "cmd", "meta_l", "meta"],
        key: Key::MetaLeft,
        id: 7,
    },
    // Function keys (IDs 11-22)
    KeyEntry {
        aliases: &["f1"],
        key: Key::F1,
        id: 11,
    },
    KeyEntry {
        aliases: &["f2"],
        key: Key::F2,
        id: 12,
    },
    KeyEntry {
        aliases: &["f3"],
        key: Key::F3,
        id: 13,
    },
    KeyEntry {
        aliases: &["f4"],
        key: Key::F4,
        id: 14,
    },
    KeyEntry {
        aliases: &["f5"],
        key: Key::F5,
        id: 15,
    },
    KeyEntry {
        aliases: &["f6"],
        key: Key::F6,
        id: 16,
    },
    KeyEntry {
        aliases: &["f7"],
        key: Key::F7,
        id: 17,
    },
    KeyEntry {
        aliases: &["f8"],
        key: Key::F8,
        id: 18,
    },
    KeyEntry {
        aliases: &["f9"],
        key: Key::F9,
        id: 19,
    },
    KeyEntry {
        aliases: &["f10"],
        key: Key::F10,
        id: 20,
    },
    KeyEntry {
        aliases: &["f11"],
        key: Key::F11,
        id: 21,
    },
    KeyEntry {
        aliases: &["f12"],
        key: Key::F12,
        id: 22,
    },
    // Common keys (IDs 30-45)
    KeyEntry {
        aliases: &["space"],
        key: Key::Space,
        id: 30,
    },
    KeyEntry {
        aliases: &["enter", "return"],
        key: Key::Return,
        id: 31,
    },
    KeyEntry {
        aliases: &["tab"],
        key: Key::Tab,
        id: 32,
    },
    KeyEntry {
        aliases: &["escape", "esc"],
        key: Key::Escape,
        id: 33,
    },
    KeyEntry {
        aliases: &["backspace"],
        key: Key::Backspace,
        id: 34,
    },
    KeyEntry {
        aliases: &["delete", "del"],
        key: Key::Delete,
        id: 35,
    },
    KeyEntry {
        aliases: &["home"],
        key: Key::Home,
        id: 36,
    },
    KeyEntry {
        aliases: &["end"],
        key: Key::End,
        id: 37,
    },
    KeyEntry {
        aliases: &["page_up", "pageup"],
        key: Key::PageUp,
        id: 38,
    },
    KeyEntry {
        aliases: &["page_down", "pagedown"],
        key: Key::PageDown,
        id: 39,
    },
    KeyEntry {
        aliases: &["caps_lock", "capslock"],
        key: Key::CapsLock,
        id: 40,
    },
    KeyEntry {
        aliases: &["insert"],
        key: Key::Insert,
        id: 41,
    },
    KeyEntry {
        aliases: &["pause"],
        key: Key::Pause,
        id: 42,
    },
    KeyEntry {
        aliases: &["print_screen", "printscreen"],
        key: Key::PrintScreen,
        id: 43,
    },
    KeyEntry {
        aliases: &["scroll_lock", "scrolllock"],
        key: Key::ScrollLock,
        id: 44,
    },
    KeyEntry {
        aliases: &["num_lock", "numlock"],
        key: Key::NumLock,
        id: 45,
    },
];

/// Modifier keys used in user-facing hotkey combos like "Cmd+Shift+R".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HotkeyModifier {
    Cmd,
    Ctrl,
    Alt,
    Shift,
    Super,
}

impl std::fmt::Display for HotkeyModifier {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HotkeyModifier::Cmd => write!(f, "Cmd"),
            HotkeyModifier::Ctrl => write!(f, "Ctrl"),
            HotkeyModifier::Alt => write!(f, "Alt"),
            HotkeyModifier::Shift => write!(f, "Shift"),
            HotkeyModifier::Super => write!(f, "Super"),
        }
    }
}

/// Parsed user-facing hotkey combo like "Cmd+Shift+R".
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HotkeyCombo {
    pub modifiers: Vec<HotkeyModifier>,
    pub key: String,
}

impl HotkeyCombo {
    /// Parse a combo hotkey string (e.g. "Cmd+Shift+R").
    pub fn parse(input: &str) -> Result<Self, HotkeyParseError> {
        let parts: Vec<&str> = input
            .split('+')
            .map(str::trim)
            .filter(|part| !part.is_empty())
            .collect();

        if parts.len() < 2 {
            return Err(HotkeyParseError::InvalidFormat(input.to_string()));
        }

        let mut modifiers = Vec::new();
        for modifier in &parts[..parts.len() - 1] {
            let parsed = match modifier.to_ascii_lowercase().as_str() {
                "cmd" | "command" | "meta" => HotkeyModifier::Cmd,
                "ctrl" | "control" => HotkeyModifier::Ctrl,
                "alt" => HotkeyModifier::Alt,
                "shift" => HotkeyModifier::Shift,
                "super" => HotkeyModifier::Super,
                other => return Err(HotkeyParseError::UnknownModifier(other.to_string())),
            };
            if !modifiers.contains(&parsed) {
                modifiers.push(parsed);
            }
        }

        let key = parts[parts.len() - 1];
        if key.is_empty() {
            return Err(HotkeyParseError::MissingKey);
        }

        Ok(Self {
            modifiers,
            key: key.to_string(),
        })
    }
}

impl std::fmt::Display for HotkeyCombo {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mut parts: Vec<String> = self.modifiers.iter().map(ToString::to_string).collect();
        parts.push(self.key.clone());
        write!(f, "{}", parts.join("+"))
    }
}

/// Errors when parsing combo hotkeys.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HotkeyParseError {
    InvalidFormat(String),
    UnknownModifier(String),
    MissingKey,
}

impl std::fmt::Display for HotkeyParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HotkeyParseError::InvalidFormat(input) => {
                write!(f, "Invalid hotkey format: '{}'", input)
            }
            HotkeyParseError::UnknownModifier(modifier) => {
                write!(f, "Unknown hotkey modifier: '{}'", modifier)
            }
            HotkeyParseError::MissingKey => write!(f, "Hotkey key part is missing"),
        }
    }
}

impl std::error::Error for HotkeyParseError {}

/// Parse Python-style hotkey string to rdev Key.
///
/// Supports:
/// - Single modifiers: "alt_r", "alt_l", "ctrl_r", "ctrl_l", "shift_r", "shift_l"
/// - Function keys: "f1" through "f12"
/// - Common keys: "space", "enter", "tab", "escape"
pub fn parse_hotkey(name: &str) -> Option<Key> {
    let name_lower = name.to_lowercase();
    let name_trimmed = name_lower.trim();

    KEY_TABLE
        .iter()
        .find(|entry| entry.aliases.contains(&name_trimmed))
        .map(|entry| entry.key)
}

/// Convert Key to u32 for atomic storage.
fn key_to_u32(key: Key) -> u32 {
    KEY_TABLE
        .iter()
        .find(|entry| entry.key == key)
        .map(|entry| entry.id)
        .unwrap_or(0)
}

/// Hotkey listener state.
pub struct HotkeyListener {
    /// Whether the listener thread should stop.
    should_stop: Arc<AtomicBool>,
    /// Current target key (atomic for dynamic updates).
    target_key: Arc<AtomicU32>,
}

impl HotkeyListener {
    /// Create a new hotkey listener.
    pub fn new() -> Self {
        Self {
            should_stop: Arc::new(AtomicBool::new(false)),
            target_key: Arc::new(AtomicU32::new(0)),
        }
    }

    /// Start listening for hotkey events in a background thread.
    ///
    /// Emits "hotkey-pressed" and "hotkey-released" events to the app.
    pub fn start(&self, app: AppHandle, hotkey: &str) {
        let target = match parse_hotkey(hotkey) {
            Some(k) => k,
            None => {
                tracing::warn!("Unknown hotkey: '{}', using default (ctrl_r)", hotkey);
                Key::ControlRight
            }
        };

        let target_u32 = key_to_u32(target);
        self.target_key.store(target_u32, Ordering::SeqCst);

        tracing::info!(
            "Starting hotkey listener for: {} ({:?}, id={})",
            hotkey,
            target,
            target_u32
        );

        let should_stop = Arc::clone(&self.should_stop);
        let target_key = Arc::clone(&self.target_key);

        thread::spawn(move || {
            let mut is_pressed = false;
            let mut last_pressed_key: Option<Key> = None;

            let callback = move |event: Event| {
                if should_stop.load(Ordering::SeqCst) {
                    return;
                }

                let current_target = target_key.load(Ordering::SeqCst);

                match event.event_type {
                    EventType::KeyPress(key) => {
                        let key_id = key_to_u32(key);
                        if key_id == current_target && key_id != 0 && !is_pressed {
                            is_pressed = true;
                            last_pressed_key = Some(key);
                            tracing::debug!("Hotkey pressed: {:?}", key);
                            if let Err(e) = app.emit("hotkey-pressed", ()) {
                                tracing::error!("Failed to emit hotkey-pressed: {}", e);
                            }
                        }
                    }
                    EventType::KeyRelease(key) if is_pressed && last_pressed_key == Some(key) => {
                        is_pressed = false;
                        last_pressed_key = None;
                        tracing::debug!("Hotkey released: {:?}", key);
                        if let Err(e) = app.emit("hotkey-released", ()) {
                            tracing::error!("Failed to emit hotkey-released: {}", e);
                        }
                    }
                    _ => {}
                }
            };

            tracing::info!("Hotkey listener thread: starting rdev::listen");

            // Fix for macOS: inform rdev we're NOT on main thread so it uses
            // dispatch queue for TSMGetInputSourceProperty calls (PR #147)
            #[cfg(target_os = "macos")]
            rdev::set_is_main_thread(false);

            if let Err(e) = listen(callback) {
                tracing::error!("Hotkey listener failed: {:?}", e);
            }
            tracing::warn!("Hotkey listener thread: rdev::listen exited");
        });
    }

    /// Stop the hotkey listener.
    pub fn stop(&self) {
        self.should_stop.store(true, Ordering::SeqCst);
    }

    /// Change the hotkey without restarting the listener thread.
    pub fn set_hotkey(&self, hotkey: &str) {
        let target = match parse_hotkey(hotkey) {
            Some(k) => k,
            None => {
                tracing::warn!("Unknown hotkey: '{}', using default (ctrl_r)", hotkey);
                Key::ControlRight
            }
        };

        let target_u32 = key_to_u32(target);
        tracing::info!(
            "Changing hotkey to: {} ({:?}, id={})",
            hotkey,
            target,
            target_u32
        );
        self.target_key.store(target_u32, Ordering::SeqCst);
    }

    /// Restart the hotkey listener with a new hotkey.
    /// Note: This just updates the target key atomically, no thread restart needed.
    pub fn restart(&mut self, _app: AppHandle, hotkey: &str) {
        self.set_hotkey(hotkey);
    }
}

impl Default for HotkeyListener {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests;
