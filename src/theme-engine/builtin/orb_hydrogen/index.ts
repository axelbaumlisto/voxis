// orb_hydrogen — hydrogen orbital |psi|^2 on a rotating dome, rainbow chroma bands.
//
// PORTED FROM ORBKIT (https://github.com/zzzzshawn/orbkit), orb `shdr-11`
// ("Hydrogen"). Orbkit's own orb: MIT, like its runtime — no third-party terms.
// The fragment shader below is orbkit's, kept verbatim except for the uniform
// names and the helper prelude (its `orbUV()`/`noise`/`fbm` live here inline,
// because a theme bundle must have ZERO runtime imports — see the manifest
// note in docs/THEMES.md).
//
// Porting contract: orbkit orbs are written for `idle | thinking | speaking`
// with a `uInput` (user speech energy) → Voxis's `ThemeState` maps 1:1:
//   idle                                  → idle       preset
//   recording                             → speaking   preset, uInput ← audioLevel
//   transcribing                          → thinking   preset
//   error                                 → idle       preset
// Rate params arrive as pre-integrated clocks (`integrate: true` in orbkit),
// which is what `uP_speed`/`uP_flowSpeed` are here: changing speed changes the
// rate, never the phase.
//
// Self-contained: `import type` only (0 runtime imports in the bundled theme.js).
import type { ThemeApi, ThemeInstance, ThemeState } from "../../contract";

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;

uniform vec2  uRes;
uniform float uInput;   // 0..1 — the user's voice (audioLevel)
uniform float uOutput;  // 0..1 — the orb's own excitement, tracks uInput
uniform float uP_speed;       // integrated clock (orbkit 'speed', integrate: true)
uniform float uP_rotSpeed;
uniform float uP_radius;
uniform float uP_swell;
uniform float uP_posScale;
uniform float uP_flowSpeed;   // integrated clock (orbkit 'flowSpeed', integrate: true)
uniform float uP_flowAmp;
uniform float uP_flowScale;
uniform float uP_precess;
uniform float uP_radialPow;
uniform float uP_radialDecay;
uniform float uP_probPow;
uniform float uP_probGain;
uniform float uP_waveFreq;
uniform float uP_chromaSpread;
uniform float uP_glow;
uniform float uP_metalDark;
uniform float uP_baseVis;

// ---- orbkit's ORB_GLSL_HELPERS, inlined (see the header) -------------------
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
// ---------------------------------------------------------------------------

const float PI = 3.14159265359;

