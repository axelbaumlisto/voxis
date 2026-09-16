# R3 — guest-js TypeScript/web-component review (`crates/tauri-plugin-voxis/guest-js/src`)

VERDICT: SHIP

Scope reviewed: `client.ts`, `overlay.ts`, `hotkey.ts`, `theme-bridge.ts`, `themes/registry.ts`,
`drag.ts`, `lease.ts`, `types/{contract,theme-api}.ts`, `index.ts`, and `__tests__/*`.
`bun run test` → **233 passed (233)**, 2.79s. `themes/generated` ignored per brief.

## Blockers
None found. The judged behaviours (dictate() correlation, listener cleanup on disconnect,
lease timing, compact/expanded lifecycle, drag/snap sizing, host-vs-client parity, CSP safety,
stuck-recording prevention) are all implemented and, with one exception below, tested.

## Should-fix (non-blocking)

- **Async event-listener attach can leak a subscription across a fast mount→unmount→mount
  (React StrictMode double-mount).** `overlay.ts` `wireClientEvents` (~L560) attaches listeners
  with `void client.onState(...).then((fn) => { this.unlistenState = fn; })` — the unlisten
  handle is only stored once the `listen` promise resolves (a real IPC round-trip under Tauri).
  `disconnectedCallback` (~L360) calls `this.unlistenState?.()`, but if disconnect runs before
  the promise resolves, the handle is still `null`, then the promise later resolves and assigns
  `this.unlistenState` to a handle nobody ever calls → the first mount's `voxis://state|level|result`
  subscription leaks. `dictate()` in `client.ts` does NOT have this problem (it awaits both
  `listen` calls *before* `start()` and cleans up in its own `cleanup()`), so the pattern is
  known-good elsewhere. The overlay's `disconnectedCallback` test only covers the
  synchronous-mock path (`__tests__/overlay.test.ts` "disconnecting the element cleans up its
  subscriptions" asserts only `isConnected === false`), so this gap isn't caught.
  Minimal fix: track a `disconnected` flag (or store the three `listen` promises) and, in
  `disconnectedCallback`, `promise.then((fn) => fn())` / early-return the assignment when already
  disconnected. `driver: "host"` is unaffected (it never subscribes).

- **`voxis-overlay-resize` is never dispatched for the initial layout, contradicting its own
  doc.** `dispatchResize`'s comment (overlay.ts ~L470) says it fires "after every size/lifecycle
  change, both programmatic (grow/shrink) and this being the very first layout," but
  `connectedCallback` calls `applyPillSize(this.currentSize())` without a following
  `dispatchResize()`. A host wiring container layout off the event gets nothing until the first
  compact↔expanded transition. Low impact (the public `el.size` getter is available), but the
  doc and behaviour disagree — either dispatch once at end of `connectedCallback` or drop the
  "very first layout" claim.

- **`handleViewportChange` re-snaps horizontally on every viewport resize/scroll.** When the iOS
  keyboard opens, `snapToNearestEdge` runs and can shift the pill horizontally to the nearest
  edge, not just clamp it vertically above the keyboard. The M1 tests only assert the vertical
  clamp (`top + height <= viewport.height`), so a possibly-surprising horizontal jump is
  untested. Likely intended ("settle at nearest edge"), but worth confirming against the desired
  UX; if only a vertical clamp is wanted here, use `clampToViewport` instead of `snapToNearestEdge`.

## Verified OK

- **`dictate()` sessionId correlation (client.ts).** Both `RESULT_EVENT` and `STATE_EVENT`
  listeners are attached and awaited *before* `start()` is called; result events are matched by
  `event.payload.sessionId === sessionId` (the id `start()` returned), not by arrival order —
  a result for any other/earlier session is ignored (F2). `"error"` state rejects immediately;
  `"idle"` with no result within `DICTATE_IDLE_GRACE_MS` (50ms) rejects (covers out-of-band
  `cancel()`); `settled` guard + `cleanup()` on every path prevents double-settle and unlistens
  both. No event-order assumptions. Solid.
- **Stuck-recording prevention (overlay.ts hold mode).** `pointerup`/`pointercancel`/
  `lostpointercapture` all route through `endGesture` → `stopActive`, and a `window` `blur`
  listener (`handleWindowBlur`) stops an active hold session. The
  `startActive`→`stopRequested`→`stopActive` handshake correctly handles a release that arrives
  before `start()` resolves. `applyState("idle")`/`applyResult` both call `clearActiveSession()`
  so a plugin-initiated end (silence/max-duration/streamDied) never leaves a stale `activeSessionId`
  that a later tap would `stop(staleId)` — explicitly tested (L3).
- **hotkey.ts** enforces the safety properties: `e.repeat` guard, blur/visibilitychange/pagehide
  force-release, 5s lost-keyup timer, and a combo *release* rule that fires on the first keyup of
  any combo member (M3) rather than requiring the whole chord on keyup. Unknown spec throws
  `UnrecognizedHotkeySpecError` at construction (M2), not silent no-match. `bindHotkey.destroy()`
  removes every listener it added.
- **lease.ts** heartbeat is single-flight (`inFlight` guard), stops on error (+ forwards to
  `onError`), and cleans up its interval and `pagehide` listener on `stop()`. First beat at
  `intervalMs` (default 1000ms) is comfortably inside the Rust-side 3-missed-beat (~3s) budget.
  `overlay.startActive` only arms the lease for `mode === "hold"` and drops the reference on
  `onError` so a stray `stop()` can't double-call.
- **Compact/expanded lifecycle (overlay.ts, A6).** Idle/error → compact 56×56 handle with theme
  **unmounted** (no render loop while idle); recording/transcribing → expanded to
  `resolveThemeSize` (manifest, `FALLBACK_THEME_SIZE` 64×64). `updateLifecycle` early-returns when
  `target === lifecycleState`, so **recording→transcribing does not re-mount** (both expanded).
  `idleTheme: true` mounts eagerly and never unmounts. `disconnectedCallback` calls
  `unmountThemeInstance`. Grow pivots on the nearer edge (`anchorGrow`) then re-clamps
  (`clampToViewport`); `shapeRadius` = circle for ≤96px square, else 16px. All exercised by the
  A6 test block (mount/unmount counts, idleTheme, error==compact, resize events) for **both**
  `client` and `host` drivers.
- **Drag / snap uses current size.** `wireDrag` passes `getSize: () => this.currentSize()`;
  drag-while-expanded clamps with 120px and drag-while-compact with 56px (tested). A drag that
  completes while expanded sets `expandedDragOccurred` and returns without persisting the
  expanded coords; `shrinkToCompact` restores `compactPosition` verbatim and re-saves the compact
  spot — a fresh mount with the same `storageKey` lands at the compact position, not the expanded
  drag (Finding-1 test with two mounts confirms).
- **Host vs client driver parity.** `applyState/applyLevel/applyResult` are the single shared
  update path; `wireClientEvents` only chooses "where events come from." `driver: "host"` creates
  no client, adds no `blur` listener, dispatches `voxis-overlay-press` {down|up} on
  down/up/cancel/lostcapture, and its theme `cancel` action is a guarded no-op. Parity tests
  (`it.each(["client","host"])`) confirm identical indicator/lifecycle/resize behaviour.
- **CSP safety.** `themes/registry.ts` imports every builtin theme + manifest **statically** by
  literal specifier; no `eval`/`new Function`/dynamic `import()`/`blob:`/`data:` anywhere.
  Independent grep of built `dist/**.js` for `import(`/`eval(`/`new Function`/`blob:` found only
  the doc-comment occurrences in `registry.d.ts` (no runtime dynamic import). Shadow-root styles
  are injected via `style.textContent` into the element's own `attachShadow({mode:"open"})` only,
  with `:host { all: initial; }` isolation. `csp-bundle.test.ts` is the enforcing gate (233 pass).
- **Public API / typing.** `index.ts` re-exports the intended surface;
  `types/contract.ts` is a hand-written mirror of the Rust wire contract with runtime guards,
  kept honest by `contract.test.ts` against `contract/fixtures/*.json`; camelCase-vs-snake_case
  per-type split (LlmProvider/Model/Prompt snake_case) is documented and deliberate.

## Not covered
- Rust plugin side (`src/**`), `naked` host, and iOS Swift capture — outside this role.
- `themes/generated/**` (excluded by brief) and the actual WebGL themes' runtime behaviour.
- No runtime CSP enforcement possible in jsdom (documented in `overlay.test.ts`); relied on the
  bundle-grep gate + my own `dist` grep instead.
- Real Tauri IPC timing for `dictate()`/lease (tests use synchronous mocks); reasoned from code.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Reviewed all in-scope guest-js source + tests; ran the named test suite (233 passed) and an independent dist CSP grep; report gives VERDICT, blockers (none), should-fix items with file:line, verified-OK list, and residual risks."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "bun run test 2>&1 | tail -4",
      "result": "passed",
      "summary": "233 passed (233), 2.79s"
    },
    {
      "command": "grep -rnE 'eval\\(|new Function|import\\(|blob:' dist src",
      "result": "passed",
      "summary": "No dynamic import/eval/Function/blob in built JS or src — only doc-comment mentions"
    }
  ],
  "validationOutput": [
    "Tests 233 passed (233), Duration 2.79s",
    "dist/**.js dynamic-import grep: no matches outside comments"
  ],
  "residualRisks": [
    "Async listener-attach in overlay wireClientEvents can leak a subscription under fast mount/unmount (React StrictMode double-mount); not caught by the synchronous-mock disconnect test.",
    "voxis-overlay-resize is not dispatched on initial layout despite its doc claiming so (hosts must read el.size getter instead).",
    "handleViewportChange re-snaps horizontally on keyboard open; only the vertical clamp is tested.",
    "CSP not enforced in jsdom; relied on bundle-grep gate + manual dist grep. Rust/naked/iOS out of scope."
  ],
  "noStagedFiles": true,
  "diffSummary": "No code changes — review only; report written to output path.",
  "reviewFindings": [
    "no blockers",
    "should-fix: overlay.ts wireClientEvents (~L560)/disconnectedCallback (~L360) - async unlisten handle can be null at disconnect => StrictMode double-mount subscription leak",
    "should-fix: overlay.ts connectedCallback - initial voxis-overlay-resize not dispatched, contradicts dispatchResize doc",
    "should-fix: overlay.ts handleViewportChange - snapToNearestEdge causes horizontal jump on viewport resize (untested)"
  ],
  "manualNotes": "Verdict SHIP: dictate() sessionId correlation, stuck-recording prevention, lease timing, compact/expanded lifecycle (no double-mount recording->transcribing), drag/snap current-size + expanded-drag-not-persisted, host/client parity, and static-import CSP safety are all implemented and (except the StrictMode leak) tested. The one genuine correctness gap is the async listener leak on rapid mount/unmount — worth fixing but not ship-blocking for the imperative mountOverlay usage."
}
```
