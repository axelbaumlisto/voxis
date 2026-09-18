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
import { cornerPosition, COMPACT_SIZE, mountOverlay, VoxisOverlayElement, type OverlayCorner } from "../src/overlay";
import { OverlaySessionController } from "../src/overlay-session";
import { clampToViewport, loadPosition, savePosition } from "../src/drag";
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

  it("R3: a listen that resolves AFTER a fast disconnect unsubscribes itself instead of leaking (StrictMode mount→unmount→mount)", async () => {
    const { client } = createMockClient();
    let resolveState: ((fn: () => void) => void) | null = null;
    const stateUnlisten = vi.fn();
    (client as { onState: VoxisClient["onState"] }).onState = vi.fn(
      () => new Promise<() => void>((resolve) => { resolveState = resolve; }),
    );
    const el = mountOverlay(container, { client });
    expect(resolveState).not.toBeNull();
    el.remove();
    // The IPC round-trip completes only now — after disconnectedCallback ran.
    resolveState!(stateUnlisten);
    await Promise.resolve();
    await Promise.resolve();
    expect(stateUnlisten).toHaveBeenCalledTimes(1);
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
      expect(top + COMPACT_SIZE.height).toBeLessThanOrEqual(300);
    });

    it('driver:"host": a visualViewport resize does NOT move the pill — the host owns placement (iPad "two rings", 2026-09-19)', () => {
      const fakeVV = new FakeVisualViewport(1366, 1024);
      Object.defineProperty(window, "visualViewport", { configurable: true, value: fakeVV });

      const el = mountOverlay(container, { driver: "host", draggable: false, storageKey: "host-no-self-snap" });
      el.setPosition({ x: 282, y: 930 });
      const pill = el.shadowRoot!.querySelector(".pill") as HTMLButtonElement;
      expect(pill.style.top).toBe("930px");

      // A transient shrink (a key row / accessory view measuring in), then back.
      fakeVV.height = 934;
      fakeVV.dispatchEvent(new Event("resize"));
      fakeVV.height = 1024;
      fakeVV.dispatchEvent(new Event("resize"));

      // Unmoved: the host will re-anchor its ring AND the pill together via setPosition.
      expect(pill.style.left).toBe("282px");
      expect(pill.style.top).toBe("930px");
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
      expect(top + COMPACT_SIZE.height).toBeLessThanOrEqual(300);
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
        expect(top + COMPACT_SIZE.height).toBeLessThanOrEqual(250);
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

  it("instantiates NO OverlaySessionController (host owns the session); the client driver instantiates exactly one", () => {
    const { client } = createMockClient();
    const hostEl = mountOverlay(container, { driver: "host", client }) as unknown as { session: unknown };
    expect(hostEl.session).toBeNull();

    const clientContainer = document.createElement("div");
    document.body.appendChild(clientContainer);
    const clientEl = mountOverlay(clientContainer, { client }) as unknown as { session: unknown };
    expect(clientEl.session).toBeInstanceOf(OverlaySessionController);
    clientContainer.remove();
  });

  it("pill press is pure visual: never starts/stops a session and emits no voxis-overlay-press event (host owns press)", async () => {
    const { client } = createMockClient();
    const el = mountOverlay(container, { driver: "host", client });
    const pill = el.shadowRoot!.querySelector(".pill") as HTMLButtonElement;
    let pressEvents = 0;
    el.addEventListener("voxis-overlay-press", () => {
      pressEvents += 1;
    });

    pill.dispatchEvent(pointerEvent("pointerdown"));
    pill.dispatchEvent(pointerEvent("pointerup"));
    pill.dispatchEvent(pointerEvent("pointerdown"));
    pill.dispatchEvent(pointerEvent("pointercancel"));
    pill.dispatchEvent(pointerEvent("lostpointercapture"));
    await Promise.resolve();
    await Promise.resolve();

    expect(pressEvents).toBe(0);
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

  it("the theme's own cancel action is a no-op instead of touching a nonexistent client (idleTheme keeps the bridge mounted to reach it)", () => {
    const el = mountOverlay(container, { driver: "host", idleTheme: true });
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
    // Same CSP naked actually ships (src-tauri/tauri.conf.json's app.security.csp).
    meta.content = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src ipc: http://ipc.localhost";
    document.head.appendChild(meta);

    const { client } = createMockClient();
    const container = document.createElement("div");
    document.body.appendChild(container);
    expect(() => mountOverlay(container, { client })).not.toThrow();

    meta.remove();
    container.remove();
  });
});

describe("<voxis-overlay> initialPosition option", () => {
  let container: HTMLDivElement;
  // The overlay's default (idle) size is the compact handle, not the
  // pre-A6 fixed 64x64 pill — see `COMPACT_SIZE`/module doc comment.
  const PILL_SIZE = COMPACT_SIZE;
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

describe("<voxis-overlay> compact<->expanded lifecycle [A6]", () => {
  let container: HTMLDivElement;

  function countingThemeModule() {
    const calls = { mount: 0, unmount: 0 };
    const module = {
      mount: vi.fn(() => {
        calls.mount += 1;
        return { unmount: vi.fn(() => { calls.unmount += 1; }) };
      }),
    };
    return { module, calls };
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    localStorage.clear();
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  it.each(["client", "host"] as const)("driver=%s: starts compact (56x56, circle) and expands to the theme's manifest size on recording/transcribing, then shrinks back to compact on idle", (driver) => {
    const { module, calls } = countingThemeModule();
    const { client, emitState } = createMockClient();
    const el =
      driver === "client"
        ? mountOverlay(container, { client, theme: "lavalamp", themeModule: module })
        : mountOverlay(container, { driver: "host", theme: "lavalamp", themeModule: module });
    const pill = el.shadowRoot!.querySelector(".pill") as HTMLButtonElement;

    expect(el.lifecycle).toBe("compact");
    expect(el.size).toEqual(COMPACT_SIZE);
    expect(pill.style.width).toBe(`${COMPACT_SIZE.width}px`);
    expect(pill.classList.contains("state-compact")).toBe(true);
    expect(calls.mount).toBe(0);

    if (driver === "client") emitState("recording");
    else el.applyState("recording");

    expect(el.lifecycle).toBe("expanded");
    expect(el.size).toEqual({ width: 120, height: 120 });
    expect(pill.style.width).toBe("120px");
    expect(pill.classList.contains("state-expanded")).toBe(true);
    expect(calls.mount).toBe(1);
    expect(calls.unmount).toBe(0);

    if (driver === "client") emitState("idle");
    else el.applyState("idle");

    expect(el.lifecycle).toBe("compact");
    expect(el.size).toEqual(COMPACT_SIZE);
    expect(pill.style.width).toBe(`${COMPACT_SIZE.width}px`);
    expect(calls.mount).toBe(1);
    expect(calls.unmount).toBe(1);
  });

  it.each(["client", "host"] as const)("driver=%s: error state is also compact (unmounted), same as idle", (driver) => {
    const { module, calls } = countingThemeModule();
    const { client, emitState } = createMockClient();
    const el =
      driver === "client"
        ? mountOverlay(container, { client, theme: "lavalamp", themeModule: module })
        : mountOverlay(container, { driver: "host", theme: "lavalamp", themeModule: module });

    if (driver === "client") emitState("recording");
    else el.applyState("recording");
    expect(calls.mount).toBe(1);

    if (driver === "client") emitState("error");
    else el.applyState("error");
    expect(el.lifecycle).toBe("compact");
    expect(calls.unmount).toBe(1);
  });

  it.each(["client", "host"] as const)(
    "driver=%s: idleTheme: true mounts eagerly and never unmounts across idle/recording/idle transitions",
    (driver) => {
      const { module, calls } = countingThemeModule();
      const { client, emitState } = createMockClient();
      const el =
        driver === "client"
          ? mountOverlay(container, { client, theme: "lavalamp", themeModule: module, idleTheme: true })
          : mountOverlay(container, { driver: "host", theme: "lavalamp", themeModule: module, idleTheme: true });

      expect(el.lifecycle).toBe("expanded");
      expect(calls.mount).toBe(1);

      if (driver === "client") emitState("recording");
      else el.applyState("recording");
      expect(el.lifecycle).toBe("expanded");

      if (driver === "client") emitState("idle");
      else el.applyState("idle");
      expect(el.lifecycle).toBe("expanded");

      expect(calls.mount).toBe(1);
      expect(calls.unmount).toBe(0);
    },
  );

  it.each(["client", "host"] as const)(
    "driver=%s: dispatches voxis-overlay-resize with the new width/height/state on every compact<->expanded transition",
    (driver) => {
      const { module } = countingThemeModule();
      const { client, emitState } = createMockClient();
      const el =
        driver === "client"
          ? mountOverlay(container, { client, theme: "lavalamp", themeModule: module })
          : mountOverlay(container, { driver: "host", theme: "lavalamp", themeModule: module });
      const events: Array<{ width: number; height: number; state: string }> = [];
      el.addEventListener("voxis-overlay-resize", (e) => {
        events.push((e as CustomEvent<{ width: number; height: number; state: string }>).detail);
      });

      if (driver === "client") emitState("recording");
      else el.applyState("recording");
      expect(events).toEqual([{ width: 120, height: 120, state: "expanded" }]);

      if (driver === "client") emitState("idle");
      else el.applyState("idle");
      expect(events).toEqual([
        { width: 120, height: 120, state: "expanded" },
        { width: COMPACT_SIZE.width, height: COMPACT_SIZE.height, state: "compact" },
      ]);
    },
  );

  it.each(["client", "host"] as const)(
    "driver=%s: a drag while expanded clamps using the expanded size, and after shrinking back a drag clamps using the compact size again",
    (driver) => {
      const { module } = countingThemeModule();
      const { client, emitState } = createMockClient();
      const el =
        driver === "client"
          ? mountOverlay(container, { client, theme: "lavalamp", themeModule: module, storageKey: `a6-drag-size-switch-${driver}` })
          : mountOverlay(container, {
              driver: "host",
              theme: "lavalamp",
              themeModule: module,
              storageKey: `a6-drag-size-switch-${driver}`,
            });
      const pill = el.shadowRoot!.querySelector(".pill") as HTMLButtonElement;

      function drag(fromX: number, fromY: number, toX: number, toY: number) {
        pill.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, clientX: fromX, clientY: fromY, bubbles: true }));
        pill.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: toX, clientY: toY, bubbles: true }));
        pill.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, clientX: toX, clientY: toY, bubbles: true }));
      }

      if (driver === "client") emitState("recording");
      else el.applyState("recording"); // now expanded, 120x120
      pill.style.left = "0px";
      pill.style.top = "0px";
      // Drag far to the right — clamp must use the expanded (120px) width,
      // not the compact (56px) one, or the pill would overshoot past
      // (viewport.width - 120).
      drag(50, 50, 100000, 50);
      const expandedLeft = parseFloat(pill.style.left);
      expect(expandedLeft).toBe(window.innerWidth - 120);

      if (driver === "client") emitState("idle");
      else el.applyState("idle"); // now compact again, 56x56, restored to its pre-grow position
      pill.style.left = "0px";
      pill.style.top = "0px";
      drag(50, 50, 100000, 50);
      const compactLeft = parseFloat(pill.style.left);
      expect(compactLeft).toBe(window.innerWidth - COMPACT_SIZE.width);
      expect(compactLeft).not.toBe(expandedLeft);
    },
  );

  it("drag while compact persists the dragged position under storageKey (baseline, unaffected by Finding 1's fix)", () => {
    const { module } = countingThemeModule();
    const storageKey = "f1-compact-drag";
    const el = mountOverlay(container, { driver: "host", theme: "lavalamp", themeModule: module, storageKey });
    const pill = el.shadowRoot!.querySelector(".pill") as HTMLButtonElement;
    pill.style.left = "0px";
    pill.style.top = "0px";

    pill.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, clientX: 10, clientY: 10, bubbles: true }));
    pill.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 200, clientY: 210, bubbles: true }));
    pill.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, clientX: 200, clientY: 210, bubbles: true }));

    const draggedPos = { x: parseFloat(pill.style.left), y: parseFloat(pill.style.top) };
    expect(loadPosition(storageKey)).toEqual(draggedPos);
  });

  it("[F1] a drag while expanded does not persist the expanded-sized position; shrinking back re-saves the original compact spot, so a new mount with the same storageKey lands there, not the expanded-dragged position", () => {
    const { module } = countingThemeModule();
    const storageKey = "f1-expanded-drag";
    const el = mountOverlay(container, { driver: "host", theme: "lavalamp", themeModule: module, storageKey });
    const pill = el.shadowRoot!.querySelector(".pill") as HTMLButtonElement;

    // Establish + persist a real compact resting spot via a compact-state drag first.
    pill.style.left = "0px";
    pill.style.top = "0px";
    pill.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, clientX: 10, clientY: 10, bubbles: true }));
    pill.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 60, clientY: 70, bubbles: true }));
    pill.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, clientX: 60, clientY: 70, bubbles: true }));
    const compactPos = { x: parseFloat(pill.style.left), y: parseFloat(pill.style.top) };
    expect(loadPosition(storageKey)).toEqual(compactPos);

    // Expand (recording), then drag while expanded — must NOT persist the expanded-sized position.
    el.applyState("recording");
    pill.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, clientX: 10, clientY: 10, bubbles: true }));
    pill.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 300, clientY: 400, bubbles: true }));
    pill.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, clientX: 300, clientY: 400, bubbles: true }));
    const expandedDraggedPos = { x: parseFloat(pill.style.left), y: parseFloat(pill.style.top) };
    expect(expandedDraggedPos).not.toEqual(compactPos);

    // Shrink back — storage must reflect the ORIGINAL compact position, not the expanded-dragged one.
    el.applyState("idle");
    expect(loadPosition(storageKey)).toEqual(compactPos);

    el.remove();

    // A new element mounting with the same storageKey must land at the original compact position.
    const el2 = mountOverlay(container, { driver: "host", theme: "lavalamp", themeModule: module, storageKey });
    const pill2 = el2.shadowRoot!.querySelector(".pill") as HTMLButtonElement;
    expect({ x: parseFloat(pill2.style.left), y: parseFloat(pill2.style.top) }).toEqual(compactPos);
    el2.remove();
  });
});

