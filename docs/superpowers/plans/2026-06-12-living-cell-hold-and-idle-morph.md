# Living Cell: Hold Growth + Idle Morphing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two refinements to the `drifting_contour` "living cell":
1. **"Остаётся на последней позиции"** — once the cell grows during speech it KEEPS that size/shape and does NOT shrink back to the base form during silence (hold the peak).
2. **"Меняет форму периодически в режиме покоя"** — even at rest (idle, no audio), the cell slowly + periodically reshapes its membrane (organic morphing), so it never looks frozen.

**Architecture:** The cell renderer already has FBM membrane + form-memory (asymmetric attack/release `integrateDeformation`) + a `growthLevel` accumulator (now in `shared.ts`). 
- Request 1 is achieved by setting **`growthRelease: 0`**: `growthLevel` only rises when `target >= prevGrowth`; with release 0, in silence (`target = 0 < growth`) the rate is 0, so growth holds its peak. No new code — a tuning change, but verified by a unit test asserting the hold behavior.
- Request 2 adds a new **pure** `idleMorph(sampleCount, t, params)` returning per-vertex deformation fractions: slow traveling organic bumps modulated by a periodic envelope (waxes/wanes in cycles). It is **gated by an idle factor** (1 in idle, 0 while recording) passed into the deformation build, so morphing only happens at rest and never fights audio-driven deformation. Form-memory (`integrateDeformation`) smooths it.

**Tech Stack:** TypeScript, Canvas 2D, vanilla DOM themes, Vitest + jsdom, Bun.build bundler. Theme contract `mount(container, api)` / apiVersion 1.

**SOLID / DRY / KISS rationale:**
- **KISS** — request 1 is a single param (`growthRelease: 0`) leveraging existing math; no special-case code.
- **SRP** — `idleMorph` is its own pure, deterministic function; the renderer only composes + gates it.
- **OCP** — additive: a new pure function + new `CellParams` fields + one extra term in `buildTargetDeformation`, gated by a new `idleFactor` argument. Recording behavior unchanged when `idleFactor = 0`.
- **DRY** — reuses `noise2D`/`TAU` from `shared.ts`; reuses the existing form-memory smoothing rather than inventing new smoothing.
- **DIP** — depends on `shared.ts` math abstractions.

**Anti-goals (YAGNI):** no new shape engine, no per-vertex physics, no new deps. Idle morph must stay gentle (a slow breathing reshape, not jitter) and must NOT enlarge the cell beyond the existing `maxRadius` clamp. Growth hold must not break the radiolarian (which also uses `growthLevel` — it keeps its own `growthRelease` default, unchanged).

---

## File Structure

- **Modify** `src/theme-engine/renderers/cell.ts`:
  - add `idleMorph(sampleCount, t, params): number[]` pure function.
  - add `CellParams` fields: `idleMorphAmplitude`, `idleMorphSpeed`, `idleMorphPeriod`, `idleMorphFloor`; add to `CELL_DEFAULTS`.
  - change `buildTargetDeformation` to accept an `idleFactor: number` argument and add `idleMorph(...) [i] * idleFactor` to each vertex.
  - in `createCellRenderer` tick: compute `idleFactor` from mode/audioLevel and pass it; set growth hold via param (default change only).
- **Modify** `src/theme-engine/renderers/__tests__/cell.test.ts`:
  - tests for `idleMorph` (count, determinism, bounded, periodic envelope, zero at floor=0 baseline check).
  - test that `buildTargetDeformation` with `idleFactor=0` equals the pre-change behavior (no idle morph), and `idleFactor=1` adds morph.
  - a `growthLevel` hold test (release 0 → growth never decreases in silence) — add in cell.test.ts or shared.test.ts.
- **Modify** `src/theme-engine/builtin/drifting_contour/index.ts`:
  - set `growthRelease: 0` (hold) and pass idle-morph params.
- **Regenerate** `src-tauri/themes/drifting_contour/theme.js` via `bun run build:themes`.

NOTE on `buildTargetDeformation` signature change: it is called in exactly ONE place (the tick) and exported for tests. Update the call site + all its tests to pass the new `idleFactor` argument (append it as the LAST parameter to avoid reshuffling existing args).

