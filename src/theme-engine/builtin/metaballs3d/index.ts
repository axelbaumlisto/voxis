// metaballs3d — self-contained 3D raymarched metaballs visualizer.
// WebGL fragment shader: spheres blended via smooth-min (smin), sphere-traced
// raymarch, energy-conserving Blinn shading. Audio-reactive. Zero runtime deps.
// Public API: mount(container, api) -> { unmount() }. Same state stream as the
// 2D metaballs visualizer.
//
// Origin: adapted from a Shadertoy-style raymarched metaballs shader, ported to
// the host-agnostic mount(container, api) -> { unmount() } contract.
//
// Self-contained: `import type` only — the bundled theme.js must have 0 runtime
// imports so it works verbatim when copied into the user themes folder.
import type { ThemeApi, ThemeInstance, ThemeState } from "../../contract";

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

// uResolution: viewport px. uTime: seconds. uLevel: 0..1 audio loudness.
// uColorMode: 0 normal palette, 1 error (red).
const FRAG = `
precision highp float;

uniform vec2  uResolution;
uniform float uPhase;       // CPU-accumulated orbit phase (replaces spd*t)
uniform float uLevel;
uniform float uColorMode;

// S2 tunables (set once at mount from api.params; defaults == current look)
uniform float uShine;       // highlight tightness (default 28)
uniform float uSpecW;       // overall specular weight (default 0.6)
uniform float uSaturation;  // chroma boost factor (default 1.45)
uniform float uZoom;        // scene scale / framing (default 1.7)
uniform vec3  uCol1;        // sphere colors (defaults #e63333,#1a1ae6,#33e633,#e6e60d)
uniform vec3  uCol2;
uniform vec3  uCol3;
uniform vec3  uCol4;

const int   MAX_ITERS = 80;
const float EPSILON   = 1e-2;

float saturate(float x) { return clamp(x, 0.0, 1.0); }

float sphereImplicit(vec3 pt, float radius, vec3 position) {
  return length(pt - position) - radius;
}

// polynomial smooth-min: blends two SDFs into one gooey surface (blendRadius = neck width)
float smin(float a, float b, float blendRadius) {
  float c = saturate(0.5 + (b - a) * (0.5 / blendRadius));
  return mix(b, a, c) - blendRadius * c * (1.0 - c);
}

// combined gooey field — single source of truth for the surface (marching loop,
// rim gradient and rim projection all sample this same function)
float fieldAt(vec3 p, float rad, vec3 c1, vec3 c2, vec3 c3, vec3 c4) {
  return smin(smin(smin(
      sphereImplicit(p, rad, c1),
      sphereImplicit(p, rad, c2), 1.3),
      sphereImplicit(p, rad, c3), 1.2),
      sphereImplicit(p, rad, c4), 1.25);
}

// Renders one ray for a given pixel coordinate. Returns straight-alpha RGBA:
// vec4(0) outside the silhouette (transparent), vec4(rgb,1) on a surface hit.
// Called 4x by main() with jittered offsets for edge anti-aliasing (MSAA).
vec4 render(vec2 fragCoord) {
  vec2 uv = fragCoord / uResolution.xy;
  // square aspect-correct ray through the scene
  float aspect = uResolution.x / uResolution.y;
  vec2 p = (uv - 0.5);
  p.x *= aspect;

  // pull the scene back so the spread-out mass fits with margin
  vec3 rayDir = normalize(vec3(p * uZoom, 1.0));
  vec3 iterPos = vec3(p * uZoom, 1.0);

  // audio drives sphere radius (louder = bigger). Orbit motion is driven by
  // uPhase, which is integrated on the CPU so a change in speed never causes a
  // phase jump (the classic sin(spd*t) jerk). Same per-sphere frequency ratios.
  // strong voice PULSE: radius swells clearly on loud transients. At uLevel~0.9
  // the cluster noticeably throbs but the wider zoom keeps it from clipping the
  // frame or merging into a featureless ball.
  float rad = 0.5 + 0.55 * uLevel;      // sphere radius pulses with level

  // orbits with enough spread that lobes stay distinct (gooey morph, saturated
  // color regions) but the cluster stays centered on (0,0,5)
  vec3 c1 = vec3( 0.95*sin(uPhase),     -1.25*sin(uPhase),     5.0);
  vec3 c2 = vec3(-0.90*cos(uPhase),      1.20*sin(uPhase),     5.0);
  vec3 c3 = vec3( 1.05*cos(uPhase),     -1.00*cos(uPhase),     5.0);
  vec3 c4 = vec3( 1.30*cos(1.2*uPhase),  1.30*cos(1.4*uPhase), 5.0);

  vec3 color  = vec3(0.0);
  vec3 normal = vec3(0.0, 1.0, 0.0);
  bool hit = false;
  // Track the closest approach to the surface. Near-misses get a partial,
  // continuous coverage alpha instead of a binary miss — this kills the
  // frame-to-frame edge flicker (rays at grazing angles used to pop between
  // hit and miss) and feathers the silhouette naturally.
  float minD = 1e9;
  vec3  minPos = iterPos;

  for (int i = 0; i < MAX_ITERS; i++) {
    float d = fieldAt(iterPos, rad, c1, c2, c3, c4);
    if (d < minD) { minD = d; minPos = iterPos; }
    if (d < EPSILON) {
      // field-weighted blend of per-sphere normals + colors (gooey surface)
      float d1 = abs(1.0/(EPSILON + sphereImplicit(iterPos, rad, c1)));
      float d2 = abs(1.0/(EPSILON + sphereImplicit(iterPos, rad, c2)));
      float d3 = abs(1.0/(EPSILON + sphereImplicit(iterPos, rad, c3)));
      float d4 = abs(1.0/(EPSILON + sphereImplicit(iterPos, rad, c4)));
      float s = d1 + d2 + d3 + d4;
      float i1 = d1/s, i2 = d2/s, i3 = d3/s, i4 = d4/s;

      vec3 n1 = normalize(iterPos - c1);
      vec3 n2 = normalize(iterPos - c2);
      vec3 n3 = normalize(iterPos - c3);
      vec3 n4 = normalize(iterPos - c4);

      normal = normalize(i1*n1 + i2*n2 + i3*n3 + i4*n4);
      color  = i1*uCol1 + i2*uCol2 + i3*uCol3 + i4*uCol4;
      hit = true;
      break;
    }
    iterPos += d * rayDir;
  }

  // Soft silhouette: a near-miss within ~1.5px of the surface contributes a
  // feathered, continuous alpha (shaded at the closest-approach point) instead
  // of a hard transparent cutoff. edgeW scales with distance and resolution so
  // the feather stays ~1.5 screen pixels at any size.
  float edgeAlpha = 1.0;
  if (!hit) {
    float edgeW = length(minPos) * uZoom * 1.5 / uResolution.y;
    if (minD > edgeW) return vec4(0.0, 0.0, 0.0, 0.0); // truly outside
    edgeAlpha = 1.0 - smoothstep(0.0, edgeW, minD);
    // Project the closest-approach point ONTO the surface along the field
    // gradient and shade THERE. Shading at raw minPos (off-surface) made the
    // rim color weights jump frame-to-frame (перелив дёргался): minPos slides
    // along the ray as the lobes move. The projected surface point matches the
    // color an adjacent hitting ray produces, so the rim blends seamlessly.
    vec2 e = vec2(0.02, -0.02);
    vec3 grad = normalize(
        e.xyy * fieldAt(minPos + e.xyy, rad, c1, c2, c3, c4) +
        e.yyx * fieldAt(minPos + e.yyx, rad, c1, c2, c3, c4) +
        e.yxy * fieldAt(minPos + e.yxy, rad, c1, c2, c3, c4) +
        e.xxx * fieldAt(minPos + e.xxx, rad, c1, c2, c3, c4));
    iterPos = minPos - grad * minD;
    float d1 = abs(1.0/(EPSILON + sphereImplicit(iterPos, rad, c1)));
    float d2 = abs(1.0/(EPSILON + sphereImplicit(iterPos, rad, c2)));
    float d3 = abs(1.0/(EPSILON + sphereImplicit(iterPos, rad, c3)));
    float d4 = abs(1.0/(EPSILON + sphereImplicit(iterPos, rad, c4)));
    float s = d1 + d2 + d3 + d4;
    float i1 = d1/s, i2 = d2/s, i3 = d3/s, i4 = d4/s;
    normal = normalize(i1*normalize(iterPos - c1) + i2*normalize(iterPos - c2)
                     + i3*normalize(iterPos - c3) + i4*normalize(iterPos - c4));
    color  = i1*uCol1 + i2*uCol2 + i3*uCol3 + i4*uCol4;
  }

  // error mode -> saturated red surface
  if (uColorMode > 0.5) color = vec3(0.9, 0.08, 0.08);

  vec3 L1 = vec3( 10.0, -10.0, -10.0);
  vec3 L2 = vec3(  0.0,   0.0, -10.0);
  vec3 L3 = vec3(-10.0,  10.0, -10.0);
  vec3 lightCol = vec3(0.5);

  vec3 l1 = normalize(L1 - iterPos);
  vec3 l2 = normalize(L2 - iterPos);
  vec3 l3 = normalize(L3 - iterPos);
  vec3 v  = -normalize(iterPos);
  vec3 h1 = normalize(l1 + v);
  vec3 h2 = normalize(l2 + v);
  vec3 h3 = normalize(l3 + v);
  float spec = (8.0 * uShine) / (8.0 * 3.14159265);

  // diffuse clamped (no negative light leaking) + Blinn specular per light.
  // The 0.30 ambient floor keeps grazing-angle pixels colored — without it the
  // silhouette rim went almost black (diffuse ~ 0 at the edge), reading as an
  // unnatural dark outline around the blob.
  vec3 lit = vec3(0.30) + lightCol * (
      max(dot(normal, l1), 0.0) + uSpecW*spec*pow(max(dot(normal, h1), 0.0), uShine) +
      max(dot(normal, l2), 0.0) + uSpecW*spec*pow(max(dot(normal, h2), 0.0), uShine) +
      max(dot(normal, l3), 0.0) + uSpecW*spec*pow(max(dot(normal, h3), 0.0), uShine)
  );

  // boost saturation so lobes read as vivid color regions, not washed pastel
  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  color = clamp(lum + (color - lum) * uSaturation, 0.0, 1.0);

  vec3 outc = lit * color;
  // subtle voice GLOW: lift brightness on loud moments so the pulse also reads
  // as "alive" (capped at +25% so it never blows out to white). RGB only, alpha
  // stays 1.0; the miss path above already returns a fully transparent pixel.
  outc *= (1.0 + 0.25 * uLevel);
  // LUMINANCE-based Reinhard tonemap: compress only the brightness, preserve
  // chroma. Per-channel Reinhard (outc/(1+outc)) crushes the brightest channel
  // hardest and desaturates toward grey (washed-out pastel). Instead tonemap the
  // luminance and scale the color by the ratio, so highlights roll off smoothly
  // (no milky blowout) WHILE the hue stays saturated and juicy.
  outc *= 1.6;
  float L = dot(outc, vec3(0.299, 0.587, 0.114));
  float Lt = L / (1.0 + L);
  outc *= (L > 1e-4) ? (Lt / L) : 1.0;
  // re-saturate post-tonemap so the lobes read as vivid color regions, not
  // washed pastel (tonemapping always pulls a little chroma).
  float lum2 = dot(outc, vec3(0.299, 0.587, 0.114));
  outc = clamp(lum2 + (outc - lum2) * 1.25, 0.0, 1.0);
  // gamma-2.2 encode for cleaner gradients
  outc = pow(clamp(outc, 0.0, 1.0), vec3(1.0/2.2));
  return vec4(outc, edgeAlpha);
}

void main() {
  // 4x MSAA: average straight-alpha RGBA over a rotated-grid of sub-pixel rays.
  // This anti-aliases both the outer silhouette (alpha feathers over ~1px) and
  // the color at the rim. Interior stays alpha=1, well-outside stays alpha=0.
  // Accumulate PREMULTIPLIED (rgb*a) then divide by total alpha. Averaging
  // straight-alpha rgb and dividing by mean alpha over-brightens partial-alpha
  // rim samples (rgb/0.5 = 2x brightness -> white halo around the silhouette).
  vec3  rgbAcc = vec3(0.0);
  float aAcc   = 0.0;
  vec4 s;
  s = render(gl_FragCoord.xy + vec2(-0.125, -0.375)); rgbAcc += s.rgb * s.a; aAcc += s.a;
  s = render(gl_FragCoord.xy + vec2( 0.375, -0.125)); rgbAcc += s.rgb * s.a; aAcc += s.a;
  s = render(gl_FragCoord.xy + vec2(-0.375,  0.125)); rgbAcc += s.rgb * s.a; aAcc += s.a;
  s = render(gl_FragCoord.xy + vec2( 0.125,  0.375)); rgbAcc += s.rgb * s.a; aAcc += s.a;
  vec3 outRgb = (aAcc > 0.0) ? rgbAcc / aAcc : vec3(0.0);
  gl_FragColor = vec4(outRgb, aAcc * 0.25);
}
`;

