# Changelog

## `tauri-plugin-voxis` 0.7.2 / `@voxis/tauri-plugin-voxis` (guest-js) 0.9.2

- **The pill theme select shows theme names, not raw ids** (owner 14.10:
  `all_aquarium`, `didinium_drift`, `winamp_classic`). `settings_get`
  `status` gains `themes: { value, label: { en, ru } }[]` — `value` is the
  theme id, `label` the theme's own `theme.json` `"name"` (`All Aquarium`,
  `Lava Lamp`, `Metaballs 2.5D`, …; proper names, so `ru` = `en`). The
  manifest declares `status.themes` as `"options"` and the `theme` select's
  `optionsFrom` now points at it. `status.themeIds` stays (declared, still
  sent) for compatibility.
- Schema v1 (no version bump, additive): the `optionsFrom` item shape is
  now spelled out — `string` or `DynamicSelectOption { value, label }`
  with `label` either `{ en, ru }` or a plain string; new helper
  `dynamicOptionLabel(item, lang)`. `validateSettingsManifest` now also
  rejects an `optionsFrom` whose `status`/`host` path is not declared
  `"string[]"` or `"options"`.

## `tauri-plugin-voxis` 0.7.1 / `@voxis/tauri-plugin-voxis` (guest-js) 0.9.1

- **Hiding the pill no longer forgets its corner** (owner 14.10). The
  settings manifest's `overlayPlacement` select loses its 6th «hidden»
  option and keeps only the five positions (`bottom-right` default,
  `bottom-left`, `top-right`, `top-left`, `center`); a new host toggle
  `overlayHidden` (default `false`, «Hide the pill (hotkey or chip only)» /
  «Не показывать пилюлю (хоткей или чип)», `enabledWhen` `status.hasApiKey`)
  hides it. `overlayPlacement` and the offsets are `visibleWhen`
  `overlayHidden != true` (offsets additionally hidden for `center`).
  Hosts that persisted `overlayPlacement: "hidden"` should migrate it to
  `overlayHidden: true` + the default corner. Manifest-only change; no
  Rust behaviour change.

## `tauri-plugin-voxis` 0.7.0 / `@voxis/tauri-plugin-voxis` (guest-js) 0.9.0

- **The plugin describes its own settings.** guest-js exports a JSON settings
  manifest (`voxisSettingsManifest`, `settingsManifest()`; schema v1 types +
  `validateSettingsManifest` in `settings.ts`): sections of fields
  (`toggle`/`select`/`text`/`secret`/`number`/`status`/`action`/`file-import`),
  `{ en, ru }` labels, and declared behaviour — the API key is `required`
  (red until `status.hasApiKey`), every pill control is `enabledWhen`
  `status.hasApiKey` («No API key — the dictation pill is off»), the global
  hotkey and «Import from Voxis desktop» show only where the build has them.
  Host-owned prefs (`enabled`, `overlayPlacement`, offsets, `dictationChord`)
  are described with `store: "host"`. A host renders a tab from it instead of
  a hand-written Voxis form.
- **New commands `settings_get` / `settings_set`** (in `voxis:default`;
  desktop and mobile): `{ values, status }` over the existing profile,
  secret store, hotkey backend and theme — no second store. The API key is
  write-only (never returned; empty keeps it). Bad values reject
  `{ kind: "invalid", field, message }` and save nothing. guest-js:
  `getSettings()`, `setSettings(values)`.

## @voxis/tauri-plugin-voxis (guest-js) 0.8.0

- **`board: false`**: the expanded window without its dark `#111` board — only
  the theme is drawn (naked lays the always-shown `idleTheme` window over
  terminal text; owner 2026-09-29: «доска оверлея совсем прозрачной должна
  быть»). Default unchanged; the compact handle keeps its fill.
