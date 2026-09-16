# BLIND design review — Rust (tauri-plugin-voxis + voxis-core seam)

VERDICT: REFACTOR-FIRST

Scope reviewed in full: `session.rs`, `commands.rs`, `pipeline.rs`,
`capture.rs`, `guard_adapter.rs`, `error.rs`, plus the core seam
(`voxis_core::guard`, `storage::dictionary::apply_entries`,
`profile_source.rs` header + `apply_imported_profile`). The engine seam
is clean; the *session lifecycle* is where the maintenance cost lives.

Direct answer to the brief's framing question — **"session.rs: one state
machine or three overlapping ones?"**: the real state machine (`Stage`:
Recording→Transcribing) is tiny and correct. But bolted onto it are
**three independent deferral/override mechanisms** — `pending:
Option<ControlSignal>`, `stop_waiters` (`StopRequest::Pending`), and the
`cancelled: AtomicBool` — plus two signalling channels (`control_tx`
watch, `transcribe_abort` AbortHandle). All three deferral mechanisms
exist for the *same reason* and would collapse together if that reason
were removed (finding 1). So: one genuine state machine, wrapped in three
parallel patches for one window.

## Top findings

### 1. [KISS/SRP root cause] The `handles == None` window is self-inflicted and spawns ~3 parallel mechanisms
`commands.rs:56-70` (`do_start`), `session.rs:96-176` (`pending`,
`stop_waiters`, `attach_handles`, `request_stop`).

`do_start` calls `sessions.begin()` (claims the single-flight slot),
**then** `spawn_blocking(capture.start)` (an `.await` point), **then**
`pipeline::spawn` + `attach_handles`. That ordering is the only thing
that makes `ActiveSession.handles` observably `None` while the session is
active. Every one of these exists *solely* to survive that window:
- `pending: Option<ControlSignal>` + replay in `attach_handles` (F1/F-NEW)
- `stop_waiters` + `StopRequest::Pending` + the `oneshot` dance (F-NEW / CI 6882)
- half of `trigger_stop`/`request_stop`'s branching
- the F1(a/b), F-NEW(a/b) tests in `commands.rs` (~250 lines) and their
  `BlockingStartCapture` double.

But `SessionHandles` is just channels + `Arc<AtomicBool>` + an empty
abort cell — **none of it needs capture to have started.** Construct the
handles and `attach_handles` *before* `spawn_blocking(capture.start)`,
and have the spawned pipeline task await a "capture ready / capture
failed" signal (or move the `capture.start` call into the task itself).
Then `handles` is never `None` while active → delete `pending`,
`stop_waiters`, `StopRequest`, the pending branch of `request_stop`, and
the four blocking-window tests.
Concrete change: split `spawn` into `make_handles()` (sync, called before
the blocking start) + `run(handles, capture_started_rx)`; attach handles
right after `begin()`. Size: **L** (removes more than it adds).

### 2. [KISS/TDD-honesty] `SessionGuard::signal()` is production-dead, kept alive only for tests, guarded by a load-bearing `.expect()`
`session.rs:436-461`. Verified: the only non-test callers are gone —
production `do_stop`/`do_cancel` use `request_stop`/`request_cancel`
(`commands.rs:81,124`); every remaining `signal()` call site is inside
`#[cfg(test)]` (`pipeline.rs` ×10, `session.rs` ×3). So a ~35-line doc
comment and an `.expect()` panic-safety argument are being maintained for
a method the shipping code never calls. This is exactly the TDD-honesty
smell: an API shape preserved for test convenience, not behaviour.
Concrete change: delete `signal()`; have the tests drive
`request_stop(...)` (they already assert on the returned receiver). Size:
**M**.

### 3. [DRY/KISS] "Is this session cancelled?" is decided at 5+ sites via an out-of-band flag
`pipeline.rs:225-227` (`decide()`'s result overridden by
`already_cancelled`), `pipeline.rs:286-288, 305-307, 353-355` (three more
`cancelled.load()` re-checks in `run_transcription`), plus
`session.rs:trigger_cancel`. `decide()` is supposed to be the single
place that maps a `Trigger` to a `GuardOutcome`, but its answer is
immediately second-guessed by the atomic, and the transcription path
re-polls the same atomic three times because the abort channel isn't
wired yet at those points. This is the AtomicBool-TOCTOU pattern, and it
is a direct symptom of finding 1 (the abort handle is late because the
task is spawned late). If finding 1 lands, `ExternalCancel` reaches the
select loop as a normal `Trigger` before finalize begins, and most of
these re-checks disappear. Absent that, at minimum fold the override into
`decide` (pass `cancelled` in) so there is one decision point, not two.
Size: **M** (S if only consolidating the `decide` override).

