# Hardening Sweep Review — hard_r1

VERDICT: REJECT-FIX

Scope reviewed: `/tmp/ado.C4YWdv/diff_hard.patch` (14 files) against
`crates/tauri-plugin-voxis/`, `crates/voxis-core/`, `src-tauri/Cargo.toml`
in `/Users/shamash/work/voxis`. Read/grep only, no bash/find, no edits
made. Worker's own pre-verification (471/0 core, 165/0 x2 plugin desktop,
118/0 no-features, clippy/iOS/swift/host-min) was **not** independently
re-run by me (no bash access in this review) — taken as reported,
unverified by this pass.

## Findings

### F1 — HIGH / must-fix: `spawn_blocking` around `capture.start()` opens a
real cancel-during-start race that silently drops the cancellation
(`commands.rs::do_start`, `session.rs::ActiveSession`/`trigger_cancel`)

`session.rs`'s own doc comment on `ActiveSession::handles` (unchanged by
this diff, now stale) claims:

> `None` only in the brief window between `SessionGuard::begin` returning
> an id and `attach_handles` being called for it — both happen inside the
> same non-yielding stretch of `do_start` (no `.await` in between) ...
> so nothing outside `do_start` can ever observe `handles == None`.

That invariant is what makes `trigger_cancel`'s early return
(`let Some(handles) = active.handles.as_ref() else { return };`,
`session.rs` ~176) safe: the doc's premise was that no other task could
ever observe/act on a session with `handles == None`, because the window
was too short (synchronous) to yield to another task.

This diff inserts a genuine `.await` between `state.sessions.begin(mode)`
and `state.sessions.attach_handles(&id, handles)` in `do_start`:

```rust
let id = state.sessions.begin(mode)?;
...
let start_result = tokio::task::spawn_blocking(move || capture.start(&start_path, cap_samples))
    .await   // <-- new yield point; did not exist before this diff
    ...
...
let handles = pipeline::spawn(id.clone(), mode, file, deps, state.sessions.clone());
state.sessions.attach_handles(&id, handles);
```

On the multi-thread runtime the app actually runs (and the
`worker_threads = 1`/`flavor = "multi_thread"` tests in this same diff
prove the authors know the production runtime is multi-thread), another
task (a concurrent `cancel()` command, or `cancel_all_hold()` fired from
`on_page_load`/webview-destroyed/app-exit — exactly the `[R1-Safety S4]`
safety net this project relies on for Hold-mode mic safety) can now run
`request_cancel`/`cancel_all_hold` for `id` while `handles` is still
`None`:

- `SessionGuard::request_cancel(id)` sees `is_active(id) == true` (the
  slot is claimed) and returns `true` — looks like success to the caller.
- `Self::trigger_cancel(active)` no-ops because `active.handles` is
  `None` — the flag is never set, no signal is sent.
- `SessionGuard::outcome_receiver(id)` also returns `None` (same
  `handles`-gated lookup), so `do_cancel` skips `await_outcome` entirely
  and returns `Ok(())` **immediately**.

Net effect: a `cancel()` (or a page reload during a Hold session) that
lands in this window reports success, but the session it targeted is
completely unaffected — recording continues, `capture.start()` finishes,
`attach_handles` runs, and the pipeline proceeds as if cancel was never
called. This is a real regression in the exact safety property
`[R1-Safety S4]` (webview death must not leave a Hold session's mic
open) that the rest of the codebase goes out of its way to guarantee
elsewhere (`SessionSlotGuard`, TOCTOU `cancelled` re-checks in
`pipeline.rs::finalize`/`run_transcription`).

No test in this diff (or, as far as I can see, pre-existing) exercises
"cancel/cancel_all_hold arrives between `begin()` and `attach_handles()`
while `capture.start()` is in flight on the blocking pool" — the
existing round-2-review TOCTOU tests in `pipeline.rs`
(`cancel_races_the_guards_own_finalize_scenario_a`/B) all target the
*stop*-side window (finalize/transcribing), not this new *start*-side
window that this diff itself introduces.

