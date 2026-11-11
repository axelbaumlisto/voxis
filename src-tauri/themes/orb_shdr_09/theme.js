// src/theme-engine/builtin/_shared/orb-kit.ts
var ORB_PRELUDE = `
precision highp float;
uniform vec2  uRes;
uniform float uInput;   // 0..1 — the user's voice (audioLevel)
uniform float uOutput;  // 0..1 — the orb's own excitement, tracks uInput
uniform float uTime;    // slow ambient clock (half real time), orbkit's rule
uniform float uAnim;    // flow clock — its speed follows the voice level

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
var VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;
function hexToRgb(hex) {
  let h = hex.replace("#", "").trim();
  if (h.length === 3)
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  if (h.length !== 6 || Number.isNaN(n))
    return [1, 1, 1];
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}
function presetFor(variant, mode) {
  return variant.presets?.[mode] ?? variant.defaults;
}
function readOverrides(raw, defaults) {
  const out = { ...defaults };
  if (raw && typeof raw === "object") {
    for (const key of Object.keys(defaults)) {
      const v = raw[key];
      if (typeof v === "number" && Number.isFinite(v))
        out[key] = v;
    }
  }
  return out;
}
function mountOrb(container, api, variant) {
  const renderScale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = api.size.width * renderScale;
  canvas.height = api.size.height * renderScale;
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  container.appendChild(canvas);
  const bail = (reason) => {
    console.warn(`${variant.id}: WebGL unavailable (${reason}), skipping`);
    canvas.remove();
    return { unmount() {
    } };
  };
  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false });
  if (!gl)
    return bail("no context");
  const compile = (type, src) => {
    const s = gl.createShader(type);
    if (!s)
      return null;
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
    ...colorKeys.map((k) => `uniform vec3 uC_${k};`)
  ].join(`
`);
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, `${ORB_PRELUDE}
${decls}
${variant.frag}`);
  const prog = gl.createProgram();
  if (!vs || !fs || !prog)
    return bail("program");
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
    return bail(`link: ${gl.getProgramInfoLog(prog)}`);
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const uRes = gl.getUniformLocation(prog, "uRes");
  const uTime = gl.getUniformLocation(prog, "uTime");
  const uAnim = gl.getUniformLocation(prog, "uAnim");
  const uInput = gl.getUniformLocation(prog, "uInput");
  const uOutput = gl.getUniformLocation(prog, "uOutput");
  const loc = {};
  for (const k of keys)
    loc[k] = gl.getUniformLocation(prog, `uP_${k}`);
  const colorLoc = {};
  for (const k of colorKeys)
    colorLoc[k] = gl.getUniformLocation(prog, `uC_${k}`);
  gl.uniform2f(uRes, canvas.width, canvas.height);
  const liveColors = api.params?.colors;
  for (const k of colorKeys) {
    const hex = typeof liveColors?.[k] === "string" ? liveColors[k] : variant.colors[k];
    const [r, g, b] = hexToRgb(hex);
    gl.uniform3f(colorLoc[k], r, g, b);
  }
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);
  const overrides = readOverrides(api.params, variant.defaults);
  const hasOverride = {};
  for (const k of keys) {
    hasOverride[k] = !!(api.params && typeof api.params === "object" && (k in api.params));
  }
  const current = { ...variant.defaults };
  const clocks = {};
  for (const k of variant.clocks ?? [])
    clocks[k] = 0;
  let target = presetFor(variant, "idle");
  let level = 0;
  let smoothLevel = 0;
  let elapsed = 0;
  let anim = 0;
  let raf = 0;
  const off = api.onState((state) => {
    target = presetFor(variant, state.mode);
    level = Number.isFinite(state.audioLevel) ? Math.min(1, Math.max(0, state.audioLevel)) : 0;
  });
  let last = performance.now();
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    const k = 1 - Math.exp(-dt / 0.28);
    for (const key of keys) {
      const t = hasOverride[key] ? overrides[key] : target[key] ?? variant.defaults[key];
      current[key] += (t - current[key]) * k;
    }
    smoothLevel += (level - smoothLevel) * (1 - Math.exp(-dt / 0.08));
    elapsed += dt;
    anim += dt * (0.4 + 2.2 * smoothLevel);
    for (const key of keys) {
      if (key in clocks) {
        clocks[key] += dt * current[key];
        gl.uniform1f(loc[key], clocks[key]);
      } else {
        gl.uniform1f(loc[key], current[key]);
      }
    }
    gl.uniform1f(uTime, elapsed * 0.5);
    gl.uniform1f(uAnim, anim);
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
    }
  };
}

// src/theme-engine/builtin/orb_shdr_09/index.ts
var FRAG = `
#define RINGS 10
#define TURB 9
#define AA 2

// Volume-reactive values, resolved once per fragment in main().
float irisWarp;
float irisGlow;
float irisFringe;

