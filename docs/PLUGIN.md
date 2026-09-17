# `tauri-plugin-voxis`: architecture, guarantees, test gates

Whole-project view of embedding Voxis dictation into a third-party Tauri 2
host. Author-facing "how do I use it" reference: `crates/tauri-plugin-
voxis/README.md` (Rust) + `crates/tauri-plugin-voxis/guest-js/README.md`
(TS). iOS host checklist: `docs/PLUGIN_IOS_HOST.md`. Design rationale
(why each decision, review history): `.pi/plans/tauri-plugin-voxis.md` —
this document summarizes that plan's Approach section for readers who
don't need the full decision trail.

## Architecture: four layers, one contract

```
voxis-core (pure Rust, no Tauri/desktop deps — must build for aarch64-apple-ios with zero features)
   AppConfig + validation · storage traits + sqlite · TranscriptionClient (reqwest/rustls)
   dictionary · llm · learning · guard (silence/max-duration decision logic) · hotkey (feature `rdev`)
   VoxisProfile (model + seal/open, `VXP1` AEAD format)
        |                                          |
voice_lib (Voxis desktop app — cpal,       tauri-plugin-voxis (crates/tauri-plugin-voxis)
rdev, enigo, tray; unchanged behaviour,       Rust: commands + PluginState + AudioCapture/SecretStore traits +
consumes voxis-core via `pub use`)            the capture -> guard -> transcription -> dictionary -> llm pipeline
                                               desktop.rs: cpal capture, rdev hotkey (feature `desktop`)
                                               ios/: Swift AVAudioEngine capture, Keychain SecretStore, Live Activity
                                               guest-js: typed client + <voxis-overlay> (reuses the theme-engine
                                                         contract) + in-app HotkeyMachine + hold-mode lease
                                                    |
                                            host app (e.g. naked): button/hotkey/tap -> dictate() -> text,
                                                                    inserted wherever the host decides
```

`voxis-core` is where Voxis desktop's engine actually lives now — `voice_lib`
is a thin consumer (`pub use voxis_core::{config, storage, ...}` plus a
handful of tauri-specific shims), not a fork. The plugin is a **second**
consumer of the same core, not a copy of desktop's logic: one guard
implementation, one WAV encoder, one hotkey parser, one profile format,
shared by both.

## Guarantees

These are invariants the plugin holds regardless of host, verified by its
own test suite (not something a host needs to re-verify, but worth
understanding when debugging an integration):

