import { useEffect, useState } from "react";
import { useDictionary } from "../hooks/useDictionary";
import { usePendingSuggestions } from "../hooks/usePendingSuggestions";
import { getConfig } from "../lib/commands";
import AsyncContent from "../components/AsyncContent";
import DictionaryEntry from "../components/dictionary/DictionaryEntry";
import AddEntryForm from "../components/dictionary/AddEntryForm";
import PendingSection from "../components/dictionary/PendingSection";
import "../styles/dictionary.css";

function DictionaryPage() {
  const { entries, loading, error, add, remove, update, reload } = useDictionary();
  const {
    suggestions: pendingSuggestions,
    approve,
    reject,
    approveAll,
    generateFromHistory,
    generating,
  } = usePendingSuggestions();
  const [threshold, setThreshold] = useState(3);

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
    await generateFromHistory();
    await reload();
  };

  return (
    <div className="dictionary-page">
      <header className="page-header">
        <h1 className="page-title">Dictionary</h1>
        <p className="page-description">
          Manage word replacements for transcriptions ({entries.length} entries)
        </p>
      </header>

      <PendingSection
        suggestions={pendingSuggestions}
        threshold={threshold}
        onApprove={handleApprove}
        onReject={reject}
        onApproveAll={handleApproveAll}
        onGenerateFromHistory={handleGenerateFromHistory}
        generating={generating}
      />

      <div className="card dictionary-add-card">
        <h3 className="dictionary-add-title">Add New Entry</h3>
        <AddEntryForm onAdd={add} />
      </div>

      <AsyncContent
        loading={loading}
        error={error}
        isEmpty={entries.length === 0}
        emptyMessage="No dictionary entries yet."
        emptyHint="Add word replacements to automatically correct transcriptions."
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