### 4. [DRY] Three near-identical blocking test doubles + copy-pasted pipeline setup
`commands.rs` `BlockingStartCapture`, `pipeline.rs` `BlockingStopCapture`,
`pipeline.rs` `BlockingSecretStore` are the same `ready_tx (oneshot) /
release_rx (mpsc)` latch handshake reimplemented three times over three
different trait methods. Separately, ~12 pipeline tests repeat the same
6-line prologue (`mockito::Server::new_with_opts_async{port:0}` → `mock`
→ `rec_file` → `capture.start` → `spawn` → `attach_handles` →
`signal(Stop)` → `drain_outcome`). Real drift risk: the `port:0` /
dedicated-listener fix is pasted with its own comment into each test and
into `profile_source.rs`.
Concrete change: one `BlockingLatch { ready(), release() }` helper used by
a generic wrapping double, and a `spawn_session(deps) -> (id, rx)` test
helper. Size: **M**.

### 5. [SRP] `finalize` is a 90-line function whose correctness rests on a 20-line ordering comment
`pipeline.rs:210-300`. It does: off-thread capture stop + reset-on-fail,
outcome decision, cancel override, transcribe dispatch, Error/Idle state
emission, and a strictly-ordered cleanup (`drop(file)` → `end(id)` →
emit `result` → `send(outcome)`) whose ordering is load-bearing and
explained only in prose. This is fragile-by-design: any reordering during
a future edit silently reintroduces the "result observed before slot
freed" races the comment describes. Concrete change: extract
`finish(result, file, id, sessions, events)` that encapsulates the
mandatory ordering in one place, so the invariant is enforced by
structure, not by a comment a future editor must read. Size: **S/M**.

## Fine as is (checked)
- **Core seam / DRY is genuinely good.** `guard_adapter.rs` is a thin,
  honest adapter over `voxis_core::guard` (`guard_step`, `from_app_config`,
  the `effective_max`/`guard_max` split) — no logic duplicated. Dictionary
  application delegates to `voxis_core::storage::dictionary::apply_entries`
  (`pipeline.rs:361`), not a second regex copy. `profile_source.rs` reuses
  core storage/profile types and funnels all three import transports
  through one `apply_imported_profile`. This is what the split was for.
- **`error.rs`** — single command-facing enum, `From` conversions at the
  boundaries, serde-tagging rationale is correct and tested. No leaky
  layering; mapping happens once per source type.
- **`capture.rs` trait + `RecFile`/`RecDir`.** `AudioCapture` is a real
  seam (mock ships now, cpal/iOS documented) — not a one-impl fake. `watch`
  vs `mpsc` choice is justified (coalescing + doubles as liveness). `RecFile`
  0600-at-`O_CREAT` (not create-then-chmod) is correct; `Drop`-deletes-on-
  every-path is clean. `muted`-as-silence is a single path, not a parallel
  decision branch (`guard_adapter::poll`).
- **TDD honesty is above bar** where I looked: latch-driven deterministic
  races (no sleeps in the F2 A/B tests), assertions check real behaviour
  (outcome/text/file-gone/slot-free), guard tests assert actual stop
  reasons. The mock's self-cap test drives `tick()` with no guard involved
  — a real property, not a mock asserting itself.

## Not covered (budget/scope)
`mobile.rs`, `hotkey_desktop.rs`, `desktop.rs`/`desktop/pure.rs`,
`secrets.rs`, `models.rs`, `consent.rs`, `lease.rs`, `events.rs`,
`lib.rs` (plugin build/hooks), and the bulk of `profile_source.rs`
(beyond header + `apply_imported_profile`). On the core side: only the
`guard`/`dictionary` seam touched by the plugin was verified; `profile/*`,
`transcription/*`, `config/*` internals not reviewed. Findings 1–3 are
the load-bearing ones; a fix to finding 1 is the prerequisite that makes
2 and 3 fall out cheaply, so sequence it first.

«TODO verify» none — all findings confirmed against current source
(`signal()` non-test callers grep'd clean; `handles==None` window traced
through `do_start`→`spawn_blocking`→`attach_handles`).
