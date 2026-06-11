# Living Cell: Cilia + Startle + Growth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `drifting_contour` "living cell" feel more alive — add waving **cilia/tentacles** ("усы") around the membrane, a **startle reflex** (the cell darts/jolts on sharp audio onsets — "шарахается"), and **biological growth** during speech (the cell enlarges while you talk, relaxes in silence), reusing the growth accumulator the radiolarian already proved out.

**Architecture:** The cell renderer (`renderers/cell.ts`) already has FBM membrane + form-memory + nucleus + iridescence. We add three orthogonal, independently-tested concerns: (a) pure `ciliaEndpoints()` geometry for hair-like protrusions; (b) pure `startleOffset()` that converts a rising audio edge into a brief positional jolt with spring-like decay; (c) reuse of `growthLevel()` — which currently lives in `radiolarian.ts` and must first be promoted to `shared.ts` (DRY) so both organisms share one implementation. The renderer composes these; all new math is pure + unit-tested.

**Tech Stack:** TypeScript, Canvas 2D, Vanilla DOM themes, Vitest + jsdom, Bun.build bundler. Theme contract `mount(container, api)` / apiVersion 1.

**SOLID / DRY / KISS rationale:**
- **DRY** — `growthLevel` is organism-agnostic; Task 1 moves it to `shared.ts` and updates radiolarian to import it, so the cell reuses the exact same accumulator (no copy-paste). `noise2D`/`integrateDeformation` already shared.
- **SRP** — each new behavior is its own pure function (`ciliaEndpoints`, `startleOffset`); the renderer only composes + draws.
- **OCP** — additive: new params on `CellParams`, new draw passes; the membrane/nucleus/iridescence code is untouched in behavior. Other cell-less themes unaffected.
- **KISS** — startle is a simple edge-detector + exponential decay, not a physics engine. Cilia are short line segments with noise wobble, not hair simulation.
- **DIP** — cell.ts depends on shared.ts abstractions, not on radiolarian.ts.

**Anti-goals (YAGNI):** no per-cilium collision, no 3D, no new deps. Bundle stays self-contained. The startle must stay subtle (a few px jolt) so the overlay never looks broken.

---

## File Structure

- **Modify** `src/theme-engine/renderers/shared.ts` — add `growthLevel` (moved from radiolarian) + `TAU` already present. Export it.
- **Modify** `src/theme-engine/renderers/radiolarian.ts` — delete local `growthLevel`, import from `./shared`. No behavior change (its tests stay green).
- **Modify** `src/theme-engine/renderers/cell.ts` — add `ciliaEndpoints`, `startleOffset` pure functions; new `CellParams` fields + defaults; renderer composes growth (shared) + startle (position jolt) + cilia (draw pass). Keep membrane/nucleus/iridescence intact.
- **Modify** `src/theme-engine/renderers/__tests__/shared.test.ts` — add `growthLevel` tests (moved/new).
- **Modify** `src/theme-engine/renderers/__tests__/radiolarian.test.ts` — its `growthLevel` import now resolves via re-export or direct shared import; keep green.
- **Modify** `src/theme-engine/renderers/__tests__/cell.test.ts` — add tests for `ciliaEndpoints`, `startleOffset`, and a renderer smoke test that exercises the new params.
- **Modify** `src/theme-engine/builtin/drifting_contour/index.ts` — pass new params (cilia count/length, startle strength, growth rates) tuned for 172×36.
- **Regenerate** `src-tauri/themes/drifting_contour/theme.js` via `bun run build:themes`.

---

## Task 1: Promote `growthLevel` to `shared.ts` (DRY)

**Files:**
- Modify: `src/theme-engine/renderers/shared.ts` (add `growthLevel`)
- Modify: `src/theme-engine/renderers/radiolarian.ts` (import from `./shared`, delete local)
- Modify: `src/theme-engine/renderers/__tests__/shared.test.ts` (add tests)

`growthLevel` is an organism-agnostic asymmetric accumulator. Move it so both cell + radiolarian share one copy.

- [ ] **Step 1: Add failing test in shared.test.ts**

