import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import Waveform, {
  waveformReducer,
  initialState,
  SILENCE_THRESHOLD,
  SILENCE_WARN_FRAMES,
  BAR_COUNT,
} from "../Waveform";
import type { WaveformState, WaveformAction } from "../Waveform";
import { mockInvoke, resetMocks } from "../../test/mocks/tauri";

describe("Waveform", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("idle mode", () => {
    it("renders flat bars in idle state", () => {
      render(<Waveform mode="idle" />);
      const waveform = document.querySelector(".waveform.idle");
      expect(waveform).toBeInTheDocument();

      const bars = waveform?.querySelectorAll(".waveform-bar");
      expect(bars?.length).toBe(32); // BAR_COUNT

      // All bars should be 2px (flat)
      bars?.forEach((bar) => {
        expect(bar).toHaveStyle({ height: "2px" });
      });
    });
  });

  describe("recording mode", () => {
    it("fetches audio level and updates bars", async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_audio_level") {
          return 0.1; // Simulated audio level
        }
        return undefined;
      });

      render(<Waveform mode="recording" />);
      const waveform = document.querySelector(".waveform.recording");
      expect(waveform).toBeInTheDocument();

      // Advance time to trigger interval
      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      // Should have called getAudioLevel
      expect(mockInvoke).toHaveBeenCalledWith("get_audio_level");
    });

    it("shows silence warning after threshold", async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_audio_level") {
          return 0.001; // Below SILENCE_THRESHOLD (0.01)
        }
        return undefined;
      });

      render(<Waveform mode="recording" />);

      // Advance time enough to trigger silence warning (25 frames * 80ms = 2000ms)
      for (let i = 0; i < 30; i++) {
        await act(async () => {
          vi.advanceTimersByTime(80);
        });
      }

      const waveform = document.querySelector(".waveform.silence");
      expect(waveform).toBeInTheDocument();
    });

    it("resets silence warning when audio detected", async () => {
      let callCount = 0;
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_audio_level") {
          callCount++;
          // Return silence for first 26 calls, then audio
          return callCount <= 26 ? 0.001 : 0.5;
        }
        return undefined;
      });

      render(<Waveform mode="recording" />);

      // Build up silence warning
      for (let i = 0; i < 27; i++) {
        await act(async () => {
          vi.advanceTimersByTime(80);
        });
      }

      // Then get audio
      await act(async () => {
        vi.advanceTimersByTime(80);
      });

      // Should no longer have silence class
      const silenceWaveform = document.querySelector(".waveform.silence");
      expect(silenceWaveform).not.toBeInTheDocument();
    });

    it("handles getAudioLevel errors gracefully", async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_audio_level") {
          throw new Error("Audio error");
        }
        return undefined;
      });

      // Should not throw
      render(<Waveform mode="recording" />);

      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      // Component should still be rendered
      expect(document.querySelector(".waveform")).toBeInTheDocument();
    });
  });

  describe("transcribing mode", () => {
    it("renders pulsing animation with 5 bars", () => {
      render(<Waveform mode="transcribing" />);
      const waveform = document.querySelector(".waveform.transcribing");
      expect(waveform).toBeInTheDocument();

      const bars = waveform?.querySelectorAll(".waveform-bar");
      expect(bars?.length).toBe(5);
    });

    it("updates pulse phase over time", async () => {
      render(<Waveform mode="transcribing" />);

      const getBarHeight = () => {
        const bar = document.querySelector(".waveform.transcribing .waveform-bar");
        return bar?.getAttribute("style");
      };

      const initialHeight = getBarHeight();

      await act(async () => {
        vi.advanceTimersByTime(320); // 4 intervals
      });

      const newHeight = getBarHeight();

      // Height should change due to pulse
      expect(newHeight).not.toBe(initialHeight);
    });
  });

  describe("error mode", () => {
    it("renders with random bar heights", async () => {
      render(<Waveform mode="error" />);
      const waveform = document.querySelector(".waveform.error");
      expect(waveform).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(320);
      });

      const bars = waveform?.querySelectorAll(".waveform-bar");
      expect(bars?.length).toBeGreaterThan(0);
    });
  });

  describe("mode transitions", () => {
    it("resets state when mode changes", async () => {
      const { rerender } = render(<Waveform mode="recording" />);

      // Build up some levels
      mockInvoke.mockImplementation(async () => 0.5);
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          vi.advanceTimersByTime(80);
        });
      }

      // Switch to idle
      rerender(<Waveform mode="idle" />);

      // Should show idle state with flat bars
      const waveform = document.querySelector(".waveform.idle");
      expect(waveform).toBeInTheDocument();
    });

    it("cleans up interval on unmount", async () => {
      const { unmount } = render(<Waveform mode="recording" />);

      // Get initial call count
      const initialCount = mockInvoke.mock.calls.filter(
        (call) => call[0] === "get_audio_level"
      ).length;

      unmount();

      // Advance time - should not make more calls
      await act(async () => {
        vi.advanceTimersByTime(500);
      });

      const finalCount = mockInvoke.mock.calls.filter(
        (call) => call[0] === "get_audio_level"
      ).length;

      expect(finalCount).toBe(initialCount);
    });
  });

  describe("amplification", () => {
    it("amplifies low audio levels correctly", async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_audio_level") {
          return 0.05; // Low but audible level
        }
        return undefined;
      });

      render(<Waveform mode="recording" />);

      await act(async () => {
        vi.advanceTimersByTime(160); // 2 intervals
      });

      const bars = document.querySelectorAll(".waveform.recording .waveform-bar");
      const barWithLevel = Array.from(bars).find((bar) => {
        const style = bar.getAttribute("style");
        return style && !style.includes("2px");
      });

      // Should have at least one bar with height > 2px
      expect(barWithLevel).toBeTruthy();
    });
  });
});

