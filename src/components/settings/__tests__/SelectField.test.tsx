import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SelectField from "../SelectField";

const mockOptions = [
  { label: "Option 1", value: "opt1" },
  { label: "Option 2", value: "opt2" },
  { label: "Option 3", value: "opt3" },
];

describe("SelectField", () => {
  it("renders label and options", () => {
    render(
      <SelectField
        label="Test Label"
        value="opt1"
        options={mockOptions}
        onChange={() => {}}
      />
    );

    expect(screen.getByText("Test Label")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveTextContent("Option 1");
    expect(options[1]).toHaveTextContent("Option 2");
    expect(options[2]).toHaveTextContent("Option 3");
  });

  it("shows current value selected", () => {
    render(
      <SelectField
        label="Test Label"
        value="opt2"
        options={mockOptions}
        onChange={() => {}}
      />
    );

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("opt2");
  });

  it("calls onChange with new value", () => {
    const handleChange = vi.fn();
    render(
      <SelectField
        label="Test Label"
        value="opt1"
        options={mockOptions}
        onChange={handleChange}
      />
    );

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "opt3" } });

    expect(handleChange).toHaveBeenCalledWith("opt3");
    expect(handleChange).toHaveBeenCalledTimes(1);
  });

  it("renders description if provided", () => {
    render(
      <SelectField
        label="Test Label"
        value="opt1"
        options={mockOptions}
        onChange={() => {}}
        description="This is a helpful description"
      />
    );

    expect(screen.getByText("This is a helpful description")).toBeInTheDocument();
  });

  it("does not render description if not provided", () => {
    render(
      <SelectField
        label="Test Label"
        value="opt1"
        options={mockOptions}
        onChange={() => {}}
      />
    );

    expect(screen.queryByText(/description/i)).not.toBeInTheDocument();
  });

  it("has correct css classes", () => {
    render(
      <SelectField
        label="Test Label"
        value="opt1"
        options={mockOptions}
        onChange={() => {}}
      />
    );

    const container = screen.getByText("Test Label").closest(".settings-field");
    expect(container).toBeInTheDocument();
    expect(container?.querySelector(".settings-field-input")).toBeInTheDocument();
  });
});
