import { useTranslation } from "react-i18next";
import { useFailedTranscriptions } from "../../hooks/useFailedTranscriptions";

/**
 * SRP: renders the list of failed transcriptions with retry/dismiss actions.
 *
 * Relocated from the (deleted) home page so the failed-transcription recovery
 * flow lives alongside History. HistoryPage renders this above its list.
 * Surfaces hook errors (retry/dismiss failures) instead of swallowing them.
 */
function FailedTranscriptionList() {
  const { t } = useTranslation();
  const { items, retry, dismiss, retrying, error } = useFailedTranscriptions();

  if (!items || (items.length === 0 && !error)) {
    return null;
  }

  return (
    <div className="failed-transcription-list">
      {error && <p className="error-text">{error}</p>}
      {items.map((item) => (
        <div className="failed-transcription-card" key={item.id}>
          <p className="error-text">{item.error}</p>
          {item.whisper_text && (
            <p className="whisper-text">{item.whisper_text}</p>
          )}
          <div className="failed-actions">
            <button
              onClick={() => retry(item.id)}
              disabled={retrying === item.id}
            >
              {retrying === item.id ? t("common.retrying") : t("common.retry")}
            </button>
            <button onClick={() => dismiss(item.id)} className="dismiss">
              {t("common.dismiss")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default FailedTranscriptionList;
