```acceptance-report
{
  "criteriaSatisfied": [
    {"id": "criterion-1", "status": "satisfied", "evidence": "Read-only review performed; no plan or source files modified; stayed within R2 architecture+security scope; did not read research/plugin-plan/ prior reviews."},
    {"id": "criterion-2", "status": "satisfied", "evidence": "Findings below cite exact plan section text plus file:line evidence from src-tauri/src/hotkey/mod.rs, src-tauri/src/storage/{mod.rs,paths.rs}, src/theme-engine/{contract.ts,loader.ts,builtin/**}, scripts/build-themes.ts, and clipshot/gen/apple/project.yml."}
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [],
  "validationOutput": [],
  "residualRisks": [
    "Hotkey module carries a hard tauri::{AppHandle, Emitter} dependency that Task 1b's migration text does not address, risking a tauri leak into voxis-core.",
    "Hold-lease watcher lifecycle/session-scoping is unspecified, risking cross-session cancellation races.",
    "Task 5's theme-copy source (raw builtin/** TS) does not match the self-contained bundling step already implemented in scripts/build-themes.ts."
  ],
  "noStagedFiles": true,
  "diffSummary": "No diff produced; this is a read-only R2 architecture/security review of .pi/plans/tauri-plugin-voxis.md.",
  "reviewFindings": [
    "P0: hotkey module (src-tauri/src/hotkey/mod.rs:14,361,402,411) hard-imports tauri::{AppHandle,Emitter} and emits Tauri events directly from the rdev callback; Task 1b's plan to move 'машина press/release, rdev-listener' into voxis_core::hotkey (feature rdev) does not describe decoupling this emit call, contradicting Task 1a's 'voxis-core не зависит от tauri' acceptance and the iOS cross-build gate.",
    "P1: hold-lease design (Approach §5, Task 3 hold_lease(id), Task 5 lease.ts) never states that the per-session missed-heartbeat watcher is torn down on normal stop()/cancel(), leaving a plausible cross-session (ABA) race for rapid hold-release-hold sequences.",
    "P2: Task 5 Files cite src/theme-engine/builtin/** as the 'build-time copy into guest-js as static ES modules' source, but those are TypeScript files with relative imports (e.g. ../../renderers/bars, ../../contract) that only become self-contained ESM after scripts/build-themes.ts's Bun.build step (output at src-tauri/themes/<id>/theme.js); Task 5 doesn't reference that existing script/output.",
    "P2 (tactical): Task 3.5's host-min wires MockCapture via env VOXIS_CAPTURE=mock:<wav> and Task 3.5 Depends only on Task 3/5; Task 4 Files (desktop.rs, hotkey.rs, Cargo.toml) never list examples/host-min, yet Task 4 Verify runs host-min expecting the real CpalCapture path — no task states who adds the backend-selection wiring."
  ],
  "manualNotes": "Positive verification: file:line references in Task 1a (get_app_paths/get_storage_factory/AppPaths::new call sites) matched exactly against grep of the live codebase (orchestrator/mod.rs:38, setup/mod.rs:38, tray/mod.rs, commands/overlay.rs, orchestrator/post_process.rs, orchestrator/transcription/*), and AppPaths::from_config_dir / AppPaths::new(&AppHandle) already exist side-by-side in storage/paths.rs, making the T1a split low-risk as claimed. contract.ts is confirmed DOM/Tauri-free by both its header comment and grep. Task 9a's clipshot citations (app-extension type, embed, DEVELOPMENT_TEAM, outputFiles ownership) were spot-checked against clipshot/gen/apple/project.yml and are accurate."
}
```

# ARCHITECTURE+SECURITY review R2 — tauri-plugin-voxis plan v2.1
## Verdict: GO-WITH-CHANGES — core cross-repo grounding (storage split, theme purity, clipshot precedent) checks out against real code, but the hotkey migration into voxis-core as literally scoped would reintroduce a tauri dependency that the plan's own acceptance gate forbids.

