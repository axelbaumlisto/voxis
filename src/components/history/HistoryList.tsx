import { HistoryEntry as HistoryEntryType } from "../../lib/commands";
import HistoryEntry from "./HistoryEntry";

interface HistoryListProps {
  entries: HistoryEntryType[];
  onCopy: (text: string) => void;
}

function HistoryList({ entries, onCopy }: HistoryListProps) {
  if (entries.length === 0) {
    return (
      <div className="history-empty">
        <p>No transcriptions yet.</p>
        <p className="history-empty-hint">
          Start recording to see your transcriptions here.
        </p>
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
