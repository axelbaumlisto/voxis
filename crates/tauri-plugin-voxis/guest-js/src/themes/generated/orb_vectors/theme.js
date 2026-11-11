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

// src/theme-engine/builtin/orb_vectors/index.ts
var FRAG = `
#define STEPS 70
#define TURB 7
#define AA 1

// Volume-reactive values, resolved once per fragment in main().
float vectorsTurb;
float vectorsExposure;
float vectorsGlow;

vec3 vectorsRender(vec2 fragCoord) {
  float animTime = uP_speed; // integrated clock: cell flicker phase
  float wander = uP_wander;  // integrated clock: axis drift

  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  vec3 ro = vec3(0.0, 0.0, uP_camDist);
  vec3 rd = normalize(vec3(uv, -uP_focal));

  // the wandering rotation axis — unit by construction, which is what
  // makes the 90-degree Rodrigues below exact
  vec3 axis = normalize(sin(wander + vec3(0.0, 2.0, 4.0)));

  vec3 acc = vec3(0.0);

  // transmittance carried front-to-back — near streaks veil far ones
  float T = 1.0;

  // march only the span the envelope can light, as in shdr-01
  float z = max(uP_camDist - uP_envRadius * 1.3, 0.0);
  float zEnd = uP_camDist + uP_envRadius * 1.3;

  for (int it = 0; it < STEPS; it++) {
    vec3 p = ro + rd * z;

    /*
      THE ORB IS THE OBJECT — pull the sample toward the sphere's shell
      before the field ever sees it. At hug 0 this is the raw 3D tangle;
      at 1 the field is purely angular, painted on the ball's skin. The
      guard keeps normalize() defined through the centre.
    */
    float rl = max(length(p), 1e-3);
    vec3 q = mix(p, p / rl * uP_envRadius, uP_hug);

    // the exact 90-degree rotation about the wandering axis; v stays
    // clean, a takes the turbulence — the fork is the original's v=a=...
    vec3 v = dot(axis, q) * axis + cross(axis, q);
    vec3 a = v;

    // cell-quantized turbulence: every ceil() lattice cell flickers on
    // its own phase
    for (int j = 0; j < TURB; j++) {
      float dj = float(j) + 3.0;
      a += vectorsTurb * sin(ceil(a * dj) - animTime).yzx / dj;
    }

    // the density product — turbulent detail times clean streak surfaces
    float d = uP_stepScale * length(sin(a * a)) * sqrt(length(v * sin(v.yzx)));
    d = max(d, 1e-4);

    /*
      The march's own colour code, from the listing: red constant, green
      by step index, blue by depth into the ball — with the two ramps
      exposed. The CLAMP is load-bearing as everywhere: one grazing step
      would own the whole 70-step sum at some phases. Green gets twice the
      clamp headroom: its ramp runs to STEPS (70) where red is fixed at 9,
      and an equal clamp would crush the step gradient first.
    */
    vec3 w = vec3(9.0, float(it) * uP_hueStep, (z - uP_camDist + uP_envRadius) * uP_hueDepth) / d;
    w = min(w, vec3(uP_stepClamp) * vec3(1.0, 2.0, 1.0));

    /*
      Normalize the clamped weight back to family units (a ceiling of ~20,
      like the sibling orbs). This orb's raw weights run in the hundreds —
      the golfed knee was 6e4 — and without this one line the clamp value
      leaks into total energy, so Exposure, Body fill and Diffusion would
      all change meaning whenever the clamp moves. Normalized, stepClamp
      is a pure dynamic-range knob: low flattens the streaks, high lets
      the 1/d spikes whiten.
    */
    w *= 20.0 / max(uP_stepClamp, 1.0);

    /*
      A few vectors GLOW. Cells of the clean rotated frame are hashed, and
      each cell's hash cycles against the clock so only a small fraction
      (uP_glowFew of the cycle) are hot at any moment. Where a hot cell
      meets a streak null, the same 1/d spike is re-read on a far higher
      ceiling than the step clamp — deliberately bypassing it — and pushed
      as warm-white light. The two smoothsteps make a triangle window, so
      each glow blooms and fades instead of popping at the cycle wrap.
    */
    float few = max(uP_glowFew, 1e-3);
    vec3 vc = ceil(v * 2.0);
    float hcell = hash(vc.xy + vc.z * vec2(7.31, 3.17));
    float cyc = fract(hcell + animTime * 0.05);
    float sel = smoothstep(1.0 - few, 1.0 - 0.5 * few, cyc) * smoothstep(1.0, 1.0 - 0.5 * few, cyc);
    // QUADRATIC in 1/d, unlike the linear base weight — the glow hugs the
    // filament core and falls off fast, a hot wire rather than a lit sector
    w += vec3(1.0, 0.96, 0.88) * min(0.08 / (d * d), 500.0) * sel * vectorsGlow;

    // envelope: plateau through the ball, cut 12% past the radius so the
    // analytic silhouette in main() still has emission left to cut
    float env = smoothstep(uP_envRadius * 1.12, uP_envRadius * uP_envCore, length(p));
    w = (w + uP_fill) * env;

    acc += T * w;
    T *= exp(-dot(w, vec3(0.299, 0.587, 0.114)) * uP_scatter);

    z += d;
    if (T < 0.004 || z > zEnd) break;
  }

  return acc;
}

void main() {
  vectorsTurb = uP_turb * (1.0 + 0.5 * uInput);
  vectorsExposure = uP_exposure * (1.0 - 0.35 * uOutput);
  // the glows flare when the agent speaks
  vectorsGlow = uP_glow * (1.0 + 0.8 * uOutput);

  vec3 acc = vec3(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 offset = vec2(float(mx), float(my)) / float(AA) - 0.5;
      acc += vectorsRender(gl_FragCoord.xy + offset);
    }
  }
  acc /= float(AA * AA);
#else
  acc = vectorsRender(gl_FragCoord.xy);
#endif

  // tanh tone map per channel — the envelope and transmittance change the
  // accumulator's scale, so the golfed /6e4 knee is a tunable here
  vec3 col = tanh3(acc / max(vectorsExposure, 1.0));
  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));

  // saturation about luminance, then the tint
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);
  col *= uC_tint;

  // alpha from the brightest channel, not luminance — a deep blue tail
  // has low luminance but must not go transparent
  float peak = max(col.r, max(col.g, col.b));
  float a = clamp(peak * uP_alphaGain, 0.0, 1.0);

  // Analytic silhouette — identical construction to shdr-01: exact
  // ray-to-centre distance against the radius, colour AND alpha.
  vec3 mrd = normalize(vec3(orbUV(), -uP_focal));
  float closest = length(cross(vec3(0.0, 0.0, uP_camDist), mrd));
  float band = mix(0.35, 0.012, clamp(uP_edge, 0.0, 1.0));
  float mask = 1.0 - smoothstep(uP_envRadius * (1.0 - band), uP_envRadius * 1.005, closest);
  col *= mask;
  a *= mask;

  // safety taper at the frame boundary — colour as well as alpha
  float r2d = length(orbUV());
  float fade = 1.0 - smoothstep(uP_edgeFade, 1.0, r2d);
  col *= fade;
  a *= fade;

  // Emitted light, so rgb is already premultiplied — do NOT scale by alpha
  // again (see the same note in shdr-31).
  gl_FragColor = vec4(col, a);
}
`;
var DEFAULTS = { speed: 0.5, wander: 0.12, camDist: 7, focal: 2.25, hug: 0.8, turb: 0.6, stepScale: 0.07, hueStep: 0.12, hueDepth: 1.4, glow: 1.4, glowFew: 0.12, envRadius: 2.6, envCore: 0.88, fill: 0.15, stepClamp: 800, scatter: 0.01, exposure: 260, contrast: 1.3, saturation: 1.15, alphaGain: 2, edge: 1, edgeFade: 0.98 };
var VARIANTS = {
  id: "orb_vectors",
  frag: FRAG,
  defaults: DEFAULTS,
  clocks: ["speed", "wander"],
  colors: { tint: "#ffffff" },
  presets: {
    idle: {
      speed: 0.4,
      wander: 0.1,
      turb: 0.55,
      glow: 1.3,
      glowFew: 0.12,
      exposure: 260,
      scatter: 0.01,
      alphaGain: 2
    },
    recording: {
      speed: 2.2,
      wander: 0.3,
      turb: 0.85,
      glow: 2.4,
      glowFew: 0.22,
      exposure: 170,
      scatter: 0.0075,
      alphaGain: 2.5
    },
    transcribing: {
      speed: 1.2,
      wander: 0.6,
      turb: 0.7,
      glow: 1.7,
      glowFew: 0.07,
      exposure: 230,
      scatter: 0.0095,
      alphaGain: 2.1
    }
  }
};
function mount(container, api) {
  return mountOrb(container, api, VARIANTS);
}
export {
  mount
};
