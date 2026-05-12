/**
 * Overlay webview entry point.
 *
 * Renders a transparent, minimal overlay showing recording status via Waveform.
 * State updates come via Tauri events emitted by the backend.
 *
 * Architecture (SOLID + KISS):
 * - SRP: this module only renders overlay state, no business logic.
 * - DIP: depends on Tauri event abstraction, not concrete backend.
 * - KISS: reuses existing Waveform component; only minimal event glue here.
 */
import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import Waveform from "./components/Waveform";

type OverlayMode = "idle" | "recording" | "transcribing" | "error";

interface OverlayStatePayload {
  state: OverlayMode;
}

function OverlayApp() {
  const [mode, setMode] = useState<OverlayMode>("idle");

  useEffect(() => {
    let unlistenState: UnlistenFn | undefined;

    (async () => {
      try {
        unlistenState = await listen<OverlayStatePayload | OverlayMode>(
          "overlay://state",
          (event) => {
            const payload = event.payload;
            if (typeof payload === "string") {
              setMode(payload);
            } else if (payload && typeof payload === "object" && "state" in payload) {
              setMode(payload.state);
            }
          },
        );
      } catch (err) {
        // Running outside Tauri (e.g. during build) — keep idle.
        console.warn("[overlay] failed to subscribe to events:", err);
      }
    })();

    return () => {
      unlistenState?.();
    };
  }, []);

  return (
    <div className={`overlay overlay-${mode}`}>
      <Waveform mode={mode} />
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(<OverlayApp />);
}
