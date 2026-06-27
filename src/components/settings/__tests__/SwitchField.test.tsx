import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SwitchField from "../SwitchField";

describe("SwitchField", () => {
  it("renders label", () => {
    render(
      <SwitchField label="Enable Feature" checked={false} onChange={() => {}} />
    );

    expect(screen.getByText("Enable Feature")).toBeInTheDocument();
  });

  it("checkbox has an accessible name (a11y)", () => {
    render(
      <SwitchField label="Enable Feature" checked={false} onChange={() => {}} />
    );

    expect(
      screen.getByRole("checkbox", { name: "Enable Feature" })
    ).toBeInTheDocument();
  });

  it("shows checked state correctly", () => {
    render(
      <SwitchField label="Enable Feature" checked={true} onChange={() => {}} />
    );

    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it("shows unchecked state correctly", () => {
    render(
      <SwitchField label="Enable Feature" checked={false} onChange={() => {}} />
    );

    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });

  it("calls onChange with new value when toggled", () => {
    const handleChange = vi.fn();
    render(
      <SwitchField
        label="Enable Feature"
        checked={false}
        onChange={handleChange}
      />
    );

    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);

    expect(handleChange).toHaveBeenCalledWith(true);
    expect(handleChange).toHaveBeenCalledTimes(1);
  });

  it("calls onChange with false when unchecked", () => {
    const handleChange = vi.fn();
    render(
      <SwitchField
        label="Enable Feature"
        checked={true}
        onChange={handleChange}
      />
    );

    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);

    expect(handleChange).toHaveBeenCalledWith(false);
  });

  it("renders description if provided", () => {
    render(
      <SwitchField
        label="Enable Feature"
        checked={false}
        onChange={() => {}}
        description="Toggle this to enable the feature"
      />
    );

    expect(
      screen.getByText("Toggle this to enable the feature")
    ).toBeInTheDocument();
  });

  it("does not render description if not provided", () => {
    render(
      <SwitchField label="Enable Feature" checked={false} onChange={() => {}} />
    );

    // Only label should be present
    const header = screen.getByText("Enable Feature").closest(".settings-field-header");
    expect(header?.querySelectorAll(".settings-field-description")).toHaveLength(0);
  });

  it("has switch-specific css classes", () => {
    render(
      <SwitchField label="Enable Feature" checked={false} onChange={() => {}} />
    );

    const container = screen
      .getByText("Enable Feature")
      .closest(".settings-field-switch");
    expect(container).toBeInTheDocument();
    expect(container?.querySelector(".switch")).toBeInTheDocument();
    expect(container?.querySelector(".switch-slider")).toBeInTheDocument();
  });
});
