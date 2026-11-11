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

// src/theme-engine/builtin/orb_shdr_25/index.ts
var FRAG = `
#define OCTAVES 8
#define AA 2

// Volume-reactive values, resolved once per fragment in main().
float creaseWarp;
float creaseGain;

// GLSL ES 1.0 has no scalar tanh; the prelude ships the vec3 form only.
float tanh1(float x) {
  x = clamp(x, -10.0, 10.0);
  float e = exp(2.0 * x);
  return (e - 1.0) / (e + 1.0);
}

/*
  The whole chain for one pixel centre: dome, stereographic wrap, then the
  eight-octave warp. Called three times per sample so the derivative below
  can be differenced — see the header for why fwidth is unavailable.
*/
vec2 creaseField(vec2 fragCoord, float t, float drift, float sw) {
  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  vec2 pl = uv / max(uP_radius, 0.001);
  float z = sqrt(max(1.0 - dot(pl, pl), 0.0));

  vec2 p = pl / (z + 1.0 + uP_bulge) * uP_scale;
  p = mat2(cos(sw), -sin(sw), sin(sw), cos(sw)) * p;
  p += drift;

  /*
    The listing's matrix, decomposed. mat2(6,-8,8,6)/9 is exactly
    (10/9) * mat2(.6,-.8,.8,.6), and that second factor is a true rotation
    because 6-8-10 is a Pythagorean triple — so the octave transform is a
    rotation through the 3-4-5 angle times a clean zoom, with the zoom
    pulled out as a slider.
  */
  for (int i = 0; i < OCTAVES; i++) {
    float fi = float(i) + 1.0;
    p += sin(p + t + fi) * creaseWarp;
    p = uP_zoom * (mat2(0.6, -0.8, 0.8, 0.6) * p);
  }

  return p;
}

vec3 creaseRender(vec2 fragCoord) {
  float t = uP_speed;      // integrated clock: the boil
  float drift = uP_drift;  // integrated clock: the slow travel
  float sw = uP_swirl;     // integrated clock

  /*
    The three taps the difference needs. uP_blur is how far apart they sit:
    at one pixel this is fwidth exactly, and wider is a deliberate blur —
    the derivative of a folded field is a hairline, and a rim wants width.
  */
  vec2 p0 = creaseField(fragCoord, t, drift, sw);
  vec2 px = creaseField(fragCoord + vec2(uP_blur, 0.0), t, drift, sw);
  vec2 py = creaseField(fragCoord + vec2(0.0, uP_blur), t, drift, sw);

  /*
    fwidth, by hand and once per channel. The sum of the absolute
    differences on each axis is exactly what the built-in returns — but
    taking it three times at slightly offset ripple phases puts each
    channel's rim in a slightly different place, which is where the warm
    and cool fringes on the edges come from. One field evaluation still
    serves all three.
  */
  vec3 e;
  for (int c = 0; c < 3; c++) {
    float ph = float(c) * uP_fringe;
    vec2 v0 = sin(p0 * uP_ripple + ph);
    vec2 d = abs(sin(px * uP_ripple + ph) - v0)
           + abs(sin(py * uP_ripple + ph) - v0);
    float m = tanh1(length(d) * creaseGain / max(uP_exposure, 0.001));
    if (c == 0) e.r = m;
    else if (c == 1) e.g = m;
    else e.b = m;
  }

  e = pow(clamp(e, 0.0, 1.0), vec3(uP_contrast));

  vec3 col = uC_tint * e;

  // a dark body under the filigree, so the flat regions read as the ball
  col += uC_body * uP_floorLevel;

  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);

  // dome shading keeps the ball a ball under the folds
  vec2 pl = ((2.0 * fragCoord - uRes) / min(uRes.x, uRes.y)) / max(uP_radius, 0.001);
  float z = sqrt(max(1.0 - dot(pl, pl), 0.0));
  vec3 n = vec3(pl, z);
  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.72))), 0.0, 1.0);
  col *= 0.62 + uP_light * lambert;

  float fres = 1.0 - z;
  fres = fres * fres * fres;
  col += uC_sheen * uP_rim * fres;

  return col;
}

void main() {
  // Volume coupling: the user's voice folds the field harder, the agent's
  // steepens what counts as a crease.
  creaseWarp = uP_warp * (1.0 + 0.4 * uInput);
  creaseGain = uP_edgeGain * (1.0 + 0.5 * uOutput);

  vec2 uv = orbUV();
  float mask = smoothstep(0.012, -0.012, length(uv) - max(uP_radius, 0.001));

  // Twenty-four warp steps per sample — none of them worth paying for
  // outside the silhouette.
  if (mask <= 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec3 col = vec3(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 off = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;
      col += creaseRender(gl_FragCoord.xy + off);
    }
  }
  col /= float(AA * AA);
#else
  col = creaseRender(gl_FragCoord.xy);
#endif

  // Surface orb bounded by a mask: alpha IS coverage, so premultiply — the
  // opposite convention from the emissive orbs (see shdr-31).
  float a = mask;
  gl_FragColor = vec4(max(col, vec3(0.0)) * a, a);
}
`;
var DEFAULTS = { speed: 3, drift: 0.6, swirl: 0.05, radius: 0.9, scale: 7.5, bulge: 0.3, warp: 0.4, zoom: 1.111, ripple: 0.3, edgeGain: 10, blur: 2.5, fringe: 0.09, exposure: 0.8, contrast: 1.15, saturation: 1.5, floorLevel: 0.16, light: 0.35, rim: 0.45 };
var VARIANTS = {
  id: "orb_shdr_25",
  frag: FRAG,
  defaults: DEFAULTS,
  clocks: ["speed", "drift", "swirl"],
  colors: { tint: "#dbe8f7", body: "#0d1118", sheen: "#a8c8f0" },
  presets: {
    idle: {
      speed: 3,
      drift: 0.6,
      swirl: 0.05,
      warp: 0.4,
      zoom: 1.07,
      edgeGain: 12.5,
      exposure: 0.8,
      contrast: 1.15
    },
    recording: {
      speed: 1.4,
      drift: 0.8,
      swirl: 0.6,
      scale: 11.5,
      bulge: 2.22,
      warp: 1.55,
      zoom: 0.945,
      ripple: 1.18,
      edgeGain: 5,
      blur: 2,
      fringe: 0.23,
      exposure: 2.35,
      contrast: 1.35
    },
    transcribing: {
      speed: 4.7,
      drift: 0.15,
      swirl: 0.02,
      bulge: 0.38,
      warp: 0.34,
      zoom: 1.12,
      ripple: 0.18,
      edgeGain: 33,
      blur: 2.75,
      fringe: 0.2,
      exposure: 0.55,
      contrast: 1.5,
      saturation: 2,
      light: 0.525,
      rim: 0.69
    }
  }
};
function mount(container, api) {
  return mountOrb(container, api, VARIANTS);
}
export {
  mount
};
