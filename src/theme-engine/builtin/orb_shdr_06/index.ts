// orb_shdr_06 — A hundred glowing lattices stacked through the depth of the ball, interfering: each layer is a rectangular grid of points lit by the reciprocal of a sine field, seeded with its own frequency pair, and the beat between their spacings is the image. The layers are projected from the point the view ray reaches at each depth, closed-form, so parallax is zero at the centre and strongest at the limb and the stack shears against itself as it drifts. Hue runs with layer index, so depth through the stack reads as colour
//
// PORTED FROM ORBKIT (https://github.com/zzzzshawn/orbkit), orb `shdr-06`
// ("SHDR-06") — shader by XORDEV: NON-COMMERCIAL use only, attribution required.
// Shader body verbatim; the prelude, the colour uniforms and the WebGL lifetime
// live in `_shared/orb-kit.ts`.
//
// Mode map: idle → orbkit `idle`, recording → `speaking` (`uInput` ← the live
// audioLevel), transcribing → `thinking`. Rates (speed) are
// orbkit `integrate: true` and are accumulated into clocks by the kit.
import { mountOrb, type OrbVariant } from "../_shared/orb-kit";
import type { ThemeApi, ThemeInstance } from "../../contract";

const FRAG = `
#define LAYERS 100
#define AA 1

/*
 * The listing's sin(r + f), minus the resolution. The components are a
 * quarter turn apart so the per-layer frequency pair walks a circle (see
 * the header) — the base value only sets where on that circle layer one
 * starts.
 */
const vec2 SEED = vec2(11.3, 12.87);

// Volume-reactive values, resolved once per fragment in main().
float moireDrift;
float moireGlow;
float moireHue;

vec3 moireRender(vec2 fragCoord) {
  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  float R = max(uP_radius, 0.001);

  // the dome: the front hemisphere of a unit ball, in screen space
  vec2 pl = uv / R;
  float z = sqrt(max(1.0 - dot(pl, pl), 0.0));

  float t = uP_speed; // integrated clock

  /*
    The layer-zero projection: the plain stereographic wrap of the dome's
    surface. Every deeper layer is this divided by its own denominator, so
    the whole parallax below costs one ratio per layer.
  */
  float bulge = 1.0 + uP_bulge;
  float den0 = z + bulge;

  vec2 w = pl / den0 * uP_scale;

  vec3 acc = vec3(0.0);

  for (int li = 0; li < LAYERS; li++) {
    float f = float(li) + 1.0;
    float u = f / float(LAYERS);

    /*
      This layer's depth along the view ray, and the projection from the
      point the ray has reached there. At depth 0 the denominator is den0
      and the ratio is 1; deeper layers see the pattern from further
      inside the ball, which spreads them at the limb and not at all
      through the centre. That gradient is what shears the stack.
    */
    float d = u * uP_depth;
    float denu = z - d + bulge * sqrt(max(1.0 - 2.0 * d * z + d * d, 0.0));
    vec2 q = w * (den0 / max(denu, 0.05));

    /*
      One lattice. sin(q * k) vanishes on a rectangular grid of points and
      the reciprocal of its length lights every one; the floor on that
      length is the glow's radius, and without it the divide is by exactly
      zero at every lattice point.
    */
    vec2 k = sin(SEED + f) / max(uP_freq, 0.001);
    float g = max(length(sin(q * k)), moireGlow);

    // tint by layer index — depth through the stack reads as hue
    vec3 hue = cos(f * moireHue + vec3(0.0, 1.0, 3.0)) + 1.1;

    acc += hue / g;

    // the listing's walk between layers: the stack is a hundred grids
    // each shifted a little further along a wandering path
    w += moireDrift * sin(w.yx + t);
  }

  /*
    The listing's knee is tanh(o*o/4e4) over an unnormalized sum of a
    hundred layers. Dividing by the layer count first pulls the square's
    scale down by 100*100, so the same knee is exactly 4 here — a number
    that fits on a slider. The square is a contrast squarer, not a tone
    map: it crushes the field between the glows.
  */
  vec3 v = acc / float(LAYERS);
  vec3 col = tanh3(v * v / max(uP_exposure, 0.0001));
  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));

  // saturation about luminance, then the tint
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);
  col *= uC_tint;

  /*
    Dome shading, kept gentle: the layers are emission seen THROUGH the
    ball, so a hard lambert reads as a shadow thrown across the inside of
    a lamp rather than as a lit surface.
  */
  vec3 n = vec3(pl, z);
  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.72))), 0.0, 1.0);
  col *= 0.6 + uP_light * lambert;

  float fres = 1.0 - z;
  fres = fres * fres * fres;
  col += uC_sheen * uP_rim * fres;

  return col;
}

void main() {
  // Volume coupling: the user's voice widens the walk between layers, the
  // agent's opens the glows and runs the hue through the stack faster.
  moireDrift = uP_drift * (1.0 + 0.6 * uInput);
  moireGlow = max(uP_glowSize * (1.0 - 0.3 * uOutput), 0.002);
  moireHue = uP_hueRate * (1.0 + 0.35 * uOutput);

  vec2 uv = orbUV();
  float mask = smoothstep(0.012, -0.012, length(uv) - max(uP_radius, 0.001));

  // A hundred lattices per sample, none of them worth paying for outside
  // the silhouette.
  if (mask <= 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec3 col = vec3(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 off = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;
      col += moireRender(gl_FragCoord.xy + off);
    }
  }
  col /= float(AA * AA);
#else
  col = moireRender(gl_FragCoord.xy);
#endif

  // Surface orb bounded by a mask: alpha IS coverage, so premultiply — the
  // opposite convention from the emissive orbs (see shdr-31).
  float a = mask;
  gl_FragColor = vec4(max(col, vec3(0.0)) * a, a);
}
`;

const DEFAULTS = { speed: 0.5, drift: 0.02, radius: 0.9, scale: 4, bulge: 0.3, depth: 0.7, freq: 0.7, glowSize: 0.05, hueRate: 0.037, exposure: 4, contrast: 1.1, saturation: 1.2, light: 0.45, rim: 0.4 } as const;

const VARIANTS: OrbVariant = {
  id: "orb_shdr_06",
  frag: FRAG,
  defaults: DEFAULTS,
  clocks: ["speed"],
  colors: { tint: "#ffffff", sheen: "#bcd8ff" },
  presets: {
    idle: {
      speed: 0.5,
      drift: 0.02,
      depth: 0.7,
      glowSize: 0.05,
      hueRate: 0.037,
      exposure: 4,
      contrast: 1.1,
    },
    recording: {
      speed: 4.5,
      drift: 0.13,
      depth: 0.26,
      glowSize: 0.062,
      hueRate: 0.045,
      exposure: 2.7,
      contrast: 0.9,
      light: 1.11,
    },
    transcribing: {
      speed: 2.6,
      drift: 0.105,
      bulge: 2.18,
      depth: 1.25,
      glowSize: 0.016,
      hueRate: 0.095,
      exposure: 6.5,
      contrast: 1.55,
    },
  },
};

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  return mountOrb(container, api, VARIANTS);
}
