import { useState, useMemo } from "react";
import { useHistory } from "../hooks/useHistory";
import { useCopyToClipboard } from "../lib/clipboard";
import AsyncContent from "../components/AsyncContent";
import HistoryList from "../components/history/HistoryList";
import "../styles/history.css";

function HistoryPage() {
  const { entries, loading, error, reload, clear } = useHistory(100);
  const [search, setSearch] = useState("");
  const { copied, copy } = useCopyToClipboard();

  const filteredEntries = useMemo(() => {
    if (!search.trim()) return entries;
    const query = search.toLowerCase();
    return entries.filter((e) => e.text.toLowerCase().includes(query));
  }, [entries, search]);

  const handleClear = async () => {
    if (window.confirm("Are you sure you want to clear all history?")) {
      await clear();
    }
  };

  return (
    <div className="history-page">
      <header className="page-header">
        <div className="page-header-content">
          <div>
            <h1 className="page-title">History</h1>
            <p className="page-description">
              View your past transcriptions ({entries.length} entries)
            </p>
          </div>
          <div className="page-header-actions">
            {copied && <span className="copied-toast">Copied!</span>}
            <button className="secondary" onClick={reload}>
              Refresh
            </button>
            <button
              className="secondary"
              onClick={handleClear}
              disabled={entries.length === 0}
            >
              Clear
            </button>
          </div>
        </div>
      </header>

      <div className="history-search">
        <input
          type="text"
          placeholder="Search transcriptions..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="history-search-input"
        />
      </div>

      <AsyncContent loading={loading} error={error}>
        <HistoryList entries={filteredEntries} onCopy={copy} />
      </AsyncContent>
    </div>
  );
}

export default HistoryPage;
