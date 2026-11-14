/**
 * Smoke tests for the ThemeSelect dropdown (post swatch-grid removal).
 *
 * Covers:
 *  - Select dropdown renders with all options.
 *  - Changing the dropdown fires onChange with the new value.
 *  - The selected value is reflected in the dropdown.
 *  - "Export to edit" calls the export command for the SELECTED theme, refreshes
 *    the theme list, shows the resulting folder, and leaves the selection alone;
 *    a failed export shows the backend's message (a plain string over IPC), and
 *    changing the selection clears the previous result.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import ThemeSelect from "../ThemeSelect";
import { exportBuiltinTheme } from "../../../lib/commands";

const reloadThemes = vi.fn().mockResolvedValue(undefined);

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
    reload: reloadThemes,
  }),
}));

// i18n shim: just echo the key.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock("../../../lib/commands", () => ({
  previewVisualizationTheme: vi.fn().mockResolvedValue(undefined),
  exportBuiltinTheme: vi.fn(),
}));

const EXPORTED_FOLDER = "/home/user/.config/voxis/themes/neon_custom";

describe("ThemeSelect (dropdown)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it("exports the selected theme to an editable copy and shows the folder", async () => {
    vi.mocked(exportBuiltinTheme).mockResolvedValue(EXPORTED_FOLDER);
    const onChange = vi.fn();
    render(<ThemeSelect label="Theme" value="neon" onChange={onChange} />);

    fireEvent.click(screen.getByTestId("theme-export-button"));

    await waitFor(() => {
      expect(screen.getByTestId("theme-export-result")).toHaveTextContent(
        EXPORTED_FOLDER,
      );
    });
    expect(exportBuiltinTheme).toHaveBeenCalledWith("neon");
    expect(reloadThemes).toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Theme") as HTMLSelectElement).value).toBe("neon");
    expect(screen.queryByTestId("theme-export-error")).toBeNull();
  });

  it("shows the backend error when the export fails", async () => {
    // Tauri v2 rejects a `Result<_, String>` command with the plain STRING, not
    // an Error — the message must reach the user as-is.
    vi.mocked(exportBuiltinTheme).mockRejectedValue(
      "unknown theme: 'neon' not found",
    );
    render(<ThemeSelect label="Theme" value="neon" onChange={() => {}} />);

    fireEvent.click(screen.getByTestId("theme-export-button"));

    await waitFor(() => {
      expect(screen.getByTestId("theme-export-error")).toHaveTextContent(
        "unknown theme: 'neon' not found",
      );
    });
    expect(screen.queryByTestId("theme-export-result")).toBeNull();
    expect(reloadThemes).not.toHaveBeenCalled();
  });

  it("clears the export result when the selection changes", async () => {
    vi.mocked(exportBuiltinTheme).mockResolvedValue(EXPORTED_FOLDER);
    render(<ThemeSelect label="Theme" value="neon" onChange={() => {}} />);
    fireEvent.click(screen.getByTestId("theme-export-button"));
    await waitFor(() => {
      expect(screen.getByTestId("theme-export-result")).toHaveTextContent(
        EXPORTED_FOLDER,
      );
    });

    fireEvent.change(screen.getByLabelText("Theme"), {
      target: { value: "drifting_contour" },
    });

    // The folder/error described the previous theme, so it must not linger.
    expect(screen.queryByTestId("theme-export-result")).toBeNull();
    expect(screen.queryByTestId("theme-export-error")).toBeNull();
  });
});
