import { useTranslation } from "react-i18next";
import { HistoryEntry as HistoryEntryType } from "../../lib/commands";
import HistoryEntry from "./HistoryEntry";

interface HistoryListProps {
  entries: HistoryEntryType[];
  onCopy: (text: string) => void;
}

function HistoryList({ entries, onCopy }: HistoryListProps) {
  const { t } = useTranslation();
  if (entries.length === 0) {
    return (
      <div className="history-empty">
        <p>{t("history.empty")}</p>
        <p className="empty-hint">{t("history.emptyHint")}</p>
      </div>
    );
  }

  return (
    <div className="history-list">
      {entries.map((entry) => (
        <HistoryEntry key={entry.id} entry={entry} onCopy={onCopy} />
      ))}
    </div>
  );
}

export default HistoryList;
