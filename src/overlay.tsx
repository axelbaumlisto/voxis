// src/overlay.tsx
/**
 * Overlay webview entry point — thin ThemeHost shell.
 *
 * SRP: subscribe to backend state (useOverlayState) and host the active
 * code theme. ALL visual logic lives in theme modules loaded at runtime
 * via Blob-URL import(). The host knows nothing about colors, shapes,
 * or animation — it's a pure state conduit.
 *
 * DIP: ThemeHost receives fetchModule + fallbackModule as props;
 * no Tauri imports inside ThemeHost.
 *
 * KISS: one useOverlayState(), one ThemeHost, one params useEffect.
 */
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useOverlayState } from "./hooks/useOverlayState";
import ThemeHost from "./theme-engine/ThemeHost";
import { fetchThemeModule } from "./theme-engine/fetchModule";
import * as fallbackTheme from "./theme-engine/builtin/default";
import { commands } from "./bindings";
import type { ThemeState } from "./theme-engine/contract";
import { createPressController } from "./overlay/pressController";
import { isCanvasOpaqueAt } from "./overlay/hitTest";
import { MIN_OVERLAY_EDGE, resizeEdgeFromDelta } from "./overlay/resize";
import { createGesture } from "./overlay/gesture";
import {
  createHandleVisibility,
  type HandleVisibility,
} from "./overlay/handleVisibility";

/**
 * Semi-transparent drag grip on the LEFT edge of the overlay.
 *
 * Interaction (option B, per owner):
 *  - PRESS-AND-HOLD the grip (≥ ARM_MS, pointer roughly still) → drag arms;
 *    the overlay OS window then follows the pointer and the final spot is
 *    persisted (survives restarts + theme changes).
 *  - A single short TAP passes through: it neither drags nor is consumed — the
 *    grip only reacts to a hold.
 *  - DOUBLE-CLICK resets to the configured preset position.
 *
 * The grip is a SIBLING of the dictation pill (not a child), so its pointer
 * events never reach the pill's hold-to-dictate handler — holding the grip
 * drags, holding the pill dictates.
 *
 * Window moves go through Rust commands (move_overlay_window /
 * set_overlay_custom_position) so the overlay webview needs no window
 * permissions; `screenX/screenY` (stable as the window moves) drive the delta.
 */
export const ARM_MS = 300;
const SLOP_PX = 6;
/** Hide the hover handles this long after the last pointer-inside ping (idle). */
export const IDLE_HIDE_MS = 1200;

