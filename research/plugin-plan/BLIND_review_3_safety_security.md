# SAFETY & SECURITY review — tauri-plugin-voxis plan

Reviewed artifact: `/Users/shamash/work/voxis/.pi/plans/tauri-plugin-voxis.md` @ commit `0d8560f`.
Evidence sources: voxis tree (`src-tauri/src/**`, `src/theme-engine/**`), naked-cli on `spex` (read-only ssh), RFC 9106, OWASP Password Storage Cheat Sheet, App Store Review Guidelines (fetched 2026-09), and one compiled Argon2 micro-probe (`argon2` crate 0.5, release, this Mac; deleted afterwards).

## Verdict: GO-WITH-CHANGES
The core split and plugin shape are sound, but the profile-transfer crypto (Task 2/7) is a 20-bit-entropy offline-brute-forceable wrapper around long-lived Groq/OpenAI keys, imported keys land in plaintext sqlite inside a host that already has an encrypted secret store, and the theme-engine loader is incompatible with (and would pressure weakening of) naked's CSP. All fixable inside the existing task boundaries before T2/T5/T6/T7 start.

---

## Strategic findings

### S1 — 6-digit code + Argon2id gives a LAN sniffer an offline brute-force of ~10^6 guesses over API keys
**Claim (plan, Task 2/7):** "профиль зашифрован ChaCha20-Poly1305 ключом из 6-значного кода на экране (Argon2id)"; server is plaintext HTTP on `0.0.0.0:<random>`.
**Evidence:**
- Payload contains `config.api_key` and `config.llm.api_key` — plaintext today in `config.db` (`src-tauri/src/storage/config_sqlite.rs:275`, `:393`; `config/mod.rs:200`, `:256`). These are bearer credentials (`transcription/mod.rs:178 .bearer_auth(&self.api_key)`, `llm/engine.rs:21`) with billing attached.
- 10^6 codes ≈ 2^19.9 bits. Anyone on the same LAN (open Wi‑Fi, ARP-spoof, or simply the AP owner) captures the HTTP body; the AEAD then acts as a perfect brute-force oracle (Poly1305 tag verifies each guess).
- RFC 9106 §4 recommended params: 1st option m=2 GiB,t=1,p=4; 2nd option m=64 MiB,t=3,p=4 (https://www.rfc-editor.org/rfc/rfc9106.txt, §4 items 1–2). OWASP minimum: m=19 MiB,t=2,p=1 (https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html, "Argon2id").
- Micro-probe on this Mac with the pure-Rust `argon2` crate (the one the plan names): OWASP-min → 520 ms/guess → 10^6 codes ≈ 144 CPU-h single-thread, ≈ 18 h on 8 threads; RFC 2nd option → 1.2 s/guess ≈ 42 h on 8 threads; RFC 1st option (2 GiB) → 45 s/guess, which is unusable on an iPhone importer. The pure-Rust crate is several× slower than the reference C / GPU implementations an attacker would use, so real cost is hours, not days, for the only two params an iPhone can actually afford. A 6-digit code cannot be rescued by KDF tuning.
- Additional exposure: the code is *displayed on the desktop screen* alongside the QR — so screen-share/photo leaks the code too, making the KDF moot in that scenario.
**Impact:** Full compromise of the user's Groq/OpenAI keys by any passive LAN observer within a 120 s window; also of any profile file leaked via mail.
**Fix (Task 2 + Task 7, no new tasks):**
1. Put a real key in the optical channel: QR = `host, port, token, k_qr(256-bit random, base64url)`. Derive `key = HKDF-SHA256(ikm = k_qr, info = "voxis-profile-v1" || code)`. Keep the 6-digit code *only* as a second factor typed on the phone (defends against a QR photo). Argon2 becomes unnecessary for the QR path; ciphertext is 2^128+ against LAN capture.
2. For the **file** path (AirDrop/mail) do not use a 6-digit code at all: generate a 5–6 word random passphrase (≥ 64 bits) or a 26-char base32 key shown once; Argon2id m=64 MiB,t=3,p=1 (RFC 2nd option, p=1 for phones) then still applies. Document "6 digits is not a file password".
3. Alternative if you want to keep "code only": a PAKE (`spake2`/CPace crate) so the code is online-only with the server allowing exactly 1 attempt — more code; option 1 is the KISS one.
4. Serve on the LAN interface IP that is put into the QR, not `0.0.0.0` (which also exposes the endpoint on VPN/Tailscale/hotspot interfaces); reject clients not in the same /24 or /64 as a cheap second line.
5. Acceptance test to add: "ciphertext is indistinguishable without `k_qr`: brute-forcing all 10^6 codes with the captured body yields no valid AEAD tag" (trivially true after fix 1; makes regression visible).

### S2 — Imported API keys stored in plaintext sqlite inside the host; iOS gets no Keychain; contradicts the host's own SECURITY.md
**Claim (plan, Task 6 step 3):** "Хранилище плагина — те же sqlite-реализации из core с другим базовым путём".
**Evidence:**
- Voxis desktop today: keys in plaintext `config.db` (`config_sqlite.rs:275/393`), no encryption layer anywhere in `storage/`. Reusing that in the plugin = plaintext keys in `<host-config>/voxis-plugin/config.db`.
- naked already has a `SecretStore` trait (`crates/naked-core/src/secrets.rs:16`) with a production `EncryptedFileSecretStore` (envelope encryption, 0600) and states in `SECURITY.md` ("Credential storage"): secrets go to the encrypted store; "Do report any UI or doc string that claims secrets are stored in an OS keychain". Shipping a plugin that drops third-party API keys next to that store in plaintext breaks the documented posture of the very first host.
- iOS: an app-container sqlite file is included in iCloud/iTunes backup by default and only gets the default Data Protection class; Keychain items with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` are neither backed up off-device nor readable when locked (https://developer.apple.com/documentation/security/ksecattraccessiblewhenunlockedthisdeviceonly). naked's macOS entitlements already include `keychain-access-groups` (`src-tauri/Entitlements.plist`), so Keychain is available to the host.
**Impact:** Key theft via device backup, synced folders, or any other-process read on desktop; the host inherits liability for credentials it never asked to hold.
**Fix (Task 3 + Task 6):** add `pub trait SecretStore { get/set/delete(name) }` to the plugin's Rust API; `init_with(SecretStore)` lets the host inject its own (naked: adapter over `naked_core::SecretStore`); default impl: iOS → Keychain (Swift side, `WhenUnlockedThisDeviceOnly`), desktop → `keyring` crate or 0600 file behind a warn-log. `ProfileConfig` stores `api_key_ref`, not the key; `apply_profile` splits secrets out before touching sqlite. Acceptance: `grep -c sk- <host-config>/voxis-plugin/*.db == 0` after import.

### S3 — theme-engine executes theme source via Blob/data-URL `import()`; naked's CSP forbids it, and relaxing CSP is a host security regression
**Claim (plan, Task 5):** "монтирует theme-engine `theme.js` (contract v1) — визуальный паритет с desktop бесплатно".
**Evidence:**
- `src/theme-engine/loader.ts:6-7` "Uses a Blob URL + dynamic import … (user code runs unsandboxed — trusted by design)"; `:16-20` `new Blob([source]) … import(url)`; `:43` fallback `import(toDataUrl(source))`.
- naked `src-tauri/tauri.conf.json:23`: `csp: "default-src 'self'; script-src 'self'; …"` — no `blob:`/`data:` in `script-src`. Both loader paths are blocked at runtime in naked.
- Profile carries `theme` (`config/mod.rs:160-162` — a *name*), but Voxis desktop also has user themes under `<config>/themes` (CLAUDE.md), and `import_profile_from_desktop` reads that config dir → the temptation to ship theme *source* into the host webview, which has Tauri IPC to naked's SSH/command surface.
**Impact:** Either the overlay silently fails in naked (T3.5 host-min will pass because host-min has no CSP, then T10 fails), or someone adds `blob:` to naked's `script-src`, weakening XSS containment for a terminal app that holds SSH credentials.
**Fix (Task 5):** guest-js bundles builtin themes as statically imported ES modules (`import * as glass from "./themes/glass.js"`) and a `ThemeRegistry` keyed by id — no Blob loader in the plugin path. Profile `theme` = id only; unknown id → default + warn. Explicitly out of scope: user `theme.js` in hosts. Add to host-min a CSP identical to naked's so T3.5 catches it. Document for hosts: "no CSP changes required".

### S4 — Hold-mode recording has no Rust-side lease; webview death (documented in naked) leaves the mic open until the guard fires
**Claim (plan, Task 5):** safety rules are all JS-side: "pointercancel = stop", "blur → stop", "keyup lost → stop".
**Evidence:**
- naked `src-tauri/src/lib.rs:515-530`: "F77: when WebKit's content process dies (jetsam on iPhone/iPad, a crash …) the window is left BLANK with the app alive … Reload it". A reload wipes guest-js state — no `pointercancel`, no `blur`, no keyup ever arrive.
- Guard defaults that then govern: `DEFAULT_SILENCE_TIMEOUT_MS = 60_000`, `DEFAULT_MAX_RECORDING_MS = 600_000`, `ABS_MAX_RECORDING_MS = 1_800_000` (`src-tauri/src/config/consts.rs:139,146,158`). With `audio` background mode (Task 9) that is up to 10 min of unattended, uploaded voice — and the guard's silence branch only discards if `ever_loud=false`.
**Impact:** Unintended capture + upload to a third party after a crash the user didn't notice; App Store 2.5.14 ("clear visual and/or audible indication when recording") is violated the moment the overlay is gone (https://developer.apple.com/app-store/review/guidelines/ §2.5.14).
**Fix (Task 3):** `start(mode: Hold)` returns a session that requires a heartbeat (`voxis://hold-lease` every 1 s from guest-js); Rust cancels after 3 missed beats with `guard_outcome = LeaseLost`. Plus in the plugin's Tauri hooks: `on_web_content_process_terminate`/`on_page_load` → `cancel_all(Hold)`. Toggle mode keeps the existing guard. Add the test "webview reload during Hold → capture stopped ≤ 3 s" to T3 and T3.5.

### S5 — Temp WAV lifecycle on crash is unspecified; desktop today never touches disk on the happy path
**Claim (plan, decision 3):** "Swift/cpal пишут 16 kHz mono WAV во временный файл"; only "HTTP 5xx → … очистка temp-файла" in Task 3 tests.
**Evidence:** desktop keeps audio in memory end-to-end — `audio/recorder.rs:264 stop() -> Result<Vec<u8>>`, `audio/encoder.rs:61 samples_to_wav(..) -> Vec<u8>`; disk only on failure (`storage/failed_audio.rs:16 MAX_ENTRIES = 3`, FIFO with `remove_file`) or in debug mode. The plugin regresses this: a crash mid-recording (or the S4 scenario) leaves a WAV with voice in an unspecified temp dir. On iOS `tmp/` is purged only opportunistically; on macOS `$TMPDIR` persists for days.
**Impact:** Unbounded, unencrypted retention of voice data the user believes was discarded; the plan's "Не синкаем … debug / failed_audio" privacy stance is undercut by the plugin's own capture layer.
**Fix (Task 3/4/8):** (a) dedicated dir `<host-cache>/voxis-plugin/rec/<session-uuid>.wav`, 0600 on desktop; (b) plugin `init()` sweeps the dir unconditionally (any file = orphan, because results are never re-read); (c) iOS: `FileProtectionType.completeUnlessOpen` (still writable when the device locks mid-recording), `isExcludedFromBackup = true`; (d) delete in a `Drop`/`finally` for every outcome incl. `cancel` and `NoSpeech`; (e) acceptance test: kill host-min with SIGKILL during Recording → relaunch → `rec/` empty.

### S6 — Hosts embedding the plugin ship audio and text to third-party AI without a consent step; App Store 5.1.2(i) and privacy-label duties are not in the plan
**Claim (plan, Task 8/11):** only `NSMicrophoneUsageDescription` is listed as the host's obligation.
**Evidence:**
- App Store Review Guidelines 5.1.2(i): "You must clearly disclose where personal data will be shared with third parties, including with third-party AI, and obtain explicit permission before doing so." 5.1.1(iii) data minimisation. (https://developer.apple.com/app-store/review/guidelines/)
- naked's `src-tauri/gen/apple/PrivacyInfo.xcprivacy` declares `NSPrivacyCollectedDataTypes = []` with a TODO "recordings are local-only unless the user explicitly exports/shares them" — false once Voxis sends every utterance to Groq and the LLM provider.
- 2.5.4: background services "only … for their intended purposes"; adding `UIBackgroundModes: audio` to an SSH client whose current modes are `location` (naked `project.yml:70`) will draw reviewer questions and must be justified by the dictation flow actually running in background.
**Impact:** Rejection risk for the host or, worse, an approved app with an inaccurate privacy label.
**Fix (Task 12 `PLUGIN_IOS_HOST.md`, and a plugin API in Task 3):** `dictate()` refuses until `set_consent(true)` has been called once per provider host; plugin ships a `PrivacyInfo.xcprivacy` snippet for hosts ("Audio Data / Other User Content — App Functionality — shared with third-party AI: <provider domain from profile>"); host checklist: usage-description text that names third-party STT, privacy-policy paragraph, 2.5.4 justification text, and the orange-dot expectation for background recording.

### S7 — Read-only access to Voxis DBs via `SqliteSchema::connect()` cannot work as written; and no busy handling against a running Voxis
**Claim (plan, Task 6):** "открывает базы read-only (`SQLITE_OPEN_READ_ONLY`, никакой записи…)" and step 2 "Read-only открытие; сборка через `Profile::from_storage`".
**Evidence:**
- Every storage `connect()` runs `init_schema` (`storage/sqlite_base.rs:30-33`). `ProvidersStorage::init_schema` INSERTs builtin providers when the table is empty (`storage/providers/storage.rs:167-193`); `CREATE TABLE IF NOT EXISTS` fails on a read-only handle when the table is missing (older Voxis without `prompts.db`). Both return `SQLITE_READONLY`.
- No WAL, no `busy_timeout` anywhere (`grep -rn journal_mode\|busy_timeout src-tauri/src` → 0 hits); `Connection::open` is plain rwc (`sqlite_base.rs:60`). In rollback-journal mode a reader's SHARED lock request returns `SQLITE_BUSY` instantly while Voxis holds PENDING/EXCLUSIVE during a save (https://www.sqlite.org/lockingv3.html; https://www.sqlite.org/c3ref/busy_timeout.html). Voxis writes on every settings change and every dictionary learn.
**Impact:** `import_profile_from_desktop()` is flaky when Voxis is running, and the "never writes" guarantee is accidental rather than enforced.
**Fix (Task 6):** add `open_read_only(path)` in `sqlite_base` using `OpenFlags::SQLITE_OPEN_READ_ONLY | SQLITE_OPEN_NO_MUTEX`, `busy_timeout(2 s)`, **no** `init_schema`; give the four storages a `::read_only(path)` constructor that bypasses `SqliteSchema::connect`. Tests: (1) import while another connection holds a write transaction → succeeds within timeout; (2) import from a dir lacking `prompts.db` → `NotFound` for prompts, profile still built; (3) assert the source DB's `mtime` and sha256 are unchanged after import.

### S8 — `Debug`/`Serialize` on config types make "ключи никогда не логируются" unenforceable
**Claim (plan, Task 7 acceptance & Verification 6):** "ключи API никогда не логируются"; check = `grep -i "api_key\|sk-" logs` empty.
**Evidence:** `AppConfig`/`LlmConfig` derive `Debug` with plaintext `api_key` (`config/mod.rs:191,200,252,256`); `redact_sensitive_text` exists only in `diagnostics/report.rs`. The new `VoxisProfile` (Task 2) will derive `Debug` + `Serialize` for JSON — one `tracing::debug!(?profile)` or an error `{:?}` in the share server leaks the key into `logs/`, and the grep check is post-hoc.
**Fix (Task 2):** wrap keys in a `Secret(String)` newtype whose `Debug` prints `Secret([REDACTED])`, `Serialize` only via an explicit `expose()`; unit test that `format!("{:?}", profile)` does not contain the key. Also strip the `token` from axum access logs in Task 7.

---

## Tactical findings

- **T1 (Task 7) QR contents / URL-scheme hijack.** `voxis://import?host=&port=&token=` requires the *host* to register the `voxis` scheme (naked registers only `naked`, `project.yml:72-75`); a generic scheme claimed by several hosts (naked, future Voxis iOS) is undefined on iOS, and any third-party app can claim it and receive the token (+ `k_qr` after S1). Fix: no URL scheme — plugin offers `import_profile_from_qr(payload)` and hosts scan in-app (`NSCameraUsageDescription` needed) or paste the string.
- **T2 (Task 7) 120 s / single-use is fine for the token, insufficient alone.** Token single-use + 120 s is adequate *replay* protection, but does nothing for confidentiality (S1). Add: bind the token to the first connecting IP, respond `410` on second GET (already planned), and return a constant-size body so a wrong token and an expired token are indistinguishable on the wire.
- **T3 (Task 8) mute path.** `AVAudioApplication.inputMuteStateChangeNotification` is iOS 17+; the plan targets hosts supporting older iOS? naked's `LSRequiresIPhoneOS`/min OS not checked — gate with `#available(iOS 17, *)`; below that, keep the RMS-based guard only. Also treat `muted=true` as an *immediate* `guard: Muted` state shown in the overlay rather than "as silence" (60 s of silence before feedback is a bad UX for a muted mic).
- **T4 (Task 3) silence guard on iOS background.** `ever_loud=true` + background + no lease (S4) means a pocket recording of 10 min reaches Groq. After S4, also cap Hold-mode `max_recording_ms` at 120 s independently of profile value.
- **T5 (Task 1) rollback gate.** `cargo test --lib ≥ 1037` (repo has 1049 `#[test]` attrs, plausible) + hardware A/B/C is a *behaviour* gate, not a *data* gate. `paths.rs` uses `tauri::AppHandle` and `libc::EXDEV` (`storage/paths.rs:9`, migration code) — moving it into a no-Tauri core will force edits in the exact code that decides which directory the user's data lives in. Add one fixture test: copy a real pre-T1 `<config>` snapshot (config.db + history.db + dictionary.txt + providers.db + prompts.db) into tempdir → post-T1 `factory` loads it → every field equals a golden JSON; and a startup log line asserting `config_dir == <same path as v0.1.5>`.
- **T6 (Task 9) naked already owns a widget extension.** `NakedLiveActivity` target (`project.yml:254-261`, `NakedLiveActivityWidget.swift` with `@main WidgetBundle`) exists with `NSSupportsLiveActivities: true`. Task 9's "widget-extension добавляется хостом" must instead deliver an `ActivityAttributes` + `ActivityConfiguration` for the host to add to its *existing* `WidgetBundle`; a second extension bundle is a review/complexity hazard. Not security per se, but it gates Task 9's file list.
- **T7 (Task 5/11) haptics & indication.** Keep a persistent recording indicator in the overlay in Toggle mode — 2.5.14 requires it; the plan only lists haptics on start/stop.

---

## Depends:/Files: annotation errors

- **Task 6 `Files:`** must include `crates/voxis-core/src/storage/sqlite_base.rs` (read-only opener, S7) and each storage's `read_only()` constructor — currently lists only `profile_source.rs` and `paths.rs`.
- **Task 6 / Task 3** — the `SecretStore` trait (S2) is a plugin-API surface; it belongs in Task 3 `Files:` (`src/lib.rs`, `src/secrets.rs`) and Task 6 depends on it. Task 10 (naked) then also touches `crates/naked-core` adapter — add to Task 10 `Files:`.
- **Task 7 `Depends:`** should also depend on **Task 3.5** if the integration test "GET→open(code)" is meant to run against the plugin's importer; as written it depends only on Task 2, so the QR payload format (S1/T1) can drift from what Task 3's `apply_profile(bytes, code?)` accepts. Put the payload schema in `contract/fixtures/profile-qr.json` (Task 3.5 `Files:`).
- **Task 5 `Files:`** lists `src/theme-engine/` "экспорт renderer как пакет-часть" — after S3 this becomes a *build-time bundling* of `builtin/*` into guest-js; `src/theme-engine/loader.ts` must NOT be part of the exported package. Also Task 3.5 `host-min` needs a `tauri.conf.json` CSP copied from naked — add to Task 3.5 `Files:`.
- **Task 9 `Files:`** should point to naked's existing `src-tauri/gen/apple/NakedLiveActivity/**` (T6), not a new `WidgetExtension/**` template; Task 11 `Files:` should list `PrivacyInfo.xcprivacy` (S6).
- **Task 8 `Depends:`** on Task 3 only is fine, but the S5 temp-file policy must be defined in Task 3 (`capture.rs` trait contract: path ownership + cleanup) so Task 4 and Task 8 implement the same rule — add "capture path/cleanup contract" to Task 3 acceptance.

---

## Verified-OK

- Desktop keeps audio in memory on the happy path; only `failed_audio/` (max 3, FIFO) and debug mode write WAVs (`recorder.rs:264`, `encoder.rs:61`, `failed_audio.rs:16`). The "не синкаем history/corrections/debug/failed_audio" exclusion matches how those are stored (separate DBs/dirs), so a profile built from `ConfigStorage/Dictionary/Providers/Prompts` traits cannot pick them up by accident.
- Guard constants exist and match the plan's numbers (`consts.rs:139` 60 s silence, `:146` 600 s max, `:190` `SILENCE_RMS 0.02`, `:194` 250 ms poll, `:199/203` 10 s window / 0.80 fraction); "75 s тишина → NoSpeech" is consistent with 60 s + 10 s window + lead time.
- `ProvidersStorage` has no API-key column (`providers/storage.rs` schema) — the only secrets in the profile are `api_key` and `llm.api_key` from `config.db`, which bounds the blast radius of S1/S2 to two credentials.
- naked macOS is *not* App-Sandboxed (`Entitlements.plist`: hardened-runtime keys only), so reading `~/Library/Application Support/voxis` from the host process is permitted; `dirs::config_dir()` (`paths.rs:21`) resolves to that path.
- naked's CSP `connect-src ipc: http://ipc.localhost` does not affect the plugin: STT/LLM HTTP happens in Rust (`reqwest`), not from the webview.
- naked already has an encrypted secret store and a `SecretStore` trait (`naked-core/src/secrets.rs`), so S2's fix has a ready host-side implementation; naked's iOS entitlements already carry `application-groups` (`project.yml:93,155`) should the Task 9 App-Group fallback be needed.
- ChaCha20-Poly1305 with random 96-bit nonce per file and 128-bit salt (`VXP1` header) is a correct AEAD construction; the weakness is solely the key-derivation input (S1), not the cipher.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Read-only review delivered in the required markdown shape; no plan or source files modified (git status clean in voxis; naked inspected via read-only ssh)."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Every finding cites file:line in voxis/naked or a fetched URL (RFC 9106 §4, OWASP cheat sheet, App Store guidelines 2.5.4/2.5.14/5.1.2), plus a compiled Argon2 timing probe with recorded numbers."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {"command": "grep -rn api_key src-tauri/src/storage src-tauri/src/config", "result": "passed", "summary": "keys stored plaintext in config.db (config_sqlite.rs:275,393)"},
    {"command": "grep -rn journal_mode|WAL|busy_timeout|READ_ONLY src-tauri/src", "result": "passed", "summary": "no WAL/busy_timeout/read-only handling exists"},
    {"command": "grep -rn 'import(|Blob|sandbox' src/theme-engine/*.ts", "result": "passed", "summary": "loader.ts uses Blob/data URL import, unsandboxed"},
    {"command": "ssh spex 'cd ~/work/naked-cli && grep csp src-tauri/tauri.conf.json; cat SECURITY.md; grep -n NakedLiveActivity project.yml; sed -n 512,530p src-tauri/src/lib.rs'", "result": "passed", "summary": "CSP script-src 'self'; encrypted SecretStore documented; existing Live Activity target; F77 webview-death reload"},
    {"command": "curl rfc9106.txt / OWASP cheat sheet / App Store guidelines", "result": "passed", "summary": "fetched and quoted Argon2 params and guidelines 2.5.4, 2.5.14, 5.1.2"},
    {"command": "cargo run --release (tmp Argon2 probe, argon2 0.5)", "result": "passed", "summary": "19MiB/t2/p1 = 520 ms/guess; 64MiB/t3/p4 = 1.2 s; 2GiB = 45 s; probe dir deleted"}
  ],
  "validationOutput": [
    "10^6 codes × 0.52 s ≈ 144 CPU-h single-thread / 18 h on 8 threads at OWASP-min Argon2id (pure-Rust crate; attacker with C/GPU is faster)",
    "naked CSP: default-src 'self'; script-src 'self' — blocks theme-engine Blob/data import",
    "voxis git status clean after review"
  ],
  "residualRisks": [
    "Argon2 timings are from the pure-Rust crate on one Mac; absolute attacker cost is lower, conclusion (6 digits insufficient) unaffected",
    "Apple developer docs (Keychain accessibility, WidgetKit) cited by URL from prior knowledge; pages are JS-rendered and were not text-fetched",
    "Web search tool was not available in this run; references were fetched directly via curl"
  ],
  "noStagedFiles": true,
  "diffSummary": "No source or plan changes; report written to the bound output path only.",
  "reviewFindings": [
    "blocker: plan Task 2/7 - 6-digit code + Argon2id is offline-brute-forceable over captured LAN ciphertext containing API keys (S1)",
    "blocker: plan Task 6 step 3 - API keys land in plaintext sqlite in host; no Keychain on iOS; contradicts naked SECURITY.md (S2)",
    "blocker: plan Task 5 - theme-engine Blob/data-URL import is blocked by naked CSP script-src 'self'; must bundle themes statically (S3)",
    "major: plan Task 3/5 - no Rust-side hold lease; webview death (naked F77) leaves mic open up to guard limits (S4)",
    "major: plan Task 3/4/8 - temp WAV crash retention unspecified (S5)",
    "major: plan Task 8/11/12 - third-party-AI consent and privacy label duties missing (S6)",
    "major: plan Task 6 - SqliteSchema::connect runs init_schema (INSERTs) → fails read-only; no busy_timeout (S7)",
    "minor: Debug/Serialize on config/profile types leak keys into logs (S8)"
  ],
  "manualNotes": "Findings S3 (naked CSP vs theme-engine Blob import) and the Argon2 numbers were fully established before the orchestrator's mid-run steering arrived; the cargo probe had already completed and its directory was removed."
}
```
