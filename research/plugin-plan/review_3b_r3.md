VERDICT: REJECT-FIX

(trivial, test-only fix — two lines to move; the production changes in this round are correct and I'd approve them as-is)

## 1. Tests: deterministic? Do they exercise the two windows?

**Handshake is latch-driven, no sleeps** — `crates/tauri-plugin-voxis/src/pipeline.rs:911-918` (`BlockingStopCapture::stop`) and `:1007-1014` (`BlockingSecretStore::get`): `tokio::sync::oneshot` "ready" signal + `std::sync::mpsc::Receiver::recv()` "release" block on a real OS thread under `flavor = "multi_thread", worker_threads = 2`. `recv()` returns `Err` if the test panics and drops `release_tx`, so no hang on failure. Good.

**Scenario A (`cancel_races_the_guards_own_finalize_scenario_a`, :945-996)** genuinely hits the window: after `ready_rx.await` it asserts `stage_of == Recording` (:975) — i.e. the `select!` loop has already broken out on its own trigger and `finalize` is parked inside `capture.stop()` at `:225`, before `mark_transcribing` (`:257`). `request_cancel` (`session.rs:182-184`) sends `Cancel` into a channel nobody reads any more; only the `cancelled` flag read at `:245` saves it. Asserts `Cancelled`, `text == ""`, `!path.exists()`, `!has_active()`, `expect(0)` via `mock_endpoint.assert_async()`, and the emitted result text. ✔

**Scenario B (`cancel_while_secret_lookup_is_in_flight_scenario_b`, :1035-1085)** genuinely hits the window: stage asserted `Transcribing` and `abort_cell.is_none()` (:1066-1068) while parked in `secrets.get()` at `:317`. `request_cancel`'s `Transcribing` branch (`session.rs:185-188`) finds nothing to abort, only the flag is set. Without the new re-check at `:329-331` execution would build the client and `tokio::spawn` the HTTP call (`:349`) — the later post-`await` check at `:359` would still return `Aborted` but `expect(0)` would fail, so the test discriminates the new check specifically. ✔

**Non-determinism found (the reject):** in both tests the outcome receiver is obtained *after* the release latch:

- `:985 release_tx.send(()).unwrap();` → `:987 let rx = sessions.outcome_receiver(&id).unwrap();`
- `:1074 release_tx.send(()).unwrap();` → `:1076 let rx = sessions.outcome_receiver(&id).unwrap();`

Once released, the pipeline task on the *other* worker thread runs `finalize` through to `sessions.end(&id)` at `:286`, which `guard.take()`s the `Active` (incl. `SessionHandles`) — after that `outcome_receiver` (`session.rs:290-292`) returns `None` and `.unwrap()` panics. The test thread usually wins (a few hundred ns vs. a thread wake + `stop()`/`get()` return + `decide`), but nothing enforces it; under CI load this is a latent `called Option::unwrap() on a None value` flake. Ironically this race is *created* by the (correct) reorder in §2 — in r2, `end` came after the publish so the handles were still there.

**Fix:** move `let rx = sessions.outcome_receiver(&id).unwrap();` to before `release_tx.send(())` in both tests (e.g. right after `assert!(sessions.request_cancel(&id))`). `watch::Receiver` retains the last value, so `drain_outcome` still sees the outcome regardless of ordering. This is what `do_stop` (`commands.rs:73`) already does — it gets the rx from `signal()` before anything can finish.

Everything else in the tests is deterministic: `sink.last(RESULT_EVENT)` (emitted at `:275`, before the outcome publish at `:288`), `!path.exists()` (`drop(file)` at `:287`, before publish), `!has_active()` (`end` at `:286`, before publish).

## 2. `finalize()` reorder — correct for all outcomes?

`pipeline.rs:214-289`. New order: emit `Error?`/`Idle`/`result` events (`:270-276`) → `sessions.end` (`:286`) → `drop(file)` (`:287`) → `outcome_tx.send` (`:288`).

- **`stop()` result == emitted `voxis://result`:** yes. The same `result: Outcome` value is serialised at `:275` (`Ok` arm only) and sent at `:288`; nothing mutates it between. `Err` outcomes emit `State::Error` + `Idle` and no result event, and `do_stop` returns the `Err` — unchanged from r2. All `GuardOutcome` variants flow through the same tail; the reorder is outcome-agnostic.
- **Waiter guarantees strictly improved:** `do_stop`/`do_cancel` (`commands.rs:72-95`) `await_outcome` now resolve only after the slot is free and the WAV deleted, so the doc promise at `commands.rs:85-86` ("cleanup visible immediately after this resolves") is now actually true; in r2 it wasn't.
- **"Slot free before result event"?** No — the reverse. `voxis://result` is emitted at `:275`, *before* `end` at `:286`. So a client reacting to the *event* (rather than `do_stop`'s return) and immediately calling `start()` can, in a ~µs window, still get `AlreadyRecording`. That is the same as r2 and acceptable, but worth a one-line note in the `finalize` comment or `commands.rs` docs: "await `stop()`/`cancel()`'s return, not the `voxis://result` event, before starting the next session." Conversely a new session *cannot* start between `end` and `outcome_tx.send` and steal anything: the previous session's `outcome_tx`/`result` are local to the task, and the new session gets fresh channels from `spawn()`.
- **Double-`end`:** `SessionSlotGuard::drop` (`:118-121`) calls `end` again after the task body returns → `UnknownSession`, ignored (`let _`). Same as r2; benign. `end` is id-checked (`session.rs:237`) so it cannot free a *newer* session that began in the window.
- **Double-drop of file:** `drop(file)` moves `RecFile`; the compiler enforces single drop. `file.path()` at `:259` is borrowed only for the duration of `run_transcription`, which has completed. Fine.
- **`outcome_tx.send` after handles are gone:** `end` drops the `SessionHandles` copy of `outcome_rx`; if no caller cloned an rx, `send` returns `Err` — ignored. Fine (it was equally fire-and-forget in r2).

## 3. `rt-multi-thread` dev-only

`crates/tauri-plugin-voxis/Cargo.toml:43` — production `tokio = { version = "1", features = ["sync", "rt", "macros", "time"] }` unchanged (the r2→r3 delta doesn't touch it). `:57 [dev-dependencies]` → `:71 tokio = { version = "1", features = ["test-util", "rt-multi-thread"] }`. Confirmed dev-only; the comment at `:62-63` correctly notes cargo doesn't fold dev features into the library's own `cargo build`. ✔

## Minors (non-blocking)

- **M1** `pipeline.rs:286-287`: consider swapping to `drop(file)` *then* `sessions.end(&id)`. `do_cancel` (`commands.rs:88-93`) has a path where `request_cancel` succeeds but `outcome_receiver` returns `None` (finalize reached `end` in between) and it returns `Ok` without waiting — at that instant the WAV may not yet be deleted. Making "slot free" imply "file gone" closes that (nanosecond) gap for free and makes the invariant "slot free ⇒ all cleanup done" exact.
- **M2** Document the event-vs-return ordering caveat from §2 (result event precedes slot release) wherever the guest-js/consumer contract for `voxis://result` is described.
- **M3** The pre-`secrets.get()` check at `:313` and the post-check at `:329` are both needed (the file read is async and the secret lookup is sync-blocking); the comment at `:308-312` says "right before actually sending anything" which is now slightly stale — it's the `:329` check that is "right before". Cosmetic.