- **Fix: an `idleTheme` window was born 8px off where it then stayed.**
  `initialPosition` was the expanded window's top-left, while `setPosition`
  (0.7.0) means the compact resting spot and grows from it — so the host's
  first re-anchor to the SAME spot moved the window by the size difference
  (naked: window 64×64 at x=770 over a 56×56 ring at x=762 after the first
  viewport change). One rule (`placeAtRest`) now places both. A persisted
  position keeps its meaning (the pill's own last top-left).

## v0.1.10 (Voxis desktop)

Same code as v0.1.9. v0.1.9 shipped without macOS artifacts: the CI host's
persistent checkout carried a stray local edit that removed `macos-private-api`
from `src-tauri/Cargo.toml`, the VM built exactly that, and `transparent()`
failed to compile. Published tags are immutable, so this is the macOS release;
the release job now stashes host leftovers before building (`release.yml`).

## v0.1.9 (Voxis desktop)

### Fix
- **Dictation went silent after a USB microphone blinked, until the app was
  restarted** (owner's Mac, 2026-10-06, BY-V). CoreAudio deactivated the mic
  for 0.6 s and brought it back as a NEW device; the always-on stream (the
  "Pause/Play" fast-resume path on macOS) kept resuming the OLD one, which
  `play()`s without error and never calls back. Every hold — 6, 12, 16 s —
  came out as 0 ms of audio and was filed as a "too short" recording:
  nothing in History, no error anywhere. Two rules now:
  1. a resumed stream must deliver a callback within 400 ms or it is torn
     down and the device reopened by name (self-heal, no restart);
  2. a hold ≥ 1 s with zero callbacks is `NoAudioFromDevice` — a visible
     error ("Microphone delivered no audio for N s — check the device or
     pick another one in Settings"), and the dead stream is closed so the
     next start reopens. Taps under 1 s keep the quiet "too short" path.
  Tests drive both with a fake stream that honours Play/Pause/Close like
  cpal's loop but either calls back or stays silent.
- **Secure Input banner could stay stale in an occluded window.** WKWebView
  reports `document.visibilityState === "hidden"` while the window is covered,
  and the 5 s poll skipped that case — so the banner reflected the state from
  before the window was covered until the next poll after it came back
  (seen once on 0.1.8: Secure Input on, Voxis brought forward, no banner). The
  poll now runs unconditionally (microseconds) and re-reads on
  `visibilitychange`. Verified on-screen: dialog with a password field →
  banner names `osascript (pid …)` in a window nobody activated; dialog closed
  → banner gone within one poll.
- `HistoryPage` clipboard test flaked from worker starvation under load;
  its assertion now waits 5 s instead of 1.

## v0.1.8 (Voxis desktop)

### Add
- **"Secure Input is on — held by Terminal (pid 812)" banner** (macOS). While
  any app holds Secure Event Input (a password field, `sudo` in Terminal, a
  password manager's lock screen) NO process receives global keyboard events,
  so the Voxis hotkey goes dead with no error anywhere — the "полный ноль"
  hunt of 2026-09-18 spent an hour ruling this out by hand. Voxis now asks the
  OS (`IsSecureEventInputEnabled`) with the permission checks and every 5 s
  while visible, names the holder (`kCGSSessionSecureInputPID` via `ioreg` →
  `ps`), and shows a banner with no button: nothing Voxis can do about it,
  the text says who to look at. Off macOS the command always reports "off".
  `check_secure_input` command; `permissions::secure_input` with a tested
  pure parser; banner tests.

## v0.1.7 (Voxis desktop)

### Fix
- **Right Ctrl (`ctrl_r`) never worked as a hotkey on macOS** — and it is the
  app's default. `rdev`'s macOS keycode table (`key_from_code`) has no arm for
  virtual keycode 62 (Right Control), so a physical right-Ctrl press reached
  the listener as `Key::Unknown(62)` and could never match; left Ctrl and
  right Cmd were unaffected. Found live on the owner's Mac (Voxis silent on
  right Ctrl while a WebKit key probe showed the OS sending a clean
  `ControlRight`, keyCode 62 / location 2). Fixed with one shared repair seam,
  `voxis_core::hotkey::normalize_rdev_key` (macOS-only `Unknown(62) →
  ControlRight`), applied before matching in both rdev-fed listeners: the
  desktop app's `hotkey_callback` and `tauri-plugin-voxis`'s `RdevHotkey`.
  Tests pin that `Unknown(62)` drives a full press+release for `ctrl_r` and
  that other unknown codes stay invisible; the source gate (`no log or sink
  call outside a target-key guard`) still holds. Verified on hardware: real
  right-Ctrl hold → recording → transcript.

## v0.1.6 (Voxis desktop)

### Fix
- Six `AppConfig` fields were saved to `config.db` **as read-only defaults
  every time the app restarted**, silently discarding whatever the user had
  actually set in Settings: `api_url_override` (a configured self-hosted
  transcription endpoint quietly reverted to the Groq default on next
  launch), `min_recording_ms`, and `vad.backend` / `vad.onset_frames` /
  `vad.hangover_frames` / `vad.prefill_frames`. `ConfigSqliteStorage::save`/
  `load` write/read fields by hand (not a generic (de)serializer), and
  these six were read but never written — found while building
  `tauri-plugin-voxis`'s desktop-profile import path (Task 6/6b: a real
  round-trip through the profile importer got 0 requests at the configured
  `api_url_override`, because the value it read back from `config.db` was
  never the one that had been saved). Fixed in `crates/voxis-core/src/
  storage/config_sqlite.rs`. Added a guard test,
  `every_app_config_field_round_trips_through_sqlite`, that constructs a
  **fully non-default** `AppConfig` (including every nested struct, with
  no `..Default::default()` anywhere in the literal) and asserts save→load
  equality field-by-field via destructuring (so a newly-added `AppConfig`
  field that isn't wired into the destructuring pattern fails to compile,
  rather than silently passing an incomplete check) — the previous test
  covering this path used `..Default::default()` for most fields, which is
  exactly the style that let all six of these slip through unnoticed.

### New
- **"Share profile to device"** (Settings): sends the current provider,
  model, language, guard timeouts, dictionary, LLM providers/prompts, theme
  and hotkey to a phone/tablet running a `tauri-plugin-voxis` host, over
  two paths — a one-time QR code + LAN transfer (single-use token, 120s
  window or first successful fetch, whichever comes first; the QR's own
  256-bit key travels in the code, a 6-digit code shown alongside it is a
  second factor only, never transmitted) or a passphrase-protected `.vxp`
  file export (Argon2id + ChaCha20-Poly1305, phrase/key shown once). API
  keys and other secrets never touch the destination's on-disk profile
  storage — they route through the destination's own `SecretStore`.

### Dependencies
- `h2` 0.4.19 (RUSTSEC-2026-0258), `quinn-proto` 0.11.18
  (RUSTSEC-2026-0185), `rustls` 0.23.45 (RUSTSEC-2026-0285), `quick-xml`
  0.42.0 via tauri-plugin-notification 2.4.0 / plist 1.10.1
  (RUSTSEC-2026-0194, -0195) bumped. `cargo audit` is clean of
  vulnerabilities (12 unmaintained-warnings remain, transitive via
  tauri/gtk); policy file `.cargo/audit.toml`.

### Internal
- The engine (`AppConfig`, storage, transcription, LLM, learning, the
  recording guard, the WAV encoder, the hotkey parser, `VoxisProfile`) moved
  into a new pure-Rust workspace member, `voxis-core` — no `tauri`/`cpal`/
  `rdev`/`enigo`/`arboard` dependency, buildable for `aarch64-apple-ios`
  with zero feature flags. Voxis desktop (`voice_lib`) now consumes it via
  `pub use` plus a small tauri-specific shim layer; behaviour is unchanged
  (regression-gated by a full local-vs-post-split config/history/dictionary
  data snapshot test, plus the existing `cargo test --lib` suite). The
  Cargo workspace root moved from `src-tauri/Cargo.toml` to a new root
  `/Cargo.toml`; **`/Cargo.lock` now lives at the repo root**, not
  `src-tauri/Cargo.lock` — see `.pi/skills/voxis-deploy/SKILL.md`'s updated
  release checklist. This split is what makes `tauri-plugin-voxis` (below)
  possible: the plugin and Voxis desktop now share one engine instead of
  two copies of it.

## `tauri-plugin-voxis` 0.1.0 / `@voxis/tauri-plugin-voxis` (guest-js) 0.2.0

guest-js 0.2.0 (was 0.1.1): `<voxis-overlay>` renders every Voxis theme at its
manifest size (`overlay_width`/`overlay_height`, e.g. Lava Lamp 120×120,
Vorticella 240×240) while recording/transcribing and rests as a compact 56×56
handle with no theme mounted (no WebGL loop while idle); `idleTheme` opt-in,
`voxis-overlay-resize` event, `el.size`/`el.lifecycle`. iOS floor is **16.0**;
17+ APIs (mic-mute signal, Live Activity Stop) are gated at their call sites.


New, separate artifacts — not part of the Voxis desktop app release above.
Voxis's dictation engine (hotkey/tap → record → silence/duration guard →
transcribe → dictionary → optional LLM post-process), packaged as an
embeddable Tauri 2 plugin (desktop via `cpal`/`rdev`, iOS via
`AVAudioEngine`/Keychain) plus a typed guest-js client and a
`<voxis-overlay>` recording-pill web component, for third-party Tauri apps
that want Voxis-quality dictation inside their own app rather than
switching to the standalone Voxis app. First integration target: `naked`
(desktop + iPad, in progress in that project's own repo). See
**[crates/tauri-plugin-voxis/README.md](crates/tauri-plugin-voxis/README.md)**
(Rust) and
**[crates/tauri-plugin-voxis/guest-js/README.md](crates/tauri-plugin-voxis/guest-js/README.md)**
(TypeScript) for the full API/integration reference, and
**[docs/PLUGIN.md](docs/PLUGIN.md)** for the architecture/guarantees/test
gates this changelog entry doesn't repeat.

## v0.1.5

Silence guard calibrated on hardware: threshold −46 → −34 dBFS (room floor on a
MacBook Air built-in mic measured −44…−36 dBFS, so v0.1.4's guard never armed and a
silent take could still be transcribed and auto-typed as a Whisper hallucination).
Guard logs per-take peak RMS for future calibration. No other changes.

## v0.1.4

macOS release lane: sign every bundled executable (voice AND typing_bench) with
Developer ID + Hardened Runtime + entitlements; v0.1.3's notarization was rejected on
typing_bench, so v0.1.3 shipped without a DMG (Linux/Windows/Homebrew tarball
unaffected). No app-code changes.

## v0.1.3

Fixes the "stuck recording" class of incidents (recording never stops, RAM grows to
gigabytes, multi-GB WAV dumps, app goes deaf until restart) and adds a recording guard.

### Root cause fixed
- Press/release ordering race: a hotkey/overlay release arriving while the press was
  blocked in the (0.2–5 s) synchronous microphone-permission probe was silently dropped,
  leaving a recording nobody would stop. Now: single-flight start, release-pending
  checkpoints, deterministic — the recording either never starts or stops immediately.
- Microphone permission probe is native (AVFoundation, ~10–40 ms) instead of `osascript`.

### Recording guard (new settings, Recording section)
- Auto-stop after continuous silence (default 60 s + ~10 s detection window; 0 = off)
  with a warning beep 3 s before. A take that was silent from start to finish is
  discarded instead of transcribed, to avoid an auto-typed Whisper silence hallucination.
- Max recording length (default 10 min; 0 = off — recording still stops at ~13 min, the
  transcription limit; the raw audio buffer keeps a separate, larger safety backstop).
- Buffer is hard-capped at the native sample rate; memory is released on stop.

### Robustness
- One serialized stop path for hotkey release, toggle press, cancel button and the guard;
  toggle mode's tap-to-stop (previously dead code) works.
- Dead audio stream mid-recording recovers to idle with an error cue instead of pinning
  the app in "Recording" — on the next stop request, or automatically once the recording
  guard notices the stream died.
- Oversize audio (>25 MB) is rejected before any disk write or network call; the
  failed-audio and debug dumps no longer write multi-GB files.
- Overlay spectrum logging throttled; heartbeat no longer fsyncs every 10 s.

### macOS release pipeline
- CI now codesigns (Developer ID, Hardened Runtime + microphone/Apple-Events
  entitlements), notarizes and staples a DMG (falls back to an ad-hoc-signed DMG when
  signing secrets are absent; unstapled if Apple's queue exceeds 30 min — see
  `docs/MACOS_SIGNING_TODO.md`); own VM image and a host-wide launch lock.

## v0.1.2

First signed+notarized macOS DMG via the CI lane (commit e188a8d); no app-code changes.

## v0.1.1

CI/release-pipeline hardening (no user-facing app changes):
- Release publishes deb/rpm to both Forgejo and GitHub with hard-fail asserts.
- Homebrew tap `axelbaumlisto/homebrew-voxis` wired up with a tarball integrity
  gate (`brew install axelbaumlisto/voxis/voxis`, macOS arm64).
- Docs regeneration decoupled from release into a scheduled workflow that opens
  a PR to main (deploys to docs.voxis.top via GitHub Pages).
- Re-publish guard prevents overwriting an already-published tag.

## v0.1.0

First public release of Voxis — a private, local-first voice dictation app
(Tauri v2 + Rust core). Records audio via a global hotkey, transcribes through
a Whisper-compatible HTTP endpoint (Groq by default), and outputs text via
clipboard or auto-typing.

### Highlights
- Global push-to-talk hotkey with buffered concurrent recordings
- Whisper-compatible transcription (custom endpoints via `api_url_override`)
- Dictionary word-replacement + learning suggestions
- Optional LLM post-processing with multi-prompt templates
- Clipboard and auto-typing output backends
- Transcription history with SQLite storage
- Themeable recording overlay (manifest v2 theme engine)

### Downloads
- **Linux**: `voxis-linux-x64-gui` (binary), `Voxis_0.1.0_amd64.deb`, `Voxis-0.1.0-1.x86_64.rpm`
- **Windows**: `voxis-windows-x64-gui.exe` (portable), `Voxis_0.1.0_x64-setup.exe` (NSIS installer)
- **macOS**: unsigned Apple Silicon binary (`voxis-macos-arm64`) — DMG signing/notarization to follow

Binaries are unsigned in this release.
### tauri-plugin-voxis hardening (2026-09-16, before the first hosted release)
- `AudioCapture::start`/`stop` run on `spawn_blocking` (a slow capture backend / mobile IPC no
  longer blocks the plugin's async worker). A `cancel()`/`stop()` (incl. Hold-mode cancel on
  webview death and the iOS Live Activity Stop) arriving while `start()` is still opening the
  device is queued and applied the instant the session attaches — previously it would have been
  dropped (cancel) or, for Stop via Live Activity, panicked (aborting the app in release).
- `voxis://result` now carries `sessionId`; hosts correlate results by id (guest-js `dictate()`
  does), not by "the next result after my start()". The event fires after the session slot is
  freed, so a `start()` triggered by the result never hits `AlreadyRecording`.
- New `voxis://error {kind:"permissionDenied"}` when the desktop global-hotkey listener fails
  after registration (macOS Accessibility revoked) — was invisible to hosts.
- `secrets.json` written temp → fsync → rename (never half-written); `RecDir` sweep logs and
  continues past a stuck file; `CpalCapture::stop()` returns in ≤25 ms instead of up to 250 ms.
- iOS: `AVAudioEngine` is rebuilt after `mediaServicesWereReset` (was Failed until app restart).
- Dead `hound`/`regex` dependencies dropped; dictionary application shared with voxis-core.

