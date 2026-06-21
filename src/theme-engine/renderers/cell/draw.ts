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
