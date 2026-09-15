VERDICT: REJECT-FIX

Scope reviewed: diff vs 199ced5 (`/tmp/ado.C4YWdv/diff_8_5.patch`, all 1398 lines), plus on-disk `gen/apple/{project.yml, host-min_iOS/Info.plist, host-min_iOS.entitlements, ExportOptions.plist, .gitignore}`, the untracked-file list under `gen/apple/`, plugin sources needed for Q7 (`ios/Sources/AudioCapture.swift` ~L367–470, `src/desktop/pure.rs::level_sample_from_peak`, `src/mobile.rs` L133–159, `src/lib.rs` cfg gates), `voxis-core` consts, `package.json`/CI/root-stub invocation paths. No builds, no simulator commands. Nothing is staged (`git diff --cached --stat` empty); `gen/` is entirely untracked (`??`).

The code side (Cargo layout, lib.rs/main.rs, project.yml/Info.plist, .gitignore, host-min-smoke.sh fix) is sound and I would approve it as-is. The REJECT-FIX is for the **evidence/protocol deliverable** of a HUMAN-GATE step: the research doc states a wrong root cause for the speech-run garbage, leaks a partial key prefix, misreports a by-design behaviour as a possible plugin defect, and the iOS smoke script neither pins nor documents the Mac default-input precondition that the orchestrator proved is decisive. All fixes are small and doc/script-only; no Rust changes needed.

## Findings

**F1 (must-fix, evidence correctness) — `research/plugin-ios/T8_5_simulator.md:78,114–124` wrong root cause for the SPEECH garbage.**
The doc attributes `" Torsdagsfond"` / Norwegian Nynorsk to the speaker→mic acoustic loop ("background noise, Mac speaker/mic frequency response, room acoustics") and closes with "not repeated further". The orchestrator reproduced the same launch after `SwitchAudioSource -t input -s "Микрофон MacBook Air"` and got `guardOutcome: finalized`, language Russian, a real Russian sentence — i.e. the actual cause was the Mac's default input being AirPods (the Simulator inherits the Mac default input device). Fix: rewrite the paragraph to state the real cause, paste the orchestrator's re-run `RESULT_EVENT` verbatim (with timestamp + `SwitchAudioSource -t input -c` output before/after), and keep the Norwegian run as the "wrong input device" negative example. Also add the precondition to `docs/PLUGIN_IOS_HOST.md`'s `[T8.5]` learnings list (it currently has no mention of default-input/`SwitchAudioSource`; `grep -in "default input|SwitchAudioSource"` → 0 hits) — this is the single most useful thing stage 2 / any future Simulator run needs to know.

**F2 (must-fix, script precondition) — `scripts/host-min-ios-smoke.sh` does not pin/verify the Mac default input.**
Because the Simulator uses the Mac default input, a Bluetooth headset as default input changes what "silence" and "speech" mean for every run. Minimal fix (no new hard dependency): at the top, if `command -v SwitchAudioSource` succeeds, print `SwitchAudioSource -t input -c` into the run log and, unless `VOXIS_IOS_SMOKE_ANY_INPUT=1`, fail (or loudly warn) when the current input is not the built-in mic (match on the configurable `VOXIS_IOS_SMOKE_INPUT="${VOXIS_IOS_SMOKE_INPUT:-MacBook}"` substring); if the tool is absent, print a one-line warning naming the precondition. Mirror the same precondition in README.md's iOS section and in the research doc's "Environment" block (record which input device was active for each run).

**F3 (must-fix, hygiene) — `research/plugin-ios/T8_5_simulator.md:92` partial real-key leak `gsk_RH...`.**
`gsk_` is Groq's universal prefix, so only 2 real characters leak — negligible entropy loss, but it is still a fragment of a live credential in a committed file and contradicts the doc's own "keys never logged" privacy check. Replace with `"<REDACTED>"`. (`grep -rn gsk_` over `research/`, `docs/`, `examples/host-min/` finds only this one occurrence; committable `gen/apple/**` is clean of `/Users/`, `gsk_`, the username.)

