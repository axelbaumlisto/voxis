// crates/tauri-plugin-voxis/guest-js/src/index.ts
/**
 * `@voxis/tauri-plugin-voxis` public API surface. The actual `invoke`/
 * `listen` wrappers live in `client.ts` (kept separate so `overlay.ts`
 * can depend on `createClient` without an `index.ts` <-> `overlay.ts`
 * import cycle, since this file also re-exports `mountOverlay`).
 */
export * from "./types/contract";
export * from "./client";
export { mountOverlay, VoxisOverlayElement, TAG_NAME as OVERLAY_TAG_NAME } from "./overlay";
export type { MountOverlayOptions } from "./overlay";
export { DEFAULT_THEME_ID, resolveTheme, ThemeRegistry } from "./themes/registry";
export { bindHotkey, HotkeyMachine, matchesHotkeySpec } from "./hotkey";
export type { BoundHotkey, HotkeyMachineOptions } from "./hotkey";
export { clampToViewport, snapToNearestEdge, readEffectiveViewport, readSafeAreaInsets } from "./drag";
export type { DragController, Point, SafeArea, Size, Viewport } from "./drag";
export { startHoldLease } from "./lease";
export type { Lease, LeaseOptions } from "./lease";