function DragGrip({ onInteracting }: { onInteracting: (on: boolean) => void }) {
  const [dragging, setDragging] = useState(false);
  // The window top-left captured on press (absolute moves) and the last
  // destination (persisted on release). Visibility of the grip itself is driven
  // by `body.pointer-inside` from the Rust pointer-inside events.
  const base = useRef<{ x: number; y: number } | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const gesture = useRef<ReturnType<typeof createGesture> | null>(null);

  const reset = () => {
    base.current = null;
    last.current = null;
    setDragging(false);
    onInteracting(false);
  };

  // Capture + rAF-coalescing + hold-to-arm all live in the shared gesture
  // transport; the drag grip only owns the position math (base + delta) and
  // the host calls. The resize grip uses the same transport — one place to fix.
  if (gesture.current === null) {
    gesture.current = createGesture({
      armMs: ARM_MS,
      slopPx: SLOP_PX,
      onArm: () => setDragging(true), // hold matured → a real drag: grabbing style
      onFrame: (point, start) => {
        if (!base.current) return; // base fetch not back yet → nothing to move
        const nx = Math.round(base.current.x + (point.screenX - start.screenX));
        const ny = Math.round(base.current.y + (point.screenY - start.screenY));
        last.current = { x: nx, y: ny };
        void invoke("move_overlay_window", { x: nx, y: ny });
      },
      onEnd: (point) => {
        // `point === null` means the gesture never armed — a tap, pass through.
        const dest = point !== null && base.current !== null ? last.current : null;
        reset();
        if (dest) void invoke("set_overlay_custom_position", { x: dest.x, y: dest.y });
      },
    });
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    if (!gesture.current!.begin(e)) return;
    e.stopPropagation();
    e.preventDefault();
    onInteracting(true);
    base.current = null;
    last.current = null;
    // Fetch the window's current top-left so armed moves are absolute. Resolves
    // in ~ms, well before ARM_MS, so it's ready by the time the drag arms.
    void invoke<[number, number]>("get_overlay_window_position")
      .then(([x, y]) => {
        base.current = { x, y };
      })
      .catch(() => {
        /* leave base null — arming without a base simply won't move */
      });
  };

  const onPointerMove = (e: ReactPointerEvent) => gesture.current!.move(e);
  const onPointerUp = () => gesture.current!.end();
  const onPointerCancel = () => {
    gesture.current!.cancel();
    reset();
  };
  const onDoubleClick = (e: ReactMouseEvent) => {
    e.stopPropagation();
    gesture.current!.cancel();
    reset();
    void invoke("clear_overlay_custom_position");
  };

  return (
    <div
      data-testid="overlay-drag-grip"
      className={`drag-grip${dragging ? " dragging" : ""}`}
      aria-label="Move overlay (hold to drag, double-click to reset)"
      title="Hold to drag · double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={onDoubleClick}
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        width: 13,
        height: 13,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        cursor: dragging ? "grabbing" : "grab",
        color: "#fff",
        background: dragging
          ? "rgba(34,197,94,0.98)"
          : "rgba(34,197,94,0.9)",
        boxShadow: "0 1px 4px rgba(0,0,0,0.45)",
        touchAction: "none",
        userSelect: "none",
        zIndex: 2147483647,
        lineHeight: "13px",
        fontSize: 8,
        fontWeight: 700,
        textAlign: "center",
      }}
    >
      ✛
    </div>
  );
}

/**
 * Bottom-right resize grip — the overlay's only resize affordance.
 *
 * NOT `getCurrentWindow().startResizeDragging()`: with `decorations:false` +
 * `transparent:true` + `macOSPrivateApi:true` AppKit accepts the gesture and
 * then silently declines to resize (documented by projects with the identical
 * configuration). So the grip drives the geometry itself, exactly the way the
 * drag grip drives the position: capture the pointer, coalesce moves through
 * rAF, and ask the host (`resize_overlay_window`) to set the size. On release
 * the size is persisted (`set_overlay_custom_size`), so it survives restarts
 * and theme switches; a double-click drops it back to the theme's footprint.
 *
 * The overlay stays SQUARE (see `overlay/resize.ts`): the dominant axis wins
 * and the host clamps — one edge length is the whole state.
 */
