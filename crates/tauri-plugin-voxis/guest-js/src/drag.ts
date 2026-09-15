// crates/tauri-plugin-voxis/guest-js/src/drag.ts
/**
 * Overlay drag: a pure geometry function (`clampToViewport`,
 * `snapToNearestEdge` — plan Task 5 step 3) plus a small Pointer Events
 * controller (mouse/touch/pen all fire the same `Pointer*` events) that
 * persists position in `localStorage[storageKey]`, snaps to the nearest
 * horizontal edge on release, and clamps against a caller-supplied safe
 * area (`env(safe-area-inset-*)`, read by `overlay.ts` at mount — kept
 * out of this module so the pure math stays trivially unit-testable
 * without a DOM) and viewport (`visualViewport` when available, so the
 * overlay stays clear of the iOS on-screen keyboard, which shrinks
 * `visualViewport` but not `window.innerHeight`).
 */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** `env(safe-area-inset-*)`, already resolved to px by the caller. */
export interface SafeArea {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export const ZERO_SAFE_AREA: SafeArea = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Clamps `pos` (top-left of a `size`-shaped box) so the box stays fully
 * inside `viewport`, inset by `safeArea` on every side. `viewport` should
 * already be the *effective* viewport (i.e. `visualViewport`'s width/
 * height when present) so a shrunk-by-keyboard viewport clamps the
 * overlay above the keyboard rather than letting it sit underneath it.
 */
export function clampToViewport(pos: Point, size: Size, safeArea: SafeArea, viewport: Viewport): Point {
  const minX = safeArea.left;
  const minY = safeArea.top;
  const maxX = Math.max(minX, viewport.width - safeArea.right - size.width);
  const maxY = Math.max(minY, viewport.height - safeArea.bottom - size.height);
  return {
    x: Math.min(Math.max(pos.x, minX), maxX),
    y: Math.min(Math.max(pos.y, minY), maxY),
  };
}

/**
 * Snaps a (clamped) position to whichever horizontal edge (left/right,
 * inset by `safeArea`) its center is closer to, keeping `y` unchanged —
 * the same "settle at the nearest edge on release" behaviour as naked's
 * `KeyPanel`.
 */
export function snapToNearestEdge(pos: Point, size: Size, safeArea: SafeArea, viewport: Viewport): Point {
  const clamped = clampToViewport(pos, size, safeArea, viewport);
  const centerX = clamped.x + size.width / 2;
  const usableWidth = Math.max(0, viewport.width - safeArea.left - safeArea.right);
  const isLeftHalf = centerX - safeArea.left <= usableWidth / 2;
  const x = isLeftHalf ? safeArea.left : Math.max(safeArea.left, viewport.width - safeArea.right - size.width);
  return { x, y: clamped.y };
}

function storageKeyFor(key: string): string {
  return `voxis-overlay-position:${key}`;
}

/** Reads a persisted position, or `null` if absent/corrupt (never throws). */
export function loadPosition(storageKey: string): Point | null {
  try {
    const raw = localStorage.getItem(storageKeyFor(storageKey));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Point).x === "number" &&
      typeof (parsed as Point).y === "number"
    ) {
      return parsed as Point;
    }
    return null;
  } catch {
    return null;
  }
}

export function savePosition(storageKey: string, pos: Point): void {
  try {
    localStorage.setItem(storageKeyFor(storageKey), JSON.stringify(pos));
  } catch {
    // Best-effort — private browsing / quota errors must not break dragging.
  }
}

export interface DragControllerOptions {
  storageKey: string;
  getSize(): Size;
  getSafeArea(): SafeArea;
  getViewport(): Viewport;
  /** Below this many CSS px of pointer travel, a gesture counts as a tap, not a drag. */
  dragThresholdPx?: number;
  onDragStart?(): void;
  onDragMove?(pos: Point): void;
  /** Fires on every pointer-up/cancel that started on this element; `dragged` tells the caller whether to treat it as a tap. */
  onDragEnd?(pos: Point, dragged: boolean): void;
}

export interface DragController {
  readonly isDragging: boolean;
  /** Re-applies the persisted (or current) position — call after the element's size becomes known/changes. */
  reposition(): void;
  destroy(): void;
}

/**
 * Wires pointerdown/move/up/cancel on `element` (Pointer Events cover
 * mouse, touch, and pen with one code path). Uses `setPointerCapture` so
 * the gesture keeps tracking even if the pointer leaves the element's
 * bounds mid-drag; falls back silently if the environment doesn't
 * support it (older WebKit, or jsdom in tests) — the pointer events
 * still fire on `element` for a capture-less gesture as long as the
 * pointer stays over it, which is enough for unit tests driven by
 * synthetic events at fixed coordinates.
 */
