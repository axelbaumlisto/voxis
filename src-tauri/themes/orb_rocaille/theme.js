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

// src/theme-engine/builtin/orb_rocaille/index.ts
var FRAG = `
#define LAYERS 10
#define WARP 9

void main() {
  vec2 uv = orbUV();
  float R = uP_radius + uP_swell * uInput;
  float r2d = length(uv);
  float mask = smoothstep(0.012, -0.012, r2d - R);
  float nr = clamp(r2d / max(R, 0.001), 0.0, 1.0);
  float z = sqrt(max(1.0 - nr * nr, 0.0));

  float animTime = uP_speed; // integrated clock

  vec3 sp = vec3(uv / max(R, 0.001), z);

  /*
    Stereographic projection: sphere → plane. Equal steps in screen space map to
    ever-larger steps in pattern space as the rim is approached, which is exactly
    the foreshortening that sells a flat field as wrapped geometry. uP_bulge
    softens the divisor — higher flattens it back toward a disc.

    DO NOT rotate sp in 3D before this. Spinning the dome about Y mixes sp.x
    into sp.z, so near the rim the divisor collapses toward zero, p explodes,
    length(v) goes huge, and 1/length(v) leaves most of the sphere black. That
    is what hollowed the orb out. The projection needs sp.z to stay the
    view-facing component.

    Motion comes from animTime inside the warp below instead, which changes the
    scrollwork without ever touching the projection. If you want the pattern to
    travel, rotate or translate p here in 2D — that is projection-safe.
  */
  vec2 p = sp.xy / (sp.z + 1.0 + uP_bulge) * uP_zoom;

  // projection-safe 2D drift, in place of a dome spin
  float sw = animTime * uP_swirl;
  p = mat2(cos(sw), -sin(sw), sin(sw), cos(sw)) * p;

  // input volume tightens the warp; output volume brightens the layers
  float warpFreq = uP_warpFreq * (1.0 + 0.35 * uInput);
  float gain = uP_gain * (0.75 + 0.7 * uOutput);

  vec4 acc = vec4(0.0);
  for (int i = 1; i <= LAYERS; i++) {
    float fi = float(i);
    vec2 v = p;
    for (int j = 1; j <= WARP; j++) {
      float f = float(j);
      v += sin(v.yx * f * warpFreq + fi + animTime) / f;
    }
    // uP_coreClamp guards the divide and doubles as the flare size — the
    // original has no guard and relies on length(v) never hitting zero.
    //
    // uP_falloff is the FILL control. The original's plain 1/length(v) decays
    // fast, so only the knots where the warp lands near the origin light up and
    // the rest of the sphere stays near black. An exponent below 1 flattens the
    // tail — at length(v)=10 a 0.6 power is ~4x brighter than 1/x — which lifts
    // the filigree between the knots without blowing the knots themselves out.
    float rad = pow(max(length(v), uP_coreClamp), uP_falloff);
    acc += (cos(fi + vec4(0.0, 1.0, 2.0, 3.0) + uP_hueShift) + 1.0) / 6.0 / rad;
  }

  // the original squares before tone-mapping, which is what crushes the dim
  // filigree and leaves the bright scrollwork
  vec3 col = tanh3(acc.rgb * acc.rgb * gain);

  // rim light, so the silhouette reads as a ball rather than a cut-out
  float fresnel = pow(1.0 - z, uP_rimPow);
  col += vec3(fresnel) * uP_rim;

  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float visibility = clamp(lum * uP_alphaGain + uP_baseVis + fresnel * 0.25, 0.0, 1.0);

  // Surface-lit and mask-bounded, so alpha is coverage: premultiply normally.
  // (Unlike Corona and Nimbus, which are emissive and must not be.)
  float a = mask * visibility;
  gl_FragColor = vec4(col * a, a);
}
`;
var DEFAULTS = { speed: 0.5, swirl: 0.06, radius: 0.9, swell: 0.06, zoom: 4.4, bulge: 0.35, warpFreq: 1.5, hueShift: 0, coreClamp: 0.12, falloff: 1, gain: 0.55, rim: 0.12, rimPow: 2.2, alphaGain: 2.4, baseVis: 0.08 };
var VARIANTS = {
  id: "orb_rocaille",
  frag: FRAG,
  defaults: DEFAULTS,
  clocks: ["speed"],
  colors: {},
  presets: {
    idle: {
      speed: 0.5,
      zoom: 4.4,
      warpFreq: 1.5,
      coreClamp: 0.12,
      falloff: 1,
      gain: 0.55,
      rim: 0.12,
      alphaGain: 2.4
    },
    recording: {
      speed: 3,
      zoom: 4.4,
      warpFreq: 1.2,
      coreClamp: 0.07,
      falloff: 1.1,
      gain: 0.85,
      rim: 0.2,
      alphaGain: 3
    },
    transcribing: {
      speed: 0.65,
      zoom: 4.6,
      warpFreq: 1.6,
      coreClamp: 0.11,
      falloff: 0.96,
      gain: 0.6,
      rim: 0.13,
      alphaGain: 2.5
    }
  }
};
function mount(container, api) {
  return mountOrb(container, api, VARIANTS);
}
export {
  mount
};
