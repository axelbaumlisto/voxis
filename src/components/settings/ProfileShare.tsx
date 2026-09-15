/**
 * ProfileShare — "Share profile to device" settings section
 * (tauri-plugin-voxis plan, Task 7).
 *
 * Two independent transports, both built on the desktop's own
 * `VoxisProfile` (never history/corrections/debug — see the Rust module
 * docs for the full exclusion list):
 *
 * - **QR + LAN**: picks a LAN interface, starts a one-shot server
 *   (`startProfileShare`), shows the returned SVG QR + a large 6-digit
 *   code (the code is the *second factor* — never encoded inside the QR
 *   itself) + a countdown derived from `expires_at_ms`. Listens for the
 *   backend's `profile-share-delivered` event to flip "waiting for
 *   device…" to "Delivered"; the countdown reaching zero (or an explicit
 *   Stop) flips it to "Expired" / idle instead.
 * - **File**: `exportProfileFile` with no passphrase generates one from
 *   the backend's embedded wordlist and returns it for exactly one
 *   display — this component never re-fetches or persists it anywhere,
 *   only offers a copy-to-clipboard button and a "won't be shown again"
 *   warning.
 *
 * Self-contained (talks directly to `lib/commands.ts`), matching the
 * `LlmPromptManager`/`ExportDiagnostics` convention for custom settings
 * widgets.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import FieldWrapper from "./FieldWrapper";
import {
  ShareInterface,
  ShareSession,
  exportProfileFile,
  listShareInterfaces,
  startProfileShare,
  stopProfileShare,
} from "../../lib/commands";
import { useTauriEvent } from "../../hooks/useTauriEvent";

export interface ProfileShareProps {
  label: string;
  description?: string;
}

type ShareStatus = "idle" | "starting" | "waiting" | "delivered" | "expired" | "error";

function secondsRemaining(expiresAtMs: number): number {
  return Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000));
}

export default function ProfileShare({ label, description }: ProfileShareProps) {
  const [interfaces, setInterfaces] = useState<ShareInterface[]>([]);
  const [selectedInterface, setSelectedInterface] = useState<string>("");
  const [session, setSession] = useState<ShareSession | null>(null);
  const [status, setStatus] = useState<ShareStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);

  const [exportPath, setExportPath] = useState("");
  const [exportPassphrase, setExportPassphrase] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [revealedPassphrase, setRevealedPassphrase] = useState<string | null>(null);

  const sessionRef = useRef(session);
  sessionRef.current = session;

  useEffect(() => {
    // Defensive default: synthetic/test environments may resolve this with
    // `undefined` when `lib/commands` is only partly mocked (same pattern
    // as `LlmPromptManager`'s `unwrapResult(...) ?? []`) — never crash the
    // whole Settings page render over an empty interface list.
    listShareInterfaces()
      .then((list) => setInterfaces(list ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  // Navigating away from Settings (or unmounting for any other reason)
  // while a session is active/waiting must not leave the LAN server
  // running in the background — stop it, same as clicking Stop.
  useEffect(() => {
    return () => {
      if (sessionRef.current) {
        void stopProfileShare();
      }
    };
  }, []);

  // "Delivered": the backend fires this the instant the single-use token
  // is redeemed by a successful GET. Ignore it if it arrives after this
  // session was already stopped/expired client-side.
  useTauriEvent<void>("profile-share-delivered", () => {
    if (sessionRef.current) {
      setStatus("delivered");
    }
  });

  useEffect(() => {
    if (!session || status !== "waiting") {
      return;
    }
    setCountdown(secondsRemaining(session.expires_at_ms));
    const interval = setInterval(() => {
      const remaining = secondsRemaining(session.expires_at_ms);
      setCountdown(remaining);
      if (remaining <= 0) {
        setStatus((current) => (current === "waiting" ? "expired" : current));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [session, status]);

  const onStart = async () => {
    setStatus("starting");
    setError(null);
    try {
      const newSession = await startProfileShare(selectedInterface || null);
      setSession(newSession);
      setStatus("waiting");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  };

  const onStop = async () => {
    try {
      await stopProfileShare();
    } finally {
      setSession(null);
      setStatus("idle");
    }
  };

  const statusText = useMemo(() => {
    switch (status) {
      case "waiting":
        return `Waiting for device… (${countdown}s)`;
      case "delivered":
        return "Delivered";
      case "expired":
        return "Expired";
      case "starting":
        return "Starting…";
      default:
        return null;
    }
  }, [status, countdown]);

  const onExport = async () => {
    setExportBusy(true);
    setExportError(null);
    try {
      const result = await exportProfileFile(exportPath, exportPassphrase || null);
      if (result.passphrase) {
        setRevealedPassphrase(result.passphrase);
      }
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setExportBusy(false);
    }
  };

  const onCopyPassphrase = () => {
    if (revealedPassphrase) {
      void navigator.clipboard?.writeText(revealedPassphrase);
    }
  };

  return (
    <FieldWrapper label={label} description={description}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <select
            data-testid="profile-share-interface-select"
            value={selectedInterface}
            onChange={(e) => setSelectedInterface(e.target.value)}
            disabled={status === "waiting" || status === "delivered"}
          >
            <option value="">Default (first available)</option>
            {interfaces.map((iface) => (
              <option key={iface.name} value={iface.name}>
                {iface.name} ({iface.ip})
              </option>
            ))}
          </select>

          {status === "idle" || status === "error" || status === "expired" ? (
            <button
              type="button"
              data-testid="profile-share-start-button"
              onClick={() => void onStart()}
            >
              Start
            </button>
          ) : (
            <button
              type="button"
              data-testid="profile-share-stop-button"
              onClick={() => void onStop()}
            >
              Stop
            </button>
          )}

          {session && (status === "waiting" || status === "delivered") && (
            <div
              data-testid="profile-share-session"
              style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}
            >
              {/* Trusted, backend-generated SVG (no user input reaches this
                  markup) — see module docs. */}
              <div
                data-testid="profile-share-qr"
                style={{ width: 200, height: 200 }}
                dangerouslySetInnerHTML={{ __html: session.qr_svg }}
              />
              <div
                data-testid="profile-share-code"
                style={{ fontSize: "1.5em", fontWeight: 600, letterSpacing: "0.1em" }}
              >
                {session.code}
              </div>
              <div style={{ fontSize: "0.85em" }}>
                {session.host}:{session.port}
              </div>
            </div>
          )}

          {statusText && (
            <div data-testid="profile-share-status" role="status" style={{ fontSize: "0.85em" }}>
              {statusText}
            </div>
          )}
          {error && (
            <div data-testid="profile-share-error" role="alert" style={{ color: "var(--error)" }}>
              {error}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--border, #2a2a2a)", paddingTop: 12 }}>
          <input
            type="text"
            data-testid="profile-share-export-path"
            placeholder="Destination path (e.g. /Users/you/Desktop/voxis-profile.vxp)"
            value={exportPath}
            onChange={(e) => setExportPath(e.target.value)}
          />
          <input
            type="password"
            data-testid="profile-share-export-passphrase"
            placeholder="Passphrase (leave empty to generate one)"
            value={exportPassphrase}
            onChange={(e) => setExportPassphrase(e.target.value)}
          />
          <button
            type="button"
            data-testid="profile-share-export-button"
            onClick={() => void onExport()}
            disabled={exportBusy || !exportPath}
          >
            {exportBusy ? "Exporting…" : "Export profile file…"}
          </button>
          {revealedPassphrase && (
            <div
              data-testid="profile-share-export-passphrase-reveal"
              role="status"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                padding: "8px 12px",
                border: "1px solid var(--border, #2a2a2a)",
                borderRadius: 4,
              }}
            >
              <code data-testid="profile-share-export-passphrase-value">
                {revealedPassphrase}
              </code>
              <button type="button" data-testid="profile-share-copy-passphrase" onClick={onCopyPassphrase}>
                Copy
              </button>
              <span style={{ fontSize: "0.85em", color: "var(--error)" }}>
                This passphrase will not be shown again — save it now.
              </span>
            </div>
          )}
          {exportError && (
            <div data-testid="profile-share-export-error" role="alert" style={{ color: "var(--error)" }}>
              {exportError}
            </div>
          )}
        </div>
      </div>
    </FieldWrapper>
  );
}
