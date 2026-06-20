// src/harness/HarnessApp.tsx
import { useEffect, useMemo, useState } from "react";
import ThemeHost from "../theme-engine/ThemeHost";
import * as defaultTheme from "../theme-engine/builtin/default";
import { BUILTIN_THEME_IDS, fetchBuiltinThemeModule } from "./builtinThemes";
import { SCENARIOS, getScenario, makeSpectrum } from "./scenarios";
import type { ThemeMode, ThemeState } from "../theme-engine/contract";

const MODES: ThemeMode[] = ["idle", "recording", "transcribing", "error"];

/** Read harness presets from the URL query so Playwright / deep-links can
 * drive the preview without UI clicks. All optional:
 *   ?theme=drifting_contour&mode=recording&level=0.7&w=160&h=160&scale=3
 */
interface UrlPresets {
  theme?: string;
  mode?: ThemeMode;
  level?: string;
  w?: string;
  h?: string;
  scale?: string;
  params?: string;
}
function readUrlPresets(): UrlPresets {
  if (typeof window === "undefined") return {};
  const q = new URLSearchParams(window.location.search);
  const get = (k: string) => q.get(k) ?? undefined;
  return {
    theme: get("theme"),
    mode: get("mode") as ThemeMode | undefined,
    level: get("level"),
    w: get("w"),
    h: get("h"),
    scale: get("scale"),
    params: get("params"),
  };
}

