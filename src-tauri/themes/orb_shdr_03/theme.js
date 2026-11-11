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

// src/theme-engine/builtin/orb_shdr_03/index.ts
var FRAG = `
#define STEPS 80
#define TURB 8
#define AA 1

// Volume-reactive values, resolved once per fragment in main().
float eclipticTurb;
float eclipticPlane;
float eclipticExposure;
float eclipticWidth;

vec3 eclipticRender(vec2 fragCoord) {
  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  vec3 ro = vec3(0.0, 0.0, uP_camDist);
  vec3 rd = normalize(vec3(uv, -uP_focal));

  float animTime = uP_speed; // integrated clock: the warp
  float wander = uP_wander;  // integrated clock: the belt's tilt

  vec3 acc = vec3(0.0);

  // transmittance carried front-to-back — the near belt veils the far one
  float T = 1.0;

  // march only the span the envelope can light, as in shdr-01
  float z = max(uP_camDist - uP_envRadius * 1.3, 0.0);
  float zEnd = uP_camDist + uP_envRadius * 1.3;

  /*
    The listing's feedback variable, explicit. On the first iteration the
    axis below reads this before anything has written it — zero is what the
    golfed version gets, so zero is what it gets here.
  */
  float d = 0.0;

  for (int it = 0; it < STEPS; it++) {
    vec3 p = ro + rd * z;

    /*
      The axis, steered by the PREVIOUS step's density: the belt's tilt
      settles as the ray closes on the surface and swings away from it out
      in the open. The three phases are far enough apart that the cosines
      can never null together, so the normalize is safe without a guard.
    */
    vec3 axis = normalize(cos(wander + vec3(4.0, 2.0, 0.0) - d * uP_feedback));

    // the exact minus-90-degree rotation about that axis
    vec3 a = dot(axis, p) * axis - cross(axis, p);

    // eight octaves of plain feedback warp — no lattice quantizer here,
    // unlike its cousins shdr-22 and shdr-04
    for (int j = 0; j < TURB; j++) {
      float f = float(j) + 2.0;
      a += eclipticTurb * sin(a * f + animTime).yzx / f;
    }

    /*
      Sphere plus plane. The shell reads the RAW point so the ball stays a
      ball; the plane reads the WARPED one so the belt writhes across it.
      uP_plane at zero drops the belt and lights the whole shell, which is
      worth being able to see once.
    */
    d = uP_shellW * abs(length(p) - uP_shellR) + eclipticPlane * abs(a.y);
    d = max(d, eclipticWidth);

    /*
      Hue from the DENSITY — the belt contoured in rainbow along its own
      distance field — and the listing's z in the numerator, which burns
      the far limb hotter than the near one.
    */
    vec3 w = cos(d * uP_hue + vec3(0.0, 2.0, 4.0) * uP_spread) + 1.0;
    w *= z / d;
    w = min(w, vec3(uP_stepClamp));

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
  /*
    The SURGE: tightness and warp swept together on one phase, so the belt
    gathers into a hard warped girdle and then opens back into a smooth
    shell. Two params, one gesture — swept apart they read as two unrelated
    things happening at once.

    Absolute bounds rather than a swing around what was dialled, so the range
    is exactly the range: tightness 0.1 to 0.3, warp 0.5 to 1.6. That is why
    the mix sits OUTSIDE the volume terms below — folding the surge under
    them would shave the top of both ranges by whatever the agent happened to
    be doing. At surge zero those terms are all that is left, so a state that
    does not ask for this is untouched.
  */
  float surge = 0.5 - 0.5 * cos(uAnim * 4.0);

  eclipticTurb = mix(uP_turb * (1.0 + 0.4 * uInput), mix(0.5, 1.6, surge), uP_surge);
  // the belt broadens toward a full shell while the agent speaks
  eclipticPlane = mix(uP_plane * (1.0 - 0.35 * uOutput), mix(0.1, 0.3, surge), uP_surge);
  eclipticExposure = uP_exposure * (1.0 - 0.3 * uOutput);

  /*
    The belt BREATHES. At pulse zero the width is exactly what was dialled,
    so a state that does not ask for this is untouched; at one it sweeps the
    whole way from nothing to that width and back, once every few seconds.

    It cannot truly reach zero. Belt width is the march's step floor — see
    the port note above — and a zero step stalls the ray on one point, which
    with no scatter to close the transmittance accumulates the clamp eighty
    times into a white flare. The floor is the param's own minimum, four
    times finer than what the resting belt uses, so it reads as gone.

    Off uAnim rather than a raw clock, so the breath quickens with the agent
    like every other motion in the engine.
  */
  eclipticWidth = max(uP_width * (1.0 - uP_pulse * (0.5 + 0.5 * cos(uAnim * 3.0))), 5e-4);

  vec3 acc = vec3(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 offset = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;
      acc += eclipticRender(gl_FragCoord.xy + offset);
    }
  }
  acc /= float(AA * AA);
#else
  acc = eclipticRender(gl_FragCoord.xy);
#endif

  // tanh tone map per channel — the envelope and transmittance change the
  // accumulator's scale, so the golfed /1e4 knee is a tunable here
  vec3 col = tanh3(acc / max(eclipticExposure, 1.0));
  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));

  // saturation about luminance, then the tint
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);
  col *= uC_tint;

  // alpha from the brightest channel, not luminance — a deep blue contour
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
var DEFAULTS = { speed: 0.6, wander: 0.3, feedback: 1.5, camDist: 5, focal: 1.05, shellR: 3, shellW: 0.12, plane: 0.15, turb: 0.55, width: 0.004, pulse: 0, surge: 0, hue: 25, spread: 1, envRadius: 3.3, envCore: 0.92, fill: 0.1, stepClamp: 1500, scatter: 0.0006, exposure: 1500, contrast: 1.2, saturation: 1.25, alphaGain: 2, edge: 1, edgeFade: 0.98 };
var VARIANTS = {
  id: "orb_shdr_03",
  frag: FRAG,
  defaults: DEFAULTS,
  clocks: ["speed", "wander"],
  colors: { tint: "#ffffff" },
  presets: {
    idle: {
      speed: 0.6,
      wander: 0.3,
      feedback: 2,
      shellR: 2,
      shellW: 0.085,
      plane: 0.085,
      turb: 1.54,
      width: 0.001,
      hue: 39.8,
      spread: 0.94,
      envCore: 1.02,
      stepClamp: 1475,
      exposure: 1450,
      scatter: 0.0006,
      alphaGain: 2
    },
    recording: {
      speed: 0.9,
      wander: 0.84,
      feedback: 0.3,
      shellR: 1.8,
      shellW: 0.19,
      plane: 0.1,
      turb: 0.14,
      width: 0.018,
      surge: 1,
      spread: 1.04,
      envRadius: 3.4,
      exposure: 650,
      scatter: 0.0003,
      alphaGain: 2.7
    },
    transcribing: {
      speed: 2,
      wander: 1.1,
      feedback: 7.5,
      focal: 1.9,
      shellR: 1.9,
      shellW: 0.005,
      plane: 0.345,
      turb: 0.7,
      width: 0.048,
      pulse: 1,
      hue: 28.3,
      spread: 1.02,
      envRadius: 7.4,
      envCore: 0.84,
      exposure: 2300,
      scatter: 0,
      alphaGain: 2
    }
  }
};
function mount(container, api) {
  return mountOrb(container, api, VARIANTS);
}
export {
  mount
};
