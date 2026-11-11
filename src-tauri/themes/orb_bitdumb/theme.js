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

// src/theme-engine/builtin/orb_bitdumb/index.ts
var FRAG = `
#define LEVELS 20

// Volume-reactive values, resolved once per fragment in main().
float bitdumbGain;
float bitdumbBody;

mat2 bdRot(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

void main() {
  bitdumbGain = uP_gain * (1.0 + 0.6 * uInput);
  bitdumbBody = uP_body * (1.0 + 0.8 * uOutput);

  vec2 uv = orbUV() / uP_radius;
  float r2 = dot(uv, uv);

  // analytic disc silhouette — this orb is parameterised on the dome, so
  // the exact edge is just the unit circle, with the same tunable band as
  // the raymarched orbs
  float band = mix(0.35, 0.012, clamp(uP_edge, 0.0, 1.0));
  float mask = 1.0 - smoothstep(1.0 - band, 1.005, length(uv));

  // front dome point and its normal (view space)
  float zc = sqrt(max(1.0 - r2, 0.0));
  vec3 n = vec3(uv, zc);

  // tumble the sphere point with real rotations, then project. abs() on z
  // mirror-wraps the hemisphere the tumble turns away, avoiding the
  // stereographic pole blow-up.
  vec3 sp = n;
  sp.yz = bdRot(uP_tilt) * sp.yz;
  sp.xz = bdRot(uP_spin) * sp.xz; // integrated clock
  vec2 p = sp.xy / (abs(sp.z) + 1.0) * uP_gridScale;

  /*
    Analytic pixel footprint in grid space, in place of fwidth(): one
    screen pixel in uv units, through the radius scale, the dome stretch
    (grids compress toward the rim, so a pixel covers more of them there),
    and the grid scale. Doubled alongside p every level.
  */
  float px = (2.0 / min(uRes.x, uRes.y)) / uP_radius / max(zc, 0.2) * uP_gridScale;

  vec4 acc = vec4(0.0);
  float phase = uP_speed * 0.2; // integrated clock, additive phase

  for (int i = 0; i < LEVELS; i++) {
    float fi = float(i) + 1.0;
    if (fi > uP_levels) break;

    // the listing's engine, kept verbatim: binary zoom
    p += p;
    px += px;

    vec2 v = ceil(p);
    vec2 f = fract(p);

    // distance to the nearest cell line, against this level's footprint —
    // the extension-free fwidth. Deep levels saturate to solid planes,
    // exactly like the original's aliasing.
    vec2 e2 = 1.0 - smoothstep(vec2(0.0), vec2(px * uP_lineW), min(f, 1.0 - f));

    // x-lines and y-lines separately tintable — the original's .xyy
    vec3 edgeCol = uC_lineA * e2.x + uC_lineB * e2.y;

    // the per-cell shutter value, and the under-compositing that makes
    // level i occlude level i+1 — both straight from the listing
    float aBit = fract(length(v) / fi - phase) * uP_shutter;
    acc += vec4(edgeCol, aBit) * (1.0 - acc.a);

    if (acc.a > 0.996) break;
  }

  vec3 col = acc.rgb * bitdumbGain;

  // the ball body: a lambert-shaded base under the lattice, so the orb
  // reads as a solid object rather than lines floating on nothing
  vec3 L = normalize(vec3(-0.4, 0.5, 0.75));
  float shade = 0.25 + 0.75 * clamp(dot(n, L), 0.0, 1.0);
  col += uC_base * shade * bitdumbBody;

  // fresnel rim to sell the sphere
  col += uC_rim * pow(1.0 - zc, uP_rimPow) * uP_rim;

  col = pow(max(col, 0.0), vec3(uP_contrast));

  // coverage alpha; safety taper fades colour AND alpha, as always
  float fade = 1.0 - smoothstep(uP_edgeFade, 1.0, length(orbUV()));
  float a = mask * fade;

  // Surface-lit orb bounded by a mask: alpha IS coverage, so premultiply —
  // the opposite of the emissive orbs (see the note in shdr-31).
  gl_FragColor = vec4(col * a, a);
}
`;
var DEFAULTS = { speed: 0.5, spin: 0.15, tilt: 0.5, radius: 0.9, gridScale: 2, levels: 12, lineW: 2, shutter: 1, gain: 1, body: 1, rim: 0.6, rimPow: 3, contrast: 1, edge: 1, edgeFade: 0.98 };
var VARIANTS = {
  id: "orb_bitdumb",
  frag: FRAG,
  defaults: DEFAULTS,
  clocks: ["speed", "spin"],
  colors: { lineA: "#ff5a4d", lineB: "#59d8ff", base: "#101528", rim: "#bcd8ff" },
  presets: {
    idle: {
      speed: 1,
      spin: 0.1,
      levels: 10,
      lineW: 2.5,
      shutter: 1.02,
      gain: 1,
      body: 0.9,
      rim: 0.6,
      rimPow: 5.2,
      contrast: 1.2
    },
    recording: {
      speed: 3,
      spin: 1.1,
      gridScale: 10.3,
      levels: 17,
      shutter: 1.2,
      gain: 0.95,
      body: 0.27,
      rim: 1.53,
      rimPow: 10,
      contrast: 1.45
    },
    transcribing: {
      speed: 2.4,
      spin: 0.81,
      lineW: 2.9,
      shutter: 0.94,
      gain: 1.2,
      body: 0.85,
      rim: 0.7
    }
  }
};
function mount(container, api) {
  return mountOrb(container, api, VARIANTS);
}
export {
  mount
};