vec3 irisRender(vec2 fragCoord) {
  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  float R = max(uP_radius, 0.001);

  // the dome: the front hemisphere of a unit ball, in screen space
  vec2 pl = uv / R;
  float z = sqrt(max(1.0 - dot(pl, pl), 0.0));
  vec3 n = vec3(pl, z);

  float t = uP_speed; // integrated clock

  // tilt about X, then roll about Y on its own integrated clock
  float ct = cos(uP_tilt);
  float st = sin(uP_tilt);
  vec3 sp = vec3(n.x, n.y * ct - n.z * st, n.y * st + n.z * ct);
  float cr = cos(uP_spin);
  float sr = sin(uP_spin);
  sp = vec3(sp.x * cr - sp.z * sr, sp.y, sp.x * sr + sp.z * cr);

  /*
    Radius becomes the polar angle from the dome's axis (see the header),
    so ring i lands on the latitude at angle i / uP_scale and the rings
    crowd toward the limb the way a globe's latitudes do. acos is defined
    on the whole sphere, so the roll above can put the axis anywhere —
    including behind the visible face, which sweeps the outer rings into
    view over the limb.
  */
  float pol = acos(clamp(sp.z, -1.0, 1.0));
  vec2 dir = sp.xy / max(length(sp.xy), 1e-4);
  vec2 p = dir * pol * uP_scale;

  vec3 acc = vec3(0.0);

  for (int ri = 0; ri < RINGS; ri++) {
    float i = float(ri) + 1.0;

    /*
      Each ring re-warps the ORIGINAL point with its own seed, exactly as
      the listing does — this loop is why the rings tear differently
      instead of nesting like tree rings.
    */
    vec2 v = p;
    for (int j = 0; j < TURB; j++) {
      float f = float(j) + 1.0;
      v += irisWarp * sin(ceil(v * f + i * uP_seed) - t * 0.5) / f;
    }

    float l = length(v) - i;

    // the asymmetric absolute value, with the floor doubling as the line
    // width — a wider floor is a fatter, softer wavefront
    float side = max(max(l, -uP_inner * l), uP_lineSoft);

    /*
      The hue sweep, softened. l/(l*l+g) tracks 1/l off the ring and rolls
      over to a finite peak on it, so the rainbow compresses into a fringe
      of finite width instead of an aliased band.
    */
    float fr = irisFringe * l / (l * l + uP_fringeSoft);
    vec3 hue = cos(t - i * uP_ringPhase + fr + vec3(0.0, 1.0, 2.0)) + 1.1;

    acc += (irisGlow / side) * hue;
  }

  // the listing's tanh knee, with the divisor exposed
  vec3 col = tanh3(acc / max(uP_exposure, 0.001));
  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));

  // saturation about luminance, then the tint
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);
  col *= uC_tint;

  // dome shading keeps the ball a ball under the rings — gentler than the
  // sibling orbs use, because these rings are emission and a hard lambert
  // reads as a shadow thrown across a light source
  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.72))), 0.0, 1.0);
  col *= 0.55 + uP_light * lambert;

  float fres = 1.0 - z;
  fres = fres * fres * fres;
  col += uC_sheen * uP_rim * fres;

  return col;
}

void main() {
  // Volume coupling: the user's voice tears the rings harder, the agent's
  // brightens them and opens the rainbow fringe.
  irisWarp = uP_warp * (1.0 + 0.5 * uInput);
  irisGlow = uP_glow * (0.85 + 0.5 * uOutput);
  irisFringe = uP_fringe * (1.0 + 0.6 * uOutput);

  vec2 uv = orbUV();
  float mask = smoothstep(0.012, -0.012, length(uv) - max(uP_radius, 0.001));

  // Ninety sines per sample before supersampling — none of them worth
  // paying for outside the silhouette.
  if (mask <= 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec3 col = vec3(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 off = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;
      col += irisRender(gl_FragCoord.xy + off);
    }
  }
  col /= float(AA * AA);
#else
  col = irisRender(gl_FragCoord.xy);
#endif

  // Surface orb bounded by a mask: alpha IS coverage, so premultiply — the
  // opposite convention from the emissive orbs (see shdr-31).
  float a = mask;
  gl_FragColor = vec4(max(col, vec3(0.0)) * a, a);
}
`;
var DEFAULTS = { speed: 0.6, spin: 0.12, tilt: 0.4, radius: 0.9, scale: 3.5, warp: 0.45, seed: 0.9, glow: 0.05, lineSoft: 0.05, inner: 3, fringe: 0.1, fringeSoft: 0.003, ringPhase: 0.8, exposure: 1.1, contrast: 1.1, saturation: 1.2, light: 0.5, rim: 0.4 };
var VARIANTS = {
  id: "orb_shdr_09",
  frag: FRAG,
  defaults: DEFAULTS,
  clocks: ["speed", "spin"],
  colors: { tint: "#ffffff", sheen: "#b9d6ff" },
  presets: {
    idle: {
      speed: 0.6,
      spin: 0.12,
      warp: 0.45,
      glow: 0.05,
      lineSoft: 0.05,
      fringe: 0.1,
      exposure: 1.1,
      contrast: 1.15
    },
    recording: {
      speed: 4.7,
      spin: 0.34,
      warp: 0.22,
      seed: 1.02,
      glow: 0.04,
      lineSoft: 0.22,
      fringe: 0.81,
      fringeSoft: 0.058,
      ringPhase: 1.03,
      exposure: 0.68,
      contrast: 0.85,
      light: 0.99,
      rim: 0.015
    },
    transcribing: {
      warp: 2.54,
      glow: 0.2,
      lineSoft: 0.152,
      fringe: 0.96,
      fringeSoft: 0.854,
      ringPhase: 2.53,
      exposure: 1.75,
      contrast: 1.15,
      saturation: 2.22,
      light: 1.035,
      rim: 0.66
    }
  }
};
function mount(container, api) {
  return mountOrb(container, api, VARIANTS);
}
export {
  mount
};
