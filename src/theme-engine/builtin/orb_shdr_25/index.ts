// orb_shdr_25 — The folds of a warped field, drawn by their own steepness: nothing here draws a shape — it measures how fast a rippled field changes from one pixel to the next, so where eight octaves of warp have folded the plane onto itself the field races and those folds come out as bright filigree. The octave transform is an exact similarity hidden in integers, a rotation through the 3-4-5 angle times a scale of ten ninths, and because fwidth needs a WebGL 1 extension that cannot follow the prelude the derivative is taken by finite differences instead — three evaluations of the chain, and truer than the built-in's per-quad constant
//
// PORTED FROM ORBKIT (https://github.com/zzzzshawn/orbkit), orb `shdr-25`
// ("SHDR-25") — shader by XORDEV: NON-COMMERCIAL use only, attribution required.
// Shader body verbatim; the prelude, the colour uniforms and the WebGL lifetime
// live in `_shared/orb-kit.ts`.
//
// Mode map: idle → orbkit `idle`, recording → `speaking` (`uInput` ← the live
// audioLevel), transcribing → `thinking`. Rates (speed, drift, swirl) are
// orbkit `integrate: true` and are accumulated into clocks by the kit.
import { mountOrb, type OrbVariant } from "../_shared/orb-kit";
import type { ThemeApi, ThemeInstance } from "../../contract";

const FRAG = `
#define OCTAVES 8
#define AA 2

// Volume-reactive values, resolved once per fragment in main().
float creaseWarp;
float creaseGain;

// GLSL ES 1.0 has no scalar tanh; the prelude ships the vec3 form only.
float tanh1(float x) {
  x = clamp(x, -10.0, 10.0);
  float e = exp(2.0 * x);
  return (e - 1.0) / (e + 1.0);
}

/*
  The whole chain for one pixel centre: dome, stereographic wrap, then the
  eight-octave warp. Called three times per sample so the derivative below
  can be differenced — see the header for why fwidth is unavailable.
*/
vec2 creaseField(vec2 fragCoord, float t, float drift, float sw) {
  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);
  vec2 pl = uv / max(uP_radius, 0.001);
  float z = sqrt(max(1.0 - dot(pl, pl), 0.0));

  vec2 p = pl / (z + 1.0 + uP_bulge) * uP_scale;
  p = mat2(cos(sw), -sin(sw), sin(sw), cos(sw)) * p;
  p += drift;

  /*
    The listing's matrix, decomposed. mat2(6,-8,8,6)/9 is exactly
    (10/9) * mat2(.6,-.8,.8,.6), and that second factor is a true rotation
    because 6-8-10 is a Pythagorean triple — so the octave transform is a
    rotation through the 3-4-5 angle times a clean zoom, with the zoom
    pulled out as a slider.
  */
  for (int i = 0; i < OCTAVES; i++) {
    float fi = float(i) + 1.0;
    p += sin(p + t + fi) * creaseWarp;
    p = uP_zoom * (mat2(0.6, -0.8, 0.8, 0.6) * p);
  }

  return p;
}

vec3 creaseRender(vec2 fragCoord) {
  float t = uP_speed;      // integrated clock: the boil
  float drift = uP_drift;  // integrated clock: the slow travel
  float sw = uP_swirl;     // integrated clock

  /*
    The three taps the difference needs. uP_blur is how far apart they sit:
    at one pixel this is fwidth exactly, and wider is a deliberate blur —
    the derivative of a folded field is a hairline, and a rim wants width.
  */
  vec2 p0 = creaseField(fragCoord, t, drift, sw);
  vec2 px = creaseField(fragCoord + vec2(uP_blur, 0.0), t, drift, sw);
  vec2 py = creaseField(fragCoord + vec2(0.0, uP_blur), t, drift, sw);

  /*
    fwidth, by hand and once per channel. The sum of the absolute
    differences on each axis is exactly what the built-in returns — but
    taking it three times at slightly offset ripple phases puts each
    channel's rim in a slightly different place, which is where the warm
    and cool fringes on the edges come from. One field evaluation still
    serves all three.
  */
  vec3 e;
  for (int c = 0; c < 3; c++) {
    float ph = float(c) * uP_fringe;
    vec2 v0 = sin(p0 * uP_ripple + ph);
    vec2 d = abs(sin(px * uP_ripple + ph) - v0)
           + abs(sin(py * uP_ripple + ph) - v0);
    float m = tanh1(length(d) * creaseGain / max(uP_exposure, 0.001));
    if (c == 0) e.r = m;
    else if (c == 1) e.g = m;
    else e.b = m;
  }

  e = pow(clamp(e, 0.0, 1.0), vec3(uP_contrast));

  vec3 col = uC_tint * e;

  // a dark body under the filigree, so the flat regions read as the ball
  col += uC_body * uP_floorLevel;

  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uP_saturation);

  // dome shading keeps the ball a ball under the folds
  vec2 pl = ((2.0 * fragCoord - uRes) / min(uRes.x, uRes.y)) / max(uP_radius, 0.001);
  float z = sqrt(max(1.0 - dot(pl, pl), 0.0));
  vec3 n = vec3(pl, z);
  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.72))), 0.0, 1.0);
  col *= 0.62 + uP_light * lambert;

  float fres = 1.0 - z;
  fres = fres * fres * fres;
  col += uC_sheen * uP_rim * fres;

  return col;
}

void main() {
  // Volume coupling: the user's voice folds the field harder, the agent's
  // steepens what counts as a crease.
  creaseWarp = uP_warp * (1.0 + 0.4 * uInput);
  creaseGain = uP_edgeGain * (1.0 + 0.5 * uOutput);

  vec2 uv = orbUV();
  float mask = smoothstep(0.012, -0.012, length(uv) - max(uP_radius, 0.001));

  // Twenty-four warp steps per sample — none of them worth paying for
  // outside the silhouette.
  if (mask <= 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec3 col = vec3(0.0);
#if AA > 1
  for (int mx = 0; mx < AA; mx++) {
    for (int my = 0; my < AA; my++) {
      vec2 off = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;
      col += creaseRender(gl_FragCoord.xy + off);
    }
  }
  col /= float(AA * AA);
#else
  col = creaseRender(gl_FragCoord.xy);
#endif

  // Surface orb bounded by a mask: alpha IS coverage, so premultiply — the
  // opposite convention from the emissive orbs (see shdr-31).
  float a = mask;
  gl_FragColor = vec4(max(col, vec3(0.0)) * a, a);
}
`;

