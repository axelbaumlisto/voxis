/**
 * Overlay webview entry point — Handy-style pill (172×36).
 *
 * Architecture (SOLID + DRY + KISS):
 * - SRP: this shell only wires events → hooks → HandyPill render.
 * - DIP: depends on `useOverlayState` (events), `useHandyBarMath` (theme),
 *        and `commands.cancelOperation` (Tauri command). No concrete backends.
 * - DRY: smoothing alpha + peak decay come from the active theme so the
 *        same value is used in JS (useSmoothBars) and CSS (--hp-* vars).
 *        Only ONE useOverlayState() instance — its snapshot flows down as
 *        props, no double-subscription to the event bus.
 * - KISS: zero local state. HandyPill is the sole visual component.
 */
import ReactDOM from "react-dom/client";
import {
  type OverlaySnapshot,
  useOverlayState,
} from "./hooks/useOverlayState";
import { useSmoothBars } from "./hooks/useSmoothBars";
import HandyPill from "./components/overlay/HandyPill";
import { commands } from "./bindings";
import {
  HandyThemeProvider,
  useHandyBarMath,
} from "./themes/HandyThemeProvider";
import { useFetchedHandyTheme } from "./themes/useFetchedHandyTheme";

const PILL_BAR_COUNT = 9; // Handy's pill renders 9 bars

/**
 * Inner component — must live below {@link HandyThemeProvider} so
 * {@link useHandyBarMath} sees the active theme.
 */
function PillContent({ snapshot }: { snapshot: OverlaySnapshot }) {
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
  return (
    <HandyPill
      mode={effectiveMode}
      bars={bars}
      visible={true}
      onCancel={() => {
        void commands.cancelOperation();
      }}
    />
  );
}

export function OverlayApp() {
  // Single source of truth for overlay state — themeId, mode, spectrum
  // and audioLevel all live in one snapshot, subscribed exactly once.
  const snapshot = useOverlayState();
  // E2E hook: `/overlay.html?theme=living_reed` forces a theme without
  // round-tripping through the Tauri command (useful for synthetic
  // Playwright tests that don't run the full voice process).
  const forcedTheme =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("theme")
      : null;
  const themeId = forcedTheme ?? snapshot.themeId;
  const theme = useFetchedHandyTheme(themeId);
  return (
    <HandyThemeProvider theme={theme}>
      <PillContent snapshot={snapshot} />
    </HandyThemeProvider>
  );
}

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(<OverlayApp />);
}
