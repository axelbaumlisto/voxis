import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import HomePage from "../HomePage";
import { resetMocks } from "../../test/mocks/tauri";

// Mock RecordingContext - useRecording relies on Tauri event emission to change
// state, which cannot be driven from tests. Mocking the context lets us control
// the recording state directly.
vi.mock("../../contexts/RecordingContext", () => ({
  useRecordingContext: vi.fn(),
}));

// useFailedTranscriptions uses real invoke (mocked globally) and useTauriEvent
// (listen is mocked globally). No need to mock the hook itself.

import { useRecordingContext } from "../../contexts/RecordingContext";

describe("HomePage", () => {
  beforeEach(() => {
    resetMocks();
    vi.mocked(useRecordingContext).mockReturnValue({
      state: "idle",
      audioLevel: 0,
      lastTranscription: null,
      error: null,
      start: vi.fn(),
      stop: vi.fn(),
      toggle: vi.fn(),
    });
  });

  it("renders the record button in idle state", () => {
    render(<HomePage />);
    expect(screen.getByText("[ Record ]")).toBeInTheDocument();
  });

  it("shows Stop button when recording", () => {
    vi.mocked(useRecordingContext).mockReturnValue({
      state: "recording",
      audioLevel: 50,
      lastTranscription: null,
      error: null,
      start: vi.fn(),
      stop: vi.fn(),
      toggle: vi.fn(),
    });

    render(<HomePage />);
    expect(screen.getByText("[ Stop ]")).toBeInTheDocument();
  });

  it("shows ... button when transcribing", () => {
    vi.mocked(useRecordingContext).mockReturnValue({
      state: "transcribing",
      audioLevel: 0,
      lastTranscription: null,
      error: null,
      start: vi.fn(),
      stop: vi.fn(),
      toggle: vi.fn(),
    });

    render(<HomePage />);
    expect(screen.getByText("[ ... ]")).toBeInTheDocument();
  });

  it("calls start when clicking Record button", async () => {
    const startMock = vi.fn();
    vi.mocked(useRecordingContext).mockReturnValue({
      state: "idle",
      audioLevel: 0,
      lastTranscription: null,
      error: null,
      start: startMock,
      stop: vi.fn(),
      toggle: vi.fn(),
    });

    render(<HomePage />);
    const button = screen.getByText("[ Record ]");
    fireEvent.click(button);

    expect(startMock).toHaveBeenCalled();
  });

  it("calls stop when clicking Stop button during recording", async () => {
    const stopMock = vi.fn();
    vi.mocked(useRecordingContext).mockReturnValue({
      state: "recording",
      audioLevel: 50,
      lastTranscription: null,
      error: null,
      start: vi.fn(),
      stop: stopMock,
      toggle: vi.fn(),
    });

    render(<HomePage />);
    const button = screen.getByText("[ Stop ]");
    fireEvent.click(button);

    expect(stopMock).toHaveBeenCalled();
  });

  it("disables button during transcribing", () => {
    vi.mocked(useRecordingContext).mockReturnValue({
      state: "transcribing",
      audioLevel: 0,
      lastTranscription: null,
      error: null,
      start: vi.fn(),
      stop: vi.fn(),
      toggle: vi.fn(),
    });

    render(<HomePage />);
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
  });

  it("shows last transcription when available", () => {
    vi.mocked(useRecordingContext).mockReturnValue({
      state: "idle",
      audioLevel: 0,
      lastTranscription: "Hello, this is a test.",
      error: null,
      start: vi.fn(),
      stop: vi.fn(),
      toggle: vi.fn(),
    });

    render(<HomePage />);
    expect(screen.getByText("Last Transcription")).toBeInTheDocument();
    expect(screen.getByText("Hello, this is a test.")).toBeInTheDocument();
    expect(screen.getByText("Copied to clipboard")).toBeInTheDocument();
  });

  it("shows error message when error occurs", () => {
    vi.mocked(useRecordingContext).mockReturnValue({
      state: "error",
      audioLevel: 0,
      lastTranscription: null,
      error: "API key not configured",
      start: vi.fn(),
      stop: vi.fn(),
      toggle: vi.fn(),
    });

    render(<HomePage />);
    expect(screen.getByText("API key not configured")).toBeInTheDocument();
  });

  it("allows starting recording from error state", async () => {
    const startMock = vi.fn();
    vi.mocked(useRecordingContext).mockReturnValue({
      state: "error",
      audioLevel: 0,
      lastTranscription: null,
      error: "Previous error",
      start: startMock,
      stop: vi.fn(),
      toggle: vi.fn(),
    });

    render(<HomePage />);
    const button = screen.getByText("[ Record ]");
    fireEvent.click(button);

    expect(startMock).toHaveBeenCalled();
  });

  it("shows empty state when no transcription and no error", () => {
    render(<HomePage />);
    expect(
      screen.getByText("Press your hotkey or click the button to start recording")
    ).toBeInTheDocument();
    expect(screen.getByText("Transcriptions will appear here")).toBeInTheDocument();
  });

  it("button has correct CSS class based on state", () => {
    vi.mocked(useRecordingContext).mockReturnValue({
      state: "recording",
      audioLevel: 0,
      lastTranscription: null,
      error: null,
      start: vi.fn(),
      stop: vi.fn(),
      toggle: vi.fn(),
    });

    render(<HomePage />);
    const button = screen.getByRole("button");
    expect(button).toHaveClass("record-btn");
    expect(button).toHaveClass("recording");
  });
});
