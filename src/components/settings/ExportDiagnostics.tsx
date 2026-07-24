/**
 * ExportDiagnostics — opt-in "Export Diagnostics" settings button.
 *
 * Triggers the local `export_diagnostics` Tauri command which copies the app's
 * logs/ and debug/ directories plus a REDACTED config summary into a fresh
 * folder under the config directory, then shows the user the resulting path so
 * they can hand it to a maintainer. 100% local, on-demand — no network call,
 * and secret values (api_key, LLM provider keys) are never included.
 */
import { useState } from "react";
import FieldWrapper from "./FieldWrapper";
import { exportDiagnostics } from "../../lib/commands";

export interface ExportDiagnosticsProps {
  label: string;
  description?: string;
}

export default function ExportDiagnostics({
  label,
  description,
}: ExportDiagnosticsProps) {
  const [busy, setBusy] = useState(false);
  const [path, setPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onExport = async () => {
    setBusy(true);
    setError(null);
    setPath(null);
    try {
      const out = await exportDiagnostics();
      setPath(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FieldWrapper label={label} description={description}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button
          type="button"
          data-testid="export-diagnostics-button"
          onClick={() => void onExport()}
          disabled={busy}
        >
          {busy ? "Exporting…" : "Export Diagnostics"}
        </button>
        {path && (
          <div
            data-testid="export-diagnostics-result"
            role="status"
            style={{
              padding: "8px 12px",
              border: "1px solid var(--border, #2a2a2a)",
              borderRadius: 4,
              // em: parent-relative secondary hint; no px token (keeps computed size)
              fontSize: "0.85em",
              lineHeight: 1.4,
              wordBreak: "break-all",
            }}
          >
            Diagnostics exported to:
            <br />
            <code>{path}</code>
          </div>
        )}
        {error && (
          <div
            data-testid="export-diagnostics-error"
            role="alert"
            style={{ color: "var(--error)", fontSize: "0.85em" }}
          >
            {error}
          </div>
        )}
      </div>
    </FieldWrapper>
  );
}
