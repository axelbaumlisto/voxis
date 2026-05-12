import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import EditDictionaryEntryForm from "../EditDictionaryEntryForm";

describe("EditDictionaryEntryForm", () => {
  const defaultProps = {
    source: "test",
    replacement: "TEST",
    onSourceChange: vi.fn(),
    onReplacementChange: vi.fn(),
    onSave: vi.fn(),
    onCancel: vi.fn(),
    saving: false,
  };

  it("renders source and replacement inputs with values", () => {
    render(<EditDictionaryEntryForm {...defaultProps} />);

    const sourceInput = screen.getByPlaceholderText(/Source word/);
    const replacementInput = screen.getByPlaceholderText(/Replacement/);

    expect(sourceInput).toHaveValue("test");
    expect(replacementInput).toHaveValue("TEST");
  });

  it("renders arrow between inputs", () => {
    render(<EditDictionaryEntryForm {...defaultProps} />);
    expect(screen.getByText("→")).toBeInTheDocument();
  });

  it("calls onSourceChange when source input changes", () => {
    const onSourceChange = vi.fn();
    render(
      <EditDictionaryEntryForm {...defaultProps} onSourceChange={onSourceChange} />
    );

    const sourceInput = screen.getByPlaceholderText(/Source word/);
    fireEvent.change(sourceInput, { target: { value: "new-source" } });

    expect(onSourceChange).toHaveBeenCalledWith("new-source");
  });

  it("calls onReplacementChange when replacement input changes", () => {
    const onReplacementChange = vi.fn();
    render(
      <EditDictionaryEntryForm
        {...defaultProps}
        onReplacementChange={onReplacementChange}
      />
    );

    const replacementInput = screen.getByPlaceholderText(/Replacement/);
    fireEvent.change(replacementInput, { target: { value: "NEW-REPLACEMENT" } });

    expect(onReplacementChange).toHaveBeenCalledWith("NEW-REPLACEMENT");
  });

  it("calls onSave when Save button is clicked", () => {
    const onSave = vi.fn();
    render(<EditDictionaryEntryForm {...defaultProps} onSave={onSave} />);

    fireEvent.click(screen.getByText("Save"));

    expect(onSave).toHaveBeenCalled();
  });

  it("calls onCancel when Cancel button is clicked", () => {
    const onCancel = vi.fn();
    render(<EditDictionaryEntryForm {...defaultProps} onCancel={onCancel} />);

    fireEvent.click(screen.getByText("Cancel"));

    expect(onCancel).toHaveBeenCalled();
  });

  it("disables Save button when source is empty", () => {
    render(<EditDictionaryEntryForm {...defaultProps} source="" />);

    expect(screen.getByText("Save")).toBeDisabled();
  });

  it("disables Save button when replacement is empty", () => {
    render(<EditDictionaryEntryForm {...defaultProps} replacement="" />);

    expect(screen.getByText("Save")).toBeDisabled();
  });

  it("disables Save button when source is whitespace only", () => {
    render(<EditDictionaryEntryForm {...defaultProps} source="   " />);

    expect(screen.getByText("Save")).toBeDisabled();
  });

  it("disables Save button when saving is true", () => {
    render(<EditDictionaryEntryForm {...defaultProps} saving={true} />);

    expect(screen.getByText("...")).toBeDisabled();
  });

  it("shows '...' text when saving", () => {
    render(<EditDictionaryEntryForm {...defaultProps} saving={true} />);

    expect(screen.getByText("...")).toBeInTheDocument();
  });

  it("disables Cancel button when saving", () => {
    render(<EditDictionaryEntryForm {...defaultProps} saving={true} />);

    expect(screen.getByText("Cancel")).toBeDisabled();
  });

  it("enables Save button when both fields have content", () => {
    render(
      <EditDictionaryEntryForm
        {...defaultProps}
        source="valid"
        replacement="VALID"
      />
    );

    expect(screen.getByText("Save")).not.toBeDisabled();
  });

  it("has editing class on container", () => {
    const { container } = render(<EditDictionaryEntryForm {...defaultProps} />);

    expect(container.querySelector(".dictionary-entry.editing")).toBeInTheDocument();
  });
});
