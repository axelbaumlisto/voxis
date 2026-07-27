# Voxis — always-on crash diagnostics (port from clipshot)

> **Status: PLAN ONLY — no code written yet.** Written 2026-07-28.
> Session handoff document: read this top-to-bottom and you can execute without
> re-investigating anything.

---

## 0. Why this plan exists (the user's actual question)

The user observed: *"voxis вылетает так же как клипшот"* — voxis crashes the same
way clipshot did. **Investigation confirmed this is true**, and voxis is in a
*worse* position because it cannot record what killed it.

### Shared root
Both apps sit on the **same GUI stack**: Tauri v2 → `tao` → GTK → WebKit2GTK →
amdgpu. In clipshot that stack produced a `gtk::init()` panic, a SIGABRT, and a
SIGKILL. Same stack, same disease class.

### Evidence gathered from this machine (facts, not assumptions)

| observation | how it was verified | meaning |
|---|---|---|
| Latest log stops **mid-operation** (2026-07-26 21:40:20, right after "dropping too-short recording" + overlay hide) | `tail` of newest `~/.config/voxis/logs/voice.log.*` | abrupt death, not an exit |
| **No log in the entire history** records an app shutdown | `grep -il "shutdown\|exiting\|RunEvent::Exit"` over all logs → only 3 hits, all `egui_overlay: event loop is exiting` / "Native overlay thread exiting" (an *old removed overlay backend*, not app exit) | every session ended abruptly |
| All 5 most recent logs end the same way | last-line timestamp == file mtime for each | this is the norm, not a one-off |
| **Zero panics** in any log | `grep -lE "panicked\|stack backtrace"` → empty | death is **not** via Rust panic → it is a signal (the class voxis does not cover) |
| A real `SIGABRT` coredump exists | `coredumpctl list \| grep voice` → 2026-05-13, `/home/sham/work/soupawhisper/src-tauri/target/release/voice` SIGABRT | fatal signals genuinely happen here |
| No `RunEvent::Exit` handler in code | `grep -n "RunEvent" src-tauri/src/lib.rs` → only `RunEvent::Reopen` (macOS dock) | the app **cannot** log a clean exit even in principle |

### Three structural reasons voxis dies blind

1. **`strip = true`** in `[profile.release]` (`src-tauri/Cargo.toml`) erases the
   symbol table → every captured backtrace frame would print `<unknown>`.
   *This is the identical defect fixed in clipshot Task 1.*
2. **`panic = "abort"`** in the same profile. A panic hook DOES exist
   (`src-tauri/src/setup/logging.rs:54`, well-written, captures thread + location
   + `Backtrace::force_capture()`), but `abort` gives it a narrow window and
   `abort` itself raises **SIGABRT — which a panic hook cannot observe**.
3. **Nothing exists for non-panic deaths**: no fatal signal handlers, no
   breadcrumbs, no heartbeat, no clean-shutdown marker, no doctor surface.

### Baseline health (so we know what we must not break)
Measured 2026-07-28 on `main` @ `224cb65`, clean tree:
- Rust: **882 passed**, 2 ignored (`cd src-tauri && cargo test --lib`)
- Frontend: **1886 passed**, 131 files (`bun x vitest run`)
- `cargo clippy --all-targets -- -D warnings`: **clean**
- Production TODO/FIXME count: **2** (both the same `always_on_microphone` gap)
- Rust ~30.9k lines, TS/TSX ~58.3k lines, voxis v0.1.1

---

## 1. Goal & non-goals

**Goal:** an always-on, cross-platform, low-cost diagnostic layer so the *next*
voxis crash produces evidence instead of silence.

**Hard constraints (from the clipshot experience, non-negotiable):**
- Must **not** load the system. No continuous debug logging. clipshot already
  paid for that mistake once: a log storm at 700KB/s and 168K lines.
- Must **not** destabilise the app. A diagnostics failure must never prevent
  startup or affect behaviour.
- Steady-state cost budget: **~26 bytes/sec** (one small heartbeat write per
  10s). Everything else is memory-only until death.

