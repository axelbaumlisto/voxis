import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ProviderActions from "../ProviderActions";
import { LlmProvider } from "../../../lib/commands";

const mockBuiltinProvider: LlmProvider = {
  id: "openai",
  name: "OpenAI",
  api_url: "https://api.openai.com/v1",
  models: [{ id: "gpt-4", name: "GPT-4" }],
  default_model: "gpt-4",
  builtin: true,
};

const mockCustomProvider: LlmProvider = {
  id: "custom",
  name: "Custom Provider",
  api_url: "https://custom.api.com/v1",
  models: [{ id: "custom-model", name: "Custom Model" }],
  default_model: "custom-model",
  builtin: false,
};

describe("ProviderActions", () => {
  describe("Add button", () => {
    it("renders Add button", () => {
      render(
        <ProviderActions
          currentProvider={undefined}
          onAdd={vi.fn()}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      );

      const addButton = screen.getByRole("button", { name: "Add custom provider" });
      expect(addButton).toBeInTheDocument();
    });

    it("calls onAdd when Add button is clicked", () => {
      const onAdd = vi.fn();
      render(
        <ProviderActions
          currentProvider={undefined}
          onAdd={onAdd}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: "Add custom provider" }));
      expect(onAdd).toHaveBeenCalledTimes(1);
    });

    it("has correct title attribute", () => {
      render(
        <ProviderActions
          currentProvider={undefined}
          onAdd={vi.fn()}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      );

      expect(screen.getByTitle("Add custom provider")).toBeInTheDocument();
    });

    it("has provider-action-btn class", () => {
      render(
        <ProviderActions
          currentProvider={undefined}
          onAdd={vi.fn()}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      );

      const addButton = screen.getByRole("button", { name: "Add custom provider" });
      expect(addButton).toHaveClass("provider-action-btn");
    });
  });

  describe("Edit and Delete buttons with builtin provider", () => {
    it("does not render Edit button for builtin provider", () => {
      render(
        <ProviderActions
          currentProvider={mockBuiltinProvider}
          onAdd={vi.fn()}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      );

      expect(screen.queryByTitle("Edit provider")).not.toBeInTheDocument();
    });

    it("does not render Delete button for builtin provider", () => {
      render(
        <ProviderActions
          currentProvider={mockBuiltinProvider}
          onAdd={vi.fn()}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      );

      expect(screen.queryByTitle("Remove provider")).not.toBeInTheDocument();
    });
  });

  describe("Accessible names (a11y)", () => {
    it("add button has accessible name", () => {
      render(
        <ProviderActions
          currentProvider={undefined}
          onAdd={vi.fn()}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      );
      expect(
        screen.getByRole("button", { name: "Add custom provider" })
      ).toBeInTheDocument();
    });

    it("edit and delete buttons have accessible names", () => {
      render(
        <ProviderActions
          currentProvider={mockCustomProvider}
          onAdd={vi.fn()}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      );
      expect(
        screen.getByRole("button", { name: "Edit provider" })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Remove provider" })
      ).toBeInTheDocument();
    });
  });

  describe("Edit and Delete buttons with custom provider", () => {
    it("renders Edit button for custom provider", () => {
      render(
        <ProviderActions
          currentProvider={mockCustomProvider}
          onAdd={vi.fn()}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      );

      expect(screen.getByTitle("Edit provider")).toBeInTheDocument();
    });

    it("renders Delete button for custom provider", () => {
      render(
        <ProviderActions
          currentProvider={mockCustomProvider}
          onAdd={vi.fn()}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      );

      expect(screen.getByTitle("Remove provider")).toBeInTheDocument();
    });

    it("calls onEdit when Edit button is clicked", () => {
      const onEdit = vi.fn();
      render(
        <ProviderActions
          currentProvider={mockCustomProvider}
          onAdd={vi.fn()}
          onEdit={onEdit}
          onRemove={vi.fn()}
        />
      );

      fireEvent.click(screen.getByTitle("Edit provider"));
      expect(onEdit).toHaveBeenCalledTimes(1);
    });

    it("calls onRemove when Delete button is clicked", () => {
      const onRemove = vi.fn();
      render(
        <ProviderActions
          currentProvider={mockCustomProvider}
          onAdd={vi.fn()}
          onEdit={vi.fn()}
          onRemove={onRemove}
        />
      );

      fireEvent.click(screen.getByTitle("Remove provider"));
      expect(onRemove).toHaveBeenCalledTimes(1);
    });

    it("Edit button has correct CSS classes", () => {
      render(
        <ProviderActions
          currentProvider={mockCustomProvider}
          onAdd={vi.fn()}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      );

      const editButton = screen.getByTitle("Edit provider");
      expect(editButton).toHaveClass("provider-action-btn");
      expect(editButton).toHaveClass("provider-edit-btn");
    });

    it("Delete button has correct CSS classes", () => {
      render(
        <ProviderActions
          currentProvider={mockCustomProvider}
          onAdd={vi.fn()}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      );

      const deleteButton = screen.getByTitle("Remove provider");
      expect(deleteButton).toHaveClass("provider-action-btn");
      expect(deleteButton).toHaveClass("provider-delete-btn");
    });
  });

  describe("No provider selected", () => {
    it("only shows Add button when no provider", () => {
      render(
        <ProviderActions
          currentProvider={undefined}
          onAdd={vi.fn()}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />
      );

      expect(screen.getByRole("button", { name: "Add custom provider" })).toBeInTheDocument();
      expect(screen.queryByTitle("Edit provider")).not.toBeInTheDocument();
      expect(screen.queryByTitle("Remove provider")).not.toBeInTheDocument();
    });
  });
});
