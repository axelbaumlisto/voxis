// orb_shdr_10 — A lattice of light knitted into the ball's own skin: the listing's tunnel unwrap rewrites each sample as angle, height and radius-minus-shell, and reading that radius from the centre rather than from an axis turns its pipe into a sphere without another line changing. The density is small only where all three cosines of the unwrapped point sit at one AND the sample is on the shell, so a 3D lattice is cut by the ball's surface and what survives is a knitted net. Every march step carries its own warp and colour phase, so forty samples layer into gauze instead of stacking one surface forty times
//
// PORTED FROM ORBKIT (https://github.com/zzzzshawn/orbkit), orb `shdr-10`
// ("SHDR-10") — shader by XORDEV: NON-COMMERCIAL use only, attribution required.
// Shader body verbatim; the prelude, the colour uniforms and the WebGL lifetime
// live in `_shared/orb-kit.ts`.
//
// Mode map: idle → orbkit `idle`, recording → `speaking` (`uInput` ← the live
// audioLevel), transcribing → `thinking`. Rates (speed, scroll) are
// orbkit `integrate: true` and are accumulated into clocks by the kit.
import { mountOrb, type OrbVariant } from "../_shared/orb-kit";
import type { ThemeApi, ThemeInstance } from "../../contract";

const FRAG = `
#define STEPS 40
#define TURB 6
#define AA 1

// Volume-reactive values, resolved once per fragment in main().
float weaveTurb;
float weaveCell;
float weaveExposure;

vec3 weaveRender(vec2 fragCoord) {
  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  vec3 ro = vec3(0.0, 0.0, uP_camDist);
  vec3 rd = normalize(vec3(uv, -uP_focal));

  float animTime = uP_speed;  // integrated clock: the warp
  float scroll = uP_scroll;   // integrated clock: the skin climbs

  vec3 acc = vec3(0.0);

  // transmittance carried front-to-back — the near skin veils the far one
  float T = 1.0;

  // march only the span the envelope can light, as in shdr-01
  float z = max(uP_camDist - uP_envRadius * 1.3, 0.0);
  float zEnd = uP_camDist + uP_envRadius * 1.3;

  for (int it = 0; it < STEPS; it++) {
    float fi = float(it) + 1.0;
    vec3 world = ro + rd * z;

    /*
      The unwrap, with the listing's cylinder swapped for the ball: angle
      about the axis, height, and distance from the CENTRE less the shell
      radius. uP_wrap wants to stay a whole number — see the header.
    */
    float rl = length(world);
    vec3 p = vec3(
      atan(world.z, world.x) * uP_wrap,
      world.y * uP_climb + scroll,
      rl - uP_shellR
    );

    // six octaves of feedback warp, each march step on its own phase
    for (int j = 0; j < TURB; j++) {
      float dj = float(j) + 1.0;
      p += weaveTurb * sin(p.yzx * dj + animTime + uP_layer * fi) / dj;
    }

    /*
      The lattice. Small only where all three cosines sit at one and the
      sample is on the shell — so the cells of a 3D lattice in unwrapped
      space are cut by the ball's surface, and what is left is a knitted
      skin. uP_cell is the listing's .3: the amplitude of the cosine terms
      against the shell term, and therefore how much the lattice matters
      relative to simply being on the surface.
    */
    float d = uP_stepScale * length(vec4(weaveCell * cos(p) - weaveCell, p.z));
    d = max(d, uP_envRadius * 0.004);

    // colour by unwrapped height, with each step offset again
    vec3 w = cos(p.y + fi * uP_hueStep + vec3(6.0, 1.0, 2.0) * uP_spread) + 1.0;
    w /= d;
    w = min(w, vec3(uP_stepClamp));

    // envelope: plateau through the ball, cut 12% past the radius so the
    // analytic silhouette in main() still has emission left to cut
    float env = smoothstep(uP_envRadius * 1.12, uP_envRadius * uP_envCore, rl);
    w = (w + uP_fill) * env;

    acc += T * w;
    T *= exp(-dot(w, vec3(0.299, 0.587, 0.114)) * uP_scatter);

    z += d;
    if (T < 0.004 || z > zEnd) break;
  }

  return acc;
}

void main() {
  weaveTurb = uP_turb * (1.0 + 0.4 * uInput);
  weaveCell = uP_cell * (1.0 + 0.3 * uInput);
  weaveExposure = uP_exposure * (1.0 - 0.3 * uOutput);

  vec3 acc = vec3(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 offset = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;
      acc += weaveRender(gl_FragCoord.xy + offset);
    }
  }
  acc /= float(AA * AA);
#else
  acc = weaveRender(gl_FragCoord.xy);
#endif

  /*
    The listing's knee is tanh(o*o/6e3) over an unnormalized sum of forty
    steps. Dividing by the step count first pulls the square's scale down
    by forty squared, so the same knee lands near four — a number that fits
    on a slider. The square is a contrast squarer, not a tone map.
  */
  vec3 v = acc / float(STEPS);
  vec3 col = tanh3(v * v / max(weaveExposure, 0.0001));
  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));

  // saturation about luminance, then the tint
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);
  col *= uC_tint;

  // alpha from the brightest channel, not luminance — a deep blue thread
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

const DEFAULTS = { speed: 0.6, scroll: 1.2, camDist: 7, focal: 2, shellR: 2.6, wrap: 8, climb: 4, turb: 0.35, layer: 0.5, cell: 0.45, stepScale: 0.15, hueStep: 0.4, spread: 1, envRadius: 2.9, envCore: 0.92, fill: 0.1, stepClamp: 300, scatter: 0.004, exposure: 30, contrast: 1.15, saturation: 1.2, alphaGain: 2, edge: 1, edgeFade: 0.98 } as const;

const VARIANTS: OrbVariant = {
  id: "orb_shdr_10",
  frag: FRAG,
  defaults: DEFAULTS,
  clocks: ["speed", "scroll"],
  colors: { tint: "#ffffff" },
  presets: {
    idle: {
      speed: 0.6,
      scroll: 1.2,
      turb: 0.35,
      cell: 0.45,
      exposure: 30,
      scatter: 0.004,
      alphaGain: 2,
    },
    recording: {
      speed: 1,
      scroll: 4.2,
      turb: 0.18,
      cell: 0.95,
      exposure: 11,
      scatter: 0.0015,
      contrast: 0.9,
      saturation: 1.45,
      alphaGain: 2.8,
    },
    transcribing: {
      speed: 1.9,
      scroll: 0.5,
      turb: 0.85,
      layer: 0.65,
      cell: 0.3,
      stepScale: 0.09,
      spread: 1.55,
      fill: 0.12,
      exposure: 13,
      scatter: 0.006,
      contrast: 1.05,
      saturation: 1.7,
      alphaGain: 2.6,
    },
  },
};

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  return mountOrb(container, api, VARIANTS);
}
