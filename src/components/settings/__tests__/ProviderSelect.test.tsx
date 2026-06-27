import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ProviderSelect from "../ProviderSelect";
import { mockInvoke, resetMocks, mockLlmProviders } from "../../../test/mocks/tauri";
import { LlmProvider } from "../../../lib/commands";

// Track providers for mutation tests
let currentProviders = [...mockLlmProviders];

function setupProviderMocks() {
  currentProviders = [...mockLlmProviders];
  mockInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    switch (cmd) {
      case "get_llm_providers":
        return [...currentProviders];
      case "add_llm_provider": {
        const provider = args as Omit<LlmProvider, "builtin">;
        currentProviders.push({ ...provider, builtin: false } as LlmProvider);
        return undefined;
      }
      case "update_llm_provider": {
        const updated = args as LlmProvider;
        const idx = currentProviders.findIndex((p) => p.id === updated.id);
        if (idx >= 0) {
          currentProviders[idx] = { ...updated, builtin: false };
        }
        return undefined;
      }
      case "remove_llm_provider": {
        const id = args?.id as string;
        currentProviders = currentProviders.filter((p) => p.id !== id);
        return undefined;
      }
      default:
        return undefined;
    }
  });
}

describe("ProviderSelect", () => {
  const defaultProps = {
    providerId: "openai",
    modelId: "gpt-4",
    apiUrl: "https://api.openai.com/v1/chat/completions",
    onProviderChange: vi.fn(),
    onModelChange: vi.fn(),
  };

  beforeEach(() => {
    resetMocks();
    setupProviderMocks();
    vi.clearAllMocks();
  });

  describe("Rendering", () => {
    it("renders provider dropdown with options", async () => {
      render(<ProviderSelect {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("OpenAI")).toBeInTheDocument();
      });

      // Provider dropdown should exist and show providers
      expect(screen.getByDisplayValue("OpenAI")).toBeInTheDocument();
      expect(screen.getByText("Groq")).toBeInTheDocument();
    });

    it("renders model dropdown with options", async () => {
      render(<ProviderSelect {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("GPT-4")).toBeInTheDocument();
      });
    });

    it("shows loading state", async () => {
      // Create a pending promise for providers
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_llm_providers") {
          return new Promise(() => {}); // Never resolves
        }
        return undefined;
      });

      render(<ProviderSelect {...defaultProps} />);

      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });

    it("renders API URL as readonly", async () => {
      render(<ProviderSelect {...defaultProps} />);

      await waitFor(() => {
        const urlInput = screen.getByDisplayValue(defaultProps.apiUrl);
        expect(urlInput).toHaveAttribute("readonly");
      });
    });

    it("gives provider + model selects an accessible name and no dangling label", async () => {
      const { container } = render(<ProviderSelect {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("OpenAI")).toBeInTheDocument();
      });

      // Both selects must be reachable by accessible name (a11y blocker fix).
      const providerSelect = screen.getByRole("combobox", { name: "LLM Provider" });
      const modelSelect = screen.getByRole("combobox", { name: "LLM Model" });
      expect(providerSelect).toBeInTheDocument();
      expect(modelSelect).toBeInTheDocument();

      // No FieldWrapper label should point at a missing id (no dangling htmlFor).
      const labels = container.querySelectorAll("label.settings-field-label[for]");
      expect(labels.length).toBeGreaterThan(0);
      labels.forEach((label) => {
        const forId = label.getAttribute("for");
        expect(forId).toBeTruthy();
        expect(container.querySelector(`#${CSS.escape(forId!)}`)).not.toBeNull();
      });
    });
  });

  describe("Provider selection", () => {
    it("calls onProviderChange when provider selected", async () => {
      render(<ProviderSelect {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("OpenAI")).toBeInTheDocument();
      });

      const providerSelect = screen.getByDisplayValue("OpenAI");
      fireEvent.change(providerSelect, { target: { value: "groq" } });

      expect(defaultProps.onProviderChange).toHaveBeenCalledWith(
        "groq",
        "https://api.groq.com/openai/v1/chat/completions",
        "llama-3.1-8b-instant"
      );
    });

    it("updates model dropdown when provider changes", async () => {
      const { rerender } = render(<ProviderSelect {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("OpenAI")).toBeInTheDocument();
      });

      // Simulate provider change
      rerender(
        <ProviderSelect
          {...defaultProps}
          providerId="groq"
          modelId="llama-3.1-8b-instant"
          apiUrl="https://api.groq.com/openai/v1/chat/completions"
        />
      );

      await waitFor(() => {
        expect(screen.getByText("Llama 3.1 8B")).toBeInTheDocument();
      });
    });
  });

  describe("Model selection", () => {
    it("calls onModelChange when model selected", async () => {
      render(<ProviderSelect {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("GPT-4")).toBeInTheDocument();
      });

      const modelSelect = screen.getByDisplayValue("GPT-4");
      fireEvent.change(modelSelect, { target: { value: "gpt-3.5-turbo" } });

      expect(defaultProps.onModelChange).toHaveBeenCalledWith("gpt-3.5-turbo");
    });
  });

  describe("Custom provider controls", () => {
    it("shows edit button only for non-builtin providers", async () => {
      render(
        <ProviderSelect
          {...defaultProps}
          providerId="custom-provider"
          modelId="custom-model"
          apiUrl="https://custom.api.com/v1"
        />
      );

      await waitFor(() => {
        expect(screen.getByText("Custom Provider (custom)")).toBeInTheDocument();
      });

      // Should have edit and delete buttons
      expect(screen.getByTitle("Edit provider")).toBeInTheDocument();
      expect(screen.getByTitle("Remove provider")).toBeInTheDocument();
    });

    it("hides edit button for builtin providers", async () => {
      render(<ProviderSelect {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("OpenAI")).toBeInTheDocument();
      });

      expect(screen.queryByTitle("Edit provider")).not.toBeInTheDocument();
      expect(screen.queryByTitle("Remove provider")).not.toBeInTheDocument();
    });

    it("shows add button for adding custom provider", async () => {
      render(<ProviderSelect {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTitle("Add custom provider")).toBeInTheDocument();
      });
    });
  });

  describe("Add provider modal", () => {
    it("opens add modal when + button clicked", async () => {
      render(<ProviderSelect {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTitle("Add custom provider")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTitle("Add custom provider"));

      expect(screen.getByText("Add Custom Provider")).toBeInTheDocument();
    });

    it("closes modal on cancel", async () => {
      render(<ProviderSelect {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTitle("Add custom provider")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTitle("Add custom provider"));
      expect(screen.getByText("Add Custom Provider")).toBeInTheDocument();

      fireEvent.click(screen.getByText("Cancel"));
      expect(screen.queryByText("Add Custom Provider")).not.toBeInTheDocument();
    });
  });

  describe("Edit provider modal", () => {
    it("opens edit modal when edit button clicked", async () => {
      render(
        <ProviderSelect
          {...defaultProps}
          providerId="custom-provider"
          modelId="custom-model"
          apiUrl="https://custom.api.com/v1"
        />
      );

      await waitFor(() => {
        expect(screen.getByTitle("Edit provider")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTitle("Edit provider"));

      expect(screen.getByText("Edit Provider")).toBeInTheDocument();
    });
  });

  describe("Remove provider", () => {
    it("removes provider when delete button clicked", async () => {
      const onProviderChange = vi.fn();
      render(
        <ProviderSelect
          {...defaultProps}
          onProviderChange={onProviderChange}
          providerId="custom-provider"
          modelId="custom-model"
          apiUrl="https://custom.api.com/v1"
        />
      );

      await waitFor(() => {
        expect(screen.getByTitle("Remove provider")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTitle("Remove provider"));

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("remove_llm_provider", {
          id: "custom-provider",
        });
      });
    });

    it("surfaces an error alert when remove fails", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_llm_providers") return [...mockLlmProviders];
        if (cmd === "remove_llm_provider") throw new Error("Remove failed");
        return undefined;
      });

      render(
        <ProviderSelect
          {...defaultProps}
          providerId="custom-provider"
          modelId="custom-model"
          apiUrl="https://custom.api.com/v1"
        />
      );

      await waitFor(() => {
        expect(screen.getByTitle("Remove provider")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTitle("Remove provider"));

      const alert = await screen.findByTestId("provider-error");
      expect(alert).toHaveAttribute("role", "alert");

      consoleSpy.mockRestore();
    });
  });

  describe("Model auto-selection", () => {
    it("selects first model if current model not in list", async () => {
      const onModelChange = vi.fn();
      render(
        <ProviderSelect
          {...defaultProps}
          onModelChange={onModelChange}
          modelId="non-existent-model"
        />
      );

      await waitFor(() => {
        expect(onModelChange).toHaveBeenCalledWith("gpt-4");
      });
    });
  });
});