// Unit tests for waveformReducer (TDD)
describe("waveformReducer", () => {
  it("RESET returns initial state", () => {
    const state: WaveformState = {
      levels: [0.5, 0.6],
      silentFrames: 10,
      pulsePhase: 1.5,
    };
    const result = waveformReducer(state, { type: "RESET" });
    expect(result).toEqual(initialState);
  });

  describe("UPDATE_LEVEL", () => {
    it("adds level to levels array", () => {
      const state = { ...initialState };
      const result = waveformReducer(state, { type: "UPDATE_LEVEL", level: 0.5 });
      expect(result.levels).toEqual([0.5]);
    });

    it("caps levels array at BAR_COUNT", () => {
      const state: WaveformState = {
        levels: Array(BAR_COUNT).fill(0.5),
        silentFrames: 0,
        pulsePhase: 0,
      };
      const result = waveformReducer(state, { type: "UPDATE_LEVEL", level: 0.7 });
      expect(result.levels.length).toBe(BAR_COUNT);
      expect(result.levels[result.levels.length - 1]).toBe(0.7);
    });

    it("increments silentFrames when level is below threshold", () => {
      const state: WaveformState = { ...initialState, silentFrames: 5 };
      const result = waveformReducer(state, {
        type: "UPDATE_LEVEL",
        level: SILENCE_THRESHOLD - 0.001,
      });
      expect(result.silentFrames).toBe(6);
    });

    it("resets silentFrames when level is above threshold", () => {
      const state: WaveformState = { ...initialState, silentFrames: 10 };
      const result = waveformReducer(state, {
        type: "UPDATE_LEVEL",
        level: SILENCE_THRESHOLD + 0.01,
      });
      expect(result.silentFrames).toBe(0);
    });
  });

  describe("UPDATE_PULSE", () => {
    it("increments pulse phase by 0.3", () => {
      const state: WaveformState = { ...initialState, pulsePhase: 1.0 };
      const result = waveformReducer(state, { type: "UPDATE_PULSE" });
      expect(result.pulsePhase).toBeCloseTo(1.3);
    });
  });

  describe("ERROR_DECAY", () => {
    it("adds random level to levels array", () => {
      const state = { ...initialState };
      const result = waveformReducer(state, { type: "ERROR_DECAY" });
      expect(result.levels.length).toBe(1);
      expect(result.levels[0]).toBeGreaterThanOrEqual(0.3);
      expect(result.levels[0]).toBeLessThanOrEqual(1.0);
    });

    it("caps levels array at BAR_COUNT", () => {
      const state: WaveformState = {
        levels: Array(BAR_COUNT).fill(0.5),
        silentFrames: 0,
        pulsePhase: 0,
      };
      const result = waveformReducer(state, { type: "ERROR_DECAY" });
      expect(result.levels.length).toBe(BAR_COUNT);
    });
  });

  it("returns current state for unknown action", () => {
    const state = { ...initialState };
    // @ts-expect-error Testing unknown action
    const result = waveformReducer(state, { type: "UNKNOWN" });
    expect(result).toEqual(state);
  });
});