export function createDragController(element: HTMLElement, options: DragControllerOptions): DragController {
  let activePointerId: number | null = null;
  let startPointer: Point | null = null;
  let startPos: Point | null = null;
  let dragged = false;

  function applyPos(pos: Point): Point {
    const clamped = clampToViewport(pos, options.getSize(), options.getSafeArea(), options.getViewport());
    element.style.left = `${clamped.x}px`;
    element.style.top = `${clamped.y}px`;
    return clamped;
  }

  function currentElementPos(): Point {
    const left = parseFloat(element.style.left || "0");
    const top = parseFloat(element.style.top || "0");
    return { x: Number.isFinite(left) ? left : 0, y: Number.isFinite(top) ? top : 0 };
  }

  function reposition(): void {
    const stored = loadPosition(options.storageKey);
    applyPos(stored ?? currentElementPos());
  }

  function tryCapture(pointerId: number) {
    const el = element as HTMLElement & { setPointerCapture?: (id: number) => void };
    try {
      el.setPointerCapture?.(pointerId);
    } catch {
      // Not supported (e.g. jsdom) — pointer events still bubble normally.
    }
  }

  function tryReleaseCapture(pointerId: number) {
    const el = element as HTMLElement & { releasePointerCapture?: (id: number) => void };
    try {
      el.releasePointerCapture?.(pointerId);
    } catch {
      // ignore
    }
  }

  function onPointerDown(e: PointerEvent) {
    if (activePointerId !== null) return;
    activePointerId = e.pointerId;
    dragged = false;
    startPointer = { x: e.clientX, y: e.clientY };
    startPos = currentElementPos();
    tryCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (e.pointerId !== activePointerId || !startPointer || !startPos) return;
    const dx = e.clientX - startPointer.x;
    const dy = e.clientY - startPointer.y;
    if (!dragged && Math.hypot(dx, dy) >= (options.dragThresholdPx ?? 6)) {
      dragged = true;
      options.onDragStart?.();
    }
    if (dragged) {
      const pos = applyPos({ x: startPos.x + dx, y: startPos.y + dy });
      options.onDragMove?.(pos);
    }
  }

  function endGesture(e: PointerEvent) {
    if (e.pointerId !== activePointerId) return;
    const wasDragged = dragged;
    let finalPos = currentElementPos();
    if (wasDragged) {
      finalPos = snapToNearestEdge(finalPos, options.getSize(), options.getSafeArea(), options.getViewport());
      applyPos(finalPos);
      savePosition(options.storageKey, finalPos);
    }
    tryReleaseCapture(e.pointerId);
    activePointerId = null;
    startPointer = null;
    startPos = null;
    dragged = false;
    options.onDragEnd?.(finalPos, wasDragged);
  }

  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("pointermove", onPointerMove);
  element.addEventListener("pointerup", endGesture);
  element.addEventListener("pointercancel", endGesture);

  reposition();

  return {
    get isDragging() {
      return dragged;
    },
    reposition,
    destroy() {
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", endGesture);
      element.removeEventListener("pointercancel", endGesture);
    },
  };
}

/** Reads `env(safe-area-inset-*)` via a throwaway probe element — the standard trick, since there's no JS API for it. */
export function readSafeAreaInsets(doc: Document = document): SafeArea {
  const probe = doc.createElement("div");
  probe.style.position = "fixed";
  probe.style.top = "0";
  probe.style.left = "0";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.paddingTop = "env(safe-area-inset-top, 0px)";
  probe.style.paddingRight = "env(safe-area-inset-right, 0px)";
  probe.style.paddingBottom = "env(safe-area-inset-bottom, 0px)";
  probe.style.paddingLeft = "env(safe-area-inset-left, 0px)";
  doc.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const result: SafeArea = {
    top: parseFloat(style.paddingTop) || 0,
    right: parseFloat(style.paddingRight) || 0,
    bottom: parseFloat(style.paddingBottom) || 0,
    left: parseFloat(style.paddingLeft) || 0,
  };
  doc.body.removeChild(probe);
  return result;
}

/**
 * The overlay's effective viewport: `window.visualViewport` when present
 * (shrinks when the iOS on-screen keyboard opens) so the clamp keeps the
 * pill above the keyboard, falling back to `window.innerWidth/Height`.
 */
export function readEffectiveViewport(win: Window = window): Viewport {
  const vv = win.visualViewport;
  if (vv) return { width: vv.width, height: vv.height };
  return { width: win.innerWidth, height: win.innerHeight };
}
