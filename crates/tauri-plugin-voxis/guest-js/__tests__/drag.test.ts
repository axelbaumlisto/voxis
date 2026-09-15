// crates/tauri-plugin-voxis/guest-js/__tests__/drag.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clampToViewport,
  createDragController,
  loadPosition,
  savePosition,
  snapToNearestEdge,
} from "../src/drag";

const SIZE = { width: 64, height: 64 };
const SAFE_AREA = { top: 10, right: 10, bottom: 20, left: 10 };
const VIEWPORT = { width: 400, height: 800 };

describe("clampToViewport", () => {
  it("leaves an in-bounds position untouched", () => {
    expect(clampToViewport({ x: 100, y: 100 }, SIZE, SAFE_AREA, VIEWPORT)).toEqual({ x: 100, y: 100 });
  });

  it("clamps a negative position to the safe-area-inset minimum", () => {
    expect(clampToViewport({ x: -50, y: -50 }, SIZE, SAFE_AREA, VIEWPORT)).toEqual({ x: 10, y: 10 });
  });

  it("clamps an overflowing position to viewport minus size minus safe area", () => {
    const pos = clampToViewport({ x: 10000, y: 10000 }, SIZE, SAFE_AREA, VIEWPORT);
    expect(pos).toEqual({ x: VIEWPORT.width - SAFE_AREA.right - SIZE.width, y: VIEWPORT.height - SAFE_AREA.bottom - SIZE.height });
  });

  it("respects a zero safe area", () => {
    expect(clampToViewport({ x: -5, y: -5 }, SIZE, { top: 0, right: 0, bottom: 0, left: 0 }, VIEWPORT)).toEqual({
      x: 0,
      y: 0,
    });
  });
});

describe("snapToNearestEdge", () => {
  it("snaps to the left edge (inset by safe area) when the center is in the left half", () => {
    const snapped = snapToNearestEdge({ x: 20, y: 300 }, SIZE, SAFE_AREA, VIEWPORT);
    expect(snapped.x).toBe(SAFE_AREA.left);
    expect(snapped.y).toBe(300);
  });

  it("snaps to the right edge (inset by safe area) when the center is in the right half", () => {
    const snapped = snapToNearestEdge({ x: 300, y: 300 }, SIZE, SAFE_AREA, VIEWPORT);
    expect(snapped.x).toBe(VIEWPORT.width - SAFE_AREA.right - SIZE.width);
  });
});

describe("localStorage persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("loadPosition returns null when nothing is stored", () => {
    expect(loadPosition("overlay-test")).toBeNull();
  });

  it("savePosition then loadPosition round-trips", () => {
    savePosition("overlay-test", { x: 12, y: 34 });
    expect(loadPosition("overlay-test")).toEqual({ x: 12, y: 34 });
  });

  it("loadPosition returns null for corrupt JSON instead of throwing", () => {
    localStorage.setItem("voxis-overlay-position:overlay-test", "{not json");
    expect(loadPosition("overlay-test")).toBeNull();
  });

  it("loadPosition returns null for a value missing x/y", () => {
    localStorage.setItem("voxis-overlay-position:overlay-test", JSON.stringify({ x: 1 }));
    expect(loadPosition("overlay-test")).toBeNull();
  });
});

describe("createDragController", () => {
  function setup() {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const onDragStart = vi.fn();
    const onDragMove = vi.fn();
    const onDragEnd = vi.fn();
    const controller = createDragController(el, {
      storageKey: "overlay-drag-test",
      getSize: () => SIZE,
      getSafeArea: () => SAFE_AREA,
      getViewport: () => VIEWPORT,
      dragThresholdPx: 6,
      onDragStart,
      onDragMove,
      onDragEnd,
    });
    return { el, controller, onDragStart, onDragMove, onDragEnd };
  }

  beforeEach(() => {
    localStorage.clear();
  });

  function pointerEvent(type: string, x: number, y: number, pointerId = 1): PointerEvent {
    return new PointerEvent(type, { pointerId, clientX: x, clientY: y, bubbles: true });
  }

  it("a small movement below the threshold is not a drag", () => {
    const { el, onDragStart, onDragEnd } = setup();
    el.dispatchEvent(pointerEvent("pointerdown", 100, 100));
    el.dispatchEvent(pointerEvent("pointermove", 102, 101));
    el.dispatchEvent(pointerEvent("pointerup", 102, 101));

    expect(onDragStart).not.toHaveBeenCalled();
    expect(onDragEnd).toHaveBeenCalledWith(expect.anything(), false);
  });

  it("a movement past the threshold is a drag, snaps on release, and persists position", () => {
    const { el, controller, onDragStart, onDragMove, onDragEnd } = setup();
    el.style.left = "50px";
    el.style.top = "50px";

    el.dispatchEvent(pointerEvent("pointerdown", 100, 100));
    el.dispatchEvent(pointerEvent("pointermove", 300, 100));
    expect(controller.isDragging).toBe(true);
    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(onDragMove).toHaveBeenCalled();

    el.dispatchEvent(pointerEvent("pointerup", 300, 100));

    expect(onDragEnd).toHaveBeenCalledWith(expect.anything(), true);
    const [finalPos, dragged] = onDragEnd.mock.calls[0] as [{ x: number; y: number }, boolean];
    expect(dragged).toBe(true);
    // 50 + (300-100) = 250, clamped/snapped to the right edge since it's past center.
    expect(finalPos.x).toBe(VIEWPORT.width - SAFE_AREA.right - SIZE.width);
    expect(loadPosition("overlay-drag-test")).toEqual(finalPos);
  });

  it("pointercancel ends the gesture the same way pointerup does", () => {
    const { el, controller, onDragEnd } = setup();
    el.dispatchEvent(pointerEvent("pointerdown", 100, 100));
    el.dispatchEvent(pointerEvent("pointermove", 300, 100));
    el.dispatchEvent(pointerEvent("pointercancel", 300, 100));

    expect(controller.isDragging).toBe(false);
    expect(onDragEnd).toHaveBeenCalledWith(expect.anything(), true);
  });

  it("ignores pointer events from an unrelated pointerId mid-gesture", () => {
    const { el, controller, onDragMove } = setup();
    el.dispatchEvent(pointerEvent("pointerdown", 100, 100, 1));
    el.dispatchEvent(pointerEvent("pointermove", 300, 100, 2)); // different pointer
    expect(controller.isDragging).toBe(false);
    expect(onDragMove).not.toHaveBeenCalled();
  });

  it("destroy() removes listeners so further events are no-ops", () => {
    const { el, controller, onDragStart } = setup();
    controller.destroy();
    el.dispatchEvent(pointerEvent("pointerdown", 100, 100));
    el.dispatchEvent(pointerEvent("pointermove", 300, 100));
    expect(onDragStart).not.toHaveBeenCalled();
  });
});
