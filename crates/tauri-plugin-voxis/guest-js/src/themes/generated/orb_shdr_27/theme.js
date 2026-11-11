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

// src/theme-engine/builtin/orb_shdr_27/index.ts
var FRAG = `
#define VORTICES 6
#define FBM3_OCT 4

// Volume-reactive values, resolved once per fragment in main().
float radarLoNow;
float radarDensityNow;

/*
  3D value noise. The prelude's noise is 2D, and a 2D field wrapped onto
  the ball has to be projected — and every projection either distorts
  somewhere or seams somewhere, which is exactly what the roll dragged
  into view. Evaluating the field ON the sphere's own points needs
  nothing projected: the roll is just a rotation of the sample point.
*/
float hash3(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
}
float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash3(i);
  float n100 = hash3(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash3(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash3(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash3(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash3(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash3(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash3(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z
  );
}
float fbm3(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < FBM3_OCT; i++) {
    v += a * noise3(p);
    p = p * 2.03 + vec3(11.7, 7.3, 3.1);
    a *= 0.5;
  }
  return v;
}

// rotate v about the unit axis k by angle a (Rodrigues)
vec3 rotateAbout(vec3 v, vec3 k, float a) {
  float c = cos(a);
  float s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}

// the precipitation intensity, 0..1, at a point of the unit sphere
float intensity(vec3 sp, float t) {
  vec3 q = sp;
  /*
    The vortices: hashed points on the sphere, each twisting the space
    around itself — a rotation about the axis through it, by an angle
    that falls off with the angular distance, alternating in sense. The
    centres wander slowly so no spiral sits still.
  */
  for (int k = 0; k < VORTICES; k++) {
    float fk = float(k);
    vec3 c = normalize(vec3(
      hash(vec2(fk * 3.7, 1.1)) - 0.5,
      hash(vec2(fk * 5.9, 2.3)) - 0.5,
      hash(vec2(fk * 7.1, 4.9)) - 0.5
    ));
    c = rotateAbout(c, vec3(0.0, 1.0, 0.0), sin(t * 0.09 + fk * 1.7) * 0.25);
    float ang = acos(clamp(dot(q, c), -1.0, 1.0));
    float fall = exp(-ang * ang / (uP_vortex * uP_vortex));
    float a = uP_swirl * fall * (mod(fk, 2.0) < 0.5 ? 1.0 : -1.0);
    q = rotateAbout(q, c, a);
  }

  // bend, then drift the noise through the twisted space
  vec3 w = vec3(noise3(q * 1.3 + 2.1), noise3(q * 1.3 + 7.3), noise3(q * 1.3 + 4.4)) - 0.5;
  q += w * uP_warp;
  vec3 pq = q * uP_freq + vec3(t * 0.22, -t * 0.13, t * 0.07);

  /*
    Two scales multiplied, not added: a broad mask decides WHERE the storms
    are, a finer field gives each one a core and ragged edges. Adding them
    fills the whole sphere with mid-tones; multiplying leaves the calm
    between systems genuinely empty and puts the peaks inside the cells,
    which is what draws the concentric class rings.
  */
  float big = clamp((fbm3(pq) - 0.5) * 3.0 + 0.5, 0.0, 1.0);
  float fine = clamp((fbm3(pq * 2.6 + 4.7) - 0.5) * 2.4 + 0.5, 0.0, 1.0);
  float f = big * (0.55 + 0.45 * fine);

  f = clamp((f - radarLoNow) / max(uP_hi - radarLoNow, 0.01), 0.0, 1.0);
  // a response curve: the top classes are the rare peaks of a real map
  return pow(f, uP_curve);
}

void main() {
  // input lowers the window (more of the field reads as weather), output
  // fills the dots in
  radarLoNow = uP_lo - 0.08 * uInput;
  radarDensityNow = uP_density * (1.0 + 0.5 * uOutput);

  vec2 uv = orbUV();
  float rd = length(uv);
  float R = uP_radius;
  float mask = smoothstep(0.012, -0.012, rd - R);

  if (mask <= 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec2 pl = uv / R;
  float r2 = dot(pl, pl);
  float z = sqrt(max(1.0 - r2, 0.0));
  vec3 n = vec3(pl, z);

  float t = uP_speed; // integrated clock: the weather drifts

  /*
    The pixel grid lives on the UNROLLED dome: a stereographic wrap of the
    front hemisphere as it faces the viewer, which compresses gently toward
    the limb and never changes. The picture rolls underneath it — the
    pixels are the screen, the weather is what is on it. Laying the grid on
    the rolled dome instead put the projection's blow-up (the far side of
    the ball) wherever the roll had turned it, and the cells smeared into
    streaks there.
  */
  vec2 st = n.xy / (1.3 + n.z) * uP_scale;
  vec2 g = st * uP_cells;
  vec2 cell = floor(g);
  vec2 fr = fract(g) - 0.5;

  // the cell centre, back on the dome: invert the wrap, then roll it and
  // read the field there — once per cell, so every dot is one flat colour
  vec2 v = (cell + 0.5) / uP_cells / uP_scale;
  float vv = dot(v, v);
  float A = vv + 1.0;
  float B = 2.6 * vv;
  float C = 1.69 * vv - 1.0;
  float zc = (-B + sqrt(max(B * B - 4.0 * A * C, 0.0))) / (2.0 * A);
  vec3 nc = vec3(v * (1.3 + zc), zc);
  float cr = cos(uP_spin);
  float sr = sin(uP_spin);
  vec3 spc = vec3(nc.x * cr - nc.z * sr, nc.y, nc.x * sr + nc.z * cr);

  float f = intensity(spc, t);

  // dither the class boundaries with a per-cell hash, then quantize into
  // the legend's seven classes. The bands are NOT even: red is broad and
  // green thin, as on the reference, and magenta is the rare peak.
  float h = hash(cell + 11.7);
  float fd = clamp(f + (h - 0.5) * uP_dither, 0.0, 1.0);
  float cls = 0.0;
  cls += step(0.10, fd);
  cls += step(0.26, fd);
  cls += step(0.38, fd);
  cls += step(0.46, fd);
  cls += step(0.78, fd);
  cls += step(0.94, fd);

  // dropout: density rises with the intensity; the hash re-rolls slowly
  float frame = floor(uTime * uP_twinkle);
  float roll = hash(cell + vec2(frame * 3.7, -frame * 1.3));
  float density = mix(uP_sparse, 1.0, smoothstep(0.0, 0.6, f)) * radarDensityNow;
  float keep = step(roll, density);

  // the dot: a square inset in its cell
  float dsq = max(abs(fr.x), abs(fr.y));
  float dotMask = 1.0 - smoothstep(uP_dot - 0.06, uP_dot + 0.06, dsq);

  // the class palette
  vec3 ink = uC_c0;
  ink = cls > 0.5 && cls < 1.5 ? uC_c1 : ink;
  ink = cls > 1.5 && cls < 2.5 ? uC_c2 : ink;
  ink = cls > 2.5 && cls < 3.5 ? uC_c3 : ink;
  ink = cls > 3.5 && cls < 4.5 ? uC_c4 : ink;
  ink = cls > 4.5 && cls < 5.5 ? uC_c5 : ink;
  ink = cls > 5.5 ? uC_c6 : ink;

  vec3 col = mix(uC_paper, ink, dotMask * keep);

  // paper grain, so the flats are not dead
  col *= 1.0 + (hash(floor(gl_FragCoord.xy / 2.0) + frame) - 0.5) * uP_grain;

  // dome shading keeps the ball a ball under the mosaic
  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0, 1.0);
  col *= 1.0 - uP_light * (1.0 - lambert);
  float fres = pow(1.0 - z, 3.0);
  col = mix(col, uC_c0, fres * uP_rim);

  // Surface orb bounded by a mask: alpha IS coverage, so premultiply — the
  // opposite convention from the emissive orbs (see shdr-31).
  float a = mask;
  gl_FragColor = vec4(max(col, vec3(0.0)) * a, a);
}
`;
var DEFAULTS = { speed: 0.6, spin: 0.04, radius: 0.9, scale: 2.4, cells: 34, dot: 0.36, swirl: 1.5, vortex: 0.45, freq: 1.6, warp: 0.5, lo: 0.12, hi: 0.82, curve: 1.4, dither: 0.12, sparse: 0.16, density: 1, twinkle: 3, grain: 0.1, light: 0.18, rim: 0.35 };
var VARIANTS = {
  id: "orb_shdr_27",
  frag: FRAG,
  defaults: DEFAULTS,
  clocks: ["speed", "spin"],
  colors: { paper: "#efe9dc", c0: "#a9a9a6", c1: "#2e5df0", c2: "#38d9ec", c3: "#22c35c", c4: "#e8322a", c5: "#f5d020", c6: "#e030c0" },
  presets: {
    idle: {
      speed: 1,
      spin: 0.27,
      lo: 0.12,
      hi: 0.82,
      curve: 1.4,
      sparse: 0.16,
      density: 1,
      twinkle: 3,
      warp: 0.5,
      swirl: 1.5,
      dither: 0.12
    },
    recording: {
      speed: 6.5,
      spin: 0.51,
      lo: 0,
      hi: 0.8,
      curve: 1.3,
      sparse: 0.22,
      density: 1.15,
      twinkle: 5,
      warp: 0.45,
      swirl: 2,
      grain: 0.35,
      dither: 0.1
    },
    transcribing: {
      speed: 2.4,
      spin: 0.51,
      lo: 0,
      hi: 0.545,
      curve: 1.7,
      sparse: 0.22,
      density: 0.9,
      twinkle: 12,
      freq: 5.2,
      warp: 1.06,
      swirl: 4,
      dither: 0.18
    }
  }
};
function mount(container, api) {
  return mountOrb(container, api, VARIANTS);
}
export {
  mount
};
