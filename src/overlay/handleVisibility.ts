// src/overlay/handleVisibility.ts
/**
 * Owns WHEN the overlay's hover handles (drag + resize grips) are visible, as a
 * framework-free controller — same shape as `gesture.ts`. One place decides
 * show/hide so the reveal rule can't drift across the two React effects that
 * used to each hand-roll the idle timer.
 *
 * Rules (why each exists is hard-won on XWayland, see overlay_native/webview.rs):
 *  - a hover PING (Rust emits `overlay://pointer-inside=true` on GTK enter +
 *    throttled motion) shows the handles and (re)arms an idle timer; when pings
 *    stop for `idleMs` the pointer has left → hide. The borderless Dock webview
 *    never delivers a reliable leave, so an idle timeout IS the "gone" signal.
 *  - while a GESTURE (drag/resize) runs the handles are PINNED shown and the
 *    idle timer is suspended: the DOM pointer-capture swallows the motion pings
 *    that would keep them alive, so without pinning they'd blink mid-drag.
 */
export interface HandleVisibility {
  /** A hover ping arrived (the pointer is over the overlay). */
  ping(): void;
  /** A drag/resize gesture started (`true`) or ended (`false`). */
  setGesturing(on: boolean): void;
  /** Drop any pending timer (component unmount). */
  dispose(): void;
}

export interface HandleVisibilityOptions {
  /** Hide this long after the last ping with no gesture active. */
  idleMs: number;
  /** Reveal the handles (e.g. add a body class). */
  show: () => void;
  /** Hide the handles (e.g. remove the body class). */
  hide: () => void;
  /** Injectable timers (defaults to globals) — keeps the core unit-testable. */
  setTimeoutFn?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void;
}

export function createHandleVisibility(opts: HandleVisibilityOptions): HandleVisibility {
  // Resolve the globals at CALL time (not capture time) so test fake-timers
  // installed after construction are respected.
  const setT =
    opts.setTimeoutFn ?? ((cb: () => void, ms: number) => setTimeout(cb, ms));
  const clearT =
    opts.clearTimeoutFn ??
    ((handle: ReturnType<typeof setTimeout>) => clearTimeout(handle));

  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let gesturing = false;

  const clearHide = () => {
    if (hideTimer !== null) {
      clearT(hideTimer);
      hideTimer = null;
    }
  };

  const armHide = () => {
    clearHide();
    if (gesturing) return; // pinned while a gesture runs — never hide mid-drag
    hideTimer = setT(() => {
      hideTimer = null;
      opts.hide();
    }, opts.idleMs);
  };

  return {
    ping() {
      opts.show();
      armHide();
    },
    setGesturing(on) {
      gesturing = on;
      if (on) {
        clearHide();
        opts.show();
      } else {
        armHide(); // resume the idle countdown
      }
    },
    dispose() {
      clearHide();
    },
  };
}
