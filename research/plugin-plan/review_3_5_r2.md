# Task 3.5 (desktop tracer bullet) — Round-2 Review

VERDICT: APPROVE (with minors) — all five round-1 REJECT-FIX items verified FIXED in source; human-gate prep present and wired correctly; only new nits.

Scope/method: read-only inspection of the round-2 diff's key files (smoke script, bundle-overlay.sh, host-min main.rs, ui/main.js, README, ci.yml, .gitignore) plus the plugin's `do_set_hotkey`/`PluginError` serde to confirm the `permissionDenied` catch is reachable. No cargo/bun runs (orchestrator pre-verified: smoke 3/3 PASS, 0 orphans, fake-stt 13/0, clippy clean, lib tests green).

## Round-1 checklist

### F1 (HIGH) — leaked fake-stt servers: **FIXED**
- `crates/tauri-plugin-voxis/examples/host-min/scripts/host-min-smoke.sh:57-59` — `fake_stt_pid`, `fake_stt_port`, `host_min_pid` declared as script-level globals.
- `:73-84` — `start_fake_stt` is a plain function: `fake_stt_pid=$!` (line 75) sets the global; `fake_stt_port` is parsed from the log via `sed` **after** startup (line 83), not echoed.
- `:91` — call site is `start_fake_stt` (bare). Grep of the whole file confirms **no remaining `$(start_fake_stt)`** anywhere.
- `:61-71` — `cleanup()` kills `host_min_pid`, `fake_stt_pid`, `wait`s, then `pkill -P $$ 2>/dev/null || true` as belt-and-braces. `:72` — `trap cleanup EXIT INT TERM`.
- Failure paths: script is `set -euo pipefail` (line 34); every `FAIL […]; exit 1` (lines 120, 126, 131, 137) and `start_fake_stt`'s own `exit 1` (line 82) go through the `EXIT` trap, so cleanup runs on failure as well as success. Per-scenario the script also kills+waits both PIDs and blanks the globals (lines 104-109) before the next scenario, so no PID is overwritten while alive.

### F2 (MEDIUM) — speech never asserted guardOutcome / only StreamDied: **FIXED**
- `src-tauri/src/main.rs:181` — `VOXIS_SMOKE_NO_STOP` read; `:218-223` — `stop_after_ms = script_len * WINDOW_MS(250) + 500` unless no-stop; `:230-243` — after `start()`, sleeps `delay_ms` then calls `commands::stop`, printing `SMOKE_STOPPED` / `SMOKE_STOP_ERROR` (already-ended-session case documented as harmless).
- `host-min-smoke.sh:128-131` — new hard assertion `"guardOutcome":"$expect_guard_outcome"` on the last `RESULT_EVENT` line, for every scenario.
- `:141` speech → expects transcript text **and** `finalized`, 1 request.
- `:143` third scenario `speech-streamdied` with `VOXIS_SMOKE_NO_STOP=1` (passed via `env $extra_env`, line 94) → expects transcript text **and** `streamDied`, 1 request. Liveness path stays covered.
- Note: `env $extra_env` with an empty `extra_env` expands to nothing under `set -u` because it is `${6:-}` defaulted — fine.

### F3 — silence asserts empty text: **FIXED**
- `host-min-smoke.sh:142` — `run_scenario "silence" "silence.wav" "\"text\":\"\"" "0" "silenceTimeoutNoSpeech"`; the `expect_grep` (`"text":""`) is asserted at `:124-127`, guardOutcome at `:128-131`, 0 requests at `:133-138`.

