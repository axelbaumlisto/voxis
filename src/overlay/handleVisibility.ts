// src/overlay/handleVisibility.ts
/**
 * Owns WHEN the overlay's hover handles (drag + resize grips) are visible, as a
 * framework-free controller — same shape as `gesture.ts`.
 *
 * Signals (see overlay_native/webview.rs for why each source exists):
 *  - `ping()`  — the pointer is over the overlay (GTK enter/motion, DOM move).
 *  - `leave()` — the pointer left (GTK leave, DOM mouseleave). Leaves are NOT
 *    trusted immediately: XWayland/WebKit emit spurious leave→enter pairs at
 *    surface boundaries, so a leave only HIDES after `leaveConfirmMs` with no
 *    new ping (hysteresis). A ping inside that window cancels it — no blink.
 *  - `setGesturing(on)` — a drag/resize pins the handles shown and ignores
 *    leaves; DOM pointer-capture swallows the motion pings meanwhile.
 *
 * `idleMs` is only a SAFETY NET for a leave that never arrives (XWayland can't
 * see the pointer off our surface). It's long so that holding the pointer
 * still over the orb (aiming at a handle) never hides them.
 */
export interface HandleVisibility {
  ping(): void;
  leave(): void;
  setGesturing(on: boolean): void;
  dispose(): void;
}

export interface HandleVisibilityOptions {
  /** Confirm a leave after this long without a new ping, then hide. */
  leaveConfirmMs: number;
  /** Fallback hide after this long with no ping at all (lost leave). */
  idleMs: number;
  show: () => void;
  hide: () => void;
  /** Injectable timers (defaults resolve globals at call time — fake-timer friendly). */
  setTimeoutFn?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void;
}

export function createHandleVisibility(opts: HandleVisibilityOptions): HandleVisibility {
  const setT =
    opts.setTimeoutFn ?? ((cb: () => void, ms: number) => setTimeout(cb, ms));
  const clearT =
    opts.clearTimeoutFn ??
    ((handle: ReturnType<typeof setTimeout>) => clearTimeout(handle));

  // ONE timer: the next scheduled hide (confirm-leave or idle fallback).
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let gesturing = false;
  let shown = false;

  const clearHide = () => {
    if (hideTimer !== null) {
      clearT(hideTimer);
      hideTimer = null;
    }
  };
  const scheduleHide = (ms: number) => {
    clearHide();
    if (gesturing) return; // pinned while a gesture runs
    hideTimer = setT(() => {
      hideTimer = null;
      shown = false;
      opts.hide();
    }, ms);
  };
  const show = () => {
    if (!shown) {
      shown = true;
      opts.show();
    }
  };

  return {
    ping() {
      show();
      scheduleHide(opts.idleMs);
    },
    leave() {
      if (!shown || gesturing) return;
      scheduleHide(opts.leaveConfirmMs);
    },
    setGesturing(on) {
      gesturing = on;
      if (on) {
        clearHide();
        show();
      } else {
        // The pointer is on the grip at release → still over the overlay.
        scheduleHide(opts.idleMs);
      }
    },
    dispose() {
      clearHide();
    },
  };
}