## Strategic findings (max 6)

**F1 — [P0] Hotkey migration to `voxis_core::hotkey` is scoped to move a module that hard-depends on `tauri`, contradicting Task 1a's own acceptance test.**
Claim quoted (Task 1b Acceptance): `"hotkey" (парсинг HotkeySpec, машина press/release, rdev-listener) → voxis_core::hotkey за feature rdev (off по умолчанию → iOS-сборка без rdev)` and (Task 1a Acceptance): `voxis-core не зависит от tauri, cpal, rdev, enigo, arboard, objc2*, core-foundation`.
Evidence: `src-tauri/src/hotkey/mod.rs:14` — `use tauri::{AppHandle, Emitter};`; `mod.rs:361` — `pub fn start(&self, app: AppHandle, hotkey: &str)`; `mod.rs:402` and `mod.rs:411` — `app.emit("hotkey-pressed", ())` / `app.emit("hotkey-released", ())` called directly inside the rdev callback thread. There is no existing abstraction (no trait/callback) separating the parse+press/release state machine from the Tauri emit call — `start()`/`restart()` are the only public entry points and both take `AppHandle` by value. Note also that Task 1b's own grep-verified claim ("там нет tauri/cpal — `[R1-Arch verified]`") is explicitly scoped to `transcription/llm/learning` only — it conspicuously does not extend that verified-clean claim to `hotkey`, and indeed it isn't clean.
Impact: if Task 1b executes "rdev-listener moves to voxis_core::hotkey" as literally written (i.e., moving `HotkeyListener::start` with its embedded `AppHandle`/`Emitter` calls), voxis-core gains a hard `tauri` dependency, which fails the acceptance test in the very same task family (Task 1a) and would fail `scripts/check-ios-build.sh` — silently invalidating gate 5 ("iOS cross-build with T1") and the "самый ценный шаг" claim that voxis-core is Tauri-free.
Fix: add an explicit sub-step to Task 1b requiring the hotkey state machine to notify via a generic sink (e.g. `pub trait HotkeySink { fn on_pressed(&self); fn on_released(&self); }` or a plain closure) instead of `AppHandle`/`Emitter`; keep the Tauri-emit adapter in `voice_lib`'s thin shim (mirroring the `storage` shim pattern Task 1a already uses). State this as a testable Acceptance line, not an implicit assumption.

**F2 — [P1] Theme "static ES module" copy source in Task 5 doesn't match how builtin themes actually become self-contained bundles.**
Claim quoted (Task 5 Files): `src/theme-engine/builtin/** (build-time копирование в guest-js как статические ES-модули; loader.ts/fetchModule.ts не экспортируются)`.
Evidence: `src/theme-engine/builtin/default/index.ts` imports `../../renderers/bars` and `../../contract` — these are TypeScript files with package-relative imports, not standalone modules. The only place that turns them into self-contained ESM is `scripts/build-themes.ts`, which runs `Bun.build({ entrypoints: [builtin/<id>/index.ts], format: "esm", target: "browser" })` and writes the bundle to `src-tauri/themes/<id>/theme.js`. Task 5 never references `build-themes.ts` or its `src-tauri/themes/**/theme.js` output; it cites the raw `builtin/**` TS tree as the thing to copy.
Impact: if guest-js literally copies `src/theme-engine/builtin/**` at build time (as the Files line states) without running the bundler, the relative imports (`../../contract`, `../../renderers/bars`) won't resolve once the files live inside the separate `crates/tauri-plugin-voxis/guest-js` package — breaking the entire "no loader.ts, static import, CSP-safe" security argument that [R1-Safety S3] rests on.
Fix: change Task 5 Files/Steps to consume `scripts/build-themes.ts`'s output (or invoke it as a guest-js build step) rather than raw `builtin/**` source, and state explicitly that `ThemeRegistry` statically imports the bundled `theme.js` files, not the TS sources.

