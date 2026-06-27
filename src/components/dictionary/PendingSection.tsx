import { useTranslation } from "react-i18next";
import { PendingSuggestion } from "../../lib/commands";
import EntryDisplay from "./EntryDisplay";

interface PendingSectionProps {
  suggestions: PendingSuggestion[];
  threshold: number;
  error?: string | null;
  status?: string | null;
  onApprove: (id: number) => Promise<void>;
  onReject: (id: number) => Promise<void>;
  onApproveAll: () => Promise<void>;
  onGenerateFromHistory?: () => Promise<void>;
  generating?: boolean;
}

function PendingSection({
  suggestions,
  threshold,
  error,
  status,
  onApprove,
  onReject,
  onApproveAll,
  onGenerateFromHistory,
  generating,
}: PendingSectionProps) {
  const { t } = useTranslation();
  return (
    <div className="card pending-section">
      <div className="pending-header">
        <h3 className="pending-title">
          {t("dictionary.pendingTitle", { count: suggestions.length })}
        </h3>
        <div style={{ display: "flex", gap: "8px" }}>
          {onGenerateFromHistory && (
            <button
              className="secondary"
              onClick={onGenerateFromHistory}
              disabled={generating}
            >
              {generating ? t("common.generating") : t("home.generateFromHistory")}
            </button>
          )}
          {suggestions.length > 1 && (
            <button className="primary" onClick={onApproveAll}>
              {t("common.approveAll")}
            </button>
          )}
        </div>
      </div>
      {error && (
        <p className="pending-error" role="alert" data-testid="pending-error">
          {error}
        </p>
      )}
      {status && (
        <p className="pending-status" role="status" data-testid="pending-status">
          {status}
        </p>
      )}
      <p className="pending-hint">{t("dictionary.approvedGoBelow")}</p>
      {suggestions.length > 0 ? (
        <p className="pending-description">
          {t("dictionary.pendingDescriptionActive")}
        </p>
      ) : (
        <p className="pending-description">
          {t("dictionary.pendingDescriptionEmpty")}
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
  const { t } = useTranslation();
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
        <span className="pending-count" title={t("dictionary.seenCount", { count: suggestion.count })}>
          {suggestion.count}/{threshold}
        </span>
        <div
          className="pending-progress"
          style={{ width: `${progress}%` }}
          title={t("dictionary.progressPercent", { percent: Math.round(progress) })}
        />
      </div>
      <div className="pending-item-actions">
        <button
          className="primary"
          onClick={() => onApprove(suggestion.id)}
          title={t("dictionary.addToDict")}
        >
          {t("common.approve")}
        </button>
        <button
          className="secondary"
          onClick={() => onReject(suggestion.id)}
          title={t("dictionary.ignoreSuggestion")}
        >
          {t("common.reject")}
        </button>
      </div>
    </div>
  );
}

export default PendingSection;