Append to `src/theme-engine/renderers/__tests__/shared.test.ts` imports: add `growthLevel` to the `from "../shared"` import. Then add:

```ts
describe("growthLevel", () => {
  it("rises fast (attack) toward audio during recording", () => {
    const g = growthLevel(0, 1.0, "recording", 0.5, 0.01);
    expect(g).toBeCloseTo(0.5); // moved halfway in one step at attack 0.5
  });
  it("falls slowly (release) toward 0 in silence", () => {
    const g = growthLevel(1.0, 0, "idle", 0.5, 0.01);
    expect(g).toBeGreaterThan(0.98); // barely shrinks at release 0.01
  });
  it("attack faster than release", () => {
    const up = growthLevel(0, 1, "recording", 0.4, 0.02);
    const down = growthLevel(1, 0, "recording", 0.4, 0.02);
    expect(up).toBeGreaterThan(1 - down);
  });
  it("clamps to [0,1]", () => {
    expect(growthLevel(0, 5, "recording", 1, 1)).toBeLessThanOrEqual(1);
    expect(growthLevel(0, -5, "recording", 1, 1)).toBeGreaterThanOrEqual(0);
  });
  it("target is 0 outside recording (transcribing/idle/error)", () => {
    expect(growthLevel(0.5, 1, "transcribing", 0.5, 0.5)).toBeLessThan(0.5);
    expect(growthLevel(0.5, 1, "idle", 0.5, 0.5)).toBeLessThan(0.5);
  });
});
```

- [ ] **Step 2: Run — verify fail**

Run: `bunx vitest run src/theme-engine/renderers/__tests__/shared.test.ts`
Expected: FAIL — `growthLevel` not exported from shared.

- [ ] **Step 3: Move `growthLevel` into shared.ts**

In `shared.ts`, add (it needs `ThemeMode` — import the type from `../contract`):

```ts
import type { ThemeMode } from "../contract";

/**
 * Asymmetric growth accumulator: rises toward `audioLevel` during recording
 * at `attack` (fast), relaxes toward 0 otherwise at `release` (slow). Clamped
 * to [0,1]. Organism-agnostic — used by both cell and radiolarian.
 */
export function growthLevel(
  prevGrowth: number,
  audioLevel: number,
  mode: ThemeMode,
  attack: number,
  release: number,
): number {
  const target = mode === "recording" ? Math.max(0, Math.min(1, audioLevel)) : 0;
  const rate = target >= prevGrowth ? attack : release;
  const raw = prevGrowth + (target - prevGrowth) * rate;
  return Math.max(0, Math.min(1, raw));
}
```

- [ ] **Step 4: Update radiolarian.ts to import it**

In `radiolarian.ts`: DELETE the local `growthLevel` function. Add `growthLevel` to the existing `import { ... } from "./shared";`. If radiolarian.test.ts imported `growthLevel` from `../radiolarian`, EITHER re-export it from radiolarian (`export { growthLevel } from "./shared";`) OR update that test's import to `../shared`. Prefer updating the test import to `../shared` (cleaner — growth is shared now).

- [ ] **Step 5: Run shared + radiolarian + theme-engine**

Run: `bunx vitest run src/theme-engine`
Expected: PASS — shared growth tests green, radiolarian tests still green (181-ish).

- [ ] **Step 6: Typecheck + commit**

Run: `bunx tsc --noEmit` → clean.

```bash
git add src/theme-engine/renderers/shared.ts src/theme-engine/renderers/radiolarian.ts src/theme-engine/renderers/__tests__/shared.test.ts src/theme-engine/renderers/__tests__/radiolarian.test.ts
git commit -m "refactor(renderers): promote growthLevel to shared.ts (DRY for cell + radiolarian)"
```

---

## Task 2: `startleOffset` — the "шарахается" jolt (pure)

**Files:**
- Modify: `src/theme-engine/renderers/cell.ts` (add `startleOffset` + a small stateful helper interface)
- Modify: `src/theme-engine/renderers/__tests__/cell.test.ts` (tests)

