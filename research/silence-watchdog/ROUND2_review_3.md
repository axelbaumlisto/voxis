# Audit: swd-plan-clean2.md — Plan Coherence / Conformance Review

## 1. Errors (wrong facts, wrong reasoning)

**E1 — §6 Deploy section is factually wrong; contradicts actual CI (BLOCKING for that section).**
Plan says: *"release.yml (Developer ID + notarization) → скачать `Voxis_0.1.3_aarch64.dmg` → `spctl -a -vvv` accepted/Notarized → установить."*
Actual `.forgejo/workflows/release.yml`:
- The macOS build step is explicitly labeled `# build macOS (best-effort — KVM VM)` with `continue-on-error: true`, and skips entirely if the VM image or `/dev/kvm` is missing (`echo "⚠️ no prepared macOS VM image ... skipping macOS"`).
- There is **no codesign, no notarytool, no `spctl` step anywhere in the file** (verified by grepping the whole repo for `notariz|Developer ID|codesign|spctl|\.dmg` — the only hits are in `docs/MACOS_SIGNING_TODO.md`, a *TODO* doc).
- The produced artifact is `artifacts/voxis-macos-arm64` (bare binary) and `artifacts/voxis-macos-arm64.tar.gz` — **not a `.dmg`**.
- `docs/MACOS_SIGNING_TODO.md:1-10`: *"...unsigned macOS binaries today. Signing and notarization cannot be added [until an Apple Developer account + Developer ID cert exist]."*
- `CHANGELOG.md:32`: *"macOS: unsigned Apple Silicon binary ... — DMG signing/notarization to follow."*

As written, §6 describes a pipeline that does not exist. An implementer following the plan literally will look for a `.dmg` and a Gatekeeper-accepted signature that will never appear.

**E2 — `audio_boost` range cited as "10×–1000×", actual documented/validated range is 100×–1000×.**
`config/mod.rs:156-159`: *"Audio level multiplier for waveform visualization (100-1000)."* `recorder.rs:64-70` (`set_audio_boost`/`get_audio_boost`) stores `boost*10` then divides by 10 on read, so the *10/÷10 cancel and the effective end-to-end multiplier equals the config value, i.e. 100–1000, not 10–1000. Doesn't change the underlying argument (RMS must be boost-independent) but the concrete number in §3 Layer 2 is off by a factor of ~10 at the low end.

**E3 — "48 кГц" capture-rate assumption is asserted, not verified; recorder's own default is 44100 Hz.**
`recorder.rs:43`: `sample_rate: Arc::new(AtomicU32::new(44100))`. The real rate is overwritten at `recorder.rs:159-160` (`self.sample_rate.store(config.sample_rate().0, ...)`) — hardware-dependent, and no log line in the plan's own evidence pins the *actually observed* value to 48 kHz. If the mic negotiates 44.1 kHz, actual growth is 176.4 KB/s, not 192 KB/s (~8% off), and the "6.4 → 16.4 ГБ" RAM figures inherit that uncertainty. The buffer-unboundedness conclusion is still correct; the specific rate used to derive KB/s is unconfirmed.

**E4 — Citation `mod.rs:131-133` for `Orchestrator::cancel()` points to the wrong lines.**
Actual: `cancel()` is at `mod.rs:128-130`; `mod.rs:131-133` is `shutdown()`. Content description ("calls only `coordinator.cancel()`") is correct — the line pointer is off by 3.

## 2. Missing

**M1 — Layer 2 "sliding-window fraction" is underspecified.**
§3 Layer 2 says: *"Считать «доля опросов выше порога в скользящем окне», не «любой звук сбрасывает счётчик» (один клик клавиатуры не должен обнулять 60 с)."* No window length or fraction threshold is given (e.g. "10 s window, ≥80% of 40 polls silent"). Test 9 (§4) exercises the *behavior* qualitatively but without a pinned numeric spec an implementer must invent the constants themselves — this is exactly the kind of hidden decision a spec should close.

**M2 — Pre-cutoff beep timing unspecified.**
§3 Layer 2 last bullet: *"за несколько секунд до silence-cutoff — `audio_feedback::play`"* — "несколько секунд" (a few seconds) is not a number. No corresponding test exists in §4 either (see M3).

**M3 — §3 ↔ §4 orphans (layers with no matching test):**
- Layer 2 pre-cutoff beep → no test.
- Layer 4's heartbeat `sync_all`/interval change → tests 14–15 cover oversize-dump-skip and spectrum throttling only; the heartbeat durability/interval change is untested.
- Layer 6 (UI: auto-stop / max-duration settings) → no dedicated test.
- Layer 7 (observability: WARN + breadcrumbs `recording:auto_stopped_silence`, `recording:auto_stopped_max_duration`, `recording:release_pending_applied`) → no test asserts these fire.
- Layer 1's generation/epoch counter (5th bullet, "вторая линия от дубля") → tests 3/4/6/7 cover CAS and stage-ordering but none isolates stale-generation rejection specifically.

**M4 — Layer 5 validation gap.** `config/validation.rs`'s existing DRY helpers (`validate_range`, `validate_max`, `validate_choice`) have no "0 = exempt, else in range" shape. The plan's rule `silence_timeout_ms == 0 || (5_000..=300_000).contains(..)` needs either a new helper or inline logic — not called out as a to-do.

