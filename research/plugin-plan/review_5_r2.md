VERDICT: APPROVE

Round-2 independent review of Task 5 (guest-js package), diff `/tmp/ado.C4YWdv/diff_5_r2.patch` vs baseline 37e2374. Read-only; no tests run (orchestrator pre-verified: workspace 1174/0, clippy clean, iOS plugin build green, guest-js vitest 184/184, `src-tauri/themes` byte-identical after `build:themes`, scope clean). All round-1 REJECT-FIX items are FIXED in code with tests; the only new items are minors (one small parity nit worth a one-line follow-up). Per anti-ping-pong: APPROVE with minors.

## Round-1 checklist

| Item | Status | Evidence |
|---|---|---|
| **M1** viewport reflow | **FIXED** | `src/overlay.ts` `wireViewportReflow()` subscribes `visualViewport.resize`/`scroll` (when present) + `window.resize`/`orientationchange` to `handleViewportChange`, which does `snapToNearestEdge(currentPillPos(), …)` — and `snapToNearestEdge` itself calls `clampToViewport` first (`src/drag.ts:65-70`), so re-clamp + re-snap both happen. `disconnectedCallback` removes all four listeners and nulls `visualViewportTarget`. Tests: `__tests__/overlay.test.ts:244-300` define `class FakeVisualViewport extends EventTarget`, install it via `Object.defineProperty(window,"visualViewport",…)`, and cover VV `resize` (keyboard-open shrink), VV `scroll`, and the `visualViewport === undefined` fallback to `window.resize`/`orientationchange`. |
| **M2** SINGLE_KEY_CODES mirrors Rust KEY_TABLE; unknown spec throws; table-driven test | **FIXED** | `src/hotkey.ts` `SINGLE_KEY_CODES` has all 36 KEY_TABLE entries / every alias from `crates/voxis-core/src/hotkey/mod.rs:51-231` (I diffed alias lists: modifiers 1-8, f1-f12, space…num_lock — identical). Spot-checks: `alt_gr→AltRight` ✓, `super→MetaLeft` ✓, `f12→F12` ✓, `page_down→PageDown` ✓, `print_screen→PrintScreen` ✓, `command` — not a KEY_TABLE alias in Rust either (Rust has `cmd`), so single-key `"command"` correctly throws in both (see Minors for the *combo-modifier* `command` nit). `buildMatcher` ends in `throw new UnrecognizedHotkeySpecError(spec)`; `HotkeyMachine` ctor and `matchesHotkeySpec` both route through it. Tests: `__tests__/hotkey.test.ts` `RUST_KEY_TABLE_FIXTURE` (independent transcription, not imported from src) drives one `it` per alias × code; plus two throw tests (`matchesHotkeySpec("not a real spec!!")`, `new HotkeyMachine({matches:"bogus"})`). |
| **M3** combo release on first keyup of any member | **FIXED** | `src/hotkey.ts` `buildMatcher` returns split `{press, release}`; `release` returns true for main key (case-insensitive `e.key`) or any required modifier by `e.key === "Control"/"Alt"/"Shift"/"Meta"`. `HotkeyMachine.release()` idempotent guard prevents double-fire. Tests (`hotkey.test.ts` "combo release order"): main-key-first, Ctrl-first (with `ctrlKey:false` as browsers report), Shift-first, second member keyup no-op, unrelated keyup does not release. Both release orders covered. |
| **L1** drift test byte-compares both outputs | **FIXED** | `__tests__/build-themes-drift.test.ts`: `themeIds()` equality of both dirs + `it.each` over ids for `theme.js` and `theme.json` using `Buffer.equals`. 18 ids in both `src-tauri/themes` and `guest-js/src/themes/generated` (verified via `ls | wc -l`). Generated dir is not gitignored (`git check-ignore` → not ignored). |
| **L2** build-themes cwd-independent; no `bun --cwd` | **FIXED** | `scripts/build-themes.ts` adds `process.chdir(ROOT)` before any `Bun.build` with explanatory comment; writes both `OUT_DIRS` from the same `themeJs` string. `guest-js/package.json` scripts now `bun ../../../scripts/build-themes.ts && tsc …` / `… && vitest run` — no `--cwd`. Root `package.json` adds `test:guest-js`, `harness:overlay` only. |
| **L3** activeSessionId cleared on idle/result | **FIXED** | `src/overlay.ts` `wireClientEvents`: `onState` → `if (state === "idle") this.clearActiveSession()`; `onResult` → `clearActiveSession()`. `clearActiveSession()` nulls id and stops lease without calling `stop()`. Test: `overlay.test.ts:178` "toggle mode: a session ended by the plugin itself … does not leave a stale session id [REJECT-FIX L3]". |
| **L4** dictate(): listeners before start; reject on error; reject on idle-without-result | **FIXED** | `src/client.ts` `dictate`: `Promise.all([listen(RESULT…), listen(STATE…)]).then(() => client.start(mode))` — listeners awaited before `start`. State `"error"` → immediate `settleReject`; `"idle"` → 50 ms `DICTATE_IDLE_GRACE_MS` timer then reject; result → resolve; all paths `cleanup()` (unlisten + clearTimeout), single-settle guard. Tests: `client.test.ts:50` (order), `:88` (error), `:101` (idle grace). |
| **L5** csp-bundle uses `node_modules/.bin/tsc`; greps `new Function(`/`eval(` | **FIXED** | `__tests__/csp-bundle.test.ts` `TSC_BIN = join(PACKAGE_ROOT,"node_modules",".bin", win32 ? "tsc.cmd" : "tsc")`, `execFileSync(TSC_BIN, ["-p","tsconfig.json"])`. Assertions: no `blob:`, no `data:text/javascript`, no `/\bimport\s*\(/`, no `/\bnew\s+Function\s*\(/`, no `/\beval\s*\(/` across all emitted `.js`. |
| **Sanity** registry static-only; no `import()` in src | **PASS** | `src/themes/registry.ts:37-54` are 18 static `import * as … from "./generated/<id>/theme.js"`. `grep 'import\s*(' guest-js/src` hits only two doc-comment lines in registry.ts describing what is *not* done. |

