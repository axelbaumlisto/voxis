// orb_shdr_05 — Rainbow rings travelling through a lattice of lenses: componentwise tangent has a pole every PI, so the plane is cut into a square lattice of cells whose walls throw the coordinate to infinity, and adding the position back to its own tangent offsets every cell so each shows a different part of the ring field instead of tiling one image. One cosine of the length of that, at three channel phases under a radian apart, gives white band cores with coloured shoulders — and the tangent is softened so the rings crowd to a finite limit at the walls rather than to unbounded bandwidth no supersampling could resolve
//
// PORTED FROM ORBKIT (https://github.com/zzzzshawn/orbkit), orb `shdr-05`
// ("SHDR-05") — shader by XORDEV: NON-COMMERCIAL use only, attribution required.
// Shader body verbatim; the prelude, the colour uniforms and the WebGL lifetime
// live in `_shared/orb-kit.ts`.
//
// Mode map: idle → orbkit `idle`, recording → `speaking` (`uInput` ← the live
// audioLevel), transcribing → `thinking`. Rates (ring, swirl, slide) are
// orbkit `integrate: true` and are accumulated into clocks by the kit.
import { mountOrb, type OrbVariant } from "../_shared/orb-kit";
import type { ThemeApi, ThemeInstance } from "../../contract";

const FRAG = `
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

const DEFAULTS = { ring: 0.9, swirl: 0.05, slide: 0.12, radius: 0.9, scale: 5, bulge: 0.3, lens: 1, poleSoft: 0.02, freq: 1, spread: 1, gain: 1.1, contrast: 1, saturation: 1.15, floorLevel: 0.12, light: 0.4, rim: 0.45 } as const;

const VARIANTS: OrbVariant = {
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
      light: 0.66,
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
      contrast: 0.75,
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
      rim: 0,
    },
  },
};

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  return mountOrb(container, api, VARIANTS);
}
