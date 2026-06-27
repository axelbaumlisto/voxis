import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import HistoryPage from "../HistoryPage";
import { mockInvoke, mockHistoryEntries } from "../../test/mocks/tauri";

describe("HistoryPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders page title", async () => {
    render(<HistoryPage />);

    await waitFor(() => {
      expect(screen.getByText("History")).toBeInTheDocument();
    });
  });

  it("shows loading state initially", async () => {
    // Use a slow mock to catch loading state
    mockInvoke.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([]), 100))
    );

    render(<HistoryPage />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    // Wait for the component to finish loading to avoid act() warning
    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });
  });

  it("loads and displays history entries", async () => {
    render(<HistoryPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    // Should show entries
    expect(
      screen.getByText("Hello, this is a test transcription.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Привет, это тестовая транскрипция.")
    ).toBeInTheDocument();
  });

  it("shows entry count", async () => {
    render(<HistoryPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    expect(screen.getByText(/2 entries/)).toBeInTheDocument();
  });

  it("filters entries by search query", async () => {
    render(<HistoryPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: "test" } });

    // English entry should be visible (contains "test")
    expect(
      screen.getByText("Hello, this is a test transcription.")
    ).toBeInTheDocument();

    // Search for something not matching
    fireEvent.change(searchInput, { target: { value: "xyz123" } });

    // No entries should match - shows empty state
    await waitFor(() => {
      expect(screen.getByText("No transcriptions yet.")).toBeInTheDocument();
    });
  });

  it("copies entry to clipboard", async () => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText");

    render(<HistoryPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    const copyButtons = screen.getAllByRole("button", { name: /copy/i });
    fireEvent.click(copyButtons[0]);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        "Hello, this is a test transcription."
      );
    });
  });

  it("shows copied toast after copying", async () => {
    render(<HistoryPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    const copyButtons = screen.getAllByRole("button", { name: /copy/i });
    fireEvent.click(copyButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("Copied!")).toBeInTheDocument();
    });
  });

  it("clears all history after confirmation", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<HistoryPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    const clearButton = screen.getByRole("button", { name: /clear/i });
    fireEvent.click(clearButton);

    expect(confirmSpy).toHaveBeenCalled();

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("clear_history");
    });
  });

  it("does not clear history if confirmation is cancelled", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<HistoryPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    const clearButton = screen.getByRole("button", { name: /clear/i });
    fireEvent.click(clearButton);

    // Should not have called clear_history
    expect(mockInvoke).not.toHaveBeenCalledWith("clear_history");
  });

  it("disables clear button when history is empty", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_history") return [];
      if (cmd === "get_failed_transcriptions") return [];
      return undefined;
    });

    render(<HistoryPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    const clearButton = screen.getByRole("button", { name: /clear/i });
    expect(clearButton).toBeDisabled();
  });

  it("shows empty state when no history", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_history") return [];
      if (cmd === "get_failed_transcriptions") return [];
      return undefined;
    });

    render(<HistoryPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    expect(screen.getByText("No transcriptions yet.")).toBeInTheDocument();
  });

  it("reloads history when refresh button is clicked", async () => {
    render(<HistoryPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    const initialCallCount = mockInvoke.mock.calls.filter(
      (c) => c[0] === "get_history"
    ).length;

    const refreshButton = screen.getByRole("button", { name: /refresh/i });
    fireEvent.click(refreshButton);

    await waitFor(() => {
      const finalCallCount = mockInvoke.mock.calls.filter(
        (c) => c[0] === "get_history"
      ).length;
      expect(finalCallCount).toBe(initialCallCount + 1);
    });
  });

  it("shows error state when history fails to load", async () => {
    mockInvoke.mockRejectedValue(new Error("Database error"));

    render(<HistoryPage />);

    await waitFor(() => {
      expect(screen.getByText(/error/i)).toBeInTheDocument();
    });
  });
});
