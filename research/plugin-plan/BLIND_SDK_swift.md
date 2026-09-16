# BLIND design review — Swift + mobile bridge (SDK)

Scope reviewed: `crates/tauri-plugin-voxis/ios/Sources/*.swift`
(AudioCapture, VoxisPlugin, LiveActivity, WavWriter, KeychainSecretStore),
`ios/LiveActivityWidget/*`, `src/mobile.rs`, and the desktop twin
`src/desktop/pure.rs` + `src/capture.rs`.

VERDICT: REFACTOR-FIRST

The architecture is sound and unusually well-documented; the cross-process
Live Activity duplication and the two WindowPeakAccumulator copies are
justified, not accidents. Two things are worth fixing before the next
feature: (1) a chunk of Swift-side parity logic reimplements the *tested*
desktop rules with **zero tests**, and (2) the carefully-built
permission-denied `data` payload is silently discarded on the Rust bridge,
so effort was spent on a hint the frontend can never receive.

## Top findings

### 1. KISS/dead-code — `settingsUrl` reject-`data` is dropped by the Rust bridge
- **Principle:** KISS (machinery nobody downstream reads)
- **Where:** `ios/Sources/VoxisPlugin.swift:startCapture` (attaches
  `data: .dictionary(["settingsUrl": UIApplication.openSettingsURLString])`)
  vs `src/mobile.rs:map_invoke_error`
- **What/why:** `VoxisPlugin` and `AudioCapture.swift` both go out of their
  way (with multi-line rationale comments) to carry the Settings deep-link
  as reject **`data`** "rather than baking a URL string into the message".
  But `map_invoke_error` only reads `err.message` and `err.code` — the
  `data` dictionary is never read, and these six commands are explicitly
  "never invoked from JS", so no other path sees it either. Worse, the
  `settingsUrl` value is `UIApplication.openSettingsURLString` (`"app-settings:"`),
  and the message text **already** says "open Settings to grant microphone
  access" — so the whole `data:` branch is dead weight guarded by a comment
  that describes a benefit it doesn't deliver.
- **Change:** drop the `data:` attach and the `if error.code == "PERMISSION_DENIED"`
  special-case in `startCapture` (the message already carries the hint); or,
  if the hint must reach the frontend structurally, propagate `err.code`/data
  through `map_invoke_error` instead of collapsing to `Backend`.
- **Size:** S

### 2. TDD honesty — iOS parity logic (RMS window, self-cap, mute heuristic, WAV) has no test that can fail
- **Principle:** TDD honesty / DRY (same rule implemented twice, only one side tested)
- **Where:** `ios/Sources/AudioCapture.swift` `processTap`/`emitLevelTick`
  (10 ms sub-chunk RMS, `capSamples` self-cap, `nearSilentThreshold: 0.0005`,
  2-window mute heuristic) and `WavWriter.encode`, vs the fully-tested
  `src/desktop/pure.rs` (`accumulate_capped`, `WindowPeakAccumulator`,
  `finalize_wav`, `scale_cap_samples`) with ~15 `#[test]`s.
