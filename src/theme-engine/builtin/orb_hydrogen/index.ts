// orb_hydrogen — A quantum-orbital orb: |psi|^2 of a hydrogen-like wave function projected onto a rotating dome, shaded with rainbow chromatic bands over dark metal. Precession and a drifting flow field keep the pattern from ever visibly looping
//
// PORTED FROM ORBKIT (https://github.com/zzzzshawn/orbkit), orb `shdr-11`
// ("Hydrogen") — MIT.
// Shader body verbatim; the prelude, the colour uniforms and the WebGL lifetime
// live in `_shared/orb-kit.ts`.
//
// Mode map: idle → orbkit `idle`, recording → `speaking` (`uInput` ← the live
// audioLevel), transcribing → `thinking`. Rates (speed, flowSpeed) are
// orbkit `integrate: true` and are accumulated into clocks by the kit.
import { mountOrb, type OrbVariant } from "../_shared/orb-kit";
import type { ThemeApi, ThemeInstance } from "../../contract";

const FRAG = `
const float PI = 3.14159265359;
void main() {
  vec2 uv = orbUV();
  float r2d = length(uv);
  float R = uP_radius + uP_swell * uInput;
  float mask = smoothstep(0.012, -0.012, r2d - R);
  float nr = clamp(r2d / max(R, 0.001), 0.0, 1.0);
  float z = sqrt(max(1.0 - nr * nr, 0.0));

  // uP_speed and uP_flowSpeed arrive pre-integrated as clocks (see
  // OrbParamDef.integrate), so state transitions stay phase-continuous.
  // The state volumes reshape the orbital itself: the params set the base,
  // input/output excitement bends zoom, radial form, probability and chroma,
  // so each state settles into a different interference pattern.
  float posScale = uP_posScale * (0.8 + 0.45 * uOutput + 0.2 * uInput);
  float radialPow = uP_radialPow * (0.7 + 0.8 * uOutput);
  float radialDecay = uP_radialDecay * (1.25 - 0.5 * uOutput);
  float probPow = uP_probPow * (1.3 - 0.55 * uOutput);
  float probGain = uP_probGain * (0.7 + 0.6 * uOutput + 0.5 * uInput);
  float waveFreq = uP_waveFreq * (0.6 + 1.0 * uOutput);
  float chromaSpread = uP_chromaSpread * (0.6 + 0.9 * uOutput + 0.5 * uInput);

  // dome point rotated around Y — the fake 3D of the flat disc
  float animTime = uP_speed; // integrated clock
  float cosT = cos(animTime * uP_rotSpeed);
  float sinT = sin(animTime * uP_rotSpeed);
  vec3 sp = vec3(uv / max(R, 0.001), z) * posScale;
  vec3 pos = vec3(sp.x * cosT - sp.z * sinT, sp.y, sp.x * sinT + sp.z * cosT);

  // precession: the rotation axis itself drifts, so the pattern never
  // settles into a repeating spin
  float tilt = sin(animTime * 0.21 + 1.7) * uP_precess;
  float cx = cos(tilt), sx = sin(tilt);
  pos = vec3(pos.x, pos.y * cx - pos.z * sx, pos.y * sx + pos.z * cx);

  // liquid flow: drifting fbm warps the 3D domain, so the wave function
  // smears and migrates around the sphere instead of wobbling in place.
  // (sampled on pos components — continuous everywhere, no phi seam)
  float flowT = uP_flowSpeed; // integrated clock
  float fAmp = uP_flowAmp * (0.7 + 0.6 * uOutput + 0.4 * uInput);
  vec3 w;
  w.x = fbm(pos.yz * uP_flowScale + vec2(flowT * 0.70, -flowT * 0.40));
  w.y = fbm(pos.zx * uP_flowScale + vec2(-flowT * 0.55, flowT * 0.62) + 3.7);
  w.z = fbm(pos.xy * uP_flowScale + vec2(flowT * 0.50, flowT * 0.85) + 7.1);
  pos += (w - 0.5) * fAmp;

  float r = length(pos) + 0.001;
  float theta = acos(clamp(pos.y / r, -1.0, 1.0));
  float phi = atan(pos.z, pos.x);

  float a0 = 0.5;
  float rho = 2.0 * r / (5.0 * a0);
  float radial = pow(rho, radialPow) * exp(-rho / radialDecay);
  float angular = pow(sin(theta), 3.0) * cos(phi + animTime * 0.2); // single lobe

  float psi = radial * angular;
  float probability = psi * psi;

  // travelling spiral wave — the modulation moves across the surface instead
  // of pulsing in place. The azimuthal harmonic count must be a whole number,
  // else sin(phi * f) doesn't line up across the +/-PI wrap and leaves a
  // vertical meridian seam. Snap it to the nearest integer.
  float waveN = max(1.0, floor(waveFreq + 0.5));
  float wavePhase = phi * waveN + theta * 2.5 - animTime * 2.0;
  probability *= (0.85 + 0.15 * sin(wavePhase));

  // drifting bright patches, like convection cells wandering the surface
  float patches = fbm(pos.xy * 1.6 + vec2(flowT * 0.4, -flowT * 0.3));
  probability *= 0.65 + 0.7 * patches;

  probability = pow(probability, probPow) * probGain;
  probability = clamp(probability, 0.0, 1.0);

  float fresnel = pow(1.0 - z, 1.5);

  // rainbow chromatic aberration
  float chromaOffset = phi * 2.0 + theta * 1.5 + animTime * 0.3 + probability * 3.0;
  vec3 rainbow;
  rainbow.r = sin(chromaOffset) * 0.5 + 0.5;
  rainbow.g = sin(chromaOffset + chromaSpread) * 0.5 + 0.5;
  rainbow.b = sin(chromaOffset + chromaSpread * 2.0) * 0.5 + 0.5;
  rainbow = normalize(rainbow + 0.01) * length(rainbow);

  float bandFreq = chromaOffset * 3.0 + fresnel * 2.4;
  vec3 chromaticBands;
  chromaticBands.r = sin(bandFreq) * 0.5 + 0.5;
  chromaticBands.g = sin(bandFreq + 2.094) * 0.5 + 0.5;
  chromaticBands.b = sin(bandFreq + 4.189) * 0.5 + 0.5;

  vec3 glowColor = mix(rainbow, chromaticBands, 0.12);
  glowColor = pow(glowColor, vec3(0.8));

  vec3 darkMetal = vec3(uP_metalDark);
  vec3 lightMetal = mix(vec3(0.9, 0.92, 0.95), glowColor, 0.7);

  float metalGradient = smoothstep(0.0, 1.0, probability * 0.7 + fresnel * 0.3);
  vec3 metalColor = mix(darkMetal, lightMetal, metalGradient);

  float orbGlow = uP_glow + 0.6 * uOutput;
  float totalGlow = (0.25 + fresnel * 0.6 + probability * 0.8) * orbGlow;
  float glowAmount = clamp(pow(totalGlow, 0.7), 0.0, 1.0);

  vec3 surfaceColor = mix(metalColor, glowColor, glowAmount);

  vec3 normal = vec3(uv / max(R, 0.001), z);
  float specular = pow(max(dot(normal, normalize(vec3(1.0, 1.0, 2.0))), 0.0), 32.0);
  surfaceColor += mix(vec3(1.0), glowColor, 0.6) * specular * 0.4;

  float visibility = clamp(probability * 1.2 + fresnel * 0.3 + uP_baseVis + uInput * 0.15, 0.0, 1.0);

  float a = mask * visibility;
  gl_FragColor = vec4(surfaceColor * a, a);
}
`;