**Non-goals:**
- Catching SIGKILL itself — **impossible by design**, no handler runs. We only
  narrow the blind spot to ≤10s via the heartbeat.
- Fixing the GUI-stack instability. This plan **diagnoses**; the fix comes later,
  driven by the evidence it captures.
- Uploading reports anywhere. Local-only.

---

## 2. What is being ported, and from where

clipshot solved this exact problem on 2026-07-27. **Reuse that design and its
hard-won corrections — do not redesign.**

Source repo: `/home/sham/work/clipshot`, commits `26a9244b..63b43624`:

| commit | task |
|---|---|
| `6f02f804` | Task 1 — restore symbols so backtraces are readable |
| `bf547d6d` | Task 3 — two-tier breadcrumb ring (signal-safe, memory-only) |
| `22fd3e02` | Task 2 — fatal signal handlers + Windows exception filter |
| `3e986057` | Task 4 — heartbeat snapshot, the SIGKILL witness |
| `63b43624` | Task 5 — doctor surfaces the crash evidence |

Modules to read (and largely reuse): `clipshot/src/diagnostics/breadcrumbs.rs`
(623 lines), `fatal.rs` (770), `heartbeat.rs` (708), plus `crash_report.rs` (196)
and `clipshot/docs/superpowers/plans/2026-07-27-always-on-crash-diagnostics.md`.

### DRY across repos — be honest about the limit
These are two separate crates with no shared workspace. A true shared crate is
out of scope. **Port by adaptation**, and record in each ported file's header
that clipshot is the origin, so a future fix in one can be mirrored. Do NOT
copy-paste blindly: voxis differs (see §3 per-task notes).

### The three round-2 defects clipshot hit — do not re-introduce them
Each was found only by *measuring*, never by trusting a worker's self-report:

1. **Breadcrumb ring self-evicted in ~53 seconds.** A single 64-slot ring plus
   periodic writers meant that by the time a crash happened after hours of
   uptime, all startup breadcrumbs were long gone. → Fixed with a **two-tier**
   design: a sticky tier for one-shot milestones (never evicted) + a rolling
   tier for recent activity.
2. **`sigaltstack` is PER-THREAD on Linux.** Installing it once from `main()`
   covered **1 of 63 live threads**; a stack-overflow SIGSEGV on any other
   thread still died silently. → Install on the main thread, on runtime threads
   via `on_thread_start`, and at the top of every thread we spawn, guarded by
   the POSIX query form so pooled threads don't leak a second stack.
3. **"Already reported" state was in-memory.** It reset every process while the
   on-disk condition persisted, so every short-lived CLI invocation re-emitted
   the same warning forever — training the user to ignore it. → Durable
   on-disk record keyed by `pid + wall_ts + process_start_time`.

---

## 3. Tasks

Execution order: **1 → 3 → 2 → 4 → 5** (same as clipshot). Task 1 is
independent and makes every later capture readable. Task 3 produces the payload
Task 2 writes, so it must precede Task 2. Task 4 is standalone. Task 5 reads
everything.

TDD applies throughout: write the failing test first, then the implementation.
Where a thing cannot be unit-tested honestly (signal handlers), say so and use
an env-gated subprocess test — do not fake it.

---

### Task 1 — Restore symbols (and decide the `panic = "abort"` question)

**File:** `src-tauri/Cargo.toml`, `[profile.release]`
Current: `panic = "abort"`, `codegen-units = 1`, `lto = true`, `opt-level = "s"`,
`strip = true`.

**Change:** `strip = true` → `strip = "debuginfo"`.

**Why that exact value — measured in clipshot, do not re-litigate:**

| setting | size | fn names | file:line |
|---|---:|---|---|
| `strip = true` (current) | baseline | ❌ | ❌ |
| **`strip = "debuginfo"`** | **+31.5%** | ✅ | ❌ |
| `strip="none"` + `debug="line-tables-only"` | **+329%** | ✅ | ✅ |

