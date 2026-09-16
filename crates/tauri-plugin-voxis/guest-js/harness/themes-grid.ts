// crates/tauri-plugin-voxis/guest-js/harness/themes-grid.ts
/**
 * Drives `harness/themes-grid.html` — mounts all 18 builtin themes at
 * once, each forced into the `"expanded"` lifecycle (`idleTheme: true`,
 * `applyState("recording")`) and fed a shared fake sine-wave level, so
 * every theme renders at its own manifest `overlay_width`/
 * `overlay_height` instead of the pre-A6 fixed 64x64 pill. Two more
 * instances alongside show the `"compact"` idle/error handle. No
 * `@tauri-apps/api`/Tauri runtime involved — same mock-client-free path
 * `applyState`/`applyLevel` already support for `driver: "host"`.
 */
import { mountOverlay } from "../src/overlay";
import { resolveThemeSize, ThemeRegistry } from "../src/themes/registry";

const gridEl = document.getElementById("grid") as HTMLDivElement;
const compactRowEl = document.getElementById("compact-row") as HTMLDivElement;

const themeIds = Object.keys(ThemeRegistry).sort();
const overlays: Array<ReturnType<typeof mountOverlay>> = [];

for (const id of themeIds) {
  const slot = document.createElement("div");
  slot.className = "slot";
  const label = document.createElement("span");
  label.className = "label";
  const size = resolveThemeSize(id);
  label.textContent = `${id} (${size.width}\u00d7${size.height})`;
  const anchor = document.createElement("div");
  anchor.className = "anchor";
  slot.appendChild(label);
  slot.appendChild(anchor);
  gridEl.appendChild(slot);

  const rect = anchor.getBoundingClientRect();
  const x = rect.left + rect.width / 2 - size.width / 2;
  const y = rect.top + rect.height / 2 - size.height / 2;

  const el = mountOverlay(anchor, {
    theme: id,
    driver: "host",
    draggable: false,
    idleTheme: true,
    initialPosition: { x, y },
  });
  el.applyState("recording");
  overlays.push(el);
}

for (const [label, state] of [
  ["idle", "idle"],
  ["error", "error"],
] as const) {
  const slot = document.createElement("div");
  slot.className = "slot";
  const labelEl = document.createElement("span");
  labelEl.className = "label";
  labelEl.textContent = `compact (${label})`;
  const anchor = document.createElement("div");
  anchor.className = "anchor";
  slot.appendChild(labelEl);
  slot.appendChild(anchor);
  compactRowEl.appendChild(slot);

  const rect = anchor.getBoundingClientRect();
  const x = rect.left + rect.width / 2 - 28;
  const y = rect.top + rect.height / 2 - 28;

  const el = mountOverlay(anchor, {
    theme: "default",
    driver: "host",
    draggable: false,
    initialPosition: { x, y },
  });
  el.applyState(state);
}

// Shared fake sine-wave level sweep, same shape as index.html's
// "toggle fake level sweep" button, applied to every expanded theme at
// once so their level-reactive visuals (bars/blobs/spectrum) aren't flat.
let t = 0;
setInterval(() => {
  t += 0.1;
  const level = (Math.sin(t) + 1) / 2;
  for (const el of overlays) {
    el.applyLevel({ rms: level, peak: Math.min(1, level + 0.1), muted: false });
  }
}, 100);