---

## Task 1: Growth holds its peak (no shrink-back) — `growthRelease: 0`

**Files:**
- Modify: `src/theme-engine/renderers/__tests__/shared.test.ts` (hold test)
- Modify: `src/theme-engine/builtin/drifting_contour/index.ts` (set growthRelease 0) — done in Task 4, but the unit guarantee lives here.

`growthLevel(prev, level, mode, attack, release)` already holds the peak when `release = 0`: in silence `target = 0 < prev` ⇒ `rate = release = 0` ⇒ value unchanged. We lock this with a test so a future edit can't silently break "stays at last position".

- [ ] **Step 1: Failing/guard test (append to shared.test.ts `growthLevel` describe)**

```ts
  it("with release 0, holds its peak forever in silence (stays at last position)", () => {
    let g = 0;
    // grow during speech
    for (let i = 0; i < 40; i++) g = growthLevel(g, 0.8, "recording", 0.05, 0);
    const peak = g;
    expect(peak).toBeGreaterThan(0.3);
    // long silence — must NOT shrink
    for (let i = 0; i < 200; i++) g = growthLevel(g, 0, "idle", 0.05, 0);
    expect(g).toBeCloseTo(peak, 10);
  });
  it("with release 0, can still grow further on a louder later breath", () => {
    let g = growthLevel(0.4, 0.4, "recording", 0.5, 0); // ~0.4
    g = growthLevel(g, 0.9, "recording", 0.5, 0);        // rises toward 0.9
    expect(g).toBeGreaterThan(0.4);
  });
```

- [ ] **Step 2: Run**

Run: `bunx vitest run src/theme-engine/renderers/__tests__/shared.test.ts -t growthLevel`
Expected: PASS immediately (the math already supports this — these are guard tests proving request 1 is achievable purely via `growthRelease: 0`). If either FAILS, the growthLevel math is wrong — stop and report.

- [ ] **Step 3: Commit**

```bash
git add src/theme-engine/renderers/__tests__/shared.test.ts
git commit -m "test(cell): lock growth-hold (release 0 keeps peak; still grows on louder breath)"
```

---

## Task 2: `idleMorph` — periodic resting reshape (pure)

**Files:**
- Modify: `src/theme-engine/renderers/cell.ts` (add params + `idleMorph`)
- Modify: `src/theme-engine/renderers/__tests__/cell.test.ts` (tests)

At rest the cell should slowly + periodically reshape. `idleMorph` returns per-vertex deformation fractions: a slow traveling FBM-ish bump pattern times a periodic envelope that waxes and wanes (so the reshape comes in gentle cycles, never frozen, never violent).

- [ ] **Step 1: Failing tests (append to cell.test.ts)**

Add `idleMorph` to the `from "../cell"` import. Then:

