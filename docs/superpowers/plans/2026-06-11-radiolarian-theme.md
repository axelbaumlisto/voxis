# Radiolarian Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new builtin overlay theme **"Radiolarian"** — a luminous, glass-skeleton marine microorganism (radial symmetric spiked shell with hexagonal-pore lattice that pulses and rotates with voice) — as a *separate renderer*, reusing the existing pure math primitives.

**Architecture:** Today `cell.ts` is one 856-line renderer mixing pure math (noise/fbm/spline/integration/hsla) with one specific *amoeba* visual. The radiolarian is a visually different organism (radial symmetry, rigid glass struts, pore lattice, spikes — no amoeboid pseudopods), so it gets its OWN renderer `radiolarian.ts`. To honor DRY without bloating either file, we first extract the *shared, organism-agnostic* primitives (`noise2D`, `fbm`, `catmullRom`, `integrateDeformation`, `lowpassRadii`, `hsla`) into a new `renderers/shared.ts` module, re-export them from `cell.ts` for backward-compat, then build `radiolarian.ts` on top of `shared.ts`. The new theme is a thin `mount()` wrapper just like every other builtin.

**Tech Stack:** TypeScript, HTML5 Canvas 2D, Vanilla DOM (no React in themes), Vitest + jsdom, Bun.build theme bundler. Theme contract: `mount(container, api)` / `apiVersion 1`, state pushed via `api.onState`.

**SOLID / DRY / KISS rationale:**
- **SRP** — `shared.ts` owns reusable math; `radiolarian.ts` owns only radiolarian geometry + drawing; the theme `index.ts` owns only parameter wiring. Each file has one reason to change.
- **OCP** — new organism = new renderer + new theme dir; **zero edits** to `cell.ts`'s behavior (only a mechanical primitive-extraction with re-exports). The theme system is extended, not modified.
- **DIP** — `radiolarian.ts` depends on the `shared.ts` abstractions (pure functions) and the `Renderer`/`ThemeState` contracts, not on `cell.ts`.
- **DRY** — noise/spline/integration/hsla are written once in `shared.ts` and consumed by both renderers. No copy-paste of the permutation table or spline kernel.
- **KISS** — radiolarian deformation reuses the *same* attack/release form-memory and FBM the cell already proved out; we add only what is genuinely new (radial strut geometry + pore lattice + spikes). No physics engine, no per-frame allocation storms.

**Anti-goals (YAGNI):** no flagella, no 3D, no inter-frame particle systems, no new npm deps, no manifest schema changes. Bundled `theme.js` must stay self-contained (no bare imports) — the bundler inlines `shared.ts`.

---

## File Structure

- **Create** `src/theme-engine/renderers/shared.ts` — organism-agnostic pure math extracted from `cell.ts`: `PERM`/`PERM2`, `smoothstep`, `lerp`, `noise2D`, `fbm`, `catmullRom`, `lowpassRadii`, `integrateDeformation`, `hsla`, and the `TAU` constant. All `export`ed.
- **Modify** `src/theme-engine/renderers/cell.ts` — delete the moved primitives, `import` them from `./shared`, and add `export ... from "./shared"` re-exports so existing imports/tests keep working. No behavioral change.
- **Create** `src/theme-engine/renderers/radiolarian.ts` — `RadiolarianParams`, `RADIOLARIAN_DEFAULTS`, pure geometry functions (`shellRadius`, `strutEndpoints`, `poreLattice`, `spikeLength`, `radiolarianEnergy`), and the `createRadiolarianRenderer(container, opts)` factory (own rAF loop, mirrors `createCellRenderer` lifecycle).
- **Create** `src/theme-engine/renderers/__tests__/shared.test.ts` — move the primitive tests here (or add coverage) so `shared.ts` is tested in isolation.
- **Create** `src/theme-engine/renderers/__tests__/radiolarian.test.ts` — TDD tests for every pure radiolarian function + a renderer smoke test.
- **Create** `src/theme-engine/builtin/radiolarian/index.ts` — thin `mount()` wrapper calling `createRadiolarianRenderer` with tuned params (reads `api.params` for manifest overrides).
- **Create** `src/theme-engine/builtin/radiolarian/manifest.json` — manifest v2, `id: "radiolarian"`, `entry: "theme.js"`.
- **Build output (generated, do not hand-edit)** `src-tauri/themes/radiolarian/{theme.js,theme.json}` — produced by `bun run build:themes`.