Fix directions (not prescribing one): re-check `cancelled`/re-run
`request_cancel` logic against the id after `attach_handles` and treat
a "cancel arrived during start" as an immediate cancel of the
just-attached session; or hold `begin()`'s lock/slot claim un-observable
to `request_cancel` until handles exist (e.g. a real `Option` check that
also queues/stores a pending-cancel intent instead of silently
no-op'ing); or don't cross an `.await` point between `begin()` and
`attach_handles()` at all (spawn the `capture.start()` blocking call
*inside* the already-spawned pipeline task, after handles exist, instead
of in `do_start` before the task is spawned). Also update `session.rs`'s
now-incorrect doc comment on `ActiveSession::handles` regardless of which
fix is chosen — it currently asserts a guarantee this diff broke.

### F2 — MODERATE: `voxis://result`-after-slot-free reorder narrows one
race but reopens a related, more dangerous one; payload still has no
session id to disambiguate (`pipeline.rs::finalize`, `models.rs::
DictationResult`)

The reorder itself (`RESULT_EVENT` now emitted after `drop(file)` +
`sessions.end(&id)` instead of before) correctly fixes the bug it's
aimed at: previously a frontend reacting to `voxis://result` by
immediately calling `start()` again could race the not-yet-freed slot
into a spurious `AlreadyRecording` (confirmed against
`guest-js/src/client.ts`'s `dictate()`, which listens for `voxis://state
== "idle"` with a 50ms grace window rather than reacting to
`voxis://result` directly to call `start()` — so this specific consumer
is not broken by the reorder, and the relative order of
`STATE_EVENT("idle")` before `RESULT_EVENT` is unchanged by this diff,
only the *cleanup* position moved).

However, `guest-js/src/client.ts`'s `dictate()` doc comment states the
implementation's actual safety invariant plainly:

> Given the plugin's own single-flight guarantee (a second `start()`
> while active fails with `AlreadyRecording`), "the next result event
> after this `start()`" can only be *this* session's result.

Before this diff, that was structurally true: `RESULT_EVENT` was emitted
*before* `sessions.end(&id)`, so the single-flight slot was still held
for the entire time between `start()` returning and its own result
firing — a second `start()` could not succeed in between. After this
diff, `sessions.end(&id)` runs *before* `RESULT_EVENT` is emitted, so
there is now a window — two synchronous statements with no `.await`
between them, but real under contention (e.g. another thread's blocked
`do_start`'s own `sessions.begin()` racing to acquire the just-released
mutex) — where a second `start()` for a *different* session can succeed
before the first session's `RESULT_EVENT` fires. `DictationResult`
(`models.rs`) has no session-id field at all
(`text`/`language`/`duration_ms`/`guard_outcome` only), so if this window
is ever hit, nothing in the payload lets any consumer — `client.ts`'s
`dictate()` included — tell which session a given `voxis://result`
actually belongs to.