const DEFAULTS = { speed: 0.9, rotSpeed: 0.5, radius: 0.9, swell: 0.07, posScale: 0.5, flowSpeed: 0.35, flowAmp: 0.45, flowScale: 0.3, precess: 0.3, radialPow: 0.5, radialDecay: 1, probPow: 0.4, probGain: 3, waveFreq: 4, chromaSpread: 0.18, glow: 0.9, metalDark: 0, baseVis: 0.12 } as const;

const VARIANTS: OrbVariant = {
  id: "orb_hydrogen",
  frag: FRAG,
  defaults: DEFAULTS,
  clocks: ["speed", "flowSpeed"],
  colors: {  },
  presets: {
    idle: {
      speed: 0.9,
      rotSpeed: 0.5,
      radius: 0.9,
      swell: 0.07,
      posScale: 0.5,
      flowSpeed: 0.35,
      flowAmp: 0.45,
      flowScale: 0.3,
      precess: 0.3,
      radialPow: 0.5,
      radialDecay: 1,
      probPow: 0.4,
      probGain: 3,
      waveFreq: 4,
      chromaSpread: 0.18,
      glow: 0.9,
      metalDark: 0,
      baseVis: 0.12,
    },
    recording: {
      speed: 2.45,
      rotSpeed: 0.5,
      radius: 0.9,
      swell: 0.07,
      posScale: 1,
      flowSpeed: 2.75,
      flowAmp: 0.8,
      flowScale: 2.2,
      precess: 1.3,
      radialPow: 0.5,
      radialDecay: 1,
      probPow: 0.31,
      probGain: 4.3,
      waveFreq: 4,
      chromaSpread: 0.12,
      glow: 0.9,
      metalDark: 0,
      baseVis: 0.12,
    },
    transcribing: {
      speed: 0.9,
      rotSpeed: 0.5,
      radius: 0.9,
      swell: 0.07,
      posScale: 0.65,
      flowSpeed: 0.35,
      flowAmp: 1.1,
      flowScale: 0.3,
      precess: 0,
      radialPow: 0.5,
      radialDecay: 1.9,
      probPow: 0.4,
      probGain: 3,
      waveFreq: 4,
      chromaSpread: 0.41,
      glow: 0.9,
      metalDark: 0,
      baseVis: 0.12,
    },
  },
};

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  return mountOrb(container, api, VARIANTS);
}
