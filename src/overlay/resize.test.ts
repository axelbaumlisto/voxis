import { describe, expect, test } from "vitest";
import {
  clampOverlayEdge,
  MAX_OVERLAY_EDGE,
  MIN_OVERLAY_EDGE,
  resizeEdgeFromDelta,
} from "./resize";

describe("overlay corner resize (pure math)", () => {
  test("clamps into the supported range and rounds", () => {
    expect(clampOverlayEdge(0)).toBe(MIN_OVERLAY_EDGE);
    expect(clampOverlayEdge(160.4)).toBe(160);
    expect(clampOverlayEdge(9999)).toBe(MAX_OVERLAY_EDGE);
    expect(clampOverlayEdge(Number.NaN)).toBe(MIN_OVERLAY_EDGE);
  });

  test("the dominant axis drives the square, so a diagonal drag works both ways", () => {
    expect(resizeEdgeFromDelta(160, 40, 5)).toBe(200);
    expect(resizeEdgeFromDelta(160, 5, -40)).toBe(120);
    expect(resizeEdgeFromDelta(160, 30, 30)).toBe(190);
  });

  test("cannot be dragged below the minimum or above the maximum", () => {
    expect(resizeEdgeFromDelta(160, -1000, 0)).toBe(MIN_OVERLAY_EDGE);
    expect(resizeEdgeFromDelta(160, 5000, 0)).toBe(MAX_OVERLAY_EDGE);
  });

  test("the Rust and TS limits agree (a drift here would let the UI ask for a size the host clamps)", async () => {
    const rust = await import("node:fs").then((fs) =>
      fs.readFileSync("src-tauri/src/orchestrator/overlay_resize.rs", "utf8"),
    );
    expect(rust).toContain(`pub const MIN_OVERLAY_SIZE: u32 = ${MIN_OVERLAY_EDGE};`);
    expect(rust).toContain(`pub const MAX_OVERLAY_SIZE: u32 = ${MAX_OVERLAY_EDGE};`);
  });
});
