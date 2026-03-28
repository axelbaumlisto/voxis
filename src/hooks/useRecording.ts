import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getAudioLevel } from "../lib/commands";
import { useTauriEvent } from "./useTauriEvent";

export type RecordingState = "idle" | "recording" | "transcribing" | "error";

export interface UseRecordingResult {
  state: RecordingState;
  audioLevel: number;
  lastTranscription: string | null;
  error: string | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  toggle: () => Promise<void>;
}

/**
 * Hook for managing audio recording and transcription.
 *
 * The actual orchestration (recording -> transcription -> output) happens
 * in Rust. This hook just listens to events and provides manual controls.
 */
export function useRecording(): UseRecordingResult {
  const [state, setState] = useState<RecordingState>("idle");
  const [audioLevel, setAudioLevel] = useState(0);
  const [lastTranscription, setLastTranscription] = useState<string | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  // Audio level polling interval
  const levelIntervalRef = useRef<number | null>(null);

  // Start polling audio levels when recording
  const startLevelPolling = useCallback(() => {
    if (levelIntervalRef.current) return;

    levelIntervalRef.current = window.setInterval(async () => {
      try {
        const level = await getAudioLevel();
        setAudioLevel(level);
      } catch {
        // Ignore errors during polling
      }
    }, 50); // 20 Hz update rate
  }, []);

  // Stop polling audio levels
  const stopLevelPolling = useCallback(() => {
    if (levelIntervalRef.current) {
      clearInterval(levelIntervalRef.current);
      levelIntervalRef.current = null;
    }
    setAudioLevel(0);
  }, []);

  // DRY: Use useTauriEvent for cleaner event handling
  useTauriEvent<RecordingState>("state-changed", (newState) => {
    setState(newState);

    // Start/stop level polling based on state
    if (newState === "recording") {
      startLevelPolling();
    } else {
      stopLevelPolling();
    }
  }, [startLevelPolling, stopLevelPolling]);

  useTauriEvent<string>("transcription", (text) => {
    setLastTranscription(text);
    setError(null); // Clear error on successful transcription
  });

  useTauriEvent<string>("error", (errorMessage) => {
    setError(errorMessage);
  });

  // Manual start via command (delegates to orchestrator)
  const start = useCallback(async () => {
    try {
      setError(null);
      await invoke("manual_start_recording");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Manual stop via command (delegates to orchestrator)
  const stop = useCallback(async () => {
    try {
      await invoke("manual_stop_recording");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Toggle based on current state
  const toggle = useCallback(async () => {
    if (state === "recording") {
      await stop();
    } else if (state === "idle") {
      await start();
    }
    // Don't toggle during transcribing/error states
  }, [state, start, stop]);

  return {
    state,
    audioLevel,
    lastTranscription,
    error,
    start,
    stop,
    toggle,
  };
}
