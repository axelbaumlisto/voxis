import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import InputField from "../InputField";

describe("InputField", () => {
  it("renders label and input", () => {
    render(<InputField label="Username" value="" onChange={() => {}} />);

    expect(screen.getByText("Username")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("associates the FieldWrapper label with its input (htmlFor === id)", () => {
    const { container } = render(
      <InputField label="Username" value="" onChange={() => {}} />
    );

    const label = container.querySelector(".settings-field-label");
    const input = screen.getByRole("textbox");
    const htmlFor = label?.getAttribute("for");

    expect(htmlFor).toBeTruthy();
    expect(input.getAttribute("id")).toBe(htmlFor);
  });

  it("shows current value", () => {
    render(<InputField label="Username" value="john_doe" onChange={() => {}} />);

    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("john_doe");
  });

  it("calls onChange with new value", () => {
    const handleChange = vi.fn();
    render(<InputField label="Username" value="" onChange={handleChange} />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "new_user" } });

    expect(handleChange).toHaveBeenCalledWith("new_user");
    expect(handleChange).toHaveBeenCalledTimes(1);
  });

  it("renders placeholder if provided", () => {
    render(
      <InputField
        label="Username"
        value=""
        onChange={() => {}}
        placeholder="Enter your username"
      />
    );

    const input = screen.getByPlaceholderText("Enter your username");
    expect(input).toBeInTheDocument();
  });

  it("renders description if provided", () => {
    render(
      <InputField
        label="Username"
        value=""
        onChange={() => {}}
        description="Your unique username"
      />
    );

    expect(screen.getByText("Your unique username")).toBeInTheDocument();
  });

  it("does not render description if not provided", () => {
    render(<InputField label="Username" value="" onChange={() => {}} />);

    expect(screen.queryByText(/unique/i)).not.toBeInTheDocument();
  });

  it("renders as text type by default", () => {
    render(<InputField label="Username" value="" onChange={() => {}} />);

    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("type", "text");
  });

  it("renders as number type when specified", () => {
    render(
      <InputField label="Age" value="25" onChange={() => {}} type="number" />
    );

    // Number inputs have role="spinbutton"
    const input = screen.getByRole("spinbutton");
    expect(input).toHaveAttribute("type", "number");
  });

  it("has correct css classes", () => {
    render(<InputField label="Username" value="" onChange={() => {}} />);

    const container = screen.getByText("Username").closest(".settings-field");
    expect(container).toBeInTheDocument();
    expect(
      container?.querySelector(".settings-field-input")
    ).toBeInTheDocument();
  });
});
