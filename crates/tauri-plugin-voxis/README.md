# `tauri-plugin-voxis`

Voxis dictation as an embeddable Tauri 2 plugin: hotkey/tap → record → guard
(silence/max-duration) → transcribe (Groq-compatible Whisper HTTP) →
dictionary → optional LLM post-process → text handed back to the **host**.
Desktop (macOS/Linux/Windows via `cpal` + `rdev`) and iOS (`AVAudioEngine` +
Keychain) share one Rust core (`voxis-core`) and one command/event contract.

This is the author-facing reference for a Tauri host embedding the plugin.
The design rationale (why each decision was made) lives in
`.pi/plans/tauri-plugin-voxis.md`; `docs/PLUGIN.md` covers the
architecture/guarantees/test-gates from the whole-project point of view;
`docs/PLUGIN_IOS_HOST.md` is the iOS-specific host checklist this README
only summarizes.

**Status**: desktop + iOS Simulator tracer bullets have run with a real
microphone and real Groq; a live-iPad end-to-end run exists (see
`research/plugin-plan/T11_ipad_run_2026-09-16.md`) driving this plugin from
a real host (`naked`) — that integration work is not itself part of this
crate/repo. `guest-js` is versioned separately (`@voxis/tauri-plugin-voxis`,
currently `0.6.0`) and is **not** on the same version number as this Rust
crate (currently `0.6.0`) — bump each independently when either changes.

## Installation

This crate is not published to crates.io. Hosts depend on it as a git
dependency against this repo's private Forgejo remote (`zverozabr/voxis`,
`https://clipshot.cc/git/`):

```toml
# host's src-tauri/Cargo.toml
[dependencies]
tauri-plugin-voxis = { git = "https://clipshot.cc/git/zverozabr/voxis.git", rev = "<commit>", features = ["desktop"] }
voxis-core = { git = "https://clipshot.cc/git/zverozabr/voxis.git", rev = "<commit>" }
```

- Pin by commit `rev`, not a branch — this crate has no crates.io releases
  and no semver guarantees between commits yet. Until the tag lands pin by
  `rev`; the tag `plugin-v0.1.0` will mark the first hosted release
  (naked).
- **Forgejo repo is private** — a CI/CD host that clones a Cargo git
  dependency (rather than building on a developer machine with existing SSH
  keys/tokens) needs its own credentials (PAT secret, git submodule with
  embedded token, or a `.netrc`/`insteadOf` rewrite). naked's own attempt at
  this integration hit exactly this wall — see
  `.pi/plans/tauri-plugin-voxis.md`'s Task 10 status: "CI-блокер — voxis
  приватный на Forgejo, docker-джобы naked не достанут git-dep без auth
  (решение владельца)". Resolve this before wiring CI for any third host.
- **Cargo feature `desktop`**: turns on `cpal` (capture) + `rdev` (global
  hotkey listener) — required for `init_desktop()`/`init_desktop_with()`.
  Off by default so `cargo build -p tauri-plugin-voxis --target
  aarch64-apple-ios` stays free of desktop-only native deps
  (`scripts/check-ios-build.sh` is the enforcing gate in this repo).
