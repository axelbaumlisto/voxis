import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
  const canSave = source.trim().length > 0 && replacement.trim().length > 0;

  return (
    <div className="dictionary-entry editing">
      <input
        type="text"
        value={source}
        onChange={(e) => onSourceChange(e.target.value)}
        placeholder={t("dictionary.sourcePlaceholder")}
        className="dictionary-input"
      />
      <span className="dictionary-arrow">→</span>
      <input
        type="text"
        value={replacement}
        onChange={(e) => onReplacementChange(e.target.value)}
        placeholder={t("dictionary.replacementPlaceholder")}
        className="dictionary-input"
      />
      <div className="dictionary-entry-actions">
        <button
          className="primary"
          onClick={onSave}
          disabled={saving || !canSave}
        >
          {saving ? "..." : t("common.save")}
        </button>
        <button className="secondary" onClick={onCancel} disabled={saving}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}

export default EditDictionaryEntryForm;
