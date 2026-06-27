/**
 * ShortcutBindingList — UI for multi-binding shortcut configuration
 * (#2 from .pi/plans/handy-recommendations-cloud-only.md).
 *
 * Renders one row per binding with:
 *   - name + description
 *   - current_binding shown as an editable text input (free-form
 *     combo string; full chord-capture is a follow-up)
 *   - "Reset" button to revert to default_binding
 *
 * Persistence goes through `commands.updateShortcutBinding` /
 * `commands.resetShortcutBinding` (auto-generated from Rust by
 * specta).
 *
 * KISS: free-text combo edit instead of a chord-capture widget.
 * Strings like "alt_r" / "ctrl+alt_r" round-trip cleanly through the
 * parser the hotkey layer already uses.
 */
import { useCallback, useEffect, useState } from "react";
import { commands } from "../../bindings";
import type { ShortcutBinding } from "../../bindings";
import { unwrapResult } from "../../lib/commandResult";

export default function ShortcutBindingList() {
  const [bindings, setBindings] = useState<ShortcutBinding[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list =
        (unwrapResult(await commands.listShortcutBindings()) ?? []) as ShortcutBinding[];
      setBindings(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onUpdate = async (id: string, newCombo: string) => {
    try {
      unwrapResult(await commands.updateShortcutBinding(id, newCombo));
      // Optimistic local update so the input stays responsive without\n      // a full refetch round-trip.
      setBindings((prev) =>
        prev.map((b) =>
          b.id === id ? { ...b, current_binding: newCombo } : b,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onReset = async (id: string) => {
    try {
      const reset = unwrapResult(await commands.resetShortcutBinding(id));
      setBindings((prev) => prev.map((b) => (b.id === id ? reset : b)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div data-testid="shortcut-binding-list" className="shortcut-binding-list">
      {loading && <p>Loading shortcuts…</p>}
      {error && (
        <div role="alert" style={{ color: "var(--error)" }}>
          {error}
        </div>
      )}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "4px 8px" }}>Action</th>
            <th style={{ textAlign: "left", padding: "4px 8px" }}>Combo</th>
            <th style={{ width: 1 }}></th>
          </tr>
        </thead>
        <tbody>
          {bindings.map((b) => (
            <tr key={b.id} data-testid={`binding-row-${b.id}`}>
              <td style={{ padding: "4px 8px", verticalAlign: "top" }}>
                <strong>{b.name}</strong>
                <div style={{ fontSize: "0.85em", opacity: 0.8 }}>
                  {b.description}
                </div>
              </td>
              <td style={{ padding: "4px 8px", verticalAlign: "top" }}>
                <input
                  type="text"
                  value={b.current_binding}
                  data-testid={`binding-input-${b.id}`}
                  onChange={(e) => void onUpdate(b.id, e.target.value)}
                  placeholder={b.default_binding}
                  style={{ width: "180px", fontFamily: "monospace" }}
                />
                <div style={{ fontSize: "0.75em", opacity: 0.7 }}>
                  Default: <code>{b.default_binding}</code>
                </div>
              </td>
              <td style={{ padding: "4px 8px", verticalAlign: "top" }}>
                <button
                  type="button"
                  data-testid={`binding-reset-${b.id}`}
                  onClick={() => void onReset(b.id)}
                  disabled={b.current_binding === b.default_binding}
                  title="Revert to default"
                >
                  Reset
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
