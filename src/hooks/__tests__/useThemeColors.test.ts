import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockInvoke, mockConfig } from "../../test/mocks/tauri";
import { useThemeColors } from "../useThemeColors";

describe("useThemeColors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.style.cssText = "";
  });

  it("applies safe CSS variables for an organic theme", async () => {
    mockInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "get_config") {
        return {
          ...mockConfig,
          overlay: {
            ...mockConfig.overlay,
            theme: "living_reed",
          },
        };
      }
      if (cmd === "get_theme_colors") {
        expect(args).toEqual({ themeId: "living_reed" });
        return {
          use_gradient: false,
          gradient_bottom: "#222222",
          gradient_middle: "#555555",
          gradient_top: "#999999",
          recording: "#222222",
          transcribing: "#444444",
          idle: "#777777",
        };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { result } = renderHook(() => useThemeColors());

    await waitFor(() => {
      expect(result.current).toBe(false);
    });

    const root = document.documentElement;
    expect(root.style.getPropertyValue("--spectrum-recording")).toBe("#222222");
    expect(root.style.getPropertyValue("--spectrum-transcribing")).toBe("#444444");
    expect(root.style.getPropertyValue("--spectrum-idle")).toBe("#777777");
  });

  it("fails gracefully when theme colors cannot be loaded", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockInvoke.mockRejectedValueOnce(new Error("Config failed"));

    const { result } = renderHook(() => useThemeColors());

    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalled();
    });

    expect(result.current).toBe(true);
    warnSpy.mockRestore();
  });

  it("ignores invalid theme color payloads without crashing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_config") {
        return mockConfig;
      }
      if (cmd === "get_theme_colors") {
        return undefined;
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { result } = renderHook(() => useThemeColors());

    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalled();
    });

    expect(result.current).toBe(true);
    warnSpy.mockRestore();
  });
});
