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
import { mountOverlay, VoxisOverlayElement } from "../src/overlay";
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

// Referenced so the import above is exercised type-wise, keeping the
// `VoxisOverlayElement` export part of this test's compiled surface.
void VoxisOverlayElement;
