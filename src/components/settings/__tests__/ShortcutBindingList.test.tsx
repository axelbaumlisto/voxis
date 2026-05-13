import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const listMock = vi.fn();
const updateMock = vi.fn();
const resetMock = vi.fn();

vi.mock("../../../bindings", () => ({
  commands: {
    listShortcutBindings: (...a: unknown[]) => listMock(...a),
    updateShortcutBinding: (...a: unknown[]) => updateMock(...a),
    resetShortcutBinding: (...a: unknown[]) => resetMock(...a),
  },
}));

import ShortcutBindingList from "../ShortcutBindingList";

const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });

const seed = [
  {
    id: "transcribe",
    name: "Transcribe",
    description: "Record + paste",
    default_binding: "alt_r",
    current_binding: "alt_r",
    action: { kind: "transcribe" },
  },
  {
    id: "transcribe_post_process",
    name: "Transcribe + LLM",
    description: "Record + LLM",
    default_binding: "ctrl+alt_r",
    current_binding: "ctrl+alt_r",
    action: { kind: "transcribe_post_process" },
  },
];

beforeEach(() => {
  listMock.mockReset();
  updateMock.mockReset();
  resetMock.mockReset();
  listMock.mockReturnValue(ok(seed));
  updateMock.mockImplementation((_id: string, _combo: string) =>
    ok({ ...seed[0], current_binding: _combo }),
  );
  resetMock.mockImplementation((_id: string) => ok(seed[0]));
});

describe("ShortcutBindingList", () => {
  it("renders one row per binding", async () => {
    render(<ShortcutBindingList />);
    await waitFor(() =>
      expect(screen.getByTestId("binding-row-transcribe")).toBeTruthy(),
    );
    expect(screen.getByTestId("binding-row-transcribe_post_process")).toBeTruthy();
  });

  it("editing the combo input fires updateShortcutBinding", async () => {
    render(<ShortcutBindingList />);
    await waitFor(() =>
      expect(screen.getByTestId("binding-input-transcribe")).toBeTruthy(),
    );
    fireEvent.change(screen.getByTestId("binding-input-transcribe"), {
      target: { value: "f12" },
    });
    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith("transcribe", "f12"),
    );
  });

  it("clicking Reset fires resetShortcutBinding", async () => {
    // Seed has current==default so the reset button starts disabled.
    // We need a row where they differ.
    listMock.mockReturnValueOnce(
      ok([
        {
          ...seed[0],
          current_binding: "f9",
        },
      ]),
    );
    render(<ShortcutBindingList />);
    await waitFor(() =>
      expect(screen.getByTestId("binding-reset-transcribe")).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId("binding-reset-transcribe"));
    await waitFor(() => expect(resetMock).toHaveBeenCalledWith("transcribe"));
  });

  it("reset button is disabled when current matches default", async () => {
    render(<ShortcutBindingList />);
    await waitFor(() =>
      expect(screen.getByTestId("binding-reset-transcribe")).toBeTruthy(),
    );
    const btn = screen.getByTestId(
      "binding-reset-transcribe",
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("shows the default combo as placeholder", async () => {
    render(<ShortcutBindingList />);
    await waitFor(() =>
      expect(screen.getByTestId("binding-input-transcribe")).toBeTruthy(),
    );
    const input = screen.getByTestId(
      "binding-input-transcribe",
    ) as HTMLInputElement;
    expect(input.placeholder).toBe("alt_r");
  });
});
