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
