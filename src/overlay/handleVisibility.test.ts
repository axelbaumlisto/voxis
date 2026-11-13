import { describe, it, expect, vi } from "vitest";
import { createHandleVisibility } from "./handleVisibility";

/** Fake clock: tracks the single pending hide timer with its delay. */
function setup() {
  const show = vi.fn();
  const hide = vi.fn();
  let pending: { cb: () => void; ms: number } | null = null;
  const v = createHandleVisibility({
    leaveConfirmMs: 300,
    idleMs: 5000,
    show,
    hide,
    setTimeoutFn: (cb, ms) => {
      pending = { cb, ms };
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeoutFn: () => {
      pending = null;
    },
  });
  return {
    v,
    show,
    hide,
    pendingMs: () => pending?.ms ?? null,
    fire: () => {
      const p = pending;
      pending = null;
      p?.cb();
    },
  };
}

describe("createHandleVisibility", () => {
  it("ping shows once and arms only the long idle fallback", () => {
    const { v, show, pendingMs } = setup();
    v.ping();
    v.ping();
    v.ping();
    expect(show).toHaveBeenCalledTimes(1); // no re-show churn
    expect(pendingMs()).toBe(5000);
  });

  it("a confirmed leave hides after leaveConfirmMs", () => {
    const { v, hide, pendingMs, fire } = setup();
    v.ping();
    v.leave();
    expect(pendingMs()).toBe(300);
    fire();
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it("a spurious leave→enter pair does NOT blink (ping cancels the pending hide)", () => {
    const { v, show, hide, pendingMs } = setup();
    v.ping();
    v.leave();
    v.ping(); // re-enter within the confirm window
    expect(hide).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalledTimes(1);
    expect(pendingMs()).toBe(5000);
  });

  it("holding still over the orb does not hide before the long idle fallback", () => {
    const { v, hide, pendingMs } = setup();
    v.ping();
    expect(pendingMs()).toBe(5000);
    expect(hide).not.toHaveBeenCalled();
  });

  it("leave before any show is ignored", () => {
    const { v, pendingMs } = setup();
    v.leave();
    expect(pendingMs()).toBeNull();
  });

  it("gesture pins: no hide armed, leaves ignored; release resumes idle", () => {
    const { v, hide, pendingMs } = setup();
    v.ping();
    v.setGesturing(true);
    expect(pendingMs()).toBeNull();
    v.leave();
    v.ping();
    expect(pendingMs()).toBeNull();
    expect(hide).not.toHaveBeenCalled();
    v.setGesturing(false);
    expect(pendingMs()).toBe(5000);
  });

  it("dispose cancels the pending hide", () => {
    const { v, pendingMs } = setup();
    v.ping();
    v.dispose();
    expect(pendingMs()).toBeNull();
  });
});
