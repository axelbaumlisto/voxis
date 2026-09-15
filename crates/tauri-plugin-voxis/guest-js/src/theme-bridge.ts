// crates/tauri-plugin-voxis/guest-js/src/theme-bridge.ts
/**
 * Adapts the plugin's own state (`PluginState` from `voxis://state`,
 * `LevelEvent` from `voxis://level`) to the existing theme-engine
 * contract v1 (`ThemeApi`/`ThemeState`, `src/theme-engine/contract.ts` —
 * mirrored in `types/theme-api.ts`, see that file's doc comment for why
 * it's a copy, not a cross-package import). This is the only place that
 * bridges the two — `overlay.ts` never touches `ThemeApi` directly.
 */
import type { ThemeApi, ThemeMode, ThemeSize, ThemeState } from "./types/theme-api";
import { THEME_API_VERSION } from "./types/theme-api";

const SPECTRUM_BINS = 32;

/**
 * The plugin only ever emits a scalar `LevelEvent{rms, peak, muted}`
 * (Task 3/3b `voxis://level`, up to 20 Hz) — there is no per-band FFT to
 * forward, unlike the desktop app's own overlay pipeline that feeds
 * `spectrumBins` from a real analyser node. Every theme still receives a
 * `spectrumBins` array of the contractually-correct length (32, all bins
 * mirroring `audioLevel`) so a theme built against the richer desktop
 * signal degrades to "pulses with the overall level" rather than
 * "always flat" when mounted under the plugin. Documented here as a
 * deliberate approximation, not a bug.
 */
function flatSpectrum(level: number): number[] {
  const clamped = Math.max(0, Math.min(1, level));
  return new Array(SPECTRUM_BINS).fill(clamped);
}

/** `PluginState`'s four values are spelled identically to `ThemeMode`'s — this is an assertion of that fact, not a conversion. */
export function pluginStateToThemeMode(state: "idle" | "recording" | "transcribing" | "error"): ThemeMode {
  return state;
}

export interface ThemeBridge {
  api: ThemeApi;
  /** Pushes a full state snapshot to every `onState` subscriber. */
  setState(next: ThemeState): void;
  /** Derives a `ThemeState` from the overlay's own signals and pushes it — `muted` forces `audioLevel` to 0 (a themed level meter must not show a live level for audio nobody can hear/that isn't being sent). */
  setFromLevel(mode: ThemeMode, rms: number, muted: boolean): void;
}

export interface ThemeBridgeActions {
  cancel(): void;
}

export function createThemeBridge(size: ThemeSize, params: unknown, actions: ThemeBridgeActions): ThemeBridge {
  const listeners = new Set<(state: ThemeState) => void>();
  let current: ThemeState = { mode: "idle", audioLevel: 0, spectrumBins: flatSpectrum(0) };

  const api: ThemeApi = {
    apiVersion: THEME_API_VERSION,
    params,
    size,
    onState(cb: (state: ThemeState) => void) {
      listeners.add(cb);
      cb(current);
      return () => {
        listeners.delete(cb);
      };
    },
    actions: {
      cancel: actions.cancel,
    },
  };

  function setState(next: ThemeState): void {
    current = next;
    for (const cb of listeners) cb(current);
  }

  function setFromLevel(mode: ThemeMode, rms: number, muted: boolean): void {
    const level = muted ? 0 : rms;
    setState({ mode, audioLevel: level, spectrumBins: flatSpectrum(level) });
  }

  return { api, setState, setFromLevel };
}