A startle is a brief positional dart when audio spikes sharply. We detect a rising edge (current level minus a slow-tracking baseline) and emit a decaying offset vector in a (noise-chosen) direction. KISS: pure function takes previous startle magnitude + current/baseline level and returns the new magnitude; the renderer maps magnitude→(dx,dy) using a noise-chosen angle.

- [ ] **Step 1: Failing tests (append to cell.test.ts)**

Add `import { startleOffset } from "../cell";` (merge into existing cell import). Then:

```ts
describe("startleOffset", () => {
  // startleOffset(prevMag, level, baseline, sensitivity, decay) -> newMag in [0,1]
  it("fires on a sharp rising edge (level >> baseline)", () => {
    const m = startleOffset(0, 0.9, 0.1, 2.0, 0.85);
    expect(m).toBeGreaterThan(0.3); // a jolt was triggered
  });
  it("does not fire when level ~ baseline (steady sound)", () => {
    const m = startleOffset(0, 0.5, 0.5, 2.0, 0.85);
    expect(m).toBeLessThan(0.05);
  });
  it("decays toward 0 when no new edge", () => {
    const m = startleOffset(1.0, 0.2, 0.2, 2.0, 0.85);
    expect(m).toBeLessThan(1.0);
    expect(m).toBeGreaterThan(0.5); // decay 0.85 → keeps 85%
  });
  it("clamps to [0,1] and never negative", () => {
    expect(startleOffset(0, 5, 0, 10, 0.9)).toBeLessThanOrEqual(1);
    expect(startleOffset(0, 0, 1, 2, 0.9)).toBeGreaterThanOrEqual(0);
  });
  it("takes the max of decayed-previous and new-edge (sustained startle holds)", () => {
    // strong previous, weak edge → stays high via decay, not reset by edge
    const m = startleOffset(0.9, 0.3, 0.3, 2.0, 0.9);
    expect(m).toBeCloseTo(0.81, 1); // 0.9 * 0.9 decay
  });
});
```

- [ ] **Step 2: Run — verify fail**

Run: `bunx vitest run src/theme-engine/renderers/__tests__/cell.test.ts -t startleOffset`
Expected: FAIL — `startleOffset` not exported.

- [ ] **Step 3: Implement `startleOffset` in cell.ts**

```ts
/**
 * Startle reflex magnitude (the cell "darts" on a sharp audio onset).
 *
 * Detects a rising edge as (level - baseline) scaled by `sensitivity`; the new
 * magnitude is the MAX of the decayed previous magnitude and this fresh edge,
 * so a jolt rises instantly and then springs back via `decay` (per-frame factor
 * in [0,1], e.g. 0.85). Clamped to [0,1]. Pure & deterministic.
 *
 * The renderer converts magnitude → a small (dx,dy) using a noise-chosen angle.
 */
export function startleOffset(
  prevMag: number,
  level: number,
  baseline: number,
  sensitivity: number,
  decay: number,
): number {
  const edge = Math.max(0, (level - baseline) * sensitivity);
  const decayed = prevMag * Math.max(0, Math.min(1, decay));
  return Math.max(0, Math.min(1, Math.max(decayed, edge)));
}
```

- [ ] **Step 4: Run — verify pass**

Run: `bunx vitest run src/theme-engine/renderers/__tests__/cell.test.ts -t startleOffset`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/theme-engine/renderers/cell.ts src/theme-engine/renderers/__tests__/cell.test.ts
git commit -m "feat(cell): startleOffset — sharp-onset jolt magnitude (pure)"
```

---

## Task 3: `ciliaEndpoints` — waving hair-like tentacles ("усы") (pure)

**Files:**
- Modify: `src/theme-engine/renderers/cell.ts` (add `Cilium` interface + `ciliaEndpoints`)
- Modify: `src/theme-engine/renderers/__tests__/cell.test.ts` (tests)

Cilia are many short protrusions around the membrane, each waving via noise. Each cilium has a base (on the membrane radius at its angle) and a tip (base + outward length, with a lateral wobble). Length grows with energy + growth.

- [ ] **Step 1: Failing tests (append to cell.test.ts)**

Add `import { ciliaEndpoints } from "../cell";` (merge). Then:

```ts
import { CELL_DEFAULTS } from "../cell";