```ts
describe("idleMorph", () => {
  const P = CELL_DEFAULTS;
  it("returns one value per sample", () => {
    expect(idleMorph(96, 1.0, P).length).toBe(96);
  });
  it("is deterministic", () => {
    expect(idleMorph(96, 2.3, P)).toEqual(idleMorph(96, 2.3, P));
  });
  it("stays within a gentle bound (|d| <= idleMorphAmplitude)", () => {
    for (const tt of [0, 1.7, 5.0, 12.4]) {
      for (const d of idleMorph(64, tt, P)) {
        expect(Math.abs(d)).toBeLessThanOrEqual(P.idleMorphAmplitude + 1e-9);
      }
    }
  });
  it("changes over time (not frozen)", () => {
    const a = idleMorph(64, 0.0, P);
    const b = idleMorph(64, 4.0, P);
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
    expect(diff).toBeGreaterThan(0.01);
  });
  it("envelope waxes and wanes (overall magnitude varies across a period)", () => {
    const mag = (arr: number[]) => arr.reduce((s, v) => s + Math.abs(v), 0);
    // sample several times across one envelope period; max should exceed min noticeably
    const mags: number[] = [];
    const period = P.idleMorphPeriod;
    for (let k = 0; k < 8; k++) mags.push(mag(idleMorph(64, (k / 8) * period, P)));
    expect(Math.max(...mags)).toBeGreaterThan(Math.min(...mags) * 1.3);
  });
  it("respects the floor (envelope never fully zero when floor > 0)", () => {
    const mag = (arr: number[]) => arr.reduce((s, v) => s + Math.abs(v), 0);
    // with default floor > 0 there is always some morph somewhere
    let any = 0;
    for (let k = 0; k < 8; k++) any += mag(idleMorph(48, k * 0.9, P));
    expect(any).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run — verify fail**

Run: `bunx vitest run src/theme-engine/renderers/__tests__/cell.test.ts -t idleMorph`
Expected: FAIL — `idleMorph` not exported (and params missing).

- [ ] **Step 3: Add params + implement (cell.ts)**

Add to `CellParams` (with doc comments) and `CELL_DEFAULTS`:

```ts
  /** Idle resting morph amplitude (deformation fraction of baseR). */
  idleMorphAmplitude: number;  // default 0.18
  /** Idle morph traveling speed (how fast bumps move around the membrane). */
  idleMorphSpeed: number;      // default 0.25
  /** Idle morph envelope period in seconds (wax/wane cycle). */
  idleMorphPeriod: number;     // default 7
  /** Idle morph minimum envelope (0..1): residual morph at the trough. */
  idleMorphFloor: number;      // default 0.25
```

Defaults additions: `idleMorphAmplitude: 0.18, idleMorphSpeed: 0.25, idleMorphPeriod: 7, idleMorphFloor: 0.25,`

Implementation (place near the other pure functions, e.g. after `buildTargetDeformation`):

```ts
/**
 * Resting-state membrane morphing. Returns per-vertex deformation fractions
 * (added to baseR) that slowly travel around the cell and wax/wane on a
 * periodic envelope, so an idle cell keeps gently reshaping instead of
 * freezing. Pure & deterministic given t.
 *
 * - Two traveling lobes via noise on (angle ± moving phase) give an organic,
 *   non-repeating bump pattern.
 * - A cosine envelope over `idleMorphPeriod` seconds, lifted to a floor in
 *   [idleMorphFloor, 1], modulates overall magnitude (gentle breathing of the
 *   reshape itself).
 * - Output is clamped to ±idleMorphAmplitude.
 */
export function idleMorph(
  sampleCount: number,
  t: number,
  params: CellParams,
): number[] {
  const out: number[] = [];
  // envelope in [floor, 1]
  const phase = (Math.cos((TAU * t) / Math.max(0.01, params.idleMorphPeriod)) + 1) / 2; // 0..1
  const env = params.idleMorphFloor + (1 - params.idleMorphFloor) * phase;
  const travel = t * params.idleMorphSpeed;
  for (let i = 0; i < sampleCount; i++) {
    const a = (i / sampleCount) * TAU;
    // two slowly traveling lobes for an organic, evolving outline
    const n1 = noise2D(Math.cos(a) * 1.6 + travel, Math.sin(a) * 1.6 - travel * 0.7);
    const n2 = noise2D(Math.cos(a) * 3.1 - travel * 0.5, Math.sin(a) * 3.1 + travel * 0.9);
    const raw = (n1 * 0.65 + n2 * 0.35); // in ~[-1,1]
    let d = raw * params.idleMorphAmplitude * env;
    // clamp to amplitude
    const cap = params.idleMorphAmplitude;
    if (d > cap) d = cap; else if (d < -cap) d = -cap;
    out.push(d);
  }
  return out;
}
```

- [ ] **Step 4: Run — verify pass**

Run: `bunx vitest run src/theme-engine/renderers/__tests__/cell.test.ts -t idleMorph`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/theme-engine/renderers/cell.ts src/theme-engine/renderers/__tests__/cell.test.ts
git commit -m "feat(cell): idleMorph — periodic resting membrane reshape (pure)"
```

---

## Task 3: Wire idleMorph into deformation (gated by idleFactor)

**Files:**
- Modify: `src/theme-engine/renderers/cell.ts` (`buildTargetDeformation` gains optional `idleFactor`, tick computes + passes it)
- Modify: `src/theme-engine/renderers/__tests__/cell.test.ts` (gating tests)

