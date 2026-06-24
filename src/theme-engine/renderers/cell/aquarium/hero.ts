import { sourceId } from "./interaction";
import type { FieldContribution, ObstacleCircle } from "./interaction";
import type { AquariumFrame } from "./types";

export function heroContribute(hero: AquariumFrame["hero"]): FieldContribution[] {
  if (!hero) return [];
  const heroId = sourceId("hero", 0);
  return [
    {
      kind: "obstacle",
      shape: "ellipse",
      x: hero.x,
      y: hero.y,
      halfLen: hero.halfLen ?? hero.radius,
      halfWid: hero.halfWid ?? hero.radius,
      heading: hero.heading ?? 0,
      social: true,
      sourceId: heroId,
    },
    {
      kind: "wake",
      x: hero.x,
      y: hero.y,
      heading: hero.heading ?? 0,
      sourceId: heroId,
    },
    {
      kind: "motile",
      x: hero.x,
      y: hero.y,
      heading: hero.heading ?? 0,
      radius: Math.max(hero.halfWid ?? hero.radius, (hero.halfLen ?? hero.radius) * 0.35),
      speed: 0,
      role: "prey",
      strength: 1,
      sourceId: heroId,
    },
  ];
}

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
