# Overlay Press-and-Hold Dictation (mouse + touch) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Press and hold on the overlay visualization (the pill, within its current bounds) — with a **mouse OR a touch** — to start dictation; release to stop. This mirrors the existing push-to-talk hotkey, but driven by a pointer directly on the on-screen visualization.

**Key discovery (keeps this small):** The Rust backend already exposes everything needed:
- `Orchestrator::manual_start()` / `manual_stop()` → delegate to `on_hotkey_pressed()` / `on_hotkey_released()` (same recording path, same `hotkey_hold_ms` debounce, same overlay state machine).
- Tauri commands `manual_start_recording` / `manual_stop_recording` exist, are registered in `lib.rs`, and are in the generated `src/bindings.ts` as `commands.manualStartRecording()` / `commands.manualStopRecording()`.

So this feature is **frontend-only**: attach a pointer press/release handler to the overlay visualization that calls those existing commands. No new Rust, no new command, no orchestrator change.

**Why pointer events:** `pointerdown`/`pointerup`/`pointercancel` unify mouse, touch, and stylus in ONE code path — "и тач" is covered automatically. We also suppress the context menu (right-click / long-press) and disable `touch-action` so a touch hold doesn't scroll/select.

**Architecture / SRP:**
- A pure, DOM-free `pressController.ts` module holds the press/release state machine (guards against duplicate `pointerdown`, ensures exactly one start per release, ignores release without a prior start). Unit-tested in isolation.
- `overlay.tsx` wires real `pointerdown/up/cancel/leave` + `contextmenu` listeners on the host wrapper to the controller, which invokes `commands.manualStartRecording/StopRecording`.
- The visualization (ThemeHost) is unchanged; we wrap it in a pressable container.

**Tech Stack:** React 18 + TypeScript, Tauri v2 webview overlay, Vitest + jsdom + RTL.

