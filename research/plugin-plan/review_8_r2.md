# Task 8 — Round 2 Review (iOS Swift capture + Keychain + mobile bridge)

VERDICT: APPROVE (with minors) — every round-1 REJECT-FIX item is FIXED; only new nits, none blocking.

Scope reviewed: `/tmp/ado.C4YWdv/diff_8_r2.patch` (full 2050 lines) + line-number verification against the working tree for `ios/Sources/AudioCapture.swift`, `src/mobile.rs`, `docs/PLUGIN_IOS_HOST.md`, `src/commands.rs`, `.gitignore`/git status of `.tauri/`. Build/clippy/test facts taken as pre-verified (no builds run).

## Round-1 checklist

| Item | Status | Evidence (file:line) |
|---|---|---|
| **F1 (HIGH)** `.AVAudioEngineConfigurationChange` observer → `failWithInterruption` | **FIXED** | `AudioCapture.swift:528-536` — `addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main)`; handler does `self?.queue.async { failWithInterruption(reason: "engine configuration change") }`. |
| F1 — `emitLevelTick` checks `engine.isRunning` first, fails if stopped | **FIXED** | `AudioCapture.swift:432-435` — first statement of `emitLevelTick`: `if !engine.isRunning { failWithInterruption(reason: "engine stopped"); return }`, before `takePeak()`. |
| F1 — distinct reason strings per site | **FIXED** | `"session interruption"` :593, `"route: old device unavailable"` :611, `"engine configuration change"` :534, `"engine stopped"` :433, `"media services reset"` :556. All five present and distinct. |
| F1 — observer registered on a non-deadlocking queue | **FIXED** | Observer runs on `OperationQueue.main` (:531), then hops to the private serial `queue` (:533) — no engine work is done synchronously inside the notification callback; `engine.stop()` only ever runs on `queue` (`failWithInterruption` :616-631, `teardownEngine` :713-718). Comment at :517-527 documents the Apple deadlock warning explicitly. |
| F1 — observer removed with the others | **FIXED** | `removeFailureObservers()` :561-578 removes all four (`interruption`, `routeChange`, `configChange`, `mediaServicesReset`) and nils them; called from `deinit` :172, `engine.start()` catch :303, `failWithInterruption` :631, `teardownEngine` :718. |
| **F2 (MEDIUM)** `run_blocking_ipc` removed; direct `run_mobile_plugin`; honest doc + deferred follow-up | **FIXED** | `mobile.rs`: no `run_blocking_ipc`/`spawn_blocking` code remains (only mentioned in prose). Direct calls at :231 (`startCapture`), :238 (`stopCapture`), :254 (`resetCapture`), :296/:306/:313 (secrets). Module doc :15-56 states "**`run_mobile_plugin` is blocking** … blocks the calling thread for the duration of one Swift round-trip", explains why the old wrapper was removed (:26-33), and names the `commands.rs` `spawn_blocking(..).await` follow-up as deferred (:44-56). |
| **F3 (MEDIUM)** docs: missing `NSMicrophoneUsageDescription` = TCC process termination | **FIXED** | `PLUGIN_IOS_HOST.md:23` — "**Required — its absence is not a soft failure** … the OS **terminates the process** … TCC crash log … no `stop()`/`reject` path in this plugin ever runs". Checklist item 7 at :154-159 ("run once with the key deliberately removed … confirm the app actually terminates"), cross-referenced as item F at :193. |
| **F4** `engine.start()` catch removes observers | **FIXED** | `AudioCapture.swift:295-307` — catch block: `removeTap`, `removeFailureObservers()` (:303), `running = false`, reject `BACKEND`. |
| **F5** one `Channel` created in `IosCapture::new`, cloned per start | **FIXED** | `mobile.rs:188` field `on_level`, created once at :198 in `new` (owns `level_tx`), cloned into `StartCaptureArgs` at :228 (`on_level: self.on_level.clone()`). Doc :176-187 explains the `CHANNELS` registration leak rationale. |

### Minors claimed in round 1

