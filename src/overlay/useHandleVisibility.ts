// src/overlay/useHandleVisibility.ts
/**
 * Wires the hover-handle visibility controller (`handleVisibility.ts`) to its
 * inputs: Rust GTK crossing/motion (`overlay://pointer-inside`) and the DOM's
 * own pointer events (WebKitGTK forwards crossings to the page). Either source
 * may drop events on XWayland; the controller's leave hysteresis + idle
 * fallback make their union stable. Output: `body.pointer-inside`, which the
 * grip CSS in overlay.html keys off.
 */
import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { createHandleVisibility, type HandleVisibility } from "./handleVisibility";

/** A leave hides only if no new hover ping arrives within this window —
 *  absorbs XWayland/WebKit's spurious leave→enter pairs (no blink). */
export const LEAVE_CONFIRM_MS = 300;
/** Safety-net hide when a leave never arrives (XWayland can't see an
 *  off-surface pointer). Long, so holding still over the orb never hides. */
export const IDLE_HIDE_MS = 5000;

const BODY_CLASS = "pointer-inside";

/** `gesturing` pins the handles shown for a whole drag/resize. */
export function useHandleVisibility(gesturing: boolean): void {
  const ref = useRef<HandleVisibility | null>(null);
  if (ref.current === null) {
    ref.current = createHandleVisibility({
      leaveConfirmMs: LEAVE_CONFIRM_MS,
      idleMs: IDLE_HIDE_MS,
      show: () => document.body.classList.add(BODY_CLASS),
      hide: () => document.body.classList.remove(BODY_CLASS),
    });
  }

  useEffect(() => {
    const v = ref.current!;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void listen<boolean>("overlay://pointer-inside", (e) => {
      if (e.payload) v.ping();
      else v.leave();
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    const onMove = () => v.ping();
    const onLeave = () => v.leave();
    const root = document.documentElement;
    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerleave", onLeave);
    return () => {
      cancelled = true;
      v.dispose();
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerleave", onLeave);
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    ref.current!.setGesturing(gesturing);
  }, [gesturing]);
}
