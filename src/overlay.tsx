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
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { useOverlayState } from "./hooks/useOverlayState";
import ThemeHost from "./theme-engine/ThemeHost";
import { fetchThemeModule } from "./theme-engine/fetchModule";
import * as fallbackTheme from "./theme-engine/builtin/default";
import { commands } from "./bindings";
import type { ThemeState } from "./theme-engine/contract";
import { createPressController } from "./overlay/pressController";
import { isCanvasOpaqueAt } from "./overlay/hitTest";
import { MIN_OVERLAY_EDGE, resizeEdgeFromDelta } from "./overlay/resize";
import { useGrip } from "./overlay/useGrip";
import { useHandleVisibility } from "./overlay/useHandleVisibility";

/**
 * Drag grip (top-left, green ✛) — moves the overlay window.
 *
 *  - PRESS-AND-HOLD (≥ ARM_MS, pointer roughly still) arms the drag; the window
 *    follows the pointer and the final spot is persisted.
 *  - A short TAP passes through (no drag); moving past SLOP_PX before the hold
 *    matures abandons it too.
 *  - DOUBLE-CLICK resets to the configured preset position.
 *
 * Window moves go through Rust commands so the overlay webview needs no window
 * permissions; `screenX/screenY` (stable as the window moves) drive the delta.
 * Pointer transport + hold-to-arm live in `overlay/gesture.ts`; React glue in
 * `overlay/useGrip.ts` — this component owns only the position math.
 */
export const ARM_MS = 300;
const SLOP_PX = 6;

type Point = { x: number; y: number };
type GripProps = { onActive: (on: boolean) => void };

function DragGrip({ onActive }: GripProps) {
  // `armed` (not merely pressed) switches to the grabbing style.
  const [armed, setArmed] = useState(false);
  const base = useRef<Point | null>(null); // window top-left at press
  const last = useRef<Point | null>(null); // last destination (persisted)

  const clear = () => {
    base.current = null;
    last.current = null;
    setArmed(false);
  };

  const handlers = useGrip({
    armMs: ARM_MS,
    slopPx: SLOP_PX,
    resetCommand: "clear_overlay_custom_position",
    onActive,
    onArm: () => setArmed(true),
    onBegin: () => {
      clear();
      // Absolute moves need the window's top-left; resolves in ~ms, well
      // before ARM_MS. If it fails, base stays null and nothing moves.
      void invoke<[number, number]>("get_overlay_window_position")
        .then(([x, y]) => {
          base.current = { x, y };
        })
        .catch(() => {});
    },
    onAbort: clear,
    onFrame: (point, start) => {
      if (!base.current) return;
      const dest = {
        x: Math.round(base.current.x + (point.screenX - start.screenX)),
        y: Math.round(base.current.y + (point.screenY - start.screenY)),
      };
      last.current = dest;
      void invoke("move_overlay_window", dest);
    },
    onEnd: (point) => {
      // `point === null` → never armed: a tap, nothing to persist.
      const dest = point !== null ? last.current : null;
      clear();
      if (dest) void invoke("set_overlay_custom_position", dest);
    },
  });

  return (
    <div
      data-testid="overlay-drag-grip"
      className={`drag-grip${armed ? " dragging" : ""}`}
      aria-label="Move overlay (hold to drag, double-click to reset)"
      title="Hold to drag · double-click to reset"
      {...handlers}
    >
      ✛
    </div>
  );
}

/**
 * Resize grip (bottom-right) — the overlay's only resize affordance.
 *
 * NOT `startResizeDragging()`: with `decorations:false` + `transparent:true` +
 * `macOSPrivateApi:true` AppKit accepts the gesture and silently declines to
 * resize. So the grip drives the geometry itself via `resize_overlay_window`,
 * persists on release (`set_overlay_custom_size`), and double-click drops back
 * to the theme's footprint. The overlay stays SQUARE (`overlay/resize.ts`).
 */
function ResizeGrip({ onActive }: GripProps) {
  // Start edge = the window's own logical size (the webview fills it exactly),
  // so no IPC round-trip is needed before the first frame.
  const startEdge = useRef(0);
  const lastEdge = useRef(0);

  const handlers = useGrip({
    resetCommand: "clear_overlay_custom_size",
    onActive,
    onBegin: () => {
      startEdge.current = Math.min(window.innerWidth, window.innerHeight);
      lastEdge.current = 0;
    },
    onFrame: (point, start) => {
      const edge = resizeEdgeFromDelta(
        startEdge.current,
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
      if (edge > 0) void invoke("set_overlay_custom_size", { width: edge, height: edge });
    },
  });

  return (
    <div
      data-testid="overlay-resize-grip"
      className="resize-grip"
      aria-label={`Resize overlay (square, ${MIN_OVERLAY_EDGE}px minimum, double-click to reset)`}
      title="Drag to resize · double-click to reset"
      {...handlers}
    />
  );
}

type ActiveGesture = "move" | "resize" | null;

export function OverlayApp() {
  const snapshot = useOverlayState();
  // Which grip gesture is running. Any gesture pins the hover handles; only a
  // RESIZE shows the square outline (an orb fills the window edge to edge, so
  // the corner needs a visible edge; during a move the orb shows position, and
  // repainting the edge frame every reposition flickers).
  const [active, setActive] = useState<ActiveGesture>(null);
  useHandleVisibility(active !== null);

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
        className={`resize-frame${active === "resize" ? " visible" : ""}`}
        data-testid="overlay-resize-frame"
        aria-hidden="true"
      />
      <DragGrip onActive={(on) => setActive(on ? "move" : null)} />
      <ResizeGrip onActive={(on) => setActive(on ? "resize" : null)} />
    </>
  );
}

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(<OverlayApp />);
}
