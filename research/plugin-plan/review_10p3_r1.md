# Review: Task 10 Part 3 (naked, voxis-plugin branch, base 29e78d43)

VERDICT: REJECT-FIX

## Findings

1. **Idle-hiding contradicts its own doc comment / `error` state leaves an orphan pill (real bug, small fix).**
   `VoxisOverlayHost.tsx`:
   ```
   const isIdle = voxis.pluginState === "idle";
   const className = isIdle ? "...--idle" : "...";
   ```
   Both `VoxisOverlayHost.tsx`'s own doc comment and `keypanel.css`'s comment above `.voxis-overlay-host--idle`
   state the intent explicitly: *"the fix is to only ever show it while a recording is actually in flight
   (`"recording"` | `"transcribing"`)"* / *"it comes back for `"recording"`/`"transcribing"`"*. But the actual
   guard only checks `pluginState === "idle"`, so `"error"` — the plugin's 4th state (confirmed in the vendored
   `types/contract.d.ts`: `PluginState = "idle" | "recording" | "transcribing" | "error"`) — falls through to the
   **visible** branch, not the hidden one. That means an error pill is left showing, `top-right`, floating over
   naked's own chrome, until the plugin's next state transition — silently contradicting the very design rationale
   the PR's own comments give for hiding it in the first place, and never exercised by `VoxisOverlayHost.test.tsx`
   (which only tests `idle`/`recording`, never `error`). This needs either (a) the guard changed to
   `pluginState !== "recording" && pluginState !== "transcribing"` (matching the stated intent literally), or
   (b) the doc comments corrected to say "hidden only while idle" and an explicit decision that an error pill
   staying visible is intentional (plausible — the user may want to see the error — but then say so, and add the
   `error`-shows-the-pill case to `VoxisOverlayHost.test.tsx`). As written, code and rationale disagree and neither
   state is test-covered for `error`. This is the one item blocking APPROVE; it's small (one condition + one test
   case, or one doc fix) — REJECT-FIX, not REJECT-REDO.

2. **`display: none` while hidden + plugin's own drag-persisted position: not verified against a reflow-on-reveal
   bug, but plausible by design.** `useVoxisOverlayMount` mounts the overlay element into a container that is
   `display: none` while idle (never unmounts/remounts across idle<->recording transitions — confirmed: the
   element is only mounted once per `container` ref, deps `[container]`, and the CSS class toggle is the only
   thing that changes on state transitions). If the vendored plugin's drag/clamp logic (`overlay.ts`,
   `initialPosition`) reads `getBoundingClientRect()` / viewport bounds at `applyState`-driven show time rather
   than at drag time, a `display: none` container reporting a 0×0 rect could misplace or mis-clamp the pill on
   first reveal. I did not find anything in this diff that primes/re-clamps position on the idle→recording
   transition (only `applyState`/`applyLevel`/`applyResult` are called by the three watcher effects), and the
   vendored plugin source lives outside this diff so I can't confirm it's safe by inspection alone within this
   review's scope — flagging as a **question for the author to confirm** (has this actually been exercised
   manually with a dragged-then-hidden-then-shown pill?), not a blocking finding, since I have no concrete
   evidence of breakage — but it's exactly the kind of thing `display: none` (vs. `visibility: hidden` /
   `opacity: 0` + `pointer-events: none`, which would keep layout box present) risks silently.

## Ratchets

- `APP_TSX_MAX_LINES` 1025 → 1037 (Task 10 part 3): justified — new `voxisOverlay` group literal in the `modals`
  prop assembly at the call site (App.tsx ~955-1015), consistent with the part-2 precedent for `voxisChip`.
- `AppShellModalsProps` 49 → 50 (`propFieldsRatchet.test.ts`): justified — one new top-level grouped field
  `voxisOverlay` (pluginState/latestLevel/lastResult/onHoldStart/onHoldStop), and the comment correctly notes
  `onHoldStart`/`onHoldStop` are literally the SAME `voxisRuntime.holdStart`/`holdStop` functions `voxisChip`
  already forwards — verified directly in App.tsx: both groups assign `onHoldStart: voxisRuntime.holdStart` /
  `onHoldStop: voxisRuntime.holdStop`, no second binding, no second gesture/session-starter.
- Both ratchets: literal, minimal, correctly attributed. No inflation found.

## Checked and OK

- **Single-subscription invariant (Judge 1):** grep across `src/**/*.ts*` for `onState|onLevel|onResult|listen("voxis` /
  `useVoxisRuntime|useVoxisOverlayMount` finds exactly one `useVoxisRuntime()` call site (App.tsx:484) and
  `useVoxisOverlayMount`'s own doc comment states explicitly it "OWNS neither a `VoxisClient` nor a
  `voxis://state|level|result` subscription of its own" and only forwards `applyState`/`applyLevel`/`applyResult`
  from props — confirmed by reading the hook: no `client`, no `getVoxisClient`, no `onX` call anywhere in
  `useVoxisOverlayMount.ts` or `VoxisOverlayHost.tsx`. Holds end-to-end.
