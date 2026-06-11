// src/overlay/pressController.ts
/**
 * Press/release state machine for hold-to-dictate on the overlay.
 * Pure + DOM-free: callers wire pointer events to press()/release().
 *
 * Guarantees:
 *  - onStart fires only on a press from the released state (no double-start
 *    from duplicate pointerdown / OS autorepeat).
 *  - onStop fires only on a release from the pressed state (a stray
 *    pointerup/leave/cancel without a prior press is ignored).
 *  - callback errors are swallowed so a failed Tauri invoke can't wedge the
 *    state machine (the press flag is updated before invoking).
 */
export interface PressControllerOptions {
  onStart: () => void;
  onStop: () => void;
}

export interface PressController {
  press(): void;
  release(): void;
  /** Test/introspection helper. */
  isPressed(): boolean;
}

export function createPressController(opts: PressControllerOptions): PressController {
  let pressed = false;
  return {
    press() {
      if (pressed) return;
      pressed = true;
      try {
        opts.onStart();
      } catch (err) {
        console.error("[pressController] onStart threw:", err);
      }
    },
    release() {
      if (!pressed) return;
      pressed = false;
      try {
        opts.onStop();
      } catch (err) {
        console.error("[pressController] onStop threw:", err);
      }
    },
    isPressed() {
      return pressed;
    },
  };
}