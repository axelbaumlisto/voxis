/**
 * Smoke tests for the ThemeSelect swatch grid (Phase 6).
 *
 * Covers:
 *  - Grid renders one swatch per option.
 *  - Bars-family theme renders a `theme-swatch--bars` swatch.
 *  - Organic_ring-family theme renders a `theme-swatch--ring` swatch.
 *  - Clicking a swatch button fires `onChange` with its theme id.
 *  - Selected swatch carries `aria-checked="true"`.
 */
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import ThemeSelect from "../ThemeSelect";

// Stub the theme-list hook to avoid Tauri command round-trip; we control
// the dropdown options directly.
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

describe("ThemeSelect (swatch grid)", () => {
  it("renders one swatch row per theme option", () => {
    const { getByTestId } = render(
      <ThemeSelect label="Theme" value="winamp_classic" onChange={() => {}} />,
    );
    expect(getByTestId("theme-swatch-winamp_classic")).toBeInTheDocument();
    expect(getByTestId("theme-swatch-drifting_contour")).toBeInTheDocument();
    expect(getByTestId("theme-swatch-neon")).toBeInTheDocument();
  });

  it("renders a bars swatch (class theme-swatch--bars) for bars family", () => {
    const { getByTestId } = render(
      <ThemeSelect label="Theme" value="winamp_classic" onChange={() => {}} />,
    );
    const swatch = getByTestId("theme-swatch-winamp_classic");
    expect(swatch.className).toContain("theme-swatch--bars");
  });

  it("renders a ring swatch for organic_ring family", () => {
    const { getByTestId } = render(
      <ThemeSelect label="Theme" value="winamp_classic" onChange={() => {}} />,
    );
    const swatch = getByTestId("theme-swatch-drifting_contour");
    expect(swatch.className).toContain("theme-swatch--ring");
  });

  it("clicking a swatch row calls onChange with its theme id", () => {
    const onChange = vi.fn();
    const { getByTestId } = render(
      <ThemeSelect label="Theme" value="winamp_classic" onChange={onChange} />,
    );
    const swatch = getByTestId("theme-swatch-neon");
    fireEvent.click(swatch.closest("button")!);
    expect(onChange).toHaveBeenCalledWith("neon");
  });

  it("selected swatch row carries aria-checked=true", () => {
    const { getByTestId } = render(
      <ThemeSelect label="Theme" value="neon" onChange={() => {}} />,
    );
    const swatch = getByTestId("theme-swatch-neon");
    const row = swatch.closest("button")!;
    expect(row.getAttribute("aria-checked")).toBe("true");

    const otherSwatch = getByTestId("theme-swatch-winamp_classic");
    const otherRow = otherSwatch.closest("button")!;
    expect(otherRow.getAttribute("aria-checked")).toBe("false");
  });
});
