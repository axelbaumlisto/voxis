// crates/tauri-plugin-voxis/guest-js/__tests__/overlay-session.test.ts
/**
 * `OverlaySessionController` — the client-driver session half extracted
 * out of `<voxis-overlay>` (SDK T1 refactor). Exercised against a fake
 * `VoxisClient` (no `@tauri-apps/api`), with fake timers for the hold
 * lease. The four-release-paths rule (pointerup / pointercancel /
 * lostpointercapture / window blur all end a hold) lives here now, so it
 * is asserted here rather than only through the mounted element.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OverlaySessionController } from "../src/overlay-session";
import type { VoxisClient } from "../src/client";

function fakeClient() {
  const start = vi.fn(async () => "sess-1");
  const stop = vi.fn(async () => undefined);
  const holdLease = vi.fn(async () => undefined);
  const client = { start, stop, holdLease } as unknown as VoxisClient;
  return { client, start, stop, holdLease };
}

function pointer(type: string, pointerId = 1): PointerEvent {
  return new PointerEvent(type, { pointerId, bubbles: true });
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("OverlaySessionController", () => {
  let pill: HTMLButtonElement;

  beforeEach(() => {
    pill = document.createElement("button");
    document.body.appendChild(pill);
  });

  afterEach(() => {
    pill.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function make(mode: "hold" | "toggle", isDragging: () => boolean = () => false) {
    const f = fakeClient();
    const controller = new OverlaySessionController({ pill, mode, client: f.client, isDragging });
    return { ...f, controller };
  }

  it("hold: pointerdown starts (mode = \"hold\"), pointerup stops with the session id", async () => {
    const { start, stop, controller } = make("hold");
    pill.dispatchEvent(pointer("pointerdown"));
    await flush();
    expect(start).toHaveBeenCalledWith("hold");
    expect(controller.activeSession).toBe("sess-1");

    pill.dispatchEvent(pointer("pointerup"));
    await flush();
    expect(stop).toHaveBeenCalledWith("sess-1");
    expect(controller.activeSession).toBeNull();
    controller.destroy();
  });

  it.each(["pointercancel", "lostpointercapture"] as const)(
    "hold: %s also ends the hold (never a stuck recording)",
    async (release) => {
      const { stop, controller } = make("hold");
      pill.dispatchEvent(pointer("pointerdown"));
      await flush();
      pill.dispatchEvent(pointer(release));
      await flush();
      expect(stop).toHaveBeenCalledWith("sess-1");
      controller.destroy();
    },
  );

  it("hold: window blur ends the hold (the fourth release path)", async () => {
    const { stop, controller } = make("hold");
    pill.dispatchEvent(pointer("pointerdown"));
    await flush();
    window.dispatchEvent(new Event("blur"));
    await flush();
    expect(stop).toHaveBeenCalledWith("sess-1");
    controller.destroy();
  });

  it("toggle: a tap starts, a second tap stops; no start on pointerdown", async () => {
    const { start, stop, controller } = make("toggle");
    pill.dispatchEvent(pointer("pointerdown"));
    expect(start).not.toHaveBeenCalled(); // toggle starts on the release, not the press
    pill.dispatchEvent(pointer("pointerup"));
    await flush();
    expect(start).toHaveBeenCalledWith("toggle");
    expect(stop).not.toHaveBeenCalled();

    pill.dispatchEvent(pointer("pointerdown"));
    pill.dispatchEvent(pointer("pointerup"));
    await flush();
    expect(stop).toHaveBeenCalledWith("sess-1");
    controller.destroy();
  });

  it("toggle: a real drag (isDragging during move) does not toggle", async () => {
    let dragging = false;
    const { start, stop, controller } = make("toggle", () => dragging);
    pill.dispatchEvent(pointer("pointerdown"));
    dragging = true;
    pill.dispatchEvent(pointer("pointermove"));
    pill.dispatchEvent(pointer("pointerup"));
    await flush();
    expect(start).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    controller.destroy();
  });

  it("pending-start race: a stop arriving before start() resolves stops the just-started session", async () => {
    const { client, start, stop } = fakeClient();
    let resolveStart!: (id: string) => void;
    start.mockImplementation(() => new Promise<string>((r) => { resolveStart = r; }));
    const controller = new OverlaySessionController({ pill, mode: "hold", client, isDragging: () => false });

    pill.dispatchEvent(pointer("pointerdown")); // start() now pending
    pill.dispatchEvent(pointer("pointerup")); // stop() with no id yet -> records stopRequested
    expect(stop).not.toHaveBeenCalled();

    resolveStart("sess-1");
    await flush();
    expect(stop).toHaveBeenCalledWith("sess-1");
    expect(controller.activeSession).toBeNull();
    controller.destroy();
  });

  it("hold: renews the lease ~1 Hz via holdLease while active (fake timers)", async () => {
    vi.useFakeTimers();
    const { client, start, holdLease } = fakeClient();
    const controller = new OverlaySessionController({ pill, mode: "hold", client, isDragging: () => false });

    pill.dispatchEvent(pointer("pointerdown"));
    await vi.advanceTimersByTimeAsync(0); // flush start()
    expect(start).toHaveBeenCalledWith("hold");

    await vi.advanceTimersByTimeAsync(1000);
    expect(holdLease).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(holdLease).toHaveBeenCalledTimes(2);

    controller.destroy();
    // No further heartbeats after destroy stops the lease.
    await vi.advanceTimersByTimeAsync(3000);
    expect(holdLease).toHaveBeenCalledTimes(2);
  });

  it("toggle mode starts no lease (holdLease never called)", async () => {
    vi.useFakeTimers();
    const { client, holdLease } = fakeClient();
    const controller = new OverlaySessionController({ pill, mode: "toggle", client, isDragging: () => false });
    pill.dispatchEvent(pointer("pointerdown"));
    pill.dispatchEvent(pointer("pointerup"));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(holdLease).not.toHaveBeenCalled();
    controller.destroy();
  });

  it("clearActiveSession drops the session so a subsequent release does not call stop() [plugin-ended session]", async () => {
    const { stop, controller } = make("hold");
    pill.dispatchEvent(pointer("pointerdown"));
    await flush();
    expect(controller.activeSession).toBe("sess-1");

    controller.clearActiveSession(); // e.g. applyState("idle")/applyResult after a plugin-ended session
    expect(controller.activeSession).toBeNull();

    pill.dispatchEvent(pointer("pointerup"));
    await flush();
    expect(stop).not.toHaveBeenCalled();
    controller.destroy();
  });

  it("cancel() stops the active session (theme cancel action)", async () => {
    const { stop, controller } = make("hold");
    pill.dispatchEvent(pointer("pointerdown"));
    await flush();
    controller.cancel();
    await flush();
    expect(stop).toHaveBeenCalledWith("sess-1");
    controller.destroy();
  });

  it("cancel() is a no-op when idle", () => {
    const { stop, controller } = make("hold");
    expect(() => controller.cancel()).not.toThrow();
    expect(stop).not.toHaveBeenCalled();
    controller.destroy();
  });

  it("destroy() unwires pointer + blur listeners: a later pointerdown never starts", async () => {
    const { start, controller } = make("hold");
    controller.destroy();
    pill.dispatchEvent(pointer("pointerdown"));
    await flush();
    expect(start).not.toHaveBeenCalled();
  });
});
