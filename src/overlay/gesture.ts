// src/overlay/gesture.ts
/**
 * The pointer plumbing BOTH overlay grips need, in one place.
 *
 * A grip is: capture the pointer, coalesce moves to one call per animation
 * frame, and stop cleanly. `DragGrip` (position) and `ResizeGrip` (size) differ
 * only in WHAT they compute from the pointer — so the transport lives here and
 * the geometry stays with each grip. Two hand-rolled copies of capture + rAF +
 * teardown is exactly how a fix lands in one grip and not the other.
 *
 * Deliberately framework-free (no React import): the hook shape is imposed by
 * `overlay.tsx` with a five-line `useCallback`-based adapter, and the core stays
 * unit-testable in jsdom.
 */

export interface GestureStart {
  pointerId: number;
  screenX: number;
  screenY: number;
}

export interface GestureHandlers {
  /** Called once per animation frame with the latest pointer position. */
  onFrame: (point: { screenX: number; screenY: number }, start: GestureStart) => void;
  /** Called once, after the last frame, with the final pointer position. */
  onEnd: (point: { screenX: number; screenY: number } | null, start: GestureStart) => void;
}

export interface Gesture {
  /** Begins a gesture; returns `false` when the event is not a primary press. */
  begin(event: {
    button: number;
    pointerId: number;
    screenX: number;
    screenY: number;
    currentTarget: EventTarget | null;
  }): boolean;
  move(event: { pointerId: number; screenX: number; screenY: number }): void;
  end(): void;
  cancel(): void;
  /** True while a gesture is in flight. */
  readonly active: boolean;
}

export function createGesture(handlers: GestureHandlers): Gesture {
  let start: GestureStart | null = null;
  let pending: { screenX: number; screenY: number } | null = null;
  let raf: number | null = null;

  const cancelRaf = () => {
    if (raf !== null) {
      cancelAnimationFrame(raf);
      raf = null;
    }
  };

  const flush = () => {
    raf = null;
    if (!start || !pending) return;
    handlers.onFrame(pending, start);
  };

  const schedule = () => {
    if (raf === null) raf = requestAnimationFrame(flush);
  };

  return {
    get active() {
      return start !== null;
    },
    begin(event) {
      if (event.button !== 0) return false;
      try {
        (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
      } catch {
        /* capture may already be gone; the gesture still tracks */
      }
      start = { pointerId: event.pointerId, screenX: event.screenX, screenY: event.screenY };
      pending = null;
      return true;
    },
    move(event) {
      if (!start || event.pointerId !== start.pointerId) return;
      pending = { screenX: event.screenX, screenY: event.screenY };
      schedule();
    },
    end() {
      const s = start;
      const last = pending;
      cancelRaf();
      // Flush the last position so a fast release cannot lose the final delta.
      if (s && last) handlers.onFrame(last, s);
      start = null;
      pending = null;
      handlers.onEnd(last, s ?? { pointerId: 0, screenX: 0, screenY: 0 });
    },
    cancel() {
      cancelRaf();
      start = null;
      pending = null;
    },
  };
}
