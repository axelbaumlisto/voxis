/**
 * Keyboard shortcuts registry.
 *
 * OCP: Add new shortcuts without modifying Layout.tsx.
 * Centralizes all keyboard shortcut definitions.
 */

import { NavigateFunction } from "react-router-dom";
import { copyToClipboard } from "./clipboard";

export interface ShortcutAction {
  key: string;
  label: string;
  /** Short key label for footer display */
  keyLabel: string;
  action: (context: ShortcutContext) => void;
}

export interface ShortcutContext {
  navigate: NavigateFunction;
  lastTranscription: string | null;
  closeWindow: () => void;
}

/**
 * Registry of keyboard shortcuts.
 * Add new shortcuts here without modifying components.
 */
export const SHORTCUTS: ShortcutAction[] = [
  {
    key: "h",
    label: "History",
    keyLabel: "h",
    action: ({ navigate }) => navigate("/history"),
  },
  {
    key: "w",
    label: "Dictionary",
    keyLabel: "w",
    action: ({ navigate }) => navigate("/dictionary"),
  },
  {
    key: "s",
    label: "Settings",
    keyLabel: "s",
    action: ({ navigate }) => navigate("/settings"),
  },
  {
    key: "c",
    label: "Copy",
    keyLabel: "c",
    action: ({ lastTranscription }) => {
      if (lastTranscription) {
        copyToClipboard(lastTranscription);
      }
    },
  },
  {
    key: "escape",
    label: "Quit",
    keyLabel: "Esc",
    action: ({ closeWindow }) => closeWindow(),
  },
];

/**
 * Handle keyboard event using shortcuts registry.
 * Returns true if a shortcut was handled.
 */
export function handleShortcut(
  event: KeyboardEvent,
  context: ShortcutContext
): boolean {
  // Skip if typing in input/textarea
  if (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement
  ) {
    return false;
  }

  const key = event.key.toLowerCase();
  const shortcut = SHORTCUTS.find((s) => s.key === key);

  if (shortcut) {
    shortcut.action(context);
    return true;
  }

  return false;
}

/**
 * Get shortcuts for footer display.
 * Filters out system shortcuts like Escape if needed.
 */
export function getFooterShortcuts(): ShortcutAction[] {
  return SHORTCUTS;
}
