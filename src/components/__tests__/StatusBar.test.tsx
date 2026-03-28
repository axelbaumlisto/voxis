import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import StatusBar from "../StatusBar";
import { mockInvoke, mockConfig } from "../../test/mocks/tauri";

// Mock useRecording hook
vi.mock("../../hooks/useRecording", () => ({
  useRecording: vi.fn(() => ({
    state: "idle",
    error: null,
  })),
}));

import { useRecording } from "../../hooks/useRecording";

const mockUseRecording = useRecording as ReturnType<typeof vi.fn>;

describe("StatusBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRecording.mockReturnValue({
      state: "idle",
      error: null,
    });
  });

  // ===========================================================================
  // Idle State Tests
  // ===========================================================================
  describe("idle state", () => {
    it("renders with Ready text", async () => {
      render(<StatusBar />);

      await waitFor(() => {
        expect(screen.getByText(/Ready/)).toBeInTheDocument();
      });
    });

    it("shows empty circle icon", async () => {
      render(<StatusBar />);

      await waitFor(() => {
        expect(screen.getByText(/\u25CB/)).toBeInTheDocument();
      });
    });

    it("has idle class", async () => {
      const { container } = render(<StatusBar />);

      await waitFor(() => {
        const statusBar = container.querySelector(".status-bar");
        expect(statusBar).toHaveClass("idle");
      });
    });

    it("shows hotkey prompt", async () => {
      render(<StatusBar />);

      await waitFor(() => {
        expect(screen.getByText(/Press.*to record/i)).toBeInTheDocument();
      });
    });
  });

  // ===========================================================================
  // Recording State Tests
  // ===========================================================================
  describe("recording state", () => {
    beforeEach(() => {
      mockUseRecording.mockReturnValue({
        state: "recording",
        error: null,
      });
    });

    it("renders with REC text", async () => {
      render(<StatusBar />);

      await waitFor(() => {
        expect(screen.getByText(/REC/)).toBeInTheDocument();
      });
    });

    it("shows filled circle icon", async () => {
      render(<StatusBar />);

      await waitFor(() => {
        expect(screen.getByText(/\u25CF/)).toBeInTheDocument();
      });
    });

    it("has recording class", async () => {
      const { container } = render(<StatusBar />);

      await waitFor(() => {
        const statusBar = container.querySelector(".status-bar");
        expect(statusBar).toHaveClass("recording");
      });
    });

    it("shows Recording message", async () => {
      render(<StatusBar />);

      await waitFor(() => {
        expect(screen.getByText(/Recording.../)).toBeInTheDocument();
      });
    });

    it("shows Release hotkey instruction", async () => {
      render(<StatusBar />);

      await waitFor(() => {
        expect(screen.getByText(/Release.*to stop/)).toBeInTheDocument();
      });
    });
  });

  // ===========================================================================
  // Transcribing State Tests
  // ===========================================================================
  describe("transcribing state", () => {
    beforeEach(() => {
      mockUseRecording.mockReturnValue({
        state: "transcribing",
        error: null,
      });
    });

    it("renders with Transcribing text", async () => {
      render(<StatusBar />);

      await waitFor(() => {
        expect(screen.getByText(/Transcribing/)).toBeInTheDocument();
      });
    });

    it("shows half circle icon", async () => {
      render(<StatusBar />);

      await waitFor(() => {
        expect(screen.getByText(/\u25D0/)).toBeInTheDocument();
      });
    });

    it("has transcribing class", async () => {
      const { container } = render(<StatusBar />);

      await waitFor(() => {
        const statusBar = container.querySelector(".status-bar");
        expect(statusBar).toHaveClass("transcribing");
      });
    });

    it("shows Please wait message", async () => {
      render(<StatusBar />);

      await waitFor(() => {
        expect(screen.getByText(/Please wait/)).toBeInTheDocument();
      });
    });
  });

  // ===========================================================================
  // Error State Tests
  // ===========================================================================
  describe("error state", () => {
    beforeEach(() => {
      mockUseRecording.mockReturnValue({
        state: "idle",
        error: "Connection failed",
      });
    });

    it("renders with error message", async () => {
      render(<StatusBar />);

      await waitFor(() => {
        expect(screen.getByText(/Connection failed/)).toBeInTheDocument();
      });
    });

    it("shows exclamation icon", async () => {
      render(<StatusBar />);

      await waitFor(() => {
        expect(screen.getByText(/!/)).toBeInTheDocument();
      });
    });

    it("has error class", async () => {
      const { container } = render(<StatusBar />);

      await waitFor(() => {
        const statusBar = container.querySelector(".status-bar");
        expect(statusBar).toHaveClass("error");
      });
    });

    it("error takes precedence over state", async () => {
      mockUseRecording.mockReturnValue({
        state: "recording",
        error: "Audio error",
      });

      const { container } = render(<StatusBar />);

      await waitFor(() => {
        const statusBar = container.querySelector(".status-bar");
        expect(statusBar).toHaveClass("error");
        expect(screen.getByText(/Audio error/)).toBeInTheDocument();
      });
    });
  });

  // ===========================================================================
  // Hotkey Display Tests
  // ===========================================================================
  describe("hotkey display", () => {
    it("uses prop hotkey when provided", async () => {
      render(<StatusBar hotkey="F12" />);

      await waitFor(() => {
        expect(screen.getByText(/F12/)).toBeInTheDocument();
      });
    });

    it("loads hotkey from config when not provided", async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_config") {
          return { ...mockConfig, hotkey: "alt_r" };
        }
        return undefined;
      });

      render(<StatusBar />);

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("get_config");
      });
    });

    it("formats hotkey with correct capitalization", async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_config") {
          return { ...mockConfig, hotkey: "ctrl_r" };
        }
        return undefined;
      });

      render(<StatusBar />);

      await waitFor(() => {
        expect(screen.getByText(/Ctrl/)).toBeInTheDocument();
      });
    });
  });

  // ===========================================================================
  // Structure Tests
  // ===========================================================================
  describe("structure", () => {
    it("renders status-bar div", () => {
      const { container } = render(<StatusBar hotkey="Ctrl+R" />);
      expect(container.querySelector(".status-bar")).toBeInTheDocument();
    });

    it("renders span with content", () => {
      const { container } = render(<StatusBar hotkey="Ctrl+R" />);
      expect(container.querySelector(".status-bar span")).toBeInTheDocument();
    });

    it("contains both icon and text", async () => {
      render(<StatusBar hotkey="Ctrl+R" />);

      await waitFor(() => {
        const content = screen.getByText(/Ready/).closest("span");
        expect(content?.textContent).toMatch(/[\u25CB\u25CF\u25D0!]/);
        expect(content?.textContent).toMatch(/Ready/);
      });
    });
  });
});