`buildTargetDeformation` gets a NEW LAST parameter `idleFactor = 0` (optional, default 0 ⇒ all 14 existing call sites + tests stay valid and unchanged in behavior). When `idleFactor > 0`, add `idleMorph[i] * idleFactor` to each vertex. The tick computes `idleFactor` = high at rest, fading to 0 as audio rises, so morphing only shows when quiet and never fights speech-driven deformation.

- [ ] **Step 1: Failing tests (append to cell.test.ts `buildTargetDeformation` describe)**

```ts
  it("idleFactor defaults to 0 → no idle morph added (back-compat)", () => {
    const p = CELL_DEFAULTS;
    const a = buildTargetDeformation(200, 200, zeroBins, 3.0, 0, 0.1, p);
    const b = buildTargetDeformation(200, 200, zeroBins, 3.0, 0, 0.1, p, 0);
    expect(a).toEqual(b);
  });
  it("idleFactor=1 adds idle morph (differs from idleFactor=0)", () => {
    const p = CELL_DEFAULTS;
    const off = buildTargetDeformation(200, 200, zeroBins, 3.0, 0, 0.1, p, 0);
    const on = buildTargetDeformation(200, 200, zeroBins, 3.0, 0, 0.1, p, 1);
    let diff = 0;
    for (let i = 0; i < off.length; i++) diff += Math.abs(off[i] - on[i]);
    expect(diff).toBeGreaterThan(0.01);
  });
```

(Note: `zeroBins` already defined in this test file as a 32-zero array.)

- [ ] **Step 2: Run — verify fail**

Run: `bunx vitest run src/theme-engine/renderers/__tests__/cell.test.ts -t buildTargetDeformation`
Expected: FAIL — `buildTargetDeformation` doesn't accept the 8th arg yet (the `on` call passes 1 but it's ignored ⇒ `on` equals `off` ⇒ second test fails).

- [ ] **Step 3: Implement (cell.ts)**

Change the signature (append optional last param, default 0):

```ts
export function buildTargetDeformation(
  width: number,
  height: number,
  bins: number[],
  t: number,
  audioLevel: number,
  energy: number,
  params: CellParams,
  idleFactor: number = 0,
): number[] {
```

Inside the loop, after the existing `out.push(...)` is computed, fold in the idle morph. Cleanest: compute the morph array ONCE before the loop and add per-vertex:

```ts
  const morph = idleFactor > 0 ? idleMorph(sampleCount, t, params) : null;
```

(declare `const sampleCount = 96;` is already at top of the function — reuse it.) Then change the push to:

```ts
    const idle = morph ? morph[i] * idleFactor : 0;
    out.push(fbmDeform + pseudoDeform + binDeform + idle);
```

- [ ] **Step 4: Wire the tick (createCellRenderer)**

In the tick, compute an idle factor that is ~1 when quiet/idle and fades out with audio + recording. Right before the `buildTargetDeformation(` call, add:

```ts
      // Idle morphing only when at rest: full at idle/silence, fades as audio rises
      // or while actively recording, so it never fights speech-driven deformation.
      const recordingFade = s.mode === "recording" ? 0.3 : 1;
      const idleFactor = Math.max(0, 1 - s.audioLevel * 3) * recordingFade;
```

Then pass `idleFactor` as the new LAST argument to `buildTargetDeformation(... , params, idleFactor)`.

- [ ] **Step 5: Run full theme-engine + tsc**

Run: `bunx vitest run src/theme-engine`
Expected: PASS — all existing + new tests green (the 14 old buildTargetDeformation calls still pass via the default).

Run: `bunx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/theme-engine/renderers/cell.ts src/theme-engine/renderers/__tests__/cell.test.ts
git commit -m "feat(cell): gate idleMorph into deformation via idleFactor (rest-only)"
```

---

## Task 4: Tune drifting_contour + rebuild bundle

**Files:**
- Modify: `src/theme-engine/builtin/drifting_contour/index.ts`
- Regenerate: `src-tauri/themes/drifting_contour/theme.js`

