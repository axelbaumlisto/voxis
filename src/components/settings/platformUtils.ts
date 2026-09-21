/**
 * Shared platform-detection helpers used across settings components.
 * Reads navigator.platform, which is always available in Tauri's webview.
 */
export function isMac(): boolean {
  if (typeof navigator === "undefined" || !navigator.platform) return false;
  return navigator.platform.toLowerCase().includes("mac");
}
