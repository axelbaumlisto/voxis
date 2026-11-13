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
  /** Called once, after the last frame, with the final pointer position
   *  (`null` when the gesture never armed — a tap, not a drag). */
  onEnd: (point: { screenX: number; screenY: number } | null, start: GestureStart) => void;
  /**
   * Hold the press this long (ms) before the gesture ARMS and starts emitting
   * frames. `0`/omitted arms immediately on `begin` (the resize grip). The drag
   * grip uses a hold so a short click passes through instead of nudging the
   * window.
   */
  armMs?: number;
  /**
   * Abandon an un-armed gesture once the pointer travels past this many px: a
   * quick move before the hold matures is a tap-drag, not a hold-drag, so it
   * should pass through. `0`/omitted disables slop (arms-immediately grips).
   */
  slopPx?: number;
  /** Fired once when the gesture arms (after the hold) — e.g. flip a style. */
  onArm?: () => void;
  /** Fired once when an un-armed gesture is abandoned by slop (a tap). */
  onAbandon?: () => void;
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
  const armMs = handlers.armMs ?? 0;
  const slop = handlers.slopPx ?? 0;

  let start: GestureStart | null = null;
  let pending: { screenX: number; screenY: number } | null = null;
  let raf: number | null = null;
  let armed = false;
  let armTimer: ReturnType<typeof setTimeout> | null = null;

  const cancelRaf = () => {
    if (raf !== null) {
      cancelAnimationFrame(raf);
      raf = null;
    }
  };
  const clearArm = () => {
    if (armTimer !== null) {
      clearTimeout(armTimer);
      armTimer = null;
    }
  };
  const teardown = () => {
    cancelRaf();
    clearArm();
    start = null;
    pending = null;
    armed = false;
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
      armed = armMs <= 0;
      if (!armed) {
        armTimer = setTimeout(() => {
          armTimer = null;
          armed = true;
          handlers.onArm?.();
        }, armMs);
      }
      return true;
    },
    move(event) {
      if (!start || event.pointerId !== start.pointerId) return;
      if (!armed) {
        // Pre-arm: a move past the slop means this is a tap, not a hold → let it
        // pass through by abandoning the gesture.
        const dx = event.screenX - start.screenX;
        const dy = event.screenY - start.screenY;
        if (slop > 0 && dx * dx + dy * dy > slop * slop) {
          teardown();
          handlers.onAbandon?.();
        }
        return;
      }
      pending = { screenX: event.screenX, screenY: event.screenY };
      schedule();
    },
    end() {
      const s = start;
      const last = armed ? pending : null;
      cancelRaf();
      clearArm();
      // Flush the last position so a fast release cannot lose the final delta.
      if (s && last) handlers.onFrame(last, s);
      start = null;
      pending = null;
      armed = false;
      handlers.onEnd(last, s ?? { pointerId: 0, screenX: 0, screenY: 0 });
    },
    cancel() {
      teardown();
    },
  };
}
