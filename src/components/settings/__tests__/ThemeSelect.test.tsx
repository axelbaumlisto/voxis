/**
 * Smoke tests for the ThemeSelect dropdown (post swatch-grid removal).
 *
 * Covers:
 *  - Select dropdown renders with all options.
 *  - Changing the dropdown fires onChange with the new value.
 *  - The selected value is reflected in the dropdown.
 */
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import ThemeSelect from "../ThemeSelect";

// Stub the theme-list hook to avoid Tauri command round-trip.
vi.mock("../../../hooks/useVisualizationThemes", () => ({
  useVisualizationThemes: () => ({
    options: [
      { value: "winamp_classic", label: "Winamp Classic" },
      { value: "drifting_contour", label: "Drifting Contour" },
      { value: "neon", label: "Neon" },
    ],
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}));

// i18n shim: just echo the key.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock("../../../lib/commands", () => ({
  previewVisualizationTheme: vi.fn().mockResolvedValue(undefined),
}));

describe("ThemeSelect (dropdown)", () => {
  it("renders a select dropdown with one option per theme", () => {
    const { getByLabelText } = render(
      <ThemeSelect label="Theme" value="winamp_classic" onChange={() => {}} />,
    );
    const select = getByLabelText("Theme") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(["winamp_classic", "drifting_contour", "neon"]);
  });

  it("changing the dropdown fires onChange with the new value", () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(
      <ThemeSelect label="Theme" value="winamp_classic" onChange={onChange} />,
    );
    const select = getByLabelText("Theme");
    fireEvent.change(select, { target: { value: "neon" } });
    expect(onChange).toHaveBeenCalledWith("neon");
  });

  it("reflects the selected value in the dropdown", () => {
    const { getByLabelText } = render(
      <ThemeSelect label="Theme" value="neon" onChange={() => {}} />,
    );
    const select = getByLabelText("Theme") as HTMLSelectElement;
    expect(select.value).toBe("neon");
  });

  it("renders Preview and Reload + Preview buttons", () => {
    const { getByText } = render(
      <ThemeSelect label="Theme" value="winamp_classic" onChange={() => {}} />,
    );
    expect(getByText("settings.preview")).toBeInTheDocument();
    expect(getByText("Reload + Preview")).toBeInTheDocument();
  });

  it("FieldWrapper label resolves to the select (no dangling htmlFor)", () => {
    const { container } = render(
      <ThemeSelect label="Theme" value="neon" onChange={() => {}} />,
    );
    const label = container.querySelector("label.settings-field-label[for]");
    const forId = label?.getAttribute("for");
    expect(forId).toBeTruthy();
    const target = container.querySelector(`#${CSS.escape(forId!)}`);
    expect(target).not.toBeNull();
    expect(target?.tagName).toBe("SELECT");
  });
});