**Theme identity reminder:** folder name is the authoritative theme id (loader warns on manifest mismatch). The dir MUST be named `radiolarian`.

---

## Task 1: Extract shared math primitives into `shared.ts` (DRY foundation)

**Files:**
- Create: `src/theme-engine/renderers/shared.ts`
- Modify: `src/theme-engine/renderers/cell.ts` (remove primitives, import + re-export from `./shared`)
- Create: `src/theme-engine/renderers/__tests__/shared.test.ts`

Rationale: before adding a second organism, lift the organism-agnostic kernels so both renderers consume one copy (DRY) and each file has a single responsibility (SRP).

- [ ] **Step 1: Write failing test for `shared.ts`**

Create `src/theme-engine/renderers/__tests__/shared.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  noise2D, fbm, catmullRom, lowpassRadii, integrateDeformation, hsla, TAU,
} from "../shared";

describe("shared primitives", () => {
  it("noise2D is deterministic and bounded", () => {
    expect(noise2D(1.5, 2.5)).toBe(noise2D(1.5, 2.5));
    for (let i = 0; i < 50; i++) {
      const v = noise2D(i * 0.37, i * 0.71);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
  it("fbm sums octaves deterministically and stays bounded", () => {
    const v = fbm(0.3, 0.7, 4, 2.0, 0.5);
    expect(v).toBe(fbm(0.3, 0.7, 4, 2.0, 0.5));
    expect(Math.abs(v)).toBeLessThanOrEqual(1.0001);
  });
  it("catmullRom passes through control points (closed)", () => {
    const pts: Array<[number, number]> = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const out = catmullRom(pts, 4);
    expect(out.length).toBe(pts.length * 4);
    // First emitted point of each span equals the control point (t=0).
    expect(out[0][0]).toBeCloseTo(0); expect(out[0][1]).toBeCloseTo(0);
    expect(out[4][0]).toBeCloseTo(10); expect(out[4][1]).toBeCloseTo(0);
  });
  it("lowpassRadii blends prev toward next", () => {
    expect(lowpassRadii([0], [10], 0)[0]).toBeCloseTo(10); // tension 0 = jump
    expect(lowpassRadii([0], [10], 1)[0]).toBeCloseTo(0);  // tension 1 = frozen
  });
  it("integrateDeformation attack faster than release", () => {
    const up = integrateDeformation([0], [1], 0.5, 0.01)[0];
    const down = integrateDeformation([1], [0], 0.5, 0.01)[0];
    expect(up).toBeCloseTo(0.5);     // grew at attack
    expect(down).toBeGreaterThan(0.98); // relaxed slowly at release
  });
  it("hsla formats a CSS string", () => {
    expect(hsla(120, 0.5, 0.6, 0.8)).toBe("hsla(120,50%,60%,0.8)");
  });
  it("TAU is two pi", () => { expect(TAU).toBeCloseTo(Math.PI * 2); });
});
```

- [ ] **Step 2: Run it — verify it fails (module missing)**

Run: `bunx vitest run src/theme-engine/renderers/__tests__/shared.test.ts`
Expected: FAIL — `Cannot find module '../shared'`.

- [ ] **Step 3: Create `shared.ts` by moving primitives verbatim from `cell.ts`**

Create `src/theme-engine/renderers/shared.ts` and MOVE (cut) these from `cell.ts` exactly as they are today, adding `export` where needed:
- `const PERM` (the 256-entry permutation table) and `const PERM2`
- `function smoothstep`, `function lerp` (export both)
- `export function noise2D`
- `export function fbm`
- `export function lowpassRadii`
- `export function integrateDeformation`
- `export function catmullRom`
- the `hsla` helper — rename-export as `export function hsla(...)`
- `export const TAU = Math.PI * 2;`

Add a top doc comment:

```ts
/**
 * shared.ts — organism-agnostic pure math for canvas overlay renderers.
 *
 * SRP: deterministic numeric kernels only (noise, fbm, spline, temporal
 * integration, color). No DOM, no canvas, no organism-specific geometry.
 * DRY: consumed by cell.ts (amoeba) and radiolarian.ts (glass shell) alike.
 */
```

- [ ] **Step 4: Rewire `cell.ts` to import + re-export from `./shared`**

At the top of `cell.ts`, replace the deleted definitions with:

```ts
import {
  noise2D, fbm, catmullRom, lowpassRadii, integrateDeformation, hsla, lerp, TAU,
} from "./shared";

// Backward-compat re-exports: existing imports of these from "./cell" keep working.
export { noise2D, fbm, catmullRom, lowpassRadii, integrateDeformation, TAU } from "./shared";
```

