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
import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { useOverlayState } from "./hooks/useOverlayState";
import ThemeHost from "./theme-engine/ThemeHost";
import { fetchThemeModule } from "./theme-engine/fetchModule";
import * as fallbackTheme from "./theme-engine/builtin/default";
import { commands } from "./bindings";
import type { ThemeState } from "./theme-engine/contract";

export function OverlayApp() {
  const snapshot = useOverlayState();

  // E2E hook: /overlay.html?theme=<id> forces a theme without round-tripping
  // through the Tauri command (kept from old shell for Playwright tests).
  const forcedTheme =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("theme")
      : null;
  const themeId = forcedTheme ?? snapshot.themeId;

  // Manifest params for the active theme. Specta skips the `params` field
  // (serde skip), so the generated ThemeManifest type lacks it. We cast
  // through unknown to access the field at runtime.
  const [params, setParams] = useState<unknown>(null);
  useEffect(() => {
    let cancelled = false;
    setParams(null);
    commands
      .getThemeManifest(themeId)
      .then((manifest) => {
        if (cancelled || !manifest) return;
        const m = manifest as unknown as Record<string, unknown>;
        setParams(m.params ?? null);
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

  return (
    <ThemeHost
      themeId={themeId}
      state={state}
      fetchModule={fetchThemeModule}
      fallbackModule={fallbackTheme}
      onCancel={() => void commands.cancelOperation()}
      params={params}
    />
  );
}

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(<OverlayApp />);
}
