//! Wire-format types for the plugin's command/event contract.
//!
//! serde `camelCase` everywhere (fields *and* enum variants) so the JS side
//! (`guest-js`, Task 5) matches Rust names exactly. `specta`/ts-rs are
//! deliberately NOT used here (plan Task 3, step 2 — KISS: guest-js types
//! are hand-written); instead every type has a serde_json snapshot test
//! pinned against a fixture file under `contract/fixtures/*.json`
//! ("Гейты консистентности" #2 — one contract, one set of fixtures, read
//! from both the Rust and (later, Task 3.5/5) TS sides). A mismatch
//! between this file and a fixture is a red test in this crate, same
//! commit as the change that caused it.

use serde::{Deserialize, Serialize};

/// How a dictation session starts/stops relative to the trigger
/// (hardware hotkey on desktop, in-app keydown/keyup or overlay
/// pointerdown/up on touch — both map to the same `HotkeySpec`/`Mode`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    /// Recording lasts exactly as long as the trigger is held down.
    /// Rust-side lease (Task 3b `lease.rs`) and the 120s absolute cap
    /// apply only to this mode (plan decision 5, `[R1-Safety S4/T4]`).
    Hold,
    /// One press/click starts, a second press/click (or an explicit
    /// `stop`) ends. Requires a persistent recording indicator in the
    /// overlay (`[R1-Safety T7]`) — no lease/heartbeat needed.
    Toggle,
}

/// Opaque per-session identifier returned by `start`, referenced by every
/// other per-session command (`stop`, `cancel`, `hold_lease`).
///
/// `#[serde(transparent)]` so it serializes as a bare JSON string, not
/// `{"0": "..."}` — the frontend just sees a string id.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SessionId(pub String);

impl SessionId {
    /// Task 3 only needs *an* opaque unique id per session, not a
    /// specific UUID version; v4 (random) also matches
    /// `RecDir::new_session_path`'s `<uuid>.wav` naming so the two can
    /// share one uuid crate without meaning anything by doing so.
    pub fn new() -> Self {
        Self(uuid::Uuid::new_v4().to_string())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Default for SessionId {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Display for SessionId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Plugin-wide state, broadcast on `voxis://state`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum State {
    Idle,
    Recording,
    Transcribing,
    Error,
}

/// `voxis://level` payload — pushed at up to 20 Hz while a session is
/// `Recording` (plan decision, "события" list).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LevelEvent {
    /// Window peak of the 10 ms sub-chunk RMS values seen since the previous
    /// level tick (desktop `WindowPeakAccumulator`, iOS `LevelMath`) -- a
    /// "loudness of the loudest 10 ms" figure in [0, 1], NOT a mean RMS over
    /// the whole window. Identical on both platforms by design.
    pub rms: f32,
    /// Currently the same number as `rms` on both platforms (kept as a
    /// separate field so a true sample peak can be added without a wire
    /// change; blind review R2/SDK-swift noted the duplication). Consumers
    /// must not treat `rms` as an average.
    pub peak: f32,
    pub muted: bool,
}

/// Why a session's recording stopped — mirrors
/// `voxis_core::guard::StopReason` semantics (this crate cannot depend on
/// that type directly without enabling voxis-core's `rdev`-adjacent
/// feature surface; the plugin doesn't need the desktop-only variants
/// `Release`/`TogglePress`/`ReleasePending` that only make sense inside
/// `orchestrator`'s press/release state machine, so this is a deliberately
/// smaller, plugin-facing enum, not a re-export).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GuardOutcome {
    /// Recording stopped normally (hotkey/UI release, explicit `stop`)
    /// and was queued for transcription. Task 3's pipeline stub always
    /// reports this outcome — no guard timers run yet; Task 3b wires
    /// `voxis_core::guard::guard_step` for real silence/duration
    /// decisions (`SilenceTimeout`, `SilenceTimeoutNoSpeech`,
    /// `MaxDuration`, `StreamDied` below).
    Finalized,
    /// `StopReason::SilenceTimeout` — continuous near-silence exceeded
    /// the configured timeout, but speech was heard earlier in the take.
    SilenceTimeout,
    /// `StopReason::SilenceTimeoutNoSpeech` — same timeout, but no speech
    /// was ever heard; the pipeline discards the audio instead of
    /// transcribing pure room noise (Whisper silence hallucination risk).
    SilenceTimeoutNoSpeech,
    /// `StopReason::MaxDuration`.
    MaxDuration,
    /// Plugin-only outcome, no `StopReason` equivalent: the hold-mode
    /// heartbeat lease (`hold_lease`, Task 3b `lease.rs`) expired — 3
    /// missed 1 Hz heartbeats (`[R1-Safety S4]`).
    LeaseLost,
    /// `StopReason::Cancel` — `cancel()` was called; no transcription.
    Cancelled,
    /// `StopReason::StreamDied` — the capture backend stopped ticking
    /// `AudioCapture::level_rx` while still claiming to run (liveness
    /// check, `[R1-Arch S3]`).
    StreamDied,
}

/// `stop()`'s return value and `voxis://result`'s payload.
///
/// `session_id` (hardening-sweep review finding F2): `voxis://result` is
/// emitted AFTER the session slot is freed (`pipeline.rs::finalize`, so
/// a waiting `stop()`/`cancel()` caller observes the cleanup as already
/// visible the moment it resolves) -- which means a second session's
/// `start()` can, in principle, succeed in the small window between the
/// slot being freed and this event actually firing. Without a
/// disambiguator, a listener would have no way to tell which session a
/// given `voxis://result` belongs to in that window. Callers correlate
/// by this field, never by "the next result event after my start()" --
/// see `guest-js`'s `client.ts::dictate()` doc comment.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictationResult {
    pub session_id: SessionId,
    pub text: String,
    pub language: Option<String>,
    pub duration_ms: u64,
    pub guard_outcome: GuardOutcome,
}

