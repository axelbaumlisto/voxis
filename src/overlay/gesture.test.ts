import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { createGesture } from "./gesture";

// jsdom has no rAF loop control: drive it by hand.
let frames: FrameRequestCallback[] = [];
beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => vi.unstubAllGlobals());

const tick = () => {
  const queued = frames;
  frames = [];
  for (const cb of queued) cb(performance.now());
};

describe("createGesture — the shared grip transport", () => {
  test("coalesces moves into one frame and ignores a secondary button", () => {
    const onFrame = vi.fn();
    const g = createGesture({ onFrame, onEnd: vi.fn() });
    expect(g.begin({ button: 2, pointerId: 1, screenX: 0, screenY: 0, currentTarget: null })).toBe(false);
    expect(g.begin({ button: 0, pointerId: 1, screenX: 100, screenY: 100, currentTarget: null })).toBe(true);
    g.move({ pointerId: 1, screenX: 110, screenY: 110 });
    g.move({ pointerId: 1, screenX: 120, screenY: 125 });
    expect(onFrame).not.toHaveBeenCalled();
    tick();
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(onFrame.mock.calls[0][0]).toEqual({ screenX: 120, screenY: 125 });
    expect(onFrame.mock.calls[0][1]).toMatchObject({ screenX: 100, screenY: 100 });
  });

  test("ignores moves from another pointer", () => {
    const onFrame = vi.fn();
    const g = createGesture({ onFrame, onEnd: vi.fn() });
    g.begin({ button: 0, pointerId: 1, screenX: 0, screenY: 0, currentTarget: null });
    g.move({ pointerId: 2, screenX: 50, screenY: 50 });
    tick();
    expect(onFrame).not.toHaveBeenCalled();
  });

  test("the release flushes the last position so a fast drag loses no delta", () => {
    const onFrame = vi.fn();
    const onEnd = vi.fn();
    const g = createGesture({ onFrame, onEnd });
    g.begin({ button: 0, pointerId: 1, screenX: 0, screenY: 0, currentTarget: null });
    g.move({ pointerId: 1, screenX: 40, screenY: 0 }); // queued, never ticked
    g.end();
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledWith({ screenX: 40, screenY: 0 }, expect.objectContaining({ pointerId: 1 }));
    expect(g.active).toBe(false);
  });

  test("cancel drops the gesture without a frame", () => {
    const onFrame = vi.fn();
    const g = createGesture({ onFrame, onEnd: vi.fn() });
    g.begin({ button: 0, pointerId: 1, screenX: 0, screenY: 0, currentTarget: null });
    g.move({ pointerId: 1, screenX: 90, screenY: 90 });
    g.cancel();
    tick();
    expect(onFrame).not.toHaveBeenCalled();
  });
});

describe("createGesture — hold-to-arm (shared by the drag grip)", () => {
  // Fake only the setTimeout family, leaving the hand-driven rAF stub intact.
  const useArmTimers = () =>
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  test("holds frames until the hold matures, then arms and emits", () => {
    useArmTimers();
    const onFrame = vi.fn();
    const onArm = vi.fn();
    const onEnd = vi.fn();
    const g = createGesture({ armMs: 300, slopPx: 6, onFrame, onArm, onEnd });
    g.begin({ button: 0, pointerId: 1, screenX: 0, screenY: 0, currentTarget: null });

    // Before arming: a tiny move (within slop) is ignored, no frame, no abandon.
    g.move({ pointerId: 1, screenX: 2, screenY: 2 });
    tick();
    expect(onFrame).not.toHaveBeenCalled();
    expect(onArm).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(onArm).toHaveBeenCalledTimes(1);

    g.move({ pointerId: 1, screenX: 50, screenY: 50 });
    tick();
    expect(onFrame).toHaveBeenCalledTimes(1);
    g.end();
    expect(onEnd).toHaveBeenCalledWith(
      { screenX: 50, screenY: 50 },
      expect.objectContaining({ pointerId: 1 }),
    );
    vi.useRealTimers();
  });

  test("abandons an un-armed gesture once it moves past the slop (a tap-drag)", () => {
    useArmTimers();
    const onFrame = vi.fn();
    const onAbandon = vi.fn();
    const g = createGesture({ armMs: 300, slopPx: 6, onFrame, onEnd: vi.fn(), onAbandon });
    g.begin({ button: 0, pointerId: 1, screenX: 0, screenY: 0, currentTarget: null });
    g.move({ pointerId: 1, screenX: 20, screenY: 0 }); // > 6px → abandon
    expect(onAbandon).toHaveBeenCalledTimes(1);
    expect(g.active).toBe(false);
    // The arm timer must not fire after an abandon.
    vi.advanceTimersByTime(500);
    tick();
    expect(onFrame).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  test("a release before the hold matures reports onEnd(null) — a tap, not a drag", () => {
    useArmTimers();
    const onEnd = vi.fn();
    const g = createGesture({ armMs: 300, onFrame: vi.fn(), onEnd });
    g.begin({ button: 0, pointerId: 1, screenX: 0, screenY: 0, currentTarget: null });
    g.end();
    expect(onEnd).toHaveBeenCalledWith(null, expect.objectContaining({ pointerId: 1 }));
    vi.useRealTimers();
  });
});