**M5 — No concrete ceiling constant for `max_recording_ms` validation.** §3 Layer 5 says only *"≤ значение, дающее < 25 МиБ"* — leaves the actual millisecond ceiling (e.g. ~780_000 ms) to be invented at implementation time, risking drift from the stated default (600_000 ms).

## 3. Doubtful assumptions

- **48 kHz capture rate** (E3) — plausible on Apple Silicon but not confirmed from the cited logs; should be grep-verified against an actual runtime log line before being used as a headline number.
- **"swap 2.86 ГБ"** (§1.3) — not present in `JetsamEvent-2026-09-04-154328.ips` (checked all memory-related keys: `compressorSize`, `pageSize`, `memoryPages.free`, no `swap*` field). Free≈190MB and compressor≈13GB *are* confirmed (`free: 11681 pages × 16384B ≈ 191MB`; `compressorSize: 793129 pages × 16384B ≈ 13.0GB`), so the swap figure likely comes from a different tool (e.g. `vm_stat`) not in the reviewed dataset — not necessarily wrong, just unverifiable here.
- **`#[derive(Clone)] RecordingCoordinator`** — checked and confirmed *sound*: all fields (`app: AppHandle`, rest `Arc<...>`) are cheaply `Clone` (`recording.rs:57-77`), so this is not doubtful, it's correct as designed.

## 4. Concrete recommendations (minimal, literal edits)

1. **§6**: Replace with the actual pipeline — *"release.yml builds macOS best-effort in a KVM VM (unsigned, `continue-on-error: true`); artifact is `voxis-macos-arm64.tar.gz`. No notarization/DMG exists yet (see `docs/MACOS_SIGNING_TODO.md`). Skip the `spctl`/DMG verification step for this release; verify via `tar -xzf` + direct binary run + `Gatekeeper` bypass (`xattr -d com.apple.quarantine`) instead."* If signed/notarized is actually required for 0.1.3, add it as an explicit blocking prerequisite task, not a one-line assumption.
2. **§1.3 Layer 2 note**: change "10×–1000×" → "100×–1000×" (per `config/mod.rs:156` and `recorder.rs:64-70`).
3. **§1.3.A**: either cite an actual observed sample-rate log line, or soften to *"at the device's negotiated rate (commonly 44.1–48 kHz), f32 mono ≈ 176–192 KB/s."*
4. Fix citation: `Orchestrator::cancel()` is `mod.rs:128-130`, not `131-133`.
5. **Layer 2**: add explicit constants, e.g. *"sliding window = 10 s of 250 ms polls (40 samples); stop if ≥80% of samples in window are below `SILENCE_RMS`."* Make both tunable via `config/consts.rs` if desired.
6. **Layer 2**: specify beep lead time, e.g. *"beep 3 s before silence-cutoff (silence_timeout_ms − 3000)"*, and add test 9b: *"pre-cutoff beep fires exactly once at cutoff−3s."*
7. Add three tests to §4: heartbeat interval/`sync_all` removal behavior; breadcrumb emission assertions for the three new sites; an isolated epoch/generation-dedup test independent of test 4.
8. **Layer 5**: add one sentence naming the actual `max_recording_ms` ceiling constant (compute from 25 MiB / (16000×2) ≈ 819 s ≈ 780_000 ms with margin) and note that `validate.rs` needs a new "0-exempt" helper or inline branch.

## 5. VERDICT: CONDITIONAL — maturity 7/10

The diagnosis (§1) is unusually well-sourced: of ~14 spot-checked file:line citations against the actual Rust source, **12 were exact or off by ≤2 lines** (`recording.rs:293-296`, `:185-188`, `:125-129`, `:274-278`, `:241`, `level.rs:42`, `config_sqlite.rs:121/275`, `settingsRegistry.ts:111`, `logging.rs:34-35`, `heartbeat.rs:220-231/349-353`), the toggle-mode bug and the double-dump disk-write math (91.6% = 2×1684/3677) both check out arithmetically and against the `.diag`/`.ips` evidence, and the JetsamEvent facts (`replicatord`, `per-process-limit`, `voice` as `largestProcess` but not killed, free≈190MB, compressor≈13GB) are confirmed byte-for-byte. The 25 MiB/16kHz/16-bit WAV math (`encoder.rs:65` confirms `bits_per_sample: 16`, `encoder.rs:8` confirms `TRANSCRIPTION_SAMPLE_RATE = 16_000`) is internally consistent and correctly uses MiB vs MB. Layers 0–1 (the actual root-cause fix) are executable as specified.

What blocks a clean GO: **§6 describes a release pipeline that does not exist** (no signing/notarization/DMG anywhere in `release.yml`, contradicted by `docs/MACOS_SIGNING_TODO.md`) — this must be corrected before anyone follows the deploy section literally. Additionally, Layer 2's sliding-window fraction and pre-cutoff beep timing are underspecified enough that two implementers would build different behavior, and five layers (2's beep, 4's heartbeat change, 6, 7, and part of 1's epoch counter) have no matching test in §4. None of this invalidates the core fix; it needs the listed edits before implementation of those specific sub-items and before the deploy step is executed.