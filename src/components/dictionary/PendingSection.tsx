import { PendingSuggestion } from "../../lib/commands";
import EntryDisplay from "./EntryDisplay";

interface PendingSectionProps {
  suggestions: PendingSuggestion[];
  threshold: number;
  onApprove: (id: number) => Promise<void>;
  onReject: (id: number) => Promise<void>;
  onApproveAll: () => Promise<void>;
  onGenerateFromHistory?: () => Promise<void>;
  generating?: boolean;
}

function PendingSection({
  suggestions,
  threshold,
  onApprove,
  onReject,
  onApproveAll,
  onGenerateFromHistory,
  generating,
}: PendingSectionProps) {
  return (
    <div className="card pending-section">
      <div className="pending-header">
        <h3 className="pending-title">
          Pending Suggestions ({suggestions.length})
        </h3>
        <div style={{ display: "flex", gap: "8px" }}>
          {onGenerateFromHistory && (
            <button
              className="secondary"
              onClick={onGenerateFromHistory}
              disabled={generating}
            >
              {generating ? "Generating..." : "Generate from History"}
            </button>
          )}
          {suggestions.length > 1 && (
            <button className="primary" onClick={onApproveAll}>
              Approve All
            </button>
          )}
        </div>
      </div>
      {suggestions.length > 0 ? (
        <p className="pending-description">
          LLM suggested these dictionary entries. Approve to add them or reject
          to ignore.
        </p>
      ) : (
        <p className="pending-description">
          No pending suggestions. Click "Generate from History" to analyze your
          transcription history and find terms for your dictionary.
        </p>
      )}

      <div className="pending-list">
        {suggestions.map((suggestion) => (
          <PendingSuggestionItem
            key={suggestion.id}
            suggestion={suggestion}
            threshold={threshold}
            onApprove={onApprove}
            onReject={onReject}
          />
        ))}
      </div>
    </div>
  );
}

interface PendingSuggestionItemProps {
  suggestion: PendingSuggestion;
  threshold: number;
  onApprove: (id: number) => Promise<void>;
  onReject: (id: number) => Promise<void>;
}

function PendingSuggestionItem({
  suggestion,
  threshold,
  onApprove,
  onReject,
}: PendingSuggestionItemProps) {
  const progress = Math.min((suggestion.count / threshold) * 100, 100);
  const isReady = suggestion.count >= threshold;

  return (
    <div className={`pending-item ${isReady ? "ready" : ""}`}>
      <div className="pending-item-content">
        <EntryDisplay
          source={suggestion.source}
          replacement={suggestion.replacement}
          classPrefix="pending"
        />
        <span className="pending-count" title={`Seen ${suggestion.count} time(s)`}>
          {suggestion.count}/{threshold}
        </span>
        <div
          className="pending-progress"
          style={{ width: `${progress}%` }}
          title={`${Math.round(progress)}% to auto-add`}
        />
      </div>
      <div className="pending-item-actions">
        <button
          className="primary"
          onClick={() => onApprove(suggestion.id)}
          title="Add to dictionary"
        >
          Approve
        </button>
        <button
          className="secondary"
          onClick={() => onReject(suggestion.id)}
          title="Ignore this suggestion"
        >
          Reject
        </button>
      </div>
    </div>
  );
}

export default PendingSection;
