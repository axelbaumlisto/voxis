# Task 6 Round-2 Review (fresh reviewer)

VERDICT: APPROVE (all three round-1 REJECT-FIX items FIXED; only new non-blocking nits)

Basis: read-only review of `/tmp/ado.C4YWdv/diff_6_r2.patch` (vs 93774c6) plus one lookup in the vendored `rusqlite-0.32.1` source. Pre-verified facts accepted as given (plugin 109/0, core storage 193/0, clippy clean, iOS build green, guest-js 186/186, scope clean). No cargo/bun runs.

## Round-1 checklist

### F1 (HIGH, wire break) — FIXED
- `crates/tauri-plugin-voxis/guest-js/src/client.ts:59` — interface now `importProfileFromQr(payload: string, code: string)`.
- `client.ts:121-122` — invokes `pluginCommand("import_profile_from_qr")` with `{ payload, code }`. Matches Rust `commands.rs:179-185` `import_profile_from_qr(state, payload: String, code: String)` (Tauri arg names = Rust param names, camelCase-identical here).
- `guest-js/src/types/contract.ts:97-106` — `ImportSummary` now `source: string`, `dictionaryEntries`, `llmProviders`, `llmPrompts`, `hasApiKey: boolean`, `theme`, `hotkey: string`. Exact camelCase mirror of `models.rs:180-192` (`#[serde(rename_all = "camelCase")]`), and the Rust serde test `models.rs:378-399` asserts the same JSON keys (`source`, `hasApiKey`, `hotkey`).
- `guest-js/__tests__/client.test.ts:45-73` — new test asserts exact invoke args `{ cmd: "plugin:voxis|import_profile_from_qr", args: { payload: "qr-payload-json", code: "123456" } }`; plus `import_profile_from_desktop` with `args: undefined`.

