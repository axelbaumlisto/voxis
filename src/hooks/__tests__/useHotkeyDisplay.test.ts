import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useHotkeyDisplay } from "../useHotkeyDisplay";

// Mock dependencies
const mockGetConfig = vi.fn();
vi.mock("../../lib/commands", () => ({
  getConfig: () => mockGetConfig(),
}));

vi.mock("../../lib/status", () => ({
  formatHotkey: (hotkey: string) => `Formatted-${hotkey}`,
}));

vi.mock("../../lib/retry", () => ({
  withRetry: async <T>(fn: () => Promise<T>) => fn(),
}));

describe("useHotkeyDisplay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockResolvedValue({ hotkey: "ctrl_r" });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("loads hotkey from config on mount", async () => {
    const { result } = renderHook(() => useHotkeyDisplay());

    await waitFor(() => {
      expect(result.current.hotkey).toBe("Formatted-ctrl_r");
    });

    expect(mockGetConfig).toHaveBeenCalled();
  });

  it("returns default hotkey initially", () => {
    // Make config loading slow
    mockGetConfig.mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    const { result } = renderHook(() => useHotkeyDisplay());

    expect(result.current.hotkey).toBe("Ctrl+R");
  });

  it("returns default on config error", async () => {
    mockGetConfig.mockRejectedValue(new Error("Failed to load"));

    const { result } = renderHook(() => useHotkeyDisplay());

    // Wait for the error to be caught
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    // Should still have default hotkey
    expect(result.current.hotkey).toBe("Ctrl+R");
  });

  it("provides reload function", async () => {
    const { result } = renderHook(() => useHotkeyDisplay());

    await waitFor(() => {
      expect(result.current.hotkey).toBe("Formatted-ctrl_r");
    });

    // Update the mock to return different hotkey
    mockGetConfig.mockResolvedValue({ hotkey: "f12" });

    // Call reload
    await act(async () => {
      result.current.reload();
    });

    await waitFor(() => {
      expect(result.current.hotkey).toBe("Formatted-f12");
    });
  });

  it("listens to config-saved event", async () => {
    const { result } = renderHook(() => useHotkeyDisplay());

    await waitFor(() => {
      expect(result.current.hotkey).toBe("Formatted-ctrl_r");
    });

    // Update config
    mockGetConfig.mockResolvedValue({ hotkey: "alt_r" });

    // Dispatch config-saved event
    await act(async () => {
      window.dispatchEvent(new Event("config-saved"));
    });

    await waitFor(() => {
      expect(result.current.hotkey).toBe("Formatted-alt_r");
    });
  });

  it("removes event listener on unmount", async () => {
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderHook(() => useHotkeyDisplay());

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "config-saved",
      expect.any(Function)
    );

    removeEventListenerSpy.mockRestore();
  });

  it("formats different hotkey values", async () => {
    mockGetConfig.mockResolvedValue({ hotkey: "shift_l" });

    const { result } = renderHook(() => useHotkeyDisplay());

    await waitFor(() => {
      expect(result.current.hotkey).toBe("Formatted-shift_l");
    });
  });

  it("handles multiple reload calls", async () => {
    const { result } = renderHook(() => useHotkeyDisplay());

    await waitFor(() => {
      expect(result.current.hotkey).toBe("Formatted-ctrl_r");
    });

    mockGetConfig.mockResolvedValue({ hotkey: "f1" });

    await act(async () => {
      result.current.reload();
    });

    await waitFor(() => {
      expect(result.current.hotkey).toBe("Formatted-f1");
    });

    mockGetConfig.mockResolvedValue({ hotkey: "f2" });

    await act(async () => {
      result.current.reload();
    });

    await waitFor(() => {
      expect(result.current.hotkey).toBe("Formatted-f2");
    });
  });
});
