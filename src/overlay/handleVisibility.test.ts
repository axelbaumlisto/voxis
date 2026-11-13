import { describe, it, expect, vi } from "vitest";
import { createHandleVisibility } from "./handleVisibility";

/**
 * Drive the controller with injected timers so a single `pending` callback
 * stands in for the idle timer — armHide always clears before re-arming, so one
 * slot is enough and the test fires it on demand.
 */
function setup(idleMs = 1000) {
  const show = vi.fn();
  const hide = vi.fn();
  let pending: (() => void) | null = null;
  const v = createHandleVisibility({
    idleMs,
    show,
    hide,
    setTimeoutFn: ((cb: () => void) => {
      pending = cb;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout,
    clearTimeoutFn: (() => {
      pending = null;
    }) as typeof clearTimeout,
  });
  return {
    v,
    show,
    hide,
    armed: () => pending !== null,
    fireIdle: () => pending?.(),
  };
}

describe("createHandleVisibility", () => {
  it("a hover ping shows the handles and arms the idle hide", () => {
    const { v, show, hide, armed, fireIdle } = setup();
    v.ping();
    expect(show).toHaveBeenCalledTimes(1);
    expect(armed()).toBe(true);
    expect(hide).not.toHaveBeenCalled();
    fireIdle();
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it("repeated pings keep re-arming the idle timer (no premature hide)", () => {
    const { v, hide, armed } = setup();
    v.ping();
    v.ping();
    v.ping();
    expect(armed()).toBe(true);
    expect(hide).not.toHaveBeenCalled();
  });

  it("pins the handles for the whole gesture — no idle hide armed while gesturing", () => {
    const { v, show, hide, armed } = setup();
    v.setGesturing(true);
    expect(show).toHaveBeenCalled();
    expect(armed()).toBe(false); // pinned: nothing scheduled to hide

    // A ping mid-gesture still must not arm a hide (the drag would blink).
    v.ping();
    expect(armed()).toBe(false);
    expect(hide).not.toHaveBeenCalled();
  });

  it("resumes the idle countdown when the gesture ends", () => {
    const { v, hide, armed, fireIdle } = setup();
    v.setGesturing(true);
    v.setGesturing(false);
    expect(armed()).toBe(true);
    fireIdle();
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it("dispose cancels the pending idle hide", () => {
    const { v, armed } = setup();
    v.ping();
    expect(armed()).toBe(true);
    v.dispose();
    expect(armed()).toBe(false);
  });
});
