import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { ReactNode } from "react";
import { RecordingProvider, useRecordingContext } from "../RecordingContext";

// Mock useRecording hook
vi.mock("../../hooks/useRecording", () => ({
  useRecording: vi.fn(() => ({
    state: "idle",
    audioLevel: 0,
    lastTranscription: null,
    error: null,
    start: vi.fn(),
    stop: vi.fn(),
    toggle: vi.fn(),
  })),
}));

import { useRecording } from "../../hooks/useRecording";

const mockUseRecording = vi.mocked(useRecording);

describe("RecordingContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("RecordingProvider", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <RecordingProvider>{children}</RecordingProvider>
    );

    it("should provide default idle state", () => {
      mockUseRecording.mockReturnValue({
        state: "idle",
        audioLevel: 0,
        lastTranscription: null,
        error: null,
        start: vi.fn(),
        stop: vi.fn(),
        toggle: vi.fn(),
      });

      const { result } = renderHook(() => useRecordingContext(), { wrapper });

      expect(result.current.state).toBe("idle");
      expect(result.current.audioLevel).toBe(0);
      expect(result.current.lastTranscription).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it("should provide recording state", () => {
      mockUseRecording.mockReturnValue({
        state: "recording",
        audioLevel: 50,
        lastTranscription: null,
        error: null,
        start: vi.fn(),
        stop: vi.fn(),
        toggle: vi.fn(),
      });

      const { result } = renderHook(() => useRecordingContext(), { wrapper });

      expect(result.current.state).toBe("recording");
      expect(result.current.audioLevel).toBe(50);
    });

    it("should provide transcribing state", () => {
      mockUseRecording.mockReturnValue({
        state: "transcribing",
        audioLevel: 0,
        lastTranscription: null,
        error: null,
        start: vi.fn(),
        stop: vi.fn(),
        toggle: vi.fn(),
      });

      const { result } = renderHook(() => useRecordingContext(), { wrapper });

      expect(result.current.state).toBe("transcribing");
    });

    it("should provide error state", () => {
      mockUseRecording.mockReturnValue({
        state: "error",
        audioLevel: 0,
        lastTranscription: null,
        error: "Recording failed",
        start: vi.fn(),
        stop: vi.fn(),
        toggle: vi.fn(),
      });

      const { result } = renderHook(() => useRecordingContext(), { wrapper });

      expect(result.current.state).toBe("error");
      expect(result.current.error).toBe("Recording failed");
    });

    it("should provide last transcription", () => {
      mockUseRecording.mockReturnValue({
        state: "idle",
        audioLevel: 0,
        lastTranscription: "Hello world",
        error: null,
        start: vi.fn(),
        stop: vi.fn(),
        toggle: vi.fn(),
      });

      const { result } = renderHook(() => useRecordingContext(), { wrapper });

      expect(result.current.lastTranscription).toBe("Hello world");
    });

    it("should provide action functions", () => {
      const mockStart = vi.fn();
      const mockStop = vi.fn();
      const mockToggle = vi.fn();

      mockUseRecording.mockReturnValue({
        state: "idle",
        audioLevel: 0,
        lastTranscription: null,
        error: null,
        start: mockStart,
        stop: mockStop,
        toggle: mockToggle,
      });

      const { result } = renderHook(() => useRecordingContext(), { wrapper });

      expect(result.current.start).toBe(mockStart);
      expect(result.current.stop).toBe(mockStop);
      expect(result.current.toggle).toBe(mockToggle);
    });
  });

  describe("useRecordingContext", () => {
    it("should throw error when used outside provider", () => {
      // Suppress console.error for this test
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(() => {
        renderHook(() => useRecordingContext());
      }).toThrow("useRecordingContext must be used within RecordingProvider");

      consoleSpy.mockRestore();
    });
  });
});
