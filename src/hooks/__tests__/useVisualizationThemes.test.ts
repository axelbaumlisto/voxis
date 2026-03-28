import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockInvoke } from "../../test/mocks/tauri";
import { useVisualizationThemes } from "../useVisualizationThemes";

describe("useVisualizationThemes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads themes from backend and maps them to options", async () => {
    const { result } = renderHook(() => useVisualizationThemes());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockInvoke).toHaveBeenCalledWith("get_visualization_themes");
    expect(result.current.options).toEqual(
      expect.arrayContaining([
        { label: "Default", value: "default" },
        { label: "Living Reed", value: "living_reed" },
      ])
    );
  });

  it("keeps current theme selectable when backend list does not include it", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_visualization_themes") {
        return [{ id: "default", name: "Default", description: "Built-in" }];
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { result } = renderHook(() => useVisualizationThemes("missing_theme"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.options[0]).toEqual({
      label: "missing_theme (missing)",
      value: "missing_theme",
    });
  });

  it("falls back safely when backend theme loading fails", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("Backend unavailable"));

    const { result } = renderHook(() => useVisualizationThemes());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Backend unavailable");
    expect(result.current.options).toEqual([{ label: "Default", value: "default" }]);
  });
});