describe("ciliaEndpoints", () => {
  const P = CELL_DEFAULTS;
  it("emits `ciliaCount` cilia", () => {
    const c = ciliaEndpoints(86, 18, 12, 1.0, 0.3, 0.2, P);
    expect(c.length).toBe(P.ciliaCount);
  });
  it("tips extend beyond their bases (outward)", () => {
    const c = ciliaEndpoints(86, 18, 12, 1.0, 0.5, 0.3, P);
    for (const cil of c) {
      const baseR = Math.hypot(cil.x1 - 86, cil.y1 - 18);
      const tipR = Math.hypot(cil.x2 - 86, cil.y2 - 18);
      expect(tipR).toBeGreaterThan(baseR);
    }
  });
  it("is deterministic", () => {
    const a = ciliaEndpoints(86, 18, 12, 2.0, 0.4, 0.2, P);
    const b = ciliaEndpoints(86, 18, 12, 2.0, 0.4, 0.2, P);
    expect(a).toEqual(b);
  });
  it("cilia get longer with growth", () => {
    const lo = ciliaEndpoints(86, 18, 12, 1.0, 0.3, 0.0, P)[0];
    const hi = ciliaEndpoints(86, 18, 12, 1.0, 0.3, 1.0, P)[0];
    const len = (c: { x1: number; y1: number; x2: number; y2: number }) =>
      Math.hypot(c.x2 - c.x1, c.y2 - c.y1);
    expect(len(hi)).toBeGreaterThan(len(lo));
  });
});
```

- [ ] **Step 2: Run — verify fail**

Run: `bunx vitest run src/theme-engine/renderers/__tests__/cell.test.ts -t ciliaEndpoints`
Expected: FAIL — `ciliaEndpoints` not exported (and `ciliaCount` missing from params).

- [ ] **Step 3: Add params + implement (cell.ts)**

Add to `CellParams` (with doc comments) and `CELL_DEFAULTS`:

```ts
  /** Number of cilia (hair-like tentacles) around the membrane. */
  ciliaCount: number;        // default 18
  /** Resting cilium length as fraction of baseR. */
  ciliaLength: number;       // default 0.45
  /** Extra cilium length from growth (fraction of baseR). */
  ciliaGrowthBoost: number;  // default 0.6
  /** Lateral wave amplitude of cilia tips (radians of angular sway). */
  ciliaWave: number;         // default 0.5
  /** Cilia wave speed. */
  ciliaWaveSpeed: number;    // default 1.6
```

Defaults block additions: `ciliaCount: 18, ciliaLength: 0.45, ciliaGrowthBoost: 0.6, ciliaWave: 0.5, ciliaWaveSpeed: 1.6,`

Implementation:

```ts
export interface Cilium { x1: number; y1: number; x2: number; y2: number; }

/**
 * Hair-like cilia around the membrane. Each cilium base sits on the cell
 * radius at its angle; the tip extends outward by (ciliaLength + growth*
 * ciliaGrowthBoost)*baseR and sways laterally via a per-cilium noise wave.
 * Energy makes them a touch longer/livelier. Pure & deterministic given t.
 *
 * @param cx,cy   Cell center (already including any startle offset).
 * @param baseR   Base cell radius in pixels.
 * @param t       Continuous time (seconds).
 * @param energy  Cell energy [0,1].
 * @param growth  Growth level [0,1].
 */
