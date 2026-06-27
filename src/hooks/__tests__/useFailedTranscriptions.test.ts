import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useFailedTranscriptions } from "../useFailedTranscriptions";
import { mockInvoke, resetMocks } from "../../test/mocks/tauri";
import { FailedTranscription } from "../../lib/commands";

const mockFailed: FailedTranscription[] = [
  {
    id: "f1",
    error: "API key not configured",
    whisper_text: "raw whisper text",
    timestamp: "2024-01-15 10:00:00",
    provider: "groq",
  },
];

describe("useFailedTranscriptions", () => {
  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
  });

  it("loads failed transcriptions on mount", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_failed_transcriptions") return [...mockFailed];
      return undefined;
    });

    const { result } = renderHook(() => useFailedTranscriptions());

    await waitFor(() => {
      expect(result.current.items).toEqual(mockFailed);
    });
    expect(result.current.error).toBeNull();
  });

  describe("retry", () => {
    it("retries successfully without surfacing an error", async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_failed_transcriptions") return [...mockFailed];
        if (cmd === "retry_transcription") return "transcribed text";
        return undefined;
      });

      const { result } = renderHook(() => useFailedTranscriptions());
      await waitFor(() => expect(result.current.items).toHaveLength(1));

      await act(async () => {
        await result.current.retry("f1");
      });

      expect(result.current.error).toBeNull();
      expect(result.current.retrying).toBeNull();
    });

    it("surfaces an error when retry fails", async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_failed_transcriptions") return [...mockFailed];
        if (cmd === "retry_transcription") throw new Error("retry boom");
        return undefined;
      });

      const { result } = renderHook(() => useFailedTranscriptions());
      await waitFor(() => expect(result.current.items).toHaveLength(1));

      await act(async () => {
        await result.current.retry("f1");
      });

      expect(result.current.error).toBe("retry boom");
      expect(result.current.retrying).toBeNull();
    });
  });

  describe("dismiss", () => {
    it("dismisses successfully and refreshes", async () => {
      let items = [...mockFailed];
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_failed_transcriptions") return [...items];
        if (cmd === "dismiss_failed_transcription") {
          items = [];
          return undefined;
        }
        return undefined;
      });

      const { result } = renderHook(() => useFailedTranscriptions());
      await waitFor(() => expect(result.current.items).toHaveLength(1));

      await act(async () => {
        await result.current.dismiss("f1");
      });

      await waitFor(() => expect(result.current.items).toHaveLength(0));
      expect(result.current.error).toBeNull();
    });

    it("surfaces an error when dismiss fails", async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_failed_transcriptions") return [...mockFailed];
        if (cmd === "dismiss_failed_transcription") throw new Error("dismiss boom");
        return undefined;
      });

      const { result } = renderHook(() => useFailedTranscriptions());
      await waitFor(() => expect(result.current.items).toHaveLength(1));

      await act(async () => {
        await result.current.dismiss("f1");
      });

      expect(result.current.error).toBe("dismiss boom");
    });
  });
});