- **What/why:** desktop deliberately split pure functions out of the cpal
  device specifically so the level/cap/WAV rules are unit-tested. The Swift
  side reimplements the same rules entangled with `AVAudioEngine`/`stateLock`
  and ships **no behavioural test** — the only guard is `WavWriter.selfCheck()`,
  which is `assert()` (compiled out in release) run once at DEBUG app launch,
  not a CI gate. Constants that must stay in parity (10 ms sub-chunk vs
  desktop's whole-chunk RMS; `0.0005`; the cap comparison) can drift from the
  tested desktop rules and nothing fails. The module doc even concedes "there
  is no way to run a Rust unit test against Swift code" — true, but that is an
  argument for a Swift test target, not for shipping the logic untested.
- **Change:** extract the pure numeric bits (sub-chunk RMS, mute-heuristic
  counter, self-cap slice) into free functions and add a small SwiftPM test
  target asserting them against the same fixtures `pure.rs` uses; at minimum
  promote `WavWriter.selfCheck` into an actual `XCTest`.
- **Size:** M

### 3. SRP — `VoxisAudioCapture` is one ~500-line class doing ~9 jobs
- **Principle:** SRP
- **Where:** `ios/Sources/AudioCapture.swift` (single class)
- **What/why:** session config, dual iOS-16/17 permission flow, engine
  lifecycle + rebuild-after-reset, tap install + `AVAudioConverter`
  downsample, sub-chunk RMS, level timer + mute heuristic, four failure
  observers, WAV encode + protected-file write, and haptics all live in one
  type touching one shared `stateLock`. It is cohesive around "one session",
  so this is not a rewrite — but the entanglement is exactly what blocks
  finding #2's test seam. The permission branch and the numeric level/cap
  logic are the two pieces that don't need `AVAudioEngine` and would give a
  test seam if lifted out.
- **Change:** lift the permission resolution and the pure level/cap
  arithmetic into separate testable units; leave engine/observer wiring here.
- **Size:** M

### 4. DRY/drift — every wire struct is hand-mirrored across Swift and Rust with no generator
- **Principle:** DRY (parallel definitions that must match by hand)
- **Where:** `LevelSampleWire`, `CaptureStatsWire`/`StopCaptureResultWire`,
  `StartCaptureArgs`, `LiveActivity{Start,Update}Args`, `Secret*Args` — each
  defined once in Swift and once in `src/mobile.rs`, kept aligned only by a
  hand-written `#[serde(rename_all = "camelCase")]` + matching Swift property
  names.
- **What/why:** a renamed/retyped field compiles clean on both sides and
  fails only at runtime as a decode error. This is inherent to Tauri mobile
  plugins (naked does the same) so it's a known accepted risk more than a
  bug — but there is no test that round-trips a representative payload to
  catch drift, which combined with finding #2 means the bridge has no
  automated safety net at all.
- **Change:** not a 3-line fix; either a codegen from one source of truth, or
  (cheaper) one round-trip decode test per wire struct. Document the
  "keep in sync" contract at the module level as the widget files already do.
- **Size:** L (accept + document is defensible)

## Fine as is (checked)

- **Duplicated `VoxisActivityAttributes` / `StopDictationIntent`
  (Sources vs LiveActivityWidget).** Legitimately required: ActivityKit
  round-trips `ContentState` by `Codable`, and AppIntents resolves by
  (bundle id, type name), not Swift type identity — a shared SwiftPM target
  can't span the host's separately-owned widget-extension target (naked's is
  pinned at iOS 16.1, below this package's 17.0). Both copies carry explicit
  "keep in sync" notes and cite the naked precedent. Correct, not cleanup
  debt. (Residual manual-sync hazard on the shared fields, but architecturally
  forced.)
- **`WindowPeakAccumulator` implemented twice (Rust atomic vs Swift `NSLock`).**
  Trivial and unavoidable across the FFI boundary; identical semantics
  (`observe`=max, `takePeak`=drain-to-0). Rust copy is tested; the Swift copy
  is small enough that folding it into finding #2's test seam covers it.
- **`#available` gating repeated at every call site + `activity: Any?`
  workaround.** Swift requires per-site `@available` for typed/stored use of
  versioned APIs; you cannot centralise it. The `Any?` erasure to avoid
  gating the whole class (which would cascade to every `VoxisPlugin` call
  site) is the right trade. The SwiftPM deployment-target rationale is
  plausible and consistently applied.
- **`KeychainSecretStore` kept though naked doesn't use it.** Legit default
  capability of the plugin's `SecretStore` trait (Task 8 acceptance #5), not
  dead code — a host opts in, non-use ≠ deadness. One caveat: the
  update-first→`errSecItemNotFound`→`SecItemAdd` fallback is a real
  behavioural branch with no test; worth one if a Swift test target lands
  for #2.

## Not covered

- `ios/LiveActivityWidget/VoxisActivityView.swift` (SwiftUI rendering) — read
  only its two sibling type files; the view code was out of the core bridge
  question and I stopped to stay within the tool budget.
- Runtime/device behaviour (interruption handling, media-services reset,
  Bluetooth-mic first-tick timing) is unverifiable by source reading — the
  code marks several of these "unmeasured until T8.5 on real hardware".
- `lib.rs` wiring of `LiveActivityEventSink` / `init_ios_with` — referenced by
  `mobile.rs` but outside the named file list; the intent-channel and
  best-effort-logging contracts were judged from `mobile.rs` alone.
- Whether the 10 ms iOS sub-chunk RMS actually matches desktop's native cpal
  buffer granularity in practice (the parity claim rests on an unverified
  "happens to fire at a size close to this" assumption).

---

### Residual risks
- The permission-denied `data` finding (#1) assumes no JS-direct call path
  exists; confirmed only from the module docs asserting these six commands
  are Rust-only — not exhaustively traced through `commands.rs`.
- Wire-struct drift (#4) and the untested Swift parity logic (#2) are
  latent, not active bugs; they bite on the *next* field change, not today.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Blind SOLID/DRY/KISS/TDD review written to the authoritative output path with VERDICT, ranked Top findings (file:line, concrete change, size), Fine-as-is, Not-covered, and residual risks."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [],
  "validationOutput": [
    "Read AudioCapture.swift, VoxisPlugin.swift, LiveActivity.swift, WavWriter.swift, KeychainSecretStore.swift, mobile.rs, desktop/pure.rs, capture.rs, and both LiveActivityWidget type files (view file skipped for budget)."
  ],
  "residualRisks": [
    "Finding #1 (dead settingsUrl data) assumes no JS-direct call path; confirmed from module docs, not exhaustively traced through commands.rs.",
    "Wire-struct drift (#4) and untested Swift parity logic (#2) are latent, biting on the next field/threshold change rather than today.",
    "Interruption/media-reset/Bluetooth-timing behaviour is unverifiable by source reading; code itself marks it unmeasured until on-device T8.5."
  ],
  "noStagedFiles": true,
  "diffSummary": "No source changes; review-only. Wrote /tmp/ado.C4YWdv/blind/SDK_swift.md.",
  "reviewFindings": [
    "REFACTOR-FIRST overall.",
    "finding: VoxisPlugin.swift:startCapture / mobile.rs:map_invoke_error - permission-denied reject data (settingsUrl) and PERMISSION_DENIED/INTERRUPTED codes are dropped by the Rust bridge; the hint is already in the message, so the data branch is dead (S).",
    "finding: AudioCapture.swift processTap/emitLevelTick/WavWriter - iOS reimplements desktop pure.rs level/cap/RMS/WAV rules with zero failing tests (only DEBUG-only assert selfCheck); parity constants can drift silently (M).",
    "finding: AudioCapture.swift - ~500-line VoxisAudioCapture violates SRP (9 responsibilities); extracting permission + pure level math yields the test seam (M).",
    "finding: hand-mirrored wire structs across Swift/Rust with no generator or round-trip test (L, accept+document).",
    "fine as is: duplicated ActivityAttributes/Intent (ActivityKit cross-process requires it), WindowPeakAccumulator x2 (FFI), #available repetition (language-forced), KeychainSecretStore (legit default, though update-first branch untested).",
    "no blockers."
  ],
  "manualNotes": "Skipped VoxisActivityView.swift and lib.rs wiring to stay within tool budget; both noted under Not covered. Applied memories: review-only (no edits/commits), findings written solely to the authoritative output path."
}
```
