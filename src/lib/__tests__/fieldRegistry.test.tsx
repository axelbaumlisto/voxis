import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  registerField,
  hasField,
  renderField,
  FieldProps,
} from "../fieldRegistry";

// Mock the field components
vi.mock("../../components/settings/SelectField", () => ({
  default: ({ label, value }: { label: string; value: string }) => (
    <div data-testid="select-field" data-label={label} data-value={value}>
      SelectField
    </div>
  ),
}));

vi.mock("../../components/settings/SwitchField", () => ({
  default: ({
    label,
    checked,
  }: {
    label: string;
    checked: boolean;
  }) => (
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

describe("fieldRegistry", () => {
  describe("registerField", () => {
    it("registers a new field type", () => {
      const CustomField = () => <div>Custom</div>;
      registerField("custom", CustomField);
      expect(hasField("custom")).toBe(true);
    });

    it("overwrites existing field type", () => {
      const Field1 = () => <div>Field1</div>;
      const Field2 = () => <div>Field2</div>;

      registerField("overwrite-test", Field1);
      registerField("overwrite-test", Field2);

      expect(hasField("overwrite-test")).toBe(true);
    });
  });

  describe("hasField", () => {
    it("returns true for registered fields", () => {
      // Built-in fields registered on module load
      expect(hasField("select")).toBe(true);
      expect(hasField("switch")).toBe(true);
      expect(hasField("input")).toBe(true);
      expect(hasField("password")).toBe(true);
      expect(hasField("hotkey")).toBe(true);
    });

    it("returns false for unregistered fields", () => {
      expect(hasField("nonexistent")).toBe(false);
      expect(hasField("")).toBe(false);
    });
  });

  describe("renderField", () => {
    const baseProps: FieldProps = {
      label: "Test Label",
      value: "test-value",
      onChange: vi.fn(),
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("renders select field", () => {
      const result = renderField("select", {
        ...baseProps,
        options: [{ value: "a", label: "A" }],
      });

      render(<>{result}</>);
      expect(screen.getByTestId("select-field")).toBeInTheDocument();
    });

    it("renders switch field", () => {
      const result = renderField("switch", {
        ...baseProps,
        value: true,
      });

      render(<>{result}</>);
      const field = screen.getByTestId("switch-field");
      expect(field).toBeInTheDocument();
      expect(field.dataset.checked).toBe("true");
    });

    it("renders switch field with false value", () => {
      const result = renderField("switch", {
        ...baseProps,
        value: false,
      });

      render(<>{result}</>);
      const field = screen.getByTestId("switch-field");
      expect(field.dataset.checked).toBe("false");
    });

    it("renders input field", () => {
      const result = renderField("input", baseProps);

      render(<>{result}</>);
      expect(screen.getByTestId("input-field")).toBeInTheDocument();
    });

    it("renders password field", () => {
      const result = renderField("password", baseProps);

      render(<>{result}</>);
      expect(screen.getByTestId("password-field")).toBeInTheDocument();
    });

    it("renders hotkey field (uses select)", () => {
      const result = renderField("hotkey", {
        ...baseProps,
        options: [{ value: "ctrl+r", label: "Ctrl+R" }],
      });

      render(<>{result}</>);
      expect(screen.getByTestId("select-field")).toBeInTheDocument();
    });

    it("returns null for unregistered type", () => {
      const result = renderField("nonexistent", baseProps);
      expect(result).toBeNull();
    });

    it("converts string value to string for select", () => {
      const result = renderField("select", {
        ...baseProps,
        value: 123,
        options: [{ value: "123", label: "123" }],
      });

      render(<>{result}</>);
      const field = screen.getByTestId("select-field");
      expect(field.dataset.value).toBe("123");
    });

    it("handles null value gracefully", () => {
      const result = renderField("input", {
        ...baseProps,
        value: null,
      });

      render(<>{result}</>);
      const field = screen.getByTestId("input-field");
      expect(field.dataset.value).toBe("");
    });

    it("handles undefined value gracefully", () => {
      const result = renderField("input", {
        ...baseProps,
        value: undefined,
      });

      render(<>{result}</>);
      const field = screen.getByTestId("input-field");
      expect(field.dataset.value).toBe("");
    });

    it("coerces boolean to boolean for switch", () => {
      // Truthy value
      const result1 = renderField("switch", {
        ...baseProps,
        value: 1,
      });
      render(<>{result1}</>);
      expect(screen.getByTestId("switch-field").dataset.checked).toBe("true");
    });

    it("coerces falsy value to false for switch", () => {
      const result = renderField("switch", {
        ...baseProps,
        value: 0,
      });
      render(<>{result}</>);
      expect(screen.getByTestId("switch-field").dataset.checked).toBe("false");
    });
  });

  describe("edge cases", () => {
    it("handles empty string value", () => {
      const result = renderField("input", {
        label: "Test",
        value: "",
        onChange: vi.fn(),
      });

      render(<>{result}</>);
      expect(screen.getByTestId("input-field").dataset.value).toBe("");
    });

    it("handles numeric string value", () => {
      const result = renderField("input", {
        label: "Test",
        value: "123",
        onChange: vi.fn(),
      });

      render(<>{result}</>);
      expect(screen.getByTestId("input-field").dataset.value).toBe("123");
    });
  });
});
