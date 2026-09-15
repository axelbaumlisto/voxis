// host-min's frontend: mounts `<voxis-overlay theme="default">` (guest-js,
// Task 5) via the pre-bundled `vendor/voxis-overlay.bundle.js`
// (`scripts/bundle-overlay.sh` -- see README.md for why this needs a
// build step instead of loading `guest-js/dist/index.js` straight,
// which has extensionless relative imports native ESM can't resolve),
// a plain Toggle button, and `<pre id="result">`.
//
// Consent: `set_consent(true)` unconditionally at startup -- a real host
// MUST show its own consent UI before this (see README.md); host-min is
// a tracer-bullet harness, not a template for that flow.
import { createClient, mountOverlay } from "./vendor/voxis-overlay.bundle.js";

const client = createClient();
const resultEl = document.getElementById("result");
const toggleButton = document.getElementById("toggle");

mountOverlay(document.body, { theme: "default", mode: "toggle", client });

client.onResult((result) => {
  resultEl.textContent = JSON.stringify(result, null, 2);
});

client.onState((state) => {
  toggleButton.textContent = state === "recording" ? "Stop" : "Toggle recording";
});

let sessionId = null;

toggleButton.addEventListener("click", async () => {
  try {
    if (sessionId === null) {
      sessionId = await client.start("toggle");
      resultEl.textContent = `recording: ${sessionId}`;
    } else {
      const id = sessionId;
      sessionId = null;
      const dictationResult = await client.stop(id);
      resultEl.textContent = JSON.stringify(dictationResult, null, 2);
    }
  } catch (e) {
    sessionId = null;
    resultEl.textContent = `error: ${JSON.stringify(e)}`;
  }
});

client.setConsent(true).catch((e) => {
  resultEl.textContent = `setConsent error: ${JSON.stringify(e)}`;
});

// HUMAN GATE prep: hold `alt_r` to record. Harmless to call
// unconditionally regardless of `VOXIS_CAPTURE` -- `set_hotkey` is a
// no-op when the plugin has no OS-level hotkey backend wired up
// (`PluginState.hotkey` is `None` for both `init()`/`init_with_capture()`,
// i.e. every non-`cpal` `VOXIS_CAPTURE` mode this example otherwise
// supports), so this only does real work when the host was actually
// started with `VOXIS_CAPTURE=cpal` (`init_desktop()`, real
// `RdevHotkey`). A real desktop backend can fail with `permissionDenied`
// (macOS Accessibility/Input Monitoring not yet granted) -- surfaced
// here as a visible page hint instead of a silently-swallowed
// rejection, same "a real host must show this" spirit as the consent
// note above.
const hotkeyHintEl = document.createElement("p");
hotkeyHintEl.id = "hotkey-hint";
document.body.appendChild(hotkeyHintEl);
client.setHotkey({ key: "alt_r", mode: "hold" }).catch((e) => {
  if (e && e.kind === "permissionDenied") {
    hotkeyHintEl.textContent =
      "Hotkey (hold alt_r) needs Accessibility/Input Monitoring permission -- grant it in System Settings, then restart host-min.";
  } else {
    hotkeyHintEl.textContent = `setHotkey error: ${JSON.stringify(e)}`;
  }
});