/// User-facing hotkey, string form compatible with
/// `voxis_core::hotkey::parse_hotkey` (single-modifier names like
/// `"alt_r"`, `"ctrl_r"`) and `HotkeyCombo::parse` (`"Cmd+Shift+V"`).
/// This crate cannot import that parser without enabling voxis-core's
/// `rdev` feature (off by default so `tauri-plugin-voxis` itself stays
/// iOS-buildable with zero features — Task 4 turns the feature on only
/// for its desktop-only `hotkey_desktop.rs` and is expected to add a test
/// there asserting this string format round-trips through the real
/// parser); `set_hotkey` here stores the spec as-is without validating it
/// syntactically.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeySpec {
    pub key: String,
    pub mode: Mode,
}

/// How `apply_profile`/`import_profile_from_qr` derive the decryption key
/// for a `VoxisProfile` blob (`voxis_core::profile`, Task 2) — mirrors
/// `voxis_core::profile::crypto::KeySource` at the wire level (that type
/// isn't public API yet as of Task 3; this DTO is deliberately decoupled
/// so Task 2 landing doesn't force a breaking change here).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum KeySourceDto {
    /// QR transport (plan decision 6, LAN path): `k` is the 256-bit
    /// `k_qr` as base64url, `code` is the 6-digit second factor shown on
    /// the sharing device's screen.
    Qr { k: String, code: String },
    /// File transport (`.vxp`): a 5-6 word passphrase (>= 64 bits),
    /// shown once, run through Argon2id on the receiving side.
    Passphrase { phrase: String },
}

/// Result of applying an imported profile — what changed, without
/// echoing back any secret values.
///
/// `source`/`has_api_key`/`hotkey` were added in Task 6
/// (`import_profile_from_desktop`'s own acceptance: `{source: 'desktop',
/// dictionary_entries, providers, prompts, has_api_key, theme, hotkey}`)
/// — additive to Task 3's original `dictionary_entries`/`llm_providers`/
/// `llm_prompts`/`theme` fields (kept under those existing names rather
/// than renamed to "providers"/"prompts", so this stays backward
/// compatible with anything already reading the Task-3 shape).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    /// Where this profile came from: `"desktop"` (`import_profile_from_desktop`),
    /// `"qr"` (`import_profile_from_qr`), `"passphrase"`/`"qr"` (`apply_profile`,
    /// named after the `KeySourceDto` variant used), or `"manual"`
    /// (`set_provider` — a key/URL typed in directly, no sealed profile).
    pub source: String,
    pub dictionary_entries: usize,
    pub llm_providers: usize,
    pub llm_prompts: usize,
    /// Whether the imported profile carried a transcription API key
    /// (`ProfileConfig::api_key_ref.is_some()`) — never the key itself.
    pub has_api_key: bool,
    pub theme: String,
    pub hotkey: String,
}