## New findings

No blockers. No new defects that warrant a new front.

## Minors

1. **Combo-modifier alias parity (`command`)** — `crates/voxis-core/src/hotkey/mod.rs:282` `HotkeyCombo::parse` accepts `"cmd" | "command" | "meta"` for Cmd and `"super"` as a *separate* `Super` modifier; `src/hotkey.ts` `parseCombo` accepts `cmd|meta|super` (→ meta) but **not `command`**, and additionally accepts `option` (which Rust does not). So a desktop-valid `"Command+Shift+V"` throws `UnrecognizedHotkeySpecError` at `bindHotkey` time in guest-js (fail-loud, not silent — so it's visible, not a stuck state). One-line follow-up: add `case "command":` to the meta branch; optionally drop/document `option`. The round-1 M2 scope was the single-key `KEY_TABLE`, which is fully mirrored, so I am not reopening M2 for this.
2. **`dictate()` partial-listen leak** — `src/client.ts`: if `Promise.all` rejects because one `listen()` rejected after the other resolved, `unlistenResult`/`unlistenState` are still `undefined` in `cleanup()`, leaking the successful listener. Only reachable if Tauri `listen` throws, which is effectively never in practice. Could capture each unlisten individually (`.then(fn => unlistenX = fn)`) before `Promise.all`.
3. **M1 — no explicit unsubscribe test.** Code removes all four viewport listeners in `disconnectedCallback`, but `overlay.test.ts` has no test asserting that a `resize` dispatched after `el.remove()` no longer moves/saves position. Nice-to-have.
4. **`handleViewportChange` saves position on every viewport event** when `draggable` — `savePosition` to `localStorage` on each `visualViewport.scroll` tick (can fire rapidly during iOS keyboard animation). Harmless functionally; could gate on "position actually changed".
5. `src/themes/generated/**` is currently untracked (`git ls-files` → 0) because the whole guest-js package is new/uncommitted; it is not gitignored, so it will be committed with the step. Just ensure it is included in the commit — the L1 drift test and the static registry imports depend on it.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Review-only task; all 8 round-1 REJECT-FIX items verified FIXED with file:line evidence in /tmp/ado.C4YWdv/review_5_r2.md; no repo edits made"
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Report contains per-item FIXED table with file:line refs, sanity checks (18/18 theme ids, no import() in src, registry static imports), and 5 enumerated minors incl. the Rust HotkeyCombo 'command' modifier parity nit at mod.rs:282 vs hotkey.ts parseCombo"
    }
  ],
  "changedFiles": [
    "/tmp/ado.C4YWdv/review_5_r2.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "grep/sed over /tmp/ado.C4YWdv/diff_5_r2.patch (overlay.ts, hotkey.ts, client.ts, tests, build-themes.ts, package.json)",
      "result": "passed",
      "summary": "All round-1 fixes present in diff"
    },
    {
      "command": "grep KEY_TABLE aliases crates/voxis-core/src/hotkey/mod.rs; read HotkeyCombo::parse",
      "result": "passed",
      "summary": "36 KEY_TABLE entries/aliases identical to SINGLE_KEY_CODES; combo parser accepts 'command' in Rust but not JS (minor)"
    },
    {
      "command": "ls generated | wc -l; ls src-tauri/themes | wc -l; git check-ignore; git ls-files; git diff --cached --name-only | wc -l; grep 'import\\s*(' guest-js/src",
      "result": "passed",
      "summary": "18/18 ids; generated not ignored; 0 staged files; no dynamic import() in src"
    }
  ],
  "validationOutput": [
    "Pre-verified by orchestrator: workspace 1174 passed / 0 failed; clippy -D warnings clean; iOS plugin build green; guest-js vitest 184/184; src-tauri/themes byte-identical after build:themes",
    "git diff --cached --name-only | wc -l -> 0"
  ],
  "residualRisks": [
    "Combo modifier alias 'command' accepted by Rust HotkeyCombo::parse but throws UnrecognizedHotkeySpecError in guest-js parseCombo (fail-loud; one-line follow-up)",
    "dictate() can leak one listener if the other listen() rejects (practically unreachable)",
    "No explicit test that viewport listeners are removed on disconnect (code does remove them)"
  ],
  "noStagedFiles": true,
  "diffSummary": "Review only — no repo changes; wrote /tmp/ado.C4YWdv/review_5_r2.md",
  "reviewFindings": [
    "no blockers",
    "minor: crates/tauri-plugin-voxis/guest-js/src/hotkey.ts parseCombo lacks 'command' modifier alias present in crates/voxis-core/src/hotkey/mod.rs:282",
    "minor: crates/tauri-plugin-voxis/guest-js/src/client.ts dictate() cleanup cannot unlisten a listener whose sibling listen() rejected",
    "minor: overlay.test.ts has no post-disconnect viewport-listener test",
    "minor: overlay.ts handleViewportChange writes localStorage on every visualViewport scroll tick"
  ],
  "manualNotes": "VERDICT: APPROVE with minors. All round-1 items FIXED. Ensure guest-js/src/themes/generated/** is committed with the step (untracked but not gitignored)."
}
```
