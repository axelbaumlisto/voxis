import { useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useRecordingContext } from "../contexts/RecordingContext";
import { useHotkey } from "../hooks/useHotkey";
import { useFailedTranscriptions } from "../hooks/useFailedTranscriptions";
import "../styles/home.css";

function HomePage() {
  const { t } = useTranslation();
  const { state, lastTranscription, error, start, stop } =
    useRecordingContext();
  const { items: failedItems, retry, dismiss, retrying } = useFailedTranscriptions();

  // Track if we initiated recording via hotkey (to prevent double-stop)
  const hotkeyActiveRef = useRef(false);

  // Memoize handlers to avoid re-registering listeners
  const handleHotkeyPressed = useCallback(async () => {
    if (state === "idle" || state === "error") {
      hotkeyActiveRef.current = true;
      await start();
    }
  }, [state, start]);

  const handleHotkeyReleased = useCallback(async () => {
    if (state === "recording" && hotkeyActiveRef.current) {
      hotkeyActiveRef.current = false;
      await stop();
    }
  }, [state, stop]);

  useHotkey(handleHotkeyPressed, handleHotkeyReleased);

  // Button click handler
  const handleRecordClick = async () => {
    if (state === "idle" || state === "error") {
      await start();
    } else if (state === "recording") {
      await stop();
    }
  };

  const getButtonText = () => {
    switch (state) {
      case "recording":
        return t("home.stop");
      case "transcribing":
        return t("home.transcribing");
      default:
        return t("home.record");
    }
  };

  return (
    <div className="home-page">
      {/* Record Button */}
      <div className="record-section">
        <button
          className={`record-btn ${state}`}
          onClick={handleRecordClick}
          disabled={state === "transcribing"}
        >
          {getButtonText()}
        </button>
      </div>

      {error && (
        <div className="error-card">
          <p>{error}</p>
        </div>
      )}

      {failedItems.map((item) => (
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

      {lastTranscription && (
        <div className="transcription-card">
          <div className="transcription-header">{t("home.lastTranscription")}</div>
          <p className="transcription-text">{lastTranscription}</p>
          <small className="transcription-note">{t("home.copiedToClipboard")}</small>
        </div>
      )}

      {!lastTranscription && !error && (
        <div className="empty-state">
          <p>{t("home.emptyState")}</p>
          <p className="fg-muted">{t("home.emptyHint")}</p>
        </div>
      )}
    </div>
  );
}

export default HomePage;
