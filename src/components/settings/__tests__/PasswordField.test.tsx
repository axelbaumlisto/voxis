import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PasswordField from "../PasswordField";

describe("PasswordField", () => {
  it("renders label and input", () => {
    render(<PasswordField label="API Key" value="" onChange={() => {}} />);

    expect(screen.getByText("API Key")).toBeInTheDocument();
    // Password inputs have no role by default, use querySelector
    const input = document.querySelector("input");
    expect(input).toBeInTheDocument();
  });

  it("renders input with type password by default", () => {
    render(<PasswordField label="API Key" value="" onChange={() => {}} />);

    const input = document.querySelector("input");
    expect(input).toHaveAttribute("type", "password");
  });

  it("shows current value", () => {
    render(
      <PasswordField label="API Key" value="secret-key-123" onChange={() => {}} />
    );

    const input = document.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("secret-key-123");
  });

  it("calls onChange with new value", () => {
    const handleChange = vi.fn();
    render(<PasswordField label="API Key" value="" onChange={handleChange} />);

    const input = document.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "new-secret" } });

    expect(handleChange).toHaveBeenCalledWith("new-secret");
    expect(handleChange).toHaveBeenCalledTimes(1);
  });

  it("toggles visibility when Show button is clicked", () => {
    render(<PasswordField label="API Key" value="secret" onChange={() => {}} />);

    const input = document.querySelector("input") as HTMLInputElement;
    expect(input).toHaveAttribute("type", "password");

    // Click Show button
    const toggleButton = screen.getByRole("button", { name: "Show" });
    fireEvent.click(toggleButton);

    expect(input).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide" })).toBeInTheDocument();
  });

  it("toggles visibility back to password when Hide is clicked", () => {
    render(<PasswordField label="API Key" value="secret" onChange={() => {}} />);

    const input = document.querySelector("input") as HTMLInputElement;
    const toggleButton = screen.getByRole("button", { name: "Show" });

    // Show password
    fireEvent.click(toggleButton);
    expect(input).toHaveAttribute("type", "text");

    // Hide password again
    const hideButton = screen.getByRole("button", { name: "Hide" });
    fireEvent.click(hideButton);
    expect(input).toHaveAttribute("type", "password");
  });

  it("renders placeholder if provided", () => {
    render(
      <PasswordField
        label="API Key"
        value=""
        onChange={() => {}}
        placeholder="Enter your API key"
      />
    );

    const input = screen.getByPlaceholderText("Enter your API key");
    expect(input).toBeInTheDocument();
  });

  it("renders description if provided", () => {
    render(
      <PasswordField
        label="API Key"
        value=""
        onChange={() => {}}
        description="Your secret API key for authentication"
      />
    );

    expect(
      screen.getByText("Your secret API key for authentication")
    ).toBeInTheDocument();
  });

  it("does not render description if not provided", () => {
    render(<PasswordField label="API Key" value="" onChange={() => {}} />);

    expect(screen.queryByText(/authentication/i)).not.toBeInTheDocument();
  });

  it("has password-field-wrapper CSS class", () => {
    render(<PasswordField label="API Key" value="" onChange={() => {}} />);

    expect(document.querySelector(".password-field-wrapper")).toBeInTheDocument();
  });

  it("has password-toggle CSS class on toggle button", () => {
    render(<PasswordField label="API Key" value="" onChange={() => {}} />);

    expect(document.querySelector(".password-toggle")).toBeInTheDocument();
  });
});
