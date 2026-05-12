/**
 * OverlayCanvas — single dispatcher that turns an (OverlaySnapshot, theme)
 * pair into the right renderer.
 *
 * SOLID / DRY / KISS:
 * - OCP: adding a new visualization family means adding a new switch branch,
 *   never touching the existing spectrum components.
 * - SRP: this component only routes; rendering is delegated.
 * - DRY: reuses RecordingSpectrum / IdleSpectrum / TranscribingSpectrum /
 *   ErrorSpectrum as-is; OrganicRing is the new canvas-based family.
 * - KISS: stateless function — props in, JSX out.
 */
import type { OverlayThemeData } from "../../bindings";
import type { OverlaySnapshot } from "../../hooks/useOverlayState";
import ErrorSpectrum from "../spectrum/ErrorSpectrum";
import IdleSpectrum from "../spectrum/IdleSpectrum";
import RecordingSpectrum from "../spectrum/RecordingSpectrum";
import TranscribingSpectrum from "../spectrum/TranscribingSpectrum";
import OrganicRing from "./OrganicRing";

export interface OverlayCanvasProps {
  snapshot: OverlaySnapshot;
  /** Active theme. When `null` we render `IdleSpectrum` as a safe default. */
  theme: OverlayThemeData | null;
}

/** Mode-appropriate stroke color from theme.colors. */
function modeColor(mode: OverlaySnapshot["mode"], theme: OverlayThemeData): string {
  switch (mode) {
    case "recording":
      return theme.colors.recording;
    case "transcribing":
      return theme.colors.transcribing;
    case "idle":
    case "error":
    default:
      return theme.colors.idle;
  }
}

function renderBars(snapshot: OverlaySnapshot, useGradient: boolean) {
  switch (snapshot.mode) {
    case "recording":
      return (
        <RecordingSpectrum bins={snapshot.spectrumBins} useGradient={useGradient} />
      );
    case "transcribing":
      // Phase of the transcribing pulse — derived deterministically from the
      // current audio level so the existing component contract is preserved
      // without introducing a separate animation loop here.
      return <TranscribingSpectrum pulsePhase={snapshot.audioLevel * Math.PI * 2} />;
    case "error":
      return <ErrorSpectrum />;
    case "idle":
    default:
      return <IdleSpectrum />;
  }
}

function OverlayCanvas({ snapshot, theme }: OverlayCanvasProps) {
  // Defensive default: no theme yet → idle bars.
  if (!theme) return <IdleSpectrum />;

  if (theme.family === "organic_ring") {
    // Family declared organic_ring but data missing → degrade to idle bars
    // instead of crashing on undefined shape/motion.
    if (!theme.organic_ring) return <IdleSpectrum />;
    return (
      <OrganicRing
        spectrumBins={snapshot.spectrumBins}
        audioLevel={snapshot.audioLevel}
        mode={snapshot.mode}
        themeShape={theme.organic_ring.shape}
        themeMotion={theme.organic_ring.motion}
        color={modeColor(snapshot.mode, theme)}
      />
    );
  }

  // Default family: "bars" (also fallback for unknown families).
  return renderBars(snapshot, theme.colors.use_gradient);
}

export default OverlayCanvas;