/// `voxis://state` event name.
pub const STATE_EVENT: &str = "voxis://state";
/// `voxis://level` event name.
pub const LEVEL_EVENT: &str = "voxis://level";
/// `voxis://result` event name.
pub const RESULT_EVENT: &str = "voxis://result";
/// `voxis://error` event name -- an out-of-band error notification for
/// failures that don't have any in-flight command to reject (`[ADO-4]`:
/// `hotkey_desktop.rs`'s OS-level listener thread dying *after* its own
/// `set_hotkey` call already returned `Ok`, with no guarantee a later
/// `set_hotkey` call will ever happen to surface it). Not part of the
/// `contract/fixtures/events.json` snapshot (that fixture documents only
/// the three lifecycle events every session emits); this one is
/// deliberately out of band and best-effort.
pub const ERROR_EVENT: &str = "voxis://error";
/// `voxis://intent` event name -- an OS-originated request the host must
/// decide on, not a session lifecycle fact. Today: `{"action": "start"}`
/// when the host app's own `StartDictationIntent` (Siri / Shortcuts /
/// Action Button) fires (`docs/PLUGIN_IOS_HOST.md`). The plugin forwards
/// it to the webview instead of calling `do_start` itself on purpose: the
/// host owns consent, the no-API-key path and its own single-flight rule
/// (`[T11b]`), so an intent goes through exactly the same code a pill
/// press does. `stop` intents are NOT forwarded -- the Live Activity Stop
/// button is finalized Rust-side (`handle_live_activity_stop_intent`).
/// Out of band like `ERROR_EVENT`: not in the `events.json` snapshot.
pub const INTENT_EVENT: &str = "voxis://intent";

/// What an OS-level intent asked for, decoded from Swift's
/// `{"action": ...}` wire payload. Two sources feed the one channel:
/// the Live Activity Stop button (`StopDictationIntent`, `LiveActivity.
/// swift`) and the host app's own `StartDictationIntent` relayed via
/// `NotificationCenter` (`docs/PLUGIN_IOS_HOST.md`, `[T11b]`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IntentAction {
    Start,
    Stop,
}

