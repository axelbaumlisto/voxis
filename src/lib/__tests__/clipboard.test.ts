import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { copyToClipboard, useCopyToClipboard } from "../clipboard";

describe("clipboard utilities", () => {
  describe("copyToClipboard", () => {
    const originalClipboard = navigator.clipboard;

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      // Restore original clipboard
      Object.defineProperty(navigator, "clipboard", {
        value: originalClipboard,
        writable: true,
      });
    });

    it("should copy text to clipboard successfully", async () => {
      const mockWriteText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: mockWriteText },
        writable: true,
      });

      const result = await copyToClipboard("test text");

      expect(result).toBe(true);
      expect(mockWriteText).toHaveBeenCalledWith("test text");
    });

    it("should return false when clipboard write fails", async () => {
      const mockWriteText = vi.fn().mockRejectedValue(new Error("Failed"));
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: mockWriteText },
        writable: true,
      });

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const result = await copyToClipboard("test text");

      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith("Failed to copy to clipboard");
      consoleSpy.mockRestore();
    });

    it("should handle empty string", async () => {
      const mockWriteText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: mockWriteText },
        writable: true,
      });

      const result = await copyToClipboard("");

      expect(result).toBe(true);
      expect(mockWriteText).toHaveBeenCalledWith("");
    });
  });

  describe("useCopyToClipboard", () => {
    const originalClipboard = navigator.clipboard;

    beforeEach(() => {
      vi.useFakeTimers();
      const mockWriteText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: mockWriteText },
        writable: true,
      });
    });

    afterEach(() => {
      vi.useRealTimers();
      Object.defineProperty(navigator, "clipboard", {
        value: originalClipboard,
        writable: true,
      });
    });

    it("should initialize with copied = false", () => {
      const { result } = renderHook(() => useCopyToClipboard());
      expect(result.current.copied).toBe(false);
    });

    it("should set copied to true after successful copy", async () => {
      const { result } = renderHook(() => useCopyToClipboard());

      await act(async () => {
        await result.current.copy("test text");
      });

      expect(result.current.copied).toBe(true);
    });

    it("should reset copied to false after timeout", async () => {
      const { result } = renderHook(() => useCopyToClipboard(1000));

      await act(async () => {
        await result.current.copy("test text");
      });

      expect(result.current.copied).toBe(true);

      await act(async () => {
        vi.advanceTimersByTime(1000);
      });

      expect(result.current.copied).toBe(false);
    });

    it("should return success status from copy", async () => {
      const { result } = renderHook(() => useCopyToClipboard());

      let success: boolean | undefined;
      await act(async () => {
        success = await result.current.copy("test text");
      });

      expect(success).toBe(true);
    });

    it("should not set copied when copy fails", async () => {
      const mockWriteText = vi.fn().mockRejectedValue(new Error("Failed"));
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: mockWriteText },
        writable: true,
      });

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { result } = renderHook(() => useCopyToClipboard());

      await act(async () => {
        await result.current.copy("test text");
      });

      expect(result.current.copied).toBe(false);
      consoleSpy.mockRestore();
    });

    it("should reset timer on rapid successive copies", async () => {
      const { result } = renderHook(() => useCopyToClipboard(1000));

      // First copy
      await act(async () => {
        await result.current.copy("first");
      });

      expect(result.current.copied).toBe(true);

      // Advance partially
      await act(async () => {
        vi.advanceTimersByTime(500);
      });

      // Second copy - should reset timer
      await act(async () => {
        await result.current.copy("second");
      });

      expect(result.current.copied).toBe(true);

      // Advance another 500ms - original timer would have expired
      await act(async () => {
        vi.advanceTimersByTime(500);
      });

      // Should still be copied because timer was reset
      expect(result.current.copied).toBe(true);

      // Advance remaining time
      await act(async () => {
        vi.advanceTimersByTime(500);
      });

      expect(result.current.copied).toBe(false);
    });

    it("should use default timeout of 2000ms", async () => {
      const { result } = renderHook(() => useCopyToClipboard());

      await act(async () => {
        await result.current.copy("test");
      });

      expect(result.current.copied).toBe(true);

      // Advance 1999ms - should still be true
      await act(async () => {
        vi.advanceTimersByTime(1999);
      });
      expect(result.current.copied).toBe(true);

      // Advance 1 more ms - should be false
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(result.current.copied).toBe(false);
    });

    it("should cleanup timeout on unmount", async () => {
      const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");
      const { result, unmount } = renderHook(() => useCopyToClipboard());

      await act(async () => {
        await result.current.copy("test");
      });

      unmount();

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });
  });
});
