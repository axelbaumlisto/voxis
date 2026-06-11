# Theme Visual Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A standalone, browser-based **visual harness** to develop and test overlay theme visualizations WITHOUT building/running the Tauri app. Open `bun run dev` → `http://localhost:<port>/harness.html`: pick any builtin theme, drive its state (mode / audioLevel / spectrum) by hand or via deterministic scenario players (speech-growth, startle burst, idle morph), and live-edit theme `params` JSON to tune visuals with zero rebuild.

**Why:** Today the only way to see a theme react is to `cargo build` the app, launch it via setsid, drive the debug socket, and screenshot the 172×36 overlay. That loop is minutes long. The harness reuses the EXACT production `ThemeHost` + the EXACT builtin theme modules + the EXACT `ThemeState` contract, so what you see is what the overlay renders — but with instant hot-reload and parameter tweaking.

**Architecture / DIP:** `ThemeHost` already depends on an injected `fetchModule(themeId) => Promise<ThemeModule>` and a `state: ThemeState` prop (see `src/theme-engine/ThemeHost.tsx`, `src/overlay.tsx`). The harness supplies:
- a **builtin fetchModule** that resolves `themeId → import("../theme-engine/builtin/<id>")` via `import.meta.glob` (no Tauri `readThemeScript`),
- a **state source** driven by UI controls + pure scenario generators instead of `useOverlayState` (Tauri events).

This is a second consumer of the same seam the overlay uses — zero changes to ThemeHost, contract, renderers, or builtin themes.

**Tech Stack:** TypeScript, React 18, Vite (multi-page), Canvas 2D, Vitest + jsdom + RTL, Bun.

**SOLID / DRY / KISS rationale:**
- **DRY** — reuses production `ThemeHost`, `contract.ts` types, builtin theme `index.ts` modules, and `validateThemeModule`. No re-implementation of mounting or state plumbing.
- **SRP** — `scenarios.ts` = pure frame generators (testable, no DOM); `builtinThemes.ts` = theme resolution only; `HarnessApp.tsx` = thin UI wiring.
- **OCP** — additive: a new Vite entry + harness-only files; nothing in `src/theme-engine/**` or `src/overlay.tsx` changes behavior. New `dev`/`build` wiring is additive.
- **DIP** — harness injects its own fetchModule + state, exactly like the overlay injects the Tauri ones.
- **KISS** — plain React controls, no state library; scenarios are pure functions of a frame index.

