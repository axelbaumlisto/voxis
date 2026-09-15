// crates/tauri-plugin-voxis/guest-js/__tests__/overlay.test.ts
/**
 * Exercises `<voxis-overlay>` against a fully mocked `VoxisClient` — no
 * `@tauri-apps/api`/Tauri runtime involved (the injectable-client
 * requirement in the plan's acceptance list).
 *
 * The CSP-under-naked requirement itself ("mount under CSP naked") is
 * only *partially* checked here: jsdom parses a `<meta http-equiv="
 * Content-Security-Policy">` tag but does not enforce it (no real CSP
 * engine), so a test that "mounts fine with the meta tag present" would
 * pass even if the overlay secretly used a blocked `Blob:`/`data:`
 * `import()`. The bundle-grep test in `csp-bundle.test.ts` (scans the
 * *built* `dist/` output for those substrings) is the actual CSP
 * enforcement gate; this test only documents/exercises the mount path
 * under the same meta tag naked ships, for documentation/regression
 * value, not as the CSP guarantee itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cornerPosition, mountOverlay, VoxisOverlayElement, type OverlayCorner } from "../src/overlay";
import { clampToViewport, savePosition } from "../src/drag";
import type { DictationResult, LevelEvent, PluginState } from "../src/types/contract";
import type { VoxisClient } from "../src/client";

function createMockClient() {
  const stateHandlers = new Set<(s: PluginState) => void>();
  const levelHandlers = new Set<(l: LevelEvent) => void>();
  const resultHandlers = new Set<(r: DictationResult) => void>();

  const client: VoxisClient = {
    start: vi.fn(async () => "session-1"),
    stop: vi.fn(async () => ({ text: "hi", language: null, durationMs: 100, guardOutcome: "finalized" as const })),
    cancel: vi.fn(async () => undefined),
    state: vi.fn(async () => "idle" as const),
    getProfile: vi.fn(),
    applyProfile: vi.fn(),
    importProfileFromDesktop: vi.fn(),
    importProfileFromQr: vi.fn(),
    setHotkey: vi.fn(async () => undefined),
    setConsent: vi.fn(async () => undefined),
    holdLease: vi.fn(async () => undefined),
    dictate: vi.fn(),
    onState: vi.fn(async (cb: (s: PluginState) => void) => {
      stateHandlers.add(cb);
      return () => stateHandlers.delete(cb);
    }),
    onLevel: vi.fn(async (cb: (l: LevelEvent) => void) => {
      levelHandlers.add(cb);
      return () => levelHandlers.delete(cb);
    }),
    onResult: vi.fn(async (cb: (r: DictationResult) => void) => {
      resultHandlers.add(cb);
      return () => resultHandlers.delete(cb);
    }),
  };

  return {
    client,
    emitState(s: PluginState) {
      for (const cb of stateHandlers) cb(s);
    },
    emitLevel(l: LevelEvent) {
      for (const cb of levelHandlers) cb(l);
    },
    emitResult(r: DictationResult) {
      for (const cb of resultHandlers) cb(r);
    },
  };
}

function pointerEvent(type: string, pointerId = 1): PointerEvent {
  return new PointerEvent(type, { pointerId, bubbles: true, composed: true });
}

describe("<voxis-overlay>", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    localStorage.clear();
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  it("mounts a shadow DOM with a pill button", () => {
    const { client } = createMockClient();
    const el = mountOverlay(container, { client });
    expect(el.tagName.toLowerCase()).toBe("voxis-overlay");
    expect(el.shadowRoot).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".pill")).not.toBeNull();
  });

  it("unknown theme id falls back to default and warns, without throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client } = createMockClient();
    expect(() => mountOverlay(container, { client, theme: "no-such-theme" })).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });

  it("hold mode: pointerdown starts a session, pointerup stops it", async () => {
    const { client } = createMockClient();
    const el = mountOverlay(container, { client, mode: "hold" });
    const pill = el.shadowRoot!.querySelector(".pill") as HTMLButtonElement;

    pill.dispatchEvent(pointerEvent("pointerdown"));
    await Promise.resolve();
    await Promise.resolve();
    expect(client.start).toHaveBeenCalledWith("hold");

    pill.dispatchEvent(pointerEvent("pointerup"));
    await Promise.resolve();
    expect(client.stop).toHaveBeenCalledWith("session-1");
  });

  it("hold mode: pointercancel stops the session (never a stuck recording)", async () => {
    const { client } = createMockClient();
    const el = mountOverlay(container, { client, mode: "hold" });
    const pill = el.shadowRoot!.querySelector(".pill") as HTMLButtonElement;

    pill.dispatchEvent(pointerEvent("pointerdown"));
    await Promise.resolve();
    await Promise.resolve();

    pill.dispatchEvent(pointerEvent("pointercancel"));
    await Promise.resolve();
    expect(client.stop).toHaveBeenCalledWith("session-1");
  });

  it("hold mode: lostpointercapture stops the session", async () => {
    const { client } = createMockClient();
    const el = mountOverlay(container, { client, mode: "hold" });
    const pill = el.shadowRoot!.querySelector(".pill") as HTMLButtonElement;

    pill.dispatchEvent(pointerEvent("pointerdown"));
    await Promise.resolve();
    await Promise.resolve();

    pill.dispatchEvent(pointerEvent("lostpointercapture"));
    await Promise.resolve();
    expect(client.stop).toHaveBeenCalledWith("session-1");
  });

  it("hold mode: window blur stops an active session", async () => {
    const { client } = createMockClient();
    const el = mountOverlay(container, { client, mode: "hold" });
    const pill = el.shadowRoot!.querySelector(".pill") as HTMLButtonElement;

    pill.dispatchEvent(pointerEvent("pointerdown"));
    await Promise.resolve();
    await Promise.resolve();

    window.dispatchEvent(new Event("blur"));
    await Promise.resolve();
    expect(client.stop).toHaveBeenCalledWith("session-1");
  });

  it("toggle mode: a tap starts, a second tap stops", async () => {
    const { client } = createMockClient();
    const el = mountOverlay(container, { client, mode: "toggle" });
    const pill = el.shadowRoot!.querySelector(".pill") as HTMLButtonElement;

    pill.dispatchEvent(pointerEvent("pointerdown"));
    pill.dispatchEvent(pointerEvent("pointerup"));
    await Promise.resolve();
    await Promise.resolve();
    expect(client.start).toHaveBeenCalledTimes(1);
    expect(client.stop).not.toHaveBeenCalled();

    pill.dispatchEvent(pointerEvent("pointerdown"));
    pill.dispatchEvent(pointerEvent("pointerup"));
    await Promise.resolve();
    await Promise.resolve();
    expect(client.stop).toHaveBeenCalledWith("session-1");
  });

  it("toggle mode: a session ended by the plugin itself (silence timeout etc.) does not leave a stale session id — the next tap starts fresh instead of calling stop(staleId) [REJECT-FIX L3]", async () => {
    const { client, emitState, emitResult } = createMockClient();
    const el = mountOverlay(container, { client, mode: "toggle" });
    const pill = el.shadowRoot!.querySelector(".pill") as HTMLButtonElement;

    pill.dispatchEvent(pointerEvent("pointerdown"));
    pill.dispatchEvent(pointerEvent("pointerup"));
    await Promise.resolve();
    await Promise.resolve();
    expect(client.start).toHaveBeenCalledTimes(1);

    // The plugin ends the session on its own — no stop()/cancel() call
    // from this side at all (e.g. silence timeout, max duration).
    emitState("idle");
    emitResult({ text: "", language: null, durationMs: 60000, guardOutcome: "silenceTimeoutNoSpeech" });

    pill.dispatchEvent(pointerEvent("pointerdown"));
    pill.dispatchEvent(pointerEvent("pointerup"));
    await Promise.resolve();
    await Promise.resolve();

    expect(client.stop).not.toHaveBeenCalled();
    expect(client.start).toHaveBeenCalledTimes(2);
  });

  it("shows a persistent recording indicator (aria-live text + visible dot) while state is recording", () => {
    const { client, emitState } = createMockClient();
    const el = mountOverlay(container, { client, mode: "toggle" });
    const dot = el.shadowRoot!.querySelector(".dot") as HTMLElement;
    const live = el.shadowRoot!.querySelector('[aria-live]') as HTMLElement;

    expect(dot.classList.contains("visible")).toBe(false);
    expect(live.textContent).toBe("");

    emitState("recording");
    expect(dot.classList.contains("visible")).toBe(true);
    expect(live.textContent).toBe("Recording");

    emitState("idle");
    expect(dot.classList.contains("visible")).toBe(false);
    expect(live.textContent).toBe("");
  });

  it("propagates level/state/muted into the theme bridge without throwing", () => {
    const { client, emitState, emitLevel } = createMockClient();
    expect(() => {
      const el = mountOverlay(container, { client });
      emitState("recording");
      emitLevel({ rms: 0.7, peak: 0.9, muted: false });
      emitLevel({ rms: 0.7, peak: 0.9, muted: true });
      el.remove();
    }).not.toThrow();
  });

  it("disconnecting the element cleans up its subscriptions", async () => {
    const { client } = createMockClient();
    const el = mountOverlay(container, { client });
    el.remove();
    // No further assertions needed beyond "does not throw" — the real
    // guarantee is that onState/onLevel's returned unlisten functions
    // were called; VoxisOverlayElement's disconnectedCallback does this
    // unconditionally.
    expect(el.isConnected).toBe(false);
  });

  describe("viewport reflow [REJECT-FIX M1]", () => {
    class FakeVisualViewport extends EventTarget {
      constructor(public width: number, public height: number) {
        super();
      }
    }

    afterEach(() => {
      Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined });
    });

    it("re-clamps the pill when visualViewport shrinks (e.g. the iOS keyboard opening)", () => {
      const fakeVV = new FakeVisualViewport(400, 800);
      Object.defineProperty(window, "visualViewport", { configurable: true, value: fakeVV });

      const { client } = createMockClient();
      const el = mountOverlay(container, { client, storageKey: "m1-visualviewport-resize" });
      const pill = el.shadowRoot!.querySelector(".pill") as HTMLButtonElement;
      // Settled near the bottom while the keyboard was closed (800px tall viewport).
      pill.style.top = "700px";

      fakeVV.height = 300; // keyboard opens, effective viewport shrinks
      fakeVV.dispatchEvent(new Event("resize"));

      const top = parseFloat(pill.style.top);
      expect(top + 64).toBeLessThanOrEqual(300);
    });

    it("re-clamps on visualViewport's own scroll event too", () => {
      const fakeVV = new FakeVisualViewport(400, 300);
      Object.defineProperty(window, "visualViewport", { configurable: true, value: fakeVV });

      const { client } = createMockClient();
      const el = mountOverlay(container, { client, storageKey: "m1-visualviewport-scroll" });
      const pill = el.shadowRoot!.querySelector(".pill") as HTMLButtonElement;
      pill.style.top = "9999px"; // way out of bounds

      fakeVV.dispatchEvent(new Event("scroll"));

      const top = parseFloat(pill.style.top);
      expect(top + 64).toBeLessThanOrEqual(300);
    });

    it("falls back to window resize/orientationchange when visualViewport is unsupported", () => {
      Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined });
      const originalInnerHeight = window.innerHeight;
      const { client } = createMockClient();
      const el = mountOverlay(container, { client, storageKey: "m1-window-resize" });
      const pill = el.shadowRoot!.querySelector(".pill") as HTMLButtonElement;
      pill.style.top = "9999px";

      try {
        Object.defineProperty(window, "innerHeight", { configurable: true, value: 250 });
        window.dispatchEvent(new Event("resize"));

        const top = parseFloat(pill.style.top);
        expect(top + 64).toBeLessThanOrEqual(250);
      } finally {
        Object.defineProperty(window, "innerHeight", { configurable: true, value: originalInnerHeight });
      }
    });
  });
});

describe("<voxis-overlay> driver: \"host\" [T10-overlay]", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    localStorage.clear();
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  it("mounts without a client, and never subscribes to one even if passed anyway", () => {
    expect(() => mountOverlay(container, { driver: "host" })).not.toThrow();

    const { client } = createMockClient();
    const otherContainer = document.createElement("div");
    document.body.appendChild(otherContainer);
    mountOverlay(otherContainer, { driver: "host", client });
    expect(client.onState).not.toHaveBeenCalled();
    expect(client.onLevel).not.toHaveBeenCalled();
    expect(client.onResult).not.toHaveBeenCalled();
    otherContainer.remove();
  });

  it("pill press dispatches voxis-overlay-press and never starts/stops a session", async () => {
    const { client } = createMockClient();
    const el = mountOverlay(container, { driver: "host", client });
    const pill = el.shadowRoot!.querySelector(".pill") as HTMLButtonElement;
    const phases: string[] = [];
    el.addEventListener("voxis-overlay-press", (e) => {
      phases.push((e as CustomEvent<{ phase: string }>).detail.phase);
    });

    pill.dispatchEvent(pointerEvent("pointerdown"));
    pill.dispatchEvent(pointerEvent("pointerup"));
    await Promise.resolve();
    await Promise.resolve();

    expect(phases).toEqual(["down", "up"]);
    expect(client.start).not.toHaveBeenCalled();
    expect(client.stop).not.toHaveBeenCalled();
  });

  it("pointercancel/lostpointercapture also dispatch an 'up' phase, never start/stop", async () => {
    const { client } = createMockClient();
    const el = mountOverlay(container, { driver: "host", client });
    const pill = el.shadowRoot!.querySelector(".pill") as HTMLButtonElement;
    const phases: string[] = [];
    el.addEventListener("voxis-overlay-press", (e) => {
      phases.push((e as CustomEvent<{ phase: string }>).detail.phase);
    });

    pill.dispatchEvent(pointerEvent("pointerdown"));
    pill.dispatchEvent(pointerEvent("pointercancel"));
    pill.dispatchEvent(pointerEvent("pointerdown"));
    pill.dispatchEvent(pointerEvent("lostpointercapture"));
    await Promise.resolve();

    expect(phases).toEqual(["down", "up", "down", "up"]);
    expect(client.start).not.toHaveBeenCalled();
    expect(client.stop).not.toHaveBeenCalled();
  });

  it("does not add a window blur listener (nothing here is started, so nothing needs stopping on blur)", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const el = mountOverlay(container, { driver: "host" });
    expect(addSpy.mock.calls.some(([type]) => type === "blur")).toBe(false);
    el.remove();
  });

  it("window blur is a no-op (no client to call, does not throw)", () => {
    const el = mountOverlay(container, { driver: "host" });
    expect(() => window.dispatchEvent(new Event("blur"))).not.toThrow();
    el.remove();
  });

  it("the theme's own cancel action is a no-op instead of touching a nonexistent client", () => {
    const el = mountOverlay(container, { driver: "host" });
    const bridge = (el as unknown as { themeBridge: { api: { actions: { cancel: () => void } } } }).themeBridge;
    expect(() => bridge.api.actions.cancel()).not.toThrow();
    el.remove();
  });

  it("disconnectedCallback leaves no window listeners behind beyond the drag/viewport ones every driver adds", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const el = mountOverlay(container, { driver: "host" });
    el.remove();

    const addedTypes = addSpy.mock.calls.map(([type]) => type as string);
    const removedTypes = removeSpy.mock.calls.map(([type]) => type as string);
    expect(addedTypes).not.toContain("blur");
    // Every listener type this driver *did* add (resize/orientationchange,
    // shared with driver: "client") was also removed on disconnect.
    for (const type of new Set(addedTypes)) {
      expect(removedTypes).toContain(type);
    }
  });

  it.each(["client", "host"] as const)(
    "applyState (driver=%s) updates the recording indicator identically to the other driver",
    (driver) => {
      const { client, emitState } = createMockClient();
      const el =
        driver === "client" ? mountOverlay(container, { client, mode: "toggle" }) : mountOverlay(container, { driver: "host" });
      const dot = el.shadowRoot!.querySelector(".dot") as HTMLElement;
      const live = el.shadowRoot!.querySelector("[aria-live]") as HTMLElement;

      expect(dot.classList.contains("visible")).toBe(false);
      expect(live.textContent).toBe("");

      if (driver === "client") {
        emitState("recording");
      } else {
        el.applyState("recording");
      }
      expect(dot.classList.contains("visible")).toBe(true);
      expect(live.textContent).toBe("Recording");

      if (driver === "client") {
        emitState("idle");
      } else {
        el.applyState("idle");
      }
      expect(dot.classList.contains("visible")).toBe(false);
      expect(live.textContent).toBe("");
    },
  );

  it("applyLevel/applyResult route into the same theme bridge/session-clearing path as the client driver, without throwing", () => {
    const el = mountOverlay(container, { driver: "host" });
    expect(() => {
      el.applyState("recording");
      el.applyLevel({ rms: 0.5, peak: 0.8, muted: false });
      el.applyLevel({ rms: 0.5, peak: 0.8, muted: true });
      el.applyResult({ text: "hi", language: null, durationMs: 10, guardOutcome: "finalized" });
    }).not.toThrow();
  });
});

describe("<voxis-overlay> under naked's CSP meta tag", () => {
  it("mounts without the CSP meta tag itself throwing (jsdom does not enforce CSP — see file doc comment)", () => {
    const meta = document.createElement("meta");
    meta.httpEquiv = "Content-Security-Policy";
    meta.content = "default-src 'self'; script-src 'self'";
    document.head.appendChild(meta);

    const { client } = createMockClient();
    const container = document.createElement("div");
    document.body.appendChild(container);
    expect(() => mountOverlay(container, { client })).not.toThrow();

    meta.remove();
    container.remove();
  });
});

describe("cornerPosition [initialPosition]", () => {
  const size = { width: 64, height: 64 };
  const viewport = { width: 390, height: 844 }; // the naked repro's phone viewport

  it("top-left", () => {
    expect(cornerPosition("top-left", size, viewport)).toEqual({ x: 16, y: 16 });
  });

  it("top-right", () => {
    expect(cornerPosition("top-right", size, viewport)).toEqual({ x: 390 - 64 - 16, y: 16 });
  });

  it("bottom-left", () => {
    expect(cornerPosition("bottom-left", size, viewport)).toEqual({ x: 16, y: 844 - 64 - 16 });
  });

  it("bottom-right — same math the element's default has always used", () => {
    expect(cornerPosition("bottom-right", size, viewport)).toEqual({ x: 390 - 64 - 16, y: 844 - 64 - 16 });
  });
});

describe("<voxis-overlay> initialPosition option", () => {
  let container: HTMLDivElement;
  const PILL_SIZE = { width: 64, height: 64 };
  const originalInnerWidth = window.innerWidth;
  const originalInnerHeight = window.innerHeight;

  function setViewport(width: number, height: number): void {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
  }

  function pillPos(el: VoxisOverlayElement): { x: number; y: number } {
    const pill = el.shadowRoot!.querySelector(".pill") as HTMLButtonElement;
    return { x: parseFloat(pill.style.left), y: parseFloat(pill.style.top) };
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    localStorage.clear();
    Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined });
    setViewport(390, 844); // the naked repro's phone viewport
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
    setViewport(originalInnerWidth, originalInnerHeight);
  });

  it("default (no initialPosition) is unchanged: bottom-right, same as before this option existed", () => {
    const { client } = createMockClient();
    const el = mountOverlay(container, { client, storageKey: "initial-pos-default" });
    expect(pillPos(el)).toEqual(cornerPosition("bottom-right", PILL_SIZE, { width: 390, height: 844 }));
  });

  it.each((["top-left", "top-right", "bottom-left", "bottom-right"] as OverlayCorner[]).map((corner) => [corner]))(
    "initialPosition: %s places the pill at that corner (clamped)",
    (corner: OverlayCorner) => {
      const { client } = createMockClient();
      const el = mountOverlay(container, { client, storageKey: `initial-pos-${corner}`, initialPosition: corner });
      expect(pillPos(el)).toEqual(cornerPosition(corner, PILL_SIZE, { width: 390, height: 844 }));
    },
  );

  it("explicit {x, y} within bounds is used as-is", () => {
    const { client } = createMockClient();
    const el = mountOverlay(container, {
      client,
      storageKey: "initial-pos-explicit-in-bounds",
      initialPosition: { x: 40, y: 60 },
    });
    expect(pillPos(el)).toEqual({ x: 40, y: 60 });
  });

  it("explicit {x, y} out of bounds is clamped via the existing clampToViewport (safe area + viewport)", () => {
    const { client } = createMockClient();
    const el = mountOverlay(container, {
      client,
      storageKey: "initial-pos-explicit-out-of-bounds",
      initialPosition: { x: 999999, y: -999999 },
    });
    const expected = clampToViewport(
      { x: 999999, y: -999999 },
      PILL_SIZE,
      { top: 0, right: 0, bottom: 0, left: 0 },
      { width: 390, height: 844 },
    );
    expect(pillPos(el)).toEqual(expected);
  });

  it("a persisted position wins over initialPosition", () => {
    savePosition("initial-pos-persisted-wins", { x: 12, y: 34 });
    const { client } = createMockClient();
    const el = mountOverlay(container, {
      client,
      storageKey: "initial-pos-persisted-wins",
      initialPosition: "top-left",
    });
    expect(pillPos(el)).toEqual({ x: 12, y: 34 });
  });
});

// Referenced so the import above is exercised type-wise, keeping the
// `VoxisOverlayElement` export part of this test's compiled surface.
void VoxisOverlayElement;
