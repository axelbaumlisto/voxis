VERDICT: APPROVE

Fresh round-2 review of the `tauri-plugin-voxis` skeleton (diff vs 851cd0c, `/tmp/ado.C4YWdv/diff_3_r2.patch`). Read-only; no builds run (orchestrator pre-verified: workspace 1137/0, clippy -D warnings clean, `aarch64-apple-ios` build green, scope clean). All four round-1 REJECT-FIX items are FIXED; only new minor nits found, so per anti-ping-pong rule → APPROVE.

## Round-1 checklist

### F1 — rec dir under host CACHE dir, secrets/consent under config, no silent "." fallback, sweep errors warned — **FIXED**
- `src/lib.rs:129-130`: `let config_dir = app.path().app_config_dir()?; let cache_dir = app.path().app_cache_dir()?;` — both propagate through plugin `setup` via `?`; no `unwrap_or_else(|_| ".".into())` remains anywhere in the crate.
- `src/lib.rs:88-98` (`PluginState::new(config_dir, cache_dir, …)`): consent at `<config>/voxis-plugin/consent.json`; `RecDir::new(cache_dir)`.
- `src/lib.rs:132-133`: `FileSecretStore::new(config_dir.join(PLUGIN_DIR_NAME).join("secrets.json"))` — secrets under config.
- `src/capture.rs:80-81`: `RecDir::new(base)` → `base.join("voxis-plugin").join("rec")`, so rec dir = `<cache>/voxis-plugin/rec/`.
- `src/lib.rs:144-146`: `if let Err(e) = state.rec_dir.sweep() { tracing::warn!(error = %e, …) }` — sweep failure is warned, plugin still loads (reasonable best-effort).
- Nit (see Minors): inside `sweep()` itself, per-file `let _ = fs::remove_file(&path)` at `src/capture.rs:98` still swallows individual unlink failures; only `read_dir`/`create_dir_all` errors reach the warn.

### F2 — `SecretStore` trait uses `voxis_core::profile::Secret`; `.expose()` only at JSON boundary; no value logging — **FIXED**
- `src/secrets.rs:18`: `use voxis_core::profile::Secret;`
- `src/secrets.rs:33-37`: `fn get(&self, name) -> SecretResult<Option<Secret>>`, `fn set(&self, name, value: &Secret)`, `fn delete`.
- `src/secrets.rs:132-139`: `FileSecretStore::get` wraps via `.map(Secret::new)`; `set` calls `value.expose().to_string()` exactly once, at the map→JSON serialization boundary.
- Whole-crate grep for `expose()`: only `secrets.rs:138` (production) plus three test assertions (`secrets.rs:158,171,176`). No `{:?}` on secrets, no `tracing` of values; `FileSecretStore::new`'s warn logs only `path`. `Secret`'s `Debug` is `Secret([REDACTED])` (`crates/voxis-core/src/profile/secret.rs:35-37`), so even the `assert_eq!(…, None)` on `Option<Secret>` in tests can't leak.
- `commands.rs`/`consent.rs` never touch secret values (`consent.rs:121` test `consent_json_never_contains_a_secret_value`).

### F3 — files created with `OpenOptions…mode(0o600)` on unix, no create-then-chmod window — **FIXED**
- `src/secrets.rs:112-122` (`FileSecretStore::save`): `OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(&self.path)?` under `#[cfg(unix)]`, `fs::write` fallback for non-unix. Test `file_secret_store_file_is_0600_on_unix` (`secrets.rs:180-192`) asserts `mode & 0o777 == 0o600`.
- `src/capture.rs:133-147` (`RecFile::create`): same `OpenOptions…mode(0o600)` pattern under `#[cfg(unix)]`, `File::create` on non-unix. No `set_permissions` call remains in the crate (grep clean).

### F4 — `commands_snapshot_matches_fixture` parses `build.rs` COMMANDS and asserts `allow-<kebab>` in `default.toml` — **FIXED**
- `src/models.rs:216-222` `build_rs_commands()`: `include_str!("../build.rs")`, slices from `const COMMANDS` to `];`, extracts quoted strings.
- `src/models.rs:241-245`: `assert_eq!(build_rs_commands(), fixture_commands, …)` (exact list + order).
- `src/models.rs:247-256`: `include_str!("../permissions/default.toml")`; for each fixture command asserts `default_toml.contains("\"allow-{cmd.replace('_', "-")}\"")`.
- Cross-checked by eye: `build.rs:13-25` COMMANDS (11) == `contract/fixtures/commands.json` (11, same order) == `permissions/default.toml:14-26` allow-list (11 kebab-case entries). `generate_handler!` in `lib.rs:112-124` lists the same eleven.

### Minors claimed
- tokio trimmed to `["sync"]`: **FIXED** — `Cargo.toml:41` `tokio = { version = "1", features = ["sync"] }` with rationale comment.
- New test `start_rolls_back_session_slot_when_capture_backend_fails`: **PRESENT** — `src/commands.rs:236-258`; pre-occupies `MockCapture` out-of-band so `capture.start()` fails after the slot is claimed, then asserts `Err(PluginError::Capture{..})`, `!sessions.has_active()`, and `rec_dir` is empty (RecFile deleted). Exercises the real rollback branch.
- Root `Cargo.toml:10` members line adds `crates/tauri-plugin-voxis` only — scope as described.

## New findings
None blocking. The skeleton shape approved in round 1 (plugin builder + 11 commands, permissions, single-flight `SessionGuard`, consent gate, `RecFile` Drop-cleanup, `MockCapture`) is unchanged by these fixes.

## Minors
1. `src/capture.rs:98` — `sweep()` ignores per-file `remove_file` errors (`let _ =`). If an orphan WAV can't be unlinked (permissions/locked), the startup warn in `lib.rs:144` won't fire. Suggest collecting the first error and returning it (or `tracing::warn!` per file) so `[R1-Safety S5]` orphan detection is actually observable. Cheap follow-up; not a blocker for a skeleton.
2. `src/secrets.rs:112-122` — `mode(0o600)` applies only at `O_CREAT`; a pre-existing `secrets.json` with wider perms (e.g. from a previous build) is not tightened. Fine for a brand-new file format; if desired add a one-time `set_permissions` when the file already exists (no window concern in that case since it already exists).
3. `src/secrets.rs:save` — truncate-then-write (not write-temp-then-rename); a crash mid-write loses all stored keys. Acceptable for a stated temporary desktop fallback pending `keyring` (documented at module top); noting for the Task 4/8 follow-up.
4. `src/models.rs:216-222` — `build_rs_commands()` string-slicing parser would silently pick up any quoted string between `const COMMANDS` and the first `];` (e.g. a future comment containing `"`). Currently safe (the block is comment-free); a stricter approach is to move COMMANDS to a shared `commands.txt` `include_str!`'d by both `build.rs` and the test. Nit only.
