/**
 * Overlay webview entry point — Handy-style pill (172×36).
 *
 * Architecture (SOLID + DRY + KISS):
 * - SRP: this shell only wires events → hooks → HandyPill render.
 * - DIP: depends on `useOverlayState` (events), `useHandyBarMath` (theme),
 *        and `commands.cancelOperation` (Tauri command). No concrete backends.
 * - DRY: smoothing alpha + peak decay come from the active theme so the
 *        same value is used in JS (useSmoothBars) and CSS (--hp-* vars).
 * - KISS: zero local state. HandyPill is the sole visual component.
 *
 * Theme loading (Phase 5 will replace the static DEFAULT with a Tauri
 * fetch + overlay://theme subscription).
 */
import ReactDOM from "react-dom/client";
import { useOverlayState } from "./hooks/useOverlayState";
import { useSmoothBars } from "./hooks/useSmoothBars";
import HandyPill from "./components/overlay/HandyPill";
import { commands } from "./bindings";
import {
  DEFAULT_HANDY_THEME,
  HandyThemeProvider,
  useHandyBarMath,
} from "./themes/HandyThemeProvider";

const PILL_BAR_COUNT = 9; // Handy's pill renders 9 bars

/**
 * Inner component — must live below {@link HandyThemeProvider} so
 * {@link useHandyBarMath} sees the active theme. Pulled out so the
 * Provider stays a single-purpose wrapper.
 */
function OverlayContent() {
  const snapshot = useOverlayState();
  const math = useHandyBarMath();
  // E2E hook: `/overlay.html?mode=recording` forces recording mode without
  // depending on Tauri events. Used by Playwright pixel tests.
  const forcedMode =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("mode")
      : null;
  const effectiveMode = (forcedMode ?? snapshot.mode) as typeof snapshot.mode;
  const effectiveBins =
    forcedMode === "recording"
      ? Array.from({ length: 32 }, (_, i) => 0.4 + 0.3 * Math.sin(i))
      : snapshot.spectrumBins;
  const bars = useSmoothBars(effectiveBins, {
    size: PILL_BAR_COUNT,
    alpha: math.smoothing_alpha,
    peak_decay: math.peak_decay,
  });
  // Pill is always visible at the OS level (matches user expectation: a
  // persistent indicator that shows status; animation changes per mode but
  // the pill itself never fades out). The `mode` prop drives which icon
  // and whether bars are drawn (HandyPill internally).
  const visible = true;

  return (
    <HandyPill
      mode={effectiveMode}
      bars={bars}
      visible={visible}
      onCancel={() => {
        void commands.cancelOperation();
      }}
    />
  );
}

export function OverlayApp() {
  // Phase 5 will replace the constant with `useFetchedHandyTheme(themeId)`.
  return (
    <HandyThemeProvider theme={DEFAULT_HANDY_THEME}>
      <OverlayContent />
    </HandyThemeProvider>
  );
}

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(<OverlayApp />);
}
