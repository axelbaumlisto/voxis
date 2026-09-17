# Review T45 r1 — Behaviour-preserving split of useVoxisRuntime

VERDICT: APPROVE

Method: diffed BEFORE (`/tmp/ado.C4YWdv/sdk/useVoxisRuntime_before.ts`, 649 lines)
against AFTER (`useVoxisRuntime.ts` composer + `useVoxisSession.ts` +
`useVoxisConsent.ts` + `useVoxisSettings.ts` + `rules/holdReleaseFunnel.ts`),
plus the two rule diffs in `diff_T45.patch` (voxisHoldChip/voxisPillPress) and
the test set. Judged semantics, not the summary. All 8 checkpoints hold.

## Findings

None at blocker/major severity. Behaviour is preserved across all eight
checkpoints; two low-severity observations are in Minors.

## Checked OK

1. **Single app-lifetime subscription (still exactly ONE, StrictMode-safe).**
   The entire mount effect moved verbatim from BEFORE (the `useEffect(..., [client])`
   with `cancelled`/`unlistenState|Level|Result`) into
   `useVoxisSession.ts:120-224`. Byte-for-byte identical control flow:
   - client acquisition via `getVoxisClient()` + `forceClientRerender`
     (before ~L235-250 → session L127-140);
   - `cancelled` re-checked after EACH awaited `onState`/`onLevel`/`onResult`
     with `resolvedUnlisten*()` called on the late-resolve path
     (before ~L300-360 → session L161-206) — the zombie-listener guard is intact;
   - `onResult` guards `if (cancelled) return` before clearing
     `activeSessionIdRef`/pasting (before ~L330 → session L189-206), so a
     late zombie never double-pastes.
   The composer (`useVoxisRuntime.ts:154-165`) calls `useVoxisSession` ONCE;
   its effect is keyed `[client]`, and a composer re-render does not change
   `client` identity (`clientRef.current ?? undefined`, session L100), so no
   double-subscribe. The `attemptStartRef.current = consent.attemptStart`
   assignment (composer L167) is a render-phase ref write — it triggers no
   effect and cannot cause a re-subscribe. Test coverage:
   `useVoxisSession.test.ts:34-42` (subscribe exactly once) and `:117-129`
   (cleanup-before-resolve unlisten once); `useVoxisRuntime.test.ts:400-462`
   (same level/cancel/StrictMode assertions retained).

2. **pendingStart/stopRequested race — identical transitions.**
   `startNow`/`stopActive`/`toggle`/`holdStart`/`holdStop` moved verbatim into
   `useVoxisSession.ts:226-296`. Enumerated both versions:
   - `startNow`: sets `pendingStartRef=startPromise`; on resolve, clears it iff
     still the same promise, then `if (stopRequestedRef) { clear; client.stop(id); return }`
     else `activeSessionIdRef=id`; catch clears both (before ~L365-395 → session L226-256). Identical.
   - `stopActive`: id≠null → `client.stop(id)`; else if `pendingStartRef≠null`
     → `stopRequestedRef=true` (before ~L398-410 → session L258-269). Identical.
   - `toggle`: `recording || pendingStart≠null` → stop; `≠idle` → no-op; idle →
     `attemptStart("toggle")` (before ~L412-421 → session L271-281). Identical
     (only `void attemptStart(...)` → `attemptStart(...)` because the composer's
     `attemptStart` is now `(mode)=>void`; the composer re-adds the `void` at
     `useVoxisRuntime.ts:150-152`).
   - `holdStart`/`holdStop`: same idle-gate / `recording||pending` stop
     (before ~L423-440 → session L283-296). Identical.
   Test: `useVoxisSession.test.ts:73-92` (toggle-while-pending stops once on
   resolve) and `useVoxisRuntime.test.ts:270-334` retained.

3. **Consent gate — checked BEFORE any start; mode captured; no stale closure.**
   `attemptStart`/`acceptConsent`/`declineConsent` moved verbatim into
   `useVoxisConsent.ts:47-93` (before ~L335-455). Order preserved:
   `pendingModeRef=mode` → `getProfile` → `resolveVoxisProvider` →
   `decideVoxisConsent` → either show dialog (remember `providerHost`/mode) or
   `startNow(mode)`. `acceptConsent`: `markProviderConsented` → `setConsent(true)`
   (catch swallowed) → `startNow(pendingModeRef.current)`. `declineConsent`:
   clears dialog + host, no start.
   The cycle-break (composer L143-167) is sound: `attemptStartRef` holds the
   LATEST `consent.attemptStart`, reassigned every render; the session receives
   a STABLE wrapper (`useCallback []`). `pendingModeRef`/`pendingProviderHostRef`
   are `useRef`s, stable across renders, so even when `consent.attemptStart`
   identity changes the mode set at prompt time survives to `acceptConsent` —
   no stale mode/closure. Test: `useVoxisConsent.test.ts:37-54` asserts
   accept resumes `startNow` under the SAME mode the gate was entered with
   ("hold"), `:56-63` decline never starts, `:26-35` gate-before-start.

