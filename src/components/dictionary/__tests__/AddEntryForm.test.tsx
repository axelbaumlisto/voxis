import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AddEntryForm from "../AddEntryForm";

// Note: Need to install @testing-library/user-event if not already
// For now, use fireEvent for simplicity

describe("AddEntryForm", () => {
  let mockOnAdd: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockOnAdd = vi.fn().mockResolvedValue(undefined);
  });

  it("renders source and replacement inputs", () => {
    render(<AddEntryForm onAdd={mockOnAdd} />);

    expect(
      screen.getByPlaceholderText(/source word/i)
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/replacement/i)
    ).toBeInTheDocument();
  });

  it("renders add button", () => {
    render(<AddEntryForm onAdd={mockOnAdd} />);

    expect(screen.getByRole("button", { name: /add/i })).toBeInTheDocument();
  });

  it("validates non-empty fields before submit - button disabled", () => {
    render(<AddEntryForm onAdd={mockOnAdd} />);

    const addButton = screen.getByRole("button", { name: /add/i });
    expect(addButton).toBeDisabled();
  });

  it("enables button when both fields have values", () => {
    render(<AddEntryForm onAdd={mockOnAdd} />);

    const sourceInput = screen.getByPlaceholderText(/source word/i);
    const replacementInput = screen.getByPlaceholderText(/replacement/i);

    fireEvent.change(sourceInput, { target: { value: "солид" } });
    fireEvent.change(replacementInput, { target: { value: "SOLID" } });

    const addButton = screen.getByRole("button", { name: /add/i });
    expect(addButton).not.toBeDisabled();
  });

  it("keeps button disabled with only source filled", () => {
    render(<AddEntryForm onAdd={mockOnAdd} />);

    const sourceInput = screen.getByPlaceholderText(/source word/i);
    fireEvent.change(sourceInput, { target: { value: "солид" } });

    const addButton = screen.getByRole("button", { name: /add/i });
    expect(addButton).toBeDisabled();
  });

  it("keeps button disabled with only replacement filled", () => {
    render(<AddEntryForm onAdd={mockOnAdd} />);

    const replacementInput = screen.getByPlaceholderText(/replacement/i);
    fireEvent.change(replacementInput, { target: { value: "SOLID" } });

    const addButton = screen.getByRole("button", { name: /add/i });
    expect(addButton).toBeDisabled();
  });

  it("keeps button disabled with whitespace-only values", () => {
    render(<AddEntryForm onAdd={mockOnAdd} />);

    const sourceInput = screen.getByPlaceholderText(/source word/i);
    const replacementInput = screen.getByPlaceholderText(/replacement/i);

    fireEvent.change(sourceInput, { target: { value: "   " } });
    fireEvent.change(replacementInput, { target: { value: "   " } });

    const addButton = screen.getByRole("button", { name: /add/i });
    expect(addButton).toBeDisabled();
  });

  it("calls onAdd with source and replacement on submit", async () => {
    render(<AddEntryForm onAdd={mockOnAdd} />);

    const sourceInput = screen.getByPlaceholderText(/source word/i);
    const replacementInput = screen.getByPlaceholderText(/replacement/i);
    const addButton = screen.getByRole("button", { name: /add/i });

    fireEvent.change(sourceInput, { target: { value: "солид" } });
    fireEvent.change(replacementInput, { target: { value: "SOLID" } });
    fireEvent.click(addButton);

    await waitFor(() => {
      expect(mockOnAdd).toHaveBeenCalledWith("солид", "SOLID");
    });
  });

  it("trims whitespace from values", async () => {
    render(<AddEntryForm onAdd={mockOnAdd} />);

    const sourceInput = screen.getByPlaceholderText(/source word/i);
    const replacementInput = screen.getByPlaceholderText(/replacement/i);
    const addButton = screen.getByRole("button", { name: /add/i });

    fireEvent.change(sourceInput, { target: { value: "  солид  " } });
    fireEvent.change(replacementInput, { target: { value: "  SOLID  " } });
    fireEvent.click(addButton);

    await waitFor(() => {
      expect(mockOnAdd).toHaveBeenCalledWith("солид", "SOLID");
    });
  });

  it("clears form after successful submit", async () => {
    render(<AddEntryForm onAdd={mockOnAdd} />);

    const sourceInput = screen.getByPlaceholderText(
      /source word/i
    ) as HTMLInputElement;
    const replacementInput = screen.getByPlaceholderText(
      /replacement/i
    ) as HTMLInputElement;
    const addButton = screen.getByRole("button", { name: /add/i });

    fireEvent.change(sourceInput, { target: { value: "солид" } });
    fireEvent.change(replacementInput, { target: { value: "SOLID" } });
    fireEvent.click(addButton);

    await waitFor(() => {
      expect(sourceInput.value).toBe("");
      expect(replacementInput.value).toBe("");
    });
  });

  it("shows adding state while submitting", async () => {
    // Make onAdd take some time
    mockOnAdd.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100))
    );

    render(<AddEntryForm onAdd={mockOnAdd} />);

    const sourceInput = screen.getByPlaceholderText(/source word/i);
    const replacementInput = screen.getByPlaceholderText(/replacement/i);

    fireEvent.change(sourceInput, { target: { value: "солид" } });
    fireEvent.change(replacementInput, { target: { value: "SOLID" } });

    const addButton = screen.getByRole("button", { name: /add/i });
    fireEvent.click(addButton);

    // Should show "Adding..." while in progress
    expect(screen.getByText("Adding...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Add")).toBeInTheDocument();
    });
  });

  it("disables button while adding", async () => {
    mockOnAdd.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100))
    );

    render(<AddEntryForm onAdd={mockOnAdd} />);

    const sourceInput = screen.getByPlaceholderText(/source word/i);
    const replacementInput = screen.getByPlaceholderText(/replacement/i);

    fireEvent.change(sourceInput, { target: { value: "солид" } });
    fireEvent.change(replacementInput, { target: { value: "SOLID" } });

    const addButton = screen.getByRole("button", { name: /add/i });
    fireEvent.click(addButton);

    // Should be disabled while adding
    expect(addButton).toBeDisabled();

    // Wait for the adding state to complete
    // Button will still be disabled after completion because form clears
    // So we just verify the adding process completes
    await waitFor(() => {
      expect(mockOnAdd).toHaveBeenCalled();
    });
  });

  it("has correct css classes", () => {
    const { container } = render(<AddEntryForm onAdd={mockOnAdd} />);

    expect(container.querySelector(".add-entry-form")).toBeInTheDocument();
    expect(container.querySelectorAll(".add-entry-input")).toHaveLength(2);
    expect(container.querySelector(".dictionary-arrow")).toBeInTheDocument();
  });
});
