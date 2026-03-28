import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useLlmProviders } from "../useLlmProviders";
import { mockInvoke, mockLlmProviders } from "../../test/mocks/tauri";

describe("useLlmProviders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads providers on mount", async () => {
    const { result } = renderHook(() => useLlmProviders());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.providers).toEqual(mockLlmProviders);
    expect(mockInvoke).toHaveBeenCalledWith("get_llm_providers");
  });

  it("adds provider and reloads", async () => {
    const { result } = renderHook(() => useLlmProviders());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const newProvider = {
      id: "new-provider",
      name: "New Provider",
      api_url: "https://new.api.com/v1",
      models: [{ id: "model1", name: "Model 1" }],
      default_model: "model1",
    };

    await act(async () => {
      await result.current.add(newProvider);
    });

    expect(mockInvoke).toHaveBeenCalledWith("add_llm_provider", {
      provider: { ...newProvider, builtin: false },
    });

    // Should reload after add
    const reloadCalls = mockInvoke.mock.calls.filter(
      (c) => c[0] === "get_llm_providers"
    );
    expect(reloadCalls.length).toBeGreaterThan(1);
  });

  it("updates provider and reloads", async () => {
    const { result } = renderHook(() => useLlmProviders());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const updatedProvider = {
      id: "custom-provider",
      name: "Updated Provider",
      api_url: "https://updated.api.com/v1",
      models: [{ id: "updated-model", name: "Updated Model" }],
      default_model: "updated-model",
    };

    await act(async () => {
      await result.current.update(updatedProvider);
    });

    expect(mockInvoke).toHaveBeenCalledWith("update_llm_provider", {
      provider: { ...updatedProvider, builtin: false },
    });

    // Should reload after update
    const reloadCalls = mockInvoke.mock.calls.filter(
      (c) => c[0] === "get_llm_providers"
    );
    expect(reloadCalls.length).toBeGreaterThan(1);
  });

  it("removes provider and reloads", async () => {
    const { result } = renderHook(() => useLlmProviders());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.remove("custom-provider");
    });

    expect(mockInvoke).toHaveBeenCalledWith("remove_llm_provider", {
      id: "custom-provider",
    });

    // Should reload after remove
    const reloadCalls = mockInvoke.mock.calls.filter(
      (c) => c[0] === "get_llm_providers"
    );
    expect(reloadCalls.length).toBeGreaterThan(1);
  });

  it("getProvider returns correct provider", async () => {
    const { result } = renderHook(() => useLlmProviders());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const provider = result.current.getProvider("openai");
    expect(provider).toBeDefined();
    expect(provider?.name).toBe("OpenAI");
  });

  it("getProvider returns undefined for unknown id", async () => {
    const { result } = renderHook(() => useLlmProviders());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const provider = result.current.getProvider("unknown-provider");
    expect(provider).toBeUndefined();
  });

  it("getModelsForProvider returns correct models", async () => {
    const { result } = renderHook(() => useLlmProviders());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const models = result.current.getModelsForProvider("openai");
    expect(models).toHaveLength(2);
    expect(models[0].id).toBe("gpt-4");
    expect(models[1].id).toBe("gpt-3.5-turbo");
  });

  it("getModelsForProvider returns empty array for unknown provider", async () => {
    const { result } = renderHook(() => useLlmProviders());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const models = result.current.getModelsForProvider("unknown");
    expect(models).toEqual([]);
  });

  it("handles load error", async () => {
    mockInvoke.mockRejectedValue(new Error("Failed to load providers"));

    const { result } = renderHook(() => useLlmProviders());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Failed to load providers");
    expect(result.current.providers).toEqual([]);
  });

  it("handles add error", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_llm_providers") return mockLlmProviders;
      if (cmd === "add_llm_provider") {
        throw new Error("Provider already exists");
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { result } = renderHook(() => useLlmProviders());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      try {
        await result.current.add({
          id: "test",
          name: "Test",
          api_url: "https://test.com",
          models: [],
          default_model: "",
        });
      } catch {
        // Expected to throw
      }
    });

    expect(result.current.error).toBe("Provider already exists");
  });

  it("handles update error", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_llm_providers") return mockLlmProviders;
      if (cmd === "update_llm_provider") {
        throw new Error("Provider not found");
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { result } = renderHook(() => useLlmProviders());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      try {
        await result.current.update({
          id: "nonexistent",
          name: "Test",
          api_url: "https://test.com",
          models: [],
          default_model: "",
        });
      } catch {
        // Expected to throw
      }
    });

    expect(result.current.error).toBe("Provider not found");
  });

  it("handles remove error", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_llm_providers") return mockLlmProviders;
      if (cmd === "remove_llm_provider") {
        throw new Error("Cannot remove builtin provider");
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    const { result } = renderHook(() => useLlmProviders());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      try {
        await result.current.remove("openai");
      } catch {
        // Expected to throw
      }
    });

    expect(result.current.error).toBe("Cannot remove builtin provider");
  });

  it("reload function works", async () => {
    const { result } = renderHook(() => useLlmProviders());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const initialCallCount = mockInvoke.mock.calls.filter(
      (c) => c[0] === "get_llm_providers"
    ).length;

    await act(async () => {
      await result.current.reload();
    });

    const newCallCount = mockInvoke.mock.calls.filter(
      (c) => c[0] === "get_llm_providers"
    ).length;

    expect(newCallCount).toBe(initialCallCount + 1);
  });
});