clipshot measured 22.2MB → 95.3MB for the full-DWARF option and rejected it as
disproportionate across shipped artifacts. `debuginfo` keeps `.symtab`, so
`std::backtrace` still resolves **function names** — verified empirically in
clipshot with a standalone probe crate (frames printed
`btprobe::deep_function_marker_xyz`, `btprobe::main`); only `file:line` is lost.
Rationale for accepting that loss: a panic message already carries its location;
what was missing was the **call chain**, which names provide.

**Measure and report** voxis's own before/after size. If growth wildly exceeds
~35%, stop and flag it rather than shipping silently.

**`panic = "abort"` — decide explicitly, document the decision:**
- Keeping it: smaller binary, but no unwinding, and SIGABRT is the death signal
  → **Task 2's SIGABRT handler becomes mandatory**, not optional.
- Changing to `unwind`: the existing panic hook gets a reliable window, at a
  size/perf cost.
- **Recommendation: keep `abort`** (don't change runtime semantics in a
  diagnostics-only change) and rely on Task 2 to catch SIGABRT. Write this
  reasoning into the Cargo.toml comment so it isn't re-debated.

**Tests:**
- A source-inspection guard test pinning `[profile.release]`: reject
  `strip = true` / `"symbols"`, require `"debuginfo"` or `"none"`.
  **Parse the value, skipping comment lines** — clipshot's first substring
  version misfired on its own comment mentioning `strip = true`.
- Optionally a `Backtrace::force_capture()` test asserting frames aren't all
  `<unknown>`. **State honestly** that it runs under the *test* profile and does
  NOT validate the release profile; the real proof is binary inspection
  (`file` → "not stripped", `nm -C … | grep -c voice`).

**Verify:** `cargo build --release` (for the size number), `cargo test --lib`,
`cargo clippy --all-targets -- -D warnings`. Paste real `nm`/`file` output.

---

### Task 3 — In-memory breadcrumb ring (flushed only on death)

**New:** `src-tauri/src/diagnostics/breadcrumbs.rs` + `diagnostics/mod.rs`,
wired into `src-tauri/src/lib.rs`.

Port clipshot's two-tier design: **16 sticky slots** (one-shot milestones,
append-only, saturating, deduped so a repeated event can't consume capacity) +
**64 rolling slots** (recent activity). Reader returns sticky+rolling merged
chronologically.

**Hard requirements (correctness, not style) — Task 2 reads this from inside a
fatal signal handler:**
- **No `Mutex`/`RwLock` in the read path.** A dying process may hold a poisoned
  lock; locking in a handler deadlocks it and destroys the evidence. (clipshot
  hit exactly this: a `PoisonError` crash.)
- **No heap allocation** on write or read. Fixed static slots, `&'static str`
  records (pointer+len atomics), caller-provided output buffer.
- **Never spin/retry.** clipshot used a seqlock where a torn slot is *skipped*
  (`try_read_sequence` → `Option`), so a handler can't hang.
- Merge must be allocation-free (in-place insertion sort over a bounded prefix).

**Instrumentation — coarse lifecycle ONLY.** Aim for ~10–15 sites. Sticky
milestones (startup phases) + rolling (recurring). Voxis-specific candidates:

*Sticky (one-shot):*
- pre/post `tauri::Builder::build()` — the GTK/tao init crash site (clipshot's
  known `gtk::init()` panic phase). `lib.rs` ~line 226.
- `setup::configure_app` entry/exit
- `setup::init_x11_threads` done (Linux X11 — plausibly relevant to amdgpu/GTK)
- first successful transcription
- overlay backend chosen/created

*Rolling (recurring — must be rate-limited):*
- hotkey pressed / released
- recording started / stopped
- transcription queued / completed / failed
- overlay state transitions
- audio device changed

**Rate-limit recurring sites at ≥60s**, not 5s. clipshot's round 1 used 5s and
the ring self-wiped in 53 seconds. Do the arithmetic in the report and prove
startup milestones survive hours of uptime.

**DO NOT instrument** the FFT/audio-level polling loop, per-sample or per-frame
paths — that is the §49 log-storm trap in a new costume. Note voxis logs
`Spectrum [0]: … peak bar …` today, i.e. these hot loops exist and are chatty.

