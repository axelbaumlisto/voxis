import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DictionaryPage from "../DictionaryPage";
import { mockInvoke, mockDictionaryEntries, mockConfig, resetMocks } from "../../test/mocks/tauri";

describe("DictionaryPage", () => {
  beforeEach(() => {
    resetMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("renders page title", async () => {
    render(<DictionaryPage />);

    await waitFor(() => {
      expect(screen.getByText("Dictionary")).toBeInTheDocument();
    });
  });

  it("shows loading state initially", async () => {
    // Use a slow mock to catch loading state
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_dictionary") {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return [];
      }
      if (cmd === "get_config") return mockConfig;
      if (cmd === "get_pending_suggestions") return [];
      return undefined;
    });

    render(<DictionaryPage />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    // Wait for the component to finish loading to avoid act() warning
    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });
  });

  it("loads and displays dictionary entries", async () => {
    render(<DictionaryPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    // Should show entries
    expect(screen.getByText("солид")).toBeInTheDocument();
    expect(screen.getByText("SOLID")).toBeInTheDocument();
    expect(screen.getByText("кисс")).toBeInTheDocument();
    expect(screen.getByText("KISS")).toBeInTheDocument();
  });

  it("shows entry count", async () => {
    render(<DictionaryPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    expect(screen.getByText(/3 entries/)).toBeInTheDocument();
  });

  it("shows add entry form", async () => {
    render(<DictionaryPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    expect(screen.getByText("Add New Entry")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/source word/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/replacement/i)).toBeInTheDocument();
  });

  it("adds new entry", async () => {
    render(<DictionaryPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    const sourceInput = screen.getByPlaceholderText(/source word/i);
    const replacementInput = screen.getByPlaceholderText(/replacement/i);

    fireEvent.change(sourceInput, { target: { value: "тдд" } });
    fireEvent.change(replacementInput, { target: { value: "TDD" } });

    // Submit the form directly instead of clicking button
    const form = sourceInput.closest("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("add_dictionary_entry", {
        source: "тдд",
        replacement: "TDD",
      });
    });
  });

  it("deletes entry after confirmation", { timeout: 15000 }, async () => {
    render(<DictionaryPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    // Find and click delete button for first entry ("солид" -> id 1)
    const deleteButtons = screen.getAllByRole("button", { name: /delete/i });
    expect(deleteButtons.length).toBeGreaterThan(0);
    fireEvent.click(deleteButtons[0]);

    await waitFor(
      () => {
        expect(mockInvoke).toHaveBeenCalledWith("delete_dictionary_entry", {
          id: 1,
        });
      },
      { timeout: 10000 }
    );
  });

  it("edits entry inline", async () => {
    render(<DictionaryPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    // Click edit on first entry
    const editButtons = screen.getAllByRole("button", { name: /edit/i });
    fireEvent.click(editButtons[0]);

    // Should show input fields with current values
    const sourceInput = screen.getByDisplayValue("солид");
    expect(sourceInput).toBeInTheDocument();

    // Modify and save
    fireEvent.change(sourceInput, { target: { value: "солидный" } });

    const saveButton = screen.getByRole("button", { name: /save/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("update_dictionary_entry", {
        id: 1,
        source: "солидный",
        replacement: "SOLID",
      });
    });
  });

  it("shows empty state when no entries", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_dictionary") return [];
      if (cmd === "get_config") return mockConfig;
      if (cmd === "get_pending_suggestions") return [];
      return undefined;
    });

    render(<DictionaryPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    expect(screen.getByText("No dictionary entries yet.")).toBeInTheDocument();
  });

  it("shows error state when dictionary fails to load", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_dictionary") throw new Error("Database error");
      if (cmd === "get_config") return mockConfig;
      if (cmd === "get_pending_suggestions") return [];
      return undefined;
    });

    render(<DictionaryPage />);

    await waitFor(() => {
      expect(screen.getByText(/error/i)).toBeInTheDocument();
    });
  });

  it("reloads dictionary after adding entry", async () => {
    render(<DictionaryPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    const initialLoadCount = mockInvoke.mock.calls.filter(
      (c) => c[0] === "get_dictionary"
    ).length;

    // Add entry
    const sourceInput = screen.getByPlaceholderText(/source word/i);
    const replacementInput = screen.getByPlaceholderText(/replacement/i);
    const addButton = screen.getByRole("button", { name: /^add$/i });

    fireEvent.change(sourceInput, { target: { value: "тдд" } });
    fireEvent.change(replacementInput, { target: { value: "TDD" } });
    fireEvent.click(addButton);

    await waitFor(() => {
      const finalLoadCount = mockInvoke.mock.calls.filter(
        (c) => c[0] === "get_dictionary"
      ).length;
      expect(finalLoadCount).toBeGreaterThan(initialLoadCount);
    });
  });

  it("validates duplicate source from backend", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_dictionary") return mockDictionaryEntries;
      if (cmd === "get_config") return mockConfig;
      if (cmd === "get_pending_suggestions") return [];
      if (cmd === "add_dictionary_entry") {
        throw new Error("Duplicate source word");
      }
      return undefined;
    });

    render(<DictionaryPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    // Try to add duplicate
    const sourceInput = screen.getByPlaceholderText(/source word/i);
    const replacementInput = screen.getByPlaceholderText(/replacement/i);
    const addButton = screen.getByRole("button", { name: /^add$/i });

    fireEvent.change(sourceInput, { target: { value: "солид" } });
    fireEvent.change(replacementInput, { target: { value: "SOLID2" } });
    fireEvent.click(addButton);

    // Wait for the error to be displayed - the hook catches it
    await waitFor(() => {
      expect(screen.getByText(/Duplicate source word/i)).toBeInTheDocument();
    });
  });

  it("shows the always-on hint that approved suggestions go to the dictionary", async () => {
    render(<DictionaryPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    expect(
      screen.getByText("Approved suggestions are added to the dictionary below.")
    ).toBeInTheDocument();
  });

  it("shows a status message after generating from history", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_dictionary") return mockDictionaryEntries;
      if (cmd === "get_config") return mockConfig;
      if (cmd === "get_pending_suggestions") return [];
      if (cmd === "reprocess_history_for_suggestions") {
        return {
          processed: 12,
          suggestions_found: 4,
          recorded: 4,
          promoted: 1,
          skipped: 7,
        };
      }
      return undefined;
    });

    render(<DictionaryPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Generate from History" }));

    await waitFor(() => {
      const status = screen.getByTestId("pending-status");
      expect(status).toHaveTextContent(/Scanned 12 entries/);
      expect(status).toHaveTextContent(/4 new suggestions/);
      expect(status).toHaveTextContent(/1 added to dictionary/);
      expect(status).toHaveTextContent(/7 skipped/);
    });
  });

  it("cancels edit mode when cancel is clicked", async () => {
    render(<DictionaryPage />);

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    // Click edit on first entry
    const editButtons = screen.getAllByRole("button", { name: /edit/i });
    fireEvent.click(editButtons[0]);

    // Should show cancel button
    const cancelButton = screen.getByRole("button", { name: /cancel/i });
    fireEvent.click(cancelButton);

    // Should show original values (not inputs)
    expect(screen.getByText("солид")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("солид")).not.toBeInTheDocument();
  });
});