export function ciliaEndpoints(
  cx: number,
  cy: number,
  baseR: number,
  t: number,
  energy: number,
  growth: number,
  params: CellParams,
): Cilium[] {
  const out: Cilium[] = [];
  const n = Math.max(1, params.ciliaCount);
  const lenPx = baseR * (params.ciliaLength + growth * params.ciliaGrowthBoost) * (0.7 + energy * 0.6);
  for (let k = 0; k < n; k++) {
    const baseAngle = (k / n) * TAU;
    // per-cilium lateral sway via noise (each hair waves slightly differently)
    const sway = noise2D(k * 5.3, t * params.ciliaWaveSpeed) * params.ciliaWave;
    const tipAngle = baseAngle + sway;
    const x1 = cx + baseR * Math.cos(baseAngle);
    const y1 = cy + baseR * Math.sin(baseAngle);
    const x2 = cx + (baseR + lenPx) * Math.cos(tipAngle);
    const y2 = cy + (baseR + lenPx) * Math.sin(tipAngle);
    out.push({ x1, y1, x2, y2 });
  }
  return out;
}
```

- [ ] **Step 4: Run — verify pass**

Run: `bunx vitest run src/theme-engine/renderers/__tests__/cell.test.ts -t ciliaEndpoints`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/theme-engine/renderers/cell.ts src/theme-engine/renderers/__tests__/cell.test.ts
git commit -m "feat(cell): ciliaEndpoints — waving hair-like tentacles (pure)"
```

---

## Task 4: Compose in the renderer — growth swell, startle jolt, cilia draw

**Files:**
- Modify: `src/theme-engine/renderers/cell.ts` (`createCellRenderer` tick + persistent state + CellParams startle/growth fields)
- Modify: `src/theme-engine/renderers/__tests__/cell.test.ts` (renderer smoke test for new params)

Wire the three behaviors into the existing tick (read `cell.ts:470+`). Add persistent state vars; reuse `growthLevel` from shared; offset the cell center by the startle vector; draw cilia UNDER the membrane fill so they look attached.

- [ ] **Step 1: Add the remaining params + smoke test**

Add to `CellParams` + `CELL_DEFAULTS`:

```ts
  /** Growth attack per-frame (fast rise during speech). */
  growthAttack: number;     // default 0.05
  /** Growth release per-frame (slow shrink in silence). */
  growthRelease: number;    // default 0.012
  /** How much growth swells the cell radius (fraction). */
  growthSwell: number;      // default 0.22
  /** Startle sensitivity (edge gain). */
  startleSensitivity: number; // default 2.2
  /** Startle decay per-frame [0,1]. */
  startleDecay: number;       // default 0.86
  /** Startle max displacement in px. */
  startleMaxPx: number;       // default 5
  /** Baseline tracking rate for startle edge detection. */
  startleBaselineRate: number; // default 0.08
```

Defaults: `growthAttack: 0.05, growthRelease: 0.012, growthSwell: 0.22, startleSensitivity: 2.2, startleDecay: 0.86, startleMaxPx: 5, startleBaselineRate: 0.08,`

