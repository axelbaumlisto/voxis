//! Hotkey module using rdev for low-level keyboard events.
//!
//! Unlike tauri-plugin-global-shortcut, rdev can detect single modifier
//! key presses/releases (e.g., alt_r, ctrl_r) which is required for
//! Python soupawhisper compatibility.
//!
//! Follows SRP: Only handles hotkey detection, no recording logic.
//! DRY: Uses KEY_TABLE for both parsing and u32 conversion.
//!
//! Task 1b moved this module here from `voice_lib::hotkey`, gated behind
//! the `rdev` Cargo feature (off by default, so `voxis-core` stays
//! rdev-free for the iOS build). The original module was tauri-coupled
//! (`HotkeyListener::start(&self, app: AppHandle, hotkey: &str)` emitting
//! `"hotkey-pressed"`/`"hotkey-released"` directly) — this crate must not
//! depend on tauri at all, so notification is now via the `HotkeySink`
//! trait below. `voice_lib::hotkey` keeps a thin `TauriHotkeySink` adapter
//! plus a `HotkeyListener` wrapper with the exact old
//! `start(&self, app: AppHandle, hotkey: &str)` signature, so its own
//! callers (`setup/state.rs`, `config/change_handler.rs`) compile
//! unchanged.
//!
//! ## What this listens to, and the risk that comes with it
//!
//! `rdev::listen` installs an OS-level keyboard hook. The process then
//! receives the machine's WHOLE keystroke stream — not only the keys aimed at
//! Voxis. That is inherent to a GLOBAL hotkey (the point is to start
//! dictation while another window has focus), and it is why the filter lives
//! in OUR code rather than in the kernel. Three consequences, stated as facts
//! rather than as reassurance:
//!
//! - **Only key press/release is ever looked at.** rdev also delivers mouse
//!   moves, button presses and wheel events; the callback's `_ => {}` arm
//!   drops every one of them without inspecting it.
//! - **Only the configured key produces a notification.** The callback
//!   compares the key against the configured target BEFORE anything observes
//!   the event, and nothing is buffered, recorded or forwarded — a press or a
//!   release is all a sink can ever receive. That order is not a convention
//!   this comment asks you to keep: it is pinned by a source-text gate
//!   (`tests/hotkey_listener_source_gate.rs`) that reads this file and goes
//!   red if a log or a sink call moves ahead of the comparison. The tempting
//!   "let me log what arrives while I debug this" edit is exactly how
//!   dictation would become a keylogger.
//! - **Corporate EDR/MDM and some antivirus products classify this behaviour
//!   as a keylogger**, which is what an unfiltered keyboard hook looks like
//!   from the outside. Worth knowing before deploying into a managed fleet.
//!
//! ## Platform facts (each is a real limitation, not a bug to file)
//!
//! - **macOS**: needs the Input Monitoring (or Accessibility) permission, and
//!   the system prompt reads as "wants to observe your keystrokes". Without
//!   that grant `rdev::listen` fails and the hotkey silently never fires; the
//!   failure IS logged (never swallowed), but nothing else surfaces it.
//! - **Linux**: works through X11 (XRecord). Under **Wayland** the events
//!   never arrive, so the hotkey will not fire whatever is configured. That is
//!   the platform lacking the API, not a defect here — say so in the UI/docs
//!   rather than leaving the user to conclude the app is broken.
//! - **iOS/iPadOS**: `rdev` is not compiled at all (optional dependency behind
//!   the `rdev` feature; `cargo build -p voxis-core --target
//!   aarch64-apple-ios` never touches it) AND the OS grants no app a global
//!   hotkey in the first place — not even with a Bluetooth keyboard attached.
//!   On a tablet the in-app button and hold-to-talk remain the only ways in.
//!
//! ## Stopping is not instant, and this doc says so instead of pretending
//!
//! `rdev::listen` blocks forever and offers no way to interrupt it on any of
//! the three desktop platforms, so [`HotkeyListener::stop`] flips the flag the
//! callback reads and the thread exits **on the first event after that** —
//! the next key typed anywhere. Until that event arrives the OS hook is still
//! installed and rdev still hands it the event; the callback returns before
//! looking at it, so a stopped listener notifies nothing (tested in
//! `hotkey::tests`). But "I turned it off, so it stopped watching" would be
//! false: one further keystroke is still delivered to a process that no longer
//! wants it. Callers that must not leave even that window open have one lever
//! — never arm the listener in the first place (see
//! [`HotkeyListener::start`]).

use rdev::{listen, Event, EventType, Key};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

/// Notified on hotkey press/release by [`HotkeyListener`]. Replaces the
/// original direct `AppHandle::emit("hotkey-pressed"/"hotkey-released")`
/// calls — this crate has no `tauri` dependency, so the listener notifies
/// through this trait instead and leaves emitting actual Tauri events to
/// whatever adapter the caller supplies (see `voice_lib::hotkey::
/// TauriHotkeySink`).
pub trait HotkeySink: Send + Sync + 'static {
    fn on_pressed(&self);
    fn on_released(&self);
}

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

