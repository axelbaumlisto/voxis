// orb_shdr_32 — A galaxy marched as a volume of gas and dust inside the ball: a flared exponential disc under a Gaussian bulge, modulated by log-spiral arms and broken into filaments by four octaves of feedback-curl turbulence, accumulated front-to-back with a blue-weighted extinction so thick gas reddens what lies behind it — the dust lanes fall out of the physics. Hashed stars sit at each ray's exact hit with the galactic plane, veiled by the dust in front of them. The disc tips between states: a calm three-quarter spiral at rest, a face-on boiling whirlpool while searching, a face-on flaring spiral breathing on the beat while answering
//
// PORTED FROM ORBKIT (https://github.com/zzzzshawn/orbkit), orb `shdr-32`
// ("SHDR-32") — MIT.
// Shader body verbatim; the prelude, the colour uniforms and the WebGL lifetime
// live in `_shared/orb-kit.ts`.
//
// Mode map: idle → orbkit `idle`, recording → `speaking` (`uInput` ← the live
// audioLevel), transcribing → `thinking`. Rates (spin, churn, beat, twinkle) are
// orbkit `integrate: true` and are accumulated into clocks by the kit.
import { mountOrb, type OrbVariant } from "../_shared/orb-kit";
import type { ThemeApi, ThemeInstance } from "../../contract";