This is narrower and harder to trigger than F1 (needs precise
mutex-release-then-reacquire timing, not just "any cancel command"), and
is not itself new in kind (the pre-existing single-flight design already
assumed exactly one active session and one in-flight result at a time);
but the reorder specifically removes the property that made "next result
== this session's result" airtight, and the fix chosen doesn't add the
missing disambiguator. Recommend either adding a `session_id` field to
`DictationResult`/`voxis://result`'s payload (the more robust fix,
independent of any particular ordering), or, at minimum, documenting this
as an accepted residual risk in both `pipeline.rs` and `client.ts` (the
latter's own comment currently overstates the guarantee).

## Checked OK

- `AudioCapture: Send + Sync` (`capture.rs`) — `Arc<dyn AudioCapture>` is
  a valid capture for `spawn_blocking`'s `Send + 'static` closure
  requirement in both `commands.rs::do_start` and `pipeline.rs::finalize`.
- `JoinError` handling in both `spawn_blocking` call sites converts a
  panic on the blocking-pool thread into a normal `CaptureError::Backend`
  via `unwrap_or_else`, not a propagated panic — `do_start`'s manual
  rollback (`drop(file); sessions.end(&id)`) and `finalize`'s
  `capture.reset()` + `capture_failed = true` path both handle this
  correctly as an ordinary error. Note (see Minors): this does change
  what `PanicOnStopCapture`'s existing test actually exercises.
- Late `rdev::listen` failure (`hotkey_desktop.rs`): `report_listen_failure`
  is only called from the `if let Err(e) = rdev::listen(callback)` branch;
  a normal/`Ok(())` return from `rdev::listen` (however rare) does **not**
  call it — no spurious `voxis://error` on a normal listener exit.
- `EventSink` used for the late-listener-failure emit
  (`desktop_hotkey_factory`'s own `TauriEventSink::new(app.clone())`) is a
  *separate instance* from the one built for `PluginState` in `lib.rs`'s
  `build()`, but `TauriEventSink` (`events.rs`) is fully stateless — both
  instances just forward to `AppHandle::emit`, so there is no behavioral
  difference from sharing one instance; flagged only as a very minor
  redundancy (see Minors), not a bug.
- `secrets.rs` temp+rename: temp file lives in the same parent directory
  as the real `secrets.json` (`parent.join(format!(".{file_name}.{uuid}.tmp"))`),
  so `fs::rename` is same-filesystem/atomic; the temp file is created
  with `mode(0o600)` atomically via `O_CREAT` *before* any bytes are
  written (same pattern as `RecFile::create`), not chmod'd after the
  fact; a write or rename failure removes the temp file and returns `Err`
  (no orphan on the failure path either); `file_secret_store_file_is_0600_on_unix`
  (pre-existing) still validates the final path's permissions since
  `rename` preserves the source inode's mode.
- Swift `mediaServicesWereReset` handling: `engineNeedsRebuildAfterReset`
  is consumed and a fresh `AVAudioEngine()` is constructed at the very
  top of `startEngine()`, before `engine.inputNode`/`converter`/tap/
  `installFailureObservers()` are touched — the new tap, new converter,
  and new `AVAudioEngineConfigurationChange` observer (`object: engine`)
  are all wired to the *new* engine instance, not stale references to the
  old one. `removeFailureObservers()` (called from `failWithInterruption`,
  which the reset handler itself triggers) tears down the old engine's
  observers before the next `startEngine()` runs. All closures already
  used `[weak self]` before this diff and still do — no new retain
  cycle. No `#available` blocks were touched.
- `config_sqlite.rs` test replacement: the deleted
  `test_save_and_load_cycle_all_fields` is not a net coverage loss — a
  pre-existing, independent test in the same file,
  `every_app_config_field_round_trips_through_sqlite` (Task 6c, "THE
  DURABLE GUARD"), already round-trips *every* `AppConfig` field
  byte-for-byte via a fully non-default fixture plus a compile-time
  exhaustive destructure that fails to compile if a field is ever added
  without being covered. The six fields the new, narrower test targets
  (`backend`, `text_processing`, `overlay.size`, `overlay.margin`,
  `llm.provider`, `dictionary.learning_mode`) are the only ones the old
  test set but never actually asserted — confirmed by grepping the file:
  `silence_timeout_ms`/`max_recording_ms`/`hotkey_hold_ms`/etc. are all
  independently asserted in `every_app_config_field_round_trips_through_sqlite`
  and/or their own focused tests (`test_recording_guard_zero_disabled_round_trip`,
  `test_save_and_load_config`).
- `hound`: confirmed zero matches for `hound` under `src-tauri/src` via
  grep. `src-tauri/Cargo.toml` still depends on `rodio` (`features =
  ["wav"]`, which pulls `hound` transitively) and `voxis-core/Cargo.toml`
  still directly depends on `hound = "3.5"` — the claim that WAV support
  is unaffected by dropping the redundant direct dependency checks out.
- `dictionary.rs`/`pipeline.rs` DRY refactor: `apply_entries` is a
  straight extraction of the same escape/word-boundary/case-insensitive
  regex logic that was duplicated in both `DictionaryStorage::apply` and
  `pipeline.rs`'s old `apply_dictionary` — no behavior change, both call
  sites now share one implementation.
- `sleep_while_running`/`LEVEL_SLEEP_SLICE` slicing (`desktop/pure.rs`,
  `desktop.rs`): pure, unit-tested (`sleep_while_running_sleeps_the_full_interval_when_stage_stays_running`,
  `..._stops_early_once_stage_leaves_running`), injected `sleep_fn` for
  determinism; bounds `stop()`'s `level_thread.join()` wait to one 25ms
  slice instead of up to 250ms — straightforward, low-risk.
- `RecDir::sweep` per-file `warn!` on delete failure: doesn't abort the
  rest of the sweep, doesn't turn a single stuck file into a hard `Err` —
  matches the new `#[cfg(unix)]` regression test using a read-only parent
  dir to simulate an undeletable file without requiring root.

## Minors

- **`PanicOnStopCapture`/`a_panic_inside_finalize_still_frees_the_session_slot`
  test intent has quietly shifted.** Before this diff, a panic inside
  `capture.stop()` (called inline in `finalize`'s own task) unwound
  through `finalize`, and it was `SessionSlotGuard`'s `Drop` impl (review
  finding F4) that actually freed the slot — that's what the test's own
  doc comment describes. After this diff, `capture.stop()` runs inside
  `tokio::task::spawn_blocking`, whose panic is caught by tokio and
  surfaced as a `JoinError`, which `finalize` converts into an ordinary
  `Err` via `unwrap_or_else` — `finalize` itself no longer panics for
  this specific scenario, so the test still passes but no longer
  exercises the `SessionSlotGuard`-drop-on-panic safety net its comment
  claims to cover. Not a functional bug (the outcome — slot freed, next
  `start()` succeeds — is unaffected), but the test's documentation is
  now slightly misleading about which mechanism is actually being
  verified, and the *original* panic-unwind path through `finalize`
  (e.g. a panic somewhere else in `finalize`'s own body, not wrapped in
  `spawn_blocking`) is now unexercised by any test in this diff.
- `secrets.rs`'s `save()` doc comment claims the temp+rename is "atomic
  on every platform this crate targets" but doesn't call out that this
  relies on `std::fs::rename`'s Windows behavior specifically passing
  `MOVEFILE_REPLACE_EXISTING` to `MoveFileExW` (true as of current Rust
  std, but a platform-specific detail the comment glosses over rather
  than states). No `fsync`/`sync_all()` call on the temp file before
  `rename` — a crash between `rename` returning and the OS actually
  flushing dirty pages could still leave `secrets.json` truncated/garbage
  on some filesystems/power-loss scenarios; `rename`'s atomicity protects
  against a *half-written* file being visible, not against data not yet
  reaching disk at all. Likely acceptable for this use case (a
  locally-editable secrets file, not a WAL/journal), but worth a one-line
  acknowledgment in the doc comment rather than the current unqualified
  "atomic" framing.
- `desktop_hotkey_factory` and `lib.rs`'s `build()` construct two
  independent `TauriEventSink` instances (one for `RdevHotkey`, one for
  `PluginState`) instead of sharing a single `Arc<dyn EventSink>` clone.
  Harmless today (the type is stateless), but slightly against the grain
  of "`events` is the one injectable seam" framing elsewhere in the
  codebase, and a future stateful `EventSink` (e.g. one that
  deduplicates/rate-limits) would silently develop two independent
  states if this pattern isn't consolidated.
- `regex` dependency in `tauri-plugin-voxis`'s own `Cargo.toml` is
  reported by the worker as now-unused (dictionary logic moved to
  `voxis-core::storage::dictionary::apply_entries`) but intentionally
  left in place "for follow-up" — not independently re-verified by this
  review pass (no bash/cargo access), flagging only that it's an
  acknowledged, not-yet-closed loose end, not a hidden one.

## CHANGELOG-worthy behaviour changes

- `AudioCapture::start`/`stop` (desktop `CpalCapture` and iOS bridge) no
  longer run inline on the plugin's async runtime worker thread —
  both are now dispatched via `tokio::task::spawn_blocking` from
  `commands::do_start` and `pipeline::finalize` respectively. User-visible
  effect: the plugin's single async worker is no longer blocked for the
  duration of a slow/blocking capture backend call (mobile IPC round-trip,
  a future backend that blocks opening a device). **Caveat (see F1):**
  this also introduces a real timing window where a `cancel()` (including
  the automatic Hold-mode cancel-on-webview-death safety net) issued
  while `start()` is still awaiting the blocking capture call is silently
  dropped instead of cancelling the session.
- `voxis://error` is a new event (`ERROR_EVENT` / `"voxis://error"`,
  payload `{"kind": "permissionDenied", "message": "..."}`) emitted when
  the desktop OS-level hotkey listener (`rdev::listen`) fails to start
  *after* `set_hotkey`'s own 300ms startup grace window has already
  elapsed (previously such a late failure was only recorded internally
  and could go unnoticed by the host app indefinitely). Hosts that don't
  currently listen for `voxis://error` will see no behavior change; hosts
  that want to react to a hotkey permission being revoked mid-session
  now have an event to listen for.
- `voxis://result`'s emission point moved to *after* the session slot is
  freed and the rec file is deleted (previously emitted before both).
  Fixes a real "start-again-races-slot-not-freed-yet" bug for a
  `voxis://result`-triggered restart, but see F2 for a residual,
  narrower race this reorder itself opens (a second session's `start()`
  can now, in principle, succeed in the small window between the slot
  being freed and the first session's own `voxis://result` firing;
  the payload still carries no session id to disambiguate).
- iOS: `AVAudioEngine` is rebuilt (not just stopped) after a
  `mediaServicesWereResetNotification` — previously the engine instance
  was reused as-is after a media-services reset, which (per Apple's own
  documented behavior for that notification) could leave every
  subsequent recording session on that process permanently failing until
  the whole app restarted. Now only the one session active at reset time
  fails; the next one gets a fresh, valid engine.
- `secrets.json` writes now go through a temp-file-then-rename instead of
  writing the real path directly in place — a crash/kill mid-write can
  no longer leave a half-written `secrets.json` for the next `load()` to
  choke on (previously a truncated write in place, however unlikely,
  would corrupt the file for the next read).
- `src-tauri`'s direct `hound` dependency was removed (dead — no
  `hound::` usage in `src-tauri/src`); WAV support is unaffected, it
  remains available transitively via `rodio`/`voxis-core`. App version
  bumped `0.1.5` -> `0.1.6` in the same commit (`Cargo.lock`/`Cargo.toml`).

## Manual notes

- I could not independently re-run any of the worker's reported test
  suites/clippy/iOS builds in this pass (read/grep-only, no bash/find per
  this review's constraints) — all pass/fail counts in this report's
  "Scope reviewed" line are the worker's own claims, not verified here.
- F1 is the reason for `REJECT-FIX` rather than `APPROVE`: it's a
  concrete, traceable regression (verified by reading `session.rs`'s own
  documented invariant and confirming this diff violates its stated
  premise), not a hypothetical, and it touches a named safety property
  (`[R1-Safety S4]`, Hold-mode mic-safety-on-webview-death). It looks
  narrowly scoped to fix (the `do_start` window specifically) without
  requiring a redo of the rest of the sweep, hence `REJECT-FIX` and not
  `REJECT-REDO`.