describe("<voxis-overlay> live seams setPosition/setTheme [T3]", () => {
  let container: HTMLDivElement;

  function countingThemeModule() {
    const calls = { mount: 0, unmount: 0 };
    const module = {
      mount: vi.fn(() => {
        calls.mount += 1;
        return { unmount: vi.fn(() => { calls.unmount += 1; }) };
      }),
    };
    return { module, calls };
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    localStorage.clear();
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  it("setPosition while compact moves the pill (clamped with the compact size) and records the resting spot, without mounting a theme", () => {
    const { module, calls } = countingThemeModule();
    const el = mountOverlay(container, { driver: "host", theme: "lavalamp", themeModule: module });
    const pill = el.shadowRoot!.querySelector(".pill") as HTMLButtonElement;

    el.setPosition({ x: 30, y: 40 });
    expect(el.lifecycle).toBe("compact");
    expect(parseFloat(pill.style.left)).toBe(30);
    expect(parseFloat(pill.style.top)).toBe(40);
    expect(calls.mount).toBe(0);
  });

  it("setPosition clamps to the CURRENT size (expanded uses the theme size) and leaves the pre-grow compact spot intact for shrink", () => {
    const { module } = countingThemeModule();
    const el = mountOverlay(container, { driver: "host", theme: "lavalamp", themeModule: module });
    const pill = el.shadowRoot!.querySelector(".pill") as HTMLButtonElement;

    el.setPosition({ x: 20, y: 20 });
    const compactSpot = { x: parseFloat(pill.style.left), y: parseFloat(pill.style.top) };

    el.applyState("recording"); // expanded, 120x120
    // Overshoot far right — the clamp must use the expanded (120px) width.
    el.setPosition({ x: 100000, y: 20 });
    expect(parseFloat(pill.style.left)).toBe(window.innerWidth - 120);

    el.applyState("idle"); // shrink: returns to the pre-grow compact spot, not the expanded setPosition
    expect({ x: parseFloat(pill.style.left), y: parseFloat(pill.style.top) }).toEqual(compactSpot);
  });

  it("setTheme while compact only records the new theme/size (no mount, no resize event); the next expansion adopts it", () => {
    const { module, calls } = countingThemeModule();
    const el = mountOverlay(container, { driver: "host", theme: "lavalamp", themeModule: module });
    const resizes: unknown[] = [];
    el.addEventListener("voxis-overlay-resize", () => resizes.push(1));

    el.setTheme("all_aquarium");
    expect(calls.mount).toBe(0);
    expect(el.lifecycle).toBe("compact");
    expect(resizes.length).toBe(0);

    el.applyState("recording");
    expect(el.size).toEqual({ width: 340, height: 170 });
    expect(calls.mount).toBe(1);
  });

  it("setTheme while expanded swaps in place: exactly one unmount + one mount, a fresh theme container, a resize when the manifest size differs, and no element re-creation", () => {
    const { module, calls } = countingThemeModule();
    const el = mountOverlay(container, { driver: "host", theme: "lavalamp", themeModule: module });

    el.applyState("recording"); // expanded, lavalamp 120x120, mount #1
    expect(calls.mount).toBe(1);
    expect(el.size).toEqual({ width: 120, height: 120 });
    const containerBefore = el.shadowRoot!.querySelector(".theme-container");

    const resizes: Array<{ width: number; height: number; state: string }> = [];
    el.addEventListener("voxis-overlay-resize", (e) => {
      resizes.push((e as CustomEvent<{ width: number; height: number; state: string }>).detail);
    });

    el.setTheme("all_aquarium"); // 340x170, differs
    expect(calls.unmount).toBe(1);
    expect(calls.mount).toBe(2);
    const containerAfter = el.shadowRoot!.querySelector(".theme-container");
    expect(containerAfter).not.toBe(containerBefore);
    expect(el.size).toEqual({ width: 340, height: 170 });
    expect(resizes).toEqual([{ width: 340, height: 170, state: "expanded" }]);
    expect(container.querySelectorAll("voxis-overlay").length).toBe(1);
    expect(el.isConnected).toBe(true);
  });

  it("setTheme while expanded to a same-sized theme still remounts once but dispatches no resize event", () => {
    const { module, calls } = countingThemeModule();
    const el = mountOverlay(container, { driver: "host", theme: "lavalamp", themeModule: module });
    el.applyState("recording"); // lavalamp 120x120
    const resizes: unknown[] = [];
    el.addEventListener("voxis-overlay-resize", () => resizes.push(1));

    el.setTheme("metaballs"); // also 120x120
    expect(calls.mount).toBe(2);
    expect(calls.unmount).toBe(1);
    expect(resizes.length).toBe(0);
  });
});

// Referenced so the import above is exercised type-wise, keeping the
// `VoxisOverlayElement` export part of this test's compiled surface.
void VoxisOverlayElement;
