// orb_ion — A plasma globe: pink-to-violet lightning filaments crawling from a hot nucleus to the glass, built as the joint zero set of two animated fields over the direction sphere — so every streamer is genuinely radial, stays rooted while its far end wanders, and flares where it lands on the shell. More streamers grow in as the agent gets louder
//
// PORTED FROM ORBKIT (https://github.com/zzzzshawn/orbkit), orb `shdr-13`
// ("Ion") — MIT.
// Shader body verbatim; the prelude, the colour uniforms and the WebGL lifetime
// live in `_shared/orb-kit.ts`.
//
// Mode map: idle → orbkit `idle`, recording → `speaking` (`uInput` ← the live
// audioLevel), transcribing → `thinking`. Rates (speed, spin) are
// orbkit `integrate: true` and are accumulated into clocks by the kit.
import { mountOrb, type OrbVariant } from "../_shared/orb-kit";
import type { ThemeApi, ThemeInstance } from "../../contract";

const FRAG = `
#define STEPS 64

// Volume-reactive values, resolved once per fragment in main().
float ionSharp;
float ionWrithe;
float ionCore;
float ionExposure;
float ionRadius;

mat2 ionRot2(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

vec3 ionRender(vec2 fragCoord) {
  float t = uP_speed;      // integrated clock: filament crawl
  float spinAng = uP_spin; // integrated clock: array precession

  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  vec3 ro = vec3(0.0, 0.0, uP_camDist);
  vec3 rd = normalize(vec3(uv, -uP_focal));

  // exact ray/sphere chord — the march never leaves the globe, so no
  // envelope fade is needed and every step length is meaningful
  float proj = dot(-ro, rd);
  float b2 = dot(ro, ro) - proj * proj;
  float half_ = sqrt(max(ionRadius * ionRadius - b2, 0.0));
  float zNear = proj - half_;
  float stepLen = 2.0 * half_ / float(STEPS);
  // per-pixel jitter of the march start: a filament grazed at a shallow
  // angle is crossed periodically by the fixed step grid and renders as a
  // dotted chain — the jitter decorrelates neighbouring rays and melts the
  // dots into plasma grain
  zNear += (hash(fragCoord) - 0.5) * stepLen;

  vec3 acc = vec3(0.0);
  float T = 1.0;

  for (int i = 0; i < STEPS; i++) {
    vec3 p = ro + rd * (zNear + (float(i) + 0.5) * stepLen);

    // precess the whole filament array; a static tilt keeps the spin axis
    // off-vertical so the motion reads in 3D
    vec3 pr = p;
    pr.xz = ionRot2(spinAng) * pr.xz;
    pr.yz = ionRot2(uP_tilt) * pr.yz;

    float r = length(pr);
    vec3 dir = pr / max(r, 1e-4);
    float rr = r / max(ionRadius, 1e-3);

    // writhe: bend the sampling direction with radius and time, rooted at
    // the nucleus by the smoothstep so filaments stay attached
    float wr = ionWrithe * smoothstep(0.0, ionRadius * 0.35, r);
    vec3 q = dir * uP_fils;
    q += wr * vec3(
      sin(r * uP_writheFreq        - t * 1.2 + q.y * 1.8),
      sin(r * uP_writheFreq * 0.83 + t * 1.0 + q.z * 1.8),
      sin(r * uP_writheFreq * 1.19 - t * 0.7 + q.x * 1.8));

    // two independent fields over the direction sphere; their joint zero
    // set is the filament curves. Time enters as additive phase only.
    float f1 = sin(q.x + t * 0.70)
             + sin(q.y * 1.31 - t * 0.50)
             + sin(q.z * 1.13 + t * 0.90);
    float f2 = sin(q.y * 1.21 + t * 0.60 + 1.7)
             + sin(q.z * 1.43 - t * 0.80 + 3.1)
             + sin(q.x * 0.87 + t * 0.40 + 5.0);
    float d2 = f1 * f1 + f2 * f2;
    float g = 1.0 / (d2 * ionSharp + uP_soft);

    // flare where a streamer lands on the glass, and the hot nucleus
    g *= 1.0 + uP_tipGain * smoothstep(0.55, 0.95, rr);
    float core = ionCore / (r * r * 8.0 + 0.05);

    // pink near the nucleus, violet-blue at the glass, cores whitened by
    // their own intensity
    vec3 fCol = mix(uC_inner, uC_arc, smoothstep(0.1, 0.75, rr));
    vec3 w = (fCol + vec3(uP_whiten) * g) * g + uC_inner * core + vec3(uP_fill);
    w = min(w, vec3(uP_stepClamp));
    w *= stepLen; // length-fair: limb chords are short and dim correctly

    acc += T * w;
    T *= exp(-dot(w, vec3(0.299, 0.587, 0.114)) * uP_scatter);
    if (T < 0.004) break;
  }

  return acc;
}

void main() {
  // Louder agent output softens and thickens the arcs and quickens the
  // writhe; user input flares the nucleus — the globe answers being spoken
  // to the way the real toy answers a fingertip.
  ionSharp = uP_sharp * (1.0 - 0.25 * uOutput);
  ionWrithe = uP_writhe * (1.0 + 0.6 * uOutput);
  ionCore = uP_coreGain * (1.0 + 1.6 * uInput + 0.4 * uOutput);
  ionExposure = uP_exposure * (1.0 - 0.35 * uOutput);
  ionRadius = uP_envRadius + uP_swell * uInput;

  vec3 acc = ionRender(gl_FragCoord.xy);

  // tanh tone map with a tunable knee, then the usual finishing chain
  vec3 col = tanh3(acc / max(ionExposure, 0.01));
  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));

  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);
  col *= uC_tint;

  // alpha from the brightest channel — a saturated violet streamer has low
  // luminance but must not go transparent
  float peak = max(col.r, max(col.g, col.b));
  float a = clamp(peak * uP_alphaGain, 0.0, 1.0);

  // analytic silhouette, identical construction to shdr-01: exact
  // ray-to-centre distance against the radius, colour AND alpha
  vec3 mrd = normalize(vec3(orbUV(), -uP_focal));
  float closest = length(cross(vec3(0.0, 0.0, uP_camDist), mrd));
  float band = mix(0.35, 0.012, clamp(uP_edge, 0.0, 1.0));
  float mask = 1.0 - smoothstep(ionRadius * (1.0 - band), ionRadius * 1.005, closest);
  col *= mask;
  a *= mask;

  // Emitted light, so rgb is already premultiplied — do NOT scale by alpha
  // again (see the same note in shdr-31).
  gl_FragColor = vec4(col, a);
}
`;