Other checked areas (SecretStore trace, QR fixture naming, static-theme purity of contract.ts, storage/hotkey split grounding) held up under inspection — see Verified-OK.

## Internal contradictions
- Task 1a's acceptance ("voxis-core не зависит от tauri") vs. Task 1b's scope ("rdev-listener" module moves wholesale into voxis-core) — see F1. The grep-verified-clean assurance in Task 1b text is deliberately narrower than the full module list it claims to move, which is itself a tell that the plan's authors did not extend the same verification to `hotkey` that they did to `transcription/llm/learning`.
- Task 3.5 (Depends: Task 3, Task 5 — not Task 4) wires `examples/host-min` capture via `VOXIS_CAPTURE=mock:<wav>` (Task 3.5 Steps 2). Task 4 ("Desktop-реализация: cpal capture + rdev hotkey") lists only `desktop.rs`, `hotkey.rs`, `Cargo.toml` under Files — `examples/host-min/**` is absent — yet Task 4's Verify line says "запуск examples/host-min (macOS)" as if host-min already exercises the real `CpalCapture` path. No task explicitly adds the runtime backend-selection wiring (mock vs. cpal) to host-min. Minor, easily closed by adding host-min's entry point to Task 4 Files.

## Tactical findings
- Task 3's `AudioCapture::stop() -> Result<CaptureStats>` leaves `CaptureStats` fields unspecified while Task 8's Swift `stopCapture` returns `{durationMs, samples, peakRms}` — not provably contradictory since Task 3 never enumerates the struct, but worth pinning the field list once in the contract fixtures (`contract/fixtures/*.json`) so Rust/Swift/TS agree byte-for-byte, consistent with the plan's own "один контракт — одни фикстуры" gate.
- Hold-lease watcher teardown on normal `stop()` is not explicitly specified (see F-adjacent note below under contradictions); recommend adding a session-id-scoped teardown acceptance line and a rapid stop+restart test to Task 3.

## Verified-OK
- Storage split (Task 1a) is well-grounded: grep of `src-tauri/src` confirms the exact call sites the plan cites — `orchestrator/mod.rs:38` (`get_app_paths`), `setup/mod.rs:38` (`AppPaths::new`), `tray/mod.rs`, `commands/overlay.rs:115`, `orchestrator/post_process.rs:160,235`, `orchestrator/transcription/{debug.rs,pipeline.rs,output.rs}` — all present and matching. `storage/paths.rs` already defines both `AppPaths::from_config_dir` (pure) and `AppPaths::new(&AppHandle)` (shim) side by side, so the proposed core/shim split is low-risk as claimed.
- `reqwest` is already `rustls-tls` at `src-tauri/Cargo.toml:87`, matching the plan's "только перенос" claim for Task 1b.
- `src/theme-engine/contract.ts` is confirmed free of DOM/Tauri/window/invoke dependencies (explicit header comment plus grep across `src/theme-engine/builtin/**` found no `window.`/`tauri`/`invoke(` usage outside test files) — supports the "ThemeApi has no window/Tauri dependency" claim in point 4.
- SecretStore / secret-handling trace (Task 2 `Secret`/`api_key_ref` → Task 3 `apply_profile`/`SecretStore` → Task 6 `<host-config>/voxis-plugin/` split → Task 7 `seal(profile, KeySource::Qr{...})`/`k_qr не в логах` → Task 10 `NakedSecretStoreAdapter`/`grep -c sk-`) is internally consistent in naming (`seal`/`open`, `KeySource::Qr`, `grep -c sk- *.db == 0` repeated verbatim in Task 3 and Task 10) — no drift found across these four tasks.
- Task 9a's clipshot-derived Tauri-iOS-extension precedent was spot-checked against `~/work/clipshot/gen/apple/project.yml` (lines ~117-241): `type: app-extension`, `embed: true/false`, `DEVELOPMENT_TEAM: GZL949D756`, and the "extension owns Rust build outputFiles" note all matched the plan's citations accurately.