import { useState } from "react";

interface AddEntryFormProps {
  onAdd: (source: string, replacement: string) => Promise<void>;
}

function AddEntryForm({ onAdd }: AddEntryFormProps) {
  const [source, setSource] = useState("");
  const [replacement, setReplacement] = useState("");
  const [adding, setAdding] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!source.trim() || !replacement.trim()) return;

    setAdding(true);
    try {
      await onAdd(source.trim(), replacement.trim());
      setSource("");
      setReplacement("");
    } catch {
      // Error is handled by the hook and displayed in parent
    } finally {
      setAdding(false);
    }
  };

  return (
    <form className="add-entry-form" onSubmit={handleSubmit}>
      <input
        type="text"
        value={source}
        onChange={(e) => setSource(e.target.value)}
        placeholder="Source word (e.g., солид)"
        className="add-entry-input"
      />
      <span className="dictionary-arrow">→</span>
      <input
        type="text"
        value={replacement}
        onChange={(e) => setReplacement(e.target.value)}
        placeholder="Replacement (e.g., SOLID)"
        className="add-entry-input"
      />
      <button
        type="submit"
        className="primary"
        disabled={adding || !source.trim() || !replacement.trim()}
      >
        {adding ? "Adding..." : "Add"}
      </button>
    </form>
  );
}

export default AddEntryForm;