| Claim | Status | Evidence |
|---|---|---|
| Haptics on main queue | FIXED | :316-318 (start, `.medium`), :687-689 (stop, `.light`) both inside `DispatchQueue.main.async`. |
| `sawAudio` gate for RMS≈0 muted heuristic | FIXED | field :142, reset :266, set in `processTap` :385 (only after `running && !capHit` guard passes), read :442; heuristic and `>= 2` promotion both gated on `heuristicEligible` :464-468. |
| WavWriter single `[Int16]` buffer + NaN→0 + extended `selfCheck` | FIXED | `WavWriter.swift` `encode`: `var pcm = [Int16](repeating: 0, …)`, `guard sample.isFinite else { continue }`, single `data.append(buffer)`; `selfCheck` asserts fmt fields (Subchunk1Size/AudioFormat/NumChannels/SampleRate/ByteRate/BlockAlign/BitsPerSample) plus `[1,-1,0.5]→[32767,-32767,16383]` and `NaN→0`. |
| `mediaServicesWereReset` observer | FIXED | :537-558, with honest "engine rebuild is a follow-up" note. |
| Docs: `NSPrivacyAccessedAPITypes` C617.1 | FIXED | `PLUGIN_IOS_HOST.md:72-93`. |
| Docs: `settingsUrl` note | FIXED | :31-38 (matches `VoxisPlugin.swift` `reject(..., data: .dictionary(["settingsUrl": …]))`). |
| Docs: `[T9a]` Keychain locked-screen note | FIXED | :223-235 (`kSecAttrAccessibleWhenUnlockedThisDeviceOnly` → `errSecInteractionNotAllowed`, options a/b). |
| Docs: checklist A–J | FIXED | :166-217, all ten items present. |
| `.tauri/` un-ignored | FIXED (see minor M1) | `.gitignore` adds only `ios/.build/`, `ios/Package.resolved`, `examples/host-min/…/gen/apple/.tauri/`; comment :11-19 records the decision to commit `crates/tauri-plugin-voxis/.tauri/tauri-api`. |

## New findings

None blocking. Design points checked and found sound:

- **Threading model is consistent.** All mutable session state is touched only on `queue` (tap callback hops via `queue.async` :283-286; timer is a `DispatchSourceTimer` on `queue` :397; mute/interruption/route/config/reset observers all land on `.main` then `queue.async`). `stateLock` additionally guards the fields read by the tap path. `failWithInterruption` is idempotent via the `wasRunning` gate (:617-623), so the timer's `"engine stopped"` and a notification-driven reason racing each other cannot double-teardown.
- **Stop-after-interruption contract holds.** `stop()` :640-646 accepts `running || interruptionReason != nil`, returns `.interrupted(reason)` and never writes the WAV / fabricates stats. `reset()` :725-736 clears `interruptionReason` and `currentPath` so the next `start()` is clean.
- **Overlapping `start()` during a pending permission prompt** (the `alreadyRunning` check at :180-186 precedes the async permission callback, and `running` is only set in `startEngine` :267) could in principle reach `installTap` twice on bus 0 (NSException). Verified this is mitigated Rust-side: `commands.rs::do_start` :36 reserves via `state.sessions.begin(mode)?` (single-flight) before `state.capture.start` :51, so the Swift layer never sees two concurrent starts from this plugin. Recorded as nit N2 below only for defence-in-depth.
- **`emitLevelTick` `isRunning` check ordering** is correct: it runs before `takePeak()`/`send`, so a stopped engine can never emit a `rms: 0` tick that the guard would mis-read as silence — this closes the desktop-M2 failure class the round-1 reviewer named.

## Minors

- **M1 — `.tauri/tauri-api` is currently untracked (`??`), not committed.** `git status` shows `?? crates/tauri-plugin-voxis/.tauri/` and `git ls-files` returns nothing for it. The `.gitignore` comment (and the round-2 decision) says it is to be committed like naked's plugins so a fresh clone can `swift build` standalone. Make sure the commit for this task actually `git add`s `crates/tauri-plugin-voxis/.tauri/tauri-api` — otherwise the doc claim in `.gitignore:11-19` and `PLUGIN_IOS_HOST.md:100-103` is false for a fresh clone. (Not a code defect; a commit-hygiene item for whoever lands this.)
- **N1 — Reason-string determinism is best-effort.** Because the 250 ms timer lives on `queue` and notifications route via `.main` → `queue`, a session interruption can surface as `"engine stopped"` (timer won) rather than `"session interruption"`/`"engine configuration change"`. Behaviour is correct either way (same `INTERRUPTED` code, same teardown); the doc comment at :420-431 already calls the timer "belt-and-braces". Optional: a one-line note that the specific reason is "whichever signal arrived first".
- **N2 — Defence-in-depth for double `startEngine`.** Optional: set a `starting` flag (or set `running = true`) at :180 before dispatching the permission request, so the Swift class is self-protecting even if a future caller bypasses `sessions.begin`. Currently safe via `commands.rs:36`.
- **N3 — `startEngine` early-return leaves the session active.** On the `AVAudioFormat`/`AVAudioConverter` guard failures (:251-258) `AVAudioSession` has already been `setActive(true)`; nothing deactivates it. Harmless (the class deliberately never deactivates the session, :632-638), just noting the asymmetry.
- **N4 — `Package.resolved` is present locally and correctly ignored**; `ios/.build` absent. Fine.

Pre-verified facts relied upon (not re-run): `cargo build --target aarch64-apple-ios{,-sim}` green with Swift recompiled; clippy clean (ios + host `--all-features`); desktop plugin tests 151/0 (mockito port flake unrelated); no-feature 109/0; scope clean.