const DEFAULTS = { speed: 1, spin: 0.2, camDist: 7, focal: 2.25, envRadius: 2.6, swell: 0.15, tilt: 0.4, fils: 6, writhe: 0.9, writheFreq: 1.6, sharp: 4, soft: 0.06, whiten: 0.008, coreGain: 1.6, tipGain: 1.8, fill: 0.02, stepClamp: 40, scatter: 0.012, exposure: 11, contrast: 1, saturation: 1.2, alphaGain: 2.5, edge: 1 } as const;

const VARIANTS: OrbVariant = {
  id: "orb_ion",
  frag: FRAG,
  defaults: DEFAULTS,
  clocks: ["speed", "spin"],
  colors: { inner: "#ff70d8", arc: "#5a5cff", tint: "#ffffff" },
  presets: {
    idle: {
      speed: 1,
      spin: 0.2,
      fils: 6,
      writhe: 0.9,
      sharp: 4,
      soft: 0.06,
      whiten: 0.008,
      tipGain: 1.8,
      coreGain: 1.6,
      exposure: 11,
    },
    recording: {
      speed: 2.6,
      spin: 0.3,
      fils: 8,
      writhe: 1.3,
      sharp: 3.5,
      soft: 0.05,
      whiten: 0.012,
      tipGain: 2.4,
      coreGain: 2,
      exposure: 8.5,
    },
    transcribing: {
      speed: 1.8,
      spin: 0.45,
      fils: 7,
      writhe: 1.2,
      sharp: 3,
      soft: 0.08,
      whiten: 0.012,
      tipGain: 1.5,
      coreGain: 1.2,
      exposure: 10,
    },
  },
};

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  return mountOrb(container, api, VARIANTS);
}
