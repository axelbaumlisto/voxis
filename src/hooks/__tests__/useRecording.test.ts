import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRecording } from "../useRecording";
import { mockInvoke, resetMocks } from "../../test/mocks/tauri";

// Mock the listen function to simulate events
const mockListeners = new Map<string, (event: { payload: unknown }) => void>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((eventName: string, callback: (event: { payload: unknown }) => void) => {
    mockListeners.set(eventName, callback);
    return Promise.resolve(() => {
      mockListeners.delete(eventName);
    });
  }),
  emit: vi.fn().mockResolvedValue(undefined),
}));

// Helper to emit events in tests
function emitEvent(eventName: string, payload: unknown) {
  const listener = mockListeners.get(eventName);
  if (listener) {
    listener({ payload });
  }
}

describe("useRecording", () => {
  beforeEach(() => {
    resetMocks();
    mockListeners.clear();
  });

  it("initializes with idle state", () => {
    const { result } = renderHook(() => useRecording());

    expect(result.current.state).toBe("idle");
    expect(result.current.audioLevel).toBe(0);
    expect(result.current.lastTranscription).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("calls manual_start_recording on start()", async () => {
    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await result.current.start();
    });

    expect(mockInvoke).toHaveBeenCalledWith("manual_start_recording");
  });

  it("calls manual_stop_recording on stop()", async () => {
    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await result.current.stop();
    });

    expect(mockInvoke).toHaveBeenCalledWith("manual_stop_recording");
  });

  it("updates state when state-changed event is received", async () => {
    const { result } = renderHook(() => useRecording());

    await act(async () => {
      emitEvent("state-changed", "recording");
    });

    expect(result.current.state).toBe("recording");
  });

  it("transitions through states: idle -> recording -> transcribing -> idle", async () => {
    const { result } = renderHook(() => useRecording());

    expect(result.current.state).toBe("idle");

    await act(async () => {
      emitEvent("state-changed", "recording");
    });
    expect(result.current.state).toBe("recording");

    await act(async () => {
      emitEvent("state-changed", "transcribing");
    });
    expect(result.current.state).toBe("transcribing");

    await act(async () => {
      emitEvent("state-changed", "idle");
    });
    expect(result.current.state).toBe("idle");
  });

  it("updates lastTranscription when transcription event is received", async () => {
    const { result } = renderHook(() => useRecording());

    await act(async () => {
      emitEvent("transcription", "Hello, this is a test.");
    });

    expect(result.current.lastTranscription).toBe("Hello, this is a test.");
  });

  it("clears error on successful transcription", async () => {
    const { result } = renderHook(() => useRecording());

    // First set an error
    await act(async () => {
      emitEvent("error", "Some error");
    });
    expect(result.current.error).toBe("Some error");

    // Then receive transcription
    await act(async () => {
      emitEvent("transcription", "Success");
    });

    expect(result.current.error).toBeNull();
    expect(result.current.lastTranscription).toBe("Success");
  });

  it("sets error when error event is received", async () => {
    const { result } = renderHook(() => useRecording());

    await act(async () => {
      emitEvent("error", "No audio devices available");
    });

    expect(result.current.error).toBe("No audio devices available");
  });

  it("sets error when start() fails", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("Failed to start recording"));

    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.error).toBe("Failed to start recording");
  });

  it("sets error when stop() fails", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("Failed to stop recording"));

    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await result.current.stop();
    });

    expect(result.current.error).toBe("Failed to stop recording");
  });

  it("toggle calls start when state is idle", async () => {
    const { result } = renderHook(() => useRecording());

    expect(result.current.state).toBe("idle");

    await act(async () => {
      await result.current.toggle();
    });

    expect(mockInvoke).toHaveBeenCalledWith("manual_start_recording");
  });

  it("toggle calls stop when state is recording", async () => {
    const { result } = renderHook(() => useRecording());

    // Set state to recording via event
    await act(async () => {
      emitEvent("state-changed", "recording");
    });

    expect(result.current.state).toBe("recording");

    await act(async () => {
      await result.current.toggle();
    });

    expect(mockInvoke).toHaveBeenCalledWith("manual_stop_recording");
  });

  it("toggle does nothing when state is transcribing", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useRecording());

    // Set state to transcribing via event
    await act(async () => {
      emitEvent("state-changed", "transcribing");
    });

    mockInvoke.mockClear();

    await act(async () => {
      await result.current.toggle();
    });

    // Should not have called start or stop commands
    expect(mockInvoke).not.toHaveBeenCalledWith("manual_start_recording");
    expect(mockInvoke).not.toHaveBeenCalledWith("manual_stop_recording");

    vi.useRealTimers();
  });

  it("clears error when start() is called", async () => {
    const { result } = renderHook(() => useRecording());

    // Set an error first
    await act(async () => {
      emitEvent("error", "Previous error");
    });
    expect(result.current.error).toBe("Previous error");

    // Call start
    await act(async () => {
      await result.current.start();
    });

    expect(result.current.error).toBeNull();
  });
});