- **iOS**: no separate Cargo feature — the plugin's `build.rs` vendors
  Tauri's Swift API package and links `libtauri_plugin_voxis.a`
  automatically whenever the actual build target is
  `aarch64-apple-ios`/`aarch64-apple-ios-sim` on a macOS host. The **host's**
  own iOS project (`cargo tauri ios init`, `gen/apple/`, XcodeGen-managed
  `project.yml`) is the host's own responsibility — see
  `docs/PLUGIN_IOS_HOST.md` for the full checklist (`Info.plist` keys,
  `xcodegen generate` gotchas, Live Activity wiring). Minimum iOS version is
  **16.0** (`ios/Package.swift`'s `platforms: [.iOS(.v16)]`); iOS 17+ adds
  the system mic-mute signal and the Live Activity Stop button, each gated
  with `#available(iOS 17.0, *)` at its call site.

## Registering the plugin (`init*` variants)

All variants return a `tauri::plugin::TauriPlugin<R>` for `.plugin(...)`:

| Function | Capture backend | Hotkey backend | `SecretStore` | Use when |
|---|---|---|---|---|
| `init()` | **platform dispatch**: `desktop::CpalCapture` (feature `desktop`) / `mobile::IosCapture` (iOS) / `UnsupportedCapture` (anything else — `start` refuses with `unsupportedPlatform`) | per platform | `FileSecretStore` / Keychain / `None` | the safe default for a host that does not care about variants |
| `init_with(secrets)` | same platform dispatch | per platform | host-supplied | **the recommended one-liner for a multi-platform host** (naked) |
| `init_unsupported_with(secrets?)` | `UnsupportedCapture` — every command but `start` works; `start` → `unsupportedPlatform` before any session | none | host-supplied or `None` | a platform without a backend (none of the shipped targets today), explicitly |
| `init_mock()` / `init_mock_with(secrets)` | `MockCapture` test double | none | `FileSecretStore` / host-supplied | harnesses, tracer bullets, fake-stt smokes — **never production** (was `init`/`init_with` before 0.4.0: naked/Android shipped the double by accident) |
| `init_with_capture(capture)` | host-supplied `Arc<dyn AudioCapture>` | none | `FileSecretStore` | pre-scripted `MockCapture` (fixture-driven tests) |
| `init_with_capture_and_secrets(secrets, capture)` | host-supplied | none | host-supplied | same, with a host secret store too |
| `init_desktop()` *(feature `desktop`)* | `desktop::CpalCapture` | `hotkey_desktop::RdevHotkey` | `FileSecretStore` | **desktop production**, no host secret store |
| `init_desktop_with(secrets)` *(feature `desktop`)* | `desktop::CpalCapture` | `hotkey_desktop::RdevHotkey` | host-supplied | **desktop production** (recommended: always inject the host's own `SecretStore`) |
| `init_ios()` | `mobile::IosCapture` (Swift `AudioCapture`, `AVAudioEngine`) | none (iOS has no OS-level global-hotkey backend) | `mobile::IosKeychainSecretStore` | iOS with the default Keychain store |
| `init_ios_with(Some(secrets))` / `init_ios_with(None)` | same | none | host-supplied, or `None` for the Keychain default | **iOS production** |
| `init_android_with(Some(secrets))` / `init_android_with(None)` | `mobile::MobileCapture` (Kotlin `VoxisAudioCapture`, `AudioRecord` 16 kHz `VOICE_RECOGNITION`) | none | host-supplied, or `None` for the 0600-JSON `FileSecretStore` | **Android production** (C1, 0.5.0). `RECORD_AUDIO` runtime grant is requested inside the first `start`; denial → `permissionDenied`. |

A host should always inject its own `SecretStore` (`init_*_with`, not the
bare `init*`) unless it genuinely has none — `FileSecretStore` is a
documented 0600-file fallback, not a real OS keychain, and warns at
construction time (`secrets.rs`'s module doc). naked's own integration uses
`init_desktop_with(NakedVoxisSecretStoreAdapter)` wrapping its existing
`naked_core::SecretStore` (envelope-encrypted).

```rust
// src-tauri/src/lib.rs (desktop host)
tauri::Builder::default()
    .plugin(tauri_plugin_voxis::init_desktop_with(my_secret_store))
    .run(tauri::generate_context!())
```

### `SecretStore` — why the host provides its own

The plugin never writes API keys/bearer credentials into sqlite
(`[R1-Safety S2]`). It defines:

```rust
pub trait SecretStore: Send + Sync {
    fn get(&self, name: &str) -> SecretResult<Option<Secret>>;
    fn set(&self, name: &str, value: &Secret) -> SecretResult<()>;
    fn delete(&self, name: &str) -> SecretResult<()>;
}
```

`Secret` (from `voxis-core::profile`) is a newtype whose `Debug` is
`[REDACTED]` — the only way to read the wrapped value is `Secret::expose()`,
called only at the actual serialization boundary. A host that already has
its own encrypted secret store (naked's `naked_core::SecretStore`) should
adapt it to this trait and pass it via `init_*_with`; a host with none gets
`FileSecretStore` (desktop, 0600 JSON) or `KeychainSecretStore`
(iOS, `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`) for free.

## Capabilities

Grant `voxis:default` in the host's capability file
(`src-tauri/capabilities/*.json`) — the same convention as any other Tauri 2
plugin permission set. `permissions/` in this crate is autogenerated
(`build.rs`) from the command list below; there is no finer-grained
permission split today (all-or-nothing per host window).

## Commands

Every command is `Result<T, PluginError>`; see "Errors" below for the
`{kind, message, ...}` shape every rejection takes. Source of truth:
`crates/tauri-plugin-voxis/contract/fixtures/commands.json` +
`src/commands.rs`.

| Command | Signature (conceptual) | Notes |
|---|---|---|
| `start` | `(mode: "hold" \| "toggle") -> SessionId` | Single-flight: a second `start()` while a session is active rejects `alreadyRecording`. Refuses until `set_consent(true)` for the current (host, provider) pair — `consentRequired`. |
| `stop` | `(sessionId) -> DictationResult { sessionId, text, language?, durationMs, guardOutcome }` | Finalizes: capture → guard decision → transcription → dictionary → optional LLM. `guardOutcome` is one of `finalized` \| `silenceTimeoutNoSpeech` \| `streamDied` \| … (guard vocabulary shared with desktop Voxis). `sessionId` echoes the id `start()` returned — correlate a `voxis://result` event against a known session by this field, not by event ordering (see the `voxis://result` row below). |
| `cancel` | `(sessionId)` | Discards without transcribing. |
| `state` | `() -> "idle" \| "recording" \| "transcribing" \| "error"` | Current plugin state (also pushed via the `voxis://state` event). |
| `get_profile` | `() -> VoxisProfile?` | Whatever profile was last applied to this plugin instance, if any. |
| `apply_profile` | `(bytes, keySource) -> ImportSummary` | Opens a sealed `VoxisProfile` (`VXP1` format) and applies it — dictionary/LLM/theme/hotkey to the plugin's own storage, secrets to the `SecretStore`, nothing to the host's own app storage. |
| `import_profile_from_desktop` | `() -> ImportSummary` | **Desktop only**, same machine: reads an installed Voxis desktop's config/dictionary/providers/prompts DBs **read-only** and builds a profile from them directly (no encryption round-trip needed — it's a local read, not a transit). `notFound` if no Voxis desktop config dir exists. |
| `import_profile_from_qr` | `(payload, code) -> ImportSummary` | LAN path: GETs the sealed profile from desktop Voxis's "Share profile" server (`profile-qr.json` wire contract, see below), opens it with `KeySource::Qr { k_qr, code }`. |
| `set_provider` | `(apiKey?, apiUrlOverride?, model?) -> ImportSummary` | Manual entry, **no Voxis desktop / sealed profile needed** (the iPad case): type a Groq key / self-hosted URL straight in. `apiKey` null = keep the stored key, `""` = clear it, else set it (stored via the `SecretStore`, never plaintext); `apiUrlOverride` null = Groq default, else a validated http(s) URL; `model` null = unchanged. Resets consent for the new provider host if it changed; rejects `alreadyRecording` while a session is active. Returns an `ImportSummary` with `source: "manual"`. |
| `set_hotkey` | `(spec: HotkeySpec)` | An EMPTY `key` (`""`) **disarms**: no target, no OS listener spawned if none ran yet — the host-side "plugin off" switch (0.6.0). Desktop only (`hotkey == None` on iOS/no-`desktop`-feature builds → `Ok(())`, silent no-op — there is no OS-level backend to bind to). See "HotkeySpec" below for the accepted syntax and the one real rejection path (`permissionDenied`). |
| `set_consent` | `(granted: bool)` | Per-(host, provider) gate; `start()` refuses until this is `true` at least once for the plugin's currently-configured provider (`[R1-Safety S6]`). |
| `hold_lease` | `(sessionId)` | Heartbeat for Hold-mode sessions — guest-js's `lease.ts` calls this once per second while a hold gesture is active; 3 missed beats → the session is cancelled server-side (`LeaseLost`) even if the webview died silently. Not needed for Toggle-mode sessions. |

## Events

| Event | Payload | Notes |
|---|---|---|
| `voxis://state` | `"idle" \| "recording" \| "transcribing" \| "error"` | Every state transition. |
| `voxis://level` | `{ rms, peak, muted }` | ≤ 20 Hz while recording — drives the overlay's waveform/mute indicator. |
| `voxis://result` | `DictationResult` (same shape as `stop()`'s return) | Fired **after** the session slot is released and its rec file deleted, so a caller reacting to this event by immediately calling `start()` again cannot race a not-yet-freed slot into a spurious `alreadyRecording`. This ordering opens a narrow window where a *different* session's `start()` can succeed before this event fires — always correlate by the payload's `sessionId`, never by assuming "the next result event" belongs to a particular session. |

## Errors

Every command error is `{ kind: "...", message: string, ...extra fields }`
(Rust's `#[serde(tag = "kind", rename_all = "camelCase")]`). Known kinds
(`src/error.rs`):

| `kind` | Extra fields | Meaning |
|---|---|---|
| `alreadyRecording` | — | `start()` while a session is already active. |
| `unknownSession` | `sessionId` | `stop`/`cancel`/`holdLease` referencing a session id that isn't the active one. |
| `consentRequired` | `providerHost` | `start()` before `set_consent(true)` for this provider. |
| `capture` | `message` | `AudioCapture` backend error (device gone, permission denied at the OS capture layer, etc). |
| `store` | `message` | `SecretStore`/consent-file IO or (de)serialization error. |
| `notImplemented` | `what` | Should not be hit in a current build — every command listed above is implemented; kept for forward-compat if a future command ships partially. |
| `transcription` | `message` | No API key in the `SecretStore`, `TranscriptionClient` construction failed, or the HTTP call itself failed (network/non-2xx/unparseable body). No `voxis://result` fires for this outcome. |
| `invalidHotkey` | `message` | `set_hotkey` given a spec that doesn't parse (see "HotkeySpec"). |
| `permissionDenied` | `message` | `set_hotkey`: the OS-level key listener (`rdev`) failed to start — on macOS this is almost always a missing Accessibility/Input Monitoring grant. **The one realistic rejection a real desktop host will see from `set_hotkey`** — surface it to the user (deep-link to System Settings), don't swallow it silently (a real regression found in naked's own integration, see `research/plugin-plan/review_10p4_r2.md`). |
| `notFound` | `message` | `import_profile_from_desktop`: no installed Voxis desktop config dir found on this machine. |
| `noApiKey` | `message` | `start`: no transcription API key in the `SecretStore` yet — refused BEFORE the mic opens; the host should open its provider setup (`set_provider`) or profile import. |
| `unsupportedPlatform` | `message` | `start`: this build has no capture backend for the platform — refused before consent/key/session, so a host shows "dictation is not available here" (C0). |
| `profile` | `message` | Any failure building/reading/decrypting a `VoxisProfile` — crypto/validation/storage error, malformed QR payload, or a non-2xx from the desktop's profile-share HTTP server. |

On iOS specifically, `startCapture` can also reject with a `PERMISSION_DENIED`
capture error carrying `data: { settingsUrl }` (the `UIApplication.
openSettingsURLString` value) — see `docs/PLUGIN_IOS_HOST.md`'s "Permission
denial carries a Settings deep link" for the exact shape.

## `HotkeySpec` and the hotkey parser

Desktop only (`voxis-core::hotkey`, feature `rdev`, shared by this plugin
and desktop Voxis itself — one parser, one key table). Two syntaxes:

1. **Single named key** — one of the aliases in `voxis_core::hotkey::
   KEY_TABLE`: `alt_r`/`alt_gr`/`altgr`, `ctrl_r`/`control_r`, `shift_r`,
   `super_r`/`cmd_r`/`meta_r`, and `f1`..`f12` individually. **There is no
   `f13` or higher** — the table stops at `f12`, and no combo/modifier
   syntax reaches past it either. This is the same set desktop Voxis's own
   hotkey picker offers, and it's a hard limitation of `rdev`'s key
   enumeration, not a plugin choice to revisit lightly.
2. **`"Mod+Mod+Key"` combos** (`HotkeyCombo::parse`) — e.g. `"Ctrl+Shift+V"`.

A spec that matches neither → `invalidHotkey`. `set_hotkey` re-registers the
listener; a currently-recording session is unaffected until the *next*
press. On platforms/builds with no OS-level hotkey backend (iOS, or a
desktop build without the `desktop` feature), `set_hotkey` is a silent
`Ok(())` no-op — **a host must not treat that success as "the hotkey is now
live"**. There is no dedicated command that reports hotkey-backend
availability; a host must infer it from its own build (does it enable the
`desktop` feature? is this iOS?) rather than from `set_hotkey`'s return
value alone. naked's own review (`research/plugin-plan/review_10p4_r2.md`,
round 2) found and fixed the opposite bug — the one real rejection
(`permissionDenied`) being silently swallowed by a host that assumed every
`set_hotkey` failure meant "no backend on this build" (it does not: no
backend returns `Ok(())`, never an error at all).

## The global hotkey listener: what it captures, and where it does not work

Read this before shipping a host that turns the hotkey on. `set_hotkey` binds
a **global** key, and a global key means an OS-level keyboard hook: for as long
as one is installed, the process receives the machine's WHOLE keystroke stream —
not only the keys aimed at this app. That is the price of starting dictation
while another window has focus, and no amount of care in the plugin removes it;
what the plugin does control is what happens to those events once they arrive.

**What is actually looked at.** Only `KeyPress`/`KeyRelease`. Mouse moves,
button presses and wheel events arrive on the same hook and are dropped without
being inspected. Of the key events, only the one that matches the configured
spec produces anything: the callback compares the key against the target before
any log line or any action call can run, nothing is buffered, and nothing is
written to disk or forwarded off-process. A press and a release are all the
host's `HotkeyActions` can ever receive. This is not a convention documented
here and left to reviewer memory: `crates/voxis-core/tests/
hotkey_listener_source_gate.rs` and `crates/tauri-plugin-voxis/tests/
hotkey_listener_source_gate.rs` read the listener sources and go red if a log or
an action call moves ahead of the target-key check — the "let me log what
arrives while debugging" edit is exactly how dictation would become a
keylogger.

**Platform facts — each is a limitation, not a bug to file:**

| Platform | What happens |
|---|---|
| **macOS** | Needs the **Input Monitoring** (or Accessibility) permission. The system prompt reads as "wants to observe your keystrokes". Without the grant `rdev::listen` fails and the hotkey silently never fires; the plugin surfaces that as `permissionDenied` from `set_hotkey`, and a late failure is re-reported on the next `set_hotkey` call (see "Errors"). A host should offer a deep-link to System Settings — a bare message leaves the user stuck. |
| **Linux (X11)** | Works, via XRecord. |
| **Linux (Wayland)** | **The hotkey will not fire, whatever is configured.** rdev reads X11 events; a Wayland session delivers none to it. This is a missing platform API, not a defect here — tell the user, or they will conclude the app is broken. |
| **iOS / iPadOS** | `rdev` is not compiled at all (`voxis-core`'s `rdev` feature is desktop-only; `cargo build -p voxis-core --target aarch64-apple-ios` never touches it), and the OS gives **no** app a global hotkey — **not even with a Bluetooth keyboard attached**, and not with a hardware keyboard on a tablet either: the restriction is on global input capture, not on which keyboard is present. On mobile the in-app button and hold-to-talk are the only ways in. |
| **Android** | No plugin backend at all (out of scope, see "Known limitations"). |
| **Managed fleets** | Corporate EDR/MDM and some antivirus products classify an unfiltered keyboard hook as a **keylogger** — which is what this looks like from outside. Decide whether that trade is acceptable *before* deploying into a managed fleet, rather than discovering it in a quarantine ticket. |

**There is currently no way to disarm the plugin's listener.** `set_hotkey`
only ever *installs* a target: the first successful call spawns the background
`rdev::listen` thread, every later call swaps the target under one lock, and no
command clears it back to "nothing" — the hook therefore lives for the rest of
the process, and a host that lets the user turn dictation off cannot currently
stop the capture from this side. Treat that as the residual risk of shipping
the hotkey, not as a hidden detail: the desktop Voxis app's own listener does
have a `stop()` (and uses it when the configured hotkey is cleared), and the
plugin's backend is expected to grow the same affordance. Until then, a host
that must not leave a keyboard hook installed should not call `set_hotkey` at
all, and make the hotkey optional in its UI.

## Profile: three import paths + `apply_profile`

A `VoxisProfile` (version 1) carries: provider/model/language/guard timeouts
(`config`), the word-replacement dictionary, LLM providers + prompts +
active prompt id, the overlay theme id, and the hotkey spec. It does **not**
carry history, corrections, debug settings, or failed-audio state. Secrets
(`api_key`, `llm.api_key`) travel separately as `ProfileSecrets`, routed to
the plugin's `SecretStore` on import — never written to the plugin's own
sqlite. See `contract/fixtures/profile-v1.json` for the exact wire shape.

1. **Same machine as an installed Voxis desktop** — `import_profile_from_
   desktop()`. Reads the desktop's `config.db`/`dictionary.txt`/
   `providers.db`/`prompts.db` **read-only** (a dedicated
   `open_read_only` sqlite path with `busy_timeout`, no `init_schema` —
   opening the desktop's live DBs with the normal read-write connection
   path would race a running Voxis and/or fail with `SQLITE_READONLY`).
   `notFound` if no Voxis desktop config dir exists on this machine.
2. **QR + LAN** — desktop Voxis's Settings → "Share profile to device"
   generates a one-time QR (`{v, host, port, token, k}`, see
   `contract/fixtures/profile-qr.README.md` for the full wire contract) +
   a 6-digit code shown next to it (a **second factor**, not part of the
   QR — protects against a photographed/leaked QR image, never
   transmitted over the network). The host scans/pastes the QR JSON and
   calls `import_profile_from_qr(payload, code)`; the plugin GETs the
   sealed profile from the desktop's LAN-only HTTP server (single-use
   token, 120s window or first successful GET, whichever first) and opens
   it with `KeySource::Qr { k_qr, code }`. **No custom URL scheme** — a
   registered `voxis://` scheme could be hijacked by an unrelated app to
   steal the token+key.
3. **`.vxp` file** — a passphrase-encrypted export (Argon2id + ChaCha20-
   Poly1305, `VXP1` wire format), shown once as a 5–6 word phrase or a
   26-char base32 key. The host picks/reads the file itself (there is no
   `import_profile_from_file` command — the plugin only exposes
   `apply_profile(bytes, keySource)`, taking already-read bytes; see
   "Known limitations" below for the follow-up this leaves for a host).
   Call `apply_profile(bytes, { type: "passphrase", phrase })`.

Any of the three produces an `ImportSummary` (`{ source, dictionaryEntries,
llmProviders, llmPrompts, hasApiKey, theme, hotkey }`) — a host renders this
directly as "Provider: Groq · API key configured", never the underlying
secret value.

## Consent and privacy

`start()` refuses (`consentRequired`) until `set_consent(true)` has been
recorded once for the plugin's current (host id, provider host) pair — App
Store guideline 5.1.2(i) requires explicit consent before audio/text leaves
the device to a third-party AI provider. The host still owns:

- The consent **UI** itself (the plugin only gates, it renders nothing) —
  name the actual STT provider in the consent copy, not a generic "this app
  records audio" string.
- `NSMicrophoneUsageDescription` (iOS `Info.plist`) naming the provider —
  **its absence is not a soft failure**: iOS terminates the process on the
  very first microphone access with no in-app warning. See
  `docs/PLUGIN_IOS_HOST.md`'s `Info.plist` keys table for the exact
  wording/consequence.
- A `PrivacyInfo.xcprivacy` entry (App Store 2.5.14: Audio Data / Other User
  Content → App Functionality → shared with the STT provider) — a ready
  snippet is in `docs/PLUGIN_IOS_HOST.md`.
- `UIBackgroundModes: audio` **only if** dictation should survive
  backgrounding (2.5.4 requires the mode to be genuinely used, not declared
  as a workaround) — and, in Toggle mode, a **persistent recording
  indicator** while active (2.5.14) — the guest-js overlay already provides
  this; a host building its own UI must not hide it.

## `guest-js`: `@voxis/tauri-plugin-voxis`

Typed API + a `<voxis-overlay>` web component. See `guest-js/README.md` for
the full API surface (`createClient`, `mountOverlay`, `HotkeyMachine`,
driver modes) and `docs/THEMES.md`'s "Appendix: `tauri-plugin-voxis`'s own
`<voxis-overlay>`" for the theme-engine reuse. Currently versioned
`0.1.1` — bump this **and re-vendor** (tarball or npm dependency) on every
guest-js change; a host vendoring a prebuilt `.tgz` (as naked currently
does) must bump the tarball filename/version on every rebuild, or a stale
bundle silently ships (build caches — bun/vite — do not invalidate on a
same-named file overwrite; see the plan's Task 10 part 3 "lessons").

## Real hard-won lessons (T10/T11 — read before integrating)

These are from the two integrations actually attempted against this plugin
so far (naked desktop + naked iOS/iPad). Facts, not aspirations:

- **Microphone/status controls hidden under a hamburger menu on narrow
  viewports.** naked's own mic button initially sat *underneath* its
  drawer-toggle (☰) reserved-space on iPhone widths — the reserved space
  was declared per-child on the wrong container. If a host reserves layout
  space for its own chrome controls, make sure that reservation lives on
  the *same* container the mic/overlay control is placed in, not a sibling
  that happens to look identical at desktop widths.
- **React StrictMode double-invoke can leave a zombie event listener** if a
  subscription effect's cleanup doesn't guard against a second, overlapping
  mount before the first `client.onState/onLevel/onResult(...)` promise has
  even resolved. Fix pattern (naked's own, three times over, one per
  event): track a `cancelled` flag set in cleanup; when the subscribe
  promise resolves, check `cancelled` again **before** storing the
  `unlisten` function — if already cancelled, call `resolvedUnlisten()`
  immediately and return, don't store it for a later cleanup that will
  never run again.
- **`stop`-while-`start`-is-pending is a real no-op window, not a
  hypothetical.** On iOS, `start()` awaits the system microphone permission
  prompt before resolving; a stop tap that lands while that promise is
  still pending has no session id to reference yet (`activeSessionIdRef`
  is only set once `start()` resolves) and is silently swallowed, running
  the session all the way to its silence timeout instead. A host UI needs
  its own "pending start, cancel/stop it once it resolves" bookkeeping —
  the plugin does not currently expose a way to cancel an in-flight,
  not-yet-resolved `start()` (`research/plugin-plan/T11_ipad_run_2026-09-16.md`,
  finding 3).
- **`xcodegen generate` must run — and be committed — after every
  `project.yml` edit, on the actual device build path too, not just in
  Simulator/CI scripts.** A real on-device run hit a TCC kill (the app
  terminated on first mic access) because a device-deploy script built
  from the *last-committed* generated `Info.plist`, which predated an
  uncommitted `project.yml` edit adding `NSMicrophoneUsageDescription`.
  Fix: commit the regenerated metadata every time, not just run
  `xcodegen generate` locally and forget to `git add` the result.
- **The default input device is not the profile's device — and cpal's
  system default can silently be wrong hardware.** `CpalCapture::new()`
  without an explicit device selection uses the OS default input, which on
  a dev machine with multiple mics/interfaces can silently be a lavalier or
  Bluetooth headset rather than the built-in mic a profile was calibrated
  against — resulting in a stream of near-silence and a Whisper
  hallucination, not an obvious error. `ProfileConfig.audio_device`
  (`Option<String>`) exists precisely to avoid this: `init_desktop()`
  reads the device name from the applied profile's pipeline config with a
  fallback to the OS default only when no profile (or no device name in
  it) is present. A host doing its own device selection UI should always
  set this field via `apply_profile`, not rely on the OS default.

## Verify

```sh
cargo test -p voxis-core -p tauri-plugin-voxis -p voxis-fake-stt
cargo clippy -p voxis-core -p tauri-plugin-voxis --all-targets -- -D warnings
scripts/check-ios-build.sh   # from repo root — voxis-core, aarch64-apple-ios[-sim]
cd crates/tauri-plugin-voxis/guest-js && bun run build && bun run test
```

`cargo test --workspace` is deliberately **not** the recommended command
here — this repo's workspace also contains `host-min` (a full Tauri app
example), which is far slower to compile than the plugin/core crates alone
(`[ADO-4 minors]`).

## Known limitations / follow-ups

Carried over verbatim from the plan's own Follow-ups section
(`.pi/plans/tauri-plugin-voxis.md`) — not fixed by this task:

- No `import_profile_from_file(path, passphrase)` command — a host reads
  `.vxp` bytes itself and calls `apply_profile(bytes, keySource)` directly.
  Acceptable today (the blob is AEAD-sealed end to end regardless of who
  reads the raw bytes off disk), but a host wanting a single plugin call
  for "pick a file, import it" doesn't have one yet.
- `set_hotkey`'s `permissionDenied` case needs a host-visible affordance
  (deep-link to System Settings on macOS) — the plugin returns a
  structured message today; whether a given host surfaces it is still a
  per-host integration bug class (see "Real hard-won lessons" above).
- `mountOverlay`'s host-driven mode (`driver: "host"`, see `docs/THEMES.md`
  appendix) exists, but a host that wants the overlay to *also* prime
  itself with the current in-flight `DictationResult` on mount (not just
  `state`/`level`) doesn't get that for free — `applyResult` is not called
  during the mount effect (documented, not a bug: the plugin's own guest-js
  treats a stale result as fire-and-forget).
- Live Activity/Dynamic Island (`docs/PLUGIN_IOS_HOST.md`'s `[T9a]`
  section) is implemented and unit-tested but **not yet verified on a real
  device end-to-end** — that is Task 9b in the plan, still open.
- Android has no plugin implementation at all — out of scope for this
  crate's current design (see the plan's Follow-ups).

Until the tag lands pin by `rev`; the tag `plugin-v0.1.0` will mark the
first hosted release (naked).
