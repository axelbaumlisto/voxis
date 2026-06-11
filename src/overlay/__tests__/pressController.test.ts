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