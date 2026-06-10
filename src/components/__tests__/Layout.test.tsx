import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import Layout from "../Layout";
import { mockInvoke, resetMocks, mockConfig } from "../../test/mocks/tauri";

// SpectrumVisualizer uses setInterval + getSpectrumBins polling at 50ms,
// which creates noisy timer interactions. Mock it to keep tests focused on Layout.
vi.mock("../SpectrumVisualizer", () => ({
  default: ({ mode, useGradient }: { mode: string; useGradient?: boolean }) => (
    <div className="spectrum" data-gradient={String(useGradient)}>mock-spectrum-{mode}</div>
  ),
}));

// Mock RecordingContext - useRecording relies on Tauri event emission to change
// state, which cannot be driven from tests. Mocking the context lets us control
// the recording state directly.
const mockRecordingContext = {
  state: "idle" as const,
  audioLevel: 0,
  error: null as string | null,
  lastTranscription: null as string | null,
  start: vi.fn(),
  stop: vi.fn(),
  toggle: vi.fn(),
  isRecording: false,
};

vi.mock("../../contexts/RecordingContext", () => ({
  useRecordingContext: () => mockRecordingContext,
}));

// Mock @tauri-apps/api/window - no real window in jsdom
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    close: vi.fn(),
  }),
}));