### F4 — ui/vendor gitignored + bundle before build in BOTH places: **FIXED**
- `.gitignore:103` — `crates/tauri-plugin-voxis/examples/host-min/ui/vendor/`.
- `scripts/bundle-overlay.sh:40` — `(cd "$guest_js_dir" && bun install --frozen-lockfile && bun run build)`; `:42-45` fails if `dist/index.js` missing; `:48` `bun build … --outfile=ui/vendor/voxis-overlay.bundle.js --format=esm --target=browser`. (It bundles rather than "copies dist" — that's the correct thing given the extensionless-import/CSP rationale in the header; the task description's "copies dist" is just loose wording.)
- Ordering, smoke script: `host-min-smoke.sh:40-41` runs `bundle-overlay.sh`, **then** `:43-44` `cargo build -p voxis-fake-stt -p host-min`. ✔
- Ordering, CI: `.forgejo/workflows/ci.yml:96-105` — `host-min-e2e` job runs `cargo test -p voxis-fake-stt` then `xvfb-run -a bash …/host-min-smoke.sh`; there is no separate `cargo build -p host-min` before it, so the bundle step inside the script precedes the build. ✔
- bun availability in CI: `host-min-e2e` (`ci.yml:63-95`) uses the identical `docker run … voxis-ci:latest` invocation as the `fast` job (`:29-42`), which runs `bun install --frozen-lockfile && bun run build` (`:43`) and `bun run test:run` (`:52`) inside the same image. ✔

### F5 — docs "one session per process" + watch coalescing comment: **FIXED**
- `main.rs:121-131` — doc comment on `scripted_mock_capture`: "**One session per process**", explains `VecDeque` drained by `tick()` and never refilled, and why a second start/stop cycle would look like StreamDied.
- `main.rs:142-155` — inline comment on the ticker thread: `level_rx` is a `tokio::sync::watch` (coalescing), descheduled polls only observe the latest sample, so `script_len * WINDOW_MS` is approximate.

### Human-gate prep: **PRESENT & CORRECT**
- `ui/main.js:65-72` — `client.setHotkey({ key: "alt_r", mode: "hold" })` at startup; `.catch` branches on `e.kind === "permissionDenied"` and writes a visible hint into a new `#hotkey-hint` `<p>` (`:62-64`), otherwise dumps the error JSON.
- Reachability verified: `src/error.rs:11` `#[serde(tag = "kind", rename_all = "camelCase")]` → `PermissionDenied` serializes as `kind: "permissionDenied"`; `src/hotkey_desktop.rs:264,280` produce it; `src/commands.rs:184-193` `do_set_hotkey` is a no-op `Ok(())` when `state.hotkey` is `None` (mock/`init()` paths), so the unconditional call is safe in all smoke scenarios as claimed.
- `README.md:216-244` — HUMAN GATE command uses `VOXIS_SILENCE_TIMEOUT_MS=7000`; "Silence-timeout math" paragraph: `SILENCE_WINDOW_MS`=10 s + timeout → default 3000 ≈ 13 s (inside 17 s fixture), gate 7000 → ≈ 17 s. Also documents the alt_r hotkey behavior and the permissionDenied hint (`:226-232`). Env var section `:61-66` cross-references the 17 s gate.

## New findings
None blocking. Nothing in the round-2 changes introduces new correctness or security concerns; the shell fixes are idiomatic and the Rust changes are confined to the example binary.

## Minors
1. `host-min-smoke.sh:94` — `env $extra_env` relies on word-splitting; fine for the single `VAR=1` token used today, but would break for values containing spaces. Consider `local -a extra=(); [ -n "$extra_env" ] && extra=($extra_env); env "${extra[@]}" …` or passing extra env as an array if a future scenario needs it. Not worth another round.
2. `host-min-smoke.sh:113-116` — logs are `cat`-ed unconditionally per scenario (host-min log includes every `STATE_EVENT`). Fine for a 3-scenario smoke; if CI logs get noisy, gate the full dump behind failure or `VOXIS_SMOKE_VERBOSE`.
3. `host-min-smoke.sh:98,111` — the 30 s `RESULT_EVENT` deadline is comfortably above the silence scenario's ~13 s, but the README/comments quote "~17.5 s" for the scheduled stop on silence.wav (68 windows × 250 ms + 500 ms). Both fit; just noting the margin on a loaded xvfb runner is ~12 s, adequate.
4. `main.rs:230-244` — `SMOKE_STOP_ERROR` on the silence path is expected and documented, but the smoke script doesn't assert its presence/absence; acceptable (it's not part of the contract), mentioned only so nobody later "fixes" it by asserting on it.
5. Task-prompt wording says bundle-overlay.sh "copies dist"; the script actually re-bundles via `bun build` into a single ESM file (correct per the CSP/extensionless-import rationale). Docs in the script header and README already say so — no change needed.
