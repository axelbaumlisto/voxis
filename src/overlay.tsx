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
import { useOverlayState } from "./hooks/useOverlayState";
import ThemeHost from "./theme-engine/ThemeHost";
import { fetchThemeModule } from "./theme-engine/fetchModule";
import * as fallbackTheme from "./theme-engine/builtin/default";
import { commands } from "./bindings";
import type { ThemeState } from "./theme-engine/contract";
import { createPressController } from "./overlay/pressController";
import { isCanvasOpaqueAt } from "./overlay/hitTest";

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
  );
}

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(<OverlayApp />);
}
