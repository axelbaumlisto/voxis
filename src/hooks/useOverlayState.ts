/**
 * useOverlayState — event-driven snapshot of overlay rendering inputs.
 *
 * Aggregates four backend events into a single immutable snapshot consumed
 * by the overlay webview. Replaces poll-based updates with push-based events.
 *
 * SOLID / DRY / KISS:
 * - SRP: this hook only aggregates events into state; rendering is delegated.
 * - DIP: depends on `@tauri-apps/api/event` abstraction, not any concrete backend.
 * - KISS: `useReducer` with four action types, no middleware. Defaults are
 *   sensible so the hook is usable outside Tauri (tests, storybook).
 */
import { useEffect, useReducer } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { commands as bindings } from "../bindings";

export type OverlayMode = "idle" | "recording" | "transcribing" | "error";

export interface OverlaySnapshot {
  mode: OverlayMode;
  /** Smoothed audio level in [0, 1]. */
  audioLevel: number;
  /** FFT spectrum bins of length 32, each in [0, 1]. */
  spectrumBins: number[];
  /** Theme identifier — `winamp_classic`, `living_reed`, ... */
  themeId: string;
}

const SPECTRUM_BAR_COUNT = 32;
const DEFAULT_THEME = "winamp_classic";

const VALID_MODES: ReadonlySet<OverlayMode> = new Set<OverlayMode>([
  "idle",
  "recording",
  "transcribing",
  "error",
]);

function initialSnapshot(): OverlaySnapshot {
  return {
    mode: "idle",
    audioLevel: 0,
    spectrumBins: new Array(SPECTRUM_BAR_COUNT).fill(0),
    themeId: DEFAULT_THEME,
  };
}

type Action =
  | { type: "mode"; mode: OverlayMode }
  | { type: "audioLevel"; level: number }
  | { type: "spectrumBins"; bins: number[] }
  | { type: "theme"; themeId: string };

function reducer(state: OverlaySnapshot, action: Action): OverlaySnapshot {
  switch (action.type) {
    case "mode":
      return state.mode === action.mode ? state : { ...state, mode: action.mode };
    case "audioLevel": {
      const clamped = Math.max(0, Math.min(1, action.level));
      return state.audioLevel === clamped
        ? state
        : { ...state, audioLevel: clamped };
    }
    case "spectrumBins":
      return { ...state, spectrumBins: action.bins };
    case "theme":
      return state.themeId === action.themeId
        ? state
        : { ...state, themeId: action.themeId };
  }
}

function coerceMode(payload: unknown): OverlayMode | null {
  if (typeof payload === "string" && VALID_MODES.has(payload as OverlayMode)) {
    return payload as OverlayMode;
  }
  if (
    payload &&
    typeof payload === "object" &&
    "state" in payload &&
    typeof (payload as { state: unknown }).state === "string"
  ) {
    const candidate = (payload as { state: string }).state;
    return VALID_MODES.has(candidate as OverlayMode)
      ? (candidate as OverlayMode)
      : null;
  }
  return null;
}

function coerceLevel(payload: unknown): number | null {
  if (typeof payload === "number" && Number.isFinite(payload)) return payload;
  return null;
}

function coerceBins(payload: unknown): number[] | null {
  if (!Array.isArray(payload) || payload.length !== SPECTRUM_BAR_COUNT) {
    return null;
  }
  if (!payload.every((v) => typeof v === "number" && Number.isFinite(v))) {
    return null;
  }
  return payload as number[];
}

function coerceTheme(payload: unknown): string | null {
  if (typeof payload === "string" && payload.length > 0) return payload;
  return null;
}

/**
 * Subscribe to all overlay events and aggregate them into a single snapshot.
 *
 * Safe to use outside Tauri — `listen()` failures are caught and the hook
 * stays at its initial snapshot.
 */
export function useOverlayState(): OverlaySnapshot {
  const [state, dispatch] = useReducer(reducer, undefined, initialSnapshot);

  useEffect(() => {
    let cancelled = false;
    const unlistens: UnlistenFn[] = [];

    const subscribe = async <T,>(
      event: string,
      handle: (payload: T) => void,
    ) => {
      try {
        const unlisten = await listen<T>(event, (e) => handle(e.payload));
        if (cancelled) {
          unlisten();
          return;
        }
        unlistens.push(unlisten);
      } catch (err) {
        console.warn(`[useOverlayState] subscribe ${event} failed:`, err);
      }
    };

    void subscribe<unknown>("overlay://state", (payload) => {
      void bindings
        .debugLogOverlay(
          `overlay://state rcv payload=${JSON.stringify(payload)}`,
        )
        .catch(() => {});
      const mode = coerceMode(payload);
      if (mode) dispatch({ type: "mode", mode });
    });

    void subscribe<unknown>("overlay://audio-level", (payload) => {
      const level = coerceLevel(payload);
      if (level !== null) dispatch({ type: "audioLevel", level });
    });

    void subscribe<unknown>("overlay://spectrum-bins", (payload) => {
      const bins = coerceBins(payload);
      if (bins) dispatch({ type: "spectrumBins", bins });
    });

    void subscribe<unknown>("overlay://theme", (payload) => {
      void bindings
        .debugLogOverlay(
          `overlay://theme rcv payload=${JSON.stringify(payload)}`,
        )
        .catch(() => {});
      const themeId = coerceTheme(payload);
      if (themeId) dispatch({ type: "theme", themeId });
    });

    return () => {
      cancelled = true;
      for (const unlisten of unlistens) {
        try {
          unlisten();
        } catch (err) {
          console.warn("[useOverlayState] unlisten failed:", err);
        }
      }
    };
  }, []);

  return state;
}
