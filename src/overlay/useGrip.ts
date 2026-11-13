// src/overlay/useGrip.ts
/**
 * The React glue BOTH overlay grips share: wire a `createGesture` transport to
 * pointer handlers, report the gesture's active span, and reset on
 * double-click. Each grip supplies only what differs — its geometry
 * (`onFrame`/`onEnd`), what to capture on press (`onBegin`), what to drop on
 * abort (`onAbort`), and which host command restores its default
 * (`resetCommand`).
 *
 * The spec is read ONCE at mount (the gesture is built once), so its callbacks
 * must only touch refs and stable state setters — which is what the grips do.
 */
import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { createGesture, type Gesture, type GestureHandlers } from "./gesture";

export interface GripSpec extends GestureHandlers {
  /** Gesture began (`true`) / ended or was aborted (`false`). */
  onActive: (on: boolean) => void;
  /** Called right after a primary press begins the gesture. */
  onBegin?: () => void;
  /** Called when the gesture is aborted (pointercancel / double-click). */
  onAbort?: () => void;
  /** Host command that drops the persisted value (double-click). */
  resetCommand: string;
}

export interface GripHandlers {
  onPointerDown: (e: ReactPointerEvent) => void;
  onPointerMove: (e: ReactPointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onDoubleClick: (e: ReactMouseEvent) => void;
}

export function useGrip(spec: GripSpec): GripHandlers {
  const gesture = useRef<Gesture | null>(null);
  if (gesture.current === null) {
    gesture.current = createGesture({
      ...spec,
      onEnd: (point, start) => {
        spec.onActive(false);
        spec.onEnd(point, start);
      },
    });
  }
  const g = gesture.current;

  const abort = () => {
    g.cancel();
    spec.onAbort?.();
    spec.onActive(false);
  };

  return {
    onPointerDown: (e) => {
      if (!g.begin(e)) return;
      // Sibling of the dictation pill: never let the press reach it.
      e.stopPropagation();
      e.preventDefault();
      spec.onActive(true);
      spec.onBegin?.();
    },
    onPointerMove: (e) => g.move(e),
    onPointerUp: () => g.end(),
    onPointerCancel: abort,
    onDoubleClick: (e) => {
      e.stopPropagation();
      abort();
      void invoke(spec.resetCommand);
    },
  };
}