Keep `cell.ts`'s own `hsla`/`lerp` usages pointing at the imported versions (delete the local copies). Do NOT change any cell behavior.

- [ ] **Step 5: Run shared + cell + full theme-engine tests**

Run: `bunx vitest run src/theme-engine`
Expected: PASS — shared.test.ts green AND all existing cell tests still green (they may import these symbols from `../cell`; the re-export keeps them valid).

- [ ] **Step 6: Typecheck + commit**

Run: `bunx tsc --noEmit` → clean.

```bash
git add src/theme-engine/renderers/shared.ts src/theme-engine/renderers/cell.ts src/theme-engine/renderers/__tests__/shared.test.ts
git commit -m "refactor(renderers): extract organism-agnostic math into shared.ts (DRY for new themes)"
```

---

## Task 2: Radiolarian shell geometry — `shellRadius` + `radiolarianEnergy`

**Files:**
- Create: `src/theme-engine/renderers/radiolarian.ts`
- Create: `src/theme-engine/renderers/__tests__/radiolarian.test.ts`

The shell is a near-circular *rigid* glass test: a base radius with mild FBM bumpiness (much stiffer than the cell's amoeba) plus an audio-driven breathing pulse. Symmetry is enforced by sampling FBM on a wrapped angle so the outline is N-fold symmetric.

- [ ] **Step 1: Write the failing tests**

Create `src/theme-engine/renderers/__tests__/radiolarian.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  RADIOLARIAN_DEFAULTS, radiolarianEnergy, shellRadius,
} from "../radiolarian";

const P = RADIOLARIAN_DEFAULTS;

describe("radiolarianEnergy", () => {
  it("idle returns a small positive breathing value", () => {
    const e = radiolarianEnergy("idle", 0, 1.0, P);
    expect(e).toBeGreaterThan(0);
    expect(e).toBeLessThan(0.5);
  });
  it("recording rises with audio level (monotonic-ish)", () => {
    const lo = radiolarianEnergy("recording", 0.1, 1.0, P);
    const hi = radiolarianEnergy("recording", 0.9, 1.0, P);
    expect(hi).toBeGreaterThan(lo);
    expect(hi).toBeLessThanOrEqual(1);
  });
});

describe("shellRadius", () => {
  it("is deterministic", () => {
    expect(shellRadius(1.0, 2.0, 0.3, P)).toBe(shellRadius(1.0, 2.0, 0.3, P));
  });
  it("is N-fold symmetric: r(angle) ≈ r(angle + 2π/symmetry)", () => {
    const t = 3.0, energy = 0.3;
    const step = (Math.PI * 2) / P.symmetry;
    for (let k = 0; k < P.symmetry; k++) {
      const a = 0.4 + k * step;
      expect(shellRadius(a, t, energy, P)).toBeCloseTo(
        shellRadius(0.4, t, energy, P), 5,
      );
    }
  });
  it("stays within a sane band around 1.0 (rigid shell, small bumps)", () => {
    for (let i = 0; i < 60; i++) {
      const r = shellRadius(i * 0.21, 2.0, 0.4, P);
      expect(r).toBeGreaterThan(0.7);
      expect(r).toBeLessThan(1.4);
    }
  });
});
```

- [ ] **Step 2: Run — verify fail (module missing)**

Run: `bunx vitest run src/theme-engine/renderers/__tests__/radiolarian.test.ts`
Expected: FAIL — `Cannot find module '../radiolarian'`.

- [ ] **Step 3: Implement params + the two functions**

Create `src/theme-engine/renderers/radiolarian.ts`:

```ts
/**
 * radiolarian.ts — luminous glass-skeleton marine microorganism renderer.
 *
 * A radial, N-fold symmetric silica "test": a stiff bumpy shell, a lattice
 * of hexagonal-ish pores, and radial spikes that extend with voice. Built on
 * the shared math primitives (noise/fbm/spline) — SRP: only radiolarian
 * geometry + drawing live here.
 */
import { fbm, hsla, noise2D, TAU } from "./shared";
import type { ThemeState, ThemeMode } from "../contract";
import type { Renderer } from "./types";

export interface RadiolarianParams {
  /** Rotational symmetry order (number of spikes / lattice repeats). */
  symmetry: number;
  /** Base shell radius as fraction of min(width,height). */
  radiusFraction: number;
  /** FBM octaves for the (stiff) shell bumpiness. */
  octaves: number;
  /** FBM frequency multiplier per octave. */
  lacunarity: number;
  /** FBM amplitude multiplier per octave. */
  gain: number;
  /** Shell bump amplitude (small — the test is rigid glass). */
  shellAmplitude: number;
  /** Time scale for slow shell shimmer. */
  timeScale: number;
  /** Idle breathing floor (alive during silence). */
  idle: number;
  /** Audio level → energy gain during recording. */
  levelGain: number;
  /** Spike resting length as fraction of baseR (beyond the shell). */
  spikeLength: number;
  /** Audio-driven extra spike extension as fraction of baseR. */
  spikePulse: number;
  /** Number of concentric pore rings inside the shell. */
  poreRings: number;
  /** Pore dot radius in pixels (min-clamped for visibility). */
  poreRadius: number;
  /** Global rotation speed (radians/sec) — slow drift of the whole test. */
  spinSpeed: number;
}

export const RADIOLARIAN_DEFAULTS: RadiolarianParams = {
  symmetry: 6,
  radiusFraction: 0.34,
  octaves: 2,
  lacunarity: 2.0,
  gain: 0.5,
  shellAmplitude: 0.12,
  timeScale: 0.25,
  idle: 0.12,
  levelGain: 0.8,
  spikeLength: 0.5,
  spikePulse: 0.45,
  poreRings: 2,
  poreRadius: 1.2,
  spinSpeed: 0.15,
};

/** Energy: idle breathing blended with audio activity, clamped to [0,1]. */
export function radiolarianEnergy(
  mode: ThemeMode,
  audioLevel: number,
  t: number,
  params: RadiolarianParams,
): number {
  switch (mode) {
    case "idle":
      return params.idle * (1 + Math.sin(t * 0.9) * 0.25);
    case "recording":
      return Math.max(0, Math.min(1, params.idle + audioLevel * params.levelGain));
    case "transcribing":
      return Math.max(0, Math.min(1, params.idle * 0.7 + audioLevel * 0.15));
    default:
      return params.idle;
  }
}

/**
 * Shell radius fraction at a given angle. N-fold symmetric: FBM is sampled on
 * an angle wrapped into a single symmetry wedge, so r repeats every 2π/symmetry.
 * Returns a multiplier around 1.0 (baseR * shellRadius = pixels).
 */
export function shellRadius(
  angle: number,
  t: number,
  energy: number,
  params: RadiolarianParams,
): number {
  const wedge = TAU / params.symmetry;
  // Fold angle into [0, wedge) then to a symmetric triangle for seamless wrap.
  const folded = ((angle % wedge) + wedge) % wedge;
  const sym = Math.abs(folded / wedge - 0.5) * 2; // 0..1..0 triangle, period = wedge
  const n = fbm(sym * 3.0, t * params.timeScale, params.octaves, params.lacunarity, params.gain);
  const breathe = 1 + energy * 0.18;
  return (1 + n * params.shellAmplitude) * breathe;
}
```

- [ ] **Step 4: Run — verify pass**

Run: `bunx vitest run src/theme-engine/renderers/__tests__/radiolarian.test.ts`
Expected: PASS (energy + shellRadius tests green).

- [ ] **Step 5: Commit**

```bash
git add src/theme-engine/renderers/radiolarian.ts src/theme-engine/renderers/__tests__/radiolarian.test.ts
git commit -m "feat(radiolarian): shell radius + energy (N-fold symmetric glass test)"
```

---

## Task 3: Radial spikes + pore lattice (pure geometry)

**Files:**
- Modify: `src/theme-engine/renderers/radiolarian.ts` (add `spikeEndpoints`, `poreLattice`)
- Modify: `src/theme-engine/renderers/__tests__/radiolarian.test.ts` (add tests)

The spikes radiate from shell vertices outward; their length grows with audio. The pore lattice is concentric rings of small dots placed on a symmetric angular grid — the signature "glass dome with holes" look.

- [ ] **Step 1: Write failing tests (append to radiolarian.test.ts)**

```ts
import { spikeEndpoints, poreLattice } from "../radiolarian";

describe("spikeEndpoints", () => {
  it("emits exactly `symmetry` spikes", () => {
    const s = spikeEndpoints(100, 100, 20, 1.0, 0.5, RADIOLARIAN_DEFAULTS);
    expect(s.length).toBe(RADIOLARIAN_DEFAULTS.symmetry);
  });
  it("spike outer point is farther than shell at higher audio", () => {
    const lo = spikeEndpoints(100, 100, 20, 1.0, 0.0, RADIOLARIAN_DEFAULTS)[0];
    const hi = spikeEndpoints(100, 100, 20, 1.0, 1.0, RADIOLARIAN_DEFAULTS)[0];
    const dist = (p: { x1: number; y1: number; x2: number; y2: number }) =>
      Math.hypot(p.x2 - 100, p.y2 - 100);
    expect(dist(hi)).toBeGreaterThan(dist(lo));
  });
  it("inner endpoints sit on/near the shell, outer beyond it", () => {
    const sp = spikeEndpoints(100, 100, 20, 1.0, 0.5, RADIOLARIAN_DEFAULTS)[0];
    const inner = Math.hypot(sp.x1 - 100, sp.y1 - 100);
    const outer = Math.hypot(sp.x2 - 100, sp.y2 - 100);
    expect(outer).toBeGreaterThan(inner);
  });
});

describe("poreLattice", () => {
  it("returns dots on `poreRings` concentric rings, all inside the shell", () => {
    const baseR = 20;
    const dots = poreLattice(100, 100, baseR, 2.0, RADIOLARIAN_DEFAULTS);
    expect(dots.length).toBeGreaterThan(0);
    for (const d of dots) {
      const rr = Math.hypot(d.x - 100, d.y - 100);
      expect(rr).toBeLessThanOrEqual(baseR * 1.01); // inside shell
    }
  });
  it("is deterministic", () => {
    const a = poreLattice(100, 100, 20, 2.0, RADIOLARIAN_DEFAULTS);
    const b = poreLattice(100, 100, 20, 2.0, RADIOLARIAN_DEFAULTS);
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run — verify fail**

Run: `bunx vitest run src/theme-engine/renderers/__tests__/radiolarian.test.ts`
Expected: FAIL — `spikeEndpoints`/`poreLattice` not exported.

- [ ] **Step 3: Implement both functions (append to radiolarian.ts)**

```ts
export interface Spike { x1: number; y1: number; x2: number; y2: number; }

/**
 * Radial spikes from the shell outward, one per symmetry vertex. Inner point
 * sits on the shell; outer point extends by spikeLength + audio*spikePulse.
 * `spin` (t*spinSpeed) rotates the whole crown slowly.
 */
export function spikeEndpoints(
  cx: number, cy: number, baseR: number,
  t: number, audioLevel: number, params: RadiolarianParams,
): Spike[] {
  const out: Spike[] = [];
  const spin = t * params.spinSpeed;
  const ext = baseR * (params.spikeLength + audioLevel * params.spikePulse);
  for (let k = 0; k < params.symmetry; k++) {
    const a = spin + (k / params.symmetry) * TAU;
    const sr = baseR * shellRadius(a, t, params.idle, params);
    const x1 = cx + sr * Math.cos(a);
    const y1 = cy + sr * Math.sin(a);
    const x2 = cx + (sr + ext) * Math.cos(a);
    const y2 = cy + (sr + ext) * Math.sin(a);
    out.push({ x1, y1, x2, y2 });
  }
  return out;
}

export interface Pore { x: number; y: number; r: number; }

/**
 * Concentric rings of pore dots on a symmetric angular grid. Each ring i sits
 * at radius baseR*(0.35 + 0.5*i/poreRings); dots per ring scale with symmetry.
 */
export function poreLattice(
  cx: number, cy: number, baseR: number,
  t: number, params: RadiolarianParams,
): Pore[] {
  const out: Pore[] = [];
  const spin = t * params.spinSpeed * 0.5;
  const r = Math.max(0.6, params.poreRadius);
  for (let ring = 0; ring < params.poreRings; ring++) {
    const rr = baseR * (0.35 + 0.5 * (ring / Math.max(1, params.poreRings)));
    const count = params.symmetry * (ring + 1);
    const offset = ring % 2 === 0 ? 0 : (TAU / count) * 0.5; // brick-stagger
    for (let j = 0; j < count; j++) {
      const a = spin + offset + (j / count) * TAU;
      out.push({ x: cx + rr * Math.cos(a), y: cy + rr * Math.sin(a), r });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run — verify pass**

Run: `bunx vitest run src/theme-engine/renderers/__tests__/radiolarian.test.ts`
Expected: PASS (all radiolarian geometry tests green).

- [ ] **Step 5: Commit**

```bash
git add src/theme-engine/renderers/radiolarian.ts src/theme-engine/renderers/__tests__/radiolarian.test.ts
git commit -m "feat(radiolarian): radial spikes + concentric pore lattice"
```

---

## Task 4: `createRadiolarianRenderer` factory (canvas + rAF + drawing)

**Files:**
- Modify: `src/theme-engine/renderers/radiolarian.ts` (add `RadiolarianOptions` + factory)
- Modify: `src/theme-engine/renderers/__tests__/radiolarian.test.ts` (renderer smoke test)

Lifecycle MIRRORS `createCellRenderer` (read `cell.ts:681+`): create a `<canvas>` sized to opts, `getContext("2d")`, hold `latestState`, run a private rAF loop with `t=(performance.now()-startedAt)/1000`, expose `{ update(state){latestState=state}, destroy(){cancelAnimationFrame; container.innerHTML=""} }`. Use form-memory (`integrateDeformation`) on the shell radii so the test holds its bumps like the cell does.

- [ ] **Step 1: Write failing smoke test (append to radiolarian.test.ts)**

Match the rAF/canvas stubbing convention already used in `cell.test.ts` — open `src/theme-engine/renderers/__tests__/cell.test.ts`, copy its `beforeEach` canvas-2d-context mock + `requestAnimationFrame` stub setup verbatim, then:

```ts
import { createRadiolarianRenderer } from "../radiolarian";

describe("createRadiolarianRenderer", () => {
  it("mounts a canvas, accepts updates, and cleans up on destroy", () => {
    const container = document.createElement("div");
    const r = createRadiolarianRenderer(container, { width: 172, height: 36 });
    expect(container.querySelector("canvas")).not.toBeNull();
    expect(() =>
      r.update({ mode: "recording", audioLevel: 0.8, spectrumBins: new Array(32).fill(0.5) }),
    ).not.toThrow();
    // advance the stubbed rAF a few frames
    flushRaf(5); // <- use the same frame-advance helper cell.test.ts defines
    r.destroy();
    expect(container.innerHTML).toBe("");
  });
});
```

(If `cell.test.ts` advances frames differently — e.g. by capturing the rAF callback — replicate that exact helper. Do not invent a new mechanism.)

- [ ] **Step 2: Run — verify fail**

Run: `bunx vitest run src/theme-engine/renderers/__tests__/radiolarian.test.ts`
Expected: FAIL — `createRadiolarianRenderer` not exported.

- [ ] **Step 3: Implement the factory (append to radiolarian.ts)**

```ts
import { integrateDeformation } from "./shared";
import type { ThemeState } from "../contract";

export interface RadiolarianOptions {
  width: number;
  height: number;
  params?: Partial<RadiolarianParams>;
  /** Glass-cyan base hue in degrees (default 190). */
  baseHue?: number;
}

const SAMPLE_COUNT = 96;

export function createRadiolarianRenderer(
  container: HTMLElement,
  opts: RadiolarianOptions,
): Renderer {
  const params: RadiolarianParams = { ...RADIOLARIAN_DEFAULTS, ...(opts.params ?? {}) };
  const baseHue = opts.baseHue ?? 190; // luminous glass cyan
  const { width, height } = opts;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.style.display = "block";
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  let latestState: ThemeState = { mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) };
  let shellMemory: number[] | null = null; // form-memory of shell radii fractions
  const startedAt = performance.now();
  let rafId: number | null = null;

  const cx = width / 2;
  const cy = height / 2;
  const baseR = Math.min(width, height) * params.radiusFraction;

  const tick = () => {
    const t = (performance.now() - startedAt) / 1000;
    const s = latestState;

    if (ctx) {
      ctx.clearRect(0, 0, width, height);
      const energy = radiolarianEnergy(s.mode, s.audioLevel, t, params);

      // --- shell contour with form memory ---
      const target: number[] = [];
      for (let i = 0; i < SAMPLE_COUNT; i++) {
        const a = (i / SAMPLE_COUNT) * TAU + t * params.spinSpeed;
        const bin = s.spectrumBins[Math.min(s.spectrumBins.length - 1,
          Math.floor((i / SAMPLE_COUNT) * s.spectrumBins.length))] ?? 0;
        target.push(shellRadius(a, t, energy, params) + bin * 0.12 * energy);
      }
      shellMemory = shellMemory
        ? integrateDeformation(shellMemory, target, 0.25, 0.02)
        : target.slice();

      // --- spikes (under shell stroke) ---
      ctx.lineCap = "round";
      for (const sp of spikeEndpoints(cx, cy, baseR, t, s.audioLevel, params)) {
        ctx.strokeStyle = hsla(baseHue + 10, 0.85, 0.65, 0.55 + 0.35 * energy);
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(sp.x1, sp.y1); ctx.lineTo(sp.x2, sp.y2); ctx.stroke();
      }

      // --- shell: glow pass then crisp glass rim ---
      const pts: Array<[number, number]> = shellMemory.map((rf, i) => {
        const a = (i / SAMPLE_COUNT) * TAU + t * params.spinSpeed;
        const rr = baseR * rf;
        return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
      });
      const drawClosed = (lw: number, style: string) => {
        ctx.lineWidth = lw; ctx.strokeStyle = style; ctx.lineJoin = "round";
        ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.closePath(); ctx.stroke();
      };
      // translucent interior
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fillStyle = hsla(baseHue, 0.6, 0.5, 0.12 + 0.10 * energy);
      ctx.fill();
      drawClosed(3.0, hsla(baseHue + 5, 0.9, 0.7, 0.18 + 0.18 * energy)); // glow
      drawClosed(1.2, hsla(baseHue, 0.85, 0.75, 0.9));                    // crisp rim

      // --- pore lattice ---
      for (const p of poreLattice(cx, cy, baseR, t, params)) {
        ctx.fillStyle = hsla(baseHue + 6, 0.7, 0.8, 0.5 + 0.4 * energy);
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
      }
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);

  return {
    update(state: ThemeState) { latestState = state; },
    destroy() {
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      container.innerHTML = "";
    },
  };
}
```

- [ ] **Step 4: Run — verify pass + full theme-engine suite**

Run: `bunx vitest run src/theme-engine`
Expected: PASS — radiolarian smoke test green, nothing else regressed.

- [ ] **Step 5: Typecheck + commit**

Run: `bunx tsc --noEmit` → clean.

```bash
git add src/theme-engine/renderers/radiolarian.ts src/theme-engine/renderers/__tests__/radiolarian.test.ts
git commit -m "feat(radiolarian): renderer factory — spikes, glass shell, pore lattice with form memory"
```

---

## Task 5: Builtin theme wrapper + manifest

**Files:**
- Create: `src/theme-engine/builtin/radiolarian/index.ts`
- Create: `src/theme-engine/builtin/radiolarian/manifest.json`

Thin `mount()` wrapper (mirror `drifting_contour/index.ts`): construct the renderer with tuned params, read `api.params` for manifest overrides, wire `onState`→`update`, `unmount`→unsubscribe+destroy.

- [ ] **Step 1: Create the manifest**

`src/theme-engine/builtin/radiolarian/manifest.json`:

```json
{
  "manifest_version": 2,
  "id": "radiolarian",
  "name": "Radiolarian",
  "description": "Luminous glass-skeleton plankton — radial spikes, hexagonal pore lattice, cyan rim that pulses with voice",
  "api_version": 1,
  "entry": "theme.js"
}
```

- [ ] **Step 2: Create the theme wrapper**

`src/theme-engine/builtin/radiolarian/index.ts`:

```ts
/**
 * Radiolarian — a luminous marine microorganism with a glass silica skeleton.
 *
 * A radially symmetric "test": a stiff bumpy cyan shell, radial spikes that
 * extend with voice, and a concentric hexagonal-ish pore lattice. The whole
 * crown rotates slowly; during recording the spikes shoot out and the rim
 * glows. Built on the shared FBM/spline/form-memory primitives.
 */
import { createRadiolarianRenderer } from "../../renderers/radiolarian";
import type { ThemeApi, ThemeInstance } from "../../contract";

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  const userParams = (api.params && typeof api.params === "object"
    ? api.params : {}) as Record<string, unknown>;

  const renderer = createRadiolarianRenderer(container, {
    width: api.size.width,
    height: api.size.height,
    baseHue: 190, // luminous glass cyan
    params: {
      symmetry: 6,
      radiusFraction: 0.34,
      octaves: 2,
      lacunarity: 2.0,
      gain: 0.5,
      shellAmplitude: 0.12,
      timeScale: 0.25,
      idle: 0.12,
      levelGain: 0.8,
      spikeLength: 0.5,
      spikePulse: 0.45,
      poreRings: 2,
      poreRadius: 1.2,
      spinSpeed: 0.15,
      ...userParams,
    },
  });
  const unsubscribe = api.onState((s) => renderer.update(s));
  return {
    unmount() {
      unsubscribe();
      renderer.destroy();
    },
  };
}
```

- [ ] **Step 3: Build the themes and verify the bundle**

Run: `bun run build:themes`
Expected: prints `built radiolarian` among the now-**10** themes.

Run: `grep -nE '^import |require\(' src-tauri/themes/radiolarian/theme.js`
Expected: NO output (self-contained — `shared.ts` was inlined by the bundler).

Run: `test -f src-tauri/themes/radiolarian/theme.json && echo manifest-ok`
Expected: `manifest-ok`.

- [ ] **Step 4: Commit**

```bash
git add src/theme-engine/builtin/radiolarian/ src-tauri/themes/radiolarian/
git commit -m "feat(themes): radiolarian builtin theme (wrapper + manifest + bundle)"
```

---

## Task 6: Full verification + ship

**Files:** none (verification only)

- [ ] **Step 1: Frontend suite**

Run: `bun run test:run`
Expected: all green (was 1091 + new shared/radiolarian tests).

- [ ] **Step 2: Typecheck + lint**

Run: `bunx tsc --noEmit` → clean.
Run: `bun run lint` → `0 errors` (3 pre-existing warnings in useDictionary/useLlmProviders are acceptable).

- [ ] **Step 3: Rust theme-engine still green (10 themes seed)**

Run: `cd src-tauri && cargo test --lib` → green; `cd ..`.
(The seeding logic scans `src-tauri/themes/*`; the new dir is picked up automatically — no Rust change needed.)

- [ ] **Step 4: Build the app**

Run: `bun run build` → succeeds.

- [ ] **Step 5: Sync user themes dir (so the running app sees it)**

The seeder does NOT overwrite existing v2 user themes, but a brand-new theme dir IS copied on next launch. To force-sync for an already-seeded profile:

```bash
mkdir -p ~/.config/soupawhisper/themes/radiolarian
cp src-tauri/themes/radiolarian/theme.js ~/.config/soupawhisper/themes/radiolarian/theme.js
cp src-tauri/themes/radiolarian/theme.json ~/.config/soupawhisper/themes/radiolarian/theme.json
```

- [ ] **Step 6: Live visual check (debug build + screenshot)**

Launch the debug binary (release has no debug socket):
```bash
DISPLAY=:0 XAUTHORITY=/tmp/xauth_UYrikP setsid bash -c './src-tauri/target/debug/voice >/tmp/radio.log 2>&1' & disown
```
Drive it via the debug socket (`~/.config/com.soupawhisper.voice/debug.sock`): `set_handy_theme radiolarian`, `set_overlay_state recording`, then `emit_audio_level 0.8` + `emit_spectrum [...]` in a loop. Screenshot the overlay region and confirm: spiked glass shell, visible pore dots, cyan glow, spikes extending with audio. Iterate params if it doesn't read well at 172×36.

- [ ] **Step 7: Commit any tuning + final state**

```bash
git add -A && git commit -m "tune(radiolarian): params dialed for 172x36 overlay" || echo "no tuning needed"
```

---

## Self-Review (run before execution)

**Spec coverage:**
- Separate theme cloned from current → Tasks 2-5 build `radiolarian` as a distinct renderer + theme dir. ✓
- SOLID/DRY/KISS plan → Task 1 extracts shared primitives (DRY/SRP); new renderer is additive (OCP); depends on abstractions (DIP). ✓
- Radiolarian look (glass skeleton, radial symmetry, pores, spikes) → Tasks 2-4. ✓

**Placeholder scan:** every code step contains full code; no TBD/TODO. ✓

**Type consistency:** `RadiolarianParams`/`RADIOLARIAN_DEFAULTS` used identically across Tasks 2-5; `Spike`/`Pore` interfaces defined in Task 3 and consumed in Task 4; `createRadiolarianRenderer` signature matches between Task 4 and Task 5. `shellRadius`/`radiolarianEnergy`/`spikeEndpoints`/`poreLattice` names stable throughout. ✓

**Risk note:** Task 1 is the only change touching existing code. It is a mechanical move + re-export; the cell test suite is the safety net. If any cell test imports a primitive from `../cell`, the re-export in Step 4 keeps it valid — do not skip that re-export.

---

## Execution Handoff

Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task (implementer `o/deepseek-v4-pro`), two-stage review (`o/gpt-5.5`), controller reviews between tasks.
2. **Inline Execution** — batch tasks in this session with checkpoints.
