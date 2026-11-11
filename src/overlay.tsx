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
import { useOverlayState } from "./hooks/useOverlayState";
import ThemeHost from "./theme-engine/ThemeHost";
import { fetchThemeModule } from "./theme-engine/fetchModule";
import * as fallbackTheme from "./theme-engine/builtin/default";
import { commands } from "./bindings";
import type { ThemeState } from "./theme-engine/contract";
import { createPressController } from "./overlay/pressController";
import { isCanvasOpaqueAt } from "./overlay/hitTest";

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
const ARM_MS = 300;
const SLOP_PX = 6;
const IDLE_HIDE_MS = 1600;

function DragGrip() {
  const [dragging, setDragging] = useState(false);
  const [armed, setArmed] = useState(false);
  // Idle-reveal: the grip shows on pointer ACTIVITY over the overlay and hides
  // after a short idle timeout. This does NOT rely on pointerout/leave events —
  // the overlay's borderless Dock webview does not reliably deliver them on
  // X11/Wayland, which is why the grip used to get stuck visible. A timer always
  // fires, so the grip reliably disappears once the mouse stops moving over it.
  const [active, setActive] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const bump = () => {
      setActive(true);
      if (hideTimer.current !== null) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setActive(false), IDLE_HIDE_MS);
    };
    window.addEventListener("pointermove", bump);
    window.addEventListener("pointerover", bump);
    return () => {
      window.removeEventListener("pointermove", bump);
      window.removeEventListener("pointerover", bump);
      if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    };
  }, []);
  const visible = active || armed || dragging;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const raf = useRef<number | null>(null);
  const st = useRef<{
    pointerId: number;
    startScreenX: number;
    startScreenY: number;
    baseX: number | null;
    baseY: number | null;
    lastX: number;
    lastY: number;
    armedNow: boolean;
    pendingScreen: { x: number; y: number } | null;
  } | null>(null);

  const clearTimer = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const reset = () => {
    clearTimer();
    if (raf.current !== null) {
      cancelAnimationFrame(raf.current);
      raf.current = null;
    }
    st.current = null;
    setArmed(false);
    setDragging(false);
    // Hide immediately when the drag ends and cancel any pending idle timer —
    // the grip reappears on the next pointer activity over the overlay.
    if (hideTimer.current !== null) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    setActive(false);
  };

  const flush = () => {
    raf.current = null;
    const s = st.current;
    if (!s || !s.armedNow || s.baseX === null || s.baseY === null || !s.pendingScreen) return;
    const nx = Math.round(s.baseX + (s.pendingScreen.x - s.startScreenX));
    const ny = Math.round(s.baseY + (s.pendingScreen.y - s.startScreenY));
    s.lastX = nx;
    s.lastY = ny;
    void invoke("move_overlay_window", { x: nx, y: ny });
  };

  const scheduleMove = (screenX: number, screenY: number) => {
    const s = st.current;
    if (!s) return;
    s.pendingScreen = { x: screenX, y: screenY };
    if (raf.current === null) raf.current = requestAnimationFrame(flush);
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* captured pointer may already be gone — the drag still tracks */
    }
    st.current = {
      pointerId: e.pointerId,
      startScreenX: e.screenX,
      startScreenY: e.screenY,
      baseX: null,
      baseY: null,
      lastX: 0,
      lastY: 0,
      armedNow: false,
      pendingScreen: null,
    };
    // Fetch the window's current top-left so armed moves are absolute. Resolves
    // in ~ms, long before ARM_MS, so it's ready by the time the drag arms.
    void invoke<[number, number]>("get_overlay_window_position")
      .then(([x, y]) => {
        if (st.current && st.current.pointerId === e.pointerId) {
          st.current.baseX = x;
          st.current.baseY = y;
          st.current.lastX = x;
          st.current.lastY = y;
        }
      })
      .catch(() => {
        /* leave base null — arming without a base simply won't move */
      });
    clearTimer();
    timer.current = setTimeout(() => {
      const s = st.current;
      if (!s || s.pointerId !== e.pointerId) return;
      s.armedNow = true;
      setArmed(true);
      setDragging(true);
    }, ARM_MS);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const s = st.current;
    if (!s || s.pointerId !== e.pointerId) return;
    if (!s.armedNow) {
      // Moved past the slop before the hold matured → this is a tap-drag, not
      // a hold: abandon, let it pass through (no drag).
      const dx = e.screenX - s.startScreenX;
      const dy = e.screenY - s.startScreenY;
      if (dx * dx + dy * dy > SLOP_PX * SLOP_PX) reset();
      return;
    }
    e.preventDefault();
    scheduleMove(e.screenX, e.screenY);
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    const s = st.current;
    if (!s || s.pointerId !== e.pointerId) {
      reset();
      return;
    }
    const wasArmed = s.armedNow;
    const { lastX, lastY, baseX } = s;
    reset();
    if (wasArmed && baseX !== null) {
      void invoke("set_overlay_custom_position", { x: lastX, y: lastY });
    }
    // Not armed → a tap: pass through (do nothing).
  };

  const onDoubleClick = (e: ReactMouseEvent) => {
    e.stopPropagation();
    reset();
    void invoke("clear_overlay_custom_position");
  };

  return (
    <div
      data-testid="overlay-drag-grip"
      aria-label="Move overlay (hold to drag, double-click to reset)"
      title="Hold to drag · double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={reset}
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
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
        transition: "opacity 140ms ease",
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

export function OverlayApp() {
  const snapshot = useOverlayState();

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
      <DragGrip />
    </>
  );
}

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(<OverlayApp />);
}