/// Repair the keys `rdev` delivers under a name it does not know.
///
/// `rdev`'s macOS keycode table (`src/macos/keycodes.rs`, `key_from_code`)
/// maps `CONTROL_LEFT`, `META_RIGHT`, `SHIFT_RIGHT`… but has NO arm for
/// keycode 62 (Right Control), so a physical right-Ctrl press arrives as
/// `Key::Unknown(62)` and can never match a `ctrl_r` hotkey. Found live:
/// the owner's Voxis stayed silent on right Ctrl while left Ctrl worked,
/// and a WebKit key probe proved the OS itself sent a clean `ControlRight`.
///
/// Every rdev-fed listener (the desktop app's `hotkey_callback` and the
/// plugin's `RdevHotkey`) must pass each key through here BEFORE matching.
/// The mapping is macOS-only because the code 62 is a macOS virtual keycode;
/// on other platforms `Unknown(62)` means whatever it means there.
///
/// Upstream: `Narsil/rdev` PR #196 ("fix: derive macOS modifier state from
/// keycode", open since 2026-07) adds `CONTROL_RIGHT => Key::ControlRight`
/// to `key_from_code` among other right-modifier fixes. When a release of
/// `rdev` carries it, the `Unknown(62)` arm here becomes a no-op and the
/// test `right_control_arrives_as_unknown_62_and_still_matches_ctrl_r` keeps
/// proving the seam either way.
/// Not duplicating that PR (E2 of `.pi/plans/ideal.md`, 2026-09-19).
pub fn normalize_rdev_key(key: Key) -> Key {
    match key {
        #[cfg(target_os = "macos")]
        Key::Unknown(62) => Key::ControlRight,
        other => other,
    }
}

/// Convert Key to u32 for atomic storage.
fn key_to_u32(key: Key) -> u32 {
    KEY_TABLE
        .iter()
        .find(|entry| entry.key == key)
        .map(|entry| entry.id)
        .unwrap_or(0)
}

/// Whether `hotkey` names something to listen FOR at all.
///
/// An empty (or whitespace-only) hotkey means "nothing configured", and
/// arming the OS-level hook for it would mean watching every keystroke on the
/// machine to match a key nobody asked for — precisely the window this module
/// exists to keep shut. A NON-empty but unknown name is a different case and
/// keeps its historical behaviour (see [`HotkeyListener::start_with_thread_init`]):
/// it falls back to `ctrl_r` with a warning.
pub fn hotkey_is_configured(hotkey: &str) -> bool {
    !hotkey.trim().is_empty()
}

/// The callback `rdev::listen` drives for every OS event.
///
/// Extracted from the listener thread's body on purpose: `rdev::listen` blocks
/// forever and cannot be fed synthetic events, so a filter that stayed inside
/// the thread closure could only ever be READ, never TESTED. Everything that
/// decides "is this event our hotkey?" is here; the thread below only wires it
/// up, and the tests drive this directly with synthetic [`Event`]s.
///
/// The order inside IS the safety property: stop-flag check, then the
/// target-key comparison, and only then any logging or sink notification. See
/// the module doc — a log ahead of that comparison turns dictation into a
/// keylogger, and `tests/hotkey_listener_source_gate.rs` pins the order by
/// reading this file's own text.
fn hotkey_callback(
    sink: Arc<dyn HotkeySink>,
    target_key: Arc<AtomicU32>,
    should_stop: Arc<AtomicBool>,
) -> impl FnMut(Event) + Send + 'static {
    let mut is_pressed = false;
    let mut last_pressed_key: Option<Key> = None;

    move |event: Event| {
        if should_stop.load(Ordering::SeqCst) {
            return;
        }

        let current_target = target_key.load(Ordering::SeqCst);

        match event.event_type {
            EventType::KeyPress(key) => {
                let key = normalize_rdev_key(key);
                let key_id = key_to_u32(key);
                if key_id == current_target && key_id != 0 && !is_pressed {
                    is_pressed = true;
                    last_pressed_key = Some(key);
                    tracing::debug!("Hotkey pressed: {:?}", key);
                    sink.on_pressed();
                }
            }
            EventType::KeyRelease(raw) => {
                let key = normalize_rdev_key(raw);
                if is_pressed && last_pressed_key == Some(key) {
                    is_pressed = false;
                    last_pressed_key = None;
                    tracing::debug!("Hotkey released: {:?}", key);
                    sink.on_released();
                }
            }
            _ => {}
        }
    }
}

