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

// src/theme-engine/builtin/orb_shdr_12/index.ts
var FRAG = `
#define STEPS 96

// Per-fragment constants, resolved once in main().
vec3 lgCell;  // cell sizes: (stud pitch, brick height, stud pitch)
float lgGap;

// Brick-lookup results (GLSL ES 1.0 has no out-struct ergonomics).
vec3 lgBid;     // unique id of the owning brick
float lgOff;    // long-axis stagger offset of its course, in studs
float lgOrient; // 0: long axis runs along x, 1: along z

mat2 lgRot(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

/*
  Which 2x4 brick owns this stud cell? Layers alternate their long axis
  and every (layer, row) course staggers by a hashed offset — brickwork
  bonding, so vertical seams never stack.
*/
void lgBrick(vec3 cellIdx) {
  lgOrient = mod(cellIdx.y, 2.0);
  float lc = lgOrient < 0.5 ? cellIdx.x : cellIdx.z;
  float sc = lgOrient < 0.5 ? cellIdx.z : cellIdx.x;
  float srow = floor(sc / 2.0);
  lgOff = floor(hash(vec2(cellIdx.y * 3.17, srow * 7.31)) * 4.0);
  lgBid = vec3(floor((lc + lgOff) / 4.0), cellIdx.y, srow + lgOrient * 913.0);
}

/*
  The world function: inside the ball, minus bricks currently blinked out
  of the outer two courses. Interior cells answer with a single length —
  the brick lookup only runs in the shell.
*/
float lgSolid(vec3 cc) {
  float r = length(cc);
  if (r >= 1.0) return 0.0;
  if (r > 1.0 - 2.2 * lgCell.y) {
    lgBrick(floor(cc / lgCell));
    float blink = fract(hash(lgBid.xy * 0.173 + lgBid.z * 0.089) + uP_rebuild * 0.03);
    if (blink < lgGap) return 0.0; // this brick is off the build right now
  }
  return 1.0;
}

void main() {
  // Volume coupling: agent output stokes the sheen and the gain; user
  // input brightens the key light.
  float glossNow = uP_gloss * (0.7 + 0.9 * uOutput);
  float gainNow = uP_gain * (0.92 + 0.25 * uOutput);
  float lightNow = uP_light * (1.0 + 0.3 * uInput);

  float pitch = 2.0 / clamp(uP_studs, 8.0, 48.0);
  lgCell = vec3(pitch, pitch * 1.2, pitch); // real brick proportion
  lgGap = clamp(uP_gap, 0.0, 0.9);

  float bound = 1.0 + length(lgCell) * 0.5 + 0.001;

  vec2 uv = orbUV() / uP_radius;
  vec3 ro = vec3(uv * bound, 2.6);
  vec3 rd = vec3(0.0, 0.0, -1.0);

  // rotate the RAY into object space (inverse tumble) — the lattice stays
  // axis-aligned and the studs stay up while the ball turns. Light and
  // view rotate along, keeping the sun fixed relative to the viewer.
  mat2 tiltM = lgRot(uP_tilt); // positive tilt looks DOWN at the studs
  mat2 spinM = lgRot(-uP_spin); // integrated clock
  ro.yz = tiltM * ro.yz;
  ro.xz = spinM * ro.xz;
  rd.yz = tiltM * rd.yz;
  rd.xz = spinM * rd.xz;
  vec3 Lo = normalize(vec3(-0.5, 0.7, 0.55));
  Lo.yz = tiltM * Lo.yz;
  Lo.xz = spinM * Lo.xz;
  vec3 Vo = vec3(0.0, 0.0, 1.0);
  Vo.yz = tiltM * Vo.yz;
  Vo.xz = spinM * Vo.xz;

  // DDA needs nonzero direction components — nudge, keep the sign
  vec3 sgn = vec3(
    rd.x >= 0.0 ? 1.0 : -1.0,
    rd.y >= 0.0 ? 1.0 : -1.0,
    rd.z >= 0.0 ? 1.0 : -1.0
  );
  rd = normalize(sgn * max(abs(rd), vec3(1.0e-4)));

  // analytic bounding sphere: empty pixels exit here
  float b = dot(rd, ro);
  float c = dot(ro, ro) - bound * bound;
  float disc = b * b - c;
  if (disc < 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }
  float sq = sqrt(disc);
  vec3 p0 = ro + rd * (-b - sq + pitch * 0.001);
  float tSpan = 2.0 * sq;

  // Amanatides & Woo, anisotropic cells: per-axis sizes throughout
  vec3 vp = floor(p0 / lgCell);
  vec3 tDelta = lgCell / abs(rd);
  vec3 tMax = ((vp + step(vec3(0.0), rd)) * lgCell - p0) / rd;

  float hitF = 0.0;
  vec3 mask = vec3(0.0, 0.0, 1.0); // first-voxel fallback: face the viewer
  float tCur = 0.0;

  for (int i = 0; i < STEPS; i++) {
    if (lgSolid((vp + 0.5) * lgCell) > 0.5) {
      hitF = 1.0;
      break;
    }
    if (tMax.x < tMax.y && tMax.x < tMax.z) {
      tCur = tMax.x;
      tMax.x += tDelta.x;
      vp.x += sgn.x;
      mask = vec3(1.0, 0.0, 0.0);
    } else if (tMax.y < tMax.z) {
      tCur = tMax.y;
      tMax.y += tDelta.y;
      vp.y += sgn.y;
      mask = vec3(0.0, 1.0, 0.0);
    } else {
      tCur = tMax.z;
      tMax.z += tDelta.z;
      vp.z += sgn.z;
      mask = vec3(0.0, 0.0, 1.0);
    }
    if (tCur > tSpan) break; // left the bound: miss
  }

  if (hitF < 0.5) {
    gl_FragColor = vec4(0.0);
    return;
  }

  // the hit cell, its brick, and the struck face
  vec3 cc = (vp + 0.5) * lgCell;
  float r = length(cc);
  vec3 dir = cc / max(r, 1.0e-4);
  lgBrick(vp);
  vec3 n = -mask * sgn;
  vec3 hp = p0 + rd * tCur;

  /*
    Brick colour: a per-brick hash picks one of the five plastic colours.
    The patch parameter slides the pick toward a smooth field over the
    sphere, so 0 is per-brick confetti and 1 is big moulded colour
    regions; the field is range-stretched so all five colours appear.
  */
  float cph = hash(lgBid.xy * 1.37 + lgBid.z * 0.91);
  float rn = noise(dir.xy * 2.6 + 7.0) * 0.5 + noise(dir.yz * 2.6 + 13.0) * 0.5;
  rn = clamp(0.5 + (rn - 0.5) * 2.2, 0.0, 0.999);
  float idx = floor(clamp(mix(cph, rn, clamp(uP_patch, 0.0, 1.0)), 0.0, 0.999) * 5.0);
  vec3 albedo = idx < 0.5 ? uC_brickA
    : (idx < 1.5 ? uC_brickB
    : (idx < 2.5 ? uC_brickC
    : (idx < 3.5 ? uC_brickD : uC_brickE)));
  albedo *= 0.93 + 0.14 * hash(lgBid.xy * 0.53 + lgBid.z * 1.7); // mold variance

  /*
    Seams: distance to the nearest BRICK boundary along each lattice axis,
    from the continuous within-brick coordinates. Only the two axes
    tangent to the struck face draw — stud grid lines never do.
  */
  vec3 sp = hp / lgCell;
  float lcC = lgOrient < 0.5 ? sp.x : sp.z;
  float scC = lgOrient < 0.5 ? sp.z : sp.x;
  float u4 = fract((lcC + lgOff) / 4.0);
  float v2 = fract(scC / 2.0);
  float wY = fract(sp.y);
  float dL = min(u4, 1.0 - u4) * 4.0 * pitch;
  float dS = min(v2, 1.0 - v2) * 2.0 * pitch;
  float dY = min(wY, 1.0 - wY) * lgCell.y;
  float seamD;
  if (mask.y > 0.5) seamD = min(dL, dS);
  else if (mask.x > 0.5) seamD = min(dY, lgOrient < 0.5 ? dS : dL);
  else seamD = min(dY, lgOrient < 0.5 ? dL : dS);
  float seam = (1.0 - smoothstep(0.0, 0.07 * pitch, seamD)) * clamp(uP_seam, 0.0, 1.0);

  /*
    Studs, embossed the way the real brick photographs: the normal tilts
    hard around the stud shoulder so the light wraps it like a cylinder
    edge, the cap lifts, a contact shadow falls on the side facing away
    from the light, and a faint ring engraved into the cap stands in for
    the moulded logo.
  */
  vec3 nEff = n;
  float studF = 0.0;
  float shadowF = 0.0;
  float engrave = 0.0;
  float studAmt = clamp(uP_stud, 0.0, 1.0);
  if (mask.y > 0.5 && n.y > 0.5) {
    vec2 cuv = fract(hp.xz / pitch) - 0.5;
    float sd = length(cuv);
    float rim = smoothstep(0.14, 0.29, sd) * (1.0 - smoothstep(0.29, 0.335, sd));
    vec3 tiltN = normalize(vec3(cuv.x, 0.42, cuv.y));
    nEff = normalize(mix(n, tiltN, rim * studAmt));
    studF = 1.0 - smoothstep(0.285, 0.33, sd);
    vec2 lxz = normalize(Lo.xz + vec2(1.0e-5));
    float away = clamp(dot(normalize(cuv + vec2(1.0e-5)), -lxz), 0.0, 1.0);
    shadowF = smoothstep(0.47, 0.335, sd) * (1.0 - studF) * (0.35 + 0.65 * away);
    engrave = smoothstep(0.11, 0.135, sd) * (1.0 - smoothstep(0.155, 0.18, sd)) * studF;
  }

  // plastic shading: lambert + wrap for roundness + white Blinn sheen,
  // dimmed toward the interior so revealed under-bricks read as inside
  float lam = clamp(dot(nEff, Lo), 0.0, 1.0);
  float wrap = clamp(dot(dir, Lo) * 0.5 + 0.5, 0.0, 1.0);
  float depthDim = mix(1.0, 0.55, clamp((1.0 - r) / (3.0 * lgCell.y), 0.0, 1.0));
  float shade = (0.34 + 0.42 * wrap * wrap + 0.8 * lam * lightNow) * depthDim;

  vec3 col = albedo * shade * (1.0 + 0.1 * studF);
  col *= 1.0 - shadowF * 0.38 * studAmt; // stud contact shadow
  col *= 1.0 - engrave * 0.14 * studAmt; // moulded logo ring

  // chamfered edge: a thin bright bevel line just inside the dark joint,
  // catching the light the way the real brick's edges do
  float bevel = smoothstep(0.05 * pitch, 0.085 * pitch, seamD)
    * (1.0 - smoothstep(0.085 * pitch, 0.16 * pitch, seamD));
  col += albedo * bevel * (0.18 + 0.5 * lam) * clamp(uP_seam, 0.0, 1.0);
  col *= 1.0 - seam * 0.8; // dark joints

  // two-lobe plastic sheen: a sharp hotspot over a broad soft gloss
  float ndh = clamp(dot(nEff, normalize(Lo + Vo)), 0.0, 1.0);
  float spec = pow(ndh, 48.0) + 0.22 * pow(ndh, 8.0);
  col += vec3(1.0) * spec * glossNow * (1.0 - seam) * depthDim;

  col *= gainNow;
  col = pow(max(col, 0.0), vec3(uP_contrast));

  // Surface-lit orb bounded by the hit test: alpha IS coverage, and a hit
  // is fully opaque — premultiplied output, trivially (see shdr-28).
  gl_FragColor = vec4(col, 1.0);
}
`;
var DEFAULTS = { spin: 0.25, tilt: 0.55, rebuild: 0.4, gap: 0.07, studs: 18, radius: 0.95, patch: 0.35, stud: 0.85, seam: 0.6, gloss: 1, light: 1, gain: 1, contrast: 1 };
var VARIANTS = {
  id: "orb_shdr_12",
  frag: FRAG,
  defaults: DEFAULTS,
  clocks: ["spin", "rebuild"],
  colors: { brickA: "#c4281c", brickB: "#f2cd37", brickC: "#1e5aa8", brickD: "#00852b", brickE: "#f4f4f4" },
  presets: {
    idle: {
      spin: 0.25,
      rebuild: 0.4,
      gap: 0.07,
      gloss: 1,
      gain: 1,
      light: 1
    },
    recording: {
      spin: 1.6,
      tilt: 0.42,
      rebuild: 0.5,
      gap: 0,
      stud: 0.6,
      seam: 0.3,
      gloss: 2.4,
      gain: 1.25,
      light: 1.35,
      contrast: 0.95
    },
    transcribing: {
      spin: 0.03,
      tilt: 0.9,
      rebuild: 9,
      gap: 0.55,
      stud: 1,
      seam: 0.95,
      gloss: 0.55,
      gain: 1.05,
      light: 1.15,
      contrast: 1.05
    }
  }
};
function mount(container, api) {
  return mountOrb(container, api, VARIANTS);
}
export {
  mount
};