**SOLID / DRY / KISS rationale:**
- **DRY** — reuses the existing manual_start/stop commands + orchestrator path; no duplicate recording logic.
- **SRP** — press state machine (pure) separated from DOM wiring (overlay.tsx).
- **OCP** — additive: a new module + a wrapper element + handlers in overlay.tsx. ThemeHost, renderers, themes, Rust untouched.
- **DIP** — `pressController` depends on injected `start`/`stop` callbacks, not on Tauri directly (so it's testable with fakes; overlay.tsx injects the real commands).
- **KISS** — no gestures/long-press timers in the frontend; the `hotkey_hold_ms` debounce already lives in the orchestrator and naturally ignores accidental short taps.

**Anti-goals (YAGNI):** no double-tap toggle, no drag-to-move, no per-button discrimination (any primary pointer press triggers), no global mouse capture (that's a different feature — this is strictly ON the visualization within its bounds). No config flag for v1 (always on) — can add a toggle later.

---

## File Structure

- **New** `src/overlay/pressController.ts` — pure press/release state machine: `createPressController({ onStart, onStop })` → `{ press(), release() }` with internal `isPressed` guard.
- **New** `src/overlay/__tests__/pressController.test.ts` — unit tests for the state machine.
- **Modify** `src/overlay.tsx` — wrap `<ThemeHost/>` in a pressable `<div>` with `onPointerDown/onPointerUp/onPointerCancel/onPointerLeave` + `onContextMenu` (preventDefault); inject `commands.manualStartRecording/StopRecording` into a `createPressController`. Add `touchAction: "none"` to the wrapper style.
- **New/Modify** `src/overlay/__tests__/overlay.pressHold.test.tsx` — RTL test: pointerdown on the host calls manualStartRecording; pointerup calls manualStopRecording; right-click is suppressed. (Mock `../bindings` commands.)
- **Modify** `overlay.html` — add `touch-action: none;` to `html, body, #root` so touch-hold doesn't scroll/zoom on the webview. (`user-select:none` already present.)

NOTE on file location: `overlay.tsx` lives at `src/overlay.tsx`; create the new pure module + tests under `src/overlay/` (a new folder) to keep them grouped, OR co-locate as `src/__tests__/`. Prefer `src/overlay/pressController.ts` + `src/overlay/__tests__/`. Confirm the import path from `src/overlay.tsx` is `./overlay/pressController`.

---

## Task 1: Pure press/release state machine (`pressController.ts`)

**Files:**
- New: `src/overlay/pressController.ts`
- New: `src/overlay/__tests__/pressController.test.ts`

A tiny state machine guarding start/stop pairing: a `press()` only fires `onStart` if not already pressed; `release()` only fires `onStop` if currently pressed (so a stray pointerup/leave without a prior down does nothing, and OS auto-repeat / duplicate pointerdown can't double-start).

- [ ] **Step 1: Failing tests**

`src/overlay/__tests__/pressController.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createPressController } from "../pressController";

describe("createPressController", () => {
  it("press() fires onStart once", () => {
    const onStart = vi.fn();
    const onStop = vi.fn();
    const c = createPressController({ onStart, onStop });
    c.press();
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();
  });
  it("duplicate press() does not double-start", () => {
    const onStart = vi.fn();
    const c = createPressController({ onStart, onStop: vi.fn() });
    c.press();
    c.press();
    expect(onStart).toHaveBeenCalledTimes(1);
  });
  it("release() after press() fires onStop once", () => {
    const onStop = vi.fn();
    const c = createPressController({ onStart: vi.fn(), onStop });
    c.press();
    c.release();
    expect(onStop).toHaveBeenCalledTimes(1);
  });
  it("release() without a prior press() does nothing", () => {
    const onStop = vi.fn();
    const c = createPressController({ onStart: vi.fn(), onStop });
    c.release();
    expect(onStop).not.toHaveBeenCalled();
  });
  it("press→release→press→release fires each twice", () => {
    const onStart = vi.fn();
    const onStop = vi.fn();
    const c = createPressController({ onStart, onStop });
    c.press(); c.release(); c.press(); c.release();
    expect(onStart).toHaveBeenCalledTimes(2);
    expect(onStop).toHaveBeenCalledTimes(2);
  });
  it("duplicate release() does not double-stop", () => {
    const onStop = vi.fn();
    const c = createPressController({ onStart: vi.fn(), onStop });
    c.press(); c.release(); c.release();
    expect(onStop).toHaveBeenCalledTimes(1);
  });
  it("swallows errors thrown by onStart/onStop (does not throw)", () => {
    const c = createPressController({
      onStart: () => { throw new Error("boom"); },
      onStop: () => { throw new Error("bang"); },
    });
    expect(() => { c.press(); c.release(); }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run — verify fail**

Run: `bunx vitest run src/overlay/__tests__/pressController.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `pressController.ts`**

```ts
// src/overlay/pressController.ts
/**
 * Press/release state machine for hold-to-dictate on the overlay.
 * Pure + DOM-free: callers wire pointer events to press()/release().
 *
 * Guarantees:
 *  - onStart fires only on a press from the released state (no double-start
 *    from duplicate pointerdown / OS autorepeat).
 *  - onStop fires only on a release from the pressed state (a stray
 *    pointerup/leave/cancel without a prior press is ignored).
 *  - callback errors are swallowed so a failed Tauri invoke can't wedge the
 *    state machine (the press flag is updated before invoking).
 */
export interface PressControllerOptions {
  onStart: () => void;
  onStop: () => void;
}

export interface PressController {
  press(): void;
  release(): void;
  /** Test/introspection helper. */
  isPressed(): boolean;
}

export function createPressController(opts: PressControllerOptions): PressController {
  let pressed = false;
  return {
    press() {
      if (pressed) return;
      pressed = true;
      try {
        opts.onStart();
      } catch (err) {
        console.error("[pressController] onStart threw:", err);
      }
    },
    release() {
      if (!pressed) return;
      pressed = false;
      try {
        opts.onStop();
      } catch (err) {
        console.error("[pressController] onStop threw:", err);
      }
    },
    isPressed() {
      return pressed;
    },
  };
}
```

- [ ] **Step 4: Run — verify pass**

Run: `bunx vitest run src/overlay/__tests__/pressController.test.ts`
Expected: PASS.

- [ ] **Step 5: tsc + commit**

Run: `bunx tsc --noEmit` → clean.

```bash
git add src/overlay/pressController.ts src/overlay/__tests__/pressController.test.ts
git commit -m "feat(overlay): pure press/release controller for hold-to-dictate"
```

---

## Task 2: Wire pointer (mouse+touch) handlers in `overlay.tsx`

**Files:**
- Modify: `src/overlay.tsx`
- Modify: `src/__tests__/overlay.test.tsx` (add press-hold cases — reuse its existing mocks)
- Modify: `overlay.html`

Wrap the ThemeHost in a pressable container. Pointer events cover mouse + touch + stylus. The controller invokes the EXISTING `commands.manualStartRecording()` / `commands.manualStopRecording()`.

- [ ] **Step 1: Failing tests (extend the existing suite)**

In `src/__tests__/overlay.test.tsx`:
- Add to the `vi.mock("../bindings", ...)` commands object:
  ```ts
    manualStartRecording: (...args: unknown[]) => manualStartMock(...args),
    manualStopRecording: (...args: unknown[]) => manualStopMock(...args),
  ```
  and declare near the other mocks:
  ```ts
  const manualStartMock = vi.fn().mockResolvedValue({ status: "ok", data: null });
  const manualStopMock = vi.fn().mockResolvedValue({ status: "ok", data: null });
  ```
  (reset them in `beforeEach` alongside the others if it clears mocks).
- Add a new describe block:
  ```ts
  describe("OverlayApp hold-to-dictate", () => {
    it("pointerdown on the overlay starts recording", async () => {
      const { container } = render(<OverlayApp />);
      const host = container.querySelector("[data-press-target]") as HTMLElement;
      expect(host).toBeTruthy();
      await act(async () => {
        host.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      });
      expect(manualStartMock).toHaveBeenCalledTimes(1);
    });
    it("pointerup stops recording", async () => {
      const { container } = render(<OverlayApp />);
      const host = container.querySelector("[data-press-target]") as HTMLElement;
      await act(async () => {
        host.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        host.dispatchEvent(new Event("pointerup", { bubbles: true }));
      });
      expect(manualStartMock).toHaveBeenCalledTimes(1);
      expect(manualStopMock).toHaveBeenCalledTimes(1);
    });
    it("contextmenu is prevented (no long-press menu on touch / right-click)", async () => {
      const { container } = render(<OverlayApp />);
      const host = container.querySelector("[data-press-target]") as HTMLElement;
      const ev = new Event("contextmenu", { bubbles: true, cancelable: true });
      host.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
    });
  });
  ```
  NOTE: React's synthetic `onPointerDown` listens for the native `pointerdown` event; jsdom supports `dispatchEvent(new Event("pointerdown"))` bubbling to React's root listener. If React's synthetic system doesn't catch a bare `Event` in jsdom, fall back to attaching the handlers via a `ref` + `addEventListener` in overlay.tsx (the test then works against real DOM listeners). Choose whichever makes the test pass with REAL events (no handler mocking).

- [ ] **Step 2: Run — verify fail**

Run: `bunx vitest run src/__tests__/overlay.test.tsx`
Expected: FAIL (no press target / commands not called).

- [ ] **Step 3: Implement in `overlay.tsx`**

- Import the controller: `import { createPressController } from "./overlay/pressController";`
- In `OverlayApp`, create the controller once (e.g. `useRef` or `useMemo`) bound to the real commands:
  ```ts
  const pressRef = useRef(
    createPressController({
      onStart: () => void commands.manualStartRecording(),
      onStop: () => void commands.manualStopRecording(),
    }),
  );
  ```
- Wrap the returned `<ThemeHost/>` in a pressable div that fills the window and forwards pointer events:
  ```tsx
  return (
    <div
      data-press-target
      style={{ width: "100%", height: "100%", touchAction: "none" }}
      onPointerDown={() => pressRef.current.press()}
      onPointerUp={() => pressRef.current.release()}
      onPointerCancel={() => pressRef.current.release()}
      onPointerLeave={() => pressRef.current.release()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <ThemeHost ... />
    </div>
  );
  ```
  (Release on pointercancel AND pointerleave so dragging off the pill / an interrupted touch reliably stops recording.)
- If the RTL test needs real DOM listeners (see Task 2 Step 1 note), instead attach via a `ref` + `useEffect(addEventListener/removeEventListener)`. Keep whichever passes with real events.

- [ ] **Step 4: overlay.html — disable touch gestures**

In `overlay.html` `<style>`, add `touch-action: none;` to the `html, body, #root` rule (next to the existing `user-select: none;`), so a touch hold doesn't pan/zoom the webview.

- [ ] **Step 5: Run — verify pass + full overlay suite**

Run: `bunx vitest run src/__tests__/overlay.test.tsx`
Expected: PASS (existing ThemeHost-integration tests + new hold-to-dictate tests).

Run: `bunx tsc --noEmit` → clean. Run: `bun run lint` → 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/overlay.tsx src/__tests__/overlay.test.tsx overlay.html
git commit -m "feat(overlay): hold visualization (mouse+touch) to dictate"
```

---

## Task 3: Full verification + live check + ship

**Files:** none (verification only)

- [ ] **Step 1: Full suites**

Run: `bun run test:run` → all green (prior total + new pressController + overlay tests).
Run: `bunx tsc --noEmit` → clean.
Run: `bun run lint` → 0 errors (3 pre-existing warnings OK).
Run: `cd src-tauri && cargo test --lib && cd ..` → 854 green (Rust untouched, sanity).

- [ ] **Step 2: Build + live check (controller does this)**

Run: `bun run build` then `cd src-tauri && cargo build && cd ..` (debug). Launch the debug build via setsid (DISPLAY=:0 XAUTHORITY=/tmp/xauth_UYrikP). Trigger the overlay to be visible (e.g. via debug socket `set_overlay_state recording` just to confirm it shows, then back to idle). With a REAL mouse: press-and-hold on the pill → confirm recording starts (overlay reacts / logs `on_hotkey_pressed`), release → stops (`on_hotkey_released`). Inspect `/tmp/log` for the manual_start/stop → on_hotkey path. 

KEY RISK to verify live: the overlay window must actually RECEIVE pointer events. It's a plain WebviewWindow built `focused(false)`; on Linux/GTK it is NOT ignore-cursor, so clicks on the opaque visualization should land. If clicks pass through / don't register, document it and check whether the window needs `focused(true)` on click or an explicit non-passthrough input region. (Do not change behavior blindly — report findings; a follow-up may be needed for Wayland/compositor specifics.)

- [ ] **Step 3: Ship**

```bash
git checkout main && git merge feature/overlay-press-hold-dictation --no-edit
git branch -d feature/overlay-press-hold-dictation
git push gitverse main
cd src-tauri && cargo build --release && cd ..
```
(Release rebuild because the overlay webview bundle changed; the Rust binary embeds the built frontend.)

---

## Self-Review (run before execution)

**Spec coverage:**
- "нажал мышкой и удерживал → диктовка" → pointerdown→manualStartRecording, release→manualStopRecording. ✓
- "так же если тач" → pointer events unify touch; `touch-action: none` + contextmenu suppression for touch-hold. ✓
- "на нашу саму визуализацию, в её текущих границах" → handlers on a wrapper that fills the overlay window (the pill's bounds), not a global mouse hook. ✓

**Reuse/no-new-Rust:** manual_start/stop commands + orchestrator path already exist and are in bindings. Backend untouched. ✓

**Debounce:** `hotkey_hold_ms` in the orchestrator already ignores accidental short taps — no frontend timer needed. ✓

**Type consistency:** `createPressController({onStart,onStop})` Task 1 ↔ overlay.tsx Task 2. `commands.manualStartRecording/StopRecording` exist in bindings.ts (verified). ✓

**Risk:** (1) jsdom + React synthetic pointer events — Task 2 Step 1 has a fallback to ref+addEventListener with real events if synthetic doesn't fire. (2) LIVE: the webview actually receiving the pointer on Linux/Wayland — flagged for the live check; may need a follow-up if the compositor drops events on a focused(false) transparent window. (3) pointerleave releasing mid-hold if the finger slides off the small pill — intended (stops recording); acceptable.

**Placeholder scan:** full code for pressController + test; concrete edits + test code for overlay.tsx. ✓

---

## Execution Handoff

Subagent-Driven: implementer `o/deepseek-v4-pro` per task; reviewer `o/fable-5` after Task 2 (the wiring) and before ship.