**Anti-goals (YAGNI):** no recording/export to video, no theme editor with autocomplete, no persistence/localStorage (can add later), no new runtime deps. The harness is a dev tool — not shipped in the Tauri binary (it's a separate HTML entry; the overlay/main bundles are unchanged).

---

## File Structure

- **New** `harness.html` (repo root) — Vite entry, mounts `src/harness/main.tsx`.
- **New** `src/harness/main.tsx` — ReactDOM root → `<HarnessApp/>`.
- **New** `src/harness/builtinThemes.ts` — `BUILTIN_THEME_IDS: string[]` + `fetchBuiltinThemeModule(id): Promise<ThemeModule>` via `import.meta.glob`, validated with `validateThemeModule`.
- **New** `src/harness/scenarios.ts` — pure `ThemeState` frame generators: `manualState`, `speechGrowth`, `startleBurst`, `idleMorph`, `steadySpeech`; a `Scenario` registry; `makeSpectrum` helper.
- **New** `src/harness/HarnessApp.tsx` — controls (theme picker, mode, audioLevel slider, spectrum mode, scenario play/stop, scale, params JSON editor) + `<ThemeHost/>` preview(s).
- **New** `src/harness/__tests__/scenarios.test.ts` — pure scenario tests.
- **New** `src/harness/__tests__/builtinThemes.test.ts` — resolver tests.
- **New** `src/harness/__tests__/HarnessApp.test.tsx` — render/interaction smoke test (RTL).
- **Modify** `vite.config.ts` — add `harness: resolve(__dirname, "harness.html")` to `rollupOptions.input` (so `bun run build` includes it; dev serves it regardless).
- **Modify** `package.json` — add `"dev:harness"` convenience script (prints the URL hint) — optional but nice.
- **Modify** `docs/THEMES.md` — short "Developing themes with the visual harness" section.

NOTE: keep all harness code under `src/harness/**` so coverage/include globs already pick up tests, and the overlay/main bundles never import harness code.

---

## Task 1: Builtin theme resolver (`builtinThemes.ts`)

**Files:**
- New: `src/harness/builtinThemes.ts`
- New: `src/harness/__tests__/builtinThemes.test.ts`

Resolve a themeId to its production builtin `ThemeModule` via `import.meta.glob` (Vite eager glob), validated with the production `validateThemeModule`. This is the harness's `fetchModule`.

- [ ] **Step 1: Failing test**

`src/harness/__tests__/builtinThemes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { BUILTIN_THEME_IDS, fetchBuiltinThemeModule } from "../builtinThemes";

describe("builtinThemes", () => {
  it("lists the known builtin theme ids", () => {
    expect(BUILTIN_THEME_IDS).toContain("drifting_contour");
    expect(BUILTIN_THEME_IDS).toContain("radiolarian");
    expect(BUILTIN_THEME_IDS).toContain("default");
    expect(BUILTIN_THEME_IDS.length).toBeGreaterThanOrEqual(10);
  });
  it("resolves a builtin module exporting mount()", async () => {
    const mod = await fetchBuiltinThemeModule("drifting_contour");
    expect(typeof mod.mount).toBe("function");
  });
  it("rejects an unknown theme id", async () => {
    await expect(fetchBuiltinThemeModule("nope__nonexistent")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run — verify fail**

Run: `bunx vitest run src/harness/__tests__/builtinThemes.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `builtinThemes.ts`**

```ts
// src/harness/builtinThemes.ts
/**
 * Harness theme resolver — the dev-tool analogue of production fetchModule.
 * Resolves a builtin themeId to its ThemeModule via import.meta.glob, so the
 * harness loads the EXACT same theme code the overlay bundles, with no Tauri.
 */
import { validateThemeModule, type ThemeModule } from "../theme-engine/contract";

// Eagerly import every builtin theme index. Keyed by full path.
const modules = import.meta.glob("../theme-engine/builtin/*/index.ts", {
  eager: true,
}) as Record<string, unknown>;

function idFromPath(p: string): string {
  // ".../builtin/<id>/index.ts" → "<id>"
  const m = p.match(/builtin\/([^/]+)\/index\.ts$/);
  return m ? m[1] : p;
}

const byId = new Map<string, unknown>();
for (const [p, mod] of Object.entries(modules)) {
  byId.set(idFromPath(p), mod);
}

export const BUILTIN_THEME_IDS: string[] = Array.from(byId.keys()).sort();

export async function fetchBuiltinThemeModule(id: string): Promise<ThemeModule> {
  const mod = byId.get(id);
  if (mod === undefined) {
    throw new Error(`unknown builtin theme: ${id}`);
  }
  const res = validateThemeModule(mod);
  if (!res.ok) throw new Error(`invalid theme '${id}': ${res.error}`);
  return mod as ThemeModule;
}
```

- [ ] **Step 4: Run — verify pass**

Run: `bunx vitest run src/harness/__tests__/builtinThemes.test.ts`
Expected: PASS. (Vitest uses Vite, so `import.meta.glob` works.)

- [ ] **Step 5: tsc + commit**

Run: `bunx tsc --noEmit` → clean.

```bash
git add src/harness/builtinThemes.ts src/harness/__tests__/builtinThemes.test.ts
git commit -m "feat(harness): builtin theme resolver via import.meta.glob"
```

---

## Task 2: Pure scenario generators (`scenarios.ts`)

**Files:**
- New: `src/harness/scenarios.ts`
- New: `src/harness/__tests__/scenarios.test.ts`

Pure functions that produce a `ThemeState` for a given frame index, so we can drive the same speech/startle/idle behaviors we tune by hand — deterministically and testably. A `Scenario` = `{ id, label, frames, at(frame) => ThemeState }`.

- [ ] **Step 1: Failing tests**

`src/harness/__tests__/scenarios.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { makeSpectrum, SCENARIOS, getScenario } from "../scenarios";

describe("makeSpectrum", () => {
  it("returns 32 bins in [0,1]", () => {
    const bins = makeSpectrum(0.8, 5);
    expect(bins).toHaveLength(32);
    for (const b of bins) {
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
    }
  });
  it("scales with level (louder → larger average)", () => {
    const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    expect(avg(makeSpectrum(0.9, 0))).toBeGreaterThan(avg(makeSpectrum(0.1, 0)));
  });
});

describe("scenarios", () => {
  it("exposes speech-growth, startle, idle-morph, steady", () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(ids).toEqual(
      expect.arrayContaining(["speech_growth", "startle_burst", "idle_morph", "steady_speech"]),
    );
  });
  it("each scenario yields valid ThemeState across its frames", () => {
    for (const sc of SCENARIOS) {
      for (const f of [0, Math.floor(sc.frames / 2), sc.frames - 1]) {
        const s = sc.at(f);
        expect(["idle", "recording", "transcribing", "error"]).toContain(s.mode);
        expect(s.audioLevel).toBeGreaterThanOrEqual(0);
        expect(s.audioLevel).toBeLessThanOrEqual(1);
        expect(s.spectrumBins).toHaveLength(32);
      }
    }
  });
  it("speech_growth: recording with rising-then-loud audio, ends in silence", () => {
    const sc = getScenario("speech_growth")!;
    expect(sc.at(0).mode).toBe("recording");
    const mid = sc.at(Math.floor(sc.frames * 0.5));
    expect(mid.audioLevel).toBeGreaterThan(0.3);
    expect(sc.at(sc.frames - 1).audioLevel).toBeCloseTo(0, 1); // trails into silence
  });
  it("startle_burst: a sudden spike frame far above its neighbours", () => {
    const sc = getScenario("startle_burst")!;
    let maxJump = 0;
    for (let f = 1; f < sc.frames; f++) {
      maxJump = Math.max(maxJump, sc.at(f).audioLevel - sc.at(f - 1).audioLevel);
    }
    expect(maxJump).toBeGreaterThan(0.5); // a real sharp onset
  });
  it("idle_morph: stays in idle/silence so the resting morph shows", () => {
    const sc = getScenario("idle_morph")!;
    for (const f of [0, sc.frames - 1]) {
      expect(sc.at(f).mode).toBe("idle");
      expect(sc.at(f).audioLevel).toBeCloseTo(0, 2);
    }
  });
  it("getScenario returns undefined for unknown id", () => {
    expect(getScenario("nope")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — verify fail**

Run: `bunx vitest run src/harness/__tests__/scenarios.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `scenarios.ts`**

```ts
// src/harness/scenarios.ts
/**
 * Pure ThemeState frame generators for the visual harness. No DOM, no time —
 * each scenario maps a frame index to a ThemeState, so behaviors (speech
 * growth, startle, idle morph) are deterministic and unit-testable, and the
 * harness can scrub/replay them at any speed.
 */
import type { ThemeMode, ThemeState } from "../theme-engine/contract";

/** Build a 32-bin spectrum for a given level, animated by frame f. */
export function makeSpectrum(level: number, f: number): number[] {
  const bins: number[] = [];
  for (let i = 0; i < 32; i++) {
    // smooth pseudo-spectral shape; deterministic in (i, f)
    const wave = 0.5 + 0.5 * Math.sin(i * 0.5 + f * 0.25);
    const falloff = 1 - i / 48; // gentle high-freq rolloff
    const v = level * wave * falloff;
    bins.push(Math.max(0, Math.min(1, v)));
  }
  return bins;
}

export interface Scenario {
  id: string;
  label: string;
  /** Total frames (at ~12.5 fps ≈ the 80ms backend cadence). */
  frames: number;
  at(frame: number): ThemeState;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function state(mode: ThemeMode, level: number, f: number): ThemeState {
  const lvl = clamp01(level);
  return { mode, audioLevel: lvl, spectrumBins: makeSpectrum(lvl, f) };
}

// Speech that ramps up, sustains loud, then trails into silence (idle).
const speechGrowth: Scenario = {
  id: "speech_growth",
  label: "Speech → grow → silence",
  frames: 160,
  at(f) {
    if (f < 90) {
      // rising then loud sustained speech
      const ramp = Math.min(1, f / 30);
      const lvl = 0.45 + 0.4 * ramp * (0.7 + 0.3 * Math.abs(Math.sin(f * 0.3)));
      return state("recording", lvl, f);
    }
    // silence / rest — let the held growth + idle morph show
    return state("idle", 0, f);
  },
};

// Quiet, then a single sharp loud spike (startle), then quiet again.
const startleBurst: Scenario = {
  id: "startle_burst",
  label: "Startle burst",
  frames: 120,
  at(f) {
    const spike = f >= 40 && f < 46; // ~0.5s loud burst after quiet
    const lvl = spike ? 0.95 : 0.12;
    return state("recording", lvl, f);
  },
};

// Rest only — exercises the idle morphing of the living cell.
const idleMorphSc: Scenario = {
  id: "idle_morph",
  label: "Idle morph (rest)",
  frames: 200,
  at(f) {
    return state("idle", 0, f);
  },
};

// Steady, continuous speech at a moderate level.
const steadySpeech: Scenario = {
  id: "steady_speech",
  label: "Steady speech",
  frames: 120,
  at(f) {
    const lvl = 0.55 + 0.2 * Math.sin(f * 0.4);
    return state("recording", lvl, f);
  },
};

export const SCENARIOS: Scenario[] = [
  speechGrowth,
  startleBurst,
  idleMorphSc,
  steadySpeech,
];

export function getScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
```

- [ ] **Step 4: Run — verify pass**

Run: `bunx vitest run src/harness/__tests__/scenarios.test.ts`
Expected: PASS.

- [ ] **Step 5: tsc + commit**

Run: `bunx tsc --noEmit` → clean.

```bash
git add src/harness/scenarios.ts src/harness/__tests__/scenarios.test.ts
git commit -m "feat(harness): pure ThemeState scenario generators (speech/startle/idle)"
```

---

## Task 3: Harness UI (`HarnessApp.tsx` + `main.tsx` + `harness.html`)

**Files:**
- New: `src/harness/HarnessApp.tsx`
- New: `src/harness/main.tsx`
- New: `harness.html`
- New: `src/harness/__tests__/HarnessApp.test.tsx`

The UI hosts the production `<ThemeHost/>` with `fetchModule={fetchBuiltinThemeModule}` and feeds it a `ThemeState` from either manual controls or a running scenario. It also live-edits the theme `params` JSON (passed straight into ThemeHost's `params` prop → theme `mount` receives it via `api.params`).

- [ ] **Step 1: Failing smoke test (RTL)**

`src/harness/__tests__/HarnessApp.test.tsx`:

```ts
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import HarnessApp from "../HarnessApp";

describe("HarnessApp", () => {
  it("renders a theme picker, a mode picker, and the preview host", () => {
    render(<HarnessApp />);
    expect(screen.getByLabelText(/theme/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/mode/i)).toBeInTheDocument();
    expect(screen.getByTestId("theme-host")).toBeInTheDocument();
  });
  it("lists builtin themes in the picker", () => {
    render(<HarnessApp />);
    const picker = screen.getByLabelText(/theme/i) as HTMLSelectElement;
    const values = Array.from(picker.options).map((o) => o.value);
    expect(values).toContain("drifting_contour");
    expect(values).toContain("radiolarian");
  });
  it("changing the audio level slider updates the readout", () => {
    render(<HarnessApp />);
    const slider = screen.getByLabelText(/audio level/i) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "0.75" } });
    expect(screen.getByText(/0\.75/)).toBeInTheDocument();
  });
  it("exposes scenario play buttons", () => {
    render(<HarnessApp />);
    expect(screen.getByRole("button", { name: /speech.*grow|grow/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — verify fail**

Run: `bunx vitest run src/harness/__tests__/HarnessApp.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `HarnessApp.tsx`**

Requirements (keep it KISS, inline styles ok — it's a dev tool):
- State: `themeId` (default `"drifting_contour"`), `mode`, `level`, `paramsText` (JSON string), `scale` (1..6), `running` scenario id | null, `frame`.
- Theme picker `<select aria-label="Theme">` from `BUILTIN_THEME_IDS`.
- Mode picker `<select aria-label="Mode">` over the 4 modes.
- Audio level `<input type="range" aria-label="Audio level" min=0 max=1 step=0.01>` + numeric readout text containing the value (e.g. `level.toFixed(2)`).
- Spectrum: derived from `makeSpectrum(level, frame)` (manual mode) — no separate control needed for v1, but include a checkbox "animate spectrum" that advances `frame` via rAF when checked OR when a scenario runs.
- Scenario buttons: one per `SCENARIOS` entry (`<button>{label}</button>`) → sets `running=sc.id`, resets `frame=0`; a "Stop" button → `running=null`. While running, a rAF loop advances `frame`; the displayed state = `getScenario(running)!.at(frame % frames)`; mode/level UI reflect the scenario's current frame (read-only-ish, but harmless if controls still work).
- Effective `ThemeState`: if `running`, use the scenario's `at(frame)`; else `{ mode, audioLevel: level, spectrumBins: makeSpectrum(level, frame) }`.
- Params editor: `<textarea aria-label="Params JSON">` bound to `paramsText`; parse with try/catch; on parse error show the message and pass `undefined` (theme falls back to its own defaults). The PARSED object is passed to `ThemeHost params={parsedParams}`. IMPORTANT: changing params remounts the theme (ThemeHost keys on `params` in its effect deps) — that's desired for tuning.
- Preview: render `<ThemeHost themeId={themeId} state={effState} fetchModule={fetchBuiltinThemeModule} fallbackModule={defaultTheme} onCancel={()=>{}} width={172} height={36} params={parsedParams} />` inside a wrapper `div` scaled via CSS `transform: scale(scale)` with a dark, checkered, or theme-appropriate background so light/dark themes are both visible. Provide a couple of background swatches (dark/black + a mid grey) via buttons or a select.
- A small scale control (`<input type="range" aria-label="Scale" min=1 max=6 step=1>`).
- Show the active themeId + current frame + parse-error (if any) in a status line.

Pseudostructure:

```tsx
// src/harness/HarnessApp.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import ThemeHost from "../theme-engine/ThemeHost";
import * as defaultTheme from "../theme-engine/builtin/default";
import { BUILTIN_THEME_IDS, fetchBuiltinThemeModule } from "./builtinThemes";
import { SCENARIOS, getScenario, makeSpectrum } from "./scenarios";
import type { ThemeMode, ThemeState } from "../theme-engine/contract";

const MODES: ThemeMode[] = ["idle", "recording", "transcribing", "error"];

export default function HarnessApp() {
  const [themeId, setThemeId] = useState("drifting_contour");
  const [mode, setMode] = useState<ThemeMode>("recording");
  const [level, setLevel] = useState(0.6);
  const [scale, setScale] = useState(4);
  const [bg, setBg] = useState("#111");
  const [paramsText, setParamsText] = useState("{}");
  const [running, setRunning] = useState<string | null>(null);
  const [animate, setAnimate] = useState(true);
  const [frame, setFrame] = useState(0);

  // rAF advances frame when animating or a scenario runs.
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    if (!animate && !running) return;
    let id: number;
    const tick = () => { setFrame((f) => f + 1); id = requestAnimationFrame(tick); };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [animate, running]);

  const { parsedParams, paramsError } = useMemo(() => {
    try {
      const v = paramsText.trim() === "" ? undefined : JSON.parse(paramsText);
      return { parsedParams: v, paramsError: null as string | null };
    } catch (e) {
      return { parsedParams: undefined, paramsError: (e as Error).message };
    }
  }, [paramsText]);

  const state: ThemeState = useMemo(() => {
    if (running) {
      const sc = getScenario(running)!;
      return sc.at(frame % sc.frames);
    }
    return { mode, audioLevel: level, spectrumBins: makeSpectrum(level, frame) };
  }, [running, frame, mode, level]);

  // ... render controls (with the aria-labels from the tests) + ThemeHost preview ...
}
```

Make sure every `aria-label` the test queries exists: "Theme", "Mode", "Audio level", "Scale", "Params JSON". The scenario buttons must have accessible names containing their labels (the `speech_growth` label "Speech → grow → silence" satisfies `/grow/i`).

`src/harness/main.tsx`:

```tsx
import ReactDOM from "react-dom/client";
import HarnessApp from "./HarnessApp";

const root = document.getElementById("root");
if (root) ReactDOM.createRoot(root).render(<HarnessApp />);
```

`harness.html` (root):

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Theme Visual Harness</title>
    <style>
      html, body { margin: 0; background: #1a1a1a; color: #ddd;
        font-family: system-ui, sans-serif; }
      #root { padding: 16px; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/harness/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Run — verify pass**

Run: `bunx vitest run src/harness/__tests__/HarnessApp.test.tsx`
Expected: PASS. (ThemeHost mounts via fetchBuiltinThemeModule; the cell renderer uses canvas — jsdom canvas may be a noop but mount must not throw; the test only checks DOM controls + the theme-host div exists.)

If jsdom canvas 2d context is null, the renderers already guard `if (ctx)` — mounting is safe. The `data-testid="theme-host"` div is rendered by ThemeHost regardless.

- [ ] **Step 5: tsc + lint + commit**

Run: `bunx tsc --noEmit` → clean. Run: `bun run lint` → 0 errors.

```bash
git add src/harness/HarnessApp.tsx src/harness/main.tsx harness.html src/harness/__tests__/HarnessApp.test.tsx
git commit -m "feat(harness): React UI — theme picker, state controls, scenarios, params editor"
```

---

## Task 4: Wire Vite multi-page entry + docs

**Files:**
- Modify: `vite.config.ts`
- Modify: `package.json` (optional convenience script)
- Modify: `docs/THEMES.md`

- [ ] **Step 1: Add harness to Vite build inputs**

In `vite.config.ts` `rollupOptions.input`, add:
```ts
        harness: resolve(__dirname, "harness.html"),
```
(Dev server serves `harness.html` regardless; this only ensures `bun run build` includes it and doesn't error.)

- [ ] **Step 2: Optional convenience script**

In `package.json` scripts add:
```json
    "harness": "vite",
```
(Same as `dev`, but documents intent: run it, then open `/harness.html`.) Keep it minimal — do NOT change `dev`/`build`.

- [ ] **Step 3: Docs**

Add to `docs/THEMES.md` a short section "Developing themes with the visual harness":
- Run `bun run dev` (or `bun run harness`).
- Open the printed URL + `/harness.html` (e.g. `http://localhost:5173/harness.html`).
- Pick a theme, drive mode/level, play a scenario (Speech→grow→silence, Startle burst, Idle morph), and live-edit the Params JSON to tune values; the preview remounts on each params change.
- Note it loads the SAME builtin theme modules + ThemeHost as the overlay, so visuals match production; no Tauri build needed.

- [ ] **Step 4: Verify build includes harness, doesn't break**

Run: `bun run build` — completes; output includes `harness.html` in `dist/`. (If `tsc` in the build complains about unused harness exports, fix locally.)
Run: `ls dist/harness.html` → exists.

- [ ] **Step 5: Commit**

```bash
git add vite.config.ts package.json docs/THEMES.md
git commit -m "build(harness): add harness.html Vite entry + docs"
```

---

## Task 5: Full verification + live smoke + ship

**Files:** none.

- [ ] **Step 1: Full suites**

Run: `bun run test:run` → all green (prior total + new harness tests).
Run: `bunx tsc --noEmit` → clean.
Run: `bun run lint` → 0 errors (3 pre-existing warnings OK).
(Rust untouched — skip cargo, or run `cd src-tauri && cargo test --lib` for completeness → still 854.)

- [ ] **Step 2: Live smoke (controller does this)**

Start the dev server detached, fetch `/harness.html`, confirm 200 + the script tag resolves. Optionally drive it with Playwright/puppeteer is OUT OF SCOPE; a curl/HTTP 200 + the vitest RTL smoke is sufficient proof the page builds. (Real visual confirmation is the user opening it in a browser — document the URL.)

```bash
# example: bun run dev & ; sleep 3 ; curl -sI http://localhost:<port>/harness.html | head -1
```

- [ ] **Step 3: Ship**

```bash
git checkout main && git merge feature/theme-visual-harness --no-edit
git branch -d feature/theme-visual-harness
git push gitverse main
```
(No release rebuild needed — the harness is a dev-only HTML entry and does not affect the Tauri binary. Mention this in the summary.)

---

## Self-Review (run before execution)

**Spec coverage:**
- "обвязка для тестирования визуализации без приложения" → standalone `harness.html` reusing production ThemeHost + builtin themes, no Tauri. ✓
- "в отдельную папку всё сохрани" → ALL new code under `src/harness/**` (+ root `harness.html` entry, the only file that must live at root for Vite). theme-engine/overlay untouched in behavior. ✓
- Manual control of mode/audioLevel/spectrum → controls + makeSpectrum. ✓
- Reproduce our effects (growth-hold, startle, idle morph) → deterministic scenarios. ✓
- Tune params without rebuild → live Params JSON editor → ThemeHost remounts. ✓

**Isolation check:** only additive change outside `src/harness/**` is `vite.config.ts` input map + an optional `package.json` script + `docs/THEMES.md`. No edits to `src/theme-engine/**`, `src/overlay.tsx`, renderers, or builtin themes. ✓

**DRY:** reuses ThemeHost, contract types, validateThemeModule, builtin modules. ✓

**Type consistency:** `fetchBuiltinThemeModule(id): Promise<ThemeModule>` matches ThemeHost's `fetchModule` prop. `Scenario.at(f): ThemeState` matches the `state` prop. `parsedParams: unknown` matches `params?: unknown`. ✓

**Risk:** jsdom canvas — renderers guard `if (ctx)`, so RTL mount won't throw; tests only assert DOM controls. `import.meta.glob` works under Vitest (Vite-powered). Params remount-on-change is intentional (keyed in ThemeHost effect). The harness HTML must not be imported by overlay/main bundles — it isn't (separate entry).

**Placeholder scan:** Task 3 gives full files for main.tsx/harness.html and a detailed spec + pseudostructure for HarnessApp (the only component with UI latitude); the tests pin the required aria-labels/behaviors so the implementer can't drift. ✓

---

## Execution Handoff

Subagent-Driven: implementer `o/deepseek-v4-pro` per task; reviewer `o/fable-5` after Task 3 (the UI) and before ship.