4. **Result routing → paste / clipboard fallback unchanged.**
   `routeVoxisResult(result.text, {hasActivePane, isActivePaneClosed,
   pasteToActivePane, writeClipboardText, notifyCopiedNoActivePane,
   notifyCopiedActivePaneClosed})` moved verbatim into `useVoxisSession.ts:190-205`
   (before ~L325-338); `writeClipboardText` default `?? writeClipboardTextIpc`
   preserved (session L96). Test: `useVoxisSession.test.ts:95-106` +
   `useVoxisRuntime.test.ts:203-242` (active vs closed-pane fallback).

5. **hotkey boot-apply + permissionDenied + theme + profile + imports.**
   All moved verbatim into `useVoxisSettings.ts` with the SAME error handling:
   boot `setHotkey(load…)` → `setHotkeyError(null)` / parse rejection →
   `notifyHotkeyPermissionDenied` only on `permissionDenied` (settings L103-121);
   `getProfile` → status + `hotkeyHoldMs` (finite guard) + `profileTheme`
   (settings L122-137); `refreshProfileStatus`/`setHotkeyPref`/`setThemePref`/
   `importProfileFromDesktop` (NotFound→notify) / `importProfileFromFile`
   identical to before. `parseHotkeyRejection` copied verbatim (settings L31-38).
   `theme` memo `[themePref, profileTheme]` preserved (settings L90-98).
   Boot effect keyed `[client]`-only (settings L100-155) → runs ONCE when the
   session-resolved client first becomes defined, matching the single pre-split
   mount effect's net once-run behaviour. Tests: `useVoxisSettings.test.ts:28-131`
   cover each path; `useVoxisRuntime.test.ts:484-671` retained.

6. **Returned `VoxisRuntime` — same 22 fields, identities equal-or-more stable.**
   Field-by-field the composer return (`useVoxisRuntime.ts:170-195`) matches
   BEFORE's return object exactly. No field added/removed/renamed. Callback
   dep arrays checked against BEFORE:
   - `toggle`/`holdStart`/`holdStop`: `[buttonState, stopActive, attemptStart]` —
     the injected `attemptStart` is now the composer's STABLE wrapper, so these
     are equal-or-MORE stable than before (before's `attemptStart` changed with
     `[client, startNow]`). No new instability.
   - `acceptConsent`/`declineConsent`/`consent.attemptStart`: same deps
     `[client, startNow]` / `[]` as before.
   - settings callbacks (`setHotkeyPref [client, notifyHotkeyPermissionDenied]`,
     `refreshProfileStatus [client]`, `importProfileFromDesktop
     [client, refreshProfileStatus, notifyProfileImportNotFound]`,
     `importProfileFromFile [client, refreshProfileStatus]`, `setThemePref []`):
     identical to before.
   No newly-unstable identity that would re-run App effects each render.

7. **holdReleaseFunnel — start-once/stop-once equal to both prior machines.**
   `createHoldReleaseFunnel` (`rules/holdReleaseFunnel.ts:63-86`) is a faithful
   extraction of the two previously-duplicated latches:
   - `voxisHoldChip.ts`: its private `release()` + `holding` guard replaced by
     `funnel.start`/`funnel.release` mapped onto the four named DOM paths
     (diff L2044-2126). Same semantics: start-once, stop-once, second
     pointerdown while holding no-ops.
   - `voxisPillPress.ts`: `deps.onHoldStart` → `hold.start()`,
     per-branch `onHoldStop` → `hold.release()` on `up()`(holding)/`cancel()`/
     `dragArmed()` (diff L2127-2213). `pending`→toggle vs `holding`→hold vs
     `drag-armed` distinction preserved (phase machine + clock untouched);
     `lostpointercapture` ends a hold in both controls (chip: dedicated handler;
     pill: caller wires it to `cancel()`, doc L47-56). The `cancel()`-while-
     `pending` path is a funnel no-op = the old "aborted gesture is not a tap"
     behaviour. Tests: `holdReleaseFunnel.test.ts:11-45` (latch semantics) +
     `:69-138` compose the REAL chip and pill to assert each release path stops
     exactly once; `voxisHoldChip.test.ts`/`voxisPillPress.test.ts` unchanged
     and passing (not in diff) — direct evidence of preserved behaviour.