export default function HarnessApp() {
  const url = readUrlPresets();
  const [themeId, setThemeId] = useState(url.theme ?? "drifting_contour");
  const [mode, setMode] = useState<ThemeMode>(url.mode ?? "recording");
  const [level, setLevel] = useState(url.level ? Number(url.level) : 0.6);
  const [scale, setScale] = useState(url.scale ? Number(url.scale) : 4);
  // Canvas size — defaults to the pill 172×36; organic themes (cell/ring)
  // need a 160×160 square, settable via ?w=160&h=160.
  const [width] = useState(url.w ? Number(url.w) : 172);
  const [height] = useState(url.h ? Number(url.h) : 36);
  const [bg, setBg] = useState("#111");
  const [paramsText, setParamsText] = useState(url.params ?? "{}");
  const [running, setRunning] = useState<string | null>(null);
  const [animate, setAnimate] = useState(true);
  const [frame, setFrame] = useState(0);

  // rAF advances frame when animating or a scenario runs.
  useEffect(() => {
    if (!animate && !running) return;
    let id: number;
    const tick = () => {
      setFrame((f) => f + 1);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [animate, running]);

  const { parsedParams, paramsError } = useMemo(() => {
    try {
      const v =
        paramsText.trim() === "" || paramsText.trim() === "{}"
          ? undefined
          : JSON.parse(paramsText);
      return { parsedParams: v, paramsError: null as string | null };
    } catch (e) {
      return { parsedParams: undefined, paramsError: (e as Error).message };
    }
  }, [paramsText]);

  const state: ThemeState = useMemo(() => {
    if (running) {
      const sc = getScenario(running)!;
      return sc.at(frame % sc.frames);
    }
    return {
      mode,
      audioLevel: level,
      spectrumBins: makeSpectrum(level, frame),
    };
  }, [running, frame, mode, level]);

  function playScenario(id: string) {
    setRunning(id);
    setFrame(0);
  }

  function stopScenario() {
    setRunning(null);
  }

  return (
    <div style={{ fontFamily: "system-ui, sans-serif" }}>
      <h2 style={{ margin: "0 0 8px" }}>Theme Visual Harness</h2>

      {/* Status line */}
      <div style={{ marginBottom: 8, fontSize: 13, color: "#888" }}>
        active: <strong>{themeId}</strong>{" "}
        {running ? (
          <span>
            | scenario: {getScenario(running)!.label} | frame: {frame}
          </span>
        ) : (
          <span>| manual | frame: {frame}</span>
        )}
        {paramsError && <span style={{ color: "#f66" }}> | parse error: {paramsError}</span>}
      </div>

      {/* Theme picker */}
      <label
        style={{ display: "block", marginBottom: 4, fontSize: 13 }}
        htmlFor="theme-picker"
      >
        Theme
      </label>
      <select
        id="theme-picker"
        aria-label="Theme"
        value={themeId}
        onChange={(e) => setThemeId(e.target.value)}
        style={{ marginBottom: 8 }}
      >
        {BUILTIN_THEME_IDS.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>

      {/* Mode picker */}
      <label style={{ display: "block", marginBottom: 4, fontSize: 13 }} htmlFor="mode-picker">
        Mode
      </label>
      <select
        id="mode-picker"
        aria-label="Mode"
        value={mode}
        onChange={(e) => setMode(e.target.value as ThemeMode)}
        style={{ marginBottom: 8 }}
      >
        {MODES.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>

      {/* Audio level slider */}
      <label style={{ display: "block", marginBottom: 4, fontSize: 13 }} htmlFor="level-slider">
        Audio level
      </label>
      <input
        id="level-slider"
        type="range"
        aria-label="Audio level"
        min={0}
        max={1}
        step={0.01}
        value={level}
        onChange={(e) => setLevel(Number(e.target.value))}
        style={{ marginBottom: 4 }}
      />
      <span style={{ marginLeft: 8, fontSize: 13 }}>{level.toFixed(2)}</span>

      <label style={{ display: "block", margin: "8px 0 4px", fontSize: 13 }}>Animate <input type="checkbox" aria-label="Animate" checked={animate} onChange={e => setAnimate(e.target.checked)} /></label>

      {/* Scale */}
      <label style={{ display: "block", margin: "8px 0 4px", fontSize: 13 }} htmlFor="scale-slider">
        Scale
      </label>
      <input
        id="scale-slider"
        type="range"
        aria-label="Scale"
        min={1}
        max={6}
        step={1}
        value={scale}
        onChange={(e) => setScale(Number(e.target.value))}
        style={{ marginBottom: 4 }}
      />
      <span style={{ marginLeft: 8, fontSize: 13 }}>{scale}x</span>

      {/* Background swatch */}
      <div style={{ margin: "8px 0" }}>
        <span style={{ fontSize: 13, marginRight: 8 }}>Background:</span>
        {["#111", "#333"].map((c) => (
          <button
            key={c}
            onClick={() => setBg(c)}
            style={{
              width: 28,
              height: 28,
              background: c,
              border: bg === c ? "2px solid #fff" : "2px solid #555",
              marginRight: 4,
              cursor: "pointer",
            }}
          />
        ))}
      </div>

      {/* Theme preview */}
      <div
        style={{
          background: bg,
          padding: 16,
          margin: "12px 0",
          borderRadius: 6,
          display: "inline-block",
          overflow: "hidden",
        }}
      >
        <div style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}>
          <ThemeHost
            themeId={themeId}
            state={state}
            fetchModule={fetchBuiltinThemeModule}
            fallbackModule={defaultTheme}
            onCancel={() => {}}
            width={width}
            height={height}
            params={parsedParams}
          />
        </div>
      </div>

      {/* Scenario buttons */}
      <div style={{ marginBottom: 12 }}>
        {SCENARIOS.map((sc) => (
          <button
            key={sc.id}
            onClick={() => playScenario(sc.id)}
            style={{ marginRight: 6, marginBottom: 4 }}
          >
            {sc.label}
          </button>
        ))}
        <button onClick={stopScenario}>Stop</button>
      </div>

      {/* Params JSON editor */}
      <label
        style={{ display: "block", marginBottom: 4, fontSize: 13 }}
        htmlFor="params-json"
      >
        Params JSON
      </label>
      <textarea
        id="params-json"
        aria-label="Params JSON"
        rows={6}
        cols={50}
        value={paramsText}
        onChange={(e) => setParamsText(e.target.value)}
        style={{
          display: "block",
          background: "#222",
          color: "#ddd",
          border: "1px solid #444",
          fontFamily: "monospace",
          fontSize: 12,
          padding: 4,
        }}
      />
    </div>
  );
}