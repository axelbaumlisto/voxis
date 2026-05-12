/**
 * Overlay webview entry point — Handy-style pill (172×36).
 *
 * Architecture (SOLID + KISS):
 * - SRP: this shell only wires events → hooks → HandyPill render.
 * - DIP: depends on `useOverlayState` (events) and `commands.cancelOperation`
 *        (Tauri command), not on any concrete backend.
 * - KISS: zero local state. HandyPill is the sole visual component.
 */
import ReactDOM from "react-dom/client";
import { useOverlayState } from "./hooks/useOverlayState";
import { useSmoothBars } from "./hooks/useSmoothBars";
import HandyPill from "./components/overlay/HandyPill";
import { commands } from "./bindings";

const SMOOTH_ALPHA = 0.3; // Handy's smoothing factor
const PILL_BAR_COUNT = 9; // Handy's pill renders 9 bars

export function OverlayApp() {
  const snapshot = useOverlayState();
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
    alpha: SMOOTH_ALPHA,
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

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(<OverlayApp />);
}
