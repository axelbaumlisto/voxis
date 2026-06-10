# User Themes v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Multi-agent execution:** Tasks are grouped into phases. Tasks inside the same
> phase marked `[parallel-group:X]` touch disjoint files and MAY be dispatched to
> parallel subagents (use git worktrees). Phases are strictly sequential.
> Every subagent MUST follow TDD (test first, watch it fail, implement, watch it
> pass, commit) and respect SOLID/DRY/KISS notes embedded in each task.

**Spec:** `docs/superpowers/specs/2026-06-10-user-themes-design.md` — read it first.

**Goal:** Users write overlay themes as JS code (`mount(container, themeApi)`,
apiVersion 1). All 8 builtin themes are converted to this format. Rust keeps zero
theme semantics (engine only). Old Rust↔TS theme mirror is deleted.

**Architecture:** Theme = dir with `theme.json` (manifest v2) + `theme.js`
(self-contained ES module). TS host (`ThemeHost`) loads the module via Blob URL
`import()`, pushes state from existing `useOverlayState`, falls back to a
statically-imported default theme on any error. Rust `ThemeLoader` shrinks to
manifest scan/validate + script serving. Builtin themes live as TS sources under
`src/theme-engine/builtin/` sharing three renderers (bars/ring/pill), bundled by
`scripts/build-themes.ts` into `src-tauri/themes/<id>/theme.js`.

**Tech Stack:** Tauri v2, React 18 (host only), vanilla TS for themes/renderers,
bun build for theme bundling, vitest+jsdom, cargo test + tempfile.

---

## Phase map

| Phase | Tasks | Parallel? |
|---|---|---|
| 0. CI hygiene | 0.1 fix examples | single |
| 1. Contract + engine TS | 1.1 contract, 1.2 loader, 1.3 ThemeHost | sequential (same module) |
| 2. Renderers | 2.1 bars, 2.2 ring, 2.3 pill | **parallel-group:R** (disjoint files) |
| 3. Builtin themes + build script | 3.1 build script, 3.2 bars themes ×5, 3.3 ring themes ×3 | 3.1 first, then **parallel-group:T** |
| 4. Rust engine | 4.1 manifest loader, 4.2 commands rewire, 4.3 seeding | sequential (same module) |
| 5. Integration | 5.1 overlay.tsx switch, 5.2 ThemeSelect/settings rewire | sequential |
| 6. Deletion | 6.1 TS legacy, 6.2 Rust legacy | **parallel-group:D** |
| 7. Verification | 7.1 full test sweep + manual smoke checklist | single |

Phases 4 and (1–3) are independent — a coordinator MAY run Phase 4 in parallel
with Phases 1–3 (different languages, disjoint files).

---

## Phase 0 — CI hygiene

### Task 0.1: Fix broken examples, add examples to test script

**Files:**
- Delete: `src-tauri/examples/test_reprocess_history.rs` (references removed `LlmProcessor`)
- Delete: `src-tauri/examples/screenshot_overlay.rs`, `src-tauri/examples/test_native_overlay.rs` (native overlay gone)
- Inspect/keep: `src-tauri/examples/test_rdev.rs` (keep if it compiles)
- Modify: `package.json` scripts

- [ ] **Step 1: Verify current breakage**

Run: `cd src-tauri && cargo test 2>&1 | tail -5`
Expected: FAIL — `could not find LlmProcessor in llm` (examples)

- [ ] **Step 2: Delete dead examples**

```bash
cd src-tauri
git rm examples/test_reprocess_history.rs examples/screenshot_overlay.rs examples/test_native_overlay.rs
cargo build --examples   # must pass now; if test_rdev.rs fails too, git rm it as well
```

- [ ] **Step 3: Wire examples into test flow**

In `package.json`, change:

```json
"test:all": "vitest run && playwright test",
```

to:

```json
"test:all": "vitest run && playwright test",
"test:rust": "cd src-tauri && cargo build --examples && cargo test",
```

- [ ] **Step 4: Verify full cargo test is green**

Run: `cd src-tauri && cargo test 2>&1 | tail -3`
Expected: `test result: ok.` and no compile errors

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: remove dead examples, add test:rust script (unbreak cargo test)"
```

---

## Phase 1 — Theme Engine contract + loader + host (TypeScript)

All three tasks touch `src/theme-engine/` — run sequentially in one agent.

### Task 1.1: Contract types (apiVersion 1)

**Files:**
- Create: `src/theme-engine/contract.ts`
- Test: `src/theme-engine/__tests__/contract.test.ts`

SOLID: SRP — this file is types + one pure validator, no I/O, no DOM.

- [ ] **Step 1: Write the failing test**

```ts
// src/theme-engine/__tests__/contract.test.ts
import { describe, it, expect } from "vitest";
import { validateThemeModule, THEME_API_VERSION } from "../contract";