const DEFAULTS = { speed: 3, drift: 0.6, swirl: 0.05, radius: 0.9, scale: 7.5, bulge: 0.3, warp: 0.4, zoom: 1.111, ripple: 0.3, edgeGain: 10, blur: 2.5, fringe: 0.09, exposure: 0.8, contrast: 1.15, saturation: 1.5, floorLevel: 0.16, light: 0.35, rim: 0.45 } as const;

const VARIANTS: OrbVariant = {
  id: "orb_shdr_25",
  frag: FRAG,
  defaults: DEFAULTS,
  clocks: ["speed", "drift", "swirl"],
  colors: { tint: "#dbe8f7", body: "#0d1118", sheen: "#a8c8f0" },
  presets: {
    idle: {
      speed: 3,
      drift: 0.6,
      swirl: 0.05,
      warp: 0.4,
      zoom: 1.07,
      edgeGain: 12.5,
      exposure: 0.8,
      contrast: 1.15,
    },
    recording: {
      speed: 1.4,
      drift: 0.8,
      swirl: 0.6,
      scale: 11.5,
      bulge: 2.22,
      warp: 1.55,
      zoom: 0.945,
      ripple: 1.18,
      edgeGain: 5,
      blur: 2,
      fringe: 0.23,
      exposure: 2.35,
      contrast: 1.35,
    },
    transcribing: {
      speed: 4.7,
      drift: 0.15,
      swirl: 0.02,
      bulge: 0.38,
      warp: 0.34,
      zoom: 1.12,
      ripple: 0.18,
      edgeGain: 33,
      blur: 2.75,
      fringe: 0.2,
      exposure: 0.55,
      contrast: 1.5,
      saturation: 2,
      light: 0.525,
      rim: 0.69,
    },
  },
};

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  return mountOrb(container, api, VARIANTS);
}
