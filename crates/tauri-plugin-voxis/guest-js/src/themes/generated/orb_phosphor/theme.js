// src/theme-engine/builtin/_shared/orb-kit.ts
var ORB_PRELUDE = `
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
    }
  };
}

// src/theme-engine/builtin/orb_phosphor/index.ts
var FRAG = `
void main() {
  // Volume coupling: user input densifies the glyphs, agent output turns
  // the phosphor up — the matrix visibly burns brighter while it speaks.
  float densBias = uP_density + 0.2 * uInput;
  float gainNow = uP_gain * (0.85 + 0.5 * uOutput);

  // resolution-relative glyph grid — same character count at every size
  float cellPx = max(min(uRes.x, uRes.y) / max(uP_cells, 8.0), 4.0);
  vec2 cellIdx = floor(gl_FragCoord.xy / cellPx);
  vec2 cellCentre = (cellIdx + 0.5) * cellPx;
  vec2 g = fract(gl_FragCoord.xy / cellPx); // 0..1 inside the cell

  vec2 suv = (2.0 * cellCentre - uRes) / min(uRes.x, uRes.y);
  vec2 uv = suv / uP_radius;
  float r2 = dot(uv, uv);

  // blocky silhouette, cut on the cell grid like the rest of the matrix
  float mask = 1.0 - step(1.0, r2);

  float z = sqrt(max(1.0 - r2, 0.0));
  vec3 n = vec3(uv, z);

  // rotating dome, stereographic projection — the weave compresses toward
  // the rim and rolls around the ball as the dome turns
  float rot = uP_spin; // integrated clock
  float cr = cos(rot);
  float sr = sin(rot);
  vec3 sp = vec3(n.x * cr - n.z * sr, n.y, n.x * sr + n.z * cr);
  vec2 p2 = sp.xy / (abs(sp.z) + 1.2) * uP_scale * 3.0;

  /*
    Three motions, one per state, each on its OWN integrated clock so a
    state change morphs the movement instead of jumping it:

      DRIFT   diagonal lava-flow streaming        (idle)
      SCROLL  vertical paging, terminal-style     (thinking)
      PULSE   radial waves radiating from centre  (speaking)

    The clocks are rates in the presets — a rate gliding to zero freezes
    that motion in place, phase intact. The pulse's amplitude is a separate
    non-integrated param, so idle carries no static rings.
  */
  float driftT = uP_drift;   // integrated clock: diagonal stream
  float scrollT = uP_scroll; // integrated clock: vertical paging
  float t = uP_speed;        // integrated clock: pulse phase
  vec2 flow = vec2(driftT * 0.6, -driftT * 0.45 - scrollT);

  float field = fbm(p2 + flow);
  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0, 1.0);
  float dens = clamp((field - 0.5) * 1.8 + densBias + 0.4 * uP_light * lambert
    + uP_pulse * 0.35 * sin(length(uv) * 5.5 - t * 2.4), 0.0, 1.0);

  /*
    The glyph: four dash rows split by three stripe gaps. Rows light from
    the bottom as density rises — the step() against the row index IS the
    ASCII quantizer, so a cell is always a whole character.
  */
  float rowI = floor(g.y * 4.0);
  float bar = step(0.22, fract(g.y * 4.0)) * step(fract(g.y * 4.0), 0.9);
  float stripe = step(0.18, fract(g.x * 3.0));
  float lit = step(rowI + 0.5, dens * 4.0 * gainNow);
  float glyph = bar * stripe * lit;

  /*
    Blocky dropouts: the same field, resampled on a 2x2 super-grid and
    thresholded. Because whole super-cells fail together, the dark zones
    become hard rectangular holes instead of dim characters.
  */
  vec2 superCentre = (floor(cellIdx / 2.0) * 2.0 + 1.0) * cellPx;
  vec2 sSuv = (2.0 * superCentre - uRes) / min(uRes.x, uRes.y);
  vec2 sUv2 = sSuv / uP_radius;
  float sz = sqrt(max(1.0 - dot(sUv2, sUv2), 0.0));
  vec3 ssp = vec3(sUv2.x * cr - sz * sr, sUv2.y, sUv2.x * sr + sz * cr);
  float superField = fbm(ssp.xy / (abs(ssp.z) + 1.2) * uP_scale * 3.0 + flow);
  float keep = step(uP_dropout, superField + 0.15 * uOutput);
  glyph *= keep;

  // phosphor ramp: deep green floor to hot glow, whitening at the top end
  vec3 glyphCol = mix(uC_deep, uC_glow, dens);
  glyphCol += vec3(0.7, 1.0, 0.9) * pow(dens, 3.0) * 0.35;

  // a dark body under the matrix plus a glow-coloured fresnel rim, so the
  // orb reads as a solid ball and not loose characters
  float fres = pow(1.0 - z, 2.2);
  vec3 col = uC_deep * 0.22 + glyphCol * glyph + uC_glow * fres * uP_rim;

  col = pow(max(col, 0.0), vec3(uP_contrast));

  // Surface-lit orb bounded by a mask: alpha IS coverage, so premultiply —
  // the opposite convention from the emissive orbs (see shdr-31).
  float a = mask;
  gl_FragColor = vec4(col * a, a);
}
`;
var DEFAULTS = { drift: 0.55, scroll: 0.05, speed: 0.5, pulse: 0, spin: 0.12, radius: 0.9, cells: 40, scale: 1.6, density: 0.48, dropout: 0.48, light: 0.6, rim: 0.45, gain: 1, contrast: 1 };
var VARIANTS = {
  id: "orb_phosphor",
  frag: FRAG,
  defaults: DEFAULTS,
  clocks: ["drift", "scroll", "speed", "spin"],
  colors: { glow: "#57ffc9", deep: "#0b3b2d" },
  presets: {
    idle: {
      drift: 0.55,
      scroll: 0.05,
      pulse: 0,
      speed: 0.52,
      spin: 0.12,
      cells: 68,
      scale: 5.1,
      density: 0.31,
      dropout: 0.24,
      light: 1.11,
      rim: 0.66,
      gain: 0.9
    },
    recording: {
      drift: 0.4,
      scroll: 0.1,
      pulse: 1.27,
      speed: 2.85,
      spin: 1.05,
      cells: 120,
      scale: 7.2,
      density: 0.56,
      dropout: 0.59,
      light: 0.39,
      rim: 0.51,
      gain: 2.95
    },
    transcribing: {
      drift: 3.05,
      scroll: 0.65,
      pulse: 0.58,
      speed: 0.45,
      spin: 0.04,
      cells: 86,
      density: 0.33,
      dropout: 0.13,
      light: 0.855,
      rim: 0.51,
      contrast: 1.3,
      gain: 0.95
    }
  }
};
function mount(container, api) {
  return mountOrb(container, api, VARIANTS);
}
export {
  mount
};