function ResizeGrip({ onInteracting }: { onInteracting: (on: boolean) => void }) {
  const [resizing, setResizing] = useState(false);
  const gesture = useRef<ReturnType<typeof createGesture> | null>(null);
  const lastEdge = useRef(0);
  // The gesture closure reads the start edge through a ref: the size is
  // captured on pointer-down, while the factory is built once per mount.
  const startEdgeAt = useRef(0);

  if (gesture.current === null) {
    // The start edge is the window's own logical size — the overlay webview
    // fills the window exactly, so `innerWidth` needs no IPC round-trip and no
    // "not resolved yet" state in the first frames of a gesture.
    gesture.current = createGesture({
      onFrame: (point, start) => {
        const edge = resizeEdgeFromDelta(
          startEdgeAt.current,
          point.screenX - start.screenX,
          point.screenY - start.screenY,
        );
        if (edge === lastEdge.current) return;
        lastEdge.current = edge;
        void invoke("resize_overlay_window", { width: edge, height: edge });
      },
      onEnd: () => {
        const edge = lastEdge.current;
        lastEdge.current = 0;
        setResizing(false);
        onInteracting(false);
        if (edge > 0) {
          void invoke("set_overlay_custom_size", { width: edge, height: edge });
        }
      },
    });
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    e.stopPropagation();
    startEdgeAt.current = Math.min(window.innerWidth, window.innerHeight);
    if (!gesture.current!.begin(e)) return;
    e.preventDefault();
    lastEdge.current = 0;
    setResizing(true);
    onInteracting(true);
  };

  const onPointerMove = (e: ReactPointerEvent) => gesture.current!.move(e);
  const onPointerUp = () => gesture.current!.end();
  const onPointerCancel = () => {
    gesture.current!.cancel();
    setResizing(false);
    onInteracting(false);
  };
  const onDoubleClick = (e: ReactMouseEvent) => {
    e.stopPropagation();
    gesture.current!.cancel();
    setResizing(false);
    onInteracting(false);
    void invoke("clear_overlay_custom_size");
  };

  return (
    <div
      data-testid="overlay-resize-grip"
      className={`resize-grip${resizing ? " resizing" : ""}`}
      aria-label={`Resize overlay (square, ${MIN_OVERLAY_EDGE}px minimum, double-click to reset)`}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={onDoubleClick}
      style={{
        position: "fixed",
        right: 0,
        bottom: 0,
        width: 14,
        height: 14,
        boxSizing: "border-box",
        cursor: "nwse-resize",
        background:
          "radial-gradient(circle at 30% 70%, rgba(255,255,255,0.95) 1.2px, transparent 1.6px), radial-gradient(circle at 70% 70%, rgba(255,255,255,0.95) 1.2px, transparent 1.6px), radial-gradient(circle at 70% 30%, rgba(255,255,255,0.95) 1.2px, transparent 1.6px), rgba(0,0,0,0.35)",
        borderRadius: 3,
        touchAction: "none",
        userSelect: "none",
        zIndex: 2147483647,
      }}
    />
  );
}

