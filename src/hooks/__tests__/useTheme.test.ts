/**
 * Tests for useTheme — loads overlay theme data by id, exposes typed snapshot.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useTheme } from "../useTheme";

const ORGANIC_PAYLOAD = {
  id: "living_reed",
  name: "Living Reed",
  family: "organic_ring",
  colors: {
    use_gradient: true,
    gradient_bottom: "#3a6841",
    gradient_middle: "#7cc287",
    gradient_top: "#c4eac8",
    recording: "#7cc287",
    transcribing: "#4caf50",
    idle: "#3a6841",
  },
  organic_ring: {
    shape: {
      gap_degrees: 42,
      base_thickness: 7.2,
      taper: 0.7,
      roundness: 0.9,
      active_zones: 3,
    },
    motion: {
      idle_breathing: 0.1,
      speech_responsiveness: 0.92,
      drift: 0.38,
      settle_speed: 0.6,
    },
  },
};

const BARS_PAYLOAD = {
  id: "winamp_classic",
  name: "Winamp Classic",
  family: "bars",
  colors: {
    use_gradient: true,
    gradient_bottom: "#299400",
    gradient_middle: "#d6b521",
    gradient_top: "#ef3110",
    recording: "#ef3110",
    transcribing: "#29ce10",
    idle: "#299400",
  },
  organic_ring: null,
};

describe("useTheme", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null while loading", () => {
    invokeMock.mockImplementation(() => new Promise(() => {})); // pending forever
    const { result } = renderHook(() => useTheme("living_reed"));
    expect(result.current).toBeNull();
  });

  it("loads organic_ring theme data", async () => {
    invokeMock.mockResolvedValue(ORGANIC_PAYLOAD);
    const { result } = renderHook(() => useTheme("living_reed"));
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.family).toBe("organic_ring");
    expect(result.current?.organic_ring).not.toBeNull();
    expect(result.current?.organic_ring?.shape.base_thickness).toBeCloseTo(7.2);
    expect(invokeMock).toHaveBeenCalledWith("get_overlay_theme_data", {
      themeId: "living_reed",
    });
  });

  it("loads bars theme data with null organic_ring", async () => {
    invokeMock.mockResolvedValue(BARS_PAYLOAD);
    const { result } = renderHook(() => useTheme("winamp_classic"));
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.family).toBe("bars");
    expect(result.current?.organic_ring).toBeNull();
  });

  it("returns null and logs warn on invoke error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    invokeMock.mockRejectedValue(new Error("not found"));
    const { result } = renderHook(() => useTheme("nope"));
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it("refetches when themeId changes", async () => {
    invokeMock.mockResolvedValueOnce(BARS_PAYLOAD).mockResolvedValueOnce(ORGANIC_PAYLOAD);
    const { result, rerender } = renderHook(({ id }) => useTheme(id), {
      initialProps: { id: "winamp_classic" },
    });
    await waitFor(() => expect(result.current?.id).toBe("winamp_classic"));
    rerender({ id: "living_reed" });
    await waitFor(() => expect(result.current?.id).toBe("living_reed"));
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });
});
