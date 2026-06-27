import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDictionary } from "../hooks/useDictionary";
import { usePendingSuggestions } from "../hooks/usePendingSuggestions";
import { getConfig } from "../lib/commands";
import AsyncContent from "../components/AsyncContent";
import DictionaryEntry from "../components/dictionary/DictionaryEntry";
import AddEntryForm from "../components/dictionary/AddEntryForm";
import PendingSection from "../components/dictionary/PendingSection";
import "../styles/dictionary.css";

function DictionaryPage() {
  const { t } = useTranslation();
  const { entries, loading, error, add, remove, update, reload } = useDictionary();
  const {
    suggestions: pendingSuggestions,
    error: pendingError,
    approve,
    reject,
    approveAll,
    generateFromHistory,
    generating,
  } = usePendingSuggestions();
  const [threshold, setThreshold] = useState(3);
  const [generateStatus, setGenerateStatus] = useState<string | null>(null);

  // Load learning threshold from config
  useEffect(() => {
    getConfig().then((config) => {
      setThreshold(config.dictionary.learning_threshold);
    });
  }, []);

  // Reload dictionary after approving suggestions
  const handleApprove = async (id: number) => {
    await approve(id);
    await reload();
  };

  const handleApproveAll = async () => {
    await approveAll();
    await reload();
  };

  const handleGenerateFromHistory = async () => {
    // generateFromHistory throws on failure (e.g. LLM API key not configured);
    // the hook stores the message in `pendingError`, which we surface below.
    // Swallow the rejection here so it isn't an unhandled promise error.
    // Clear any prior status so it never stacks with a fresh run or an error.
    setGenerateStatus(null);
    try {
      const { processed, recorded, promoted, skipped } =
        await generateFromHistory();
      setGenerateStatus(
        t("dictionary.generateResult", { processed, recorded, promoted, skipped })
      );
    } catch {
      // error already captured in pendingError and shown in PendingSection;
      // ensure status and error never coexist.
      setGenerateStatus(null);
    }
  };

  return (
    <div className="dictionary-page">
      <header className="page-header">
        <h1 className="page-title">{t("dictionary.title")}</h1>
        <p className="page-description">
          {t("dictionary.description", { count: entries.length })}
        </p>
      </header>

      <PendingSection
        suggestions={pendingSuggestions}
        threshold={threshold}
        error={pendingError}
        status={generateStatus}
        onApprove={handleApprove}
        onReject={reject}
        onApproveAll={handleApproveAll}
        onGenerateFromHistory={handleGenerateFromHistory}
        generating={generating}
      />

      <div className="card dictionary-add-card">
        <h3 className="dictionary-add-title">{t("dictionary.addNewEntry")}</h3>
        <AddEntryForm onAdd={add} />
      </div>

      <AsyncContent
        loading={loading}
        error={error}
        isEmpty={entries.length === 0}
        emptyMessage={t("dictionary.empty")}
        emptyHint={t("dictionary.emptyHint")}
        emptyClassName="dictionary-empty"
      >
        <div className="dictionary-list">
          {entries.map((entry) => (
            <DictionaryEntry
              key={entry.id}
              entry={entry}
              onUpdate={update}
              onDelete={remove}
            />
          ))}
        </div>
      </AsyncContent>
    </div>
  );
}

export default DictionaryPage;