// --- S2 param helpers --------------------------------------------------------
// Default sphere colors as exact float triples (NOT re-parsed from hex, so the
// defaults stay byte-identical to the original constants — 0.9 != 0xe6/255).
const DEFAULT_COLORS: number[][] = [
  [0.9, 0.2, 0.2],   // #e63333
  [0.1, 0.1, 0.9],   // #1a1ae6
  [0.2, 0.9, 0.2],   // #33e633
  [0.9, 0.9, 0.05],  // #e6e60d
];

function numOr(v: unknown, def: number, lo: number, hi: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(lo, Math.min(hi, n));
}

// "#rgb" / "#rrggbb" (with or without leading #) -> [r,g,b] in 0..1, or null.
function hexToRgb(hex: unknown): number[] | null {
  if (typeof hex !== "string") return null;
  let s = hex.trim().replace(/^#/, "");
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  if (s.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return [
    parseInt(s.slice(0, 2), 16) / 255,
    parseInt(s.slice(2, 4), 16) / 255,
    parseInt(s.slice(4, 6), 16) / 255,
  ];
}

// Validate a colors param: must be a 4-length array of valid hex; else defaults.
function resolveColors(colors: unknown): number[][] {
  if (!Array.isArray(colors) || colors.length !== 4) return DEFAULT_COLORS;
  const out = colors.map(hexToRgb);
  if (out.some((c) => c === null)) return DEFAULT_COLORS;
  return out as number[][];
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type) as WebGLShader;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error("metaballs3d shader compile failed: " + log);
  }
  return sh;
}

