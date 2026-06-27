/**
 * Status utilities for recording state display.
 *
 * DRY: Shared by Layout.tsx (status bar)
 */

export type RecordingState = "idle" | "recording" | "transcribing";

export interface StatusInfo {
  state: RecordingState;
  error: string | null;
  hotkey: string;
}

/**
 * Get CSS class for status bar based on state/error.
 */
export function getStatusClass(state: RecordingState, error: string | null): string {
  if (error) return "error";
  return state;
}

/**
 * Get status text to display.
 * Accepts optional t() function for i18n; falls back to English.
 */
export function getStatusText(info: StatusInfo, t?: (key: string, opts?: Record<string, unknown>) => string): string {
  const { state, error, hotkey } = info;

  if (error) {
    return `! ${error}`;
  }

  if (t) {
    switch (state) {
      case "recording":
        return t("status.recording", { hotkey });
      case "transcribing":
        return t("status.transcribing");
      default:
        return t("status.ready", { hotkey });
    }
  }

  switch (state) {
    case "recording":
      return `REC  Recording...  Release ${hotkey} to stop`;
    case "transcribing":
      return "Transcribing...  Please wait";
    default:
      return `Ready  Press ${hotkey} to record`;
  }
}

/**
 * Get status icon character.
 */
export function getStatusIcon(state: RecordingState, error: string | null): string {
  if (error) return "!";
  switch (state) {
    case "recording":
      return "\u25CF"; // filled circle
    case "transcribing":
      return "\u25D0"; // half circle
    default:
      return "\u25CB"; // empty circle
  }
}

/**
 * Format hotkey string for display.
 * Converts backend format (ctrl_r, f12) to display format (Ctrl (Right), F12).
 */
export function formatHotkey(hotkeyStr: string): string {
  return hotkeyStr
    .replace(/_r$/i, " (Right)")
    .replace(/_l$/i, " (Left)")
    .replace(/^ctrl/i, "Ctrl")
    .replace(/^alt/i, "Alt")
    .replace(/^shift/i, "Shift")
    .replace(/^super/i, "Super")
    .replace(/^f(\d+)$/i, "F$1");
}

/**
 * Format hotkey for the status bar (simpler version with + notation).
 */
export function formatHotkeySimple(hotkeyStr: string): string {
  return hotkeyStr
    .replace(/_/g, "+")
    .replace(/ctrl/gi, "Ctrl")
    .replace(/alt/gi, "Alt")
    .replace(/shift/gi, "Shift")
    .replace(/super/gi, "Super");
}
