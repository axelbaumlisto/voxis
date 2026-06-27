import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ProviderModal from "../ProviderModal";
import type { LlmProvider } from "../../../lib/commands";
import { handleShortcut, type ShortcutContext } from "../../../lib/keyboardShortcuts";

describe("ProviderModal", () => {
  const mockOnClose = vi.fn();
  const mockOnSave = vi.fn();
  const existingIds = ["openai", "groq"];

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnSave.mockResolvedValue(undefined);
  });

  describe("Accessibility (a11y)", () => {
    it("renders a dialog with role=dialog and aria-modal", () => {
      render(
        <ProviderModal
          mode="add"
          onClose={mockOnClose}
          onSave={mockOnSave}
          existingIds={existingIds}
        />
      );

      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute("aria-modal", "true");
    });

    it("close button has an accessible name", () => {
      render(
        <ProviderModal
          mode="add"
          onClose={mockOnClose}
          onSave={mockOnSave}
          existingIds={existingIds}
        />
      );

      expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    });

    it("focuses the first form field on open", () => {
      render(
        <ProviderModal
          mode="add"
          onClose={mockOnClose}
          onSave={mockOnSave}
          existingIds={existingIds}
        />
      );

      const nameInput = screen.getByPlaceholderText("e.g., My Provider");
      expect(document.activeElement).toBe(nameInput);
    });

    it("Esc closes the modal", () => {
      render(
        <ProviderModal
          mode="add"
          onClose={mockOnClose}
          onSave={mockOnSave}
          existingIds={existingIds}
        />
      );

      const dialog = screen.getByRole("dialog");
      fireEvent.keyDown(dialog, { key: "Escape" });
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it("Esc stops propagation so it does not reach the global handler", () => {
      const globalHandler = vi.fn();
      window.addEventListener("keydown", globalHandler);

      render(
        <ProviderModal
          mode="add"
          onClose={mockOnClose}
          onSave={mockOnSave}
          existingIds={existingIds}
        />
      );

      const dialog = screen.getByRole("dialog");
      // Dispatch a real bubbling event so stopPropagation is observable.
      const event = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
      });
      dialog.dispatchEvent(event);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
      expect(globalHandler).not.toHaveBeenCalled();

      window.removeEventListener("keydown", globalHandler);
    });

    it("Esc with the modal open closes the modal and does NOT hide the window", () => {
      // Wire the REAL global Esc shortcut (P7: Esc hides the window) to a window
      // keydown listener, exactly like useKeyboardShortcuts does.
      const hideWindow = vi.fn();
      const context: ShortcutContext = {
        navigate: vi.fn(),
        lastTranscription: null,
        hideWindow,
      };
      const globalKeydown = (e: KeyboardEvent) => handleShortcut(e, context);
      window.addEventListener("keydown", globalKeydown);

      render(
        <ProviderModal
          mode="add"
          onClose={mockOnClose}
          onSave={mockOnSave}
          existingIds={existingIds}
        />
      );

      const dialog = screen.getByRole("dialog");
      const event = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
      });
      dialog.dispatchEvent(event);

      // Modal closes...
      expect(mockOnClose).toHaveBeenCalledTimes(1);
      // ...but the window is NOT hidden (stopPropagation guard works).
      expect(hideWindow).not.toHaveBeenCalled();

      window.removeEventListener("keydown", globalKeydown);
    });
  });

  describe("Add Mode", () => {
    it("renders add mode title", () => {
      render(
        <ProviderModal
          mode="add"
          onClose={mockOnClose}
          onSave={mockOnSave}
          existingIds={existingIds}
        />
      );

      expect(screen.getByText("Add Custom Provider")).toBeInTheDocument();
      expect(screen.getByText("Add Provider")).toBeInTheDocument();
    });

    it("shows empty fields in add mode", () => {
      render(
        <ProviderModal
          mode="add"
          onClose={mockOnClose}
          onSave={mockOnSave}
          existingIds={existingIds}
        />
      );

      const nameInput = screen.getByPlaceholderText("e.g., My Provider");
      const urlInput = screen.getByPlaceholderText(
        "https://api.example.com/v1/chat/completions"
      );

      expect(nameInput).toHaveValue("");
      expect(urlInput).toHaveValue("");
    });

    it("does not show ID field in add mode", () => {
      render(
        <ProviderModal
          mode="add"
          onClose={mockOnClose}
          onSave={mockOnSave}
          existingIds={existingIds}
        />
      );

      const labels = screen.getAllByText(/^(Name|API URL|Models)$/);
      const idLabel = screen.queryByText("ID");
      expect(idLabel).not.toBeInTheDocument();
    });

    it("validates required name", async () => {
      render(
        <ProviderModal
          mode="add"
          onClose={mockOnClose}
          onSave={mockOnSave}
          existingIds={existingIds}
        />
      );

      const submitButton = screen.getByText("Add Provider");
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText("Name is required")).toBeInTheDocument();
      });

      expect(mockOnSave).not.toHaveBeenCalled();
    });

    it("validates required API URL", async () => {
      render(
        <ProviderModal
          mode="add"
          onClose={mockOnClose}
          onSave={mockOnSave}
          existingIds={existingIds}
        />
      );

      const nameInput = screen.getByPlaceholderText("e.g., My Provider");
      fireEvent.change(nameInput, { target: { value: "Test Provider" } });

      const submitButton = screen.getByText("Add Provider");
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText("API URL is required")).toBeInTheDocument();
      });
    });

    it("validates API URL format", async () => {
      render(
        <ProviderModal
          mode="add"
          onClose={mockOnClose}
          onSave={mockOnSave}
          existingIds={existingIds}
        />
      );

      const nameInput = screen.getByPlaceholderText("e.g., My Provider");
      const urlInput = screen.getByPlaceholderText(
        "https://api.example.com/v1/chat/completions"
      );

      fireEvent.change(nameInput, { target: { value: "Test" } });
      fireEvent.change(urlInput, { target: { value: "not-a-valid-url" } });

      const submitButton = screen.getByText("Add Provider");
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(
          screen.getByText("API URL must be a valid HTTP/HTTPS URL")
        ).toBeInTheDocument();
      });
    });

    it("validates at least one model is required", async () => {
      render(
        <ProviderModal
          mode="add"
          onClose={mockOnClose}
          onSave={mockOnSave}
          existingIds={existingIds}
        />
      );

      const nameInput = screen.getByPlaceholderText("e.g., My Provider");
      const urlInput = screen.getByPlaceholderText(
        "https://api.example.com/v1/chat/completions"
      );

      fireEvent.change(nameInput, { target: { value: "Test" } });
      fireEvent.change(urlInput, { target: { value: "https://api.test.com" } });

      const submitButton = screen.getByText("Add Provider");
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(
          screen.getByText("At least one model is required")
        ).toBeInTheDocument();
      });
    });

    it("checks for duplicate provider ID", async () => {
      render(
        <ProviderModal
          mode="add"
          onClose={mockOnClose}
          onSave={mockOnSave}
          existingIds={existingIds}
        />
      );

      const nameInput = screen.getByPlaceholderText("e.g., My Provider");
      const urlInput = screen.getByPlaceholderText(
        "https://api.example.com/v1/chat/completions"
      );
      const modelsTextarea = screen.getByPlaceholderText(/gpt-4:GPT-4/);

      // "OpenAI" will generate id "openai" which already exists
      fireEvent.change(nameInput, { target: { value: "OpenAI" } });
      fireEvent.change(urlInput, { target: { value: "https://api.test.com" } });
      fireEvent.change(modelsTextarea, { target: { value: "model1:Model 1" } });

      const submitButton = screen.getByText("Add Provider");
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(
          screen.getByText('Provider with ID "openai" already exists')
        ).toBeInTheDocument();
      });
    });

    it("calls onSave with correct data", async () => {
      render(
        <ProviderModal
          mode="add"
          onClose={mockOnClose}
          onSave={mockOnSave}
          existingIds={existingIds}
        />
      );

      const nameInput = screen.getByPlaceholderText("e.g., My Provider");
      const urlInput = screen.getByPlaceholderText(
        "https://api.example.com/v1/chat/completions"
      );
      const modelsTextarea = screen.getByPlaceholderText(/gpt-4:GPT-4/);

      fireEvent.change(nameInput, { target: { value: "New Provider" } });
      fireEvent.change(urlInput, {
        target: { value: "https://new.api.com/v1" },
      });
      fireEvent.change(modelsTextarea, {
        target: { value: "model1:Model One\nmodel2:Model Two" },
      });

      const submitButton = screen.getByText("Add Provider");
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith({
          id: "new-provider",
          name: "New Provider",
          api_url: "https://new.api.com/v1",
          models: [
            { id: "model1", name: "Model One" },
            { id: "model2", name: "Model Two" },
          ],
          default_model: "model1",
        });
      });
    });

    it("calls onClose when Cancel is clicked", () => {
      render(
        <ProviderModal
          mode="add"
          onClose={mockOnClose}
          onSave={mockOnSave}
          existingIds={existingIds}
        />
      );

      const cancelButton = screen.getByText("Cancel");
      fireEvent.click(cancelButton);

      expect(mockOnClose).toHaveBeenCalled();
    });

    it("calls onClose when overlay is clicked", () => {
      render(
        <ProviderModal
          mode="add"
          onClose={mockOnClose}
          onSave={mockOnSave}
          existingIds={existingIds}
        />
      );

      const overlay = document.querySelector(".modal-overlay");
      fireEvent.click(overlay!);

      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe("Edit Mode", () => {
    const existingProvider: LlmProvider = {
      id: "custom-provider",
      name: "Custom Provider",
      api_url: "https://custom.api.com/v1",
      models: [
        { id: "model-a", name: "Model A" },
        { id: "model-b", name: "Model B" },
      ],
      default_model: "model-a",
      builtin: false,
    };

    it("renders edit mode title", () => {
      render(
        <ProviderModal
          mode="edit"
          provider={existingProvider}
          onClose={mockOnClose}
          onSave={mockOnSave}
          existingIds={existingIds}
        />
      );

      expect(screen.getByText("Edit Provider")).toBeInTheDocument();
      expect(screen.getByText("Save Changes")).toBeInTheDocument();
    });

    it("shows ID field as readonly in edit mode", () => {
      render(
        <ProviderModal
          mode="edit"
          provider={existingProvider}
          onClose={mockOnClose}
          onSave={mockOnSave}
          existingIds={existingIds}
        />
      );

      expect(screen.getByText("ID")).toBeInTheDocument();
      const idInput = screen.getByDisplayValue("custom-provider");
      expect(idInput).toHaveAttribute("readonly");
    });

    it("pre-fills fields with provider data", () => {
      render(
        <ProviderModal
          mode="edit"
          provider={existingProvider}
          onClose={mockOnClose}
          onSave={mockOnSave}
          existingIds={existingIds}
        />
      );

      expect(screen.getByDisplayValue("Custom Provider")).toBeInTheDocument();
      expect(
        screen.getByDisplayValue("https://custom.api.com/v1")
      ).toBeInTheDocument();
    });

    it("calls onSave with updated data preserving ID", async () => {
      render(
        <ProviderModal
          mode="edit"
          provider={existingProvider}
          onClose={mockOnClose}
          onSave={mockOnSave}
          existingIds={existingIds}
        />
      );

      const nameInput = screen.getByDisplayValue("Custom Provider");
      fireEvent.change(nameInput, { target: { value: "Updated Provider" } });

      const submitButton = screen.getByText("Save Changes");
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            id: "custom-provider", // ID should be preserved
            name: "Updated Provider",
          })
        );
      });
    });

    it("does not check for duplicate ID in edit mode", async () => {
      // Even if we somehow have a provider with id that matches existing,
      // edit mode should not block it (since it's the same provider)
      render(
        <ProviderModal
          mode="edit"
          provider={existingProvider}
          onClose={mockOnClose}
          onSave={mockOnSave}
          existingIds={[...existingIds, "custom-provider"]}
        />
      );

      const submitButton = screen.getByText("Save Changes");
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalled();
      });
    });

    it("shows saving state", async () => {
      mockOnSave.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      );

      render(
        <ProviderModal
          mode="edit"
          provider={existingProvider}
          onClose={mockOnClose}
          onSave={mockOnSave}
          existingIds={existingIds}
        />
      );

      const submitButton = screen.getByText("Save Changes");
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText("Saving...")).toBeInTheDocument();
      });
    });

    it("handles save error", async () => {
      const onCloseMock = vi.fn();
      const onSaveMock = vi.fn().mockRejectedValue(new Error("Network error"));

      render(
        <ProviderModal
          mode="edit"
          provider={existingProvider}
          onClose={onCloseMock}
          onSave={onSaveMock}
          existingIds={existingIds}
        />
      );

      const submitButton = screen.getByText("Save Changes");
      fireEvent.click(submitButton);

      // Wait for error to be displayed
      await waitFor(() => {
        expect(screen.getByText("Network error")).toBeInTheDocument();
      });

      // Wait a bit more for any potential side effects to settle
      await waitFor(() => {
        expect(screen.getByText("Save Changes")).toBeInTheDocument(); // Button should be re-enabled
      });

      // Should not close on error
      expect(onCloseMock).not.toHaveBeenCalled();
    });
  });
});
