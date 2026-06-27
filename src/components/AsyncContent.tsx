/**
 * AsyncContent - Unified component for loading/error/empty patterns.
 *
 * DRY: Merges LoadingErrorWrapper and AsyncPageContent into one component.
 *
 * Usage:
 * <AsyncContent
 *   loading={loading}
 *   error={error}
 *   isEmpty={entries.length === 0}
 *   emptyMessage="No entries yet"
 *   emptyHint="Add some entries to get started"
 * >
 *   {children}
 * </AsyncContent>
 */

import { ReactNode } from "react";

export interface AsyncContentProps {
  /** Whether data is currently loading */
  loading: boolean;
  /** Error message if loading failed */
  error?: string | null;
  /** Whether the data is empty */
  isEmpty?: boolean;
  /** Message to show when empty */
  emptyMessage?: string;
  /** Secondary hint text when empty (optional) */
  emptyHint?: string;
  /** Custom loading text */
  loadingText?: string;
  /** CSS class for the loading/error container */
  containerClassName?: string;
  /** CSS class for the empty state container */
  emptyClassName?: string;
  /** Content to render when loaded successfully */
  children: ReactNode;
}

/**
 * Renders loading, error, empty, or content states uniformly.
 *
 * Priority order:
 * 1. Loading state (if loading=true)
 * 2. Error state (if error is set)
 * 3. Empty state (if isEmpty=true)
 * 4. Children (normal content)
 */
function AsyncContent({
  loading,
  error,
  isEmpty = false,
  emptyMessage = "No data available",
  emptyHint,
  loadingText = "Loading...",
  containerClassName = "card",
  emptyClassName = "empty-state",
  children,
}: AsyncContentProps) {
  if (loading) {
    return (
      <div className={containerClassName}>
        <p style={{ color: "var(--fg-muted)" }}>{loadingText}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={containerClassName}>
        <p style={{ color: "var(--error)" }}>Error: {error}</p>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className={emptyClassName}>
        <p>{emptyMessage}</p>
        {emptyHint && <p className="empty-hint">{emptyHint}</p>}
      </div>
    );
  }

  return <>{children}</>;
}

export default AsyncContent;
