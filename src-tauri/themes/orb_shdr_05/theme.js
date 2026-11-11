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

// src/theme-engine/builtin/orb_shdr_05/index.ts
var FRAG = `
#define AA 3

// Volume-reactive values, resolved once per fragment in main().
float causticSoft;
float causticGain;
float causticSpread;

/*
  Softened tangent. Equal to sin/cos wherever cos is not near zero, capped
  at 1/(2*sqrt(g)) where it is — see the header for why the raw pole cannot
  be supersampled away.
*/
vec2 tanSoft(vec2 x, float g) {
  vec2 s = sin(x);
  vec2 c = cos(x);
  return s * c / (c * c + g);
}

vec3 causticRender(vec2 fragCoord) {
  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  float R = max(uP_radius, 0.001);

  // the dome: the front hemisphere of a unit ball, in screen space
  vec2 pl = uv / R;
  float z = sqrt(max(1.0 - dot(pl, pl), 0.0));

  float ring = uP_ring; // integrated clock: the rings travel

  // stereographic wrap of the unrotated dome, as in shdr-08 — the lens
  // lattice compresses toward the limb the way a texture on a sphere does
  vec2 p = pl / (z + 1.0 + uP_bulge) * uP_scale;

  // projection-safe 2D motion: the lattice turns and slides
  float sw = uP_swirl; // integrated clock
  p = mat2(cos(sw), -sin(sw), sin(sw), cos(sw)) * p;
  p += vec2(uP_slide, uP_slide * 0.6); // integrated clock

  /*
    The lens lattice. Adding p back to its own tangent is what gives every
    cell a different view instead of tiling one image — see the header.
  */
  float L = length(tanSoft(p, causticSoft) * uP_lens + p);

  /*
    One cosine, three phases. The listing's (0, .7, 1) sit well under a
    radian apart, so the channels overlap through most of a band and only
    separate at its shoulders — white cores with coloured edges, not three
    independent rainbows.
  */
  vec3 col = cos(L * uP_freq - ring + vec3(0.0, 0.7, 1.0) * causticSpread);

  // the listing's clamp: half of every period is hard black, and that is
  // what makes these read as bands rather than as a gradient
  col = max(col, vec3(0.0)) * causticGain;

  col = pow(col, vec3(uP_contrast));

  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);
  col *= uC_tint;

  // a dark body under the bands, so the black half of the cosine reads as
  // the ball rather than as a hole in it
  col += uC_body * uP_floorLevel;

  // dome shading keeps the ball a ball under the lattice
  vec3 n = vec3(pl, z);
  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.72))), 0.0, 1.0);
  col *= 0.6 + uP_light * lambert;

  float fres = 1.0 - z;
  fres = fres * fres * fres;
  col += uC_sheen * uP_rim * fres;

  return col;
}

void main() {
  // Volume coupling: the user's voice lets the walls crowd tighter, the
  // agent's brightens the bands and opens the colour split.
  causticSoft = max(uP_poleSoft * (1.0 - 0.5 * uInput), 0.0008);
  causticGain = uP_gain * (0.85 + 0.45 * uOutput);
  causticSpread = uP_spread * (1.0 + 0.5 * uOutput);

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
      col += causticRender(gl_FragCoord.xy + off);
    }
  }
  col /= float(AA * AA);
#else
  col = causticRender(gl_FragCoord.xy);
#endif

  // Surface orb bounded by a mask: alpha IS coverage, so premultiply — the
  // opposite convention from the emissive orbs (see shdr-31).
  float a = mask;
  gl_FragColor = vec4(max(col, vec3(0.0)) * a, a);
}
`;
var DEFAULTS = { ring: 0.9, swirl: 0.05, slide: 0.12, radius: 0.9, scale: 5, bulge: 0.3, lens: 1, poleSoft: 0.02, freq: 1, spread: 1, gain: 1.1, contrast: 1, saturation: 1.15, floorLevel: 0.12, light: 0.4, rim: 0.45 };
var VARIANTS = {
  id: "orb_shdr_05",
  frag: FRAG,
  defaults: DEFAULTS,
  clocks: ["ring", "swirl", "slide"],
  colors: { tint: "#ffffff", body: "#141a30", sheen: "#bcd8ff" },
  presets: {
    idle: {
      ring: 0.9,
      swirl: 0.195,
      slide: 0.26,
      bulge: 0,
      lens: 0.38,
      poleSoft: 0.012,
      freq: 1.05,
      spread: 0.7,
      gain: 1.1,
      contrast: 1,
      saturation: 1.14,
      light: 0.66
    },
    recording: {
      ring: 1.4,
      swirl: 0.6,
      slide: 1,
      bulge: 0.96,
      lens: 1.2,
      poleSoft: 0.064,
      freq: 4.8,
      spread: 0.68,
      gain: 1.6,
      contrast: 0.75
    },
    transcribing: {
      ring: 3,
      swirl: 0.57,
      slide: 0.88,
      bulge: 0.36,
      lens: 1.28,
      poleSoft: 0.042,
      freq: 1.3,
      spread: 1.82,
      gain: 0.88,
      contrast: 3.2,
      saturation: 2.36,
      floorLevel: 0.4,
      rim: 0
    }
  }
};
function mount(container, api) {
  return mountOrb(container, api, VARIANTS);
}
export {
  mount
};