- **No auto-type, ever.** The plugin returns text to the host
  (`stop()`'s return value / `voxis://result`); it never simulates
  keystrokes or writes to the OS clipboard itself. `copyToClipboard`-style
  behaviour, if a host wants it, is the host's own choice with the text it
  already has.
- **Secrets only through `SecretStore`.** API keys never reach the
  plugin's own sqlite/JSON storage in plaintext form outside the
  `SecretStore` a host injects (or the plugin's own documented fallbacks —
  `FileSecretStore` on desktop, Keychain on iOS). `Secret`'s `Debug` is
  `[REDACTED]`; the only way to read the wrapped value is `expose()`,
  called only at the actual serialization boundary.
- **`NoSpeech` never reaches the network.** The guard's silence-timeout
  decision (`voxis_core::guard`) runs entirely on local RMS/peak windows;
  a session that never crosses the "ever loud" threshold is discarded
  (`guardOutcome: "silenceTimeoutNoSpeech"`) **before** any
  `TranscriptionClient` HTTP call is made — this is what keeps
  `voxis-fake-stt`'s silence fixture (a real recorded Whisper
  hallucination, "Продолжение следует… Субтитры создавал DimaTorzok")
  request-count-verifiably unreachable in CI, and is the same guard logic
  desktop Voxis itself uses (calibrated on real hardware, see
  `voxis_core::guard`'s own module doc for the `SILENCE_RMS` constant).
- **Hold-mode sessions cap at 120 seconds**, independent of any profile's
  own `maxRecordingMs` — a webview death (blank/dead WebKit process) must
  not leave the microphone open indefinitely; combined with the heartbeat
  lease (3 missed 1 Hz beats → `LeaseLost`), the realistic window for an
  orphaned Hold session is single-digit seconds, not minutes.
- **Consent gates every session, not just the first.** `start()` refuses
  (`consentRequired`) until `set_consent(true)` has been recorded for the
  plugin's current (host id, provider host) pair — changing the provider
  (e.g. via a new profile import, or `set_provider` below) re-arms the
  gate for the new provider host.

## Manual provider entry (`set_provider`)

Every *other* way to get a provider key into the plugin needs a
`VoxisProfile` produced somewhere else first — a sealed `.vxp`
(`apply_profile`), the LAN QR share (`import_profile_from_qr`), or a Voxis
desktop install on the same machine (`import_profile_from_desktop`). On an
iPad with no Voxis desktop anywhere, none of those apply. `set_provider`
closes that gap: a host can offer a plain "paste your Groq key /
self-hosted URL" screen and land the result through the exact same
persistence path every import uses.

`set_provider(apiKey?, apiUrlOverride?, model?) -> ImportSummary` (all
arguments nullable, camelCase on the wire):

- **`apiKey`**: `null` keeps whatever key is already stored, `""` (empty
  after trimming) clears it, any other value stores it. The key travels
  as a `Secret` straight into the `SecretStore` — the same "secrets never
  touch sqlite in plaintext" guarantee as every import path — never onto
  `ProfileConfig` or into the returned `ImportSummary`.
- **`apiUrlOverride`**: `null` = the Groq default (`api_url_override =
  None`); any other value must be an http(s) URL with a host (validated
  here, since `config::validate_config` does not check this field) or the
  call rejects with a `profile` error.
- **`model`**: applied only when non-null.

It returns the same `ImportSummary` shape as the import commands, with
`source: "manual"`, and refreshes the pipeline config so the next
`start()` sees the new settings. Two safety rules: it **rejects
`alreadyRecording`** while a session is active (it rewrites the plugin's
own `config.db` and the in-flight pipeline snapshot — not safe to swap
under a live session), and it **resets consent for the new provider
host** when the host derived from `apiUrlOverride` changed, so the user
must re-consent before dictating to a newly-pointed provider.

## Tests / gates

- **`host-min` smoke** (`crates/tauri-plugin-voxis/examples/host-min`,
  `scripts/host-min-smoke.sh`): drives the **real** plugin/pipeline/session
  code (not a browser/webview driver) against a scripted `MockCapture` +
  a real `voxis-fake-stt` server, asserting on actual process stdout
  events (`RESULT_EVENT`/`STATE_EVENT` JSON lines). Three scenarios:
  normal speech→result, silence→`NoSpeech` with zero STT requests, and a
  `StreamDied`→recovery path. Runs in CI (`.forgejo/workflows/ci.yml`'s
  `host-min-e2e` job, under `xvfb-run` since the CI image has
  `libwebkit2gtk-4.1`/`libgtk-3`).
- **`voxis-fake-stt`** (`crates/voxis-fake-stt`): a deterministic,
  network-free Groq-multipart-compatible server — sha256(WAV) → fixed
  text, or the recorded silence hallucination for the silence fixture.
  One binary shared across CI, desktop dev, and iPad-over-LAN runs.
- **Contract fixture snapshots** (`crates/tauri-plugin-voxis/contract/
  fixtures/*.json`): both the Rust crate and guest-js snapshot-test their
  own types against the same JSON files — a type drift on either side
  fails red in the same commit, not silently at integration time.
- **Simulator/iPad protocol** (`docs/PLUGIN_IOS_HOST.md`'s `[T8.5]`
  device checklist; `research/plugin-ios/T8_5_simulator.md`;
  `research/plugin-plan/T11_ipad_run_2026-09-16.md`): the iOS-specific
  gate ladder — iOS Simulator first (Mac's own mic passthrough, real
  Groq), then a physical iPad stand (skill `ipad-physical-testing`) for
  hardware-only behaviour (system mic-mute button, Smart Folio close as
  interruption, backgrounding duration, locked-screen Keychain reads).
- **`scripts/check-ios-build.sh`**: `cargo build -p voxis-core -p
  tauri-plugin-voxis --target aarch64-apple-ios[-sim]` with zero feature
  flags — the iOS-buildability gate for both `voxis-core` and
  `tauri-plugin-voxis` (the plugin built without its `desktop` feature).
  Runs per-task during development (this repo has no per-commit macOS CI
  lane — Linux-docker CI cannot cross-compile for iOS at all); enforced at
  release time in `release.yml`'s macOS-VM lane (see the CHANGELOG/CI
  notes below).

## Known limitations / follow-ups

Carried forward from the plan's own Follow-ups section
(`.pi/plans/tauri-plugin-voxis.md`) — current as of this document, not
exhaustive of every minor:

- **Android**: no plugin implementation exists. The contract (commands/
  events/`AudioCapture`/`SecretStore` traits) was designed with a future
  Kotlin `AudioRecord` implementation in mind but nothing is built.
