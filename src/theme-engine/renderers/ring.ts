/**
 * createRingRenderer — vanilla-DOM canvas renderer for the organic ring family.
 * Ported from OrganicRing.tsx; replaces the React useEffect/useRef RAF loop
 * with a plain closure-based loop.
 *
 * SRP: only canvas rendering; all geometry math lives in ringGeometry.ts.
 */
import { buildRingPoints, ringStrokeWidth } from "./ringGeometry";
import type { OrganicRingMotion, OrganicRingShape } from "./ringGeometry";
import type { ThemeState } from "../contract";
import type { Renderer } from "./bars";

export interface RingOptions {
  shape: OrganicRingShape;
  motion: OrganicRingMotion;
  color: string;
  width: number;
  height: number;
}

export function createRingRenderer(container: HTMLElement, opts: RingOptions): Renderer {
  const { shape, motion, color, width, height } = opts;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.style.display = "block";
  container.appendChild(canvas);

  const ctx = canvas.getContext("2d");

  let latestState: ThemeState = {
    mode: "idle",
    audioLevel: 0,
    spectrumBins: new Array(32).fill(0),
  };

  const startedAt = performance.now();
  const cx = width / 2;
  const cy = height / 2;

  let rafId: number | null = null;

  const tick = () => {
    const t = (performance.now() - startedAt) / 1000;
    const s = latestState;

    if (ctx) {
      ctx.clearRect(0, 0, width, height);

      const points = buildRingPoints(
        width,
        height,
        s.spectrumBins,
        t,
        s.audioLevel,
        { shape, motion },
        s.mode,
      );

      if (points.length >= 2) {
        ctx.strokeStyle = color;
        ctx.lineCap = "round";

        for (let i = 0; i < points.length - 1; i++) {
          const [x1, y1] = points[i];
          const [x2, y2] = points[i + 1];
          const midAngle = Math.atan2((y1 + y2) / 2 - cy, (x1 + x2) / 2 - cx);
          ctx.lineWidth = ringStrokeWidth(midAngle, shape);
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
      }
    }

    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);

  return {
    update(state: ThemeState): void {
      latestState = state;
    },
    destroy(): void {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      container.innerHTML = "";
    },
  };
}
