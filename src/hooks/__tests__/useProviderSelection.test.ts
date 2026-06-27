import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useProviderSelection } from "../useProviderSelection";
import { mockInvoke, mockLlmProviders, resetMocks } from "../../test/mocks/tauri";

describe("useProviderSelection", () => {
  const mockOnProviderChange = vi.fn();
  const mockOnModelChange = vi.fn();

  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
  });

  describe("Initial state", () => {
    it("returns loading=true initially", () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "get_llm_providers") {
          return new Promise<never>(() => {});
        }
        throw new Error(`Unknown: ${cmd}`);
      });

      const { result, unmount } = renderHook(() =>
        useProviderSelection("openai", "gpt-4", mockOnProviderChange, mockOnModelChange)
      );

      expect(result.current.loading).toBe(true);
      unmount();
    });

    it("loads providers on mount", async () => {
      const { result } = renderHook(() =>
        useProviderSelection("openai", "gpt-4", mockOnProviderChange, mockOnModelChange)
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.providers).toEqual(mockLlmProviders);
      expect(mockInvoke).toHaveBeenCalledWith("get_llm_providers");
    });
  });

  describe("Current provider", () => {
    it("returns currentProvider based on providerId", async () => {
      const { result } = renderHook(() =>
        useProviderSelection("openai", "gpt-4", mockOnProviderChange, mockOnModelChange)
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.currentProvider).toBeDefined();
      expect(result.current.currentProvider?.id).toBe("openai");
      expect(result.current.currentProvider?.name).toBe("OpenAI");
    });

    it("returns undefined currentProvider for unknown providerId", async () => {
      const { result } = renderHook(() =>
        useProviderSelection("unknown", "gpt-4", mockOnProviderChange, mockOnModelChange)
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.currentProvider).toBeUndefined();
    });
  });

  describe("Models", () => {
    it("returns models for current provider", async () => {
      const { result } = renderHook(() =>
        useProviderSelection("openai", "gpt-4", mockOnProviderChange, mockOnModelChange)
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.models).toHaveLength(2);
      expect(result.current.models[0].id).toBe("gpt-4");
      expect(result.current.models[1].id).toBe("gpt-3.5-turbo");
    });

    it("returns empty models array when no provider", async () => {
      const { result } = renderHook(() =>
        useProviderSelection("unknown", "gpt-4", mockOnProviderChange, mockOnModelChange)
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.models).toEqual([]);
    });
  });

  describe("handleProviderChange", () => {
    it("calls onProviderChange with provider details", async () => {
      const { result } = renderHook(() =>
        useProviderSelection("openai", "gpt-4", mockOnProviderChange, mockOnModelChange)
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.handleProviderChange("groq");
      });

      expect(mockOnProviderChange).toHaveBeenCalledWith(
        "groq",
        "https://api.groq.com/openai/v1/chat/completions",
        "llama-3.1-8b-instant"
      );
    });

    it("does not call onProviderChange for unknown provider", async () => {
      const { result } = renderHook(() =>
        useProviderSelection("openai", "gpt-4", mockOnProviderChange, mockOnModelChange)
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.handleProviderChange("nonexistent");
      });

      expect(mockOnProviderChange).not.toHaveBeenCalled();
    });
  });

  describe("Model auto-selection", () => {
    it("calls onModelChange when current model not in models list", async () => {
      const { result } = renderHook(() =>
        useProviderSelection("openai", "invalid-model", mockOnProviderChange, mockOnModelChange)
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Should auto-select first model
      await waitFor(() => {
        expect(mockOnModelChange).toHaveBeenCalledWith("gpt-4");
      });
    });

    it("does not call onModelChange when current model exists", async () => {
      const { result } = renderHook(() =>
        useProviderSelection("openai", "gpt-4", mockOnProviderChange, mockOnModelChange)
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Wait a bit to ensure no call
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockOnModelChange).not.toHaveBeenCalled();
    });
  });

  describe("handleRemoveProvider", () => {
    it("removes provider and switches to another", async () => {
      const { result } = renderHook(() =>
        useProviderSelection("custom-provider", "custom-model", mockOnProviderChange, mockOnModelChange)
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.handleRemoveProvider("custom-provider");
      });

      expect(mockInvoke).toHaveBeenCalledWith("remove_llm_provider", {
        id: "custom-provider",
      });

      // Should switch to first remaining provider
      expect(mockOnProviderChange).toHaveBeenCalled();
    });

    it("handles remove error gracefully", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_llm_providers") return mockLlmProviders;
        if (cmd === "remove_llm_provider") throw new Error("Remove failed");
        throw new Error(`Unknown: ${cmd}`);
      });

      const { result } = renderHook(() =>
        useProviderSelection("openai", "gpt-4", mockOnProviderChange, mockOnModelChange)
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.handleRemoveProvider("custom-provider");
      });

      // Error is surfaced via state (not console-only) so the UI can render it
      expect(result.current.error).toBe("Remove failed");

      consoleSpy.mockRestore();
    });
  });

  describe("handleAddProvider", () => {
    it("adds provider and switches to it", async () => {
      const { result } = renderHook(() =>
        useProviderSelection("openai", "gpt-4", mockOnProviderChange, mockOnModelChange)
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const newProvider = {
        id: "new-provider",
        name: "New Provider",
        api_url: "https://new.api.com/v1",
        models: [{ id: "new-model", name: "New Model" }],
        default_model: "new-model",
      };

      await act(async () => {
        await result.current.handleAddProvider(newProvider);
      });

      expect(mockInvoke).toHaveBeenCalledWith("add_llm_provider", {
        provider: { ...newProvider, builtin: false },
      });

      expect(mockOnProviderChange).toHaveBeenCalledWith(
        "new-provider",
        "https://new.api.com/v1",
        "new-model"
      );
    });
  });

  describe("handleUpdateProvider", () => {
    it("updates provider and refreshes current if same id", async () => {
      const { result } = renderHook(() =>
        useProviderSelection("custom-provider", "custom-model", mockOnProviderChange, mockOnModelChange)
      );

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
        await result.current.handleUpdateProvider(updatedProvider);
      });

      expect(mockInvoke).toHaveBeenCalledWith("update_llm_provider", {
        provider: { ...updatedProvider, builtin: false },
      });

      expect(mockOnProviderChange).toHaveBeenCalledWith(
        "custom-provider",
        "https://updated.api.com/v1",
        "updated-model"
      );
    });

    it("updates provider without calling onProviderChange for different id", async () => {
      const { result } = renderHook(() =>
        useProviderSelection("openai", "gpt-4", mockOnProviderChange, mockOnModelChange)
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      mockOnProviderChange.mockClear();

      const updatedProvider = {
        id: "custom-provider",
        name: "Updated Provider",
        api_url: "https://updated.api.com/v1",
        models: [{ id: "updated-model", name: "Updated Model" }],
        default_model: "updated-model",
      };

      await act(async () => {
        await result.current.handleUpdateProvider(updatedProvider);
      });

      // Should not call onProviderChange since we're editing a different provider
      expect(mockOnProviderChange).not.toHaveBeenCalled();
    });
  });

  describe("reload", () => {
    it("exposes reload function", async () => {
      const { result } = renderHook(() =>
        useProviderSelection("openai", "gpt-4", mockOnProviderChange, mockOnModelChange)
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(typeof result.current.reload).toBe("function");

      await act(async () => {
        await result.current.reload();
      });

      // Should have called get_llm_providers again
      const calls = mockInvoke.mock.calls.filter((c) => c[0] === "get_llm_providers");
      expect(calls.length).toBeGreaterThan(1);
    });
  });
});