- **On-device transcription**: `TranscriptionEngine` trait + iOS 26
  `DictationTranscriber` (not `SpeechTranscriber` — `ru_RU` is absent from
  the latter's `supportedLocales` as of macOS 26.6.2, confirmed by a
  direct Swift probe) is a follow-up, not implemented; quality for
  Russian would need its own measurement (the published "WER 2.12%"
  benchmark is `SpeechTranscriber`-specific and does not transfer).
- **Live sync / server hub**: a bidirectional profile+dictionary sync
  server (`TranscriptionClient + dictionary + LLM` behind `/v1/audio/
  transcriptions` + `/profile`) is explicitly out of scope for this
  plan — today's profile transport is snapshot-on-demand (desktop-dir
  read, QR+LAN one-shot, or `.vxp` file), not a live channel.
- **`import_profile_from_file`**: no such command exists — a host reads
  `.vxp` bytes itself and calls `apply_profile(bytes, keySource)`
  directly. Safe (the bytes are AEAD-sealed end to end regardless of who
  reads them off disk) but slightly more plumbing for a host than a
  single dedicated command would be.
- **Live Activity / Dynamic Island** (iOS): implemented and unit-tested
  (`ios/Sources/LiveActivity.swift`, `ios/LiveActivityWidget/*.swift`,
  Rust-side bridge) but **not yet verified end-to-end on a real device**
  with a real host's own `WidgetBundle` — that on-device confirmation
  (plan Task 9b) is still open. The Apple-documented premise that
  `StopDictationIntent.perform()` runs in the host's app process (not the
  widget-extension process) is unconfirmed on real hardware for this
  specific intent/app pairing until that task runs.
- **Locked-screen Keychain reads mid-transcription**: `KeychainSecretStore`
  uses `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` — a Stop tap
  triggered from a locked Lock Screen (e.g. via the Live Activity's Stop
  button) can hit `errSecInteractionNotAllowed` when the pipeline's
  transcription step reads the API key. Documented as an open item in
  `docs/PLUGIN_IOS_HOST.md`'s `[T9a]` section, not fixed there.
- **`set_hotkey`'s one real rejection path (`permissionDenied`, macOS
  Accessibility) needs a host-visible affordance.** The plugin returns a
  structured error; whether a given host surfaces it (rather than
  swallowing it under a "no backend on this build" assumption) is a
  per-host integration bug class — naked's own review found and fixed
  exactly this (`research/plugin-plan/review_10p4_r2.md`).
- **CI git-dependency auth for a private Forgejo repo** is unresolved for
  any third-party host wiring CI against this plugin as a git dependency
  — naked's own attempt hit this wall and left it as an owner decision
  (PAT secret / git subtree / making the repo public). Not something this
  plugin's own code can fix; noted here since it blocks any host's CI
  from ever exercising the real dependency, not just a specific host's
  choice.

## `[ADO-1a lessons]` workspace-root-in-repo-root checklist

Recorded once (Task 1a moved the Cargo workspace root from `src-tauri/` to
the repo root) because every consequence below has bitten at least once and
is easy to rediscover the hard way otherwise:

1. `/target/` (repo root, not `src-tauri/target/`) is the actual build
   output directory now — confirm `.gitignore` covers the root-level path,
   not just a nested one.
2. **`/Cargo.lock` is at the repo root**, not `src-tauri/Cargo.lock` — any
   version-bump instruction (`.pi/skills/voxis-deploy/SKILL.md`) must edit
   the root file. `src-tauri/Cargo.lock` no longer exists.
3. `[profile.*]` tables are only honoured by Cargo at the **workspace
   root** manifest (`/Cargo.toml`) — a non-root member's own `[profile.*]`
   is silently ignored. `src-tauri/tests/release_profile_guard.rs` is the
   regression test for this specific class of mistake (it resolves the
   real workspace root the same way Cargo does and asserts `[profile.
   release]`'s `strip` setting lives there).
4. Bare glob patterns in `.gitignore` (`dictionary.txt`, `*.db`,
   `config.ini`) apply repo-wide from a root-level `.gitignore` and can
   silently swallow same-named test fixtures anywhere in the tree — this
   repo's convention is to name fixtures `*.fixture.*` to avoid the
   collision rather than special-case `.gitignore` per fixture directory.
5. `tauri::generate_context!()` requires an existing `dist/` directory even
   for `cargo test` (pre-existing behaviour, not new to the workspace
   move) — CI's frontend-build step must run before any Rust test step
   that touches the `voice` binary crate.
6. **Spotlight indexing a new, large `target/` at the repo root** caused
   real timing-test flakiness on at least one development Mac (load
   average 300–500, `mds_store` visible in `ps`) — `touch target/.
   metadata_never_index` is the fix on that kind of host; irrelevant on
   Linux CI (no Spotlight), so not added to the CI image.