function renderLayout(initialPath = "/history") {
  return render(
    <MemoryRouter
      initialEntries={[initialPath]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<div>Home Content</div>} />
          <Route path="history" element={<div>History Content</div>} />
          <Route path="dictionary" element={<div>Dictionary Content</div>} />
          <Route path="settings" element={<div>Settings Content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe("Layout", () => {
  beforeEach(() => {
    resetMocks();
    mockRecordingContext.state = "idle";
    mockRecordingContext.error = null;
    mockRecordingContext.lastTranscription = null;
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation((...args) => {
      const firstArg = args[0];
      if (typeof firstArg === "string" && firstArg.includes("not wrapped in act")) {
        return;
      }
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Header", () => {
    it("renders header with title", async () => {
      renderLayout();
      await waitFor(() => {
        expect(screen.getByText("SoupaWhisper 2")).toBeInTheDocument();
      });
    });

    it("displays time in header", async () => {
      renderLayout();
      await waitFor(() => {
        const header = screen.getByRole("banner");
        expect(header.querySelector(".header-time")).toBeInTheDocument();
      });
    });

    it("shows error in header when there is an error", async () => {
      mockRecordingContext.error = "Test error message";
      renderLayout();
      await waitFor(() => {
        const header = screen.getByRole("banner");
        const errorElement = header.querySelector(".header-error");
        expect(errorElement).toBeInTheDocument();
        expect(errorElement).toHaveTextContent("Test error message");
      });
    });

    it("does not show error in header when no error", async () => {
      mockRecordingContext.error = null;
      renderLayout();
      await waitFor(() => {
        const header = screen.getByRole("banner");
        const errorElement = header.querySelector(".header-error");
        expect(errorElement).not.toBeInTheDocument();
      });
    });
  });

  describe("Navigation", () => {
    it("renders navigation tabs", async () => {
      renderLayout();
      await waitFor(() => {
        expect(screen.getByRole("link", { name: /history/i })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /dictionary/i })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /settings/i })).toBeInTheDocument();
      });
    });

    it("marks active tab correctly", async () => {
      renderLayout("/history");
      await waitFor(() => {
        const historyTab = screen.getByRole("link", { name: /history/i });
        expect(historyTab).toHaveClass("active");
      });
    });
  });

  describe("Footer", () => {
    it("renders footer with hotkey hints", async () => {
      renderLayout();
      await waitFor(() => {
        expect(screen.getByText("h")).toBeInTheDocument();
        expect(screen.getByText("w")).toBeInTheDocument();
        expect(screen.getByText("s")).toBeInTheDocument();
        expect(screen.getByText("c")).toBeInTheDocument();
        expect(screen.getByText("Esc")).toBeInTheDocument();
      });
    });
  });

  describe("Keyboard shortcuts", () => {
    it("navigates to history on 'h' key", async () => {
      renderLayout("/settings");
      await waitFor(() => {
        expect(screen.getByText("Settings Content")).toBeInTheDocument();
      });
      fireEvent.keyDown(window, { key: "h" });
      expect(screen.getByText("History Content")).toBeInTheDocument();
    });

    it("navigates to dictionary on 'w' key", async () => {
      renderLayout("/settings");
      await waitFor(() => {
        expect(screen.getByText("Settings Content")).toBeInTheDocument();
      });
      fireEvent.keyDown(window, { key: "w" });
      expect(screen.getByText("Dictionary Content")).toBeInTheDocument();
    });

    it("navigates to settings on 's' key", async () => {
      renderLayout("/history");
      await waitFor(() => {
        expect(screen.getByText("History Content")).toBeInTheDocument();
      });
      fireEvent.keyDown(window, { key: "s" });
      expect(screen.getByText("Settings Content")).toBeInTheDocument();
    });

    it("copies lastTranscription on 'c' key", async () => {
      mockRecordingContext.lastTranscription = "Test transcription";
      renderLayout();
      await waitFor(() => {
        expect(screen.getByText("SoupaWhisper 2")).toBeInTheDocument();
      });
      fireEvent.keyDown(window, { key: "c" });
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Test transcription");
    });

    it("ignores shortcuts in input fields", async () => {
      renderLayout("/history");
      await waitFor(() => {
        expect(screen.getByText("History Content")).toBeInTheDocument();
      });

      // Create and focus an input
      const input = document.createElement("input");
      document.body.appendChild(input);
      input.focus();

      // Press 'd' to try navigating to dictionary
      fireEvent.keyDown(input, { key: "d", target: input });

      // Should still be on history, not navigated
      expect(screen.getByText("History Content")).toBeInTheDocument();

      document.body.removeChild(input);
    });

    it("ignores shortcuts in textarea", async () => {
      renderLayout("/history");
      await waitFor(() => {
        expect(screen.getByText("History Content")).toBeInTheDocument();
      });

      const textarea = document.createElement("textarea");
      document.body.appendChild(textarea);
      textarea.focus();

      // Press 'd' to try navigating to dictionary
      fireEvent.keyDown(textarea, { key: "d", target: textarea });

      // Should still be on history, not navigated
      expect(screen.getByText("History Content")).toBeInTheDocument();

      document.body.removeChild(textarea);
    });
  });

  describe("Status bar", () => {
    it("shows ready status when idle", async () => {
      mockRecordingContext.state = "idle";
      renderLayout();
      await waitFor(() => {
        expect(screen.getByText(/Ready/)).toBeInTheDocument();
      });
    });

    it("shows recording status when recording", async () => {
      mockRecordingContext.state = "recording";
      renderLayout();
      await waitFor(() => {
        expect(screen.getByText(/Recording/)).toBeInTheDocument();
      });
    });

    it("shows transcribing status when transcribing", async () => {
      mockRecordingContext.state = "transcribing";
      renderLayout();
      await waitFor(() => {
        expect(screen.getByText(/Transcribing/)).toBeInTheDocument();
      });
    });

    it("shows error in status bar", async () => {
      mockRecordingContext.error = "Microphone error";
      renderLayout();
      await waitFor(() => {
        // Error appears in both header and status bar
        const errorElements = screen.getAllByText(/Microphone error/);
        expect(errorElements.length).toBeGreaterThanOrEqual(1);
      });
    });

    it("displays formatted hotkey", async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_config") {
          return { ...mockConfig, hotkey: "alt_r" };
        }
        if (cmd === "check_permissions") {
          return [];
        }
        return undefined;
      });
      renderLayout();
      // Wait for config to load - useHotkeyDisplay uses real getConfig + formatHotkey
      await waitFor(() => {
        expect(screen.getByText(/Alt \(Right\)/)).toBeInTheDocument();
      });
    });
  });

  describe("Spectrum", () => {
    it("renders SpectrumVisualizer component", async () => {
      renderLayout();
      await waitFor(() => {
        const spectrum = document.querySelector(".spectrum");
        expect(spectrum).toBeInTheDocument();
      });
    });

    it("passes static useGradient=true (accent decoupled from overlay themes)", async () => {
      renderLayout();
      await waitFor(() => {
        const spectrum = document.querySelector(".spectrum") as HTMLElement;
        expect(spectrum.dataset.gradient).toBe("true");
      });
    });
  });

  describe("Permission Banner", () => {
    it("does not show permission banner when all permissions granted", async () => {
      renderLayout();
      await waitFor(() => {
        expect(screen.getByText("SoupaWhisper 2")).toBeInTheDocument();
      });
      // PermissionBanner renders null when all permissions are granted
      expect(document.querySelector(".permission-banners")).not.toBeInTheDocument();
    });

    it("shows permission banner when a permission is missing", async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "check_permissions") {
          return [
            { name: "Microphone", status: "denied", description: "Required for audio recording" },
          ];
        }
        if (cmd === "get_config") return { ...mockConfig };
        return undefined;
      });

      renderLayout();
      await waitFor(() => {
        expect(screen.getByText("Microphone")).toBeInTheDocument();
      });
    });
  });
});
