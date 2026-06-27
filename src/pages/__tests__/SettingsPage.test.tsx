import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import SettingsPage from "../SettingsPage";
import { mockInvoke, mockConfig } from "../../test/mocks/tauri";

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders page title", async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Settings")[0]).toBeInTheDocument();
    });
  });

  it("shows loading state initially", async () => {
    // Use a slow mock to catch loading state
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_config") {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return mockConfig;
      }
      if (cmd === "list_audio_devices") return [];
      if (cmd === "get_llm_providers") return [];
      return undefined;
    });

    render(<SettingsPage />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    // Wait for the component to finish loading to avoid act() warning
    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });
  });

  it("loads and displays current config", async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    // Check that settings sections are rendered (use getAllByText for sections with duplicate names)
    expect(screen.getAllByText("Provider").length).toBeGreaterThan(0);
    expect(screen.getByText("Recording")).toBeInTheDocument();
    expect(screen.getByText("Output")).toBeInTheDocument();
  });

  it("renders all setting sections", async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    // Find sections by their heading
    const sections = ["Provider", "Recording", "Output", "Overlay", "LLM", "Advanced"];
    for (const section of sections) {
      // Section titles are h3 elements
      const sectionHeadings = screen.getAllByText(section);
      expect(sectionHeadings.length).toBeGreaterThan(0);
    }
  });

  it("shows save button disabled when no changes", async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    const saveButton = screen.getByRole("button", { name: /save/i });
    expect(saveButton).toBeDisabled();
  });

  it("enables save button when config is changed", async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    // Find the Language field by label, then get its select
    const languageLabel = screen.getByText("Language");
    const languageField = languageLabel.closest(".settings-field");
    const languageSelect = languageField?.querySelector("select") as HTMLSelectElement;

    expect(languageSelect).toBeInTheDocument();
    fireEvent.change(languageSelect, { target: { value: "ru" } });

    const saveButton = screen.getByRole("button", { name: /save/i });
    expect(saveButton).not.toBeDisabled();
  });

  it("calls save when save button is clicked", async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    // Change language setting
    const languageLabel = screen.getByText("Language");
    const languageField = languageLabel.closest(".settings-field");
    const languageSelect = languageField?.querySelector("select") as HTMLSelectElement;

    fireEvent.change(languageSelect, { target: { value: "ru" } });

    // Click save
    const saveButton = screen.getByRole("button", { name: /save/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("save_config", expect.anything());
    });
  });

  it("shows error state when config fails to load", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_config") throw new Error("Connection failed");
      if (cmd === "list_audio_devices") return [];
      if (cmd === "get_llm_providers") return [];
      if (cmd === "get_visualization_themes") return [];
      return undefined;
    });

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText(/Connection failed/i)).toBeInTheDocument();
    });
  });

  it("shows validation error from backend on save failure", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_config") return mockConfig;
      if (cmd === "save_config") throw new Error("Invalid API key format");
      if (cmd === "list_audio_devices") return [];
      if (cmd === "get_llm_providers") return [];
      return undefined;
    });

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    // Change something and save
    const languageLabel = screen.getByText("Language");
    const languageField = languageLabel.closest(".settings-field");
    const languageSelect = languageField?.querySelector("select") as HTMLSelectElement;

    fireEvent.change(languageSelect, { target: { value: "ru" } });

    const saveButton = screen.getByRole("button", { name: /save/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText("Invalid API key format")).toBeInTheDocument();
    });
  });

  it("surfaces an error hint when audio device enumeration fails", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_config") return mockConfig;
      if (cmd === "list_audio_devices") throw new Error("Permission denied");
      if (cmd === "get_llm_providers") return [];
      if (cmd === "get_visualization_themes") return [];
      return undefined;
    });

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    const alert = await screen.findByTestId("audio-device-error");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent(/audio devices/i);
  });

  it("updates nested config value (overlay.enabled)", async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    // Find the Overlay section and the Enabled switch
    // Section uses div.settings-section, not <section>
    const overlayHeading = screen.getAllByText("Overlay").find(
      (el) => el.classList.contains("settings-section-title")
    );
    const overlaySection = overlayHeading?.closest(".settings-section");
    const enabledSwitch = overlaySection?.querySelector(
      'input[type="checkbox"]'
    ) as HTMLInputElement;

    expect(enabledSwitch).not.toBeNull();

    // Toggle it
    fireEvent.click(enabledSwitch!);

    // Save button should be enabled now
    const saveButton = screen.getByRole("button", { name: /save/i });
    expect(saveButton).not.toBeDisabled();
  });

  it("shows saving state while saving", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_config") return mockConfig;
      if (cmd === "save_config") {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return undefined;
      }
      if (cmd === "list_audio_devices") return [];
      if (cmd === "get_llm_providers") return [];
      if (cmd === "get_visualization_themes") return [];
      return undefined;
    });

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    // Change something
    const languageLabel = screen.getByText("Language");
    const languageField = languageLabel.closest(".settings-field");
    const languageSelect = languageField?.querySelector("select") as HTMLSelectElement;

    fireEvent.change(languageSelect, { target: { value: "ru" } });

    // Click save
    const saveButton = screen.getByRole("button", { name: /save/i });
    fireEvent.click(saveButton);

    // Should show "Saving..."
    expect(screen.getByText("Saving...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByText("Saving...")).not.toBeInTheDocument();
    });
  });

  it("loads visualization themes from backend into the theme selector", async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    const themeSelect = screen.getByLabelText("Theme") as HTMLSelectElement;
    expect(themeSelect).toBeInTheDocument();

    await waitFor(() => {
      expect(within(themeSelect).getByRole("option", { name: "Living Reed" })).toBeInTheDocument();
      expect(within(themeSelect).getByRole("option", { name: "Custom Theme" })).toBeInTheDocument();
    });
  });

  it("shows a safe fallback theme option when backend theme list fails", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_config") return mockConfig;
      if (cmd === "list_audio_devices") return [];
      if (cmd === "get_llm_providers") return [];
      if (cmd === "get_visualization_themes") throw new Error("Theme backend unavailable");
      return undefined;
    });

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    const themeSelect = screen.getByLabelText("Theme") as HTMLSelectElement;
    expect(within(themeSelect).getByRole("option", { name: "Default" })).toBeInTheDocument();
    expect(screen.getByText(/Theme list unavailable/i)).toBeInTheDocument();
  });

  it("previews selected overlay theme without saving config", async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("preview_visualization_theme", {
        themeId: mockConfig.overlay.theme,
        reloadFromDisk: false,
      });
    });
  });

  it("reloads and previews selected overlay theme", async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Reload + Preview" }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("preview_visualization_theme", {
        themeId: mockConfig.overlay.theme,
        reloadFromDisk: true,
      });
    });
  });
});
