/**
 * Overlay webview entry point.
 *
 * Architecture (SOLID + KISS):
 * - SRP: this module is a thin shell. State aggregation lives in
 *   `useOverlayState`, theme loading in `useTheme`, rendering in
 *   `OverlayCanvas` (which itself dispatches by family + mode).
 * - DIP: depends only on hook + component interfaces, not on Tauri
 *   internals or any specific backend (NSPanel, subprocess, …).
 * - KISS: zero local state. Two hooks + one component.
 */
import ReactDOM from "react-dom/client";
import { useOverlayState } from "./hooks/useOverlayState";
import { useTheme } from "./hooks/useTheme";
import OverlayCanvas from "./components/overlay/OverlayCanvas";

export function OverlayApp() {
  const snapshot = useOverlayState();
  const theme = useTheme(snapshot.themeId);

  return (
    <div
      className={`overlay overlay-${snapshot.mode}`}
      data-testid="overlay-root"
      data-theme={theme?.id ?? snapshot.themeId}
      data-family={theme?.family ?? "loading"}
    >
      <OverlayCanvas snapshot={snapshot} theme={theme} />
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(<OverlayApp />);
}