void main() {
  vec2 uv = orbUV();
  float r2d = length(uv);
  float R = uP_radius + uP_swell * uInput;
  float mask = smoothstep(0.012, -0.012, r2d - R);
  float nr = clamp(r2d / max(R, 0.001), 0.0, 1.0);
  float z = sqrt(max(1.0 - nr * nr, 0.0));

  float posScale = uP_posScale * (0.8 + 0.45 * uOutput + 0.2 * uInput);
  float radialPow = uP_radialPow * (0.7 + 0.8 * uOutput);
  float radialDecay = uP_radialDecay * (1.25 - 0.5 * uOutput);
  float probPow = uP_probPow * (1.3 - 0.55 * uOutput);
  float probGain = uP_probGain * (0.7 + 0.6 * uOutput + 0.5 * uInput);
  float waveFreq = uP_waveFreq * (0.6 + 1.0 * uOutput);
  float chromaSpread = uP_chromaSpread * (0.6 + 0.9 * uOutput + 0.5 * uInput);

  // dome point rotated around Y — the fake 3D of the flat disc
  float animTime = uP_speed;
  float cosT = cos(animTime * uP_rotSpeed);
  float sinT = sin(animTime * uP_rotSpeed);
  vec3 sp = vec3(uv / max(R, 0.001), z) * posScale;
  vec3 pos = vec3(sp.x * cosT - sp.z * sinT, sp.y, sp.x * sinT + sp.z * cosT);

  // precession: the rotation axis itself drifts, so the pattern never
  // settles into a repeating spin
  float tilt = sin(animTime * 0.21 + 1.7) * uP_precess;
  float cx = cos(tilt), sx = sin(tilt);
  pos = vec3(pos.x, pos.y * cx - pos.z * sx, pos.y * sx + pos.z * cx);

  // liquid flow: drifting fbm warps the 3D domain, so the wave function
  // smears and migrates around the sphere instead of wobbling in place
  float flowT = uP_flowSpeed;
  float fAmp = uP_flowAmp * (0.7 + 0.6 * uOutput + 0.4 * uInput);
  vec3 w;
  w.x = fbm(pos.yz * uP_flowScale + vec2(flowT * 0.70, -flowT * 0.40));
  w.y = fbm(pos.zx * uP_flowScale + vec2(-flowT * 0.55, flowT * 0.62) + 3.7);
  w.z = fbm(pos.xy * uP_flowScale + vec2(flowT * 0.50, flowT * 0.85) + 7.1);
  pos += (w - 0.5) * fAmp;

  float r = length(pos) + 0.001;
  float theta = acos(clamp(pos.y / r, -1.0, 1.0));
  float phi = atan(pos.z, pos.x);

  float a0 = 0.5;
  float rho = 2.0 * r / (5.0 * a0);
  float radial = pow(rho, radialPow) * exp(-rho / radialDecay);
  float angular = pow(sin(theta), 3.0) * cos(phi + animTime * 0.2); // single lobe

  float psi = radial * angular;
  float probability = psi * psi;

  // travelling spiral wave; the azimuthal harmonic count must be a whole
  // number or sin(phi * f) leaves a vertical meridian seam
  float waveN = max(1.0, floor(waveFreq + 0.5));
  float wavePhase = phi * waveN + theta * 2.5 - animTime * 2.0;
  probability *= (0.85 + 0.15 * sin(wavePhase));

  float patches = fbm(pos.xy * 1.6 + vec2(flowT * 0.4, -flowT * 0.3));
  probability *= 0.65 + 0.7 * patches;

  probability = pow(probability, probPow) * probGain;
  probability = clamp(probability, 0.0, 1.0);

  float fresnel = pow(1.0 - z, 1.5);

  // rainbow chromatic aberration
  float chromaOffset = phi * 2.0 + theta * 1.5 + animTime * 0.3 + probability * 3.0;
  vec3 rainbow;
  rainbow.r = sin(chromaOffset) * 0.5 + 0.5;
  rainbow.g = sin(chromaOffset + chromaSpread) * 0.5 + 0.5;
  rainbow.b = sin(chromaOffset + chromaSpread * 2.0) * 0.5 + 0.5;
  rainbow = normalize(rainbow + 0.01) * length(rainbow);

  float bandFreq = chromaOffset * 3.0 + fresnel * 2.4;
  vec3 chromaticBands;
  chromaticBands.r = sin(bandFreq) * 0.5 + 0.5;
  chromaticBands.g = sin(bandFreq + 2.094) * 0.5 + 0.5;
  chromaticBands.b = sin(bandFreq + 4.189) * 0.5 + 0.5;

  vec3 glowColor = mix(rainbow, chromaticBands, 0.12);
  glowColor = pow(glowColor, vec3(0.8));

  vec3 darkMetal = vec3(uP_metalDark);
  vec3 lightMetal = mix(vec3(0.9, 0.92, 0.95), glowColor, 0.7);

  float metalGradient = smoothstep(0.0, 1.0, probability * 0.7 + fresnel * 0.3);
  vec3 metalColor = mix(darkMetal, lightMetal, metalGradient);

  float orbGlow = uP_glow + 0.6 * uOutput;
  float totalGlow = (0.25 + fresnel * 0.6 + probability * 0.8) * orbGlow;
  float glowAmount = clamp(pow(totalGlow, 0.7), 0.0, 1.0);

  vec3 surfaceColor = mix(metalColor, glowColor, glowAmount);

  vec3 normal = vec3(uv / max(R, 0.001), z);
  float specular = pow(max(dot(normal, normalize(vec3(1.0, 1.0, 2.0))), 0.0), 32.0);
  surfaceColor += mix(vec3(1.0), glowColor, 0.6) * specular * 0.4;

  float visibility = clamp(probability * 1.2 + fresnel * 0.3 + uP_baseVis + uInput * 0.15, 0.0, 1.0);

  float a = mask * visibility;
  gl_FragColor = vec4(surfaceColor * a, a);
}
`;

/** Numeric knobs, orbkit's `params` (idle defaults are the schema defaults). */
type Params = Record<string, number>;

const PARAM_KEYS = [
  "speed",
  "rotSpeed",
  "radius",
  "swell",
  "posScale",
  "flowSpeed",
  "flowAmp",
  "flowScale",
  "precess",
  "radialPow",
  "radialDecay",
  "probPow",
  "probGain",
  "waveFreq",
  "chromaSpread",
  "glow",
  "metalDark",
  "baseVis",
] as const;

/** orbkit `statePresets.idle` — also the manifest defaults. */
const IDLE: Params = {
  speed: 0.9, rotSpeed: 0.5, radius: 0.9, swell: 0.07, posScale: 0.5,
  flowSpeed: 0.35, flowAmp: 0.45, flowScale: 0.3, precess: 0.3,
  radialPow: 0.5, radialDecay: 1, probPow: 0.4, probGain: 3, waveFreq: 4,
  chromaSpread: 0.18, glow: 0.9, metalDark: 0, baseVis: 0.12,
};

/** orbkit `statePresets.speaking` — the "the user is talking" look. */
const RECORDING: Params = {
  speed: 2.45, rotSpeed: 0.5, radius: 0.9, swell: 0.07, posScale: 1,
  flowSpeed: 2.75, flowAmp: 0.8, flowScale: 2.2, precess: 1.3,
  radialPow: 0.5, radialDecay: 1, probPow: 0.31, probGain: 4.3, waveFreq: 4,
  chromaSpread: 0.12, glow: 0.9, metalDark: 0, baseVis: 0.12,
};

/** orbkit `statePresets.thinking` — restless but not loud (transcribing). */
const THINKING: Params = {
  speed: 0.9, rotSpeed: 0.5, radius: 0.9, swell: 0.07, posScale: 0.65,
  flowSpeed: 0.35, flowAmp: 1.1, flowScale: 0.3, precess: 0,
  radialPow: 0.5, radialDecay: 1.9, probPow: 0.4, probGain: 3, waveFreq: 4,
  chromaSpread: 0.41, glow: 0.9, metalDark: 0, baseVis: 0.12,
};

function presetFor(mode: ThemeState["mode"]): Params {
  // orbkit's three states map onto ours; `error` keeps the calm idle look —
  // a theme must never look like it is shouting at the user.
  if (mode === "recording") return RECORDING;
  if (mode === "transcribing") return THINKING;
  return IDLE;
}

function readParams(raw: unknown): Params {
  const out: Params = { ...IDLE };
  if (raw && typeof raw === "object") {
    for (const key of PARAM_KEYS) {
      const v = (raw as Record<string, unknown>)[key];
      if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
    }
  }
  return out;
}

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  const W = api.size.width;
  const H = api.size.height;
  // Same 2x supersample rule as the builtin shader themes (see lavalamp):
  // exact 2:1 downscaling is an exact box filter, so the orb's silhouette gets
  // real AA — at 3:1 bilinear skips source pixels and the staircase survives.
  const renderScale = 2;

  const canvas = document.createElement("canvas");
  canvas.width = W * renderScale;
  canvas.height = H * renderScale;
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  container.appendChild(canvas);

  function bail(reason: string): ThemeInstance {
    console.warn("orb_hydrogen: WebGL unavailable, skipping", reason);
    canvas.remove();
    return { unmount() {} };
  }

  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false });
  if (!gl) return bail("no webgl context");

  function shader(type: number, src: string): WebGLShader | null {
    const s = gl!.createShader(type);
    if (!s) return null;
    gl!.shaderSource(s, src);
    gl!.compileShader(s);
    if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) {
      console.warn("orb_hydrogen: shader compile failed", gl!.getShaderInfoLog(s));
      gl!.deleteShader(s);
      return null;
    }
    return s;
  }

  const vs = shader(gl.VERTEX_SHADER, VERT);
  const fs = shader(gl.FRAGMENT_SHADER, FRAG);
  const prog = gl.createProgram();
  if (!vs || !fs || !prog) return bail("shader/program");
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    return bail(`link: ${gl.getProgramInfoLog(prog)}`);
  }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const u = (name: string) => gl.getUniformLocation(prog, name);
  const uRes = u("uRes");
  const uInput = u("uInput");
  const uOutput = u("uOutput");
  const uLoc: Record<string, WebGLUniformLocation | null> = {};
  for (const key of PARAM_KEYS) uLoc[key] = u(`uP_${key}`);

  gl.uniform2f(uRes, canvas.width, canvas.height);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  const configured = readParams(api.params);
  const current: Params = { ...configured };
  let target: Params = presetFor("idle");
  let level = 0;
  let smoothLevel = 0;
  // orbkit's `integrate: true` params: the shader reads a CLOCK, so speed
  // changes the rate instead of jumping the phase.
  let phaseAnim = 0;
  let phaseFlow = 0;
  let raf = 0;

  const off = api.onState((state) => {
    target = presetFor(state.mode);
    level = Number.isFinite(state.audioLevel) ? Math.min(1, Math.max(0, state.audioLevel)) : 0;
  });

  let last = performance.now();
  const ease = (dt: number) => 1 - Math.exp(-dt / 0.28); // ~280 ms, like the engine's glide

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;

    const k = ease(dt);
    for (const key of PARAM_KEYS) {
      // Explicit manifest params always win over the state preset (orbkit's
      // rule: "params passed explicitly always win over the preset").
      const t = api.params && typeof api.params === "object" && key in (api.params as object)
        ? configured[key]
        : target[key];
      current[key] += (t - current[key]) * k;
    }
    smoothLevel += (level - smoothLevel) * (1 - Math.exp(-dt / 0.08));

    phaseAnim += dt * current.speed;
    phaseFlow += dt * current.flowSpeed;

    for (const key of PARAM_KEYS) gl.uniform1f(uLoc[key], current[key]);
    // The shader's two clocks replace the two integrated params.
    gl.uniform1f(uLoc.speed, phaseAnim);
    gl.uniform1f(uLoc.flowSpeed, phaseFlow);
    // `uInput` is the user's voice. `uOutput` is orbkit's "agent speech"; there
    // is no agent here, so the orb's own excitement simply tracks the same
    // level at a lower weight — that is what makes the surface respond to you.
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
