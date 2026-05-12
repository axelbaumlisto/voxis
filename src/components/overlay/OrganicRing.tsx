/**
 * OrganicRing — canvas-based organic ring visualizer for the webview overlay.
 *
 * Renders the same organic-ring family as the subprocess (egui) backend,
 * driven by `ringGeometry.ts`. Used by `OverlayCanvas` when the active theme
 * declares `family = "organic_ring"`.
 *
 * SOLID / DRY / KISS:
 * - SRP: only paints; no event subscription, no state aggregation.
 * - DRY: all math lives in `ringGeometry.ts` (single source of truth).
 * - KISS: a single `requestAnimationFrame` loop driven by `stateRef`; React
 *   state never goes into the effect dependency list, so we never re-bind
 *   the loop while the component is mounted.
 *
 * Why stateRef (not deps): canvas mutation is imperative; rebinding the
 * effect on every prop tick would cancel/re-create RAF and create visible
 * jitter. Keeping the loop alive across renders and snapshotting current
 * props through a ref is the canonical pattern.
 */
import { useEffect, useRef } from "react";
import type { OrganicRingMotion, OrganicRingShape } from "../../bindings";
import {
  buildRingPoints,
  ringStrokeWidth,
  type OverlayMode,
} from "./ringGeometry";

export interface OrganicRingProps {
  spectrumBins: number[];
  /** Smoothed audio level in [0, 1]; also drives speech energy. */
  audioLevel: number;
  mode: OverlayMode;
  themeShape: OrganicRingShape;
  themeMotion: OrganicRingMotion;
  /** CSS-compatible stroke color. */
  color: string;
  width?: number;
  height?: number;
}

interface FrameState {
  spectrumBins: number[];
  audioLevel: number;
  mode: OverlayMode;
  themeShape: OrganicRingShape;
  themeMotion: OrganicRingMotion;
  color: string;
}

function OrganicRing({
  spectrumBins,
  audioLevel,
  mode,
  themeShape,
  themeMotion,
  color,
  width = 200,
  height = 100,
}: OrganicRingProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);

  // Snapshot of current props for the RAF loop to read without re-binding.
  const stateRef = useRef<FrameState>({
    spectrumBins,
    audioLevel,
    mode,
    themeShape,
    themeMotion,
    color,
  });
  stateRef.current = {
    spectrumBins,
    audioLevel,
    mode,
    themeShape,
    themeMotion,
    color,
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const startedAt = performance.now();
    const cx = width / 2;
    const cy = height / 2;

    const tick = () => {
      const t = (performance.now() - startedAt) / 1000;
      const s = stateRef.current;

      ctx.clearRect(0, 0, width, height);

      const points = buildRingPoints(
        width,
        height,
        s.spectrumBins,
        t,
        s.audioLevel,
        { shape: s.themeShape, motion: s.themeMotion },
        s.mode,
      );

      if (points.length >= 2) {
        ctx.strokeStyle = s.color;
        ctx.lineCap = "round";

        for (let i = 0; i < points.length - 1; i++) {
          const [x1, y1] = points[i];
          const [x2, y2] = points[i + 1];
          // Use mid-segment angle (relative to centre) for stroke width modulation.
          const midAngle = Math.atan2((y1 + y2) / 2 - cy, (x1 + x2) / 2 - cx);
          ctx.lineWidth = ringStrokeWidth(midAngle, s.themeShape);
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [width, height]);

  return <canvas ref={canvasRef} width={width} height={height} />;
}

export default OrganicRing;
