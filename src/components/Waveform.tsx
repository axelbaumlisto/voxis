import { useEffect, useReducer, useRef } from "react";
import { getAudioLevel } from "../lib/commands";

const BAR_COUNT = 32;
const ANIMATION_INTERVAL = 80; // ms
const SILENCE_THRESHOLD = 0.01;
const SILENCE_WARN_FRAMES = 25; // ~2 seconds

interface WaveformProps {
  mode: "idle" | "recording" | "transcribing" | "error";
}

// KISS: Centralized state management with useReducer
type WaveformState = {
  levels: number[];
  silentFrames: number;
  pulsePhase: number;
};

type WaveformAction =
  | { type: "RESET" }
  | { type: "UPDATE_LEVEL"; level: number }
  | { type: "UPDATE_PULSE" }
  | { type: "ERROR_DECAY" };

const initialState: WaveformState = {
  levels: [],
  silentFrames: 0,
  pulsePhase: 0,
};

/**
 * Add a level to the array while maintaining max count.
 * DRY: Single utility for level capping used in multiple reducer cases.
 */
const addLevelWithCap = (
  levels: number[],
  newLevel: number,
  maxCount: number
): number[] => {
  const updated = [...levels, newLevel];
  return updated.length > maxCount ? updated.slice(-maxCount) : updated;
};

function waveformReducer(
  state: WaveformState,
  action: WaveformAction
): WaveformState {
  switch (action.type) {
    case "RESET":
      return initialState;

    case "UPDATE_LEVEL": {
      const { level } = action;
      const isSilent = level < SILENCE_THRESHOLD;
      return {
        ...state,
        levels: addLevelWithCap(state.levels, level, BAR_COUNT),
        silentFrames: isSilent ? state.silentFrames + 1 : 0,
      };
    }

    case "UPDATE_PULSE":
      return {
        ...state,
        pulsePhase: state.pulsePhase + 0.3,
      };

    case "ERROR_DECAY": {
      const randomLevel = 0.3 + Math.random() * 0.7;
      return {
        ...state,
        levels: addLevelWithCap(state.levels, randomLevel, BAR_COUNT),
      };
    }

    default:
      return state;
  }
}

function amplifyLevel(level: number): number {
  // Same as TUI: raw RMS from mic is typically 0.01-0.15 for speech
  return Math.min(1.0, Math.pow(level * 8.0, 0.5));
}

/**
 * Render a single waveform bar with given height (as percentage string).
 * DRY: Reusable bar component for all render modes.
 */
const renderBar = (key: string | number, height: string) => (
  <div
    key={key}
    className="waveform-bar"
    style={{ height }}
  />
);

/**
 * Render empty (flat) bars to fill remaining space.
 * DRY: Used in idle mode and to fill remaining bars in recording/error modes.
 */
const renderEmptyBars = (count: number, keyPrefix = "empty") =>
  Array(Math.max(0, count))
    .fill(0)
    .map((_, i) => renderBar(`${keyPrefix}-${i}`, "2px"));

function Waveform({ mode }: WaveformProps) {
  const [state, dispatch] = useReducer(waveformReducer, initialState);
  const intervalRef = useRef<number | null>(null);

  // Animation interval effect
  useEffect(() => {
    intervalRef.current = window.setInterval(() => {
      if (mode === "recording") {
        getAudioLevel()
          .then((level) => {
            dispatch({ type: "UPDATE_LEVEL", level });
          })
          .catch(() => {
            // Ignore errors
          });
      } else if (mode === "transcribing") {
        dispatch({ type: "UPDATE_PULSE" });
      } else if (mode === "error") {
        dispatch({ type: "ERROR_DECAY" });
      }
    }, ANIMATION_INTERVAL);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [mode]);

  // Reset state when mode changes
  useEffect(() => {
    dispatch({ type: "RESET" });
  }, [mode]);

  const renderBars = () => {
    if (mode === "idle") {
      return (
        <div className="waveform idle">
          {renderEmptyBars(BAR_COUNT, "idle")}
        </div>
      );
    }

    if (mode === "transcribing") {
      // Pulsing indicator
      const pulse = 0.7 + ((Math.sin(state.pulsePhase) + 1) / 2) * 0.3;
      const heights = [0.2, 0.4, 0.65, 0.4, 0.2].map((h) => h * pulse * 100);
      return (
        <div className="waveform transcribing">
          {heights.map((h, i) => renderBar(i, `${h}%`))}
        </div>
      );
    }

    // Recording or error mode
    const isWarning = mode === "recording" && state.silentFrames > SILENCE_WARN_FRAMES;
    const className = isWarning ? "waveform silence" : `waveform ${mode}`;

    return (
      <div className={className}>
        {state.levels.map((level, i) => {
          const amp = amplifyLevel(level);
          return renderBar(i, `${Math.max(2, amp * 100)}%`);
        })}
        {renderEmptyBars(BAR_COUNT - state.levels.length)}
      </div>
    );
  };

  return renderBars();
}

export default Waveform;

// Export for testing
export { waveformReducer, initialState, SILENCE_THRESHOLD, SILENCE_WARN_FRAMES, BAR_COUNT };
export type { WaveformState, WaveformAction };
