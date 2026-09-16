// crates/tauri-plugin-voxis/guest-js/src/overlay-geometry.ts
/**
 * Pure overlay geometry — the compact/expanded size, shape, corner
 * placement and grow/shrink math `<voxis-overlay>` (`overlay.ts`) uses,
 * extracted here as viewport-injectable functions with no DOM/custom-
 * element dependency so they can be unit-tested on their own (see
 * `__tests__/overlay-geometry.test.ts`). The element itself owns the
 * shadow DOM, indicator, lifecycle transitions and theme mount — it just
 * delegates the maths to this module.
 */
import { clampToViewport, type Point, type SafeArea, type Size, type Viewport } from "./drag";

/** The pill's fixed idle/error size — see `overlay.ts`'s module doc comment's "Compact/expanded lifecycle" section. */
export const COMPACT_SIZE: Size = { width: 56, height: 56 };

/** Named starting corners for `MountOverlayOptions.initialPosition` — see that option's doc comment. */
export type OverlayCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/** `"compact"` (idle handle, theme unmounted) or `"expanded"` (theme mounted at its manifest size) — see `overlay.ts`'s module doc comment. */
export type OverlayLifecycleState = "compact" | "expanded";

const CORNER_MARGIN = 16;

/**
 * Resolves a named corner to a top-left `{x, y}` in `viewport`, inset by
 * `CORNER_MARGIN` on the relevant edges — the same math the element's
 * bottom-right default has always used (pre-`initialPosition`, this was
 * inlined as a private `defaultPosition()` method; extracted as a pure,
 * viewport-injectable function so both `"bottom-right"`'s default
 * behaviour and every other named corner share one implementation, and
 * so it's unit-testable without mounting the custom element). The
 * caller (`connectedCallback`) still runs the result through
 * `clampToViewport` with the real safe area, so this function itself
 * doesn't need to know about safe-area insets.
 */
export function cornerPosition(corner: OverlayCorner, size: Size, viewport: Viewport): Point {
  const x = corner === "top-left" || corner === "bottom-left" ? CORNER_MARGIN : viewport.width - size.width - CORNER_MARGIN;
  const y = corner === "top-left" || corner === "top-right" ? CORNER_MARGIN : viewport.height - size.height - CORNER_MARGIN;
  return { x, y };
}

/**
 * Grows (or shrinks) a box from `fromSize` at `pos` to `toSize`, pivoting
 * around whichever edge — independently on each axis — `pos`'s center is
 * already closer to, so the box extends *away* from the nearer edge
 * instead of risking going off-screen (e.g. a pill resting near the
 * right edge grows leftward, keeping its right edge roughly fixed).
 * Pure/unclamped — the caller (`growToExpandedPosition`) still runs the
 * result through the existing `clampToViewport`, so an anchor edge itself
 * right at the viewport boundary still ends up on-screen.
 */
export function anchorGrow(pos: Point, fromSize: Size, toSize: Size, viewport: Viewport): Point {
  const centerX = pos.x + fromSize.width / 2;
  const centerY = pos.y + fromSize.height / 2;
  const nearerRight = viewport.width - centerX < centerX;
  const nearerBottom = viewport.height - centerY < centerY;
  const x = nearerRight ? pos.x + fromSize.width - toSize.width : pos.x;
  const y = nearerBottom ? pos.y + fromSize.height - toSize.height : pos.y;
  return { x, y };
}

/**
 * A circle for a square box no larger than 96px a side (the 56×56
 * compact handle, and any theme whose manifest size happens to be a
 * small square) — a rounded rect (16px radius) for everything else,
 * i.e. any non-square size or a square larger than 96px (e.g.
 * lavalamp/metaballs*'s 120×120).
 */
export function shapeRadius(size: Size): string {
  return size.width === size.height && size.width <= 96 ? "50%" : "16px";
}

/** The pill's on-screen size for a given lifecycle state — `COMPACT_SIZE` while compact, the resolved theme's manifest size while expanded. */
export function resolveCurrentSize(lifecycle: OverlayLifecycleState, expandedSize: Size): Size {
  return lifecycle === "expanded" ? expandedSize : COMPACT_SIZE;
}

/** Resolves `MountOverlayOptions.initialPosition` to a top-left `{x, y}` — a named corner via `cornerPosition`, an explicit point as-is, `undefined` -> the `"bottom-right"` default. The caller still clamps the result. */
export function resolveInitialPosition(initialPosition: Point | OverlayCorner | undefined, size: Size, viewport: Viewport): Point {
  if (initialPosition === undefined) return cornerPosition("bottom-right", size, viewport);
  if (typeof initialPosition === "string") return cornerPosition(initialPosition, size, viewport);
  return initialPosition;
}

/**
 * `"compact"` -> `"expanded"` position: grows from `COMPACT_SIZE` to
 * `expandedSize` pivoting around whichever edge `compactPos` is closest
 * to (`anchorGrow`), then clamps to the viewport/safe area the same way
 * every other position the element computes is.
 */
export function growToExpandedPosition(compactPos: Point, expandedSize: Size, safeArea: SafeArea, viewport: Viewport): Point {
  const grown = anchorGrow(compactPos, COMPACT_SIZE, expandedSize, viewport);
  return clampToViewport(grown, expandedSize, safeArea, viewport);
}

/** `"expanded"` -> `"compact"` position: clamps the restore point to the viewport/safe area using `COMPACT_SIZE`. */
export function shrinkToCompactPosition(restorePos: Point, safeArea: SafeArea, viewport: Viewport): Point {
  return clampToViewport(restorePos, COMPACT_SIZE, safeArea, viewport);
}
