import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DictionaryEntry as DictionaryEntryType } from "../../lib/commands";
import EntryDisplay from "./EntryDisplay";
import EditDictionaryEntryForm from "./EditDictionaryEntryForm";

interface DictionaryEntryProps {
  entry: DictionaryEntryType;
  onUpdate: (id: number, source: string, replacement: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

/**
 * Dictionary entry component with view and edit modes.
 * SRP: Uses EditDictionaryEntryForm for edit mode, EntryDisplay for view mode.
 */
function DictionaryEntry({ entry, onUpdate, onDelete }: DictionaryEntryProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [source, setSource] = useState(entry.source);
  const [replacement, setReplacement] = useState(entry.replacement);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!source.trim() || !replacement.trim()) return;
    setSaving(true);
    try {
      await onUpdate(entry.id, source.trim(), replacement.trim());
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setSource(entry.source);
    setReplacement(entry.replacement);
    setEditing(false);
  };

  const handleDelete = async () => {
    if (
      window.confirm(
        t("dictionary.confirmDelete", {
          source: entry.source,
          replacement: entry.replacement,
        })
      )
    ) {
      await onDelete(entry.id);
    }
  };

  if (editing) {
    return (
      <EditDictionaryEntryForm
        source={source}
        replacement={replacement}
        onSourceChange={setSource}
        onReplacementChange={setReplacement}
        onSave={handleSave}
        onCancel={handleCancel}
        saving={saving}
      />
    );
  }

  return (
    <div className="dictionary-entry">
      <EntryDisplay source={entry.source} replacement={entry.replacement} />
      <div className="dictionary-entry-actions">
        <button className="secondary" onClick={() => setEditing(true)}>
          {t("common.edit")}
        </button>
        <button className="secondary" onClick={handleDelete}>
          {t("common.delete")}
        </button>
      </div>
    </div>
  );
}

export default DictionaryEntry;
