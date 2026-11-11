// _shared/orb-kit.ts — the ORBKIT ADAPTER: one WebGL runtime for every ported orb.
//
// Orbkit (https://github.com/zzzzshawn/orbkit) ships each orb as a fragment
// shader + a parameter schema + per-state presets. Voxis ships themes as
// `mount(container, api)` with `api.onState({ mode, audioLevel })`. This file
// is the only place the two meet: each orb theme is then just its shader and
// its numbers (see orb_hydrogen/index.ts).
//
// What the adapter does, and WHY each part matters:
//   - 2x supersample (same rule as the other shader themes): at exactly 2:1 the
//     compositor's bilinear downscale is an exact box filter, so silhouettes get
//     real AA; 3:1 skips source pixels and the staircase survives.
//   - `integrate`-style rate params become CLOCKS: the shader reads an
//     accumulated phase, so changing "speed" changes the rate instead of
//     jumping the pattern (orbkit's own rule, kept).
//   - Presets GLIDE (~280 ms) instead of cutting, so a mode change is a
//     cross-fade — orbkit's behaviour, and what makes a dictation pill feel
//     alive rather than switched.
//   - `uInput` is the user's voice (audioLevel). Orbkit's `uOutput` means
//     "the agent is speaking"; there is no agent here, so it tracks the same
//     level at a lower weight — the orb reacts to YOU.
//   - Everything is disposable: rAF, uniforms, program, shaders, canvas.
//     A theme must never leave a GL context or an element behind.
//   - No WebGL (or a shader that fails to compile) is a WARN and a no-op
//     instance, never a throw: an embeddable theme must not crash the host.
import type { ThemeApi, ThemeInstance, ThemeMode, ThemeState } from "../../contract";

/** The prelude every orb shader may assume (orbkit's `ORB_GLSL_HELPERS`). */
export const ORB_PRELUDE = `
precision highp float;
uniform vec2  uRes;
uniform float uInput;   // 0..1 — the user's voice (audioLevel)
uniform float uOutput;  // 0..1 — the orb's own excitement, tracks uInput

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(11.7, 7.3);
    a *= 0.5;
  }
  return v;
}
vec2 orbUV() { return (2.0 * gl_FragCoord.xy - uRes) / min(uRes.x, uRes.y); }

// GLSL ES 1.0 has no tanh() (ES 3.0 only); shader-golf listings lean on it as
// a tone-mapper. Clamped against exp() overflow for the non-negative
// accumulators those shaders produce.
vec3 tanh3(vec3 x) {
  x = clamp(x, -10.0, 10.0);
  vec3 e = exp(2.0 * x);
  return (e - 1.0) / (e + 1.0);
}
`;

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export interface OrbVariant {
  /** Theme id — used in warnings so a host log names the orb that bailed. */
  id: string;
  /** Fragment shader body. May use `ORB_PRELUDE`; declares its own constants. */
  frag: string;
  /** Every tunable uniform (`uP_<key>`), with its resting value. */
  defaults: Readonly<Record<string, number>>;
  /** Per-mode targets; a mode missing here keeps `defaults`. */
  presets?: Partial<Record<ThemeMode, Readonly<Record<string, number>>>>;
  /** Keys of `defaults` that are RATES: uploaded as accumulated clocks. */
  clocks?: readonly string[];
  /**
   * Colour uniforms (`uC_<key>`, vec3), orbkit's `colors` schema. A manifest
   * may override any of them through `params.colors = { key: "#rrggbb" }`.
   */
  colors?: Readonly<Record<string, string>>;
}

/** orbkit's hex → vec3, same clamping behaviour (junk → white). */
export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  if (h.length !== 6 || Number.isNaN(n)) return [1, 1, 1];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function presetFor(variant: OrbVariant, mode: ThemeMode): Readonly<Record<string, number>> {
  return variant.presets?.[mode] ?? variant.defaults;
}