/// Hotkey listener state.
pub struct HotkeyListener {
    /// The stop flag of the CURRENT listener thread, replaced on every
    /// [`Self::start`].
    ///
    /// Deliberately NOT one flag shared by every thread this instance ever
    /// spawns: `rdev::listen` cannot be interrupted, so a thread abandoned by
    /// [`Self::stop`] stays alive until its next event. With a single shared
    /// flag, re-arming would clear that flag and silently wake the abandoned
    /// thread back up — two OS hooks and two notifications per press. A
    /// per-thread flag leaves the abandoned thread inert for good.
    stop_flag: Mutex<Arc<AtomicBool>>,
    /// Current target key (atomic for dynamic updates).
    target_key: Arc<AtomicU32>,
    /// Whether a listener thread is armed right now; makes [`Self::start`]
    /// idempotent (see the method doc for why one hook at a time matters).
    armed: AtomicBool,
}

impl HotkeyListener {
    /// Create a new hotkey listener.
    pub fn new() -> Self {
        Self {
            stop_flag: Mutex::new(Arc::new(AtomicBool::new(false))),
            target_key: Arc::new(AtomicU32::new(0)),
            armed: AtomicBool::new(false),
        }
    }

    /// Start listening for hotkey events in a background thread.
    ///
    /// Notifies `sink` on press/release (see [`HotkeySink`]). Equivalent to
    /// `start_with_thread_init(sink, hotkey, || {})` — use that instead if
    /// the caller needs a hook to run at the very top of the background
    /// thread (`voice_lib` uses it to install its crash-diagnostics
    /// altstack, a voice_lib-only concern this crate has no module for).
    pub fn start(&self, sink: Arc<dyn HotkeySink>, hotkey: &str) -> bool {
        self.start_with_thread_init(sink, hotkey, || {})
    }

    /// Same as [`Self::start`], but runs `on_thread_start` once at the top
    /// of the background listener thread, before `rdev::listen` blocks —
    /// mirrors the `on_thread_start` hook `voice_lib`'s own tokio runtime
    /// builder uses everywhere else to install its fatal-signal altstack.
    /// Defaults to a no-op via `start` for callers (this crate's own
    /// tests, any future non-voice_lib consumer) that don't need it.
    ///
    /// Returns whether THIS call armed a listener. `false` means the OS-level
    /// hook was NOT installed, for one of two reasons:
    ///
    /// - **no hotkey is configured** ([`hotkey_is_configured`]): arming a
    ///   global keyboard hook for a key nobody asked for is exactly the
    ///   capture window this module tries to keep shut, so it refuses;
    /// - **a listener is already armed** ([`Self::is_armed`]): a second
    ///   `rdev::listen` would mean a second OS hook and every press reported
    ///   twice. Start is therefore idempotent — to CHANGE the key of a running
    ///   listener use [`Self::set_hotkey`], and to re-arm after
    ///   [`Self::stop`] wait for the stopped thread to exit (it does so on its
    ///   next event; see the module doc) or build a fresh listener.
    ///
    /// A NON-empty but unknown key name keeps its historical behaviour: it
    /// warns and falls back to `ctrl_r`, so `false` is never returned for a
    /// merely misspelled hotkey.
    pub fn start_with_thread_init(
        &self,
        sink: Arc<dyn HotkeySink>,
        hotkey: &str,
        on_thread_start: impl Fn() + Send + 'static,
    ) -> bool {
        if !hotkey_is_configured(hotkey) {
            tracing::warn!(
                "Hotkey is not configured; NOT starting the global key listener \
                 (an armed listener receives every keystroke on this machine)"
            );
            return false;
        }

        if self.armed.swap(true, Ordering::SeqCst) {
            tracing::warn!(
                hotkey = %hotkey,
                "Hotkey listener is already running; ignoring this start \
                 (use set_hotkey to change the key)"
            );
            return false;
        }

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

        // A flag of THIS thread only — see the field doc for the two-hooks
        // hazard a shared one would create.
        let should_stop = Arc::new(AtomicBool::new(false));
        *self.stop_flag.lock().unwrap() = Arc::clone(&should_stop);
        let target_key = Arc::clone(&self.target_key);

        thread::spawn(move || {
            on_thread_start();
            let callback = hotkey_callback(sink, target_key, should_stop);

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

        true
    }

    /// Whether a listener is armed right now.
    ///
    /// `true` between a successful [`Self::start`] and the matching
    /// [`Self::stop`] — NOT "the OS hook is gone", which only happens when the
    /// stopped thread takes its next event (see the module doc).
    pub fn is_armed(&self) -> bool {
        self.armed.load(Ordering::SeqCst)
    }

    /// Stop the hotkey listener.
    ///
    /// Flips the CURRENT thread's flag; that thread exits on its next event
    /// (`rdev::listen` cannot be interrupted — see the module doc), and until
    /// then it returns without inspecting anything. Idempotent, and safe to
    /// call when nothing was ever started.
    pub fn stop(&self) {
        self.stop_flag.lock().unwrap().store(true, Ordering::SeqCst);
        self.armed.store(false, Ordering::SeqCst);
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
}

impl Default for HotkeyListener {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests;
