// crates/tauri-plugin-voxis/guest-js/__tests__/overlay-geometry.test.ts
/**
 * Pure geometry for `<voxis-overlay>` — no DOM/custom element mounted,
 * every function is viewport-injectable (see `src/overlay-geometry.ts`).
 * The `cornerPosition`/`anchorGrow`/`shapeRadius` cases were moved here
 * verbatim from `overlay.test.ts` when the geometry was extracted out of
 * the element (SDK T1 refactor); the `resolve*`/`grow`/`shrink` cases are
 * new coverage for the functions the element now delegates to.
 */
import { describe, expect, it } from "vitest";
import {
  COMPACT_SIZE,
  anchorGrow,
  cornerPosition,
  growToExpandedPosition,
  resolveCurrentSize,
  resolveInitialPosition,
  shapeRadius,
  shrinkToCompactPosition,
  type OverlayCorner,
} from "../src/overlay-geometry";
import { clampToViewport } from "../src/drag";

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

describe("anchorGrow [A6 compact<->expanded growth direction]", () => {
  const viewport = { width: 400, height: 800 };

  it("grows to the right/down when resting near the top-left (anchors the top-left edge)", () => {
    const grown = anchorGrow({ x: 10, y: 10 }, COMPACT_SIZE, { width: 120, height: 120 }, viewport);
    expect(grown).toEqual({ x: 10, y: 10 });
  });

  it("grows to the left when resting near the right edge (anchors the right edge)", () => {
    const pos = { x: 400 - COMPACT_SIZE.width - 10, y: 10 };
    const grown = anchorGrow(pos, COMPACT_SIZE, { width: 120, height: 120 }, viewport);
    // Right edge stays fixed: pos.x + COMPACT_SIZE.width - 120.
    expect(grown.x).toBe(pos.x + COMPACT_SIZE.width - 120);
    expect(grown.y).toBe(10);
  });

  it("grows upward when resting near the bottom edge (anchors the bottom edge)", () => {
    const pos = { x: 10, y: 800 - COMPACT_SIZE.height - 10 };
    const grown = anchorGrow(pos, COMPACT_SIZE, { width: 120, height: 120 }, viewport);
    expect(grown.x).toBe(10);
    expect(grown.y).toBe(pos.y + COMPACT_SIZE.height - 120);
  });

  it("grows left AND upward when resting in the bottom-right corner", () => {
    const pos = { x: 400 - COMPACT_SIZE.width - 10, y: 800 - COMPACT_SIZE.height - 10 };
    const grown = anchorGrow(pos, COMPACT_SIZE, { width: 120, height: 120 }, viewport);
    expect(grown.x).toBe(pos.x + COMPACT_SIZE.width - 120);
    expect(grown.y).toBe(pos.y + COMPACT_SIZE.height - 120);
  });
});

describe("shapeRadius [A6 shape rule]", () => {
  it("a square no larger than 96px a side is a circle", () => {
    expect(shapeRadius(COMPACT_SIZE)).toBe("50%");
    expect(shapeRadius({ width: 96, height: 96 })).toBe("50%");
  });

  it("a square larger than 96px a side is a rounded rect", () => {
    expect(shapeRadius({ width: 120, height: 120 })).toBe("16px");
  });

  it("any non-square size is a rounded rect, regardless of how small", () => {
    expect(shapeRadius({ width: 64, height: 40 })).toBe("16px");
    expect(shapeRadius({ width: 340, height: 170 })).toBe("16px");
  });
});

describe("resolveCurrentSize", () => {
  const expanded = { width: 120, height: 120 };

  it("compact -> COMPACT_SIZE", () => {
    expect(resolveCurrentSize("compact", expanded)).toEqual(COMPACT_SIZE);
  });

  it("expanded -> the theme's manifest size", () => {
    expect(resolveCurrentSize("expanded", expanded)).toEqual(expanded);
  });
});

describe("resolveInitialPosition", () => {
  const size = COMPACT_SIZE;
  const viewport = { width: 390, height: 844 };

  it("undefined -> the bottom-right default", () => {
    expect(resolveInitialPosition(undefined, size, viewport)).toEqual(cornerPosition("bottom-right", size, viewport));
  });

  it.each(["top-left", "top-right", "bottom-left", "bottom-right"] as OverlayCorner[])(
    "named corner %s -> cornerPosition(corner)",
    (corner) => {
      expect(resolveInitialPosition(corner, size, viewport)).toEqual(cornerPosition(corner, size, viewport));
    },
  );

  it("an explicit point is returned as-is (the caller clamps)", () => {
    expect(resolveInitialPosition({ x: 40, y: 60 }, size, viewport)).toEqual({ x: 40, y: 60 });
  });
});

describe("growToExpandedPosition / shrinkToCompactPosition", () => {
  const noInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  const viewport = { width: 400, height: 800 };
  const expanded = { width: 120, height: 120 };

  it("grow anchors then clamps (bottom-right corner grows left+up, stays on-screen)", () => {
    const pos = { x: 400 - COMPACT_SIZE.width - 10, y: 800 - COMPACT_SIZE.height - 10 };
    const grown = growToExpandedPosition(pos, expanded, noInsets, viewport);
    const expected = clampToViewport(anchorGrow(pos, COMPACT_SIZE, expanded, viewport), expanded, noInsets, viewport);
    expect(grown).toEqual(expected);
    // On-screen with the expanded size.
    expect(grown.x + expanded.width).toBeLessThanOrEqual(viewport.width);
    expect(grown.y + expanded.height).toBeLessThanOrEqual(viewport.height);
  });

  it("shrink clamps the restore point to the compact size", () => {
    const restore = { x: 999999, y: -999999 };
    const shrunk = shrinkToCompactPosition(restore, noInsets, viewport);
    expect(shrunk).toEqual(clampToViewport(restore, COMPACT_SIZE, noInsets, viewport));
    expect(shrunk.x + COMPACT_SIZE.width).toBeLessThanOrEqual(viewport.width);
    expect(shrunk.y).toBeGreaterThanOrEqual(0);
  });
});
