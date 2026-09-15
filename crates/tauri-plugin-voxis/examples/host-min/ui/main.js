// Plain invoke/listen against `window.__TAURI__` (`withGlobalTauri: true`
// in `tauri.conf.json`) \u2014 no bundler, no guest-js package reference (that
// wiring is Task 3.5/5's job). Talks to the plugin's raw `plugin:voxis|*`
// command names directly.
const { invoke } = window.__TAURI__.core;

const resultEl = document.getElementById("result");
let sessionId = null;

document.getElementById("start").addEventListener("click", async () => {
  try {
    sessionId = await invoke("plugin:voxis|start", { mode: "hold" });
    resultEl.textContent = `recording: ${sessionId}`;
  } catch (e) {
    resultEl.textContent = `start error: ${JSON.stringify(e)}`;
  }
});

document.getElementById("stop").addEventListener("click", async () => {
  if (!sessionId) {
    resultEl.textContent = "not recording";
    return;
  }
  try {
    const dictationResult = await invoke("plugin:voxis|stop", { id: sessionId });
    resultEl.textContent = JSON.stringify(dictationResult, null, 2);
  } catch (e) {
    resultEl.textContent = `stop error: ${JSON.stringify(e)}`;
  } finally {
    sessionId = null;
  }
});
