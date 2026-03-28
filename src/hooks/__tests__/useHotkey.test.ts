import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const mockListen = vi.fn();
const mockUnlisten = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

import { useHotkey } from "../useHotkey";

describe("useHotkey", () => {
  beforeEach(() => {
    mockListen.mockReset();
    mockUnlisten.mockReset();
    mockListen.mockResolvedValue(mockUnlisten);
  });

  it("subscribes to hotkey-pressed and hotkey-released on mount", async () => {
    const onPress = vi.fn();
    const onRelease = vi.fn();
    const { unmount } = renderHook(() => useHotkey(onPress, onRelease));
    await new Promise((r) => setTimeout(r, 0));
    expect(mockListen).toHaveBeenCalledWith(
      "hotkey-pressed",
      expect.any(Function),
    );
    expect(mockListen).toHaveBeenCalledWith(
      "hotkey-released",
      expect.any(Function),
    );
    unmount();
  });

  it("calls unlisten on unmount", async () => {
    const { unmount } = renderHook(() => useHotkey(vi.fn(), vi.fn()));
    await new Promise((r) => setTimeout(r, 0));
    unmount();
    await new Promise((r) => setTimeout(r, 0));
    expect(mockUnlisten).toHaveBeenCalledTimes(2);
  });

  it("invokes the latest onPress callback when hotkey-pressed fires", async () => {
    const onPress = vi.fn();
    const onRelease = vi.fn();
    renderHook(() => useHotkey(onPress, onRelease));
    await new Promise((r) => setTimeout(r, 0));

    // Find the callback registered for hotkey-pressed
    const pressedCall = mockListen.mock.calls.find(
      (c: unknown[]) => c[0] === "hotkey-pressed",
    );
    expect(pressedCall).toBeDefined();
    pressedCall![1]();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("invokes the latest onRelease callback when hotkey-released fires", async () => {
    const onPress = vi.fn();
    const onRelease = vi.fn();
    renderHook(() => useHotkey(onPress, onRelease));
    await new Promise((r) => setTimeout(r, 0));

    const releasedCall = mockListen.mock.calls.find(
      (c: unknown[]) => c[0] === "hotkey-released",
    );
    expect(releasedCall).toBeDefined();
    releasedCall![1]();
    expect(onRelease).toHaveBeenCalledTimes(1);
  });
});
