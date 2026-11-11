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

// src/theme-engine/builtin/orb_dither/index.ts
var FRAG = `
// 2x2 Bayer base: floor/fract only. (0,0)=0, (1,0)=.5, (0,1)=.75, (1,1)=.25
// — the 0,2,3,1 ordering over 4.
float bayer2(vec2 a) {
  a = floor(a);
  return fract(a.x / 2.0 + a.y * a.y * 0.75);
}

// 8x8 by recursion: M8 = M2(a/4)/16 + M2(a/2)/4 + M2(a). No arrays, no
// bitwise — neither exists in GLSL ES 1.0.
float bayer8(vec2 a) {
  return bayer2(a * 0.25) * 0.0625 + bayer2(a * 0.5) * 0.25 + bayer2(a);
}

void main() {
  // Volume coupling: user input deepens the waves, agent output brightens
  // the whole tone ladder — the dot field visibly blooms while it speaks.
  float plasmaAmt = uP_plasma * (1.0 + 0.4 * uInput);
  float gainNow = uP_gain * (0.85 + 0.5 * uOutput);

  /*
    Chunky pixel grid, RESOLUTION-RELATIVE: uP_cells is how many cells span
    the canvas, so a 190px gallery card and a 420px playground orb show the
    same composition — the same wave resolved by the same number of dots.
    Sized in device pixels instead, small canvases collapse to a few dozen
    blotches. All content below samples at the cell centre so every dot is
    one flat square.
  */
  float cellPx = max(min(uRes.x, uRes.y) / max(uP_cells, 8.0), 1.0);
  vec2 pix = floor(gl_FragCoord.xy / cellPx);
  vec2 cellCentre = (pix + 0.5) * cellPx;

  vec2 suv = (2.0 * cellCentre - uRes) / min(uRes.x, uRes.y);
  vec2 uv = suv / uP_radius;
  float r2 = dot(uv, uv);

  // blocky silhouette — cut on the cell grid, deliberately not smoothed
  float mask = 1.0 - step(1.0, r2);

  float z = sqrt(max(1.0 - r2, 0.0));
  vec3 n = vec3(uv, z);

  /*
    The plasma is evaluated in a ROTATING frame: the dome point spins about
    Y on its own integrated clock, so the wavefronts roll around the ball
    instead of sliding across a flat disc. The light stays screen-fixed —
    the form shading holds still while the pattern travels over it.
  */
  float rot = uP_spin; // integrated clock
  float cr = cos(rot);
  float sr = sin(rot);
  vec3 sp = vec3(n.x * cr - n.z * sr, n.y, n.x * sr + n.z * cr);

  float t = uP_speed; // integrated clock

  // the classic demoscene plasma: three interfering sine waves, each on its
  // own direction and rate
  float f = uP_scale;
  float v = sin(sp.x * f * 3.1 + t)
    + sin((sp.y * 0.85 + sp.z * 0.4) * f * 3.6 - t * 1.3)
    + sin((sp.x + sp.y + sp.z) * f * 2.2 + t * 0.7);

  // a ripple source orbiting the dome — expanding rings pushed through the
  // interference; the clock enters only as additive phase
  vec2 src = 0.55 * vec2(cos(t * 0.5), sin(t * 0.5));
  v += sin(length(uv - src) * f * 5.0 - t * 2.2);
  v *= 0.25; // four unit waves back to -1..1

  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0, 1.0);
  float fres = pow(1.0 - z, 2.0);

  // waves modulated by the dome shading, so the ball stays a ball under
  // the rolling pattern; everything collapses into one luminance
  float lum = (0.5 + 0.5 * v * plasmaAmt) * (0.3 + uP_light * lambert)
    + uP_rim * fres;
  lum = pow(clamp(lum * gainNow, 0.0, 1.0), uP_contrast);

  // ordered dither onto the tone ladder — levels 2 is the classic 1-bit
  // look, higher values keep the grain but add mid-tones
  float steps = max(uP_levels - 1.0, 1.0);
  float q = clamp(floor(lum * steps + bayer8(pix)) / steps, 0.0, 1.0);

  vec3 col = mix(uC_ink, uC_paper, q);

  // Surface-lit orb bounded by a mask: alpha IS coverage, so premultiply —
  // the opposite convention from the emissive orbs (see shdr-31).
  float a = mask;
  gl_FragColor = vec4(col * a, a);
}
`;
var DEFAULTS = { speed: 0.5, spin: 0.15, radius: 0.9, cells: 140, levels: 3, scale: 1.5, plasma: 0.9, light: 0.9, rim: 0.35, gain: 1, contrast: 1.1 };
var VARIANTS = {
  id: "orb_dither",
  frag: FRAG,
  defaults: DEFAULTS,
  clocks: ["speed", "spin"],
  colors: { ink: "#101426", paper: "#cfe6ff" },
  presets: {
    idle: {
      speed: 0.5,
      spin: 0.15,
      plasma: 0.9,
      gain: 1,
      contrast: 1.1
    },
    recording: {
      speed: 1.3,
      spin: 0.8,
      plasma: 1,
      gain: 1.3,
      contrast: 1.05
    },
    transcribing: {
      speed: 1.6,
      spin: 0.05,
      plasma: 1.15,
      gain: 0.95,
      contrast: 1.15
    }
  }
};
function mount(container, api) {
  return mountOrb(container, api, VARIANTS);
}
export {
  mount
};