describe("validateThemeModule", () => {
  it("accepts a module with a mount function", () => {
    const mod = { mount: () => ({ unmount() {} }) };
    expect(validateThemeModule(mod)).toEqual({ ok: true });
  });

  it("rejects null / non-object", () => {
    expect(validateThemeModule(null).ok).toBe(false);
    expect(validateThemeModule(42).ok).toBe(false);
  });

  it("rejects module without mount", () => {
    const res = validateThemeModule({ foo: 1 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/mount/);
  });

  it("exposes API version 1", () => {
    expect(THEME_API_VERSION).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/theme-engine/__tests__/contract.test.ts`
Expected: FAIL — cannot resolve `../contract`

- [ ] **Step 3: Implement contract.ts**

```ts
// src/theme-engine/contract.ts
/**
 * Theme Engine contract — apiVersion 1.
 * SRP: types + pure module validation only. No DOM, no Tauri, no I/O.
 */
export const THEME_API_VERSION = 1 as const;

export type ThemeMode = "idle" | "recording" | "transcribing" | "error";

/** State snapshot pushed to themes on every backend event. */
export interface ThemeState {
  mode: ThemeMode;
  /** Smoothed level in [0, 1]. */
  audioLevel: number;
  /** 32 FFT bins, each in [0, 1]. */
  spectrumBins: number[];
}

export interface ThemeSize {
  width: number;
  height: number;
}

/** Everything a theme may touch. Versioned; additive changes only within v1. */
export interface ThemeApi {
  apiVersion: typeof THEME_API_VERSION;
  /** Manifest `params` object (free-form JSON owned by the theme). */
  params: unknown;
  size: ThemeSize;
  /** Subscribe to state pushes. Returns unsubscribe. Fires immediately with current state. */
  onState(cb: (state: ThemeState) => void): () => void;
  actions: {
    /** Cancel the in-flight recording (maps to Tauri cancelOperation). */
    cancel(): void;
  };
}

export interface ThemeInstance {
  unmount(): void;
}

export interface ThemeModule {
  mount(container: HTMLElement, api: ThemeApi): ThemeInstance;
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

/** Pure structural check that an imported module satisfies ThemeModule. */
export function validateThemeModule(mod: unknown): ValidationResult {
  if (mod === null || typeof mod !== "object") {
    return { ok: false, error: "theme module is not an object" };
  }
  const mount = (mod as Record<string, unknown>).mount;
  if (typeof mount !== "function") {
    return { ok: false, error: "theme module does not export mount(container, api)" };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/theme-engine/__tests__/contract.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/theme-engine && git commit -m "feat(theme-engine): apiVersion 1 contract types + module validator"
```

### Task 1.2: Module loader (Blob URL import + validation)

**Files:**
- Create: `src/theme-engine/loader.ts`
- Test: `src/theme-engine/__tests__/loader.test.ts`

SOLID: SRP — turning JS source text into a validated ThemeModule. Nothing else.
DIP — script *fetching* (Tauri command) stays outside; loader takes source text.

- [ ] **Step 1: Write the failing test**

```ts
// src/theme-engine/__tests__/loader.test.ts
import { describe, it, expect } from "vitest";
import { loadThemeModuleFromSource } from "../loader";

const GOOD_SRC = `export function mount(container, api){ return { unmount(){} }; }`;
const NO_MOUNT_SRC = `export const x = 1;`;
const SYNTAX_ERR_SRC = `export function mount( {`;

describe("loadThemeModuleFromSource", () => {
  it("imports a valid theme module", async () => {
    const mod = await loadThemeModuleFromSource(GOOD_SRC);
    expect(typeof mod.mount).toBe("function");
  });

  it("rejects a module without mount", async () => {
    await expect(loadThemeModuleFromSource(NO_MOUNT_SRC)).rejects.toThrow(/mount/);
  });

  it("rejects a module with syntax errors", async () => {
    await expect(loadThemeModuleFromSource(SYNTAX_ERR_SRC)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/theme-engine/__tests__/loader.test.ts`
Expected: FAIL — cannot resolve `../loader`

- [ ] **Step 3: Implement loader.ts**

```ts
// src/theme-engine/loader.ts
/**
 * Theme module loader.
 * SRP: source text → validated ThemeModule. Fetching the text is the
 * caller's job (Tauri command readThemeScript).
 * Uses a Blob URL + dynamic import so the theme is a real ES module
 * (user code runs unsandboxed — trusted by design, see spec).
 */
import { validateThemeModule, type ThemeModule } from "./contract";

export async function loadThemeModuleFromSource(source: string): Promise<ThemeModule> {
  const blob = new Blob([source], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  try {
    const mod: unknown = await import(/* @vite-ignore */ url);
    const res = validateThemeModule(mod);
    if (!res.ok) throw new Error(`invalid theme: ${res.error}`);
    return mod as ThemeModule;
  } finally {
    URL.revokeObjectURL(url);
  }
}
```

Note for the engineer: jsdom in vitest supports dynamic `import()` of blob URLs
only with `--pool=threads` quirks. If the import fails in jsdom, switch the test
environment for this file to `node` via `// @vitest-environment node` at the top
of the test file (Blob and URL exist in node ≥ 18). Do NOT mock `import()` —
the test must exercise the real path.

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/theme-engine/__tests__/loader.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/theme-engine && git commit -m "feat(theme-engine): blob-url module loader with validation"
```

### Task 1.3: ThemeHost (React host + error fallback)

**Files:**
- Create: `src/theme-engine/ThemeHost.tsx`
- Test: `src/theme-engine/__tests__/ThemeHost.test.tsx`

SOLID: SRP — lifecycle wiring only (load → mount → push state → unmount).
DIP — receives `fetchScript` and `fallbackModule` as props; no Tauri import here.
KISS — no suspense, no context; plain effects.

- [ ] **Step 1: Write the failing test**

```tsx
// src/theme-engine/__tests__/ThemeHost.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import ThemeHost from "../ThemeHost";
import type { ThemeModule, ThemeState } from "../contract";

const state: ThemeState = { mode: "idle", audioLevel: 0, spectrumBins: new Array(32).fill(0) };

function makeModule(log: string[]): ThemeModule {
  return {
    mount(container, api) {
      log.push("mount");
      container.dataset.mounted = "yes";
      api.onState(() => log.push("state"));
      return { unmount: () => log.push("unmount") };
    },
  };
}

describe("ThemeHost", () => {
  it("mounts the loaded theme and pushes initial state", async () => {
    const log: string[] = [];
    const mod = makeModule(log);
    const { container } = render(
      <ThemeHost
        themeId="t1"
        state={state}
        fetchModule={async () => mod}
        fallbackModule={mod}
        onCancel={() => {}}
      />,
    );
    await waitFor(() => expect(log).toContain("mount"));
    expect(log).toContain("state"); // onState fires immediately
    expect(container.querySelector("[data-mounted='yes']")).toBeTruthy();
  });

  it("falls back to fallbackModule when fetchModule rejects", async () => {
    const log: string[] = [];
    const fallback = makeModule(log);
    render(
      <ThemeHost
        themeId="broken"
        state={state}
        fetchModule={async () => { throw new Error("boom"); }}
        fallbackModule={fallback}
        onCancel={() => {}}
      />,
    );
    await waitFor(() => expect(log).toContain("mount"));
  });

  it("falls back when mount throws", async () => {
    const log: string[] = [];
    const bad: ThemeModule = { mount() { throw new Error("mount-boom"); } };
    const fallback = makeModule(log);
    render(
      <ThemeHost themeId="t" state={state} fetchModule={async () => bad}
        fallbackModule={fallback} onCancel={() => {}} />,
    );
    await waitFor(() => expect(log).toContain("mount"));
  });

  it("unmounts old theme when themeId changes", async () => {
    const log: string[] = [];
    const mod = makeModule(log);
    const { rerender } = render(
      <ThemeHost themeId="a" state={state} fetchModule={async () => mod}
        fallbackModule={mod} onCancel={() => {}} />,
    );
    await waitFor(() => expect(log).toContain("mount"));
    rerender(
      <ThemeHost themeId="b" state={state} fetchModule={async () => mod}
        fallbackModule={mod} onCancel={() => {}} />,
    );
    await waitFor(() => expect(log).toContain("unmount"));
  });

  it("pushes new state to subscribed themes without remounting", async () => {
    const log: string[] = [];
    const mod = makeModule(log);
    const { rerender } = render(
      <ThemeHost themeId="a" state={state} fetchModule={async () => mod}
        fallbackModule={mod} onCancel={() => {}} />,
    );
    await waitFor(() => expect(log).toContain("mount"));
    const mounts = log.filter((l) => l === "mount").length;
    act(() => {
      rerender(
        <ThemeHost themeId="a" state={{ ...state, mode: "recording" }}
          fetchModule={async () => mod} fallbackModule={mod} onCancel={() => {}} />,
      );
    });
    await waitFor(() =>
      expect(log.filter((l) => l === "state").length).toBeGreaterThanOrEqual(2),
    );
    expect(log.filter((l) => l === "mount").length).toBe(mounts); // no remount
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/theme-engine/__tests__/ThemeHost.test.tsx`
Expected: FAIL — cannot resolve `../ThemeHost`

- [ ] **Step 3: Implement ThemeHost.tsx**

```tsx
// src/theme-engine/ThemeHost.tsx
/**
 * ThemeHost — thin React host for code themes.
 * SRP: load module → mount into a div → push state → unmount on change.
 * DIP: module fetching and cancel action are injected via props.
 * Error policy: any load/mount failure → fallbackModule (never blank overlay).
 */
import { useEffect, useRef } from "react";
import {
  THEME_API_VERSION,
  type ThemeApi,
  type ThemeInstance,
  type ThemeModule,
  type ThemeState,
} from "./contract";

export interface ThemeHostProps {
  themeId: string;
  state: ThemeState;
  /** Resolve themeId → module (Tauri readThemeScript + loader in production). */
  fetchModule: (themeId: string) => Promise<ThemeModule>;
  /** Statically-imported safe default theme. */
  fallbackModule: ThemeModule;
  onCancel: () => void;
  width?: number;
  height?: number;
  /** Manifest params for the active theme (free-form JSON). */
  params?: unknown;
}

type Listener = (s: ThemeState) => void;

export default function ThemeHost({
  themeId,
  state,
  fetchModule,
  fallbackModule,
  onCancel,
  width = 172,
  height = 36,
  params,
}: ThemeHostProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const listenersRef = useRef<Set<Listener>>(new Set());
  const stateRef = useRef<ThemeState>(state);
  const instanceRef = useRef<ThemeInstance | null>(null);

  // Push state to mounted theme (no remount).
  stateRef.current = state;
  useEffect(() => {
    for (const cb of listenersRef.current) {
      try {
        cb(state);
      } catch (err) {
        console.error("[ThemeHost] theme onState callback threw:", err);
      }
    }
  }, [state]);

  // (Re)mount on themeId change.
  useEffect(() => {
    let cancelled = false;

    const mountModule = (mod: ThemeModule) => {
      const container = containerRef.current;
      if (!container || cancelled) return;
      container.innerHTML = "";
      const api: ThemeApi = {
        apiVersion: THEME_API_VERSION,
        params: params ?? null,
        size: { width, height },
        onState(cb) {
          listenersRef.current.add(cb);
          try {
            cb(stateRef.current);
          } catch (err) {
            console.error("[ThemeHost] initial onState push threw:", err);
          }
          return () => listenersRef.current.delete(cb);
        },
        actions: { cancel: onCancel },
      };
      instanceRef.current = mod.mount(container, api);
    };

    void (async () => {
      try {
        const mod = await fetchModule(themeId);
        mountModule(mod);
      } catch (err) {
        console.error(`[ThemeHost] theme '${themeId}' failed, using fallback:`, err);
        try {
          mountModule(fallbackModule);
        } catch (err2) {
          console.error("[ThemeHost] fallback theme failed too:", err2);
        }
      }
    })();

    return () => {
      cancelled = true;
      listenersRef.current.clear();
      try {
        instanceRef.current?.unmount();
      } catch (err) {
        console.error("[ThemeHost] unmount threw:", err);
      }
      instanceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeId]);

  return <div ref={containerRef} style={{ width, height }} data-testid="theme-host" />;
}
```

Note: if `mountModule(mod)` itself throws synchronously inside the async block
(mount-boom test), the catch already routes to fallback — verify the test covers it.

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/theme-engine/__tests__/ThemeHost.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Run full TS suite (no regressions)**

Run: `bun run test:run`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add src/theme-engine && git commit -m "feat(theme-engine): ThemeHost with state push + error fallback"
```

---

## Phase 2 — Renderers (vanilla TS, shared by builtin themes)

Tasks 2.1 / 2.2 / 2.3 are **[parallel-group:R]** — disjoint files, safe for
parallel subagents (worktrees). Each renderer is framework-free (no React):
pure `create(container, opts)` returning `{ update(state), destroy() }`.
This is the key SRP/DIP move: renderers know nothing about ThemeApi or Tauri —
builtin themes adapt ThemeApi → renderer calls.

Shared smoothing note (DRY): each renderer embeds the exponential smoothing
formula from `src/hooks/useSmoothBars.ts` (`s = s*(1-a) + x*a`, peak decay) in
a tiny shared helper — create it once in Task 2.1 and the other tasks import it.

### Task 2.1: `smoothing.ts` + bars renderer

**Files:**
- Create: `src/theme-engine/renderers/smoothing.ts`
- Create: `src/theme-engine/renderers/bars.ts`
- Test: `src/theme-engine/renderers/__tests__/smoothing.test.ts`
- Test: `src/theme-engine/renderers/__tests__/bars.test.ts`

Port sources (read them before writing code):
- `src/hooks/useSmoothBars.ts` — smoothing math (drop React refs, keep formulas)
- `src/components/overlay/ClassicBars.tsx` — bar geometry, gradient CSS, peak ticks
- `src/hooks/useBarPeaks.ts` — peak hold-and-decay

- [ ] **Step 1: Write failing smoothing test**

```ts
// src/theme-engine/renderers/__tests__/smoothing.test.ts
import { describe, it, expect } from "vitest";
import { createSmoother } from "../smoothing";

describe("createSmoother", () => {
  it("converges toward input with alpha", () => {
    const s = createSmoother({ size: 2, alpha: 0.5, peakDecay: 1.0 });
    expect(s.push([1, 0])).toEqual([0.5, 0]);
    expect(s.push([1, 0])).toEqual([0.75, 0]);
  });

  it("pads/truncates input to size", () => {
    const s = createSmoother({ size: 3, alpha: 1.0, peakDecay: 1.0 });
    expect(s.push([1])).toEqual([1, 0, 0]);
    expect(s.push([1, 1, 1, 1])).toEqual([1, 1, 1]);
  });

  it("holds peaks when peakDecay < 1", () => {
    const s = createSmoother({ size: 1, alpha: 1.0, peakDecay: 0.5 });
    expect(s.push([1])).toEqual([1]);
    // input drops to 0; smoothed=0 but peak=0.5 wins
    expect(s.push([0])).toEqual([0.5]);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (`bunx vitest run src/theme-engine/renderers/__tests__/smoothing.test.ts`)

- [ ] **Step 3: Implement smoothing.ts**

```ts
// src/theme-engine/renderers/smoothing.ts
/** Frame-to-frame exponential smoothing + peak hold (ported from useSmoothBars). */
export interface SmootherOptions { size: number; alpha: number; peakDecay: number; }
export interface Smoother { push(input: number[]): number[]; }

export function createSmoother({ size, alpha, peakDecay }: SmootherOptions): Smoother {
  const a = Math.max(0, Math.min(1, alpha));
  const decay = Math.max(0, Math.min(1, peakDecay));
  let smoothed = new Array<number>(size).fill(0);
  let peak = new Array<number>(size).fill(0);
  return {
    push(input: number[]): number[] {
      smoothed = smoothed.map((prev, i) => {
        const target = i < input.length ? Number(input[i]) || 0 : 0;
        return prev * (1 - a) + target * a;
      });
      if (decay >= 1.0) { peak = smoothed.slice(); return smoothed.slice(); }
      peak = peak.map((p, i) => Math.max(p * decay, smoothed[i]));
      return smoothed.map((s, i) => Math.max(s, peak[i]));
    },
  };
}
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Write failing bars renderer test**

```ts
// src/theme-engine/renderers/__tests__/bars.test.ts
import { describe, it, expect } from "vitest";
import { createBarsRenderer } from "../bars";

const GRADIENT = { bottom: "#299400", middle: "#d6b521", top: "#ef3110" };

describe("createBarsRenderer", () => {
  it("renders barCount columns into the container", () => {
    const container = document.createElement("div");
    const r = createBarsRenderer(container, { gradient: GRADIENT, barCount: 16 });
    expect(container.querySelectorAll(".classic-bar-col").length).toBe(16);
    r.destroy();
  });

  it("update() changes bar heights", () => {
    const container = document.createElement("div");
    const r = createBarsRenderer(container, { gradient: GRADIENT, barCount: 4 });
    r.update({ mode: "recording", audioLevel: 1, spectrumBins: [1, 1, 1, 1] });
    const bar = container.querySelector(".classic-bar") as HTMLElement;
    expect(parseFloat(bar.style.height)).toBeGreaterThan(2);
    r.destroy();
  });

  it("destroy() empties the container", () => {
    const container = document.createElement("div");
    const r = createBarsRenderer(container, { gradient: GRADIENT, barCount: 4 });
    r.destroy();
    expect(container.innerHTML).toBe("");
  });
});
```

- [ ] **Step 6: Run, expect FAIL**

- [ ] **Step 7: Implement bars.ts**

Port `ClassicBars.tsx` to vanilla DOM. Structure (signature is the contract —
keep it exactly; body follows ClassicBars formulas):

```ts
// src/theme-engine/renderers/bars.ts
import { createSmoother } from "./smoothing";
import type { ThemeState } from "../contract";

export interface BarsGradient { bottom: string; middle: string; top: string; }
export interface BarsOptions {
  gradient: BarsGradient;
  barCount?: number;       // default 16
  maxHeight?: number;      // default 32
  gap?: number;            // default 1
  peakDecay?: number;      // default 0.96 (peak ticks), 0 disables
  smoothingAlpha?: number; // default 0.3
}
export interface Renderer { update(state: ThemeState): void; destroy(): void; }

export function createBarsRenderer(container: HTMLElement, opts: BarsOptions): Renderer
```

Implementation requirements (from ClassicBars.tsx — read it):
- column divs `.classic-bar-col` with inner `.classic-bar` (gradient fill,
  `linear-gradient(to top, bottom 0%, middle 50%, top 100%)`) and `.classic-bar-peak` tick
- height formula: `MIN_HEIGHT_PX(2) + pow(v, 0.7) * (maxHeight - MIN)`
- spectrum resampling: nearest-neighbour from 32 bins to barCount
- transitions inline: `height 60ms ease-out, opacity 120ms ease-out`
- smoothing: one `createSmoother({size: barCount, alpha: smoothingAlpha, peakDecay: 1.0})`
  for bar bodies; peaks via per-frame decay in `update()` (no RAF — update() is
  called on every spectrum event, which is the frame clock)
- `destroy()` → `container.innerHTML = ""`

- [ ] **Step 8: Run both tests, expect PASS** (`bunx vitest run src/theme-engine/renderers/__tests__/`)

- [ ] **Step 9: Commit**

```bash
git add src/theme-engine/renderers && git commit -m "feat(theme-engine): vanilla bars renderer + shared smoothing"
```

### Task 2.2: Ring renderer

**Files:**
- Create: `src/theme-engine/renderers/ring.ts`
- Create: `src/theme-engine/renderers/ringGeometry.ts` (move from `src/components/overlay/ringGeometry.ts`)
- Test: `src/theme-engine/renderers/__tests__/ring.test.ts`
- Test: move `src/components/overlay/__tests__/ringGeometry.test.ts` → `src/theme-engine/renderers/__tests__/ringGeometry.test.ts`

Port sources: `src/components/overlay/OrganicRing.tsx` (canvas RAF loop),
`src/components/overlay/ringGeometry.ts` (pure math — **copy file, change only
the import of OrganicRingShape/Motion types**: define them locally instead of
importing from `../../bindings`, because bindings types will be deleted in Phase 6):

```ts
export interface OrganicRingShape {
  gap_degrees: number; base_thickness: number; taper: number;
  roundness: number; active_zones: number;
}
export interface OrganicRingMotion {
  idle_breathing: number; speech_responsiveness: number;
  drift: number; settle_speed: number;
}
```

- [ ] **Step 1: Move ringGeometry + its test, fix imports, run test**

```bash
git mv src/components/overlay/ringGeometry.ts src/theme-engine/renderers/ringGeometry.ts
git mv src/components/overlay/__tests__/ringGeometry.test.ts src/theme-engine/renderers/__tests__/ringGeometry.test.ts
```
Replace the `from "../../bindings"` type import with local interfaces (above).
Update the moved test's import path. Leave a re-export shim at the old path so
`OrganicRing.tsx` keeps compiling until Phase 6:

```ts
// src/components/overlay/ringGeometry.ts (temporary shim, deleted in Phase 6)
export * from "../../theme-engine/renderers/ringGeometry";
```

Run: `bunx vitest run src/theme-engine/renderers/__tests__/ringGeometry.test.ts && bun run test:run`
Expected: PASS, no regressions

- [ ] **Step 2: Write failing ring renderer test**

```ts
// src/theme-engine/renderers/__tests__/ring.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRingRenderer } from "../ring";

const SHAPE = { gap_degrees: 60, base_thickness: 3, taper: 0.5, roundness: 0.8, active_zones: 3 };
const MOTION = { idle_breathing: 0.1, speech_responsiveness: 0.8, drift: 0.2, settle_speed: 0.5 };

describe("createRingRenderer", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", vi.fn().mockReturnValue(1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("creates a canvas sized to options", () => {
    const container = document.createElement("div");
    const r = createRingRenderer(container, {
      shape: SHAPE, motion: MOTION, color: "#7a9fbd", width: 172, height: 36 });
    const canvas = container.querySelector("canvas")!;
    expect(canvas.width).toBe(172);
    expect(canvas.height).toBe(36);
    r.destroy();
  });

  it("starts RAF loop on create and cancels on destroy", () => {
    const container = document.createElement("div");
    const r = createRingRenderer(container, {
      shape: SHAPE, motion: MOTION, color: "#fff", width: 100, height: 50 });
    expect(requestAnimationFrame).toHaveBeenCalled();
    r.destroy();
    expect(cancelAnimationFrame).toHaveBeenCalled();
    expect(container.innerHTML).toBe("");
  });
});
```

(jsdom has no real 2D context — the renderer must tolerate
`canvas.getContext("2d")` returning null: skip painting, keep the loop. Mirrors
the OrganicRing guard.)

- [ ] **Step 3: Run, expect FAIL**

- [ ] **Step 4: Implement ring.ts**

Port the RAF loop from `OrganicRing.tsx` verbatim minus React:

```ts
// src/theme-engine/renderers/ring.ts
import { buildRingPoints, ringStrokeWidth,
  type OrganicRingMotion, type OrganicRingShape } from "./ringGeometry";
import type { ThemeState } from "../contract";
import type { Renderer } from "./bars";

export interface RingOptions {
  shape: OrganicRingShape; motion: OrganicRingMotion;
  color: string; width: number; height: number;
}

export function createRingRenderer(container: HTMLElement, opts: RingOptions): Renderer
```

`update(state)` stores the latest state in a local variable; the RAF tick reads
it (same stateRef pattern as OrganicRing, without React). `destroy()` cancels
RAF and clears the container.

- [ ] **Step 5: Run, expect PASS**

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(theme-engine): vanilla ring renderer, move ringGeometry"
```

### Task 2.3: Pill renderer (Handy pill: icon + 9 bars + cancel + labels)

**Files:**
- Create: `src/theme-engine/renderers/pill.ts`
- Test: `src/theme-engine/renderers/__tests__/pill.test.ts`

Port sources: `src/components/overlay/HandyPill.tsx`, `HandyBars.tsx`,
`HandyPill.module.css`, icon SVGs from `src/components/icons` (inline the three
SVG path strings into pill.ts — themes must be self-contained, no imports from
app components). Palette/animation knob names and defaults come from
`src/themes/handy.ts` (`DEFAULT_HANDY_THEME`) — read it.

- [ ] **Step 1: Write failing test**

```ts
// src/theme-engine/renderers/__tests__/pill.test.ts
import { describe, it, expect, vi } from "vitest";
import { createPillRenderer } from "../pill";

const PALETTE = {
  icon_color: "#FAA2CA", bar_color: "#ffe5ee", bar_glow: "#FAA2CA",
  shadow: "rgba(0,0,0,0.45)", transcribing_text: "#ffffff",
  cancel_hover_bg: "rgba(255,255,255,0.15)",
};

describe("createPillRenderer", () => {
  it("recording mode shows bars and cancel button", () => {
    const container = document.createElement("div");
    const onCancel = vi.fn();
    const r = createPillRenderer(container, { palette: PALETTE, onCancel });
    r.update({ mode: "recording", audioLevel: 0.5, spectrumBins: new Array(32).fill(0.5) });
    expect(container.querySelectorAll(".pill-bar").length).toBe(9);
    const cancel = container.querySelector("[data-action='cancel']") as HTMLElement;
    expect(cancel).toBeTruthy();
    cancel.click();
    expect(onCancel).toHaveBeenCalled();
    r.destroy();
  });

  it("transcribing mode shows label, no bars, no cancel", () => {
    const container = document.createElement("div");
    const r = createPillRenderer(container, { palette: PALETTE, onCancel: () => {} });
    r.update({ mode: "transcribing", audioLevel: 0, spectrumBins: [] });
    expect(container.textContent).toContain("Transcribing");
    expect(container.querySelectorAll(".pill-bar").length).toBe(0);
    expect(container.querySelector("[data-action='cancel']")).toBeNull();
    r.destroy();
  });

  it("idle mode shows only the icon", () => {
    const container = document.createElement("div");
    const r = createPillRenderer(container, { palette: PALETTE, onCancel: () => {} });
    r.update({ mode: "idle", audioLevel: 0, spectrumBins: [] });
    expect(container.querySelector("svg")).toBeTruthy();
    expect(container.querySelectorAll(".pill-bar").length).toBe(0);
    r.destroy();
  });

  it("destroy clears the container", () => {
    const container = document.createElement("div");
    const r = createPillRenderer(container, { palette: PALETTE, onCancel: () => {} });
    r.destroy();
    expect(container.innerHTML).toBe("");
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement pill.ts**

```ts
// src/theme-engine/renderers/pill.ts
import { createSmoother } from "./smoothing";
import type { ThemeState } from "../contract";
import type { Renderer } from "./bars";

export interface PillPalette {
  icon_color: string; bar_color: string; bar_glow: string;
  shadow: string; transcribing_text: string; cancel_hover_bg: string;
}
export interface PillAnimation {  // subset that affects JS; CSS uses literals
  smoothing_alpha?: number;  // default 0.3
  power_curve?: number;      // default 2.0 (see DEFAULT_HANDY_THEME in src/themes/handy.ts)
  peak_decay?: number;       // default 1.0
}
export interface PillOptions {
  palette: PillPalette;
  animation?: PillAnimation;
  onCancel: () => void;
  labels?: { transcribing?: string; error?: string };
}

export function createPillRenderer(container: HTMLElement, opts: PillOptions): Renderer
```

Implementation requirements:
- Grid layout 172×36 (`auto 1fr auto`): icon | middle | cancel — inline styles
  + one injected `<style>` tag for keyframes/hover (scoped by a generated class)
- 9 bars (`.pill-bar`), height `min + pow(v, power_curve) * range`, opacity
  `max(0.2, v * 1.7)` — formulas from HandyBars.tsx
- mode dispatch in `update()`: rebuild middle/right slots only when mode changes
  (KISS: innerHTML swap per mode change is fine; per-frame only bar styles mutate)
- icons: inline the SVG markup of MicrophoneIcon / TranscriptionIcon /
  CancelIcon from `src/components/icons` with `fill="currentColor"`,
  root `color: palette.icon_color`
- cancel button: `data-action="cancel"`, `aria-label="Cancel recording"`, click → `opts.onCancel()`
- bars use 9-sized smoother (alpha from animation, default 0.3)
- `destroy()`: remove injected style tag + `container.innerHTML = ""`

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/theme-engine/renderers && git commit -m "feat(theme-engine): vanilla pill renderer (Handy port)"
```

---

## Phase 3 — Builtin themes + build script

Task 3.1 first (single agent). Then 3.2 and 3.3 are **[parallel-group:T]**
(disjoint theme dirs).

### Task 3.1: Theme build script + first theme (winamp_classic) end-to-end

**Files:**
- Create: `scripts/build-themes.ts`
- Create: `src/theme-engine/builtin/winamp_classic/index.ts`
- Create: `src/theme-engine/builtin/winamp_classic/manifest.json`
- Test: `src/theme-engine/builtin/__tests__/winamp_classic.test.ts`
- Test: `scripts/__tests__/build-themes.test.ts`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Write failing theme-source test**

```ts
// src/theme-engine/builtin/__tests__/winamp_classic.test.ts
import { describe, it, expect } from "vitest";
import * as theme from "../winamp_classic";
import { validateThemeModule, THEME_API_VERSION, type ThemeApi } from "../../contract";

function fakeApi(): ThemeApi {
  return {
    apiVersion: THEME_API_VERSION,
    params: null,
    size: { width: 172, height: 36 },
    onState(cb) {
      cb({ mode: "recording", audioLevel: 0.5, spectrumBins: new Array(32).fill(0.5) });
      return () => {};
    },
    actions: { cancel: () => {} },
  };
}

describe("winamp_classic theme", () => {
  it("is a valid theme module", () => {
    expect(validateThemeModule(theme).ok).toBe(true);
  });

  it("mounts, renders bars, unmounts cleanly", () => {
    const container = document.createElement("div");
    const inst = theme.mount(container, fakeApi());
    expect(container.querySelectorAll(".classic-bar-col").length).toBeGreaterThan(0);
    inst.unmount();
    expect(container.innerHTML).toBe("");
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (`bunx vitest run src/theme-engine/builtin/__tests__/winamp_classic.test.ts`)

- [ ] **Step 3: Implement the theme source**

```ts
// src/theme-engine/builtin/winamp_classic/index.ts
/**
 * Winamp Classic — green→yellow→red spectrum bars.
 * Builtin theme, also serves as the reference example for theme authors.
 */
import { createBarsRenderer } from "../../renderers/bars";
import type { ThemeApi, ThemeInstance } from "../../contract";

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  const renderer = createBarsRenderer(container, {
    gradient: { bottom: "#299400", middle: "#d6b521", top: "#ef3110" },
    barCount: 16,
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

```json
// src/theme-engine/builtin/winamp_classic/manifest.json
{
  "manifest_version": 2,
  "id": "winamp_classic",
  "name": "Winamp Classic",
  "description": "Green-yellow-red spectrum analyzer bars",
  "api_version": 1,
  "entry": "theme.js"
}
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Write failing build-script test**

```ts
// scripts/__tests__/build-themes.test.ts
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

describe("build-themes", () => {
  it("bundles every builtin theme into a self-contained ESM + manifest", () => {
    execSync("bun run build:themes", { cwd: path.resolve(__dirname, "../..") });
    const outDir = path.resolve(__dirname, "../../src-tauri/themes/winamp_classic");
    const js = fs.readFileSync(path.join(outDir, "theme.js"), "utf-8");
    expect(js).toContain("export"); // ESM
    expect(js).not.toMatch(/^import /m); // self-contained, no bare imports
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, "theme.json"), "utf-8"));
    expect(manifest.manifest_version).toBe(2);
    expect(manifest.entry).toBe("theme.js");
  });
});
```

- [ ] **Step 6: Run, expect FAIL** (no `build:themes` script yet)

- [ ] **Step 7: Implement scripts/build-themes.ts**

```ts
// scripts/build-themes.ts
/**
 * Bundles src/theme-engine/builtin/<id>/index.ts into
 * src-tauri/themes/<id>/theme.js (self-contained ESM) and copies
 * manifest.json → theme.json. Run via `bun run build:themes`.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const BUILTIN_DIR = path.join(ROOT, "src/theme-engine/builtin");
const OUT_DIR = path.join(ROOT, "src-tauri/themes");

const ids = fs.readdirSync(BUILTIN_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith("__"))
  .map((e) => e.name);

for (const id of ids) {
  const entry = path.join(BUILTIN_DIR, id, "index.ts");
  const manifest = path.join(BUILTIN_DIR, id, "manifest.json");
  const out = path.join(OUT_DIR, id);
  fs.mkdirSync(out, { recursive: true });

  const result = await Bun.build({
    entrypoints: [entry],
    format: "esm",
    minify: false,        // themes are documentation — keep readable
    target: "browser",
  });
  if (!result.success) {
    console.error(`build failed for ${id}:`, result.logs);
    process.exit(1);
  }
  fs.writeFileSync(path.join(out, "theme.js"), await result.outputs[0].text());
  fs.copyFileSync(manifest, path.join(out, "theme.json"));
  console.log(`built ${id}`);
}
```

In `package.json` add:

```json
"build:themes": "bun scripts/build-themes.ts",
```

and chain it into `"build": "bun run build:themes && tsc && vite build"`.

**IMPORTANT — old theme.json files:** the existing
`src-tauri/themes/<id>/theme.json` (manifest v1, colors/gradient format) are
**overwritten** by this script for the 8 builtin ids. That is intended: Phase 4
teaches Rust the v2 manifest. Don't hand-edit old files.

- [ ] **Step 8: Run build + test, expect PASS**

Run: `bun run build:themes && bunx vitest run scripts/__tests__/build-themes.test.ts`
Expected: `built winamp_classic`, test PASS

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat(themes): winamp_classic in code-theme format + build-themes script"
```

### Task 3.2: Remaining bars themes (default, dark, neon, monochrome) [parallel-group:T]

**Files (per theme id × 4):**
- Create: `src/theme-engine/builtin/<id>/index.ts`
- Create: `src/theme-engine/builtin/<id>/manifest.json`
- Test: `src/theme-engine/builtin/__tests__/<id>.test.ts`

Gradients (from the legacy `src-tauri/themes/<id>/theme.json`, verified):

| id | bottom | middle | top | name |
|---|---|---|---|---|
| default | `#1e88e5` | `#42a5f5` | `#64b5f6` | Default |
| dark | `#7c4dff` | `#9c6dff` | `#b388ff` | Dark |
| neon | `#00ffff` | `#ff00ff` | `#ffff00` | Neon |
| monochrome | `#606060` | `#a0a0a0` | `#ffffff` | Monochrome |

- [ ] **Step 1: For each id, write the failing test** — copy
  `winamp_classic.test.ts` structure exactly, replace the import and (in a
  gradient assertion) check the bottom color appears in a bar's background:

```ts
const bar = container.querySelector(".classic-bar") as HTMLElement;
expect(bar.style.background).toContain("#1e88e5"); // id-specific bottom color
```

- [ ] **Step 2: Run, expect FAIL (×4)**

- [ ] **Step 3: Implement each index.ts** — copy `winamp_classic/index.ts`,
  replace gradient values from the table; manifest.json with matching
  id/name/description, `manifest_version: 2`, `api_version: 1`, `entry: "theme.js"`.

- [ ] **Step 4: Run all four tests + build, expect PASS**

Run: `bunx vitest run src/theme-engine/builtin && bun run build:themes`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(themes): default/dark/neon/monochrome converted to code themes"
```

### Task 3.3: Ring themes (quiet_reed, living_reed, drifting_contour) [parallel-group:T]

**Files (per theme id × 3):** same layout as Task 3.2.

Parameters — read each legacy `src-tauri/themes/<id>/theme.json` **before
overwriting** (or from git history `git show HEAD:src-tauri/themes/<id>/theme.json`):
copy `organic_ring.shape`, `organic_ring.motion`, and the ring color
(`colors.recording`) into the theme source.

- [ ] **Step 1: Write failing test per id** (same structure; assert
  `container.querySelector("canvas")` exists after mount, and unmount clears)

- [ ] **Step 2: Run, expect FAIL (×3)**

- [ ] **Step 3: Implement each index.ts:**

```ts
// src/theme-engine/builtin/quiet_reed/index.ts (pattern for all three)
import { createRingRenderer } from "../../renderers/ring";
import type { ThemeApi, ThemeInstance } from "../../contract";

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  const renderer = createRingRenderer(container, {
    // values copied verbatim from legacy theme.json for this id:
    shape:  { gap_degrees: /*…*/, base_thickness: /*…*/, taper: /*…*/, roundness: /*…*/, active_zones: /*…*/ },
    motion: { idle_breathing: /*…*/, speech_responsiveness: /*…*/, drift: /*…*/, settle_speed: /*…*/ },
    color: "/* colors.recording from legacy json */",
    width: api.size.width,
    height: api.size.height,
  });
  const unsubscribe = api.onState((s) => renderer.update(s));
  return { unmount() { unsubscribe(); renderer.destroy(); } };
}
```

(The `/*…*/` values are NOT placeholders to invent — they are mechanical copies
from the legacy JSON of each theme id. The implementing agent reads the legacy
file and pastes the numbers.)

- [ ] **Step 4: Run tests + build, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(themes): organic-ring themes converted to code themes"
```

---

## Phase 4 — Rust engine (manifest v2 loader + commands)

Sequential, one agent — all tasks touch `src-tauri/src/`. MAY run concurrently
with Phases 1–3 (disjoint languages/files), coordinator's choice.

### Task 4.1: Manifest v2 schema + new ThemeLoader

**Files:**
- Create: `src-tauri/src/theme_engine/mod.rs`
- Create: `src-tauri/src/theme_engine/manifest.rs`
- Create: `src-tauri/src/theme_engine/loader.rs`
- Modify: `src-tauri/src/lib.rs` (add `pub mod theme_engine;`)

New module beside the old one (old `overlay_native/theme.rs` keeps working
until Phase 5 switches and Phase 6 deletes). SRP: `manifest.rs` = schema +
validation (pure), `loader.rs` = filesystem scan/read.

- [ ] **Step 1: Write failing manifest tests**

```rust
// in src-tauri/src/theme_engine/manifest.rs (bottom)
#[cfg(test)]
mod tests {
    use super::*;

    fn valid_json() -> &'static str {
        r#"{
            "manifest_version": 2, "id": "my_theme", "name": "My Theme",
            "description": "d", "api_version": 1, "entry": "theme.js"
        }"#
    }

    #[test]
    fn test_parse_valid_manifest() {
        let m = ThemeManifest::parse(valid_json()).unwrap();
        assert_eq!(m.id, "my_theme");
        assert_eq!(m.api_version, 1);
        assert_eq!(m.entry, "theme.js");
    }

    #[test]
    fn test_reject_wrong_manifest_version() {
        let bad = valid_json().replace("\"manifest_version\": 2", "\"manifest_version\": 1");
        assert!(ThemeManifest::parse(&bad).is_err());
    }

    #[test]
    fn test_reject_unsupported_api_version() {
        let bad = valid_json().replace("\"api_version\": 1", "\"api_version\": 99");
        assert!(ThemeManifest::parse(&bad).is_err());
    }

    #[test]
    fn test_reject_entry_with_path_traversal() {
        let bad = valid_json().replace("theme.js", "../evil.js");
        assert!(ThemeManifest::parse(&bad).is_err());
    }

    #[test]
    fn test_params_roundtrip() {
        let with_params = valid_json().replace(
            "\"entry\": \"theme.js\"",
            "\"entry\": \"theme.js\", \"params\": {\"speed\": 2}");
        let m = ThemeManifest::parse(&with_params).unwrap();
        assert!(m.params.is_some());
    }
}
```

- [ ] **Step 2: Run, expect FAIL** (`cd src-tauri && cargo test theme_engine`)

- [ ] **Step 3: Implement manifest.rs**

```rust
// src-tauri/src/theme_engine/manifest.rs
//! Theme manifest (v2) — schema + pure validation. No filesystem I/O here (SRP).
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const MANIFEST_VERSION: u32 = 2;
pub const SUPPORTED_API_VERSION: u32 = 1;

#[derive(Debug, Error)]
pub enum ManifestError {
    #[error("invalid JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("unsupported manifest_version {0} (expected {MANIFEST_VERSION})")]
    ManifestVersion(u32),
    #[error("unsupported api_version {0} (expected {SUPPORTED_API_VERSION})")]
    ApiVersion(u32),
    #[error("entry must be a plain filename, got: {0}")]
    BadEntry(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ThemeManifest {
    pub manifest_version: u32,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub api_version: u32,
    pub entry: String,
    #[serde(default)]
    pub params: Option<serde_json::Value>,
}

impl ThemeManifest {
    pub fn parse(json: &str) -> Result<Self, ManifestError> {
        let m: ThemeManifest = serde_json::from_str(json)?;
        if m.manifest_version != MANIFEST_VERSION {
            return Err(ManifestError::ManifestVersion(m.manifest_version));
        }
        if m.api_version != SUPPORTED_API_VERSION {
            return Err(ManifestError::ApiVersion(m.api_version));
        }
        if m.entry.contains('/') || m.entry.contains('\\') || m.entry.contains("..") {
            return Err(ManifestError::BadEntry(m.entry));
        }
        Ok(m)
    }
}
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Write failing loader tests**

```rust
// in src-tauri/src/theme_engine/loader.rs (bottom)
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn write_theme(dir: &std::path::Path, id: &str, entry_content: &str) {
        let d = dir.join(id);
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("theme.json"), format!(
            r#"{{"manifest_version":2,"id":"{id}","name":"{id}","api_version":1,"entry":"theme.js"}}"#
        )).unwrap();
        fs::write(d.join("theme.js"), entry_content).unwrap();
    }

    #[test]
    fn test_scan_finds_valid_themes() {
        let tmp = TempDir::new().unwrap();
        write_theme(tmp.path(), "alpha", "export function mount(){}");
        write_theme(tmp.path(), "beta", "export function mount(){}");
        let loader = ThemeEngineLoader::new(tmp.path().to_path_buf());
        let themes = loader.scan().unwrap();
        let mut ids: Vec<_> = themes.iter().map(|t| t.id.clone()).collect();
        ids.sort();
        assert_eq!(ids, vec!["alpha", "beta"]);
    }

    #[test]
    fn test_scan_skips_invalid_manifest() {
        let tmp = TempDir::new().unwrap();
        write_theme(tmp.path(), "good", "export function mount(){}");
        let bad = tmp.path().join("bad");
        fs::create_dir_all(&bad).unwrap();
        fs::write(bad.join("theme.json"), "{not json").unwrap();
        let loader = ThemeEngineLoader::new(tmp.path().to_path_buf());
        let themes = loader.scan().unwrap();
        assert_eq!(themes.len(), 1);
    }

    #[test]
    fn test_scan_skips_theme_missing_entry_file() {
        let tmp = TempDir::new().unwrap();
        let d = tmp.path().join("noentry");
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("theme.json"),
            r#"{"manifest_version":2,"id":"noentry","name":"x","api_version":1,"entry":"theme.js"}"#
        ).unwrap();
        let loader = ThemeEngineLoader::new(tmp.path().to_path_buf());
        assert_eq!(loader.scan().unwrap().len(), 0);
    }

    #[test]
    fn test_read_script_returns_entry_content() {
        let tmp = TempDir::new().unwrap();
        write_theme(tmp.path(), "alpha", "export function mount(){/*alpha*/}");
        let loader = ThemeEngineLoader::new(tmp.path().to_path_buf());
        loader.scan().unwrap();
        let src = loader.read_script("alpha").unwrap();
        assert!(src.contains("/*alpha*/"));
    }

    #[test]
    fn test_read_script_unknown_id_errors() {
        let tmp = TempDir::new().unwrap();
        let loader = ThemeEngineLoader::new(tmp.path().to_path_buf());
        loader.scan().unwrap();
        assert!(loader.read_script("ghost").is_err());
    }

    #[test]
    fn test_validate_reports_errors_for_broken_theme() {
        let tmp = TempDir::new().unwrap();
        let bad = tmp.path().join("bad");
        fs::create_dir_all(&bad).unwrap();
        fs::write(bad.join("theme.json"), "{not json").unwrap();
        let loader = ThemeEngineLoader::new(tmp.path().to_path_buf());
        let result = loader.validate("bad");
        assert!(!result.valid);
        assert!(!result.errors.is_empty());
    }
}
```

- [ ] **Step 6: Run, expect FAIL**

- [ ] **Step 7: Implement loader.rs**

```rust
// src-tauri/src/theme_engine/loader.rs
//! Filesystem side of the theme engine: scan dir, read entry scripts, validate.
//! SRP: I/O only — schema rules live in manifest.rs.
use super::manifest::ThemeManifest;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::RwLock;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ThemeEngineError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("unknown theme id: {0}")]
    UnknownTheme(String),
}

/// Mirrors the existing ThemeTestResult DTO (valid/warnings/errors).
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct ThemeValidation {
    pub valid: bool,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
}

pub struct ThemeEngineLoader {
    themes_dir: PathBuf,
    cache: RwLock<HashMap<String, ThemeManifest>>,
}

impl ThemeEngineLoader {
    pub fn new(themes_dir: PathBuf) -> Self {
        Self { themes_dir, cache: RwLock::new(HashMap::new()) }
    }

    pub fn themes_dir(&self) -> &PathBuf { &self.themes_dir }

    /// Scan themes dir; cache and return manifests of valid themes.
    /// Invalid themes are skipped (logged), never fatal.
    pub fn scan(&self) -> Result<Vec<ThemeManifest>, ThemeEngineError> {
        if !self.themes_dir.exists() {
            std::fs::create_dir_all(&self.themes_dir)?;
        }
        let mut found = HashMap::new();
        for entry in std::fs::read_dir(&self.themes_dir)?.flatten() {
            let dir = entry.path();
            if !dir.is_dir() { continue; }
            match Self::load_dir(&dir) {
                Ok(m) => { found.insert(m.id.clone(), m); }
                Err(e) => tracing::warn!("skipping theme at {:?}: {}", dir, e),
            }
        }
        let list: Vec<_> = found.values().cloned().collect();
        *self.cache.write().expect("theme cache poisoned") = found;
        Ok(list)
    }

    fn load_dir(dir: &std::path::Path) -> Result<ThemeManifest, String> {
        let manifest_path = dir.join("theme.json");
        let raw = std::fs::read_to_string(&manifest_path).map_err(|e| e.to_string())?;
        let manifest = ThemeManifest::parse(&raw).map_err(|e| e.to_string())?;
        let entry = dir.join(&manifest.entry);
        if !entry.is_file() {
            return Err(format!("entry file missing: {}", manifest.entry));
        }
        Ok(manifest)
    }

    /// Return manifest for id (from cache filled by scan()).
    pub fn manifest(&self, id: &str) -> Option<ThemeManifest> {
        self.cache.read().expect("theme cache poisoned").get(id).cloned()
    }

    /// Read the entry-script source for a theme id.
    pub fn read_script(&self, id: &str) -> Result<String, ThemeEngineError> {
        let manifest = self.manifest(id)
            .ok_or_else(|| ThemeEngineError::UnknownTheme(id.to_string()))?;
        let path = self.themes_dir.join(id).join(&manifest.entry);
        Ok(std::fs::read_to_string(path)?)
    }

    /// Validate one theme dir; mirrors legacy ThemeTestResult semantics.
    pub fn validate(&self, id: &str) -> ThemeValidation {
        let dir = self.themes_dir.join(id);
        match Self::load_dir(&dir) {
            Ok(_) => ThemeValidation { valid: true, ..Default::default() },
            Err(e) => ThemeValidation { valid: false, warnings: vec![], errors: vec![e] },
        }
    }
}
```

```rust
// src-tauri/src/theme_engine/mod.rs
//! Theme engine — manifest v2 + filesystem loader. Knows NOTHING about
//! colors/shapes/animation: themes are opaque JS the webview executes.
pub mod loader;
pub mod manifest;

pub use loader::{ThemeEngineLoader, ThemeValidation};
pub use manifest::ThemeManifest;
```

Add `pub mod theme_engine;` to `src-tauri/src/lib.rs`.

- [ ] **Step 8: Run, expect PASS** (`cargo test theme_engine` — 12 tests)

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat(theme-engine-rs): manifest v2 schema + filesystem loader"
```

### Task 4.2: Rewire Tauri commands to the new loader

**Files:**
- Modify: `src-tauri/src/commands/overlay.rs`
- Modify: `src-tauri/src/setup/state.rs` (manage `ThemeEngineLoader`)
- Modify: `src-tauri/src/lib.rs` (collect_commands list)
- Test: extend `src-tauri/src/commands/overlay.rs` test module

Command changes (keep names the frontend already uses — see
`src/lib/commands.ts:359-393`):

| Command | Change |
|---|---|
| `get_visualization_themes` | reimplement over `ThemeEngineLoader::scan()` → `Vec<ThemeInfo>` (same DTO: id/name/description from manifest) |
| `validate_visualization_theme` | reimplement over `loader.validate(id)` (same ThemeTestResult shape — reuse `ThemeValidation`) |
| `reload_visualization_themes` | `loader.scan()` |
| `get_themes_dir` | unchanged |
| `preview_visualization_theme` | unchanged (still emits `overlay://theme`) |
| `read_theme_script` | **NEW**: `(theme_id) -> Result<String, String>` via `loader.read_script` |
| `get_theme_manifest` | **NEW**: `(theme_id) -> Option<ThemeManifest>` (params for ThemeApi) |
| `export_builtin_theme` | reimplement: copy the whole builtin theme dir (`theme.json` + `theme.js`) to `<id>_custom` (loop with counter, as today) |
| `get_handy_theme`, `get_theme_colors`, `get_overlay_theme_data` | **leave untouched in this task** — deleted in Phase 6 after the frontend stops calling them |

- [ ] **Step 1: Write failing tests** (in `commands/overlay.rs` tests module;
  test the pure/loader-backed logic without Tauri State, same style as
  `export_builtin_theme_to_dir` is testable today):

```rust
#[cfg(test)]
mod theme_engine_command_tests {
    use crate::theme_engine::ThemeEngineLoader;
    use std::fs;
    use tempfile::TempDir;

    fn seed(dir: &std::path::Path, id: &str) {
        let d = dir.join(id);
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("theme.json"), format!(
            r#"{{"manifest_version":2,"id":"{id}","name":"N","api_version":1,"entry":"theme.js"}}"#)).unwrap();
        fs::write(d.join("theme.js"), "export function mount(){}").unwrap();
    }

    #[test]
    fn test_theme_infos_come_from_manifests() {
        let tmp = TempDir::new().unwrap();
        seed(tmp.path(), "abc");
        let loader = ThemeEngineLoader::new(tmp.path().to_path_buf());
        let infos = super::theme_infos(&loader).unwrap();
        assert_eq!(infos.len(), 1);
        assert_eq!(infos[0].id, "abc");
    }

    #[test]
    fn test_export_theme_dir_copies_entry_and_manifest() {
        let tmp = TempDir::new().unwrap();
        seed(tmp.path(), "abc");
        let loader = ThemeEngineLoader::new(tmp.path().to_path_buf());
        loader.scan().unwrap();
        let new_dir = super::export_theme_dir(&loader, "abc").unwrap();
        assert!(std::path::Path::new(&new_dir).join("theme.js").is_file());
        assert!(std::path::Path::new(&new_dir).join("theme.json").is_file());
    }
}
```

- [ ] **Step 2: Run, expect FAIL** (`cargo test theme_engine_command_tests`)

- [ ] **Step 3: Implement** — pure helpers `theme_infos(&ThemeEngineLoader)`,
  `export_theme_dir(&ThemeEngineLoader, id)` + thin `#[tauri::command]` wrappers;
  manage `ThemeEngineLoader` in `setup/state.rs` next to the legacy
  `ThemeLoaderState` (legacy stays until Phase 6); register `read_theme_script`
  and `get_theme_manifest` in `collect_commands![...]` in `lib.rs` **and** in
  `generate_handler!` (the `setup/tests.rs` lock test will catch a mismatch).

- [ ] **Step 4: Run, expect PASS** — `cargo test` (incl. the
  collect_commands/generate_handler sync test)

- [ ] **Step 5: Regenerate bindings** — run `bun run tauri dev` briefly or the
  project's specta export path so `src/bindings.ts` gains `readThemeScript` /
  `getThemeManifest`. Verify: `grep readThemeScript src/bindings.ts`

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(commands): theme-engine backed theme commands + read_theme_script"
```

### Task 4.3: Seeding bundled themes on startup

**Files:**
- Modify: `src-tauri/src/theme_engine/loader.rs` (add `seed_from_bundle`)
- Modify: `src-tauri/src/setup/state.rs` (call seeding before first scan)
- Modify: `src-tauri/tauri.conf.json` (add `"themes"` to bundle resources)

Bundled `src-tauri/themes/<id>/` (built by Phase 3) must be copied into the
user themes dir on startup when absent — replaces the legacy
`ensure_seeded_external_themes`.

- [ ] **Step 1: Write failing test**

```rust
// in loader.rs tests
#[test]
fn test_seed_from_bundle_copies_missing_themes_only() {
    let bundle = TempDir::new().unwrap();
    let user = TempDir::new().unwrap();
    write_theme(bundle.path(), "alpha", "export function mount(){/*v1*/}");
    write_theme(user.path(), "alpha", "export function mount(){/*user-edited*/}");
    write_theme(bundle.path(), "beta", "export function mount(){}");

    let loader = ThemeEngineLoader::new(user.path().to_path_buf());
    loader.seed_from_bundle(bundle.path()).unwrap();

    // user's edited alpha NOT overwritten
    let alpha = std::fs::read_to_string(user.path().join("alpha/theme.js")).unwrap();
    assert!(alpha.contains("user-edited"));
    // missing beta copied
    assert!(user.path().join("beta/theme.js").is_file());
}
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement `seed_from_bundle`** — iterate bundle dir entries;
  for each theme dir whose id is absent in `themes_dir`, copy `theme.json` +
  entry file. Never overwrite existing dirs (user edits win).

- [ ] **Step 4: Wire into setup** — in `setup/state.rs`, resolve the bundled
  themes path via `app.path().resolve("themes", BaseDirectory::Resource)`, call
  `loader.seed_from_bundle(...)` then `loader.scan()`. Add `"themes"` to
  `bundle.resources` in `tauri.conf.json` (next to the existing onnx entry).

- [ ] **Step 5: Run, expect PASS** (`cargo test`)

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(theme-engine-rs): seed bundled code themes into user dir on startup"
```

---

## Phase 5 — Integration (overlay switch + settings)

Sequential — depends on Phases 1–4 all being merged.

### Task 5.1: Switch overlay.tsx to ThemeHost

**Files:**
- Rewrite: `src/overlay.tsx`
- Create: `src/theme-engine/fetchModule.ts` (production fetchModule)
- Test: rewrite `src/__tests__/overlay.test.tsx`

- [ ] **Step 1: Write failing test** (rewrite `src/__tests__/overlay.test.tsx`)

Existing test file tests the old render path — replace it. Mock
`commands.readThemeScript` / `commands.getThemeManifest` via the existing
`src/test/mocks/tauri.ts` infrastructure (read it first):

```tsx
// src/__tests__/overlay.test.tsx (new content, core cases)
import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { OverlayApp } from "../overlay";

// Mock bindings: readThemeScript returns a trivial valid theme module source.
vi.mock("../bindings", () => ({
  commands: {
    readThemeScript: vi.fn().mockResolvedValue({
      status: "ok",
      data: "export function mount(c){c.dataset.theme='loaded';return{unmount(){}}}",
    }),
    getThemeManifest: vi.fn().mockResolvedValue(null),
    cancelOperation: vi.fn().mockResolvedValue(undefined),
    debugLogOverlay: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("OverlayApp (ThemeHost integration)", () => {
  it("renders the theme-host container", async () => {
    const { container } = render(<OverlayApp />);
    await waitFor(() =>
      expect(container.querySelector("[data-testid='theme-host']")).toBeTruthy(),
    );
  });

  it("mounts the fetched theme module", async () => {
    const { container } = render(<OverlayApp />);
    await waitFor(() =>
      expect(container.querySelector("[data-theme='loaded']")).toBeTruthy(),
    );
  });
});
```

(Adapt the `readThemeScript` mock return shape to the actual generated binding —
check `src/bindings.ts` after Task 4.2: plain string vs Result wrapper.)

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement fetchModule.ts**

```ts
// src/theme-engine/fetchModule.ts
/** Production fetchModule: Tauri command → source text → loader. */
import { commands } from "../bindings";
import { loadThemeModuleFromSource } from "./loader";
import type { ThemeModule } from "./contract";

export async function fetchThemeModule(themeId: string): Promise<ThemeModule> {
  const result = await commands.readThemeScript(themeId);
  // unwrap per generated binding shape (Result<String, String> → {status,data})
  if (typeof result === "object" && result !== null && "status" in result) {
    if (result.status !== "ok") throw new Error(String((result as { error?: unknown }).error));
    return loadThemeModuleFromSource((result as { data: string }).data);
  }
  return loadThemeModuleFromSource(result as unknown as string);
}
```

- [ ] **Step 4: Rewrite overlay.tsx**

```tsx
// src/overlay.tsx
/**
 * Overlay webview entry point — thin ThemeHost shell.
 * SRP: subscribe to backend state (useOverlayState) and host the active
 * code theme. ALL visual logic lives in theme modules.
 */
import ReactDOM from "react-dom/client";
import { useOverlayState } from "./hooks/useOverlayState";
import ThemeHost from "./theme-engine/ThemeHost";
import { fetchThemeModule } from "./theme-engine/fetchModule";
import * as fallbackTheme from "./theme-engine/builtin/default";
import { commands } from "./bindings";
import type { ThemeState } from "./theme-engine/contract";

export function OverlayApp() {
  const snapshot = useOverlayState();
  // E2E hook: /overlay.html?theme=<id> forces a theme (kept from old shell).
  const forcedTheme =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("theme")
      : null;
  const themeId = forcedTheme ?? snapshot.themeId;

  const state: ThemeState = {
    mode: snapshot.mode,
    audioLevel: snapshot.audioLevel,
    spectrumBins: snapshot.spectrumBins,
  };

  return (
    <ThemeHost
      themeId={themeId}
      state={state}
      fetchModule={fetchThemeModule}
      fallbackModule={fallbackTheme}
      onCancel={() => void commands.cancelOperation()}
    />
  );
}

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(<OverlayApp />);
}
```

Note: the old `?mode=recording` E2E hook lived in the old shell; mode forcing
now belongs to Playwright via the theme state — drop it (update or delete the
Playwright pixel test that used it; check `e2e/` for usages).

- [ ] **Step 5: Run tests** — `bunx vitest run src/__tests__/overlay.test.tsx`
  PASS, then `bun run test:run` — fix any test still importing the old shell.

- [ ] **Step 6: Manual smoke (macOS)** — `bun run tauri dev`: record something;
  pill/bars render; switch themes in Settings; kill a theme.js mid-run (edit to
  garbage, reload themes) → fallback default appears, overlay never blank.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(overlay): switch to ThemeHost — themes are user code now"
```

### Task 5.2: Settings rewire (ThemeSelect / useThemeColors)

**Files:**
- Modify: `src/hooks/useVisualizationThemes.ts` (should keep working — verify only)
- Modify: `src/components/settings/ThemeSelect.tsx` (verify; preview command unchanged)
- Modify: `src/hooks/useThemeColors.ts` + `src/components/Layout.tsx`
- Test: update affected tests

`useThemeColors` calls `get_theme_colors` (legacy, dies in Phase 6). Its only
consumer is `Layout.tsx` (gradient accent in main window). Replace with a
neutral constant accent (KISS — main-window accent should not depend on overlay
theme internals; themes are opaque code now).

- [ ] **Step 1: Inspect usages**

Run: `grep -rn "useThemeColors\|getThemeColors" src --include="*.ts*" | grep -v __tests__`
Expected consumers: `Layout.tsx`, `useThemeCssVars.ts`, `lib/commands.ts`

- [ ] **Step 2: Write failing test for Layout without theme colors**

Update `src/components/__tests__/Layout.test.tsx`: remove mocks of
`getThemeColors`; assert Layout renders with the static accent.

- [ ] **Step 3: Implement** — delete `src/hooks/useThemeColors.ts` and
  `src/hooks/useThemeCssVars.ts`; in `Layout.tsx` replace the dynamic gradient
  with the current default accent values as constants; remove `getThemeColors`
  wrapper from `src/lib/commands.ts`.

- [ ] **Step 4: Run tests** — `bun run test:run` PASS

- [ ] **Step 5: Manual check** — Settings → Theme dropdown lists all 8 themes
  (from manifests); preview switches the overlay live.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "refactor(settings): decouple main-window accent from overlay themes"
```

---

## Phase 6 — Deletion of legacy theme code

Tasks 6.1 / 6.2 are **[parallel-group:D]** (TS vs Rust). Run only after Phase 5
is verified on macOS.

### Task 6.1: Delete legacy TS theme stack

**Files to delete:**
- `src/themes/handy.ts`, `src/themes/builtinHandyThemes.ts`,
  `src/themes/HandyThemeProvider.tsx`, `src/themes/useFetchedHandyTheme.ts`
  + their `__tests__`
- `src/components/overlay/ClassicBars.tsx`, `HandyBars.tsx`, `HandyPill.tsx`,
  `HandyPill.module.css`, `OrganicRing.tsx`, `ringGeometry.ts` (shim)
  + their `__tests__`
- `src/hooks/useSmoothBars.ts`, `src/hooks/useBarPeaks.ts` + tests
  (logic now lives in `theme-engine/renderers/smoothing.ts`)

- [ ] **Step 1: Verify nothing else imports them**

Run: `grep -rn "themes/handy\|HandyThemeProvider\|useFetchedHandyTheme\|components/overlay/\|useSmoothBars\|useBarPeaks" src --include="*.ts*" | grep -v theme-engine | grep -v __tests__`
Expected: empty (if not — fix the importer first, don't delete blind)

- [ ] **Step 2: Delete + run suite**

```bash
git rm -r src/themes/handy.ts src/themes/builtinHandyThemes.ts \
  src/themes/HandyThemeProvider.tsx src/themes/useFetchedHandyTheme.ts \
  src/themes/__tests__ src/components/overlay src/hooks/useSmoothBars.ts \
  src/hooks/useBarPeaks.ts
bunx vitest run && bunx tsc --noEmit
```
Expected: PASS / clean compile. Remove dead test files that referenced deleted
modules if vitest reports them.

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor(ts): delete legacy theme stack — themes are code modules now"
```

### Task 6.2: Delete legacy Rust theme semantics

**Files:**
- Delete: `src-tauri/src/overlay/themes/handy.rs`, `overlay/themes_handy_tests.rs`
- Shrink: `src-tauri/src/overlay_native/theme.rs` — delete `VisualizationTheme`
  builtins/gradient/validation/ThemeLoader (~800 lines); keep ONLY what the
  window backends still reference (check `nspanel.rs`/`webview.rs` imports;
  `OverlayThemeData` and `ThemeColors` DTOs die with their commands)
- Modify: `src-tauri/src/commands/overlay.rs` — delete `get_handy_theme`,
  `get_theme_colors`, `get_overlay_theme_data` + their entries in
  `lib.rs` `collect_commands!`/`generate_handler!`
- Modify: `src-tauri/src/setup/state.rs` — drop legacy `ThemeLoaderState`
- Modify: `src/lib/commands.ts` — drop deleted wrappers; regenerate `src/bindings.ts`

- [ ] **Step 1: Map remaining references**

Run: `grep -rn "VisualizationTheme\|ThemeLoaderState\|get_handy_theme\|get_theme_colors\|get_overlay_theme_data\|OverlayThemeData" src-tauri/src --include="*.rs" | grep -v theme_engine`
Work through every hit: rewire to `theme_engine` or delete.

- [ ] **Step 2: Delete, compile, fix** — iterate `cargo check` until clean.
  The `setup/tests.rs` command-sync test enforces handler-list consistency.

- [ ] **Step 3: Run full Rust suite** — `cd src-tauri && cargo test` PASS

- [ ] **Step 4: Regenerate bindings, run TS suite** — `bun run test:run` PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor(rust): delete legacy theme semantics — Rust is theme-agnostic engine"
```

---

## Phase 7 — Final verification

### Task 7.1: Full sweep + smoke checklist

- [ ] **Step 1: Full automated sweep**

```bash
bun run build:themes
bunx tsc --noEmit
bun run lint
bun run test:run
cd src-tauri && cargo build --examples && cargo test && cd ..
bun run build
```
Expected: everything green.

- [ ] **Step 2: Manual smoke (macOS, the only verified platform)**

1. `bun run tauri dev` — record via hotkey → pill bars animate → transcribe label → idle
2. Settings → Theme: all 8 themes listed; preview each family (bars / ring / pill behavior per theme)
3. Copy a builtin from themes dir (`get_themes_dir` path) → edit colors in theme.js → Reload themes → custom theme appears and renders
4. Break the custom theme.js (syntax error) → reload → overlay falls back to default, no blank window, error in logs
5. Restart app — seeded themes intact, user-edited theme NOT overwritten

- [ ] **Step 3: Update CLAUDE.md**

Add to Architecture section: `theme-engine` modules (TS host + Rust loader),
theme format (manifest v2 + `mount(container, themeApi)`), `build:themes` script.
Remove mentions of `overlay_native` egui overlay / `voice-overlay` binary if present.

- [ ] **Step 4: Final commit**

```bash
git add -A && git commit -m "docs: user themes v1 — update CLAUDE.md, finish plan"
```

---

## Deferred (explicitly OUT of this plan — separate plans)

- Typed `AppError` for all 69 commands (do overlay/theme commands during Phase 4 ONLY if free; full migration is its own plan)
- `config_ini.rs` shrink (−700 lines)
- `SqliteStore<S>` generic vs 5× `connect()`
- Theme authoring docs page / JSON schema for manifest
- Linux/Windows overlay verification

## Self-review notes

- Spec coverage: format/manifest (T3.1, T4.1), contract (T1.1), host+fallback (T1.3, T5.1), Rust engine-only (T4.x, T6.2), 8 builtin conversions (T3.x), deletion of mirror (T6.x), CI hygiene (T0.1) — covered.
- Command-name continuity for settings UI verified against `src/lib/commands.ts` usages (ThemeSelect/useVisualizationThemes keep working).
- Types referenced across tasks checked: `ThemeState`/`ThemeApi`/`Renderer` defined in T1.1/T2.1 before use in T2.x/T3.x/T5.1; `ThemeValidation` defined T4.1 before T4.2.
