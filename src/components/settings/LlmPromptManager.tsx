/**
 * LlmPromptManager — UI for the multi-prompt LLM template registry
 * Manages multiple local LLM prompt templates for post-processing.
 *
 * Mounts under Settings → Output → Post-processing. Lets the user:
 *   - pick the active prompt template (dropdown)
 *   - inline-edit name + body of any prompt
 *   - create a new prompt
 *   - delete an existing one
 *
 * All persistence goes through auto-generated `commands.*` from
 * `src/bindings.ts` (DIP: no direct Tauri invoke calls). The component
 * keeps its own in-memory copy of the list + active id and re-fetches
 * after each mutation so the UI stays consistent without complex
 * optimistic updates (KISS).
 *
 * Tests in __tests__/LlmPromptManager.test.tsx stub the bindings module
 * and verify the render contract + onChange wiring.
 */
import { useCallback, useEffect, useState } from "react";
import { commands } from "../../bindings";
import type { LlmPrompt } from "../../bindings";
import { unwrapResult } from "../../lib/commandResult";

type LoadState = "idle" | "loading" | "error";

export interface LlmPromptManagerProps {
  /** When false the editor is rendered read-only — useful for previews. */
  editable?: boolean;
}

function genId(name: string): string {
  // Stable id derived from the user-visible name. Lowercase, ASCII-safe
  // letters/numbers/underscores. Random suffix avoids collisions.
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${base || "prompt"}_${suffix}`;
}

export default function LlmPromptManager({
  editable = true,
}: LlmPromptManagerProps) {
  const [prompts, setPrompts] = useState<LlmPrompt[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      // Defensive defaults: synthetic/test environments may resolve
      // these commands with undefined when the bindings layer is
      // partly mocked. Treat that as "empty list / no active" so the
      // render never crashes (KISS, no separate "undefined" branch).
      const list = (unwrapResult(await commands.listLlmPrompts()) ?? []) as LlmPrompt[];
      const active = (unwrapResult(await commands.getActiveLlmPromptId()) ?? null) as
        | string
        | null;
      setPrompts(list);
      setActiveId(active);
      setState("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onSelectActive = async (id: string | null) => {
    try {
      unwrapResult(await commands.setActiveLlmPromptId(id));
      setActiveId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onUpdate = async (id: string, name: string, prompt: string) => {
    try {
      unwrapResult(await commands.updateLlmPrompt(id, name, prompt));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onCreate = async () => {
    const name = "New prompt";
    const id = genId(name);
    try {
      unwrapResult(
        await commands.createLlmPrompt(
          id,
          name,
          "Fix grammar and punctuation in transcribed speech.",
        ),
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onDelete = async (id: string) => {
    try {
      unwrapResult(await commands.deleteLlmPrompt(id));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="llm-prompt-manager" data-testid="llm-prompt-manager">
      <div
        className="llm-prompt-manager__header"
        style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}
      >
        <label htmlFor="llm-prompt-active">Active prompt:</label>
        <select
          id="llm-prompt-active"
          data-testid="llm-prompt-active-select"
          value={activeId ?? ""}
          onChange={(e) => void onSelectActive(e.target.value || null)}
          disabled={!editable || state === "loading"}
        >
          <option value="">— Use legacy llm.prompt —</option>
          {prompts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {editable && (
          <button
            type="button"
            data-testid="llm-prompt-create"
            onClick={() => void onCreate()}
            disabled={state === "loading"}
          >
            + Add
          </button>
        )}
      </div>

      {error && (
        <div role="alert" style={{ color: "var(--error)" }}>
          {error}
        </div>
      )}

      <ul className="llm-prompt-manager__list" style={{ paddingLeft: 0 }}>
        {prompts.map((p) => (
          <li
            key={p.id}
            data-testid={`llm-prompt-row-${p.id}`}
            style={{
              listStyle: "none",
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
              padding: "6px 0",
              borderTop: "1px solid var(--border)",
            }}
          >
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
              <input
                type="text"
                value={p.name}
                data-testid={`llm-prompt-name-${p.id}`}
                onChange={(e) => void onUpdate(p.id, e.target.value, p.prompt)}
                disabled={!editable}
                style={{ width: "100%" }}
              />
              <textarea
                rows={3}
                value={p.prompt}
                data-testid={`llm-prompt-body-${p.id}`}
                onChange={(e) => void onUpdate(p.id, p.name, e.target.value)}
                disabled={!editable}
                style={{ width: "100%", fontFamily: "inherit" }}
              />
            </div>
            {editable && (
              <button
                type="button"
                data-testid={`llm-prompt-delete-${p.id}`}
                onClick={() => void onDelete(p.id)}
                title="Delete this prompt"
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
