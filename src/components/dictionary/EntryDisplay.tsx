/**
 * Reusable component for displaying "source → replacement" pattern.
 * DRY: Used in DictionaryEntry, PendingSection, and AddEntryForm.
 */

interface EntryDisplayProps {
  source: string;
  replacement: string;
  /** Optional CSS class prefix for styling variants (e.g., "dictionary", "pending") */
  classPrefix?: string;
}

function EntryDisplay({ source, replacement, classPrefix = "dictionary" }: EntryDisplayProps) {
  return (
    <>
      <span className={`${classPrefix}-source`}>{source}</span>
      <span className={`${classPrefix}-arrow`}>→</span>
      <span className={`${classPrefix}-replacement`}>{replacement}</span>
    </>
  );
}

export default EntryDisplay;