Append a renderer smoke test (use the existing rAF/canvas stub pattern in cell.test.ts's `describe("createCellRenderer")`):

```ts
it("renders with cilia + startle + growth params without throwing", () => {
  const container = document.createElement("div");
  const r = createCellRenderer(container, {
    width: 172, height: 36,
    params: { ciliaCount: 20, startleSensitivity: 3, growthSwell: 0.3 },
  });
  expect(() => {
    r.update({ mode: "recording", audioLevel: 0.9, spectrumBins: new Array(32).fill(0.7) });
    r.update({ mode: "recording", audioLevel: 0.1, spectrumBins: new Array(32).fill(0.1) });
  }).not.toThrow();
  r.destroy();
  expect(container.innerHTML).toBe("");
});
```

- [ ] **Step 2: Run — verify smoke fails or passes trivially, then implement**

Run: `bunx vitest run src/theme-engine/renderers/__tests__/cell.test.ts -t "cilia + startle + growth"`
Expected: passes once params exist (renderer doesn't use them yet) — that's fine; the real check is the behavior wiring below + no regression.

- [ ] **Step 3: Wire the renderer tick (cell.ts `createCellRenderer`)**

Add imports: ensure `growthLevel` is imported from `./shared` (merge into the existing shared import). Add persistent state near `let deform`:

```ts
  let growth = 0;
  let startle = 0;
  let baseline = 0; // slow-tracking audio baseline for startle edge detection
```

Inside `tick()`, after computing `energy` and BEFORE building points, add:

```ts
      // Biological growth (shared accumulator) + startle reflex.
      growth = growthLevel(growth, s.audioLevel, s.mode, params.growthAttack, params.growthRelease);
      baseline = baseline + (s.audioLevel - baseline) * params.startleBaselineRate;
      startle = startleOffset(startle, s.audioLevel, baseline, params.startleSensitivity, params.startleDecay);
      // Startle direction: a noise-chosen angle that drifts slowly.
      const startleAngle = TAU * noise2D(900.5, t * 0.7);
      const sdx = Math.cos(startleAngle) * startle * params.startleMaxPx;
      const sdy = Math.sin(startleAngle) * startle * params.startleMaxPx;
```

Then change the center used for drawing to include the jolt, and swell the radius with growth. Find where `cx`/`cy`/`baseR` are computed in the tick and replace with:

```ts
      const cx = width / 2 + sdx;
      const cy = height / 2 + sdy;
      const baseR = Math.min(width, height) * params.radiusFraction * (1 + growth * params.growthSwell);
```

(Everything downstream that already uses `cx`/`cy`/`baseR` — membrane points, nucleus, fill gradient — now follows the jolt + swell automatically. The existing `maxRadius = height * 0.46` clamp keeps the swollen cell inside the window.)

Add the CILIA draw pass — draw it FIRST (under the cytoplasm fill) so hairs look attached beneath the membrane. Right after `if (ctx) { ctx.clearRect(...) }` block starts drawing, before the fill, insert:

```ts
      // --- Cilia (under the membrane) ---
      {
        const cilia = ciliaEndpoints(cx, cy, baseR, t, energy, growth, params);
        ctx.lineCap = "round";
        ctx.lineWidth = 1;
        for (const c of cilia) {
          ctx.strokeStyle = hsla(baseHue, 0.6, 0.6, 0.35 + 0.35 * energy);
          ctx.beginPath();
          ctx.moveTo(c.x1, c.y1);
          ctx.lineTo(c.x2, c.y2);
          ctx.stroke();
        }
      }
```

NOTE: the existing tick computes `cx,cy,baseR` LATER (around the membrane-points loop). You must hoist those three consts up to the position shown (right after the startle/growth block) and DELETE the later duplicate declarations so cilia + membrane + nucleus all use the same jolted/swollen values. Verify no `const cx`/`cy`/`baseR` redeclaration remains.

- [ ] **Step 4: Run full theme-engine + typecheck**

Run: `bunx vitest run src/theme-engine`
Expected: PASS — all cell tests (including new cilia/startle), radiolarian, shared green.

Run: `bunx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/theme-engine/renderers/cell.ts src/theme-engine/renderers/__tests__/cell.test.ts
git commit -m "feat(cell): compose growth swell + startle jolt + cilia draw in renderer"
```

---

## Task 5: Tune drifting_contour params + rebuild bundle

**Files:**
- Modify: `src/theme-engine/builtin/drifting_contour/index.ts`
- Regenerate: `src-tauri/themes/drifting_contour/theme.js`

- [ ] **Step 1: Pass new params in the theme wrapper**

In `src/theme-engine/builtin/drifting_contour/index.ts`, add to the `params` object (before `...userParams`):

```ts
      // cilia ("усы"), startle ("шарахается"), growth ("растёт как живая")
      ciliaCount: 18,
      ciliaLength: 0.4,
      ciliaGrowthBoost: 0.55,
      ciliaWave: 0.5,
      ciliaWaveSpeed: 1.6,
      growthAttack: 0.05,
      growthRelease: 0.012,
      growthSwell: 0.2,
      startleSensitivity: 2.2,
      startleDecay: 0.86,
      startleMaxPx: 4,
      startleBaselineRate: 0.08,
```

- [ ] **Step 2: Rebuild themes + verify self-contained**

Run: `bun run build:themes`
Expected: prints `built drifting_contour` among 10 themes.

Run: `grep -nE '^import |require\(' src-tauri/themes/drifting_contour/theme.js`
Expected: NO output (self-contained).

- [ ] **Step 3: Commit**

```bash
git add src/theme-engine/builtin/drifting_contour/index.ts src-tauri/themes/drifting_contour/theme.js
git commit -m "feat(themes): drifting_contour gains cilia, startle, and growth"
```

---

## Task 6: Full verification + live check + ship

**Files:** none (verification only)

- [ ] **Step 1: Full suites**

Run: `bun run test:run` → all green (was 1140 + new cell/shared tests).
Run: `bunx tsc --noEmit` → clean.
Run: `bun run lint` → 0 errors (3 pre-existing warnings OK).
Run: `cd src-tauri && cargo test --lib` → 854 green; `cd ..`.

- [ ] **Step 2: Build app + sync user theme**

Run: `bun run build` then `cd src-tauri && cargo build && cd ..`.

```bash
cp src-tauri/themes/drifting_contour/theme.js ~/.config/soupawhisper/themes/drifting_contour/theme.js
```

- [ ] **Step 3: Live visual check (debug build + screenshots)**

Launch debug build detached:
```bash
DISPLAY=:0 XAUTHORITY=/tmp/xauth_UYrikP setsid bash -c './src-tauri/target/debug/voice >/tmp/cell2.log 2>&1' & disown
```
Drive via debug socket (`~/.config/com.soupawhisper.voice/debug.sock`): `set_handy_theme drifting_contour`, `set_overlay_state recording`, then a loop of `emit_audio_level` (vary 0.2..0.95 with sudden spikes to trigger startle) + `emit_spectrum`. Capture a frame strip over ~8s. Confirm: (a) waving cilia/усы around the membrane, (b) the cell jolts/darts on a sudden loud spike (startle), (c) the cell grows over sustained speech and relaxes in silence. Tune params if any effect is too weak/strong; re-bundle + re-sync + re-commit if you change params.

- [ ] **Step 4: Ship**

```bash
git checkout main && git merge feature/living-cell-cilia-startle-growth --no-edit
git branch -d feature/living-cell-cilia-startle-growth
git push gitverse main
cd src-tauri && cargo build --release && cd ..
```

---

## Self-Review (run before execution)

**Spec coverage:**
- "усы шарахаются" (waving tentacles) → Task 3 `ciliaEndpoints` (per-cilium noise sway) + Task 4 draw pass. ✓
- "шарахаться" (dart/jolt on sound) → Task 2 `startleOffset` + Task 4 center-offset wiring. ✓
- "расти как живая" (biological growth) → Task 1 shared `growthLevel` + Task 4 radius swell. ✓
- Cloned/separate? — this ENHANCES the existing living cell (drifting_contour), per the user asking to "доделать" (finish) the deformed cell, not clone. The radiolarian was the separate clone. ✓

**Placeholder scan:** every code step has full code; no TBD. ✓

**Type consistency:** `growthLevel` signature identical between shared.ts (Task 1) and its callers (radiolarian unchanged, cell Task 4). `startleOffset(prevMag, level, baseline, sensitivity, decay)` consistent Task 2↔4. `ciliaEndpoints(cx,cy,baseR,t,energy,growth,params)` consistent Task 3↔4. New `CellParams` fields (ciliaCount, ciliaLength, ciliaGrowthBoost, ciliaWave, ciliaWaveSpeed, growthAttack, growthRelease, growthSwell, startleSensitivity, startleDecay, startleMaxPx, startleBaselineRate) defined in Tasks 3+4 and consumed in Task 4 + tuned in Task 5. ✓

**Risk:** Task 4 hoists `cx/cy/baseR` — must delete the old later declarations or tsc errors on redeclare. The smoke tests + tsc catch this. Startle must stay subtle (startleMaxPx 4-5) so the overlay doesn't look broken.

---

## Execution Handoff

1. **Subagent-Driven (recommended)** — fresh subagent per task (implementer `o/deepseek-v4-pro`), review (`o/gpt-5.5`) between tasks.
2. **Inline Execution** — batch with checkpoints.
