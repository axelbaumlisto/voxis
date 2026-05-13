/**
 * Tests for LlmPromptManager.
 *
 * Mocks the auto-generated `commands` module from `bindings.ts` so we
 * never touch Tauri. Covers:
 *   - initial fetch populates the list + active dropdown
 *   - selecting an option fires setActiveLlmPromptId
 *   - clicking "+ Add" creates a new prompt and refreshes
 *   - clicking the delete button removes the row
 *   - editing the name input fires updateLlmPrompt
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const listMock = vi.fn();
const getActiveMock = vi.fn();
const setActiveMock = vi.fn();
const createMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

vi.mock("../../../bindings", () => ({
  commands: {
    listLlmPrompts: (...a: unknown[]) => listMock(...a),
    getActiveLlmPromptId: (...a: unknown[]) => getActiveMock(...a),
    setActiveLlmPromptId: (...a: unknown[]) => setActiveMock(...a),
    createLlmPrompt: (...a: unknown[]) => createMock(...a),
    updateLlmPrompt: (...a: unknown[]) => updateMock(...a),
    deleteLlmPrompt: (...a: unknown[]) => deleteMock(...a),
  },
}));

import LlmPromptManager from "../LlmPromptManager";

const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });

const seedList = [
  { id: "fix_grammar", name: "Fix grammar", prompt: "Fix grammar prompt body." },
  { id: "email_tone", name: "Email tone", prompt: "Rewrite as email." },
];

beforeEach(() => {
  listMock.mockReset();
  getActiveMock.mockReset();
  setActiveMock.mockReset();
  createMock.mockReset();
  updateMock.mockReset();
  deleteMock.mockReset();
  listMock.mockReturnValue(ok(seedList));
  getActiveMock.mockReturnValue(ok(null));
  setActiveMock.mockReturnValue(ok(undefined));
  createMock.mockReturnValue(
    ok({ id: "new_xx", name: "New prompt", prompt: "Fix grammar..." }),
  );
  updateMock.mockReturnValue(
    ok({ id: "fix_grammar", name: "Edited", prompt: "Body" }),
  );
  deleteMock.mockReturnValue(ok(undefined));
});

describe("LlmPromptManager", () => {
  it("fetches and renders the prompt list", async () => {
    render(<LlmPromptManager />);
    await waitFor(() => {
      expect(screen.getByTestId("llm-prompt-row-fix_grammar")).toBeTruthy();
    });
    expect(screen.getByTestId("llm-prompt-row-email_tone")).toBeTruthy();
  });

  it("populates the active-prompt dropdown options", async () => {
    render(<LlmPromptManager />);
    await waitFor(() => {
      expect(screen.getByTestId("llm-prompt-active-select")).toBeTruthy();
    });
    const select = screen.getByTestId(
      "llm-prompt-active-select",
    ) as HTMLSelectElement;
    // 1 legacy + 2 seeds
    expect(select.querySelectorAll("option").length).toBe(3);
  });

  it("selecting a prompt fires setActiveLlmPromptId", async () => {
    render(<LlmPromptManager />);
    await waitFor(() =>
      expect(screen.getByTestId("llm-prompt-active-select")).toBeTruthy(),
    );
    const select = screen.getByTestId("llm-prompt-active-select");
    fireEvent.change(select, { target: { value: "email_tone" } });
    await waitFor(() =>
      expect(setActiveMock).toHaveBeenCalledWith("email_tone"),
    );
  });

  it("clicking '+ Add' calls createLlmPrompt", async () => {
    render(<LlmPromptManager />);
    await waitFor(() =>
      expect(screen.getByTestId("llm-prompt-create")).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId("llm-prompt-create"));
    await waitFor(() => expect(createMock).toHaveBeenCalled());
  });

  it("clicking the delete button calls deleteLlmPrompt", async () => {
    render(<LlmPromptManager />);
    await waitFor(() =>
      expect(screen.getByTestId("llm-prompt-delete-fix_grammar")).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId("llm-prompt-delete-fix_grammar"));
    await waitFor(() =>
      expect(deleteMock).toHaveBeenCalledWith("fix_grammar"),
    );
  });

  it("editing the name input calls updateLlmPrompt", async () => {
    render(<LlmPromptManager />);
    await waitFor(() =>
      expect(screen.getByTestId("llm-prompt-name-fix_grammar")).toBeTruthy(),
    );
    const input = screen.getByTestId("llm-prompt-name-fix_grammar");
    fireEvent.change(input, { target: { value: "Fix grammar v2" } });
    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith(
        "fix_grammar",
        "Fix grammar v2",
        "Fix grammar prompt body.",
      ),
    );
  });
});