const FRAG = `
#define STEPS 56
#define TURB_OCT 4

// Volume-reactive values, resolved once per fragment in main().
float galDensity;
float galCore;
float galFalloff;

/*
  The galactic density at a point in the galaxy's own frame: the disc lies
  in xz, the normal is y. Returns the density; writes the arm weight and the
  cylindrical radius for the colour.
*/
float galaxy(vec3 p, float t, out float arm, out float rho) {
  rho = length(p.xz);
  float h = p.y;
  // atan(0, 0) is undefined; the exact axis is all bulge anyway
  float phi = rho > 1e-4 ? atan(p.z, p.x) : 0.0;
  float lr = log(max(rho, 0.02));
  float armPhase = phi * uP_arms - uP_wind * lr;

  // feedback curl turbulence, shared phase
  vec3 q = p * uP_turbScale;
  float f = 1.0;
  for (int k = 0; k < TURB_OCT; k++) {
    q += cos(q.yzx * f + t) / f;
    f *= 1.9;
  }
  float n = (sin(q.x) + sin(q.y) + sin(q.z)) / 3.0 * 0.5 + 0.5;
  float clump = smoothstep(uP_threshold, 1.0, n);

  arm = 0.5 + 0.5 * cos(armPhase + (n - 0.5) * uP_ragged);
  arm = pow(arm, uP_armSharp);

  float scaleH = uP_thick * (0.12 + rho);
  float disc = exp(-rho * galFalloff) * exp(-abs(h) / scaleH);
  float bulge = exp(-dot(p, p) * uP_bulge);

  float dens = disc * (0.08 + 1.6 * arm) * (0.25 + 0.75 * clump) + bulge * galCore;
  return dens * galDensity;
}

/*
  One lattice of hashed stars. Each cell either carries a star or not, at a
  hashed position, with its own twinkle rate; the 3x3 neighbourhood is
  gathered so a star near a cell wall is not clipped.
*/
float starField(vec2 p, float density, float size, float twinkleT) {
  vec2 id = floor(p);
  vec2 f = fract(p);
  float acc = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 cid = id + o;
      float h = hash(cid);
      if (h > density) continue;
      vec2 sp = o + vec2(hash(cid + 1.3), hash(cid + 2.7));
      float dd = length(f - sp);
      float tw = 0.55 + 0.45 * sin(twinkleT * (1.5 + 5.0 * hash(cid + 5.1)) + h * 40.0);
      float sz = size * (0.5 + 1.2 * hash(cid + 8.9) * hash(cid + 8.9));
      acc += tw * exp(-dd * dd / (sz * sz)) * (0.4 + 0.6 * h / max(density, 0.001));
    }
  }
  return acc;
}

vec4 galaxyRender(vec2 fragCoord) {
  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  vec3 ro = vec3(0.0, 0.0, uP_camDist);
  vec3 rd = normalize(vec3(uv, -uP_focal));

  float t = uP_churn; // integrated clock: the turbulence boils
  float spin = uP_spin; // integrated clock: the disc turns

  // the galaxy frame: tip about x by the tilt, then turn about the disc's
  // own normal
  float ct = cos(uP_tilt);
  float st = sin(uP_tilt);
  float cs = cos(spin);
  float sn = sin(spin);

  vec3 acc = vec3(0.0);
  vec3 T = vec3(1.0);
  // extinction weighted to blue, so thick gas reddens what is behind it
  vec3 absorb = vec3(0.7, 1.0, 1.5) * uP_absorb;

  // march only the span the envelope can light
  float z = max(uP_camDist - uP_envRadius * 1.05, 0.0);
  float zEnd = uP_camDist + uP_envRadius * 1.05;
  float dt = (zEnd - z) / float(STEPS);
  // a hashed start offset per pixel hides the step banding
  z += dt * hash(fragCoord * 0.37);

  for (int i = 0; i < STEPS; i++) {
    vec3 p = ro + rd * z;

    // envelope: nothing outside the ball contributes
    float env = 1.0 - smoothstep(uP_envRadius * 0.92, uP_envRadius, length(p));
    if (env > 0.001) {
      // into the galaxy frame
      vec3 g = vec3(p.x, p.y * ct - p.z * st, p.y * st + p.z * ct);
      g = vec3(g.x * cs - g.z * sn, g.y, g.x * sn + g.z * cs);

      float arm = 0.0;
      float rho = 0.0;
      float d = galaxy(g / uP_envRadius, t, arm, rho) * env;

      // the colour ramp, keyed to radius from the core
      vec3 ramp = mix(uC_inner, uC_outer, smoothstep(0.12, uP_hueReach, rho));
      float coreW = exp(-rho * rho * uP_bulge * 0.6);
      vec3 emit = mix(ramp, uC_core, coreW) * (0.6 + 0.6 * arm);

      acc += T * d * emit * dt;
      T *= exp(-d * absorb * dt);
    }

    z += dt;
    if (T.g < 0.004 || z > zEnd) break;
  }

  return vec4(acc, 1.0 - T.g);
}

void main() {
  // The beat: one wave on the core-beat clock, shared by the core flare and
  // the disc's breathing. Both depths are amplitudes, so they stage cleanly.
  float wave = 0.5 + 0.5 * cos(uP_beat);
  galDensity = uP_density * (1.0 + 0.35 * uInput);
  galCore = uP_core * (1.0 + 0.7 * uOutput) * (1.0 + uP_pulse * wave);
  // breathing: the disc's falloff relaxes on the wave, so the whole disc
  // swells outward and draws back — a smooth exponential, safe to sweep
  galFalloff = uP_falloff / (1.0 + uP_breathe * wave);

  vec4 acc = galaxyRender(gl_FragCoord.xy);

  /*
    Stars, at the ray's exact hit with the galactic plane. The plane is the
    tilted xz-plane through the origin; its world normal is the tilted y.
    The lattice lives in the disc's own turning frame, so the stars turn
    with the gas, and the march's transmittance dims them through the dust.
  */
  {
    vec3 ro = vec3(0.0, 0.0, uP_camDist);
    vec3 rd = normalize(vec3(orbUV(), -uP_focal));
    float ct = cos(uP_tilt);
    float st = sin(uP_tilt);
    vec3 N = vec3(0.0, ct, st);
    float denom = dot(N, rd);
    if (abs(denom) > 1e-4) {
      float th = -dot(N, ro) / denom;
      vec3 q = ro + rd * th;
      if (th > 0.0 && dot(q, q) < uP_envRadius * uP_envRadius * 0.9) {
        vec3 g = vec3(q.x, q.y * ct - q.z * st, q.y * st + q.z * ct) / uP_envRadius;
        float cs = cos(uP_spin);
        float sn = sin(uP_spin);
        vec2 gp = vec2(g.x * cs - g.z * sn, g.x * sn + g.z * cs);
        float rho = length(gp);
        float phi = rho > 1e-4 ? atan(gp.y, gp.x) : 0.0;
        float armW = 0.5 + 0.5 * cos(phi * uP_arms - uP_wind * log(max(rho, 0.02)));
        float sf = starField(gp * uP_starScale, uP_starDensity * (0.3 + 0.7 * armW), 0.12, uP_twinkle);
        float veil = 1.0 - acc.a; // what the march let through
        acc.rgb += vec3(1.0, 0.97, 0.9) * sf * uP_stars * exp(-rho * 1.5) * (0.25 + 0.75 * veil);
      }
    }
  }

  // tanh tone map per channel, tunable knee
  vec3 col = tanh3(acc.rgb / max(uP_exposure, 0.01));
  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));

  // saturation about luminance, then the tint
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);
  col *= uC_tint;

  // alpha from the brightest channel — emitted light (see shdr-18)
  float peak = max(col.r, max(col.g, col.b));
  float a = clamp(peak * uP_alphaGain, 0.0, 1.0);

  // the night behind: a fill so the ball is a solid sphere, not a cut-out
  col += uC_deep * uP_fill;
  a = max(a, uP_fill);

  // Analytic silhouette — identical construction to shdr-01: exact
  // ray-to-centre distance against the radius, colour AND alpha.
  vec3 mrd = normalize(vec3(orbUV(), -uP_focal));
  float closest = length(cross(vec3(0.0, 0.0, uP_camDist), mrd));
  float band = mix(0.35, 0.012, clamp(uP_edge, 0.0, 1.0));
  float mask = 1.0 - smoothstep(uP_envRadius * (1.0 - band), uP_envRadius * 1.005, closest);
  col *= mask;
  a *= mask;

  // a fresnel rim on the glass, inside the mask
  float fres = smoothstep(uP_envRadius * 0.7, uP_envRadius, closest);
  col += uC_rim * uP_rim * fres * fres * mask;

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

const DEFAULTS = { spin: 0.06, churn: 0.25, beat: 0.8, twinkle: 1.2, camDist: 7, focal: 2.25, envRadius: 2.6, tilt: 0.85, arms: 2, wind: 3.4, ragged: 3, armSharp: 2.2, falloff: 1.7, thick: 0.035, bulge: 40, core: 5, turbScale: 9, threshold: 0.35, density: 14, absorb: 3.5, stars: 1.2, starDensity: 0.5, starScale: 48, hueReach: 0.6, pulse: 0.2, breathe: 0, exposure: 1.1, contrast: 1.15, saturation: 1.35, alphaGain: 2, fill: 0.85, rim: 0.35, edge: 1, edgeFade: 0.98 } as const;

const VARIANTS: OrbVariant = {
  id: "orb_shdr_32",
  frag: FRAG,
  defaults: DEFAULTS,
  clocks: ["spin", "churn", "beat", "twinkle"],
  colors: { tint: "#ffffff", core: "#fff3d6", inner: "#7fb4ff", outer: "#c46bff", deep: "#04050f", rim: "#8fb0ff" },
  presets: {
    idle: {
      tilt: 0.85,
      spin: 0.06,
      churn: 0.25,
      beat: 0.8,
      twinkle: 1.2,
      pulse: 0.2,
      breathe: 0,
      ragged: 3,
      armSharp: 2.2,
      thick: 0.035,
      threshold: 0.35,
      density: 14,
      core: 5,
      absorb: 3.5,
      stars: 1.2,
      exposure: 1.1,
      contrast: 1.15,
      saturation: 1.35,
    },
    recording: {
      tilt: 1.3,
      spin: 0.2,
      churn: 0.6,
      beat: 4.8,
      twinkle: 2.4,
      pulse: 1,
      breathe: 0.45,
      ragged: 2,
      armSharp: 1.8,
      thick: 0.04,
      threshold: 0.25,
      density: 18,
      core: 12,
      absorb: 1.6,
      stars: 2,
      exposure: 0.75,
      contrast: 1.05,
      saturation: 1.6,
    },
    transcribing: {
      tilt: 1.45,
      spin: 0.45,
      churn: 1.6,
      beat: 2.4,
      twinkle: 4.5,
      pulse: 0.25,
      breathe: 0,
      ragged: 8,
      armSharp: 1,
      thick: 0.07,
      threshold: 0.5,
      density: 20,
      core: 3,
      absorb: 6,
      stars: 1.8,
      exposure: 1.05,
      contrast: 1.3,
      saturation: 1.2,
    },
  },
};

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  return mountOrb(container, api, VARIANTS);
}