/** Manifest overrides, numbers only — junk keys/values fall back to defaults. */
function readOverrides(raw: unknown, defaults: Readonly<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = { ...defaults };
  if (raw && typeof raw === "object") {
    for (const key of Object.keys(defaults)) {
      const v = (raw as Record<string, unknown>)[key];
      if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
    }
  }
  return out;
}

export function mountOrb(container: HTMLElement, api: ThemeApi, variant: OrbVariant): ThemeInstance {
  const renderScale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = api.size.width * renderScale;
  canvas.height = api.size.height * renderScale;
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  container.appendChild(canvas);

  const bail = (reason: string): ThemeInstance => {
    console.warn(`${variant.id}: WebGL unavailable (${reason}), skipping`);
    canvas.remove();
    return { unmount() {} };
  };

  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false });
  if (!gl) return bail("no context");

  const compile = (type: number, src: string): WebGLShader | null => {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn(`${variant.id}: shader compile failed`, gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  };

  const keys = Object.keys(variant.defaults);
  const colorKeys = Object.keys(variant.colors ?? {});
  const decls = [
    ...keys.map((k) => `uniform float uP_${k};`),
    ...colorKeys.map((k) => `uniform vec3 uC_${k};`),
  ].join("\n");
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, `${ORB_PRELUDE}\n${decls}\n${variant.frag}`);
  const prog = gl.createProgram();
  if (!vs || !fs || !prog) return bail("program");
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return bail(`link: ${gl.getProgramInfoLog(prog)}`);
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(prog, "uRes");
  const uInput = gl.getUniformLocation(prog, "uInput");
  const uOutput = gl.getUniformLocation(prog, "uOutput");
  const loc: Record<string, WebGLUniformLocation | null> = {};
  for (const k of keys) loc[k] = gl.getUniformLocation(prog, `uP_${k}`);
  const colorLoc: Record<string, WebGLUniformLocation | null> = {};
  for (const k of colorKeys) colorLoc[k] = gl.getUniformLocation(prog, `uC_${k}`);

  gl.uniform2f(uRes, canvas.width, canvas.height);
  const liveColors = (api.params as { colors?: Record<string, unknown> } | null)?.colors;
  for (const k of colorKeys) {
    const hex = typeof liveColors?.[k] === "string" ? (liveColors[k] as string) : variant.colors![k];
    const [r, g, b] = hexToRgb(hex);
    gl.uniform3f(colorLoc[k], r, g, b);
  }
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  const overrides = readOverrides(api.params, variant.defaults);
  const hasOverride: Record<string, boolean> = {};
  for (const k of keys) {
    hasOverride[k] = !!(api.params && typeof api.params === "object" && k in (api.params as object));
  }
  const current: Record<string, number> = { ...variant.defaults };
  const clocks: Record<string, number> = {};
  for (const k of variant.clocks ?? []) clocks[k] = 0;

  let target = presetFor(variant, "idle");
  let level = 0;
  let smoothLevel = 0;
  let raf = 0;

  const off = api.onState((state: ThemeState) => {
    target = presetFor(variant, state.mode);
    level = Number.isFinite(state.audioLevel) ? Math.min(1, Math.max(0, state.audioLevel)) : 0;
  });

  let last = performance.now();
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;

    const k = 1 - Math.exp(-dt / 0.28); // ~280 ms glide, orbkit's feel
    for (const key of keys) {
      const t = hasOverride[key] ? overrides[key] : (target[key] ?? variant.defaults[key]);
      current[key] += (t - current[key]) * k;
    }
    smoothLevel += (level - smoothLevel) * (1 - Math.exp(-dt / 0.08));

    for (const key of keys) {
      if (key in clocks) {
        clocks[key] += dt * current[key];
        gl.uniform1f(loc[key], clocks[key]);
      } else {
        gl.uniform1f(loc[key], current[key]);
      }
    }
    gl.uniform1f(uInput, smoothLevel);
    gl.uniform1f(uOutput, smoothLevel * 0.35);

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };
  raf = requestAnimationFrame(frame);

  return {
    unmount() {
      cancelAnimationFrame(raf);
      off();
      gl.useProgram(null);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      canvas.remove();
    },
  };
}