### F2 (MEDIUM, busy_timeout tests) — FIXED
- `crates/voxis-core/src/storage/sqlite_base.rs` test `open_read_only_waits_out_a_writers_exclusive_lock_within_the_busy_timeout` (~L411-441): writer does `BEGIN EXCLUSIVE` + UPDATE, holds 200 ms in a thread, then COMMIT; reader goes through `open_read_only` and `query_row`; asserts `elapsed >= 150ms` AND value `"mid-write"` (post-commit state). Genuinely blocking — EXCLUSIVE denies SHARED readers, unlike the old `BEGIN IMMEDIATE` shape.
- Negative control `read_only_connection_with_zero_busy_timeout_fails_fast_under_the_same_contention` (~L452-483): identical `BEGIN EXCLUSIVE` writer, reader opened with the same flags but `busy_timeout(Duration::ZERO)`, asserts `ErrorCode::DatabaseBusy`. Writer is committed/dropped before the match so a failing assert can't leak a lock.
- No tautological `released` assert remains in the core tests.
- **Judgement on `Duration::ZERO` as negative control: legitimate and, in fact, the only correct choice.** Verified: `rusqlite-0.32.1/src/inner_connection.rs:119` calls `ffi::sqlite3_busy_timeout(db, 5000)` on every connection open. So "skip the call" would still wait up to 5 s (rusqlite's default, not SQLite's — SQLite's own default is 0), making that variant slow and non-diagnostic. `busy_timeout(ZERO)` exercises the exact "give up immediately" path deterministically. The worker's empirical observation is explained by rusqlite, not the bundled SQLite; see Minors for the resulting doc inaccuracy.

### F3 (MEDIUM, SSRF in build_qr_url) — FIXED
- `crates/tauri-plugin-voxis/src/profile_source.rs` `build_qr_url` (~L347-368): `qr.host.parse::<Ipv4Addr>()` rejects hostnames and `user@host`; token validated `!empty && len<=64 && all(ascii_alphanumeric | '_' | '-')`; base URL parsed with `reqwest::Url::parse`, token attached via `query_pairs_mut().append_pair("token", ..)` (no string interpolation of the token).
- `fetch_sealed_profile` (~L381-388): `Client::builder().timeout(10s).no_proxy().redirect(Policy::none())`. 410 → distinct message; other non-2xx → error naming the status; token/k never echoed in messages.
- Tests: hostname (`desktop.local`), userinfo injection (`user@evil.example`), token set `["tok&extra=1", "tok#fragment", "tok token", ""]`, and `import_from_qr_does_not_follow_a_redirect` — mockito 302 with `Location` to a second mock that has `.expect(0)` and is `assert_async()`'d after the call, so a followed redirect would fail the test observably. 
- `Cargo.toml`: `reqwest = { version = "0.12", default-features = false }` — `no_proxy()` and `redirect::Policy` are not feature-gated; build pre-verified green.

### Minors from round-1
- Byte-grep test (`import_from_desktop_populates_plugin_storage_and_secrets_not_desktop_files`): asserts `state.profile_dir.join("config.db").exists()` and greps `config.db`/`providers.db`/`prompts.db` for BOTH `desktop-secret-api-key` and `desktop-secret-llm-key` — FIXED.
- Debug test removed — not present in diff — FIXED.
- M5 helper skipped — acknowledged, fine.

## New findings

None blocking. Read-only layer, secrets boundary (`current_profile` discards `ProfileSecrets`, `apply_to` blanks key fields before sqlite, `api_key_ref` re-derived from `state.secrets`), and Task 7 wire contract (`contract/fixtures/profile-qr.README.md`) are consistent with the code. `VOXIS_DESKTOP_CONFIG_DIR` override only redirects a read-only source; tests serialize it under `ENV_LOCK`/`DESKTOP_ENV_LOCK` with RAII cleanup.

## Minors (non-blocking; fold into a later pass or Task 7)

1. **Doc inaccuracy re busy_timeout** — `sqlite_base.rs` `open_read_only` doc ("without a timeout a concurrent read fails immediately with `SQLITE_BUSY`") and `profile_source.rs` module header make the same claim. Because rusqlite already sets a 5 s default (`inner_connection.rs:119`), the explicit `busy_timeout(2s)` actually *shortens* the wait from 5 s to 2 s and makes it explicit/independent of the rusqlite default. Rephrase; keep the call. The negative-control test doc comment already gets this right ("bundled SQLite retries on its own for several seconds") — it is rusqlite, not SQLite, doing that.
2. **Plugin-level contention test is still the weak shape** — `profile_source.rs` `import_from_desktop_succeeds_while_desktop_holds_a_write_transaction` uses `BEGIN IMMEDIATE` (RESERVED lock only; readers never block) and keeps the tautological `assert!(released.load(..))` after `handle.join()`. It cannot fail with `busy_timeout` removed. Acceptable because the genuine regression now lives in `sqlite_base.rs`, but either switch this one to `BEGIN EXCLUSIVE` + elapsed check or drop the `released` assert and retitle it as an integration smoke.
3. **Contract README should state the client-enforced constraints** — `profile-qr.README.md` says only "LAN IP" and "random identifier". Task 7's server/generator must know the client rejects non-IPv4-literal hosts (IPv6 would be refused) and tokens outside `[A-Za-z0-9_-]{1,64}` (e.g. a std-base64 token with `+`/`/` or one longer than 64 chars would be refused). The fixture UUID is fine; add one line each to the `host` and `token` bullets.
4. `build_qr_url` accepts any IPv4 literal incl. `0.0.0.0`, broadcast, multicast. Optional hardening: reject `is_unspecified()`/`is_broadcast()`/`is_multicast()`. Low value given `no_proxy` + the AEAD gate on the payload.
5. `ImportSummary::source` is a free-form `String` on both sides; a TS union `"desktop" | "qr" | "passphrase"` would give consumers exhaustiveness. Cosmetic.
