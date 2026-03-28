import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import HistoryEntry from "../HistoryEntry";
import type { HistoryEntry as HistoryEntryType } from "../../../lib/commands";

const mockEntry: HistoryEntryType = {
  id: 1,
  timestamp: "2024-01-15 10:30:00",
  text: "Hello, this is a test transcription.",
  language: "en",
  duration: 2.5,
};

describe("HistoryEntry", () => {
  it("renders timestamp and text", () => {
    render(<HistoryEntry entry={mockEntry} onCopy={() => {}} />);

    expect(
      screen.getByText("Hello, this is a test transcription.")
    ).toBeInTheDocument();
    // Timestamp is formatted with toLocaleString
    expect(screen.getByText(/2024/)).toBeInTheDocument();
  });

  it("renders language badge", () => {
    render(<HistoryEntry entry={mockEntry} onCopy={() => {}} />);

    expect(screen.getByText("en")).toBeInTheDocument();
  });

  it("renders duration", () => {
    render(<HistoryEntry entry={mockEntry} onCopy={() => {}} />);

    expect(screen.getByText("2.5s")).toBeInTheDocument();
  });

  it("calls onCopy when copy button is clicked", () => {
    const handleCopy = vi.fn();
    render(<HistoryEntry entry={mockEntry} onCopy={handleCopy} />);

    const copyButton = screen.getByRole("button", { name: /copy/i });
    fireEvent.click(copyButton);

    expect(handleCopy).toHaveBeenCalledWith(
      "Hello, this is a test transcription."
    );
    expect(handleCopy).toHaveBeenCalledTimes(1);
  });

  it("handles entry without language", () => {
    const entryWithoutLanguage: HistoryEntryType = {
      ...mockEntry,
      language: null,
    };

    render(<HistoryEntry entry={entryWithoutLanguage} onCopy={() => {}} />);

    // Should not have language badge
    expect(screen.queryByText("en")).not.toBeInTheDocument();
    // But text should still be there
    expect(
      screen.getByText("Hello, this is a test transcription.")
    ).toBeInTheDocument();
  });

  it("handles entry without duration", () => {
    const entryWithoutDuration: HistoryEntryType = {
      ...mockEntry,
      duration: null,
    };

    render(<HistoryEntry entry={entryWithoutDuration} onCopy={() => {}} />);

    // Should not have duration
    expect(screen.queryByText(/2\.5s/)).not.toBeInTheDocument();
    // But text should still be there
    expect(
      screen.getByText("Hello, this is a test transcription.")
    ).toBeInTheDocument();
  });

  it("formats timestamp correctly", () => {
    render(<HistoryEntry entry={mockEntry} onCopy={() => {}} />);

    // The formatTimestamp function should convert the timestamp
    // to locale string format
    const timestampElement = screen.getByText(/2024/);
    expect(timestampElement).toHaveClass("history-entry-timestamp");
  });

  it("has correct css structure", () => {
    const { container } = render(
      <HistoryEntry entry={mockEntry} onCopy={() => {}} />
    );

    expect(container.querySelector(".history-entry")).toBeInTheDocument();
    expect(
      container.querySelector(".history-entry-header")
    ).toBeInTheDocument();
    expect(container.querySelector(".history-entry-text")).toBeInTheDocument();
    expect(
      container.querySelector(".history-entry-actions")
    ).toBeInTheDocument();
  });
});
