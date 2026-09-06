# ROUND2 review 2 — implementer feasibility audit, Layers 0–3

Reviewer lens: senior Rust/tokio/Tauri implementer. Blind review of `/tmp/swd-plan-clean2.md`
against source only. Every claim cites `src-tauri/src/<file>:<line>` or a log excerpt.

Diagnosis (§1.1) verified: `voice.log.2026-09-05` lines 1–10 show `checking mic permission`
at 09:55:26.942Z, `Ignoring hotkey release - not recording` at 09:55:27.060Z, `loading config`
at 09:55:29.294Z. Press and release run as **independent spawned tasks**
(`setup/hotkey.rs:12-14, 20-22`; overlay path `commands/recording.rs:131-141`), so the
release is processed concurrently while the press task is parked in
`Command::output()` (`permissions/macos.rs:110-126`). The root-cause story is correct.

---

## 1. Errors (wrong facts / wrong reasoning)

### E1. `compare_exchange(true,false)` at the top of `AudioRecorder::stop()` breaks `stop_macos_pause`
`is_recording` is the **stream-state** flag: it is set `false` by the *recording thread* when it
processes `Pause` (`audio/stream.rs:143-146`) and `stop_macos_pause()` busy-waits on exactly that
flag to know the pause was applied (`audio/recorder.rs:258-263`). If `stop()` CASes it to `false`
first, the wait loop exits immediately; `get_samples()` (`recorder.rs:191-194`) then clones while
the callback may still be appending, and `start()` → `try_resume_recording()` (`recorder.rs:79-81,
105-124`) sees `is_recording == false` before `Pause` has even been dequeued. The single-flight
guard **must** be a separate `stopping: AtomicBool` (the plan's parenthetical alternative), reset
at the end of `stop()` on every path and in `start()`. The first option, as written, is wrong.

### E2. "Flip stage `Recording → Processing` **before** `recorder.stop()`" breaks every non-happy path
`Command::Cancel` is a no-op in `Processing` (`orchestrator/coordinator.rs:229-236`). The current
release code relies on `coordinator.cancel()` from `Recording` in:
- too-short drop (`orchestrator/recording.rs:328`),
- `handle_error` (`recording.rs:397`) — used on `recorder.stop()` Err (`recording.rs:305-313`),
- the planned `Orchestrator::cancel → stop_recording(Cancel)` discard.

With the stage already `Processing` all three leave the coordinator **stuck in `Processing`
forever** (no `queue.push` → no `notify_processing_finished`, `dispatch.rs:43`). This recreates
the "app is deaf" symptom (§1.2) under a different stage name.

It also opens a **new race with TALRI**: `on_hotkey_pressed` admits a press in `Processing`
(`recording.rs:133`). During the stop window (stage=Processing, `is_recording` still true) a new
press calls `recorder.start()` → early `Ok(())` without `clear_samples()` (`recorder.rs:79-81`)
→ `coordinator.on_press()` → stage `Recording`; then the old `stop()` pauses the stream. Result:
stage `Recording`, mic paused — the exact stuck state the plan is fixing. Today this cannot
happen because `on_release()` is sent only after `recorder.stop()` returned (`recording.rs:344-345`).

### E3. "Cap reached → **actively** `stop_recording(MaxDuration)`, not a passive flag" is not implementable where the cap lives
The only place the buffer grows is `process_chunk` (`audio/level.rs:42`) inside the cpal callback
(`stream.rs:239-247`). It has no `sample_rate`, no `AppHandle`, no coordinator, and must not
block or call async code. The cap check there can only *stop pushing* and/or set an atomic
`cap_hit`; the **active** stop has to come from the Layer 2 guard's `elapsed >= max_recording_ms`
branch. The plan should say so explicitly instead of forbidding the passive flag.

### E4. `spawn_blocking` for the perm probe does **not** shrink the Layer 0 race window
`spawn_blocking(...).await` still suspends `on_hotkey_pressed` for the full 0.3–4.2 s; the release
task still hits `current_stage() != Recording` (`recording.rs:293-296`) and is dropped. It only
stops one tokio worker from being pinned. It is a valid hygiene change, but the plan lists it as
an alternative to caching/objc for closing the race ("**или**") — it is not one. Only 0(a), or
removing the probe from the path, closes it.

### E5. Test 1/4/5/6/7 are not buildable as described
`RecordingCoordinator::new` needs an `AppHandle` (`recording.rs:82-83`) and every method calls
`load_config_from_app` (`orchestrator/mod.rs:35-42`). `Cargo.toml:34` enables no `tauri/test`
feature, there is no `mock_app()` usage anywhere, and `orchestrator/tests.rs` never constructs a
`RecordingCoordinator`. Either add `tauri = { features = ["test"] }` under `[dev-dependencies]`
and use `tauri::test::mock_app()`, or extract the press/release/stop decision logic into a pure
state machine with injected seams (as the plan already does for Layer 2). Unspecified → blocks TDD.

---

## 2. Missing (matters for correctness)

### M1. Layer 0(a): exact window and flag lifecycle unspecified
- Window (keyboard path): from the `pending_press` slot being cleared (`recording.rs:168-172`)
  until the worker applies `Press` after `coordinator.on_press()` (`recording.rs:231-233`).
  Window (overlay/`skip_debounce=true`): from function entry (`recording.rs:114`) to the same
  point — `press_seq` is **never incremented** on that path (`recording.rs:148-152` is inside
  the debounce block), so "release_pending for press N" has no N to attach to.
- Existing micro-window not mentioned: release arriving between `select!` exit (`recording.rs:163`)
  and slot-clear (`recording.rs:168`) cancels a token nobody is listening on
  (`recording.rs:283-287` `return`s) and the press continues — a lost release *without* any perm
  probe. The flag must be set in that branch too, and the press must check
  `cancelled || release_pending` after the select.
- Ordering: release must `release_pending.store(true)` **before** its stage check (Dekker
  order); press must `in_flight=false` then `release_pending.swap(false)` **after**
  `await_stage(Recording)`. Otherwise both sides can each see the other "not yet".
- Reset: the flag must be cleared at press entry and on **every** early return
  (perm denied `recording.rs:190-194`, `recorder.start` Err `recording.rs:206-219`). Otherwise
  a stale flag stops the *next* recording immediately.
- "stop immediately after start" vs "never start": both are needed — check the flag right
  before `recorder.start()` (never start, no beep, no `on_press`), and re-check after
  `await_stage(Recording)` (residual window). If the release also observed `Recording` and
  stopped, the press-side stop is a **second stop** → this requires Layer 1 single-flight to be
  in place first, i.e. Layer 0(a) depends on Layer 1, contrary to §9's order.

### M2. `stop_recording` body omits `polling_cancel` and the guard token
The plan lists `recorder.stop → too-short → beep → queue.push → on_release → overlay` but not
`polling_cancel.take().cancel()` (`recording.rs:289-291`). Today `Orchestrator::cancel()`
(`mod.rs:131-133`) never cancels polling; the loop only exits on `!recorder.is_recording()`
(`audio_level.rs:56`), which never flips because the mic isn't stopped — a live leak
(`voice.log.2026-09-05:87079`: "polling cancelled after 435263 iterations" ≈ 9.7 h). Must be
inside the single stop path.

### M3. Concurrent **presses** are not addressed
Two `on_hotkey_pressed` tasks can both pass the `Idle|Processing` gate (`recording.rs:133`)
while the first is in the perm probe (stage still `Idle`). Second `recorder.start()` returns
early `Ok` (`recorder.rs:79-81`), second `on_press` is debounced/ignored — mostly benign today,
but with `release_pending` as one bool, and with the guard spawned twice, it needs a stated
rule (e.g. `in_flight` gate: if a press is in flight, ignore the new press).

### M4. Layer 3: how the cap reaches the recorder, and a config-independent hard cap
`AudioRecorder` has no config access; `process_chunk` receives `&mut Vec<f32>` only
(`level.rs:22-30`). Need `AudioRecorder::set_max_samples(usize)` (or param on `start`) → an
`Arc<AtomicUsize>` threaded through `spawn_recording_thread` (`stream.rs:25-34`) into the
closure (`stream.rs:239-247`). `max_recording_ms = 0` (off) yields cap = ∞ — the plan needs an
absolute backstop (e.g. 30 min × native rate) independent of user config.

### M5. `get_samples()` clone is the memory peak and is avoidable in one line
`recorder.rs:191-194` clones; `start()` always `clear_samples()` first (`recorder.rs:83`).
`std::mem::take(&mut *guard)` removes the 2× peak *and* releases capacity — strictly better
than the proposed `shrink_to_fit()`/`Vec::new()` after the clone. `get_recent_samples`
(`recorder.rs:302-310`) after stop then returns empty — acceptable (polling is cancelled).

### M6. `Orchestrator::cancel` must become `async`
`mod.rs:131` is `pub fn cancel(&self)`; `stop_recording` is `async`. Caller
`commands/recording.rs:149` is already in an async command — trivial, but not stated.
FinishGuard concern: **not an issue** — `finish_guard()` is only used in coordinator tests
(`coordinator.rs:375-420`); production uses `notify_processing_finished()` (`dispatch.rs:43`).
Cancel with no `queue.push` touches neither.

### M7. Layer 2 guard cancellation must be token-based, not `JoinHandle::abort()`
The guard calls `stop_recording`, whose RAII guard cancels the guard's own token. That is fine
with a `CancellationToken` (cooperative), but fatal with `abort()` (would abort mid-stop while
holding `stop_lock`). Plan says "token", but "RAII-guard" should state "cancel token, never abort".

### M8. `perm-check Unknown/timeout` semantics
`is_granted()` is `matches!(Granted)` (`permissions/checker.rs:61-63`) → `Unknown` (osascript
timeout/Err) emits "Microphone permission required" and returns. If a timeout wrapper is added
(it should be), `Unknown` should **fall through to `recorder.start()`** — cpal already maps the
denied case (`recorder.rs:143-152`, `stream.rs:100-111`).

---

## 3. Doubtful assumptions

### D1. Per-chunk RMS sampled every 250 ms
`process_chunk` stores RMS of the *current chunk* (`level.rs:46-53`); CoreAudio chunks are
~512 frames ≈ 10 ms @48 k. A 250 ms poll reads one 10 ms slice out of 25 → 4 % duty cycle.
Speech has many 10 ms gaps; a key click is one chunk. Store `fetch_max` of the RMS bit pattern
(non-negative f32 bits are monotonic as `u32`) and have the reader `swap(0)` → "peak RMS since
last poll" integrates all chunks. Otherwise the sliding-fraction logic is fed noisy samples.

### D2. Sliding-window "fraction above threshold" is not specified and contradicts `guard_decision(rms, silent_ms, …)`
A fraction needs a ring buffer of N = `silence_timeout_ms / 250` booleans, an `ACTIVE_FRACTION`
constant, and a "window full" condition; `silent_ms` is a counter model. Pick one; the pure
function signature must carry the window state (`&[bool]` or a struct), not `silent_ms`.

### D3. `SILENCE_RMS = 0.005` (−46 dBFS)
Unvalidated. Built-in MacBook mic idle floor is typically −55…−50 dBFS RMS; a fan-heavy room
sits near −46. Above threshold → silence guard never fires and only `max_recording_ms` backstops.
Below → fine. Needs one empirical measurement with the built-in mic; state it as a tunable.
Existing detector uses post-boost `audio_level == 0` (`level.rs:50-52`, `audio_level.rs:98-107`),
i.e. `rms < 0.00125` at default boost 800 — the plan is right that it's boost-dependent.

### D4. Caching `Granted` vs revoke-mid-session
macOS does not terminate an app when mic TCC is revoked; CoreAudio delivers zeros, and cpal
open still succeeds. So caching loses only the pre-emptive "permission required" message in the
revoke case; the silence guard covers the actual failure. Acceptable, but **objc is strictly
better and realistic**: `objc2 = "0.6"` is already a dependency (`Cargo.toml:115`);
`AVCaptureDevice authorizationStatusForMediaType:` via `msg_send!` + `#[link(name =
"AVFoundation", kind = "framework")]` is ~20 lines and microseconds. Cache only `Granted`,
never `Denied/Unknown`.

### D5. Generation counter
"Stored where, read by whom, what on mismatch (drop the user's audio?)" is unanswered. With
`stop_lock` + in-lock re-check + `stopping` flag, it is redundant. Drop it (KISS) or fully specify.

### D6. `derive(Clone)` on `RecordingCoordinator`
Verified: all nine fields are `AppHandle`/`Arc<…>` (`recording.rs:59-78`) — Clone is fine.
Holding a `tokio::sync::Mutex` across the blocking `recorder.stop()` (≤500 ms / 3 s spin,
`recorder.rs:252-263`) pins a runtime worker; wrap `recorder.stop()` in `spawn_blocking`
while at it.

### D7. Toggle-press direct `stop_recording` — confirmed correct
Dead path verified: `recording.rs:125-129` → `on_hotkey_released` → `recording.rs:274-278`
returns before `recorder.stop()`. Calling `stop_recording` bypasses it. Correct.

### D8. Layer 3 sample_rate — correct as stated
The raw buffer is at **device-native** rate: `process_chunk` pushes every frame; downsampling
to 16 k happens only in `stop()` (`recorder.rs:206-214`). `recorder.rs:161` stores the native
rate; cap = `max_recording_ms/1000 × native_rate` is right. The 25 MiB Groq figure is a
separate, post-downsample constraint — the plan conflates them in one bullet; keep both but label.

---

## 4. Concrete recommendations (minimal, literal plan edits)

1. **Layer 1**: replace "`compare_exchange(true,false)` (or `AtomicBool stopping`)" with
   "`stopping: AtomicBool`, `compare_exchange(false,true)` at top of `stop()`; `store(false)` on
   every exit of `stop()` and in `start()`. Do **not** touch `is_recording` in `stop()`."
2. **Layer 1**: delete "flip stage `Recording → Processing` before `recorder.stop()`".
   Replace with: "`stop_lock` + `stopping` flag are the observers' signal; `on_hotkey_pressed`
   must bail (or wait on `stop_lock`) if `recorder.is_stopping()` even in `Processing`."
   If a pre-stop flip is kept anyway, the discard/error paths must call
   `notify_processing_finished()` instead of `cancel()`, and this must be written down.
3. **Layer 0(a)**: add an explicit spec: `in_flight: Arc<Mutex<Option<u64>>>` set right after the
   debounce block (and at entry for `skip_debounce`), `press_seq` incremented on **both** paths,
   `release_pending: AtomicBool`; release sets it *before* the stage check; press checks it
   (i) after the `select!`, (ii) before `recorder.start()` → never start, (iii) after
   `await_stage(Recording)` → `stop_recording(ReleasePending)`; cleared at entry and on all
   early returns. State the dependency: implement Layer 1's `stop_recording` **first**.
4. **Layer 0(b)**: pick objc (`objc2` present) as primary; `spawn_blocking` + `timeout(1s)` as
   fallback with `Unknown → proceed to recorder.start()`. Remove "или" between (b) options.
5. **Layer 1**: list `polling_cancel.take().cancel()` and guard-token cancel inside
   `stop_recording`; `Orchestrator::cancel` becomes `async`; update `commands/recording.rs:149`.
6. **Layer 2**: `rms_bits` via `fetch_max` (bit pattern) + reader `swap(0)`; define the window
   as ring buffer `N = silence_timeout_ms/250`, `ACTIVE_FRACTION = 0.05`, fire only when full;
   change `guard_decision` signature to take the window state. Note "token cancel, never abort".
7. **Layer 3**: replace "active stop at cap" with "callback stops pushing + sets `cap_hit`; the
   guard's `elapsed` branch is the active stop"; add `AudioRecorder::set_max_samples`, thread
   `Arc<AtomicUsize>` into `spawn_recording_thread`; add an absolute hard cap for
   `max_recording_ms = 0`; replace the shrink bullet with `std::mem::take` in `get_samples()`.
8. **Tests**: add a bullet "Layer 0/1 tests require `tauri/test` + `mock_app()` **or** a pure
   `PressReleaseMachine` with injected `recorder`/`coordinator` seams" and choose one.
9. **§9 order**: `Layer 1 (stopping flag + stop_recording) → Layer 0(a) → Layer 0(b) → …`.

---

## 5. VERDICT

**CONDITIONAL — 5/10.**

The diagnosis is accurate and evidence-backed, and the architecture direction (single stop
path, boost-independent silence source, native-rate cap) is right. But two Layer 1 items as
literally written would introduce regressions worse than the bug (E1: CAS on the stream-state
flag; E2: stage-first flip leaves the coordinator stuck in `Processing` and reopens the
stuck-Recording race via TALRI), Layer 0(a) lacks the ordering/lifecycle detail that decides
whether it closes the window, Layer 3's "active stop at cap" is unimplementable in the audio
callback, and the Layer 0/1 tests cannot be compiled without an unmentioned test harness.
With recommendations 1–3, 7 and 8 applied the plan is GO.
