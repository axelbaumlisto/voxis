/**
 * UpdateNotice — opt-in "Check for updates" settings button.
 *
 * Triggers the manual-trigger `check_for_update` Tauri command, which fetches
 * the latest published GitHub release and compares it against the running app's
 * version. There is NO automatic background polling — the network call happens
 * only when the user clicks this button, keeping in line with the project's
 * "no telemetry" positioning. Shows "you're up to date" or an update-available
 * message with a link to the release page.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import FieldWrapper from "./FieldWrapper";
import { checkForUpdate, type UpdateCheckResult } from "../../lib/commands";

export interface UpdateNoticeProps {
  label: string;
  description?: string;
}

export default function UpdateNotice({ label, description }: UpdateNoticeProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onCheck = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const out = await checkForUpdate();
      setResult(out);
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
          data-testid="check-for-update-button"
          onClick={() => void onCheck()}
          disabled={busy}
        >
          {busy ? t("settings.updateChecking") : t("settings.checkForUpdate")}
        </button>
        {result && (
          <div
            data-testid="check-for-update-result"
            role="status"
            style={{
              padding: "8px 12px",
              border: "1px solid var(--border, #2a2a2a)",
              borderRadius: 4,
              fontSize: "0.85em",
              lineHeight: 1.4,
              wordBreak: "break-word",
            }}
          >
            {result.update_available ? (
              <>
                {t("settings.updateAvailable", {
                  version: result.latest_version,
                })}{" "}
                <a
                  href={result.release_url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {t("settings.updateDownload")}
                </a>
              </>
            ) : (
              t("settings.updateUpToDate", { version: result.current_version })
            )}
          </div>
        )}
        {error && (
          <div
            data-testid="check-for-update-error"
            role="alert"
            style={{ color: "var(--error)", fontSize: "0.85em" }}
          >
            {t("settings.updateCheckFailed", { error })}
          </div>
        )}
      </div>
    </FieldWrapper>
  );
}
