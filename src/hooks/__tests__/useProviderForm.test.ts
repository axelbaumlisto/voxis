import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useProviderForm } from "../useProviderForm";

// Mock dependencies
vi.mock("../../lib/validation", () => ({
  validateProvider: vi.fn(() => []),
}));

vi.mock("../../lib/providerValidation", () => ({
  validateProviderForm: vi.fn(() => []),
}));

vi.mock("../../lib/providers", () => ({
  parseModelsFromText: vi.fn((text: string) => {
    if (!text.trim()) return [];
    return text.split("\n").map((line) => {
      const [id, name] = line.split(":");
      return { id: id?.trim() || "", name: name?.trim() || id?.trim() || "" };
    });
  }),
  modelsToText: vi.fn((models: Array<{ id: string; name: string }>) =>
    models.map((m) => `${m.id}:${m.name}`).join("\n")
  ),
  generateProviderId: vi.fn((name: string) =>
    name.toLowerCase().replace(/\s+/g, "-")
  ),
  isDuplicateProviderId: vi.fn(() => false),
}));

vi.mock("../../lib/errors", () => ({
  getErrorMessage: vi.fn((err: unknown) =>
    err instanceof Error ? err.message : String(err)
  ),
}));

describe("useProviderForm", () => {
  const mockOnSave = vi.fn();
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initializes with default values for add mode", () => {
    const { result } = renderHook(() =>
      useProviderForm({
        mode: "add",
        existingIds: [],
        onSave: mockOnSave,
        onClose: mockOnClose,
      })
    );

    expect(result.current.name).toBe("");
    expect(result.current.apiUrl).toBe("");
    expect(result.current.modelsText).toBe("");
    expect(result.current.defaultModel).toBe("");
    expect(result.current.error).toBeNull();
    expect(result.current.saving).toBe(false);
  });

  it("initializes with provider values for edit mode", () => {
    const provider = {
      id: "test-provider",
      name: "Test Provider",
      api_url: "https://api.test.com",
      models: [{ id: "model-1", name: "Model 1" }],
      default_model: "model-1",
      builtin: false,
    };

    const { result } = renderHook(() =>
      useProviderForm({
        mode: "edit",
        provider,
        existingIds: [],
        onSave: mockOnSave,
        onClose: mockOnClose,
      })
    );

    expect(result.current.name).toBe("Test Provider");
    expect(result.current.apiUrl).toBe("https://api.test.com");
    expect(result.current.defaultModel).toBe("model-1");
  });

  it("updates name when setName is called", () => {
    const { result } = renderHook(() =>
      useProviderForm({
        mode: "add",
        existingIds: [],
        onSave: mockOnSave,
        onClose: mockOnClose,
      })
    );

    act(() => {
      result.current.setName("New Provider");
    });

    expect(result.current.name).toBe("New Provider");
  });

  it("updates apiUrl when setApiUrl is called", () => {
    const { result } = renderHook(() =>
      useProviderForm({
        mode: "add",
        existingIds: [],
        onSave: mockOnSave,
        onClose: mockOnClose,
      })
    );

    act(() => {
      result.current.setApiUrl("https://new-api.com");
    });

    expect(result.current.apiUrl).toBe("https://new-api.com");
  });

  it("updates modelsText when setModelsText is called", () => {
    const { result } = renderHook(() =>
      useProviderForm({
        mode: "add",
        existingIds: [],
        onSave: mockOnSave,
        onClose: mockOnClose,
      })
    );

    act(() => {
      result.current.setModelsText("model-1:Model One\nmodel-2:Model Two");
    });

    expect(result.current.modelsText).toBe("model-1:Model One\nmodel-2:Model Two");
  });

  it("parses models from modelsText", () => {
    const { result } = renderHook(() =>
      useProviderForm({
        mode: "add",
        existingIds: [],
        onSave: mockOnSave,
        onClose: mockOnClose,
      })
    );

    act(() => {
      result.current.setModelsText("gpt-4:GPT-4");
    });

    expect(result.current.models).toHaveLength(1);
    expect(result.current.models[0].id).toBe("gpt-4");
  });

  it("canSubmit is false when name is empty", () => {
    const { result } = renderHook(() =>
      useProviderForm({
        mode: "add",
        existingIds: [],
        onSave: mockOnSave,
        onClose: mockOnClose,
      })
    );

    expect(result.current.canSubmit).toBe(false);
  });

  it("canSubmit is true when name and apiUrl are provided", () => {
    const { result } = renderHook(() =>
      useProviderForm({
        mode: "add",
        existingIds: [],
        onSave: mockOnSave,
        onClose: mockOnClose,
      })
    );

    act(() => {
      result.current.setName("My Provider");
      result.current.setApiUrl("https://api.example.com");
    });

    expect(result.current.canSubmit).toBe(true);
  });

  it("handleSubmit calls onSave with correct data", async () => {
    mockOnSave.mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useProviderForm({
        mode: "add",
        existingIds: [],
        onSave: mockOnSave,
        onClose: mockOnClose,
      })
    );

    act(() => {
      result.current.setName("My Provider");
      result.current.setApiUrl("https://api.example.com");
      result.current.setModelsText("model-1:Model 1");
    });

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(mockOnSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "My Provider",
        api_url: "https://api.example.com",
      })
    );
    expect(mockOnClose).toHaveBeenCalled();
  });

  it("handleSubmit sets error on validation failure", async () => {
    const { validateProviderForm } = await import("../../lib/providerValidation");
    vi.mocked(validateProviderForm).mockReturnValue(["Name is required"]);

    const { result } = renderHook(() =>
      useProviderForm({
        mode: "add",
        existingIds: [],
        onSave: mockOnSave,
        onClose: mockOnClose,
      })
    );

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(result.current.error).toBe("Name is required");
    expect(mockOnSave).not.toHaveBeenCalled();
  });

  it("handleSubmit sets error on save failure", async () => {
    const { validateProvider } = await import("../../lib/validation");
    vi.mocked(validateProvider).mockReturnValue([]);
    const { validateProviderForm } = await import("../../lib/providerValidation");
    vi.mocked(validateProviderForm).mockReturnValue([]);
    mockOnSave.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() =>
      useProviderForm({
        mode: "add",
        existingIds: [],
        onSave: mockOnSave,
        onClose: mockOnClose,
      })
    );

    act(() => {
      result.current.setName("My Provider");
      result.current.setApiUrl("https://api.example.com");
    });

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(result.current.error).toBe("Network error");
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it("resetForm restores initial values", () => {
    const { result } = renderHook(() =>
      useProviderForm({
        mode: "add",
        existingIds: [],
        onSave: mockOnSave,
        onClose: mockOnClose,
      })
    );

    act(() => {
      result.current.setName("Modified");
      result.current.setApiUrl("https://modified.com");
    });

    expect(result.current.name).toBe("Modified");

    act(() => {
      result.current.resetForm();
    });

    expect(result.current.name).toBe("");
    expect(result.current.apiUrl).toBe("");
    expect(result.current.error).toBeNull();
  });

  it("saving state is true during handleSubmit", async () => {
    const { validateProvider } = await import("../../lib/validation");
    vi.mocked(validateProvider).mockReturnValue([]);
    const { validateProviderForm } = await import("../../lib/providerValidation");
    vi.mocked(validateProviderForm).mockReturnValue([]);

    let resolveSave: () => void;
    const savePromise = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });
    mockOnSave.mockReturnValue(savePromise);

    const { result } = renderHook(() =>
      useProviderForm({
        mode: "add",
        existingIds: [],
        onSave: mockOnSave,
        onClose: mockOnClose,
      })
    );

    act(() => {
      result.current.setName("My Provider");
      result.current.setApiUrl("https://api.example.com");
    });

    let submitPromise: Promise<void>;
    await act(async () => {
      submitPromise = result.current.handleSubmit();
    });

    // Wait for state update (React batching may delay it)
    await waitFor(() => expect(result.current.saving).toBe(true));

    await act(async () => {
      resolveSave!();
      await submitPromise;
    });

    expect(result.current.saving).toBe(false);
  });
});
