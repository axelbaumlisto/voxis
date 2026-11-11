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

// src/theme-engine/builtin/orb_shdr_08/index.ts
var FRAG = `
#define OCTAVES 10
#define AA 2

const float TAU = 6.28318530718;

// The listing's +r, minus the resolution dependence (see the header).
const vec2 SEED = vec2(4.7, 2.3);

// Volume-reactive values, resolved once per fragment in main().
float nacreWarp;
float nacreThick;
float nacreGain;

/*
  The listing's entire tone map: o = tanh(.2 / tan(x)); o *= o.

  The square folds the sign, so abs() on the denominator is not an
  approximation here — it is exact, and it removes the branch.
*/
vec3 cotBands(vec3 x, float k) {
  vec3 b = tanh3(k * cos(x) / max(abs(sin(x)), vec3(1e-4)));
  return b * b;
}

vec3 nacreRender(vec2 fragCoord) {
  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  float R = max(uP_radius, 0.001);

  // the dome: the front hemisphere of a unit ball, in screen space
  vec2 pl = uv / R;
  float z = sqrt(max(1.0 - dot(pl, pl), 0.0));
  vec3 n = vec3(pl, z);

  float t = uP_speed; // integrated clock: the boil

  /*
    Stereographic projection, on the UNROTATED dome. Equal steps in screen
    space map to ever-larger steps in pattern space toward the rim, which
    is the foreshortening that sells a flat field as wrapped geometry.
    uP_bulge softens the divisor — higher flattens the shell back toward a
    disc, lower crowds the layers into the limb.
  */
  vec2 p = n.xy / (n.z + 1.0 + uP_bulge) * uP_scale;

  // projection-safe 2D motion, in place of a dome spin: the plane turns,
  // and the bands travel across themselves
  float sw = uP_swirl; // integrated clock
  p = mat2(cos(sw), -sin(sw), sin(sw), cos(sw)) * p;
  p.y -= uP_flow;      // integrated clock

  /*
    The ten-octave feedback warp. q is fed back into itself with the
    components swapped, so each octave curls what the last one drew.
  */
  vec2 q = p;
  for (int j = 0; j < OCTAVES; j++) {
    float i = float(j) + 1.0;
    q += nacreWarp * sin(q.yx * i + i * i + t * i + SEED) / i;
  }

  // the bands, with the listing's uneven per-channel phase kept as a ratio
  // so one slider widens the whole split
  vec3 band = cotBands(vec3(q.y) + vec3(0.0, 1.0, 3.0) * uP_split, nacreThick);
  float lev = dot(band, vec3(1.0 / 3.0));

  /*
    A dark body colour under the bands, so the valleys read as the shell
    itself rather than as holes punched through the ball. The band term
    stays PER-CHANNEL through the palette multiply — that is what carries
    the colour fringing; collapsing it to lev first would throw away the
    only thing the vec4 phase was for.
  */
  vec3 col = uC_deep * uP_floor;
  col += band * mix(uC_low, uC_crest, smoothstep(0.1, 0.9, lev)) * nacreGain;

  /*
    Thin-film interference. The cosine palette is keyed to the band
    coordinate, so every layer carries its own hue — the inside of a shell
    — and uP_view rotates that hue with the viewing angle through 1 - z,
    which means the sphere's curvature is doing the colouring. Multiplied
    in rather than mixed to, so it bends hues without erasing the palette.
  */
  vec3 irid = 0.5 + 0.5 * cos(TAU * (q.y * uP_irisScale + (1.0 - z) * uP_view + t * 0.03 + vec3(0.0, 0.33, 0.67)));
  col = mix(col, col * (0.25 + 1.9 * irid), uP_iris);

  col = pow(max(col, vec3(0.0)), vec3(uP_contrast));

  // dome shading keeps the ball a ball under the pattern
  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.72))), 0.0, 1.0);
  col *= 0.35 + uP_light * lambert;

  // fresnel sheen: the wet gloss of a shell, and the thing that keeps the
  // limb reading as a surface where the bands have compressed to a blur
  float fres = 1.0 - z;
  fres = fres * fres * fres;
  col += uC_sheen * uP_rim * fres;

  return col;
}

void main() {
  /*
    The BEAT: warp driven between 0.6 and 1.8 on a slow, unbroken cycle —
    one full swing every second and a third — with nothing held at either
    end. Warp is the amplitude of the octave loop that folds the bands, so
    sweeping it three to one makes the whole field draw in and open again
    rather than change colour or brightness — a swell, not a flash.

    Absolute bounds, so the range is exactly the range; that is why the mix
    sits outside the volume term below. At beat zero nothing here applies
    and the dialled warp stands, so a state that does not ask for it is
    untouched.

    Well under 3Hz, which matters: above that a full-field oscillation is
    in the band photosensitivity guidance warns about, and this one covers
    the whole ball. The rate is the constant below — raising it much past
    18 walks back into that range.
  */
  float beat = 0.5 - 0.5 * cos(uAnim * 5.0);

  // Volume coupling: the user's voice churns the warp harder, the agent's
  // widens the crests and brightens them.
  nacreWarp = mix(uP_warp * (1.0 + 0.45 * uInput), mix(0.6, 1.8, beat), uP_beat);
  nacreThick = uP_thick * (1.0 + 0.6 * uOutput);
  nacreGain = uP_gain * (0.85 + 0.4 * uOutput);

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
      col += nacreRender(gl_FragCoord.xy + off);
    }
  }
  col /= float(AA * AA);
#else
  col = nacreRender(gl_FragCoord.xy);
#endif

  // Surface orb bounded by a mask: alpha IS coverage, so premultiply — the
  // opposite convention from the emissive orbs (see shdr-31).
  float a = mask;
  gl_FragColor = vec4(max(col, vec3(0.0)) * a, a);
}
`;
var DEFAULTS = { speed: 0.35, flow: 0.25, swirl: 0.06, radius: 0.9, scale: 5.5, bulge: 0.3, warp: 1, beat: 0, thick: 0.2, split: 0.1, iris: 0.7, irisScale: 0.315, view: 1.34, floor: 0.8, gain: 1.1, contrast: 1.15, light: 0.75, rim: 0.5 };
var VARIANTS = {
  id: "orb_shdr_08",
  frag: FRAG,
  defaults: DEFAULTS,
  clocks: ["speed", "flow", "swirl"],
  colors: { deep: "#0d1430", low: "#2fb8c6", crest: "#fff1de", sheen: "#bfe4ff" },
  presets: {
    idle: {
      speed: 0.37,
      flow: 0.24,
      swirl: 0.06,
      bulge: 0.8,
      warp: 0.96,
      thick: 0.54,
      split: 0.1,
      iris: 1.02,
      floor: 0.57,
      gain: 2.45,
      contrast: 1.65,
      rim: 0.495
    },
    recording: {
      speed: 2,
      flow: 2.49,
      swirl: 0.18,
      warp: 1.84,
      beat: 1,
      thick: 0.27,
      split: 0.3,
      iris: 0.45,
      gain: 1.75,
      contrast: 0.78
    },
    transcribing: {
      speed: 1.61,
      flow: 0.06,
      swirl: 0.015,
      warp: 1.56,
      thick: 0.54,
      split: 0.3,
      iris: 1.89,
      irisScale: 0.26,
      view: 1.21,
      floor: 0.77,
      gain: 0.85,
      contrast: 1.65,
      rim: 0.495
    }
  }
};
function mount(container, api) {
  return mountOrb(container, api, VARIANTS);
}
export {
  mount
};
