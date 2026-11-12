// src/overlay/resize.ts
/**
 * Corner-resize math for the overlay, as pure functions.
 *
 * WHY NOT `startResizeDragging()`: the overlay is `decorations:false` +
 * `transparent:true` + `macOSPrivateApi:true`. In exactly that configuration
 * AppKit accepts the gesture and then silently declines to resize (a known
 * behaviour — the same finding is documented in egroup-labs/kept's
 * ResizeGrips). So the grip drives the geometry itself: capture the pointer,
 * coalesce moves through rAF, compute the square edge, and ask the host to
 * resize. The host persists the result on release.
 *
 * The overlay is always SQUARE: every theme draws into a square canvas and the
 * orb shaders normalise by `min(w, h)`, so a rectangular window would squash
 * them. One edge length is the whole state.
 */

/** Smallest overlay the user may resize to (mirrors Rust `MIN_OVERLAY_SIZE`). */
export const MIN_OVERLAY_EDGE = 56;
/** Largest (mirrors Rust `MAX_OVERLAY_SIZE`). */
export const MAX_OVERLAY_EDGE = 1024;

export function clampOverlayEdge(value: number): number {
  if (!Number.isFinite(value)) return MIN_OVERLAY_EDGE;
  return Math.min(MAX_OVERLAY_EDGE, Math.max(MIN_OVERLAY_EDGE, Math.round(value)));
}

/**
 * The square edge after dragging the bottom-right corner by `(dx, dy)`
 * logical px from `start`. The DOMINANT axis wins, so a diagonal drag feels
 * right in both directions and a mostly-horizontal drag still resizes.
 */
export function resizeEdgeFromDelta(start: number, dx: number, dy: number): number {
  const dominant = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
  return clampOverlayEdge(start + dominant);
}

/** Distance from the top-left corner of the window to a pointer, in CSS px. */
export function pointerOffsetFromTopLeft(
  pointer: { clientX: number; clientY: number },
): { dx: number; dy: number } {
  const w = typeof window === "undefined" ? 0 : window.innerWidth;
  const h = typeof window === "undefined" ? 0 : window.innerHeight;
  return { dx: pointer.clientX - w, dy: pointer.clientY - h };
}
