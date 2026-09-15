VERDICT: APPROVE

Reviewer: fresh/independent, read-only. Scope: Task 7 diff vs 93774c6 (/tmp/ado.C4YWdv/diff_7.patch), cross-checked against the Task 6 client (`crates/tauri-plugin-voxis/src/profile_source.rs`) and the contract fixture. No cargo/bun runs (pre-verified facts taken as given). Working tree contains other tasks' unstaged changes (Task 6 plugin files, voxis-core storage) — `git diff --cached` is empty, nothing staged.

## Findings

### Medium — documented deviation from acceptance text: socket does NOT close on first successful GET
- `src-tauri/src/profile_share/server.rs` (module docs + `start()`): listener closes only on `ttl + 500 ms` or `Drop`. The plan's acceptance says "120 с **или до первого успешного GET**". Worker rationale (module docs, test `a_retry_after_success_gets_410_not_connection_refused`): a client retry should get a well-formed 410 rather than ECONNREFUSED.
- Why it is not a blocker: the security invariant holds — the sealed body is served exactly once (`TokenGate.used`), the callback fires once (tested), and the lingering socket only ever answers 410/64 B. The exposure is a port that stays open up to 120 s after delivery.
- Suggested fix (optional, small): on success, arm a short post-delivery grace (e.g. 5–10 s) that resolves the same shutdown future — gives both properties (well-formed 410 on immediate retry, socket gone soon after delivery). Orchestrator may accept the deviation as-is.

### Low — frontend never stops the session on unmount
- `src/components/settings/ProfileShare.tsx`: no `useEffect` cleanup calling `stopProfileShare()`. Navigating away from Settings while "waiting" leaves the server up until TTL. `profile_share/mod.rs` module docs claim "the settings panel closing" drops the server — that claim is currently untrue.
- Fix: `useEffect(() => () => { if (sessionRef.current) void stopProfileShare(); }, [])`. Bounded by the 120 s TTL + single-use token, so not a security blocker.

### Low — non-410 rejection path for a malformed query
- `server.rs` `handle_get_profile`: `Query<TokenQuery>` extractor rejection (missing `token` param) yields axum's default `400` with a variable-length text body, not the constant `410`/64 B. Nothing about the real token leaks, but the "every rejection is identical" claim in the module docs is slightly over-stated. Fix: take `Result<Query<TokenQuery>, QueryRejection>` (or `Option<Query<_>>`) and map failure to the same `410`+`REJECTED_BODY`. Same for the 404 on other paths (acceptable).

### Low — token comparison is not constant-time
- `server.rs` `TokenGate::check`: `presented_token != self.token` (short-circuit `str` compare). Practically infeasible to exploit over HTTP on a LAN for a 128-bit token, but `subtle::ConstantTimeEq` (already in the dependency graph via aes-gcm/voxis-core) would remove the question. Minor.

## Wire-contract cross-check (both sides quoted)

Fixture `crates/tauri-plugin-voxis/contract/fixtures/profile-qr.json`:
```json
{ "v": 1, "host": "192.168.1.42", "port": 4217, "token": "b2b48c1e-…", "k": "3q2-7w1s5F0P9xJf6uY8bN2mZaC4vD1eR7tG5hK9lQ0" }
```
Desktop (Task 7) `src-tauri/src/profile_share/qr.rs`:
```rust
#[derive(Debug, Clone, Serialize)]
pub struct QrPayload { pub v: u32, pub host: String, pub port: u16, pub token: String, pub k: String }
```
filled in `mod.rs::start_share` with `v: 1, host: bind_ip.to_string(), port, token /* encode_base64url(16 B) */, k: profile::encode_base64url(&k_qr)`.

Plugin client (Task 6) `crates/tauri-plugin-voxis/src/profile_source.rs:259-265`:
```rust
#[derive(Debug, Deserialize)]
struct QrPayload { v: u32, host: String, port: u16, token: String, k: String }
```
`import_from_qr`: rejects `v != 1`; `decode_base64url(&qr.k)` → must be exactly 32 bytes; URL `format!("http://{}:{}/profile?token={}", qr.host, qr.port, qr.token)`; `410 GONE` mapped to "token already used or expired".

Server route: `Router::new().route("/profile", get(handle_get_profile))` + `Query<TokenQuery { token }>`; success `200` + `Content-Type: application/octet-stream` + sealed bytes; all rejections `410` + 64 zero bytes.

Encoding: both sides use `voxis_core::profile::{encode,decode}_base64url` = `URL_SAFE_NO_PAD` (crypto.rs:206-217). Token alphabet is URL-safe, so the client's un-escaped `format!` URL is fine. Key derivation `KeySource::Qr{k_qr, code}` → HKDF info includes `code` (crypto.rs:98-105), so a wrong code fails to open (tested). **Field names, encodings, path, query param, status handling — all match. No contract mismatch.**

