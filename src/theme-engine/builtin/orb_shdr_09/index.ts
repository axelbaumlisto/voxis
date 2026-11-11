// orb_shdr_09 — Torn rings of rainbow light worn as the ball's own latitudes: ten concentric rings, each re-warping the original point through its own cell-quantized distortion so they tear differently instead of nesting, with an asymmetric falloff that lights every ring's outer shoulder three times as hard as its inner one. The hue phase divides by the distance to the ring, so a full rainbow compresses into a fringe exactly where the glow peaks. Radius maps to the polar angle rather than through a stereographic wrap, which foreshortens the rings exactly and lets the dome roll freely
//
// PORTED FROM ORBKIT (https://github.com/zzzzshawn/orbkit), orb `shdr-09`
// ("SHDR-09") — shader by XORDEV: NON-COMMERCIAL use only, attribution required.
// Shader body verbatim; the prelude, the colour uniforms and the WebGL lifetime
// live in `_shared/orb-kit.ts`.
//
// Mode map: idle → orbkit `idle`, recording → `speaking` (`uInput` ← the live
// audioLevel), transcribing → `thinking`. Rates (speed, spin) are
// orbkit `integrate: true` and are accumulated into clocks by the kit.
import { mountOrb, type OrbVariant } from "../_shared/orb-kit";
import type { ThemeApi, ThemeInstance } from "../../contract";

const FRAG = `
#define RINGS 10
#define TURB 9
#define AA 2

// Volume-reactive values, resolved once per fragment in main().
float irisWarp;
float irisGlow;
float irisFringe;

vec3 irisRender(vec2 fragCoord) {
  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  float R = max(uP_radius, 0.001);

  // the dome: the front hemisphere of a unit ball, in screen space
  vec2 pl = uv / R;
  float z = sqrt(max(1.0 - dot(pl, pl), 0.0));
  vec3 n = vec3(pl, z);

  float t = uP_speed; // integrated clock

  // tilt about X, then roll about Y on its own integrated clock
  float ct = cos(uP_tilt);
  float st = sin(uP_tilt);
  vec3 sp = vec3(n.x, n.y * ct - n.z * st, n.y * st + n.z * ct);
  float cr = cos(uP_spin);
  float sr = sin(uP_spin);
  sp = vec3(sp.x * cr - sp.z * sr, sp.y, sp.x * sr + sp.z * cr);

  /*
    Radius becomes the polar angle from the dome's axis (see the header),
    so ring i lands on the latitude at angle i / uP_scale and the rings
    crowd toward the limb the way a globe's latitudes do. acos is defined
    on the whole sphere, so the roll above can put the axis anywhere —
    including behind the visible face, which sweeps the outer rings into
    view over the limb.
  */
  float pol = acos(clamp(sp.z, -1.0, 1.0));
  vec2 dir = sp.xy / max(length(sp.xy), 1e-4);
  vec2 p = dir * pol * uP_scale;

  vec3 acc = vec3(0.0);

  for (int ri = 0; ri < RINGS; ri++) {
    float i = float(ri) + 1.0;

    /*
      Each ring re-warps the ORIGINAL point with its own seed, exactly as
      the listing does — this loop is why the rings tear differently
      instead of nesting like tree rings.
    */
    vec2 v = p;
    for (int j = 0; j < TURB; j++) {
      float f = float(j) + 1.0;
      v += irisWarp * sin(ceil(v * f + i * uP_seed) - t * 0.5) / f;
    }

    float l = length(v) - i;

    // the asymmetric absolute value, with the floor doubling as the line
    // width — a wider floor is a fatter, softer wavefront
    float side = max(max(l, -uP_inner * l), uP_lineSoft);

    /*
      The hue sweep, softened. l/(l*l+g) tracks 1/l off the ring and rolls
      over to a finite peak on it, so the rainbow compresses into a fringe
      of finite width instead of an aliased band.
    */
    float fr = irisFringe * l / (l * l + uP_fringeSoft);
    vec3 hue = cos(t - i * uP_ringPhase + fr + vec3(0.0, 1.0, 2.0)) + 1.1;

    acc += (irisGlow / side) * hue;
  }

  // the listing's tanh knee, with the divisor exposed
  vec3 col = tanh3(acc / max(uP_exposure, 0.001));
  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));

  // saturation about luminance, then the tint
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);
  col *= uC_tint;

  // dome shading keeps the ball a ball under the rings — gentler than the
  // sibling orbs use, because these rings are emission and a hard lambert
  // reads as a shadow thrown across a light source
  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.72))), 0.0, 1.0);
  col *= 0.55 + uP_light * lambert;

  float fres = 1.0 - z;
  fres = fres * fres * fres;
  col += uC_sheen * uP_rim * fres;

  return col;
}

void main() {
  // Volume coupling: the user's voice tears the rings harder, the agent's
  // brightens them and opens the rainbow fringe.
  irisWarp = uP_warp * (1.0 + 0.5 * uInput);
  irisGlow = uP_glow * (0.85 + 0.5 * uOutput);
  irisFringe = uP_fringe * (1.0 + 0.6 * uOutput);

  vec2 uv = orbUV();
  float mask = smoothstep(0.012, -0.012, length(uv) - max(uP_radius, 0.001));

  // Ninety sines per sample before supersampling — none of them worth
  // paying for outside the silhouette.
  if (mask <= 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec3 col = vec3(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 off = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;
      col += irisRender(gl_FragCoord.xy + off);
    }
  }
  col /= float(AA * AA);
#else
  col = irisRender(gl_FragCoord.xy);
#endif

  // Surface orb bounded by a mask: alpha IS coverage, so premultiply — the
  // opposite convention from the emissive orbs (see shdr-31).
  float a = mask;
  gl_FragColor = vec4(max(col, vec3(0.0)) * a, a);
}
`;

const DEFAULTS = { speed: 0.6, spin: 0.12, tilt: 0.4, radius: 0.9, scale: 3.5, warp: 0.45, seed: 0.9, glow: 0.05, lineSoft: 0.05, inner: 3, fringe: 0.1, fringeSoft: 0.003, ringPhase: 0.8, exposure: 1.1, contrast: 1.1, saturation: 1.2, light: 0.5, rim: 0.4 } as const;

const VARIANTS: OrbVariant = {
  id: "orb_shdr_09",
  frag: FRAG,
  defaults: DEFAULTS,
  clocks: ["speed", "spin"],
  colors: { tint: "#ffffff", sheen: "#b9d6ff" },
  presets: {
    idle: {
      speed: 0.6,
      spin: 0.12,
      warp: 0.45,
      glow: 0.05,
      lineSoft: 0.05,
      fringe: 0.1,
      exposure: 1.1,
      contrast: 1.15,
    },
    recording: {
      speed: 4.7,
      spin: 0.34,
      warp: 0.22,
      seed: 1.02,
      glow: 0.04,
      lineSoft: 0.22,
      fringe: 0.81,
      fringeSoft: 0.058,
      ringPhase: 1.03,
      exposure: 0.68,
      contrast: 0.85,
      light: 0.99,
      rim: 0.015,
    },
    transcribing: {
      warp: 2.54,
      glow: 0.2,
      lineSoft: 0.152,
      fringe: 0.96,
      fringeSoft: 0.854,
      ringPhase: 2.53,
      exposure: 1.75,
      contrast: 1.15,
      saturation: 2.22,
      light: 1.035,
      rim: 0.66,
    },
  },
};

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  return mountOrb(container, api, VARIANTS);
}
