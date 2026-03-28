import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DictionaryEntry from "../DictionaryEntry";
import type { DictionaryEntry as DictionaryEntryType } from "../../../lib/commands";

const mockEntry: DictionaryEntryType = {
  id: 1,
  source: "солид",
  replacement: "SOLID",
};

describe("DictionaryEntry", () => {
  let mockOnUpdate: ReturnType<typeof vi.fn>;
  let mockOnDelete: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockOnUpdate = vi.fn().mockResolvedValue(undefined);
    mockOnDelete = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("displays source and replacement", () => {
    render(
      <DictionaryEntry
        entry={mockEntry}
        onUpdate={mockOnUpdate}
        onDelete={mockOnDelete}
      />
    );

    expect(screen.getByText("солид")).toBeInTheDocument();
    expect(screen.getByText("SOLID")).toBeInTheDocument();
  });

  it("shows arrow between source and replacement", () => {
    const { container } = render(
      <DictionaryEntry
        entry={mockEntry}
        onUpdate={mockOnUpdate}
        onDelete={mockOnDelete}
      />
    );

    expect(container.querySelector(".dictionary-arrow")).toBeInTheDocument();
  });

  it("shows edit and delete buttons", () => {
    render(
      <DictionaryEntry
        entry={mockEntry}
        onUpdate={mockOnUpdate}
        onDelete={mockOnDelete}
      />
    );

    expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });

  it("enters edit mode when edit button clicked", () => {
    render(
      <DictionaryEntry
        entry={mockEntry}
        onUpdate={mockOnUpdate}
        onDelete={mockOnDelete}
      />
    );

    const editButton = screen.getByRole("button", { name: /edit/i });
    fireEvent.click(editButton);

    // Should now show input fields
    expect(screen.getByDisplayValue("солид")).toBeInTheDocument();
    expect(screen.getByDisplayValue("SOLID")).toBeInTheDocument();

    // Should show Save and Cancel buttons
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("cancels edit mode and restores original values", () => {
    render(
      <DictionaryEntry
        entry={mockEntry}
        onUpdate={mockOnUpdate}
        onDelete={mockOnDelete}
      />
    );

    // Enter edit mode
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));

    // Modify values
    const sourceInput = screen.getByDisplayValue("солид");
    fireEvent.change(sourceInput, { target: { value: "changed" } });

    // Cancel
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    // Should show original values (not inputs)
    expect(screen.getByText("солид")).toBeInTheDocument();
    expect(screen.getByText("SOLID")).toBeInTheDocument();
  });

  it("calls onUpdate with new values when saved", async () => {
    render(
      <DictionaryEntry
        entry={mockEntry}
        onUpdate={mockOnUpdate}
        onDelete={mockOnDelete}
      />
    );

    // Enter edit mode
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));

    // Modify values
    const sourceInput = screen.getByDisplayValue("солид");
    const replacementInput = screen.getByDisplayValue("SOLID");

    fireEvent.change(sourceInput, { target: { value: "солидный" } });
    fireEvent.change(replacementInput, { target: { value: "SOLID-ный" } });

    // Save
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(mockOnUpdate).toHaveBeenCalledWith(1, "солидный", "SOLID-ный");
    });
  });

  it("disables save button when fields are empty", () => {
    render(
      <DictionaryEntry
        entry={mockEntry}
        onUpdate={mockOnUpdate}
        onDelete={mockOnDelete}
      />
    );

    // Enter edit mode
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));

    // Clear source
    const sourceInput = screen.getByDisplayValue("солид");
    fireEvent.change(sourceInput, { target: { value: "" } });

    const saveButton = screen.getByRole("button", { name: /save/i });
    expect(saveButton).toBeDisabled();
  });

  it("disables save button when fields are whitespace only", () => {
    render(
      <DictionaryEntry
        entry={mockEntry}
        onUpdate={mockOnUpdate}
        onDelete={mockOnDelete}
      />
    );

    // Enter edit mode
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));

    // Set whitespace
    const sourceInput = screen.getByDisplayValue("солид");
    fireEvent.change(sourceInput, { target: { value: "   " } });

    const saveButton = screen.getByRole("button", { name: /save/i });
    expect(saveButton).toBeDisabled();
  });

  it("calls onDelete after confirmation", async () => {
    render(
      <DictionaryEntry
        entry={mockEntry}
        onUpdate={mockOnUpdate}
        onDelete={mockOnDelete}
      />
    );

    const deleteButton = screen.getByRole("button", { name: /delete/i });
    fireEvent.click(deleteButton);

    expect(window.confirm).toHaveBeenCalled();

    await waitFor(() => {
      expect(mockOnDelete).toHaveBeenCalledWith(1);
    });
  });

  it("does not call onDelete if confirmation is cancelled", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);

    render(
      <DictionaryEntry
        entry={mockEntry}
        onUpdate={mockOnUpdate}
        onDelete={mockOnDelete}
      />
    );

    const deleteButton = screen.getByRole("button", { name: /delete/i });
    fireEvent.click(deleteButton);

    expect(mockOnDelete).not.toHaveBeenCalled();
  });

  it("shows saving state while updating", async () => {
    mockOnUpdate.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100))
    );

    render(
      <DictionaryEntry
        entry={mockEntry}
        onUpdate={mockOnUpdate}
        onDelete={mockOnDelete}
      />
    );

    // Enter edit mode
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));

    // Save
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    // Should show "..." while saving
    expect(screen.getByText("...")).toBeInTheDocument();

    await waitFor(() => {
      // After save completes, should exit edit mode
      expect(screen.queryByText("...")).not.toBeInTheDocument();
    });
  });

  it("trims whitespace from values on save", async () => {
    render(
      <DictionaryEntry
        entry={mockEntry}
        onUpdate={mockOnUpdate}
        onDelete={mockOnDelete}
      />
    );

    // Enter edit mode
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));

    // Modify with whitespace
    const sourceInput = screen.getByDisplayValue("солид");
    const replacementInput = screen.getByDisplayValue("SOLID");

    fireEvent.change(sourceInput, { target: { value: "  солидный  " } });
    fireEvent.change(replacementInput, { target: { value: "  SOLID  " } });

    // Save
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(mockOnUpdate).toHaveBeenCalledWith(1, "солидный", "SOLID");
    });
  });

  it("has correct css classes in view mode", () => {
    const { container } = render(
      <DictionaryEntry
        entry={mockEntry}
        onUpdate={mockOnUpdate}
        onDelete={mockOnDelete}
      />
    );

    expect(container.querySelector(".dictionary-entry")).toBeInTheDocument();
    expect(container.querySelector(".dictionary-source")).toBeInTheDocument();
    expect(
      container.querySelector(".dictionary-replacement")
    ).toBeInTheDocument();
  });

  it("has editing class in edit mode", () => {
    const { container } = render(
      <DictionaryEntry
        entry={mockEntry}
        onUpdate={mockOnUpdate}
        onDelete={mockOnDelete}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /edit/i }));

    expect(container.querySelector(".editing")).toBeInTheDocument();
  });
});