## Pre-verified facts agree/disagree
- `cargo test --lib profile_share::` 21/0 — plausible from the diff: 4 gate unit tests + 3 qr tests + 14 in `tests.rs` = 21. Agree.
- setup:: command-list consistency — both `lib.rs` `collect_commands!` and `setup/mod.rs` `generate_handler!` add the same 4 commands. Agree.
- bindings.ts +77 — 4 commands (`startProfileShare(interfaceName)`, `stopProfileShare`, `listShareInterfaces`, `exportProfileFile(path, passphrase)`) + 3 types (`ExportResult`, `ShareInterface`, `ShareSession`) with doc comments. Plausible. Agree.
- Scope (i18n/settingsRegistry/settingsRenderers touched) — accepted as required wiring. Agree.
- Capabilities not touched: consistent with repo convention — `src-tauri/capabilities/default.json` lists only `core:*`/plugin permissions, no existing app command is listed (app commands are allowed by `core:default` in Tauri v2). Agree that no capability change is needed.

## Checked and OK
1. **Binding**: `TcpListener::bind((bind_ip, 0))` where `bind_ip` comes from `resolve_bind_ip` → `list_interfaces` filtered by `!iface.is_loopback() && IfAddr::V4`. Never `0.0.0.0`; loopback is not even offered. Random OS port. Tests bind `Ipv4Addr::LOCALHOST` directly via `server::start` (appropriate).
2. **Token gate**: single-use + bound to first presenting IP before the `used` check (so a racing second IP gets `IpMismatch`, not a leak); wrong token does not bind/consume (unit-tested). Expiry checked in-handler (`Instant::now() > expires_at`) before the gate; hard close at `ttl + 500 ms` (tested `socket_closes_for_good_after_ttl_plus_grace`). `Drop` sends oneshot → graceful shutdown (tested `drop_closes_the_socket`).
3. **Logging**: only 3 `tracing::info!` lines with fixed text (`accepted` / `rejected` / `rejected (expired)`) and one `warn!` with the serve error. No query string, token, `k_qr`, code or passphrase is ever logged; no tower-http trace layer; no `println!`. `ProfileShareError` variants carry no key material.
4. **Crypto plumbing**: `getrandom::getrandom` (0.2, same as voxis-core) for `k_qr` (32 B, no reduction), token (16 B), code (`u32 % 1_000_000`, negligible bias), passphrase indices (`u16 % 2048`, exact). Body = `profile::seal(&profile, &secrets, &KeySource::Qr{k_qr, code})`; `code` never leaves the desktop except via the screen (`ShareSession.code`), never in `QrPayload` (asserted by `payload_json_matches_contract_shape`: exactly 5 keys, no `://`). Rejection body `[0u8; 64]`, status 410.
5. **Secrets never reach the frontend**: `ShareSession { qr_svg, code, host, port, expires_at_ms }`, `ExportResult { passphrase: Option<String> }` (only when generated; user-supplied passphrase is not echoed — tested). `ProfileSecrets { api_key, llm_api_key }` from `VoxisProfile::from_storage(config, dictionary, providers, prompts)` go straight into `seal`. Passphrase: 6 words × 2048-list (BIP-39 English embedded, uniqueness tested) = 66 bits; file = `seal(KeySource::Passphrase)`; round-trip + wrong passphrase tested.
6. **Tests present**: single-use→410 ✓, expiry→410 ✓, wrong token→410 ✓, wrong peer IP (unit `TokenGate`) ✓, GET→`open(k_qr, code)` ✓, wrong code fails ✓, constant 64 B body ✓, Drop closes ✓, hard close after TTL ✓, `on_delivered` exactly once ✓, no loopback in interface list ✓, export generates/reveals once ✓. Vitest: 6 meaningful cases (dropdown, Start→QR+code, delivered event, Stop, generated passphrase shown, user passphrase not echoed).
7. **Wiring**: `commands/mod.rs` re-exports; `collect_commands!` + `generate_handler!`; `settingsRegistry` entry (`customComponent: "profile-share"`, section Advanced) + `settingsRenderers` case; `en.json`/`ru.json` keys `settings.profileShare(Desc)`; `interface_name` (not `interface`) to avoid reserved JS identifier in bindings — good catch.
8. **KISS/DRY**: no generic server abstraction — one `Router`, one handler, one gate struct. axum 0.7 matches `crates/voxis-fake-stt` (0.7, same major); `if-addrs 0.15` present in registry; `qrcode 0.14` with `svg` feature only; `getrandom 0.2` matches voxis-core. `ACTIVE_SESSION: Mutex<Option<_>>` static is a pragmatic single-session holder (documented; avoids touching `app.manage()`).

