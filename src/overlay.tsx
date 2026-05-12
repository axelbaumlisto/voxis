/**
 * Overlay webview entry point \u2014 Handy-style pill (172\u00d736).
 *
 * Architecture (SOLID + KISS):
 * - SRP: this shell only wires events \u2192 hooks \u2192 HandyPill render.
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
  const bars = useSmoothBars(snapshot.spectrumBins, {
    size: PILL_BAR_COUNT,
    alpha: SMOOTH_ALPHA,
  });
  const visible = snapshot.mode !== "idle";

  return (
    <HandyPill
      mode={snapshot.mode}
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