- [ ] **Step 1: Update theme params**

In `src/theme-engine/builtin/drifting_contour/index.ts` params object (BEFORE `...userParams`):
- change `growthRelease` to `0` (hold last position; if not present, add `growthRelease: 0,`).
- add idle morph params:
  ```ts
  idleMorphAmplitude: 0.16,
  idleMorphSpeed: 0.22,
  idleMorphPeriod: 7,
  idleMorphFloor: 0.3,
  ```

- [ ] **Step 2: Rebuild + verify self-contained**

Run: `bun run build:themes` → prints `built drifting_contour` among 10 themes.
Run: `grep -nE '^import |require\(' src-tauri/themes/drifting_contour/theme.js` → MUST be empty.

- [ ] **Step 3: Commit**

```bash
git add src/theme-engine/builtin/drifting_contour/index.ts src-tauri/themes/drifting_contour/theme.js
git commit -m "feat(themes): drifting_contour holds growth + morphs at rest"
```

---

## Task 5: Full verification + live check + ship

**Files:** none (verification only)

- [ ] **Step 1: Full suites**

Run: `bun run test:run` → all green.
Run: `bunx tsc --noEmit` → clean.
Run: `bun run lint` → 0 errors (3 pre-existing warnings OK).
Run: `cd src-tauri && cargo test --lib && cd ..` → 854 green.

- [ ] **Step 2: Build + sync user theme**

Run: `bun run build` then `cd src-tauri && cargo build && cd ..`.
```bash
cp src-tauri/themes/drifting_contour/theme.js ~/.config/soupawhisper/themes/drifting_contour/theme.js
```

- [ ] **Step 3: Live check (controller does this; documented for completeness)**

Launch debug build via setsid (DISPLAY=:0 XAUTHORITY=/tmp/xauth_UYrikP). Drive debug socket: set_handy_theme drifting_contour; set_overlay_state recording; ramp audio up to grow the cell; then set_overlay_state idle / emit silence and observe over ~15s that (a) the cell STAYS large (does not shrink to base) and (b) the membrane keeps slowly reshaping at rest. Capture a strip.

- [ ] **Step 4: Ship**

```bash
git checkout main && git merge feature/living-cell-hold-idle-morph --no-edit
git branch -d feature/living-cell-hold-idle-morph
git push gitverse main
cd src-tauri && cargo build --release && cd ..
```
After release build, if `bun run build:themes` re-touched other bundles (e.g. radiolarian) commit them too.

---

## Self-Review (run before execution)

**Spec coverage:**
- "остаётся на последней позиции" → Task 1 (growthRelease 0, locked by hold test) + Task 4 (theme sets it). Growth keeps cell size + cilia length at the peak. ✓
- "меняет форму периодически в режиме покоя" → Task 2 (`idleMorph` with periodic envelope) + Task 3 (gated by idleFactor, rest-only) + Task 4 (theme enables it). ✓

**Back-compat:** `buildTargetDeformation` new arg is optional (default 0) ⇒ 14 existing call sites + tests unchanged; recording behavior identical when idleFactor≈0. ✓

**No-regression to radiolarian:** it uses `growthLevel` but its OWN `growthRelease` default (unchanged); idleMorph/idleFactor are cell-only. ✓

**Type consistency:** `idleMorph(sampleCount, t, params)` Task 2↔3. `buildTargetDeformation(...,params, idleFactor=0)` Task 3 signature ↔ tick call. New CellParams: idleMorphAmplitude/Speed/Period/Floor defined Task 2, consumed Task 3, tuned Task 4. ✓

**Risk:** idle morph could enlarge the cell past the window — but the existing `maxRadius = height*0.46` clamp in the tick caps every vertex; amplitude 0.16 is well within. Growth hold means the cell can stay big across sessions — acceptable per the user's explicit request; the maxRadius clamp still bounds it.

**Placeholder scan:** every code step has full code; no TBD. ✓

---

## Execution Handoff

Subagent-Driven: implementer `o/deepseek-v4-pro` per task; reviewer `o/fable-5` after Task 3 (the wiring) and before ship.
