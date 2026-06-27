import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAudioDevices } from "../useAudioDevices";
import { mockInvoke, mockAudioDevices, resetMocks } from "../../test/mocks/tauri";

describe("useAudioDevices", () => {
  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
  });

  describe("Initial state", () => {
    const neverResolvingDevicesLoad = () =>
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "list_audio_devices") {
          return new Promise<never>(() => {});
        }
        throw new Error(`Unknown command: ${cmd}`);
      });

    it("returns empty devices array initially", () => {
      neverResolvingDevicesLoad();
      const { result, unmount } = renderHook(() => useAudioDevices(undefined));
      expect(result.current.devices).toEqual([]);
      unmount();
    });

    it("returns loading=true initially", () => {
      neverResolvingDevicesLoad();
      const { result, unmount } = renderHook(() => useAudioDevices(undefined));
      expect(result.current.loading).toBe(true);
      unmount();
    });

    it("returns options with default option initially", () => {
      neverResolvingDevicesLoad();
      const { result, unmount } = renderHook(() => useAudioDevices(undefined));
      expect(result.current.options).toEqual([{ label: "Default", value: "default" }]);
      unmount();
    });
  });

  describe("Loading devices", () => {
    it("loads devices on mount", async () => {
      const { result } = renderHook(() => useAudioDevices(undefined));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.devices).toEqual(mockAudioDevices);
      expect(mockInvoke).toHaveBeenCalledWith("list_audio_devices");
    });

    it("sets loading=false after load completes", async () => {
      const { result } = renderHook(() => useAudioDevices(undefined));

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });
  });

  describe("Options formatting", () => {
    it("formats options for select with Default first", async () => {
      const { result } = renderHook(() => useAudioDevices(undefined));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const options = result.current.options;
      expect(options[0]).toEqual({ label: "Default", value: "default" });
    });

    it("excludes default device from options (avoids duplicate)", async () => {
      const { result } = renderHook(() => useAudioDevices(undefined));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const options = result.current.options;
      // Default should appear only once (from manual addition)
      const defaultOptions = options.filter((o) => o.value === "default");
      expect(defaultOptions).toHaveLength(1);
    });

    it("includes non-default devices in options", async () => {
      const { result } = renderHook(() => useAudioDevices(undefined));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const options = result.current.options;
      const micOption = options.find((o) => o.value === "hw:0,0");
      expect(micOption).toEqual({ label: "Built-in Microphone", value: "hw:0,0" });
    });
  });

  describe("Current device handling", () => {
    it("includes current device if not in list", async () => {
      const { result } = renderHook(() => useAudioDevices("unknown-device-id"));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const options = result.current.options;
      const currentOption = options.find((o) => o.value === "unknown-device-id");
      expect(currentOption).toEqual({
        label: "unknown-device-id (current)",
        value: "unknown-device-id",
      });
    });

    it("does not duplicate current device if already in list", async () => {
      const { result } = renderHook(() => useAudioDevices("hw:0,0"));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const options = result.current.options;
      const micOptions = options.filter((o) => o.value === "hw:0,0");
      expect(micOptions).toHaveLength(1);
    });

    it("does not add current device marker for 'default'", async () => {
      const { result } = renderHook(() => useAudioDevices("default"));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const options = result.current.options;
      const defaultOption = options.find((o) => o.value === "default");
      expect(defaultOption?.label).toBe("Default");
      expect(defaultOption?.label).not.toContain("(current)");
    });
  });

  describe("Error handling", () => {
    it("handles load error gracefully", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockInvoke.mockRejectedValueOnce(new Error("Failed to list devices"));

      const { result } = renderHook(() => useAudioDevices(undefined));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Should still have default option
      expect(result.current.options).toEqual([{ label: "Default", value: "default" }]);
      expect(result.current.devices).toEqual([]);
      // Error is surfaced via state (not console-only) so the UI can render it
      expect(result.current.error).toBe("Failed to list devices");

      consoleSpy.mockRestore();
    });

    it("handles null response gracefully", async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "list_audio_devices") {
          return null;
        }
        throw new Error(`Unknown command: ${cmd}`);
      });

      const { result } = renderHook(() => useAudioDevices(undefined));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.devices).toEqual([]);
      expect(result.current.options).toEqual([{ label: "Default", value: "default" }]);
    });
  });

  describe("Memoization", () => {
    it("options update when devices change", async () => {
      const { result, rerender } = renderHook(
        ({ currentDevice }) => useAudioDevices(currentDevice),
        { initialProps: { currentDevice: undefined as string | undefined } }
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const initialOptions = result.current.options;

      // Change currentDevice
      rerender({ currentDevice: "new-device-id" });

      // Options should update to include new device
      expect(result.current.options).not.toBe(initialOptions);
      expect(result.current.options.some((o) => o.value === "new-device-id")).toBe(true);
    });
  });
});