- **Race fix completeness (Judge 2):** all three `await client.onX(...)` subscribes in `useVoxisRuntime.ts`
  (`onState`, `onLevel`, `onResult`) follow the identical "resolve, then re-check `cancelled`, call
  `resolvedUnlisten()` and `return` if so, else assign to the outer var" pattern — genuinely applied three times,
  not just once and assumed. The initial `client.state()` call needs no such guard (it's not a subscription; the
  `if (!cancelled) setButtonState(...)` guard on its own resolution is sufficient and present). The `onResult`
  callback body additionally re-checks `if (cancelled) return;` before touching `activeSessionIdRef`/pasting —
  correctly prevents a zombie's late-firing callback (one that resolved and got its `unlisten()` called, but whose
  underlying mock/native event bridge still queues a delivery) from double-pasting. `useVoxisOverlayMount`'s press
  handler: `el.removeEventListener("voxis-overlay-press", handlePress)` runs in the cleanup, before `el.remove()`
  — correctly removed, not just implicitly dropped via DOM removal.
- **tauriMock semantics (Judge 4):** `plugin:event|listen` now echoes back `args.handler` instead of a hardcoded
  `1`, matching `@tauri-apps/api`'s real per-call `transformCallback` id; `plugin:event|unlisten` deletes by
  `{eventId}` (confirmed shape matches the real `_unlisten(event, eventId)` call); `emitEvent` fans out to every
  still-live handler id recorded for that event name (not "first listener wins"), and throws
  `"the app never subscribed to ..."` when zero listeners are recorded, and a second, distinct error
  `"...(all recorded listeners already unlistened)"` when listeners existed but all since unlistened — good
  separation of the two failure modes. Inline doc comments in `tauriMock.ts` explain the "used to be constant 1"
  bug and why it mattered (the exact zombie-listener-can-never-be-removed bug the `useVoxisRuntime` fix addresses)
  — the mock's own documentation is updated, not just its behavior.
- **Vendor consistency (Judge 6):** `vendor/README.md`'s rev (`325e2201e3c38215e3ef586a734e129e4c5d3db8`) matches
  `src-tauri/Cargo.toml`'s three `rev = "325e2201e3c38215e3ef586a734e129e4c5d3db8"` occurrences (both
  `tauri-plugin-voxis` deps + `voxis-core`) and the task's shorthand `325e220…`. `package.json`'s
  `"@voxis/tauri-plugin-voxis": "file:vendor/voxis-tauri-plugin-voxis-0.1.1.tgz"` matches the actual vendored
  filename and the extracted tarball's own `package.json` version (`0.1.1`). Recomputed
  `shasum -a 256 vendor/voxis-tauri-plugin-voxis-0.1.1.tgz` **matches** the sha256 recorded in `vendor/README.md`
  (`9dd80c8639517b52d3aeb127f64ba36a56a0b0887a77b78b0e5c9328dfdc4829`) — bit-for-bit consistent, not just a
  plausible-looking string. The old `voxis-tauri-plugin-voxis-0.1.0.tgz` is gone from `vendor/` (only the 0.1.1
  tarball present; diffstat confirms the 0.1.0 blob was deleted, 0.1.1 added, not both left side-by-side).
  Confirmed the vendored `dist/types/contract.d.ts`'s `PluginState` union is exactly the 4 values this review
  relies on for Finding 1.
- **KISS split (Judge 7):** `VoxisOverlayHost` (component: DOM container + callback-ref idiom + the
  idle/visible class decision) vs. `useVoxisOverlayMount` (hook: mount/unmount lifecycle, the three forwarding
  effects, the press-event wiring) is a reasonable, precedented split — it mirrors how `useVoxisRuntime` itself is
  already split from its own call site in `App.tsx`, and keeps the hook (which has real subscription/cleanup
  logic worth unit-testing in isolation — see `useVoxisOverlayMount.test.tsx`) separate from the component (whose
  only logic is the idle/visible class, tested via `VoxisOverlayHost.test.tsx`'s DOM assertions). Not obviously
  over-split — a single-file version would still need the same effects and the same test surface, just harder to
  target with `deps.mountOverlay` injection at two different granularities. No objection.
- Both `useVoxisRuntime.test.ts` and `useVoxisOverlayMount.test.tsx`/`VoxisOverlayHost.test.tsx` exist and were
  updated/added alongside the corresponding production changes (not left stale).

## Minors

- `VoxisOverlayHost.tsx`'s doc comment and `keypanel.css`'s comment both assert the "recording"/"transcribing"
  visible-states claim identically (copy-pasted intent) — when Finding 1 is fixed, both copies need the same
  correction, not just one.
- `useVoxisOverlayMount.ts`'s mount effect primes the just-mounted element with `applyState`/`applyLevel` but
  *not* `applyResult` ("Prime the just-mounted element with whatever this hook already knows... rather than
  waiting for the next event to arrive" — only two of three). Given `lastResult` is fire-and-forget/transient
  (paste already happened via `routeVoxisResult`, and the overlay's `applyResult` doc is described as clearing
  its OWN tracked session id, not re-displaying old content), omitting priming for `lastResult` reads as
  intentional rather than an oversight, but the comment doesn't say so explicitly — worth a one-line note for the
  next reader who might otherwise "fix" this into a third primed call.
- Not independently re-verified in this pass (pre-verified per task setup, taken as given): `bun` test totals,
  `tsc` cleanliness, `cargo test --locked --lib voxis`, and the full Playwright run's 8-of-9-pre-existing /
  1-real-pre-existing-bug breakdown for `theListKeepsItsPlace`. No reason found in the reviewed diff to doubt that
  characterization — the honest `tauriMock` fan-out change described above is exactly the kind of change that
  would surface a previously-vacuous double-listener test as a real (pre-existing, unrelated to Task 10's own
  plugin-bump work) failure.