8. **Tests — none deleted; moved assertions kept; new tests assert behaviour.**
   `useVoxisRuntime.test.ts` (688 lines) is RETAINED UNCHANGED (not in the diff)
   and runs against the new composer — a full end-to-end regression harness over
   the split. New focused tests added: `useVoxisSession.test.ts`,
   `useVoxisConsent.test.ts`, `useVoxisSettings.test.ts`, `holdReleaseFunnel.test.ts`,
   plus `testing/voxisFakeClient.ts` helper. Sampled assertions target behaviour
   (state/level/result, the iOS race, StrictMode unlisten, consent mode capture,
   boot hotkey apply, import routing) — not mock internals. `voxisHoldChip.test.ts`
   and `voxisPillPress.test.ts` untouched. No test file removed.

## Minors

- **M1 (low, informational): client-call order is no longer strictly sequential.**
  In BEFORE, one mount effect issued `state → setHotkey → getProfile →
  onState → onLevel → onResult` in a single awaited chain. AFTER, the session
  effect (`state → onState/onLevel/onResult`) and the settings effect
  (`setHotkey → getProfile`) are two independent `[client]`-keyed effects that
  interleave at await points. These are independent IPC calls with no documented
  ordering dependency, so end state is identical; flagging only because the exact
  relative call order changed. No fix needed.

- **M2 (low, intentional/safety): pillPress double-`down` now suppresses a
  duplicate `onHoldStart`.** In BEFORE, a degenerate `down()` while a hold was
  already live (a down with no intervening up/cancel) would let the timer fire
  `deps.onHoldStart()` a second time. AFTER, `hold.start()` is a funnel no-op
  when already holding (`holdReleaseFunnel.ts:70-77`), so no second `onHoldStart`.
  This is unreachable via real pointer sequences (pointer capture guarantees an
  up/cancel before the next down) and matches the funnel's documented
  start-once contract — a safety improvement, not a regression. No fix needed.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Review-only task: produced the requested review artifact (VERDICT + Findings + Checked OK + Minors) at the mandated path without modifying any source under review."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Each of the 8 checkpoints carries BEFORE→AFTER file:line references (e.g. before ~L365-395 → useVoxisSession.ts:226-256) and cites the covering tests, sufficient for an independent acceptance review."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "grep -n '^diff --git' /tmp/ado.C4YWdv/sdk/diff_T45.patch",
      "result": "passed",
      "summary": "enumerated the 9 changed/new files in the patch"
    },
    {
      "command": "find src/lib '**/useVoxis*.test.*' and rules test globs",
      "result": "passed",
      "summary": "confirmed useVoxisRuntime.test.ts retained + 3 new hook tests + funnel/chip/pill tests present; none deleted"
    },
    {
      "command": "grep -n 'test(|expect(' new hook + funnel test files",
      "result": "passed",
      "summary": "verified new tests assert behaviour (state, race, consent mode, boot apply, funnel once-semantics), not mocks"
    }
  ],
  "validationOutput": [
    "Diffed 4 AFTER hooks + holdReleaseFunnel against the 649-line BEFORE monolith and the two rule diffs; all 8 checkpoints behaviour-equal.",
    "Single subscription: mount effect moved verbatim, [client]-keyed, composer calls useVoxisSession once, ref write is render-phase (no re-subscribe).",
    "pendingStart/stopRequested, consent mode-capture, result routing, boot hotkey/theme/profile/imports, returned-object identities: all preserved.",
    "Two low-severity observations (M1 call-order interleave, M2 pill double-down start-once) are behaviour-neutral/safety-positive."
  ],
  "residualRisks": [
    "M1: session vs settings run as two concurrent effects, so exact client-call order differs from the single pre-split chain; independent IPC calls, no ordering dependency assumed.",
    "Pre-verified test results (496 targeted, tsc, Playwright) were taken as given, not re-run in this review-only pass."
  ],
  "noStagedFiles": true,
  "diffSummary": "No source changed by this task; review artifact only. Underlying T45 diff is a behaviour-preserving split of useVoxisRuntime into session/consent/settings hooks + a shared holdReleaseFunnel.",
  "reviewFindings": [
    "no blockers",
    "minor: M1 useVoxisSettings.ts:100 / useVoxisSession.ts:120 - client-call order now interleaved across two effects; independent calls, behaviour-neutral",
    "minor: M2 voxisPillPress.ts:118 - double-down now suppresses duplicate onHoldStart via funnel start-once; unreachable via real pointers, safety-positive"
  ],
  "manualNotes": "Applied memory constraints: no commits, no `find /`, no ~/.cargo scan, no writes outside the mandated output path. VERDICT: APPROVE."
}
```
