import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import PasteShortcutCheckboxes from "../PasteShortcutCheckboxes";

describe("PasteShortcutCheckboxes", () => {
  it("renders all shortcuts as checkboxes", () => {
    render(
      <PasteShortcutCheckboxes
        label="Paste Shortcuts"
        value="ctrl_shift_v"
        onChange={() => {}}
      />
    );

    expect(screen.getByLabelText(/Ctrl\+Shift\+V/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Ctrl\+V/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Shift\+Insert/)).toBeInTheDocument();
  });

  it("checks boxes based on comma-separated value", () => {
    render(
      <PasteShortcutCheckboxes
        label="Paste Shortcuts"
        value="ctrl_shift_v,shift_insert"
        onChange={() => {}}
      />
    );

    expect(screen.getByLabelText(/Ctrl\+Shift\+V/)).toBeChecked();
    expect(screen.getByLabelText(/Ctrl\+V/)).not.toBeChecked();
    expect(screen.getByLabelText(/Shift\+Insert/)).toBeChecked();
  });

  it("calls onChange when checkbox is toggled", () => {
    const handleChange = vi.fn();

    render(
      <PasteShortcutCheckboxes
        label="Paste Shortcuts"
        value="ctrl_shift_v"
        onChange={handleChange}
      />
    );

    fireEvent.click(screen.getByLabelText(/Ctrl\+V/));

    expect(handleChange).toHaveBeenCalledWith("ctrl_shift_v,ctrl_v");
  });

  it("removes shortcut when unchecked", () => {
    const handleChange = vi.fn();

    render(
      <PasteShortcutCheckboxes
        label="Paste Shortcuts"
        value="ctrl_shift_v,shift_insert"
        onChange={handleChange}
      />
    );

    fireEvent.click(screen.getByLabelText(/Shift\+Insert/));

    expect(handleChange).toHaveBeenCalledWith("ctrl_shift_v");
  });

  it("defaults to ctrl_shift_v when all unchecked", () => {
    const handleChange = vi.fn();

    render(
      <PasteShortcutCheckboxes
        label="Paste Shortcuts"
        value="ctrl_shift_v"
        onChange={handleChange}
      />
    );

    fireEvent.click(screen.getByLabelText(/Ctrl\+Shift\+V/));

    expect(handleChange).toHaveBeenCalledWith("ctrl_shift_v");
  });

  it("renders description when provided", () => {
    render(
      <PasteShortcutCheckboxes
        label="Paste Shortcuts"
        description="Keyboard shortcuts for paste"
        value="ctrl_shift_v"
        onChange={() => {}}
      />
    );

    expect(screen.getByText("Keyboard shortcuts for paste")).toBeInTheDocument();
  });

  it("handles empty value", () => {
    render(
      <PasteShortcutCheckboxes
        label="Paste Shortcuts"
        value=""
        onChange={() => {}}
      />
    );

    // All checkboxes should be unchecked
    expect(screen.getByLabelText(/Ctrl\+Shift\+V/)).not.toBeChecked();
  });
});
