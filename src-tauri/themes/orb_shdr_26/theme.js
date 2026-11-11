// src/theme-engine/builtin/_shared/gl-theme.ts
function createGlSurface(container, opts) {
  const renderScale = opts.renderScale ?? 2;
  const canvas = document.createElement("canvas");
  canvas.width = opts.size.width * renderScale;
  canvas.height = opts.size.height * renderScale;
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  container.appendChild(canvas);
  const bail = (reason) => {
    console.warn(`${opts.id}: WebGL unavailable (${reason}), skipping`);
    canvas.remove();
    return { unmount() {
    } };
  };
  const gl = canvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false
  });
  if (!gl)
    return bail("no webgl context");
  const compile = (type, src) => {
    const sh = gl.createShader(type);
    if (!sh)
      return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn(`${opts.id}: shader compile failed`, gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  };
  const vs = compile(gl.VERTEX_SHADER, opts.vert);
  const fs = compile(gl.FRAGMENT_SHADER, opts.frag);
  const prog = gl.createProgram();
  if (!vs || !fs || !prog)
    return bail("shader/program");
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
    return bail(`link: ${gl.getProgramInfoLog(prog)}`);
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);
  gl.viewport(0, 0, canvas.width, canvas.height);
  let raf = 0;
  let last = 0;
  let elapsed = 0;
  let frameCb = null;
  let disposed = false;
  const tick = (now) => {
    if (disposed || !frameCb)
      return;
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    elapsed += dt;
    gl.clear(gl.COLOR_BUFFER_BIT);
    frameCb(dt, elapsed);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    raf = requestAnimationFrame(tick);
  };
  const onVisibility = () => {
    if (disposed)
      return;
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else if (!raf && frameCb) {
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }
  };
  document.addEventListener("visibilitychange", onVisibility);
  return {
    gl,
    canvas,
    uniform: (name) => gl.getUniformLocation(prog, name),
    run(frame) {
      frameCb = frame;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      gl.useProgram(null);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      canvas.remove();
    }
  };
}
function isBailed(surface) {
  return typeof surface.unmount === "function" && !("run" in surface);
}
var FULLSCREEN_VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

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
  const keys = Object.keys(variant.defaults);
  const colorKeys = Object.keys(variant.colors ?? {});
  const decls = [
    ...keys.map((k) => `uniform float uP_${k};`),
    ...colorKeys.map((k) => `uniform vec3 uC_${k};`)
  ].join(`
`);
  const made = createGlSurface(container, {
    id: variant.id,
    size: api.size,
    vert: FULLSCREEN_VERT,
    frag: `${ORB_PRELUDE}
${decls}
${variant.frag}`
  });
  if (isBailed(made))
    return made;
  const surface = made;
  const { gl } = surface;
  const uRes = surface.uniform("uRes");
  const uTime = surface.uniform("uTime");
  const uAnim = surface.uniform("uAnim");
  const uInput = surface.uniform("uInput");
  const uOutput = surface.uniform("uOutput");
  const loc = {};
  for (const k of keys)
    loc[k] = surface.uniform(`uP_${k}`);
  const colorLoc = {};
  for (const k of colorKeys)
    colorLoc[k] = surface.uniform(`uC_${k}`);
  gl.uniform2f(uRes, surface.canvas.width, surface.canvas.height);
  const liveColors = api.params?.colors;
  for (const k of colorKeys) {
    const hex = typeof liveColors?.[k] === "string" ? liveColors[k] : variant.colors[k];
    const [r, g, b] = hexToRgb(hex);
    gl.uniform3f(colorLoc[k], r, g, b);
  }
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
  let anim = 0;
  const off = api.onState((state) => {
    target = presetFor(variant, state.mode);
    level = Number.isFinite(state.audioLevel) ? Math.min(1, Math.max(0, state.audioLevel)) : 0;
  });
  surface.run((dt, elapsed) => {
    const k = 1 - Math.exp(-dt / 0.28);
    for (const key of keys) {
      const t = hasOverride[key] ? overrides[key] : target[key] ?? variant.defaults[key];
      current[key] += (t - current[key]) * k;
    }
    smoothLevel += (level - smoothLevel) * (1 - Math.exp(-dt / 0.08));
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
  });
  return {
    unmount() {
      off();
      surface.dispose();
    }
  };
}

