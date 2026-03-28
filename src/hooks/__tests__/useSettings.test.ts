import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSettings } from "../useSettings";
import { mockInvoke, mockConfig } from "../../test/mocks/tauri";

describe("useSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads config on mount", async () => {
    const { result } = renderHook(() => useSettings());

    // Initially loading
    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.config).toEqual(mockConfig);
    expect(mockInvoke).toHaveBeenCalledWith("get_config");
  });

  it("returns loading state initially", async () => {
    // Use a slow mock to properly test initial loading state
    mockInvoke.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(mockConfig), 100))
    );

    const { result } = renderHook(() => useSettings());
    expect(result.current.loading).toBe(true);
    expect(result.current.config).toBe(null);

    // Wait for the hook to finish loading to avoid act() warning
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it("updates top-level config value", async () => {
    const { result } = renderHook(() => useSettings());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.updateConfig({ language: "ru" });
    });

    expect(result.current.config?.language).toBe("ru");
    expect(result.current.hasChanges).toBe(true);
  });

  it("updates nested config value using dot notation", async () => {
    const { result } = renderHook(() => useSettings());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.updateNestedConfig("overlay.enabled", false);
    });

    expect(result.current.config?.overlay.enabled).toBe(false);
    expect(result.current.hasChanges).toBe(true);
  });

  it("saves config to backend", async () => {
    const { result } = renderHook(() => useSettings());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.updateConfig({ language: "en" });
    });

    await act(async () => {
      await result.current.save();
    });

    expect(mockInvoke).toHaveBeenCalledWith("save_config", {
      config: expect.objectContaining({ language: "en" }),
    });
    expect(result.current.hasChanges).toBe(false);
  });

  it("handles save error", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "save_config") {
        throw new Error("Backend validation failed");
      }
      return mockConfig;
    });

    const { result } = renderHook(() => useSettings());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.updateConfig({ api_key: "" });
    });

    await act(async () => {
      try {
        await result.current.save();
      } catch {
        // Expected to throw
      }
    });

    expect(result.current.error).toBe("Backend validation failed");
  });

  it("handles load error", async () => {
    mockInvoke.mockRejectedValue(new Error("Failed to load config"));

    const { result } = renderHook(() => useSettings());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Failed to load config");
    expect(result.current.config).toBe(null);
  });

  it("reloads config", async () => {
    const { result } = renderHook(() => useSettings());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Modify config
    act(() => {
      result.current.updateConfig({ debug: true });
    });

    expect(result.current.hasChanges).toBe(true);

    // Reload should reset changes
    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.hasChanges).toBe(false);
    expect(result.current.config?.debug).toBe(mockConfig.debug);
  });

  it("tracks saving state", async () => {
    const { result } = renderHook(() => useSettings());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.saving).toBe(false);

    act(() => {
      result.current.updateConfig({ language: "de" });
    });

    // Start save and check saving state
    let savePromise: Promise<void>;
    act(() => {
      savePromise = result.current.save();
    });

    // Wait for save to complete
    await act(async () => {
      await savePromise;
    });

    expect(result.current.saving).toBe(false);
  });

  it("handles nested config with multiple levels", async () => {
    const { result } = renderHook(() => useSettings());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.updateNestedConfig("llm.enabled", true);
      result.current.updateNestedConfig("llm.model", "gpt-4o");
    });

    expect(result.current.config?.llm.enabled).toBe(true);
    expect(result.current.config?.llm.model).toBe("gpt-4o");
  });
});
