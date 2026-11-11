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

// src/theme-engine/builtin/orb_shdr_19/index.ts
var FRAG = `
#define AA 2

// Volume-reactive values, resolved once per fragment in main().
float foamGrow;
float foamJitter;
float foamGain;

vec3 foamRender(vec2 fragCoord) {
  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  float R = max(uP_radius, 0.001);

  // the dome: the front hemisphere of a unit ball, in screen space
  vec2 pl = uv / R;
  float z = sqrt(max(1.0 - dot(pl, pl), 0.0));

  float t = uP_speed; // integrated clock

  // stereographic wrap of the unrotated dome, as in shdr-08
  vec2 p = pl / (z + 1.0 + uP_bulge) * uP_scale;

  // projection-safe 2D motion: the packing turns and drifts
  float sw = uP_swirl; // integrated clock
  p = mat2(cos(sw), -sin(sw), sin(sw), cos(sw)) * p;
  p += vec2(uP_slide, uP_slide * 0.7); // integrated clock

  vec2 cell = ceil(p);
  vec2 f = p - cell; // in (-1, 0], the fragment's place in its own cell

  /*
    The 3x3 walk, keyed on the ABSOLUTE cell index so a bead is one bead —
    see the header. Tracking the winner as well as the max costs nothing
    and is what makes the shading below possible.
  */
  float cover = 0.0;
  float bestRel = 1e9;
  vec2 bestDelta = vec2(0.0);
  float bestRad = 1.0;
  vec2 bestId = vec2(0.0);

  for (int gy = -1; gy <= 1; gy++) {
    for (int gx = -1; gx <= 1; gx++) {
      vec2 g = vec2(float(gx), float(gy));
      vec2 id = cell + g;

      /*
        The listing's generator: a dot of a cosine against a detuned,
        swizzled sine of the cell index, both carrying the clock. Mind the
        range — a dot of two 2-vectors of unit-bounded components spans
        FOUR, not two, so the listing's /6 puts radii within a third of a
        cell of the mean. Read it as half that and the largest discs
        overlap their neighbours, which is what turns a dot screen into a
        litter of merged blobs.
      */
      float rad = dot(cos(id - t), sin(id.yx * uP_skew + t)) * uP_vary + foamGrow;
      /*
        Fragment to feature point, and the signs matter more than they
        look. The disc labelled id sits at id + jitter in absolute
        coordinates, so delta = p - (id + jitter) = f - g - jitter. Write
        it as f + g and the disc's IDENTITY and its POSITION end up using
        opposite offsets: every fragment then draws disc id in a different
        place, and the field comes out as clumps of half-agreeing circles
        rather than circles.
      */
      vec2 jit = cos(id.yx + t) * foamJitter;
      vec2 delta = f - g - jit;
      float dist = length(delta);

      /*
        The union is taken over COVERAGE, not over the signed distance the
        listing maxes. Those differ exactly where two discs overlap: max of
        (radius - distance) hands the whole overlap to whichever disc wins
        and bites a straight edge out of the other, so the field comes out
        a litter of crescents and pinwheels. Max of the clamped coverage
        keeps every disc whole and merely lets overlapping ones merge.

        The x50 ramp is the listing's, and it is an edge width rather than
        a brightness: a signed distance scaled that hard and clamped is a
        hard-edged disc with about a pixel of feather.
      */
      cover = max(cover, clamp((rad - dist) * uP_edge, 0.0, 1.0));

      /*
        The winner is tracked separately, by RELATIVE depth rather than
        absolute — which disc this fragment is furthest inside, in units of
        that disc's own radius. Only the optional bead shading reads it,
        and relative depth is what keeps a small disc from being shaded as
        though it were the large one beside it.
      */
      float rel = dist / max(rad, 1e-4);
      if (rel < bestRel) {
        bestRel = rel;
        bestDelta = delta;
        bestRad = rad;
        bestId = id;
      }
    }
  }

  /*
    The bead. The winning cell's own distance and radius give the height of
    a hemisphere over the disc, and that is a normal — so the flat decal
    becomes a lit piece of glass without a second field being evaluated.
  */
  float rr = max(bestRad, 1e-4);
  float dome = clamp(1.0 - dot(bestDelta, bestDelta) / (rr * rr), 0.0, 1.0);
  vec3 bn = normalize(vec3(bestDelta / rr, sqrt(dome) + 0.001));

  vec3 key = normalize(vec3(-0.45, 0.55, 0.72));
  float beadLam = clamp(dot(bn, key), 0.0, 1.0);

  // per-disc colour, hashed on the cell index — near-flat at the defaults,
  // which is what keeps the field reading as a dot screen
  vec3 beadCol = mix(uC_low, uC_high, hash(bestId + 0.5));

  // uP_bead at 0 leaves the listing's flat disc, which is the default
  float shade = mix(1.0, 0.45 + 0.85 * beadLam, uP_bead);
  vec3 col = beadCol * shade * foamGain * cover;

  // a dark body under the packing, so the gaps read as the ball rather
  // than as holes in it
  col += uC_body * uP_floorLevel;

  col = pow(max(col, vec3(0.0)), vec3(uP_contrast));

  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);

  // dome shading keeps the ball a ball under the packing
  vec3 n = vec3(pl, z);
  float lambert = clamp(dot(n, key), 0.0, 1.0);
  col *= 0.55 + uP_light * lambert;

  float fres = 1.0 - z;
  fres = fres * fres * fres;
  col += uC_sheen * uP_rim * fres;

  return col;
}

void main() {
  // Volume coupling: the user's voice shakes the beads off their centres,
  // the agent's swells them and brightens the packing.
  foamGrow = uP_grow * (1.0 + 0.35 * uOutput);
  foamJitter = uP_jitter * (1.0 + 0.5 * uInput);
  foamGain = uP_gain * (0.85 + 0.4 * uOutput);

  vec2 uv = orbUV();
  float mask = smoothstep(0.012, -0.012, length(uv) - max(uP_radius, 0.001));

  if (mask <= 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec3 col = vec3(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 off = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;
      col += foamRender(gl_FragCoord.xy + off);
    }
  }
  col /= float(AA * AA);
#else
  col = foamRender(gl_FragCoord.xy);
#endif

  // Surface orb bounded by a mask: alpha IS coverage, so premultiply — the
  // opposite convention from the emissive orbs (see shdr-31).
  float a = mask;
  gl_FragColor = vec4(max(col, vec3(0.0)) * a, a);
}
`;
var DEFAULTS = { speed: 0.5, swirl: 0.05, slide: 0.1, radius: 0.9, scale: 10, bulge: 0.3, grow: 0.185, vary: 0.13, skew: 0.62, jitter: 0.1, edge: 50, bead: 0, gain: 1, contrast: 1, saturation: 1.1, floorLevel: 0.06, light: 0.3, rim: 0.35 };
var VARIANTS = {
  id: "orb_shdr_19",
  frag: FRAG,
  defaults: DEFAULTS,
  clocks: ["speed", "swirl", "slide"],
  colors: { low: "#ffffff", high: "#eef5ff", body: "#05070c", sheen: "#9dbfe4" },
  presets: {
    idle: {
      speed: 0.52,
      swirl: 0.045,
      slide: 0.1,
      bulge: 0.08,
      grow: 0.12,
      vary: 0.19,
      skew: 0.63,
      jitter: 0.74,
      edge: 51,
      gain: 2.28,
      contrast: 2.6,
      rim: 0.345
    },
    recording: {
      speed: 2.85,
      swirl: 0.585,
      slide: 0.55,
      bulge: 0.28,
      grow: 0.22,
      vary: 0.365,
      skew: 0,
      jitter: 0.17,
      edge: 141,
      gain: 1.35,
      contrast: 3.2,
      saturation: 2.04,
      floorLevel: 0
    },
    transcribing: {
      speed: 2.55,
      swirl: 0.57,
      slide: 0.84,
      bulge: 0.14,
      grow: 0.19,
      vary: 0.165,
      skew: 1.13,
      jitter: 0.37,
      gain: 1.04,
      contrast: 0.55,
      light: 0.585,
      rim: 0.24
    }
  }
};
function mount(container, api) {
  return mountOrb(container, api, VARIANTS);
}
export {
  mount
};
