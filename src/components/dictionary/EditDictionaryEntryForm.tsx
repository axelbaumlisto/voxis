interface EditDictionaryEntryFormProps {
  source: string;
  replacement: string;
  onSourceChange: (value: string) => void;
  onReplacementChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}

/**
 * Edit form for dictionary entries.
 * SRP: Handles edit form UI rendering only.
 */
function EditDictionaryEntryForm({
  source,
  replacement,
  onSourceChange,
  onReplacementChange,
  onSave,
  onCancel,
  saving,
}: EditDictionaryEntryFormProps) {
  const canSave = source.trim().length > 0 && replacement.trim().length > 0;

  return (
    <div className="dictionary-entry editing">
      <input
        type="text"
        value={source}
        onChange={(e) => onSourceChange(e.target.value)}
        placeholder="Source"
        className="dictionary-input"
      />
      <span className="dictionary-arrow">→</span>
      <input
        type="text"
        value={replacement}
        onChange={(e) => onReplacementChange(e.target.value)}
        placeholder="Replacement"
        className="dictionary-input"
      />
      <div className="dictionary-entry-actions">
        <button
          className="primary"
          onClick={onSave}
          disabled={saving || !canSave}
        >
          {saving ? "..." : "Save"}
        </button>
        <button className="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export default EditDictionaryEntryForm;