impl IntentAction {
    /// `None` for an action this version does not know -- the caller logs
    /// and drops it (never guesses).
    pub fn parse(action: &str) -> Option<Self> {
        match action {
            "start" => Some(Self::Start),
            "stop" => Some(Self::Stop),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Loads and parses a fixture under `contract/fixtures/`, returning it
    /// as a `serde_json::Value` for structural comparison (so key order
    /// doesn't matter, only content).
    fn fixture(name: &str) -> serde_json::Value {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("contract/fixtures")
            .join(name);
        let raw = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("reading fixture {}: {}", path.display(), e));
        serde_json::from_str(&raw).unwrap_or_else(|e| panic!("parsing fixture {}: {}", path.display(), e))
    }

    #[test]
    fn events_snapshot_matches_fixture() {
        let value = serde_json::json!({
            "state": STATE_EVENT,
            "level": LEVEL_EVENT,
            "result": RESULT_EVENT,
        });
        assert_eq!(value, fixture("events.json"));
    }

    /// Extracts the `COMMANDS` string literals from `build.rs` — the
    /// actual source Tauri's ACL generator reads, not a copy of it.
    /// Naive `".."`-splitting is fine here: `COMMANDS`'s entries are
    /// plain `snake_case` identifiers with no escapes.
    fn build_rs_commands() -> Vec<String> {
        let build_rs = include_str!("../build.rs");
        let start = build_rs.find("const COMMANDS").expect("build.rs must define COMMANDS");
        let after_start = &build_rs[start..];
        let end = after_start.find("];").expect("COMMANDS array must be closed with '];'");
        after_start[..end].split('"').skip(1).step_by(2).map(str::to_string).collect()
    }

    #[test]
    fn commands_snapshot_matches_fixture() {
        // Cross-checks the fixture against the actual sources of truth
        // instead of a hand-typed Nth copy of the command list: `build.rs`'s
        // `COMMANDS` (what Tauri's ACL generator/`generate_handler!` sees)
        // and `permissions/default.toml` (what a host capability
        // referencing `"voxis:default"` actually grants at runtime). A
        // command added to `COMMANDS` but missing its `allow-*` entry in
        // `default.toml` — the "command is wired but every call fails the
        // ACL check" failure mode — now fails this test in the same commit.
        let fixture_commands: Vec<String> = fixture("commands.json")
            .as_array()
            .expect("commands.json must be a JSON array")
            .iter()
            .map(|v| v.as_str().expect("command entries must be strings").to_string())
            .collect();

        assert_eq!(
            build_rs_commands(),
            fixture_commands,
            "contract/fixtures/commands.json must list exactly build.rs's COMMANDS, in the same order"
        );

        let default_toml = include_str!("../permissions/default.toml");
        for command in &fixture_commands {
            let allow_permission = format!("\"allow-{}\"", command.replace('_', "-"));
            assert!(
                default_toml.contains(&allow_permission),
                "permissions/default.toml is missing {allow_permission} for command '{command}' — \
                 a host using the \"voxis:default\" capability would get an ACL 'not allowed' error \
                 calling it"
            );
        }
    }

    #[test]
    fn mode_serializes_camel_case() {
        assert_eq!(serde_json::to_value(Mode::Hold).unwrap(), serde_json::json!("hold"));
        assert_eq!(serde_json::to_value(Mode::Toggle).unwrap(), serde_json::json!("toggle"));
    }

    #[test]
    fn state_serializes_camel_case() {
        assert_eq!(serde_json::to_value(State::Idle).unwrap(), serde_json::json!("idle"));
        assert_eq!(
            serde_json::to_value(State::Transcribing).unwrap(),
            serde_json::json!("transcribing")
        );
    }

    #[test]
    fn session_id_is_a_bare_string() {
        let id = SessionId("abc-123".to_string());
        assert_eq!(serde_json::to_value(&id).unwrap(), serde_json::json!("abc-123"));
        let back: SessionId = serde_json::from_value(serde_json::json!("abc-123")).unwrap();
        assert_eq!(back, id);
    }

    #[test]
    fn session_id_new_is_unique_and_nonempty() {
        let a = SessionId::new();
        let b = SessionId::new();
        assert_ne!(a, b);
        assert!(!a.as_str().is_empty());
    }

    #[test]
    fn level_event_field_names_are_camel_case() {
        // 0.25/0.75 are exact in binary floating point (unlike 0.1/0.9),
        // so the f32 -> JSON number -> f64 round trip compares equal.
        let event = LevelEvent { rms: 0.25, peak: 0.75, muted: false };
        assert_eq!(
            serde_json::to_value(event).unwrap(),
            serde_json::json!({"rms": 0.25, "peak": 0.75, "muted": false})
        );
    }

    #[test]
    fn guard_outcome_variants_serialize_camel_case() {
        let cases = [
            (GuardOutcome::Finalized, "finalized"),
            (GuardOutcome::SilenceTimeout, "silenceTimeout"),
            (GuardOutcome::SilenceTimeoutNoSpeech, "silenceTimeoutNoSpeech"),
            (GuardOutcome::MaxDuration, "maxDuration"),
            (GuardOutcome::LeaseLost, "leaseLost"),
            (GuardOutcome::Cancelled, "cancelled"),
            (GuardOutcome::StreamDied, "streamDied"),
        ];
        for (variant, expected) in cases {
            assert_eq!(serde_json::to_value(variant).unwrap(), serde_json::json!(expected));
        }
    }

    #[test]
    fn dictation_result_snapshot_matches_fixture() {
        let result = DictationResult {
            session_id: SessionId("11111111-1111-1111-1111-111111111111".to_string()),
            text: "hello world".to_string(),
            language: Some("en".to_string()),
            duration_ms: 1500,
            guard_outcome: GuardOutcome::Finalized,
        };
        assert_eq!(serde_json::to_value(&result).unwrap(), fixture("dictation-result.json"));
    }

    #[test]
    fn hotkey_spec_round_trips() {
        let spec = HotkeySpec { key: "alt_r".to_string(), mode: Mode::Hold };
        let value = serde_json::to_value(&spec).unwrap();
        assert_eq!(value, serde_json::json!({"key": "alt_r", "mode": "hold"}));
        let back: HotkeySpec = serde_json::from_value(value).unwrap();
        assert_eq!(back, spec);
    }

    #[test]
    fn key_source_dto_qr_round_trips() {
        let ks = KeySourceDto::Qr { k: "base64url-k".to_string(), code: "123456".to_string() };
        let value = serde_json::to_value(&ks).unwrap();
        assert_eq!(
            value,
            serde_json::json!({"type": "qr", "k": "base64url-k", "code": "123456"})
        );
        let back: KeySourceDto = serde_json::from_value(value).unwrap();
        assert_eq!(back, ks);
    }

    #[test]
    fn key_source_dto_passphrase_round_trips() {
        let ks = KeySourceDto::Passphrase { phrase: "correct horse battery staple extra".to_string() };
        let value = serde_json::to_value(&ks).unwrap();
        assert_eq!(
            value,
            serde_json::json!({"type": "passphrase", "phrase": "correct horse battery staple extra"})
        );
        let back: KeySourceDto = serde_json::from_value(value).unwrap();
        assert_eq!(back, ks);
    }

    #[test]
    fn import_summary_fields_are_camel_case() {
        let summary = ImportSummary {
            source: "desktop".to_string(),
            dictionary_entries: 3,
            llm_providers: 1,
            llm_prompts: 2,
            has_api_key: true,
            theme: "default".to_string(),
            hotkey: "alt_r".to_string(),
        };
        assert_eq!(
            serde_json::to_value(&summary).unwrap(),
            serde_json::json!({
                "source": "desktop",
                "dictionaryEntries": 3,
                "llmProviders": 1,
                "llmPrompts": 2,
                "hasApiKey": true,
                "theme": "default",
                "hotkey": "alt_r",
            })
        );
    }
}
