/**
 * Tests for OrganicRing canvas component.
 *
 * jsdom does not implement Canvas2D, so the rendering context is stubbed.
 * The tests assert lifecycle + canvas dimensions; pixel-level correctness is
 * already covered by `ringGeometry.test.ts`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import OrganicRing from "../OrganicRing";
import type { OrganicRingMotion, OrganicRingShape } from "../../../bindings";

// --- Canvas + RAF stubs -------------------------------------------------------

let rafIds = 0;
const pendingRafs = new Map<number, FrameRequestCallback>();
const cancelled = new Set<number>();

function mockRequestAnimationFrame(cb: FrameRequestCallback): number {
  const id = ++rafIds;
  pendingRafs.set(id, cb);
  return id;
}

function mockCancelAnimationFrame(id: number): void {
  pendingRafs.delete(id);
  cancelled.add(id);
}

function fakeCtx(): CanvasRenderingContext2D {
  const noop = vi.fn();
  // Minimal subset of CanvasRenderingContext2D used by OrganicRing.
  return {
    clearRect: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
    set lineWidth(_v: number) {},
    set strokeStyle(_v: string | CanvasGradient | CanvasPattern) {},
    set lineCap(_v: CanvasLineCap) {},
  } as unknown as CanvasRenderingContext2D;
}

let getContextSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  rafIds = 0;
  pendingRafs.clear();
  cancelled.clear();
  vi.stubGlobal("requestAnimationFrame", mockRequestAnimationFrame);
  vi.stubGlobal("cancelAnimationFrame", mockCancelAnimationFrame);
  getContextSpy = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue(fakeCtx() as unknown as RenderingContext);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  getContextSpy.mockRestore();
});

// --- Fixtures -----------------------------------------------------------------

const SHAPE: OrganicRingShape = {
  gap_degrees: 42,
  base_thickness: 7.2,
  taper: 0.7,
  roundness: 0.9,
  active_zones: 3,
};

const MOTION: OrganicRingMotion = {
  idle_breathing: 0.1,
  speech_responsiveness: 0.92,
  drift: 0.38,
  settle_speed: 0.6,
};

function baseProps() {
  return {
    spectrumBins: new Array<number>(32).fill(0),
    audioLevel: 0,
    mode: "recording" as const,
    themeShape: SHAPE,
    themeMotion: MOTION,
    color: "#7cc287",
  };
}

// --- Tests --------------------------------------------------------------------

describe("OrganicRing", () => {
  it("renders a <canvas> with default 200x100 size", () => {
    const { container } = render(<OrganicRing {...baseProps()} />);
    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();
    expect(canvas?.width).toBe(200);
    expect(canvas?.height).toBe(100);
  });

  it("respects custom width/height props", () => {
    const { container } = render(
      <OrganicRing {...baseProps()} width={300} height={120} />,
    );
    const canvas = container.querySelector("canvas");
    expect(canvas?.width).toBe(300);
    expect(canvas?.height).toBe(120);
  });

  it("schedules a requestAnimationFrame after mount", () => {
    render(<OrganicRing {...baseProps()} />);
    // useEffect runs synchronously after render with React 18 test env.
    expect(pendingRafs.size).toBeGreaterThanOrEqual(1);
  });

  it("cancels the animation frame on unmount", () => {
    const { unmount } = render(<OrganicRing {...baseProps()} />);
    const initialIds = Array.from(pendingRafs.keys());
    expect(initialIds.length).toBeGreaterThanOrEqual(1);
    unmount();
    for (const id of initialIds) {
      // Either the raf was already executed (popped from pendingRafs) or it
      // was cancelled via cancelAnimationFrame; either way it must not stay
      // queued past unmount.
      const stillQueued = pendingRafs.has(id);
      const wasCancelled = cancelled.has(id);
      expect(stillQueued || !wasCancelled).toBe(stillQueued); // tautology guard
      expect(stillQueued).toBe(false);
    }
  });

  it("requests a 2d canvas context", () => {
    render(<OrganicRing {...baseProps()} />);
    expect(getContextSpy).toHaveBeenCalledWith("2d");
  });

  it("survives missing 2d context gracefully (no throw)", () => {
    getContextSpy.mockReturnValue(null);
    expect(() => render(<OrganicRing {...baseProps()} />)).not.toThrow();
  });
});
