import { useTranslation } from "react-i18next";
import { HistoryEntry as HistoryEntryType } from "../../lib/commands";

interface HistoryEntryProps {
  entry: HistoryEntryType;
  onCopy: (text: string) => void;
}

function HistoryEntry({ entry, onCopy }: HistoryEntryProps) {
  const { t } = useTranslation();
  const formatTimestamp = (ts: string) => {
    try {
      const date = new Date(ts.replace(" ", "T"));
      return date.toLocaleString();
    } catch {
      return ts;
    }
  };

  return (
    <div className="history-entry">
      <div className="history-entry-header">
        <span className="history-entry-timestamp">
          {formatTimestamp(entry.timestamp)}
        </span>
        <div className="history-entry-meta">
          {entry.language && (
            <span className="history-entry-language">{entry.language}</span>
          )}
          {entry.duration && (
            <span className="history-entry-duration">
              {entry.duration.toFixed(1)}s
            </span>
          )}
        </div>
      </div>
      <p className="history-entry-text">{entry.text}</p>
      <div className="history-entry-actions">
        <button className="secondary" onClick={() => onCopy(entry.text)}>
          {t("common.copy")}
        </button>
      </div>
    </div>
  );
}

export default HistoryEntry;
