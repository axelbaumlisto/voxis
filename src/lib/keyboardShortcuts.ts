/**
 * Keyboard shortcuts registry.
 *
 * OCP: Add new shortcuts without modifying Layout.tsx.
 * Centralizes all keyboard shortcut definitions.
 */

import { NavigateFunction } from "react-router-dom";
import { copyToClipboard } from "./clipboard";

export interface ShortcutAction {
  /** Layout-independent physical key code (KeyboardEvent.code), e.g. "KeyH".
   * Matched FIRST so the shortcut fires regardless of keyboard layout
   * (e.g. Russian layout where physical H emits the char "р"). */
  code: string;
  /** Character key (KeyboardEvent.key), kept as a fallback for environments
   * that don't report `code` (and for the lowercase-char matching path). */
  key: string;
  label: string;
  /** i18n key for the footer label, resolved via t() at the render boundary. */
  labelKey: string;
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
    code: "KeyH",
    key: "h",
    label: "History",
    labelKey: "nav.history",
    keyLabel: "h",
    action: ({ navigate }) => navigate("/history"),
  },
  {
    code: "KeyW",
    key: "w",
    label: "Dictionary",
    labelKey: "nav.dictionary",
    keyLabel: "w",
    action: ({ navigate }) => navigate("/dictionary"),
  },
  {
    code: "KeyS",
    key: "s",
    label: "Settings",
    labelKey: "nav.settings",
    keyLabel: "s",
    action: ({ navigate }) => navigate("/settings"),
  },
  {
    code: "KeyC",
    key: "c",
    label: "Copy",
    labelKey: "nav.copy",
    keyLabel: "c",
    action: ({ lastTranscription }) => {
      if (lastTranscription) {
        copyToClipboard(lastTranscription);
      }
    },
  },
  {
    code: "Escape",
    key: "escape",
    label: "Quit",
    labelKey: "nav.quit",
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

  // Match by physical key code FIRST (layout-independent: works on Russian,
  // Dvorak, etc.), falling back to the character key for environments that
  // don't populate `code`.
  const code = event.code;
  const key = event.key.toLowerCase();
  const shortcut = SHORTCUTS.find(
    (s) => (code && s.code === code) || s.key === key
  );

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