## Minors
- `random_code` doc says "20-bit draw … ≈4.6 % bias" — it is actually a 32-bit draw (`u32 % 1_000_000`, bias ≈0.02 %). Comment inaccurate, code fine.
- Plan asks for a test "k_qr не в логах"; no explicit log-capture test exists (inspection shows nothing sensitive is logged). Optional: a `tracing` subscriber capture test asserting the token/k never appear.
- Success body length reveals the sealed profile size — not documented in `server.rs`; a one-line note would close the plan's "constant size" discussion (only error bodies are constant).
- `list_interfaces` sorts by name; on macOS `bridge100`/`anpi*`/`utun*` (with IPv4) sort before `en0`, so the "default = first" may pick a VM/VPN interface; link-local `169.254.x.x` not excluded. UX-only; user can pick. Consider excluding link-local and preferring `en*`/`eth*`/`wlan*`.
- UI strings inside `ProfileShare.tsx` are hard-coded English (Start/Stop/Waiting…/Export…/warning). Consistent with `ExportDiagnostics`/`LlmPromptManager` (only `UpdateNotice` uses `useTranslation`), so not a regression, but worth i18n later.
- Export destination is a free-text path rather than a native save dialog (`plugin-dialog` not in capabilities). Acceptable for this step; matches "Save profile file…" loosely.
- `revealedPassphrase` stays in React state until unmount — "shown once" is per-session, fine; a "Dismiss" button clearing it would be nicer.
- `commands.ts` hand-duplicates the 3 types also present in generated `bindings.ts` — matches existing repo convention for `lib/commands.ts`.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Review-only task: examined diff_7.patch (all 19 files), contract fixture, Task 6 client profile_source.rs, voxis-core crypto.rs, capabilities/default.json; no source files modified; only /tmp/ado.C4YWdv/review_7_r1.md written."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Report quotes both wire-contract sides (QrPayload structs, URL format, route, base64url helper), enumerates every tracing call in the diff, lists test-by-test coverage against plan acceptance, and gives file-level findings with fixes."
    }
  ],
  "changedFiles": [
    "/tmp/ado.C4YWdv/review_7_r1.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "grep -n '^diff --git' /tmp/ado.C4YWdv/diff_7.patch",
      "result": "passed",
      "summary": "19 files in diff; enumerated for review"
    },
    {
      "command": "grep 'tracing::|println!|eprintln!' diff_7.patch",
      "result": "passed",
      "summary": "4 log calls, none include token/k_qr/code/query string"
    },
    {
      "command": "git status --porcelain; git diff --cached --stat",
      "result": "passed",
      "summary": "unstaged changes from concurrent tasks present; nothing staged"
    },
    {
      "command": "cargo test / bun test",
      "result": "not-run",
      "summary": "per instructions; pre-verified facts (21/0, 10/0, clippy, tsc, vitest) accepted and found consistent with the diff"
    }
  ],
  "validationOutput": [
    "Wire contract: desktop QrPayload {v,host,port,token,k} == plugin QrPayload {v,host,port,token,k}; both use URL_SAFE_NO_PAD via voxis_core::profile; GET /profile?token= matches route + Query<TokenQuery>; 410 handled by client",
    "Server binds (chosen non-loopback IPv4, 0); TokenGate single-use + first-IP bound; 410 + 64-byte body on all gate rejections; Drop -> oneshot -> graceful shutdown; ttl+500ms hard close",
    "ShareSession/ExportResult contain no secrets; ProfileSecrets only enters seal()"
  ],
  "residualRisks": [
    "Socket stays open until TTL/Drop after a successful GET (documented deviation from '…или до первого успешного GET'); serves only 410 afterwards",
    "Frontend has no unmount cleanup -> server may linger up to 120 s after leaving Settings",
    "Malformed query (missing token) returns axum 400 text, not the constant 410 body",
    "Token compare not constant-time (LAN HTTP; 128-bit token; practically negligible)"
  ],
  "noStagedFiles": true,
  "diffSummary": "Review only; no code changes. Verdict APPROVE with 1 medium (documented deviation) and 3 low findings, all non-blocking.",
  "reviewFindings": [
    "medium: src-tauri/src/profile_share/server.rs - listener does not close on first successful GET (documented deviation); suggest short post-delivery grace close",
    "low: src/components/settings/ProfileShare.tsx - no stopProfileShare() on unmount",
    "low: src-tauri/src/profile_share/server.rs handle_get_profile - Query rejection yields 400 text instead of constant 410/64B",
    "low: src-tauri/src/profile_share/server.rs TokenGate::check - non-constant-time token compare",
    "no blockers"
  ],
  "manualNotes": "Capabilities untouched is correct for this repo (no app command is listed in capabilities/default.json; core:default suffices). Vitest component test is meaningful (6 cases incl. delivered event and one-time passphrase reveal)."
}
```