// src/theme-engine/builtin/orb_shdr_26/index.ts
var FRAG = `
#define OCTAVES 9
#define AA 3

const float TAU = 6.28318530718;

// Volume-reactive values, resolved once per fragment in main().
float latticePole;
float latticeSharp;
float latticeGain;

vec3 latticeRender(vec2 fragCoord) {
  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  float R = max(uP_radius, 0.001);

  // the dome: the front hemisphere of a unit ball, in screen space
  vec2 pl = uv / R;
  float z = sqrt(max(1.0 - dot(pl, pl), 0.0));
  vec3 n = vec3(pl, z);

  float t = uP_speed; // integrated clock

  /*
    Stereographic projection of the UNROTATED dome.

    This orb was built on the abs(sp.z) form first — the one shdr-28
    and shdr-29 use, which survives a 3D roll because the divisor can
    only fall TO zero at the terminator, never through it. It renders, but
    every quarter turn it makes the visible hemisphere an EXACT mirror
    image about the view axis: at a roll of 90 degrees sp becomes
    (-n.z, n.y, n.x), so the projected coordinate depends on n.z and on
    abs(n.x), and both of those are even in screen x. A cellular grid
    hides that. A web of long threads does not — the ball turns into a
    Rorschach blot for a quarter of every revolution.

    So the dome stays put, as in shdr-08, and all the motion below is
    projection-safe 2D.
  */
  vec2 p = n.xy / (n.z + 1.0 + uP_bulge) * uP_scale;

  // the plane turns while the lattice drifts across it, so the crazing
  // migrates over the glaze instead of sitting welded to it
  float sw = uP_swirl; // integrated clock
  p = mat2(cos(sw), -sin(sw), sin(sw), cos(sw)) * p;
  p.x += uP_drift;     // integrated clock

  /*
    A fractional offset off the pattern origin. The listing carries the
    resolution here; it cancels out of the pole term exactly (see the
    header) but it does keep the lattice off centre, and without something
    in its place a cell corner sits pinned at the dead middle of the ball.
  */
  p += vec2(0.37, 0.21);

  // the cell the sample starts in, fixed before the warp — everything the
  // pole term does is relative to THIS corner, not to wherever c wanders
  vec2 cell = floor(p);

  /*
    Each cell knots on its own hashed phase, so the grid breathes instead
    of pulsing as one sheet. The rate is a constant, not a slider: this
    multiplies the integrated clock, and a slider there would jump the
    phase of every cell on a state change.
  */
  float breathe = 1.0 + uP_pulse * sin(TAU * hash(cell) + t * 0.35);

  vec2 c = p;
  for (int j = 0; j < OCTAVES; j++) {
    float i = float(j) + 1.0;

    /*
      The lattice pole, softened. d/(d*d+g) tracks 1/d away from the cell
      corner and rolls over to a finite peak at it, so the phase stays
      band-limited and the knot has a SIZE — uP_poleSoft is that size, and
      it is the difference between crisp cell knots and a corner full of
      aliased noise.
    */
    vec2 d = cell - c;
    vec2 pole = latticePole * breathe * d / (d * d + vec2(uP_poleSoft));

    c += uP_warp * cos(i * c.yx + pole + t) / i;
  }

  /*
    The listing's tone map: a thin ridge every PI with an exponential
    falloff. The per-channel offsets are kept as their original ratio
    (0, 2, 1) so one slider widens the whole split, and against a ridge
    this thin they separate the thread into three coloured filaments.
  */
  vec3 x = vec3(c.y) + vec3(0.0, 2.0, 1.0) * uP_split;
  vec3 thread = exp(-latticeSharp * abs(sin(x)));

  float lev = dot(thread, vec3(1.0 / 3.0));

  /*
    The exp() floor never reaches zero, so the shell is lit between the
    threads by construction — the body colour is added under it rather
    than filling a hole. The thread term stays PER-CHANNEL through the
    palette multiply; collapsing it to lev first would throw away the
    filament split, which is the only thing the vec4 phase was for.
  */
  vec3 col = uC_deep * uP_floor;
  /*
    The ramp between the two thread colours runs nearly the whole range of
    lev deliberately. Started at 0.35 it reached uC_hot — which is near-white in
    every state — across most of the visible web, and the state palettes,
    which ride on uC_line, never got to the eye at all.

    The other half of that fix is in the presets: the chromatic split makes
    the three channels independent, so at a wide split THREAD sets the hue
    and no palette can. It is staged with the rest — widest while
    searching, nearly closed while answering, which is when the warm
    palette has to carry.
  */
  col += thread * mix(uC_line, uC_hot, smoothstep(0.12, 1.0, lev)) * latticeGain;

  /*
    A tight second read of the same ridge, added on top: raising a value
    that is already exp(-k*|sin|) to a high power is the same ridge at a
    fraction of the width, which lands as a hot core inside each thread.
    Taken from lev — the MEAN of the three channels — deliberately, so the
    core is achromatic and lands only where all three filaments coincide.
    Read per-channel it would just be a fourth colour-separated ridge, and
    the web would stay a scatter of green and magenta flecks instead of
    resolving into white threads with coloured shoulders. Squared twice
    rather than pow() — pow is undefined for a negative base and this is
    cheaper anyway (see the README).
  */
  float core = lev * lev;
  core = core * core;
  col += uC_hot * core * uP_core;

  col = pow(max(col, vec3(0.0)), vec3(uP_contrast));

  // dome shading keeps the ball a ball under the web
  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.72))), 0.0, 1.0);
  col *= 0.35 + uP_light * lambert;

  // fresnel sheen: the glaze the threads are crazed into, and the thing
  // that keeps the limb reading as a surface where the cells have
  // compressed past resolving
  float fres = 1.0 - z;
  fres = fres * fres * fres;
  col += uC_sheen * uP_rim * fres;

  return col;
}

void main() {
  // Volume coupling: the user's voice tightens the knots, the agent's
  // thickens the threads and brightens them.
  latticePole = uP_pole * (1.0 + 0.8 * uInput);
  latticeSharp = uP_sharp * (1.0 - 0.25 * uOutput);
  latticeGain = uP_gain * (0.85 + 0.4 * uOutput);

  vec2 uv = orbUV();
  float mask = smoothstep(0.012, -0.012, length(uv) - max(uP_radius, 0.001));

  // Nothing outside the silhouette is ever visible, so skip AA * AA warps
  // for it rather than shading transparent sky.
  if (mask <= 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec3 col = vec3(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 off = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;
      col += latticeRender(gl_FragCoord.xy + off);
    }
  }
  col /= float(AA * AA);
#else
  col = latticeRender(gl_FragCoord.xy);
#endif

  // Surface orb bounded by a mask: alpha IS coverage, so premultiply — the
  // opposite convention from the emissive orbs (see shdr-31).
  float a = mask;
  gl_FragColor = vec4(max(col, vec3(0.0)) * a, a);
}
`;
var DEFAULTS = { speed: 0.4, swirl: 0.07, drift: 0.18, radius: 0.9, scale: 9, bulge: 0.25, warp: 0.85, pole: 0.25, poleSoft: 0.012, pulse: 0.35, sharp: 4.5, split: 0.045, core: 0.45, floor: 0.9, gain: 1, contrast: 1.35, light: 0.7, rim: 0.45 };
var VARIANTS = {
  id: "orb_shdr_26",
  frag: FRAG,
  defaults: DEFAULTS,
  clocks: ["speed", "swirl", "drift"],
  colors: { deep: "#111a2e", line: "#3fd2ff", hot: "#fff4d6", sheen: "#a9d8ff" },
  presets: {
    recording: {
      speed: 6.45,
      swirl: 0.555,
      drift: 1.74,
      scale: 11,
      bulge: 0.78,
      warp: 0.76,
      pole: 0.195,
      poleSoft: 0.001,
      pulse: 1.39,
      sharp: 2.1,
      split: 0.045,
      core: 1.08,
      floor: 0.48,
      gain: 1.3,
      contrast: 1.95
    },
    transcribing: {
      speed: 1,
      swirl: 0.3,
      drift: 0.51,
      pole: 0.18,
      pulse: 0.22,
      sharp: 3.6,
      split: 0.03,
      floor: 0.28,
      contrast: 1.6
    }
  }
};
function mount(container, api) {
  return mountOrb(container, api, VARIANTS);
}
export {
  mount
};
