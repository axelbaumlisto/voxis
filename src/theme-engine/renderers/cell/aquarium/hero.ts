import type { ObstacleCircle } from "./interaction";

export function heroConsumeObstacles(
  circles: readonly ObstacleCircle[],
  cx: number,
  cy: number,
  heroReach: number,
): { dx: number; dy: number } {
  let curX = cx;
  let curY = cy;

  for (const o of circles) {
    const dx = curX - o.x;
    const dy = curY - o.y;
    const d = Math.hypot(dx, dy);
    const minD = o.radius + heroReach;
    if (d < minD && d > 1e-6) {
      const push = minD - d;
      curX += (dx / d) * push;
      curY += (dy / d) * push;
    }
  }

  return { dx: curX - cx, dy: curY - cy };
}