export function OverlayApp() {
  const snapshot = useOverlayState();
  // The square outline is drawn ONLY while RESIZING: dragging the corner needs
  // a visible window edge (an orb fills the window edge to edge). During a MOVE
  // the orb itself shows where it goes, and repainting a 1px edge frame on every
  // per-frame window reposition makes that frame flicker — so we keep it off.
  const [resizing, setResizing] = useState(false);
  // True while EITHER gesture (move or resize) is active — pins the hover
  // handles visible for the whole gesture (DOM pointer-capture swallows the GTK
  // motion pings that would otherwise keep them alive).
  const [gesturing, setGesturing] = useState(false);

  // Reveal the handles only while the OS pointer is over the overlay window.
  // Driven by the Rust-side CursorEntered/CursorLeft events (overlay://pointer-
  // inside) because the Dock webview doesn't deliver DOM pointerleave or keep
  // CSS :hover in sync. Toggle a body class the grip CSS keys off of.
  // All the show/hide timing lives in one framework-free controller (SRP): a
  // hover ping shows + arms the idle hide; a gesture pins the handles for its
  // whole duration. See overlay/handleVisibility.ts.
  const visibility = useRef<HandleVisibility | null>(null);
  if (visibility.current === null) {
    visibility.current = createHandleVisibility({
      idleMs: IDLE_HIDE_MS,
      show: () => document.body.classList.add("pointer-inside"),
      hide: () => document.body.classList.remove("pointer-inside"),
    });
  }

  useEffect(() => {
    // Rust emits `overlay://pointer-inside=true` on GTK enter + throttled
    // motion (never a reliable `false`), so each ping just keeps the handles
    // alive; the controller hides them on idle.
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void listen<boolean>("overlay://pointer-inside", (e) => {
      if (e.payload) visibility.current!.ping();
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      visibility.current!.dispose();
      if (unlisten) unlisten();
    };
  }, []);

  // Pin the handles for the whole drag/resize gesture, resume idle on release.
  useEffect(() => {
    visibility.current!.setGesturing(gesturing);
  }, [gesturing]);

  // Track actual OS window size so the theme canvas fills the window.
  // When innerWidth/innerHeight is 0 (jsdom/headless), fall back to
  // undefined so ThemeHost uses its 172/36 defaults.
  const [size, setSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  useEffect(() => {
    const handler = () =>
      setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // E2E hook: /overlay.html?theme=<id> forces a theme without round-tripping
  // through the Tauri command (kept from old shell for Playwright tests).
  const forcedTheme =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("theme")
      : null;
  const themeId = forcedTheme ?? snapshot.themeId;

  // Manifest params for the active theme. Specta skips the `params` field
  // (serde skip), so the generated ThemeManifest type lacks it. We access
  // it via a precise typed shape at runtime.
  const [params, setParams] = useState<unknown>(null);
  useEffect(() => {
    let cancelled = false;
    setParams(null);
    commands
      .getThemeManifest(themeId)
      .then((manifest) => {
        if (cancelled || !manifest) return;
        setParams((manifest as { params?: unknown }).params ?? null);
      })
      .catch(() => {
        // getThemeManifest is best-effort; themes work without params.
      });
    return () => {
      cancelled = true;
    };
  }, [themeId]);

  const state: ThemeState = {
    mode: snapshot.mode,
    audioLevel: snapshot.audioLevel,
    spectrumBins: snapshot.spectrumBins,
  };

  const [press] = useState(() =>
    createPressController({
      onStart: () => void commands.manualStartRecording(),
      onStop: () => void commands.manualStopRecording(),
    }),
  );
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Attach native pointer listeners via ref so dispatchEvent(new Event("pointerdown"))
  // works in jsdom tests (React synthetic handlers may not fire for bare Event).
  // setPointerCapture keeps the pill receiving move/up events even if the finger
  // slides off — critical for the tiny 172×36 overlay. Guarded for jsdom (no capture API).
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const onDown = (e: Event) => {
      const pe = e as PointerEvent;

      // Only start dictation if click lands on opaque canvas pixels.
      // Clicks on the empty transparent aquarium background are ignored.
      const canvas = el?.querySelector("canvas");
      if (canvas && !isCanvasOpaqueAt(canvas, pe.clientX, pe.clientY)) {
        return; // clicked empty aquarium -> ignore
      }

      if (el && typeof el.setPointerCapture === "function" && pe.pointerId !== undefined) {
        try { el.setPointerCapture(pe.pointerId); } catch { /* noop: jsdom lacks setPointerCapture */ }
      }
      press.press();
    };
    const onUp = () => press.release();
    const onCancel = () => press.release();
    const onCtx = (e: Event) => e.preventDefault();
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onCancel);
    el.addEventListener("contextmenu", onCtx);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onCancel);
      el.removeEventListener("contextmenu", onCtx);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- press is stable (useState lazy init)
  }, []);

  return (
    <>
      <div
        ref={wrapperRef}
        data-press-target
        style={{ width: "100%", height: "100%", touchAction: "none" }}
      >
        <ThemeHost
          themeId={themeId}
          state={state}
          fetchModule={fetchThemeModule}
          fallbackModule={fallbackTheme}
          onCancel={() => void commands.cancelOperation()}
          params={params}
          width={size.width || undefined}
          height={size.height || undefined}
        />
      </div>
      <div
        className={`resize-frame${resizing ? " visible" : ""}`}
        data-testid="overlay-resize-frame"
        aria-hidden="true"
      />
      <DragGrip onInteracting={setGesturing} />
      <ResizeGrip
        onInteracting={(on) => {
          setGesturing(on);
          setResizing(on);
        }}
      />
    </>
  );
}

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(<OverlayApp />);
}
