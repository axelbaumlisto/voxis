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
import ClassicBars from "./components/overlay/ClassicBars";
import OrganicRing from "./components/overlay/OrganicRing";
import { commands } from "./bindings";
import {
  HandyThemeProvider,
  useHandyBarMath,
  useHandyTheme,
} from "./themes/HandyThemeProvider";
import { useFetchedHandyTheme } from "./themes/useFetchedHandyTheme";

const PILL_BAR_COUNT = 9; // Handy's pill renders 9 bars

/**
 * Inner component — must live below {@link HandyThemeProvider} so
 * {@link useHandyBarMath} and {@link useHandyTheme} see the active theme.
 *
 * Family router (SOLID/OCP):
 *  - `bars` family   → <ClassicBars> (Winamp-style spectrum analyzer)
 *  - `organic_ring`  → <HandyPill>  (fallback until OrganicRing wires in)
 *  - `handy`         → <HandyPill>  (icon + bars + cancel)
 */
function PillContent({ snapshot }: { snapshot: OverlaySnapshot }) {
  const math = useHandyBarMath();
  const theme = useHandyTheme();
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

  // For bars family use more bars; for the others stay at PILL_BAR_COUNT.
  const barCount =
    theme.family === "bars" ? theme.bars.count : PILL_BAR_COUNT;
  const bars = useSmoothBars(effectiveBins, {
    size: barCount,
    alpha: math.smoothing_alpha,
    peak_decay: math.peak_decay,
  });

  if (theme.family === "bars") {
    return (
      <div
        className="recording-overlay"
        data-family="bars"
        data-mode={effectiveMode}
      >
        <ClassicBars
          bars={bars}
          gradient={{
            bottom: theme.bars.gradient_bottom,
            middle: theme.bars.gradient_middle,
            top: theme.bars.gradient_top,
          }}
          barCount={barCount}
        />
      </div>
    );
  }

  if (theme.family === "organic_ring") {
    // OrganicRing expects the legacy OrganicRingShape/Motion DTO types.
    // Our HandyPillRing has the same field names, so we can pass it
    // through directly; the DTO is just a serde-renamed view.
    return (
      <div
        className="recording-overlay"
        data-family="organic_ring"
        data-mode={effectiveMode}
      >
        <OrganicRing
          spectrumBins={bars}
          audioLevel={snapshot.audioLevel}
          mode={effectiveMode}
          themeShape={{
            gap_degrees: theme.ring.gap_degrees,
            base_thickness: theme.ring.base_thickness,
            taper: theme.ring.taper,
            roundness: theme.ring.roundness,
            active_zones: theme.ring.active_zones,
          }}
          themeMotion={{
            speech_responsiveness: theme.ring.speech_responsiveness,
            drift: theme.ring.drift,
            settle_speed: theme.ring.settle_speed,
            // idle_breathing is in the common animation block, not ring.
            idle_breathing: theme.animation.idle_breathing_amplitude,
          }}
          color={theme.palette.icon_color}
          width={172}
          height={36}
        />
      </div>
    );
  }

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
