import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import FailedTranscriptionList from "../FailedTranscriptionList";

const mockHook = {
  items: [] as Array<{
    id: string;
    error: string;
    whisper_text: string | null;
    timestamp: string;
    provider: string;
  }>,
  retry: vi.fn(),
  dismiss: vi.fn(),
  retrying: null as string | null,
  error: null as string | null,
};

vi.mock("../../../hooks/useFailedTranscriptions", () => ({
  useFailedTranscriptions: () => mockHook,
}));

const sampleItem = {
  id: "f1",
  error: "API key not configured",
  whisper_text: "raw whisper text",
  timestamp: "2024-01-15 10:00:00",
  provider: "groq",
};

describe("FailedTranscriptionList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHook.items = [];
    mockHook.retrying = null;
    mockHook.error = null;
  });

  it("renders nothing when there are no items and no error", () => {
    const { container } = render(<FailedTranscriptionList />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a failed card for each item", () => {
    mockHook.items = [sampleItem];
    render(<FailedTranscriptionList />);

    expect(screen.getByText("API key not configured")).toBeInTheDocument();
    expect(screen.getByText("raw whisper text")).toBeInTheDocument();
  });

  it("calls retry when the retry button is clicked", () => {
    mockHook.items = [sampleItem];
    render(<FailedTranscriptionList />);

    fireEvent.click(screen.getByText("Try Again"));
    expect(mockHook.retry).toHaveBeenCalledWith("f1");
  });

  it("calls dismiss when the dismiss button is clicked", () => {
    mockHook.items = [sampleItem];
    render(<FailedTranscriptionList />);

    fireEvent.click(screen.getByText("Dismiss"));
    expect(mockHook.dismiss).toHaveBeenCalledWith("f1");
  });

  it("surfaces a hook error", async () => {
    mockHook.error = "Retry failed: boom";
    render(<FailedTranscriptionList />);

    await waitFor(() => {
      expect(screen.getByText("Retry failed: boom")).toBeInTheDocument();
    });
  });

  it("disables the retry button while retrying", () => {
    mockHook.items = [sampleItem];
    mockHook.retrying = "f1";
    render(<FailedTranscriptionList />);

    expect(screen.getByText("Retrying...")).toBeDisabled();
  });
});
