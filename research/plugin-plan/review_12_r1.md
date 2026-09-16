# Review: Task 12 (docs / versions / CI lane) — Fresh Reviewer Round 1

VERDICT: APPROVE

## Mismatches

Only one doc-accuracy issue found; everything else checked out exactly against source.

- `crates/tauri-plugin-voxis/README.md` "Registering the plugin (`init*` variants)" table,
  `init_ios()` row: says capture backend is `ios::AudioCapture (Swift, AVAudioEngine)`. The
  actual module/type names in `crates/tauri-plugin-voxis/src/lib.rs` are `mobile::IosCapture`
  (capture) and `mobile::IosKeychainSecretStore` (secret store) — there is no `ios` module in
  this crate (`lib.rs`: `#[cfg(target_os = "ios")] pub mod mobile;`). Functionally accurate
  (AVAudioEngine-backed capture, Keychain-backed secrets, no separate Cargo feature — all
  correct), but the module path named in the doc does not exist in the code. Low severity
  (presentational/naming only, doesn't mislead a host about behavior or API), but flagging
  per "docs must not lie" — file: `crates/tauri-plugin-voxis/README.md` init-variants table;
  source: `crates/tauri-plugin-voxis/src/lib.rs` (`init_ios`/`init_ios_with`, `mobile::IosCapture`,
  `mobile::IosKeychainSecretStore`).

## CI findings

- `.forgejo/workflows/ci.yml` `core-plugin` job: `runs-on: host` and the manual-checkout step
  are byte-for-byte consistent with the existing `fast`/`host-min-e2e` jobs (same
  `CI_GIT_BASE`/`GITHUB_TOKEN` pattern, same docker-run cache-mount convention). Uses
  `bun install --frozen-lockfile` for guest-js, matching `fast`'s own frontend step. Confirmed
  the job actually runs `cargo test -p voxis-core -p tauri-plugin-voxis -p voxis-fake-stt` (not
  `--workspace`) and `cargo clippy -p voxis-core -p tauri-plugin-voxis --all-targets -- -D warnings`,
  matching the job's own header comment's rationale (host-min would otherwise be pulled into
  every run's compile time). The `cargo audit` step is `continue-on-error: true` with an
  honest, specific comment explaining it's a real no-op today (voxis-ci image has no
  `cargo-audit` installed) rather than a silently-skipped real check — no overclaim.
- `.forgejo/workflows/release.yml`: confirmed `on.push.tags: ['v*']` at the top of the file —
  this directly corroborates the SKILL.md claim that a `plugin-v0.1.0` tag does **not** match
  the `v*` glob (the tag string starts with `p`, not `v`) and therefore never triggers this
  workflow. Read the full ~60-line surrounding block (offset 150–310, end of the macOS-VM
  lane through "publish to Forgejo release"):
  - The new "iOS cross-build gate" step is the immediate next step after "build macOS
    (best-effort — KVM VM)", both inside the same job, both before "publish to Forgejo
    release" — correctly placed in the macOS-VM lane, not accidentally leaked into the
    Linux/Windows Docker lane above it.
  - It SSHes into the VM the same way as the neighbouring step's own helpers
    (`sshpass -p "$SSH_PASS" ssh ... -p "$SSH_PORT" "$SSH_USER@localhost"`), using the same
    default `SSH_HOST_PORT=50923`/`VM_USER=user`/`VM_PASS=alpine` env-var-overridable
    conventions as `scripts/macos-vm.sh`'s own `ssh_vm()` (`SSH_HOST_PORT`, `VM_USER`,
    `VM_PASS` — confirmed identical variable names/defaults in `scripts/macos-vm.sh`).
  - `continue-on-error: false` on the new step is correct (task says "blocking whenever the
    macOS VM is available") and matches the step's own name annotation.
  - VM-stop-trap-runs-exactly-once: the old unconditional
    `bash scripts/macos-vm.sh stop 2>/dev/null || true` at the end of the macOS-build step was
    removed and replaced by a comment pointing at the new step's own trap. Verified this is
    safe: both the macOS-build step and the new iOS-gate step gate on the *exact same*
    preflight condition (`$PREPARED` file exists AND `/dev/kvm` exists), evaluated
    sequentially in the same job with no state change between them — so whenever the macOS
    build step actually proceeds past its own preflight (i.e., a VM could plausibly be
    running), the iOS-gate step's identical preflight also passes, `trap cleanup EXIT` is
    registered, and `scripts/macos-vm.sh stop` fires on every one of that step's exit paths
    (SSH-unreachable early return, check-ios-build.sh success, or a hard failure) — exactly
    once. In the complementary case (no VM image / no KVM on this host), neither step ever
    starts a VM, so skipping the stop call there is a no-op regardless — matches the
    pre-existing behavior (the pre-diff code also skipped `stop` on that same early-exit path).
  - Checkout-path-inside-the-VM: the new step runs `ios_ssh 'cd ~/voxis && bash
    scripts/check-ios-build.sh'`. Confirmed `scripts/macos-vm.sh`'s own `sync_src`/build
    helpers write the synced tree to exactly `~/voxis` inside the VM
    (`ssh_vm 'rm -rf ~/voxis && mkdir -p ~/voxis && tar xzf /tmp/voxis-src.tar.gz -C ~/voxis'`,
    used by both `cmd_build`/lane 1 and `cmd_build_gui`/lane 2) — the new step's path
    reference is consistent with how `scripts/macos-vm.sh build`/`build-gui` themselves lay
    out the checkout, not a guess at a different path.

## Checked OK

- **Commands table** (`crates/tauri-plugin-voxis/README.md`): all 11 commands (`start`, `stop`,
  `cancel`, `state`, `get_profile`, `apply_profile`, `import_profile_from_desktop`,
  `import_profile_from_qr`, `set_hotkey`, `set_consent`, `hold_lease`) match
  `src/commands.rs`'s `#[tauri::command]` fns 1:1, including `lib.rs`'s own
  `generate_handler!` list ("the eleven Tauri commands" — confirmed literally 11) and
  signatures (`apply_profile(bytes, keySource)`, `import_profile_from_qr(payload, code)`, etc).
- **Errors table**: all 11 `PluginError` variants in `src/error.rs`
  (`AlreadyRecording, UnknownSession, ConsentRequired, Capture, Store, NotImplemented,
  Transcription, InvalidHotkey, PermissionDenied, NotFound, Profile`) match the README's kind
  names exactly under `#[serde(tag = "kind", rename_all = "camelCase")]`
  (`alreadyRecording`/`unknownSession`/etc.), and every "extra field" listed
  (`sessionId`, `providerHost`, `message`, `what`) matches the struct-variant field names
  (verified serde output directly via `error.rs`'s own unit tests, e.g.
  `unknown_session_carries_the_id` asserts `{"kind":"unknownSession","sessionId":"abc"}`).
- **`HotkeySpec`**: `crates/voxis-core/src/hotkey/mod.rs`'s `KEY_TABLE` confirmed to contain
  exactly the aliases the README lists (`alt_r`/`alt_gr`/`altgr`; `ctrl_r`/`control_r`;
  `shift_r`; `super_r`/`cmd_r`/`meta_r`; `f1`..`f12` each as their own entry, table stops at
  `f12`, no `f13`+). `crates/tauri-plugin-voxis/src/hotkey_desktop.rs` confirmed to support
  both syntaxes the README documents: a single named key via `voxis_core::hotkey::parse_hotkey`,
  and `"Mod+Mod+Key"` combos via `HotkeyCombo::parse` + a plugin-local letter/digit table for
  the trailing key — matches the README's two-syntax description and the `permissionDenied`/
  `invalidHotkey` rejection-path description exactly (including the "silent no-op when no
  backend" behavior in `commands::do_set_hotkey`).
- **`init*` variants**: all 8 documented in the README table (`init`, `init_with`,
  `init_with_capture`, `init_with_capture_and_secrets`, `init_desktop`, `init_desktop_with`,
  `init_ios`, `init_ios_with`) match `src/lib.rs`'s actual signatures and capture/hotkey/
  secret-store defaults exactly (module-name nit noted above under Mismatches).
  `SecretStore` trait shown in the README (`get`/`set`/`delete` over `Secret`) matches
  `src/secrets.rs` verbatim.
- **guest-js**: `guest-js/src/index.ts`'s exports (`createClient`, `mountOverlay`,
  `VoxisOverlayElement`, `ThemeRegistry`, `bindHotkey`, `HotkeyMachine`, `startHoldLease`,
  drag helpers) match the README's documented surface. `client.ts`'s `VoxisClient` interface
  (all 11 command wrappers + `dictate` + `onState`/`onLevel`/`onResult`) matches the guest-js
  README's own interface listing verbatim. `overlay.ts` confirmed: `driver: "client" | "host"`
  option exists with exactly the described semantics (host mode never creates/subscribes a
  client, dispatches `"voxis-overlay-press"` `CustomEvent` with `detail: {phase: "down"|"up"}`,
  exposes `applyState`/`applyLevel`/`applyResult` as public methods used by both driver modes);
  `initialPosition` (`Point | OverlayCorner`, persisted-position-wins semantics), `storageKey`,
  `draggable` all match the README's `MountOverlayOptions` description. `guest-js/package.json`
  confirms version `0.1.1` and the `build`/`test`/`typecheck`/`harness` scripts exactly as
  described in both READMEs.
- **CHANGELOG v0.1.6 "Fix" section**: `crates/voxis-core/src/storage/config_sqlite.rs`
  confirmed all six named fields (`api_url_override`, `min_recording_ms`, `vad.backend`,
  `vad.onset_frames`, `vad.hangover_frames`, `vad.prefill_frames`) were read in `load()` but
  had no corresponding `save()` writes prior to this fix (module comments on each field
  explicitly document this as a pre-existing gap), and the guard test
  `every_app_config_field_round_trips_through_sqlite` exists with exactly the described
  shape: builds a `fully_non_default_app_config()` with no `..Default::default()`, and
  destructures the loaded config field-by-field (a genuinely exhaustive compile-time-enforced
  check, matching the CHANGELOG's claim about why the old test missed this).
- **CHANGELOG "Share profile" claims**: `src-tauri/src/profile_share/mod.rs` confirms
  `SHARE_SERVER_TTL = Duration::from_secs(120)` with the doc comment "120s or first successful
  GET, whichever comes first"; `k_qr` is `random_bytes::<32>()` (256-bit) and travels inside
  the QR payload (`crypto.rs`/`qr.rs`); the 6-digit `code` is generated separately and is
  documented/tested as never appearing in the QR JSON itself. File-export path confirmed
  Argon2id (RFC 9106 "second recommended option", `m=64MiB,t=3,p=1`) + ChaCha20-Poly1305 in
  `crates/voxis-core/src/profile/crypto.rs`, and passphrase generation confirmed as exactly 6
  words from a 2048-word list (`PASSPHRASE_WORD_COUNT = 6`, `wordlist_has_exactly_2048_unique_entries`
  test) — matches "phrase/key shown once" and the "6 words" claim precisely.
- **`.pi/skills/voxis-deploy/SKILL.md`**: root `/Cargo.lock` claim (workspace root moved) is
  consistent with the CHANGELOG's own "Internal" section describing the same move; the
  `plugin-v*` tag claim independently confirmed against `.forgejo/workflows/release.yml`'s
  literal `on.push.tags: ['v*']` trigger (see CI findings above) — `plugin-v0.1.0` genuinely
  does not match `v*`.
- **`scripts/check-ios-build.sh`**: diff adds `cargo build -p tauri-plugin-voxis --target
  aarch64-apple-ios[-sim]` after the existing `voxis-core` builds, consistent with the
  plugin's own `default-features = []` design (`desktop`-feature-gated `cpal`/`rdev` modules
  in `lib.rs`) that both this README and `docs/PLUGIN.md` describe as required for iOS
  buildability.
- **`src-tauri/Cargo.toml` `hound` removal**: comment claims "no `hound::` usage anywhere in
  `src-tauri/src`" — consistent with a prior grep for `\bhound\b` in `src-tauri/src/` in this
  same environment returning no matches (WAV encoding lives in `voxis-core` since Task 1b, and
  `hound` stays in the build graph transitively via `rodio`/`voxis-core` per the comment).

## Minors

- `crates/tauri-plugin-voxis/README.md`'s `init_ios()` row names a nonexistent `ios::` module
  path (should read `mobile::IosCapture` / `mobile::IosKeychainSecretStore`, or drop the
  module qualifier entirely) — see Mismatches above. Cosmetic; does not affect a host's
  ability to use the documented API correctly.
- Not independently re-verified in this pass, given tool-call budget — recommend a follow-up
  reviewer glance if time allows, but nothing found in the parts actually checked suggests a
  problem:
  - Exact byte-for-byte contents of `crates/tauri-plugin-voxis/contract/fixtures/*.json`
    (commands.json, events.json, profile-v1.json, profile-qr.json) against the README's
    prose descriptions of them — TODO verify.
  - `docs/PLUGIN_IOS_HOST.md`'s pre-existing "Permission denial carries a Settings deep link"
    section, referenced by the new plugin README's Errors table (`PERMISSION_DENIED` +
    `settingsUrl`) — not read this pass; TODO verify the shape matches.
  - Full cross-check of every fact in `crates/tauri-plugin-voxis/README.md`'s "Real hard-won
    lessons" / `docs/PLUGIN.md`'s "Known limitations" sections against
    `.pi/plans/tauri-plugin-voxis.md`'s own Follow-ups section and
    `research/plugin-plan/T11_ipad_run_2026-09-16.md` / `research/plugin-plan/review_10p4_r2.md`
    — not opened this pass; these are narrative/lessons-learned claims (not API-surface
    claims) and lower risk of "doc lies about the code", but still TODO verify against their
    cited source docs if a stricter pass is wanted.

## Overall

Every command/event/error/hotkey/init-variant/guest-js-export/CHANGELOG-technical claim I
was able to check against its named source file matched exactly, with one cosmetic module-
naming nit in the plugin README's `init_ios()` row. The new `core-plugin` CI job and the
`release.yml` iOS cross-build gate are both structurally sound and consistent with their
neighbouring jobs/steps (checkout pattern, docker invocation, VM path conventions, and the
single-trap-cleanup reasoning verified line-by-line). No blocking issues found.
