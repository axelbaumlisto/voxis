import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import HistoryList from "../HistoryList";
import type { HistoryEntry } from "../../../lib/commands";

const mockEntries: HistoryEntry[] = [
  {
    id: 1,
    timestamp: "2024-01-15 10:30:00",
    text: "First transcription",
    language: "en",
    duration: 2.5,
  },
  {
    id: 2,
    timestamp: "2024-01-15 11:00:00",
    text: "Second transcription",
    language: "ru",
    duration: 3.1,
  },
  {
    id: 3,
    timestamp: "2024-01-15 11:30:00",
    text: "Third transcription",
    language: "de",
    duration: 1.8,
  },
];

describe("HistoryList", () => {
  it("renders all entries", () => {
    render(<HistoryList entries={mockEntries} onCopy={() => {}} />);

    expect(screen.getByText("First transcription")).toBeInTheDocument();
    expect(screen.getByText("Second transcription")).toBeInTheDocument();
    expect(screen.getByText("Third transcription")).toBeInTheDocument();
  });

  it("shows empty state when no entries", () => {
    render(<HistoryList entries={[]} onCopy={() => {}} />);

    expect(screen.getByText("No transcriptions yet.")).toBeInTheDocument();
    expect(
      screen.getByText("Start recording to see your transcriptions here.")
    ).toBeInTheDocument();
  });

  it("calls onCopy with correct text when copy is clicked", () => {
    const handleCopy = vi.fn();
    render(<HistoryList entries={mockEntries} onCopy={handleCopy} />);

    const copyButtons = screen.getAllByRole("button", { name: /copy/i });

    // Click first entry's copy button
    fireEvent.click(copyButtons[0]);
    expect(handleCopy).toHaveBeenCalledWith("First transcription");

    // Click second entry's copy button
    fireEvent.click(copyButtons[1]);
    expect(handleCopy).toHaveBeenCalledWith("Second transcription");
  });

  it("renders entries in order", () => {
    render(<HistoryList entries={mockEntries} onCopy={() => {}} />);

    const texts = screen.getAllByText(/transcription/i);
    expect(texts[0]).toHaveTextContent("First transcription");
    expect(texts[1]).toHaveTextContent("Second transcription");
    expect(texts[2]).toHaveTextContent("Third transcription");
  });

  it("has correct css class for list container", () => {
    const { container } = render(
      <HistoryList entries={mockEntries} onCopy={() => {}} />
    );

    expect(container.querySelector(".history-list")).toBeInTheDocument();
  });

  it("has correct css class for empty state", () => {
    const { container } = render(
      <HistoryList entries={[]} onCopy={() => {}} />
    );

    expect(container.querySelector(".history-empty")).toBeInTheDocument();
  });

  it("renders single entry correctly", () => {
    render(<HistoryList entries={[mockEntries[0]]} onCopy={() => {}} />);

    expect(screen.getByText("First transcription")).toBeInTheDocument();
    expect(screen.queryByText("Second transcription")).not.toBeInTheDocument();
  });
});