**F4 (should-fix, evidence correctness) — `T8_5_simulator.md:67` mislabels a by-design behaviour as a possible plugin defect.**
"`peak == rms` on every tick — the iOS Swift capture side appears to report the same value for both fields … worth a source-review follow-up." Verified: `ios/Sources/AudioCapture.swift:470` builds `LevelSampleWire(rms: peak, peak: peak, …)` from `windowPeak.takePeak()` (the max of 10 ms sub-chunk RMS over the 250 ms window), and desktop does the identical thing in `src/desktop/pure.rs:75-77` `level_sample_from_peak(peak, …) -> LevelSample { rms: peak, peak, … }`. Same contract on both backends, no plugin bug. Reword to "matches desktop `level_sample_from_peak` by design (both fields carry the windowed peak-RMS)". Not blocking on its own but it is in the gate evidence and would send a future reader on a false hunt.

**F5 (should-fix, script semantics) — `host-min-ios-smoke.sh:39,141-154` `WAIT_SECS` is an iteration count, not seconds.**
Each iteration is `sleep 1` + one `xcrun simctl spawn … log show --last 1m` (3–4 s per the worker's own measurement), so "waiting up to 25s" is really ~75–100 s, and the message on the failure path ("no RESULT_EVENT observed within 25s") is false. The success path is unaffected (a ~17.3 s outcome is picked up on the ~5th iteration, well inside `--last 1m`). Fix either (a) make the loop deadline-based (`deadline=$((SECONDS+WAIT_SECS))`; `while [ $SECONDS -lt $deadline ]`), or (b) the cleaner option the script already half-prepared for: start `xcrun simctl spawn "$SIM_UDID" log stream --predicate 'process == "host-min"' > "$run_log" &` **before** `simctl launch`, record its PID in the currently dead `log_stream_pid` variable (`:53,:61` — assigned "" and never set), and grep the file once per second. Option (b) also removes the `--last 1m` window dependency entirely. With (a) the default `WAIT_SECS` should be ≥ 40 s to keep a comfortable margin over 17.3 s when `log show` is slow. Update the README/research note about "give it ≥120 s outer timeout" accordingly.

**F6 (minor, doc/impl mismatch) — `host-min-ios-smoke.sh:4` advertises a `--skip-build` flag that is never parsed.**
Only `HOST_MIN_IOS_SKIP_BUILD=1` is implemented (`:40`). Either add `[ "${1:-}" = "--skip-build" ] && SKIP_BUILD=1` or drop the flag from the header comment.

## Pre-verified facts agree/disagree

1. **Silence run (17.3 s, 67 ticks, peaks 0.0066–0.0132 < 0.02, 0 fake-stt requests)** — AGREE. `scenario_a_run3_full_log.txt` shows `STATE_EVENT "recording"` at 15:32:49.926 → `RESULT_EVENT` at 15:33:07.235 (17.3 s ≈ `SILENCE_WINDOW_MS` 10 s + `VOXIS_SILENCE_TIMEOUT_MS` 7 s), PID 67542 constant, one coalesced tick gap at 15:33:05.178 (expected for a `watch` channel). Consistent with `SILENCE_RMS = 0.02`, `GUARD_POLL_MS = 250`, `SILENCE_WINDOW_MS = 10_000` in `voxis-core/src/config/consts.rs:190-199`.
2. **Speech garbage root cause = AirPods default input** — AGREE with the orchestrator; the worker's acoustics attribution is wrong → F1/F2.
3. **Desktop regression (build OK, 151/0, 3/3, 0 orphans)** — AGREE; the refactor is a pure move (see "Checked and OK").
4. **0 `LEVEL_EVENT` lines in the orchestrator's `log show` vs 67 for the worker** — EXPLAINED, not a log-level filter issue: `LEVEL_EVENT` printing is opt-in via `VOXIS_SMOKE_LOG_LEVELS=1` (`lib.rs::run` → `install_level_summary_listener`, only when `smoke_autostart` AND that var is set). The worker's scenario (a) run 3 command block exports `SIMCTL_CHILD_VOXIS_SMOKE_LOG_LEVELS=1`; the scenario (b) block (which the orchestrator re-ran) and `host-min-ios-smoke.sh` do not. All `println!` lines land as `Default`-type entries (visible in `log show` without `--info/--debug`), so the `RESULT_EVENT` assertion is robust to this. The PID filter `awk '$6 == pid'` is correct for `log show`'s table layout (Timestamp = 2 fields `date time`, then Thread, Type, Activity, PID → `$6`), confirmed against the saved log's header/rows. Suggest the ios smoke script export `SIMCTL_CHILD_VOXIS_SMOKE_LOG_LEVELS=1` by default and print a tick-count/peak summary on both pass and fail — it costs nothing (`log show` already fetches the lines) and gives every future run the noise-floor evidence stage 2 needs.

## Checked and OK

**Q1 host-min iOS restructuring**
- `Cargo.toml`: `[lib] host_min_lib`, `crate-type = ["staticlib","cdylib","rlib"]` (Tauri scaffold convention; `rlib` lets the desktop `[[bin]]` link it). `tauri-plugin-voxis` split into `[target.'cfg(not(target_os = "ios"))'.dependencies]` (features `desktop`) and `[target.'cfg(target_os = "ios")'.dependencies]` (no features) — correct; Cargo resolves per-target so cpal/rdev never enter the iOS graph. `build.rs` = `tauri_build::build()` exists, so `cfg(mobile)` is emitted and `#[cfg_attr(mobile, tauri::mobile_entry_point)] pub fn run()` is the right shape; `main.mm` scaffold calls `start_app()`.
- `lib.rs` is a verbatim move of the old `main.rs` body plus three deltas: `cpal` branch now `#[cfg]`-gated (necessary, since `init_desktop` is `#[cfg(feature = "desktop")]` in plugin `lib.rs:254`), `ios` branch calls `init_ios()` (plugin `lib.rs:513`, gated on `target_os = "ios"` only — no feature needed, matches the Cargo split), `VOXIS_SMOKE_STOP_AFTER_MS` + `VOXIS_SMOKE_LOG_LEVELS`. `main.rs` is 3 lines + the harmless `windows_subsystem` attr.
- `VOXIS_SMOKE_STOP_AFTER_MS`: precedence `smoke_no_stop` > fixed override > `mock_script_len*250+500` — sane; a late scheduled stop on an already-ended session is the documented harmless `SMOKE_STOP_ERROR`.
- Consent auto-grant is still only inside `if smoke_autostart { … }` with the harness-only comment intact.
- Nothing desktop-only compiles on iOS; nothing iOS-only compiles on desktop (`VOXIS_CAPTURE=ios` on desktop panics with a clear message, `cpal` on iOS likewise).

**Q2 gen/apple**
- `project.yml`: `deploymentTarget.iOS: 17.0` ✓ (matches `ios/Package.swift` `.iOS(.v17)` for `AVAudioApplication`); `NSMicrophoneUsageDescription` in `info.properties` with an accurate string ✓ and it landed in the regenerated `host-min_iOS/Info.plist` ✓; `DEVELOPMENT_TEAM: GZL949D756` only in the `app` setting group (scaffold placement from `tauri.conf.json` `bundle.iOS.developmentTeam`) ✓; no `UIBackgroundModes` ✓ (correct for stage 1 — see iPad checklist); `bundleIdPrefix`/`PRODUCT_BUNDLE_IDENTIFIER` = `top.voxis.hostmin` ✓; entitlements = empty `<dict/>` ✓; `ExportOptions.plist` = `method: debugging` only ✓. Committable files (15 non-PNG) contain no `/Users/…` paths, username, or key material.
- `tauri.conf.json` `bundle.iOS.developmentTeam` with `bundle.active: false` is fine (the CLI reads it for `ios init`); team ID is not a secret and matches the clipshot convention.

**Q3 `host-min-ios-smoke.sh`** (beyond F2/F5/F6)
- UDID resolution (regex over `simctl list devices available`), `boot || true` + `bootstatus -b`, `rm -rf build` before `cargo tauri ios build --debug --target aarch64-sim` (valid tauri-cli 2 target alias; worker's build succeeded), `install`, `privacy grant microphone` (correct service name), `terminate` before launch, `SIMCTL_CHILD_*` exported (correct mechanism), launch PID parsed from `top.voxis.hostmin: <pid>`.
- fake-stt lifecycle: `--port 0` + port parsed from its own log; `trap cleanup EXIT INT TERM` terminates the app (only if `launched=1`), kills+waits fake-stt, `pkill -P $$`, preserves the original exit code. `set -u -o pipefail` without `-e` is deliberate and every failure path has an explicit `exit 1`. Only SIGKILL from an outer `timeout -s KILL` could leak fake-stt (unavoidable).
- Stale-result protection: PID filter on `$6` — correct (see #4 above); Simulator PID reuse inside 60 s is not a realistic risk.
- Assertions: `guardOutcome == silenceTimeoutNoSpeech`, empty `text`, `TRANSCRIBE_REQUEST` count 0, python3 JSON parse (python3 is present with Xcode CLT). Failure message correctly names the noise-floor cause.
- Nit: `cargo build -p voxis-fake-stt >/dev/null` exit code is not checked; a build failure surfaces later as the misleading "voxis-fake-stt never came up". Cheap to add `|| { echo FAIL; exit 1; }`.

**Q4 .gitignore**
- Parent `gen/` blanket replaced by `gen/schemas/` + explicit `gen/apple/{build,Externals,**/xcuserdata,**/*.xcworkspace/xcuserdata,DerivedData}/`; `gen/apple/.tauri/` was already ignored at `.gitignore:23` (Task 8). `git check-ignore -v` confirms `build/x`, `Externals/x`, `…xcworkspace/xcuserdata/x`, `.tauri/x` ignored and `project.yml` not ignored. The untracked list under `gen/apple` is exactly the scaffold set (project.yml, Sources/, host-min_iOS/{Info.plist,entitlements}, xcodeproj + shared scheme/workspace settings, LaunchScreen, Podfile, ExportOptions, Assets.xcassets, nested .gitignore) — matches the naked/clipshot convention. The comment explaining why the parent-level rules duplicate the nested `.gitignore` is correct (a pruned parent dir is never descended into).

**Q5 evidence quality** (beyond F1/F3/F4) — UDID, runtime (iOS 26.5 23F77), Xcode/tauri-cli versions, bundle id, team recorded; commands reproducible; `RESULT_EVENT`s verbatim with timestamps; full raw log of run 3 attached; honest and accurate "what the Simulator cannot exercise" list (mute button, Smart Folio, route change, backgrounding budget, locked-screen Keychain, media-services reset, iPad noise floor); privacy grep for the key over the full log documented. Run 2's noise-floor edge case (~0.0201 peak) is correctly reported as environmental, not a bug.

**Q6 `host-min-smoke.sh` fix** — Correct for all three invocation paths: root stub `scripts/host-min-smoke.sh` (`exec "$(dirname "$0")/../crates/…/host-min-smoke.sh"` → `$0` becomes that path), `package.json` `e2e:host-min` and CI (`bash crates/tauri-plugin-voxis/examples/host-min/scripts/host-min-smoke.sh`, relative). Both dirs are now resolved from the original `$0` in independent `$(cd … && pwd)` subshells before any `cd` in the main shell; `scripts/../../../../..` = 5 levels = repo root (scripts→host-min→examples→tauri-plugin-voxis→crates→root) ✓. The old two-sequential-`cd` code was indeed broken for relative `$0` (second `cd` re-evaluated the relative dirname against the new cwd).

**Q7 plugin defect?** — None found. `peak == rms` is the shared contract on both backends (F4). No change to `ios/Sources/*.swift` or `mobile.rs` in this diff; `mobile.rs:151-159` maps `LevelSampleWire{rms,peak,muted,capHit}` 1:1.

## Minors

- `host-min-ios-smoke.sh`: consider exporting `SIMCTL_CHILD_VOXIS_SMOKE_LOG_LEVELS=1` and printing tick count + peak min/max on every run (see #4); check `cargo build -p voxis-fake-stt` exit code; `log_stream_pid` dead variable (or use it per F5b).
- `.gitignore`: `gen/apple/**/*.xcworkspace/xcuserdata/` is redundant with `gen/apple/**/xcuserdata/`; harmless. `gen/apple/assets/` exists (empty, scaffold `buildPhase: resources` folder) and is not ignored — currently nothing to commit (git skips empty dirs), but if any future CLI version copies `frontendDist` there it would drag `ui/vendor`'s ~44k-line bundle (explicitly ignored at `.gitignore:134`) back into the tree; a one-line `gen/apple/assets/` ignore is cheap insurance.
- `Cargo.toml`: `staticlib`+`cdylib` are also built for desktop `cargo build -p host-min` (extra link time, larger `target/`) — Cargo has no per-target `crate-type`; accepted scaffold cost, worth a one-line comment.
- `docs/PLUGIN_IOS_HOST.md` `[T8.5]` block: the "noise floor sits close to 0.02" learning is fine; add the default-input learning (F1) and note that `LEVEL_EVENT` is opt-in.
- Plan step 3 (`SpeechTranscriber.supportedLocales` one-liner on iOS) was not done on the Simulator although it could have been; the research doc lists it as a follow-up — acceptable for stage 1, carried to the iPad checklist.
- README iOS section says `VOXIS_SMOKE_LOG_LEVELS=1` "prints every tick" — accurate; it might also mention `SwitchAudioSource -t input -c` (F2).

## iPad-stage checklist (what stage 2 must add)

1. **Signing**: real device build needs a provisioning profile for `top.voxis.hostmin` under team `GZL949D756` (`CODE_SIGN_STYLE: Automatic` should fetch it once the device is registered); `cargo tauri ios build --debug --target aarch64` (device), install via `xcrun devicectl device install app` / Xcode.
2. **`UIBackgroundModes: [audio]`** in `project.yml` `info.properties` (then `xcodegen generate`) — required for the "minimise host with recording in progress, measure how long iOS keeps the `.record` session (target 10 min)" item `[R1-iOS C2/C3]`; deliberately absent in stage 1, must be added and justified in `docs/PLUGIN_IOS_HOST.md`'s Info.plist table.
3. **Runs**: speech (real Groq, iPad mic) → text in `#result`; 75 s silence → `NoSpeech`, nothing shown (note stage 1 used a 7 s timeout override — stage 2 must run with the plan's real 75 s / default `silence_timeout_ms` at least once); system mute button → `inputMuteStateChangeNotification` arrives? (log the notification + the `muted:true` tick, and check the 2×250 ms near-silent heuristic fallback); closed Smart Folio → expect `interruptionNotification`, not "silence"; AirPods route change mid-recording; media-services reset if forceable.
4. **Noise floor**: median/p90/max per-250 ms RMS from the iPad mic over ≥ 30 s of quiet (use `VOXIS_SMOKE_LOG_LEVELS=1` `LEVEL_EVENT` lines), recorded in `voxis-core/src/config/consts.rs` next to the MacBook calibration note; recalibrate `SILENCE_RMS` if p90 approaches 0.02.
5. **WAV evidence**: pull the finalized WAV(s) from the device container (`xcrun devicectl device copy from … --domain-type appDataContainer`) and run the same `take_rms_peak` guard tests against the silence WAV as desktop.
6. **Locked-screen Keychain**: passcode set, lock screen mid-session, confirm `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` → `errSecInteractionNotAllowed` handling `[T9a]` note.
7. **`SpeechTranscriber.supportedLocales`** one-liner on iOS (plan step 3; confirm whether `ru_RU` is present).
8. **fake-stt over LAN**: bind `voxis-fake-stt` to `0.0.0.0` (currently only 127.0.0.1) and point `VOXIS_STT_URL` at the Mac's LAN IP; env delivery on a physical device is not `SIMCTL_CHILD_*` — needs the Xcode scheme `environmentVariables` in `project.yml` or a host-min config file.
9. **Protocol**: record the active input device (iPad built-in mic vs. paired headset) for every run — the same precondition F1/F2 establish for the Simulator.
10. Log capture on device: `xcrun devicectl` has no `log show`; use Console.app / `idevicesyslog` / Xcode console and filter by PID as stage 1's script does.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Read-only review of Task 8.5 stage 1 performed; only /tmp/ado.C4YWdv/review_8_5_r1.md written; no repo files touched, no builds/simulator commands run."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Report cites file:line for every finding (T8_5_simulator.md:67,78,92,114-124; host-min-ios-smoke.sh:4,39,53,61,113,141-154), verified plugin sources (AudioCapture.swift:470, desktop/pure.rs:75-77, lib.rs:254/513, mobile.rs:151-159), git check-ignore output, untracked-file list, and explains pre-verified fact #4 (LEVEL_EVENT opt-in via VOXIS_SMOKE_LOG_LEVELS)."
    }
  ],
  "changedFiles": [
    "/tmp/ado.C4YWdv/review_8_5_r1.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "git diff --cached --stat",
      "result": "passed",
      "summary": "empty — nothing staged"
    },
    {
      "command": "grep -rn gsk_ research/plugin-ios docs/PLUGIN_IOS_HOST.md crates/tauri-plugin-voxis/examples/host-min",
      "result": "passed",
      "summary": "single hit: T8_5_simulator.md:92 partial prefix gsk_RH... (F3)"
    },
    {
      "command": "git check-ignore -v gen/apple/{build,Externals,…xcuserdata,.tauri}/x gen/apple/project.yml",
      "result": "passed",
      "summary": "build/Externals/xcuserdata/.tauri ignored; project.yml not ignored; gen/apple/assets/ not ignored (minor)"
    },
    {
      "command": "git ls-files --others --exclude-standard gen/apple | xargs grep -l '/Users/|gsk_|shamash'",
      "result": "passed",
      "summary": "no machine-specific paths or secrets in committable gen/apple files"
    },
    {
      "command": "grep AudioCapture.swift / desktop/pure.rs for peak/rms mapping",
      "result": "passed",
      "summary": "both backends emit rms=peak by design (F4: not a plugin bug)"
    }
  ],
  "validationOutput": [
    "log show PID column = $6 (Timestamp is 2 fields) — awk filter in ios smoke script is correct",
    "scenario_a_run3_full_log.txt: recording 15:32:49.926 -> RESULT_EVENT 15:33:07.235 = 17.3 s, PID 67542 constant",
    "SwitchAudioSource present at /usr/local/bin — F2 precondition check is implementable without new deps"
  ],
  "residualRisks": [
    "Review is static; did not re-run the Simulator script (per instructions). F5's log show latency figure (3-4 s/call) is taken from the worker's own measurement.",
    "gen/apple/assets/ is empty now; if a future tauri-cli copies frontendDist into it, ui/vendor's ignored bundle could become committable."
  ],
  "noStagedFiles": true,
  "diffSummary": "No repo changes; review artifact only.",
  "reviewFindings": [
    "must-fix: research/plugin-ios/T8_5_simulator.md:78,114-124 - speech garbage misattributed to acoustics; real cause AirPods default input (orchestrator re-run got Russian). Rewrite + add orchestrator RESULT_EVENT + document precondition in docs/PLUGIN_IOS_HOST.md",
    "must-fix: scripts/host-min-ios-smoke.sh - add Mac default-input precondition (SwitchAudioSource -t input -c check/warn) and document in README/research doc",
    "must-fix: research/plugin-ios/T8_5_simulator.md:92 - redact gsk_RH... fully",
    "should-fix: research/plugin-ios/T8_5_simulator.md:67 - peak==rms is by design (matches desktop level_sample_from_peak), not a follow-up",
    "should-fix: scripts/host-min-ios-smoke.sh:39,141-154 - WAIT_SECS is iterations not seconds (~75-100 s real); make deadline-based or use background log stream (dead log_stream_pid var)",
    "minor: scripts/host-min-ios-smoke.sh:4 - --skip-build flag advertised but not parsed",
    "no blockers in Cargo.toml/lib.rs/main.rs/project.yml/Info.plist/.gitignore/host-min-smoke.sh fix"
  ],
  "manualNotes": "Code changes are approvable as-is; REJECT-FIX targets the human-gate evidence doc and the iOS smoke script's precondition/timing semantics only. Stage 2 must add UIBackgroundModes audio, device signing, LAN-bound fake-stt, and the iPad noise-floor measurement (see checklist)."
}
```
