import { hsla, TAU } from "../shared";
import type { CellParams } from "./types";

type CellPathPoint = [number, number];

type PathContext = Pick<CanvasRenderingContext2D, "beginPath" | "moveTo" | "lineTo" | "closePath">;
type ClipContext = PathContext & { clip?: CanvasRenderingContext2D["clip"] };

export function pathFromPoints(ctx: PathContext, points: CellPathPoint[]): void {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i][0], points[i][1]);
  }
  ctx.closePath();
}

export function clipToCellPath(ctx: ClipContext, splinePoints: CellPathPoint[]): void {
  pathFromPoints(ctx, splinePoints);
  if (typeof ctx.clip === "function") ctx.clip();
}

export function drawCVCanals(
  ctx: CanvasRenderingContext2D,
  vx: number,
  vy: number,
  r: number,
  cvH: number,
  params: CellParams,
): void {
  // CV radial canals — star shape (biologist: 6-7 canals, visible during diastole)
  if (!params.enableCVCanals || r <= 1.0) return;
  const canalCount = 6;
  const canalLen = r * (params.canalLenMul ?? 2.0);
  const canalAlpha = params.nucleusAlpha * 0.45 * (params.canalAlphaMul ?? 0.3);
  ctx.strokeStyle = hsla(cvH, 0.30, 0.72, canalAlpha);
  ctx.lineWidth = params.canalLineWidth ?? 0.5;
  for (let ci = 0; ci < canalCount; ci++) {
    const angle = (ci / canalCount) * TAU;
    ctx.beginPath();
    ctx.moveTo(vx, vy);
    ctx.lineTo(vx + Math.cos(angle) * canalLen, vy + Math.sin(angle) * canalLen);
    ctx.stroke();
  }
}