/**
 * Mount a 3D raymarched metaballs visualizer. Same contract as metaballs.
 */
export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  const W = api.size.width;
  const H = api.size.height;
  // Supersample at a fixed 2x regardless of devicePixelRatio. On non-HiDPI
  // displays (dpr=1, e.g. a 4K monitor in 1:1 mode) the pill canvas is only
  // ~320x108 — the in-shader MSAA feather is ~1px and the silhouette shows a
  // visible pixel staircase. Rendering 2x and letting the compositor downscale
  // gives real edge anti-aliasing; the canvas is tiny so the cost is trivial.
  // On Retina (dpr=2) this is the same resolution as before.
  const renderScale = 2;

  const canvas = document.createElement("canvas");
  canvas.width = W * renderScale;
  canvas.height = H * renderScale;
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  container.appendChild(canvas);

  // Graceful fallback: embeddable components must never throw and crash the host.
  // On any unrecoverable WebGL failure, remove the canvas, warn once, and return
  // a valid no-op instance so callers can still call unmount() safely.
  function bail(reason: string): ThemeInstance {
    console.warn("metaballs3d: WebGL unavailable, skipping", reason);
    canvas.remove();
    return { unmount() {} };
  }

  const gl = canvas.getContext("webgl", { premultipliedAlpha: false, alpha: true }) as
    | WebGLRenderingContext
    | null;
  if (!gl) {
    return bail("getContext('webgl') returned null");
  }

  const prog = gl.createProgram() as WebGLProgram;
  let vs!: WebGLShader, fs!: WebGLShader;
  try {
    vs = compile(gl, gl.VERTEX_SHADER, VERT);
    fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  } catch (e) {
    return bail(e instanceof Error ? e.message : String(e));
  }
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    return bail("program link failed: " + log);
  }
  gl.useProgram(prog);

  // fullscreen triangle pair
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(prog, "uResolution");
  const uPhase = gl.getUniformLocation(prog, "uPhase");
  const uLevel = gl.getUniformLocation(prog, "uLevel");
  const uColorMode = gl.getUniformLocation(prog, "uColorMode");

  // S2: read api.params with defensive defaults (defaults == current look) and
  // set the static tunables once — they don't change per frame.
  const params = (api.params && typeof api.params === "object" ? api.params : {}) as Record<string, unknown>;
  const shine = numOr(params.shine, 28.0, 1.0, 400.0);
  const specW = numOr(params.specWeight, 0.6, 0.0, 2.0);
  const saturation = numOr(params.saturation, 1.7, 0.0, 3.0);
  const speed = numOr(params.speed, 1.0, 0.0, 5.0);
  const zoom = numOr(params.zoom, 1.7, 0.5, 4.0);
  const cols = resolveColors(params.colors);

  gl.uniform1f(gl.getUniformLocation(prog, "uShine"), shine);
  gl.uniform1f(gl.getUniformLocation(prog, "uSpecW"), specW);
  gl.uniform1f(gl.getUniformLocation(prog, "uSaturation"), saturation);
  gl.uniform1f(gl.getUniformLocation(prog, "uZoom"), zoom);
  gl.uniform3f(gl.getUniformLocation(prog, "uCol1"), cols[0][0], cols[0][1], cols[0][2]);
  gl.uniform3f(gl.getUniformLocation(prog, "uCol2"), cols[1][0], cols[1][1], cols[1][2]);
  gl.uniform3f(gl.getUniformLocation(prog, "uCol3"), cols[2][0], cols[2][1], cols[2][2]);
  gl.uniform3f(gl.getUniformLocation(prog, "uCol4"), cols[3][0], cols[3][1], cols[3][2]);

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.uniform2f(uRes, canvas.width, canvas.height);

  let mode = "idle";
  let level = 0;
  let smoothLevel = 0;
  // Orbit phase integrated on the CPU each frame. Decoupling phase from
  // (speed * uTime) means a change in speed alters the RATE only, never the
  // absolute phase — so audio-driven speed changes can't teleport the blobs.
  let phase = 0;
  let prevNow = performance.now();
  const start = prevNow;
  let raf = 0;
  let running = true;

  const unsubscribe = api.onState((s: ThemeState) => {
    mode = s.mode;
    level = Number.isFinite(s.audioLevel) ? Math.max(0, Math.min(1, s.audioLevel)) : 0;
  });

  function frame() {
    if (!running) return;
    const now = performance.now();
    const t = (now - start) / 1000;
    // real elapsed seconds, clamped to avoid a huge first-frame / tab-restore jump
    const dt = Math.max(0, Math.min(0.05, (now - prevNow) / 1000));
    prevNow = now;
    // S3: map mode -> (target energy level, orbit-speed churn). Computed ONCE per
    // frame in JS (no per-pixel cost); modeSpeed multiplies the phase rate below.
    //   idle        : calm slow breathing  ~0.12 +/- 0.04*sin   speed 0.8
    //   recording   : follows live audio level                  speed 1.0
    //   transcribing: steady mid "thinking" energy 0.40          speed 1.35 (churn)
    //   error       : calm low-mid motion 0.25 (red albedo)      speed 1.0
    let target, modeSpeed;
    if (mode === "idle") {
      target = 0.12 + 0.04 * Math.sin(t * 0.6);
      modeSpeed = 0.8;
    } else if (mode === "transcribing") {
      target = 0.40;
      modeSpeed = 1.35;
    } else if (mode === "error") {
      target = 0.25;
      modeSpeed = 1.0;
    } else { // recording (and any other) follows live level
      target = level;
      modeSpeed = 1.0;
    }
    // ATTACK/RELEASE envelope: fast attack (0.35) so the blob punches OUT on a
    // loud transient, slower release (0.10) so it eases back gently. This makes
    // the voice pulse lively instead of the old symmetric 0.08 lerp that smeared
    // transients flat. Applies to all modes; in recording the voice punches
    // through. NOTE: this shapes SIZE/GLOW only — orbit phase is untouched, so
    // there's no jerk.
    const a = target > smoothLevel ? 0.35 : 0.10;
    smoothLevel += (target - smoothLevel) * a;

    // accumulate orbit phase at the current rate (mirrors the old shader spd:
    // 0.5 * energy * uSpeed * uModeSpeed, energy = 0.5 + smoothLevel)
    const energy = 0.5 + smoothLevel;
    const spdJs = 0.5 * energy * speed * modeSpeed;
    phase += spdJs * dt;

    gl!.uniform1f(uPhase, phase);
    gl!.uniform1f(uLevel, smoothLevel);
    gl!.uniform1f(uColorMode, mode === "error" ? 1.0 : 0.0);
    gl!.clearColor(0, 0, 0, 0);
    gl!.clear(gl!.COLOR_BUFFER_BIT);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    raf = requestAnimationFrame(frame);
  }

  function onVisibility() {
    if (document.hidden) {
      running = false;
      cancelAnimationFrame(raf);
    } else if (!running) {
      running = true;
      raf = requestAnimationFrame(frame);
    }
  }
  document.addEventListener("visibilitychange", onVisibility);
  raf = requestAnimationFrame(frame);

  return {
    unmount() {
      running = false;
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
      cancelAnimationFrame(raf);
      gl!.deleteBuffer(buf);
      gl!.deleteProgram(prog);
      const ext = gl!.getExtension("WEBGL_lose_context");
      if (ext) ext.loseContext();
      canvas.remove();
    },
  };
}