**Tests (pure, no I/O, no sleeping):** wraparound drops oldest; newest-N in
chronological order; capacity bound holds for both tiers; **a sticky milestone
survives a flood of recurring writes far exceeding rolling capacity** (this is
the regression test for defect #1); multi-thread writes don't corrupt slots;
reading an empty ring is safe.

**Verify:** `cargo test --lib breadcrumb`, `cargo clippy --all-targets -- -D warnings`.

---

### Task 2 — Fatal signal handlers + Windows exception filter

**New:** `src-tauri/src/diagnostics/fatal.rs`. Install from `lib.rs::run()`
**immediately after `setup::init_logging()`** (line ~192) so the crash-log path
and logging exist, and before the Tauri builder runs.

**Unix:** `sigaction` for `SIGSEGV`, `SIGABRT`, `SIGBUS`, `SIGILL` with
`SA_SIGINFO | SA_ONSTACK`, plus `sigaltstack`.
**`SIGABRT` matters most here** because `panic = "abort"` means panics become
SIGABRT.
**Windows:** `SetUnhandledExceptionFilter` returning `EXCEPTION_CONTINUE_SEARCH`
(never claim the exception).

**Handler contract — async-signal-safety is mandatory:**
- No allocation, no `format!`, no `String`/`Vec`, no `println!`, no
  `File::create` **inside the handler**.
- Pre-open the crash-log fd **at install**; store in a static (`AtomicI32` fd /
  `AtomicIsize` HANDLE). Write with raw `libc::write` / `WriteFile`.
- Pre-allocate all buffers; convert integers to ASCII by hand.
- Write: signal number, timestamp, app version, and the Task-3 breadcrumbs.
- **Re-raise**: reset to `SIG_DFL` then `raise(sig)` so the OS still produces a
  coredump. Never swallow a fatal signal.
- Reentrancy guard (`AtomicBool` swap) so a second fatal signal can't recurse.

**Per-thread altstack (defect #2 — the expensive lesson):** `sigaltstack` is
per-thread on Linux. Install for the main thread, for any tokio/runtime threads
via `on_thread_start`, and at the top of threads voxis spawns. voxis has many:
audio recorder/stream threads, hotkey listener (rdev), orchestrator coordinator,
audio-level/FFT polling, overlay thread, writer/health threads. Guard with the
POSIX query form (`sigaltstack(NULL, &old)`) so reused threads don't leak
another 64KB stack. clipshot's cost: 63 threads × 64KB = 3.9MB = 2.3% of RSS.

**Honesty requirement:** threads created *inside* third-party libs (tao/GTK/
WebKit, rdev internals, cpal internals) cannot be reached — stack-overflow
SIGSEGV there may still die silently. **Ordinary SIGSEGV/SIGABRT are
process-wide and ARE caught on every thread** (an altstack is only needed for
stack exhaustion). Document this precisely; do not overstate coverage.

**Install failure must be observable, never fatal:** record the error in static
atomics readable later (`last_install_error()`) for Task 5. It must work before
logging is fully up. A diagnostics failure must not block startup.

**Windows gotcha already solved in clipshot — copy the fix, don't rediscover:**
`windows-sys` needs feature **`Win32_System_Kernel`** for
`SetUnhandledExceptionFilter` / `EXCEPTION_POINTERS` /
`LPTOP_LEVEL_EXCEPTION_FILTER`, and **`Win32_System_IO`** for `WriteFile`.
Also: the filter takes `*const EXCEPTION_POINTERS` (not `*mut`);
`ExceptionRecord.ExceptionCode` is `i32` — **cast the bit pattern, do not use
`try_into().unwrap()`** (real STATUS_* codes are negative and would panic inside
a crash handler); `WriteFile` takes `*const u8`, not `*const c_void`.
**Check whether voxis even depends on `windows-sys`**; if not, either add it
Windows-only or scope Task 2 to Unix and say so explicitly.

**Tests:** unit-test the pure helpers (integer→ASCII incl. 0 and large values,
buffer assembly/truncation, report contains signal + version + breadcrumbs).
End-to-end: an **env-gated** subprocess test that raises SIGABRT and asserts a
report lands on disk — must be skipped by default (a test that kills the runner
is unacceptable). clipshot's equivalent was run manually and passed.

**Verify:** `cargo test --lib fatal`, `cargo clippy --all-targets -- -D warnings`,
plus the gated e2e run once by hand.

---

### Task 4 — Heartbeat snapshot (the only always-on writer; the SIGKILL witness)

**New:** `src-tauri/src/diagnostics/heartbeat.rs`.

Every **10s** atomically write ~200–260 bytes to
`<config>/diagnostics/heartbeat.json`:
`{ pid, version, monotonic_uptime_s, wall_ts, process_start_unix_s, last_breadcrumb, rss_kb, … }`

Voxis-specific state worth including (reuse existing sources, invent none):
recording state / orchestrator queue depth, last transcription outcome, overlay
backend in use. Pull from existing structs; if a value is expensive, emit null.

**Requirements:**
- **Atomic write** (`NamedTempFile::new_in(parent)` + `persist`) so a kill
  mid-write cannot leave a corrupt file (Windows/EXDEV-safe form).
- Single fixed file, overwritten in place. No rotation, no growth.
- Dedicated sleeping thread; **must never block** the app. Install its own
  Task-2 altstack. Failures are best-effort/debug-logged only.
- **Startup stale detection:** heartbeat exists + pid not alive + no valid
  clean-shutdown marker → log exactly **one** WARN with the captured last state.
- **Clean-shutdown marker** so a normal restart never produces a false "died"
  warning. Guards that clipshot proved necessary: remove the marker when the
  writer starts, and require `marker.pid == snapshot.pid` **and** marker
  ordered after the snapshot.
- **Durable "already reported" record** (defect #3): after warning, persist
  `heartbeat.crashed.json` keyed by `pid + wall_ts + process_start_unix_s`.
  Same death → reported once; a genuinely new death → still reported.
  **Do not delete the evidence** — Task 5 must still read it.
- **pid liveness:** `kill(pid, 0)` plus a Linux `/proc/<pid>/stat` start-time
  comparison to catch PID reuse. Document the residual same-second window
  honestly instead of pretending it's exact.

**Voxis has a real wiring gap to close here:** there is **no `RunEvent::Exit`
handler**. The `app.run(...)` closure in `lib.rs` (~line 233) currently handles
only `RunEvent::Reopen` (macOS). Add an `Exit`/`ExitRequested` arm that writes
the clean marker. Also cover `setup::handle_window_event` close paths and any
tray-quit path. **This also fixes a pre-existing observability hole**: today
voxis cannot log its own shutdown at all.

**Tests (pure decision core, no disk/sleep):** dead pid + no marker → "died
uncleanly"; valid marker → no warning (false-positive guard); live pid → no
warning; same death suppressed across two independent checks; a *new* death
still reported; missing/corrupt/empty heartbeat handled gracefully (first run or
older build) without panicking; atomic replacement leaves no partial file.

**Verify:** `cargo test --lib heartbeat`, `cargo clippy --all-targets -- -D warnings`.

---

### Task 5 — Surface the evidence where a user will actually look

Voxis has **no `doctor` CLI** (unlike clipshot), but it *does* have
`src-tauri/src/commands/diagnostics.rs` (291 lines) with an **Export
Diagnostics** button already shipped. **That is the natural surface — reuse it
(DRY), don't invent a parallel one.**

Add to the exported bundle / a new queryable command:
- last crash report (when + panic/signal summary)
- whether the previous run ended uncleanly, with the captured last state
- heartbeat freshness
- whether fatal-handler install **failed** (Task 2's `last_install_error()`) —
  if install failed we are blind and must say so

Consider also a small status line in Settings UI when the previous run died
uncleanly, so it is visible without exporting.

**Verdict matrix (mirror clipshot's, adapted):**
- clean history + no unclean exit + handlers installed → OK, with wording that
  does **not** overclaim
- previous run ended uncleanly → warn naming the captured state
- ≥3 crashes within 600s → warn naming the count (a crash loop is materially
  worse than one crash); justify the threshold
- install failure → warn "crash diagnostics unavailable: …"
- old crash report → informational, not alarming
- files missing entirely (fresh install / pre-feature build) → informational,
  **never** an error

**Honest wording is required.** clipshot shipped:
`"no crashes recorded (local evidence only; SIGKILL and some third-party-thread
stack overflows can be missed)"`. Do not promise nothing was missed.

**Redaction check:** `diagnostics.rs` already has `is_secret_key` /
`build_config_summary` for scrubbing. Breadcrumbs are `&'static str` literals so
they carry no user data by construction — **state that explicitly**, and make
sure heartbeat fields add no transcription text, file paths with usernames, or
API keys.

**Tests:** verdict matrix per row over injected inputs (pure fn, no disk);
crash-loop threshold boundary (just below → not warn; at/above → warn); missing
files → informational; malformed crash log / heartbeat JSON → no panic; nothing
secret leaks into the export.

**Verify:** `cargo test --lib diagnostics`, `cargo test --lib doctor` (if named
so), `cargo clippy --all-targets -- -D warnings`, plus frontend tests if UI changed.

---

## 4. SOLID / DRY / KISS / TDD notes

- **SRP:** one module per concern — `breadcrumbs` (what happened),
  `fatal` (signal capture), `heartbeat` (liveness witness), Task-5 reporting
  (presentation). No module reaches into another's internals; they compose via
  small public APIs.
- **Dependency direction:** `fatal` depends on `breadcrumbs`' read API only.
  Task 5 depends on all three via public accessors. Nothing depends on Task 5.
- **Pure core / imperative shell:** every verdict and formatting decision is a
  pure function over injected inputs (staleness verdict, warning decision,
  report assembly, doctor matrix). I/O, timers and signals live in thin
  wrappers. This is what makes TDD possible without sleeping or touching disk.
- **DRY:** reuse voxis's existing config-dir helpers (`AppPaths`), existing
  panic hook (do not duplicate it), existing diagnostics export + its redaction
  helpers. Across repos, DRY is limited to *documented adaptation* — note
  clipshot as origin in each file header.
- **KISS:** memory-only until death; exactly one always-on writer at ~26 B/s;
  no rotation, no history, no uploads, no user-facing debug mode (that is the
  §49 log-storm trap).
- **TDD:** RED → GREEN per task. Prove RED for the guard tests (e.g. temporarily
  set `strip = true` and watch the guard fail). For signal handlers, the honest
  test is a gated subprocess run — say plainly that unit tests can't cover a
  handler body.

---

## 5. Risks / honest limitations

- **SIGKILL stays uncatchable.** Task 4 narrows the blind spot to ≤10s; it does
  not eliminate it.
- **Binary grows ~31%.** Must be measured and reported for voxis specifically,
  not assumed from clipshot's numbers.
- **Signal handlers are genuinely dangerous.** An unsafe handler can hang a
  dying process and destroy the very evidence we want. The safety rules in
  Task 2 are mandatory, not advisory.
- **Third-party threads remain a gap** for stack-overflow SIGSEGV.
- **`panic = "abort"` interaction** must be decided consciously in Task 1.
- **This plan diagnoses; it does not fix.** The actual GUI-stack instability
  (tao/GTK/WebKit/amdgpu) gets fixed in a *follow-up*, driven by the first real
  captured backtrace.
- Diagnostics only take effect **after a rebuild and deploy**. Until then the
  next crash is still lost.

---

## 6. Execution guide (how to run this)

Use the `ado` skill: orchestrator-only, worker → fresh-context reviewer →
commit checkpoint per step.

```
Order:  Task 1 → Task 3 → Task 2 → Task 4 → Task 5
Model:  airpx/gpt-5.5   (provider `o/` was REMOVED upstream — do not use it)
```

**Per-step worker instructions that proved necessary in clipshot:**
- "Do NOT run `cargo fmt`" (it reformats unrelated files → scope violation).
- `cargo test` takes **one** testname filter — separate invocations, never
  `cargo test --lib a b c`.
- "After your FINAL verification command do NOT run a further rebuilding cargo
  command; leave edits in place" — a later cargo run can revert uncommitted
  worker edits.
- Reviewers must run clippy too; the orchestrator should also run the gates
  itself before accepting.

**Verify each task (voxis-specific commands):**
```bash
cd src-tauri && cargo test --lib                      # baseline 882 must not regress
cd src-tauri && cargo clippy --all-targets -- -D warnings
bun x vitest run                                      # baseline 1886 (only if frontend touched)
cd src-tauri && cargo build --release                  # Task 1 size measurement
```

**Orchestrator discipline that caught all three clipshot defects: verify claims
by measuring, not by reading the worker's report.** Count the threads. Do the
eviction arithmetic. Check whether state is in-memory or on disk. Every one of
those defects looked fine in a convincing report.

**Commit message gotcha:** backticks in `git commit -m` are executed by the
shell (this actually spawned a stray process during the clipshot session). Use
`git commit -F -` with a heredoc for messages containing backticks or pipes.

---

## 7. Definition of done

- [ ] Release binary is `not stripped`; `nm -C … | grep -c voice` > 0; size delta measured and reported
- [ ] `panic = "abort"` decision documented in `Cargo.toml`
- [ ] Breadcrumbs: two-tier, signal-safe, ~10–15 coarse sites, no hot-path instrumentation; retention arithmetic proves startup milestones survive hours
- [ ] Fatal handlers installed for SEGV/ABRT/BUS/ILL (+ Windows filter or an explicit Unix-only scope statement); re-raise preserves coredumps; per-thread altstack incl. spawned threads; install failure observable
- [ ] Heartbeat writing ~26 B/s atomically; unclean-death warning fires exactly once per death; clean marker written on **all** real exit paths incl. the new `RunEvent::Exit`
- [ ] Evidence visible via Export Diagnostics (and ideally a Settings notice), with non-overclaiming wording and no secret leakage
- [ ] `cargo test --lib` ≥ 882 + new tests, all passing; `bun x vitest run` still 1886 if UI untouched; clippy `-D warnings` clean
- [ ] Every honest limitation from §5 written into code comments/docs, not just this plan

---

## 8. Session handoff — state as of 2026-07-28

**Nothing has been implemented yet. This document is the only artifact.**
Repo `main` @ `224cb65`, clean tree, all baselines green (§0).

**What I did in this session (investigation only, zero code changes):**
1. Surveyed voxis: structure, CLAUDE.md, 882 Rust + 1886 frontend tests green,
   clippy clean, only 2 production TODOs.
2. Confirmed the user's hypothesis that voxis crashes like clipshot — evidence
   table in §0 (abrupt log truncation, no shutdown ever logged, zero panics,
   real SIGABRT coredump, no `RunEvent::Exit` handler).
3. Identified the three structural blind spots (`strip = true`,
   `panic = "abort"` + SIGABRT unobservable by a panic hook, nothing for
   non-panic deaths).
4. Located every integration point needed (§3) so execution needs no
   re-investigation: `lib.rs:192` (`init_logging` — install site), `lib.rs:226`
   (Builder::build — the GTK init crash phase), `lib.rs:233` (`app.run` closure
   — where `RunEvent::Exit` must be added), `setup::handle_window_event`,
   `commands/diagnostics.rs` (Task 5 surface, already has redaction helpers).
5. Cross-referenced clipshot's five commits and its three round-2 defects so
   they are not repeated.

**Also worth knowing (found while surveying, unrelated to crashes):**
`always_on_microphone` is a **dead toggle on Linux/Windows** — visible in
Settings, persisted to SQLite, but never read by the audio path
(`src-tauri/src/config/mod.rs:383` documents the TODO; `grep always_on` in
`src-tauri/src/audio/` is empty). It works on macOS only. The UI promises
removal of cold-start delay and delivers nothing on this machine's platform.
Two options: implement the cpal keep-warm path, or mark it macOS-only until
implemented. Recommend the honest label first. **Not part of this plan.**

**Next action:** run Task 1 via `ado` with model `airpx/gpt-5.5`.
