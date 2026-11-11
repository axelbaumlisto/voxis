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

// src/theme-engine/builtin/orb_dispersion/index.ts
var FRAG = `
#define STEPS 60
#define TURB 5
#define AA 1

// Volume-reactive values, resolved once per fragment in main().
float dispersionTurb;
float dispersionExposure;

mat2 rot2(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

vec3 dispersionRender(vec2 fragCoord) {
  float animTime = uP_speed; // integrated clock: turbulence + sheet drift
  float spinAng = uP_spin;   // integrated clock: prism precession

  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  vec3 ro = vec3(0.0, 0.0, uP_camDist);
  vec3 rd = normalize(vec3(uv, -uP_focal));

  vec3 acc = vec3(0.0);

  // transmittance carried front-to-back, as in shdr-21 and the README's
  // diffusion note — near sheets veil far ones, which is where the depth
  // read comes from
  float T = 1.0;

  /*
    March only the span that can contribute. The tube is infinite, so a ray
    grazing its wall far in FRONT of the ball would otherwise stall there —
    small d, step after step — and exhaust STEPS before ever reaching the
    envelope, leaving a dark notch across the orb. Start at the envelope's
    near edge and break past its far edge; all 60 steps land where the
    envelope is non-zero.
  */
  float z = max(uP_camDist - uP_envRadius * 1.3, 0.0);
  float zEnd = uP_camDist + uP_envRadius * 1.3;

  for (int it = 0; it < STEPS; it++) {
    vec3 p = ro + rd * z;

    // orient the prism: static tilt about x, then precession about y from
    // the spin clock. Real rotations — see the header note.
    vec3 q = p;
    q.xz = rot2(spinAng) * q.xz;
    q.yz = rot2(uP_tilt) * q.yz;

    // turbulence in the prism's rotating frame; the +float(it) offset is the
    // original's +i, decorrelating octaves per step for a smoky depth
    vec3 a = q;
    for (int j = 0; j < TURB; j++) {
      float dj = float(j) + 3.0;
      a -= dispersionTurb * sin(a * dj + animTime + float(it)).yzx / dj;
    }

    /*
      The orb's own shell, in place of the original's square tube
      (golfed there as max(p=abs(p),p.y).x — just max(|x|,|y|)). Evaluated
      on the WARPED point, so the turbulence shimmers the surface itself
      like an oil film; at turb 0 it is a perfect glass shell. The cos
      sheets fill the interior with the dispersive volume.
    */
    float wall = abs(length(a) - uP_envRadius);
    float s = a.z + a.y - animTime;
    float d = max(wall + abs(cos(s)) / uP_sheets, 1e-4);

    /*
      Per-channel palette: one cosine phase per channel, scaled by uP_disperse
      (0 collapses to monochrome breathing, 1 is the original rainbow). The
      -z term couples depth into the phase, which is what turns the sheets
      into striations; uP_stria scales it.

      The CLAMP is load-bearing, same as the other accumulators here: 1/d
      spikes where a ray grazes the wall exactly where a sheet sits, and one
      unclamped sample would own the whole 60-step sum at some phases.
    */
    vec3 w = (cos(s - z * uP_stria + vec3(0.0, 1.0, 8.0) * uP_disperse) + 1.0) / d;
    w = min(w, vec3(uP_stepClamp));

    /*
      Envelope: bounds the sheet glow (the cos field lives EVERYWHERE in
      space, not just inside the ball) and adds the uP_fill floor that
      guarantees a body. The outer bound sits 12% PAST the radius on
      purpose: the shell IS the radius now, the silhouette is cut
      analytically in main(), and a hard cut only reads as a sharp edge if
      there is still emission left at the boundary to cut. envCore is where
      the plateau saturates — 1 keeps the shell at full strength, lower
      values pull the brightness into the core.
    */
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
  dispersionTurb = uP_turb * (1.0 + 0.5 * uInput);
  dispersionExposure = uP_exposure * (1.0 - 0.35 * uOutput);

  vec3 acc = vec3(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 offset = vec2(float(mx), float(my)) / float(AA) - 0.5;
      acc += dispersionRender(gl_FragCoord.xy + offset);
    }
  }
  acc /= float(AA * AA);
#else
  acc = dispersionRender(gl_FragCoord.xy);
#endif

  // tanh tone map, as in the original but per channel and with a tunable
  // knee — the envelope and transmittance change the accumulator's scale
  // completely, so the golfed /2e2 constant means nothing here
  vec3 col = tanh3(acc / max(dispersionExposure, 1.0));
  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));

  // saturation about luminance, then the tint
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);
  col *= uC_tint;

  // alpha from the brightest channel, not luminance — a saturated violet
  // fringe has low luminance but must not go transparent
  float peak = max(col.r, max(col.g, col.b));
  float a = clamp(peak * uP_alphaGain, 0.0, 1.0);

  /*
    Analytic silhouette: the perpendicular distance from the sphere's centre
    to this pixel's ray, against the shell radius. Exact — not a fade of the
    accumulated glow — which is what makes the edge read as cut glass.
    uP_edge trades the transition band: 1 is a couple of pixels, 0 falls
    back to a soft feather. Colour AND alpha, as always.
  */
  vec3 mrd = normalize(vec3(orbUV(), -uP_focal));
  float closest = length(cross(vec3(0.0, 0.0, uP_camDist), mrd));
  float band = mix(0.35, 0.012, clamp(uP_edge, 0.0, 1.0));
  float mask = 1.0 - smoothstep(uP_envRadius * (1.0 - band), uP_envRadius * 1.005, closest);
  col *= mask;
  a *= mask;

  // Fade colour as well as alpha — with premultiplied output, fading only
  // alpha leaves the pixel emitting at full brightness up to the cutoff,
  // which reads as a hard rim. With the analytic mask doing the real work
  // this is only a safety taper at the frame boundary.
  float r2d = length(orbUV());
  float fade = 1.0 - smoothstep(uP_edgeFade, 1.0, r2d);
  col *= fade;
  a *= fade;

  // Emitted light, so rgb is already premultiplied — do NOT scale by alpha
  // again (see the same note in shdr-31).
  gl_FragColor = vec4(col, a);
}
`;
var DEFAULTS = { speed: 0.5, spin: 0.25, camDist: 7, focal: 2.25, tilt: 0.5, turb: 0.3, sheets: 7, disperse: 1, stria: 1, envRadius: 2.6, envCore: 1, fill: 1.5, stepClamp: 20, scatter: 0.02, exposure: 60, contrast: 1, saturation: 1, alphaGain: 2, edge: 1, edgeFade: 0.98 };
var VARIANTS = {
  id: "orb_dispersion",
  frag: FRAG,
  defaults: DEFAULTS,
  clocks: ["speed", "spin"],
  colors: { tint: "#ffffff" },
  presets: {
    idle: {
      speed: 0.5,
      spin: 0.25,
      turb: 0.3,
      disperse: 1,
      sheets: 7,
      exposure: 60,
      scatter: 0.02,
      alphaGain: 2
    },
    recording: {
      speed: 1.2,
      spin: 0.7,
      turb: 0.55,
      disperse: 1.5,
      sheets: 5.5,
      exposure: 45,
      scatter: 0.015,
      alphaGain: 2.5
    },
    transcribing: {
      speed: 0.6,
      spin: 0.5,
      turb: 0.35,
      disperse: 1.1,
      sheets: 7,
      exposure: 57,
      scatter: 0.019,
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
