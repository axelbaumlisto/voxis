import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  renderBuiltinField,
  renderCustomWidget,
  FieldProps,
} from "../settingsRenderers";

type CustomProps = Parameters<typeof renderCustomWidget>[1];

// Mock the built-in field components so we can assert on the coerced props
// they receive (ported from the deleted registry test safety net).
vi.mock("../../components/settings/SelectField", () => ({
  default: ({ label, value }: { label: string; value: string }) => (
    <div data-testid="select-field" data-label={label} data-value={value}>
      SelectField
    </div>
  ),
}));

vi.mock("../../components/settings/SwitchField", () => ({
  default: ({ label, checked }: { label: string; checked: boolean }) => (
    <div
      data-testid="switch-field"
      data-label={label}
      data-checked={String(checked)}
    >
      SwitchField
    </div>
  ),
}));

vi.mock("../../components/settings/InputField", () => ({
  default: ({ label, value }: { label: string; value: string }) => (
    <div data-testid="input-field" data-label={label} data-value={value}>
      InputField
    </div>
  ),
}));

vi.mock("../../components/settings/PasswordField", () => ({
  default: ({ label, value }: { label: string; value: string }) => (
    <div data-testid="password-field" data-label={label} data-value={value}>
      PasswordField
    </div>
  ),
}));

describe("renderBuiltinField", () => {
  const baseProps: FieldProps = {
    label: "Test Label",
    value: "test-value",
    onChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- type -> component mapping ---

  it("renders select field", () => {
    render(
      <>
        {renderBuiltinField("select", {
          ...baseProps,
          options: [{ value: "a", label: "A" }],
        })}
      </>
    );
    expect(screen.getByTestId("select-field")).toBeInTheDocument();
  });

  it("renders switch field", () => {
    render(<>{renderBuiltinField("switch", { ...baseProps, value: true })}</>);
    const field = screen.getByTestId("switch-field");
    expect(field).toBeInTheDocument();
    expect(field.dataset.checked).toBe("true");
  });

  it("renders switch field with false value", () => {
    render(<>{renderBuiltinField("switch", { ...baseProps, value: false })}</>);
    expect(screen.getByTestId("switch-field").dataset.checked).toBe("false");
  });

  it("renders input field", () => {
    render(<>{renderBuiltinField("input", baseProps)}</>);
    expect(screen.getByTestId("input-field")).toBeInTheDocument();
  });

  it("renders password field", () => {
    render(<>{renderBuiltinField("password", baseProps)}</>);
    expect(screen.getByTestId("password-field")).toBeInTheDocument();
  });

  it("renders hotkey field (uses select)", () => {
    render(
      <>
        {renderBuiltinField("hotkey", {
          ...baseProps,
          options: [{ value: "ctrl+r", label: "Ctrl+R" }],
        })}
      </>
    );
    expect(screen.getByTestId("select-field")).toBeInTheDocument();
  });

  it("returns null for the custom widget type", () => {
    expect(renderBuiltinField("custom", baseProps)).toBeNull();
  });

  // --- value coercion ---

  it("converts numeric value to string for select", () => {
    render(
      <>
        {renderBuiltinField("select", {
          ...baseProps,
          value: 123,
          options: [{ value: "123", label: "123" }],
        })}
      </>
    );
    expect(screen.getByTestId("select-field").dataset.value).toBe("123");
  });

  it("handles null value gracefully (-> \"\")", () => {
    render(<>{renderBuiltinField("input", { ...baseProps, value: null })}</>);
    expect(screen.getByTestId("input-field").dataset.value).toBe("");
  });

  it("handles undefined value gracefully (-> \"\")", () => {
    render(
      <>{renderBuiltinField("input", { ...baseProps, value: undefined })}</>
    );
    expect(screen.getByTestId("input-field").dataset.value).toBe("");
  });

  it("coerces truthy value to true for switch", () => {
    render(<>{renderBuiltinField("switch", { ...baseProps, value: 1 })}</>);
    expect(screen.getByTestId("switch-field").dataset.checked).toBe("true");
  });

  it("coerces falsy value to false for switch", () => {
    render(<>{renderBuiltinField("switch", { ...baseProps, value: 0 })}</>);
    expect(screen.getByTestId("switch-field").dataset.checked).toBe("false");
  });

  it("handles empty string value", () => {
    render(
      <>
        {renderBuiltinField("input", {
          label: "Test",
          value: "",
          onChange: vi.fn(),
        })}
      </>
    );
    expect(screen.getByTestId("input-field").dataset.value).toBe("");
  });

  it("keeps numeric string value as-is", () => {
    render(
      <>
        {renderBuiltinField("input", {
          label: "Test",
          value: "123",
          onChange: vi.fn(),
        })}
      </>
    );
    expect(screen.getByTestId("input-field").dataset.value).toBe("123");
  });
});

describe("renderCustomWidget", () => {
  it("returns null for an unknown widget name", () => {
    const result = renderCustomWidget("unknown", {} as CustomProps);
    expect(result).toBeNull();
  });

  it("renders a known widget (returns an element)", () => {
    const result = renderCustomWidget("shortcut-binding-list", {
      label: "Test",
    } as CustomProps);
    expect(result).not.toBeNull();
  });
});
