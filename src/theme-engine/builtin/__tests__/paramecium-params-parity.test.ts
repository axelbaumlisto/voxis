import { describe, expect, it, vi } from "vitest";
import { createCellRenderer } from "../../renderers/cell";
import { THEME_API_VERSION, type ThemeApi, type ThemeModule } from "../../contract";

vi.mock("../../renderers/cell", () => ({
  createCellRenderer: vi.fn(() => ({ update() {}, destroy() {} })),
}));

const EXPECTED_DRIFTING_CONTOUR_PARAMS = {
  baseHue: 50,
  noiseScale: 0.9,
  octaves: 4,
  lacunarity: 2.3,
  gain: 0.55,
  timeScale: 0.3,
  membraneAmplitude: 0.35,
  energyDrive: 0.8,
  push: 3,
  sharpness: 4,
  intentDrift: 0.08,
  idle: 0.1,
  levelGain: 0.7,
  hueSpread: 8,
  shimmerSpeed: 0.04,
  hueBoost: 4,
  fillAlpha: 0.12,
  fillAlphaActive: 0.45,
  membraneSat: 0.12,
  membraneLightness: 0.75,
  membraneLightnessActive: 0.88,
  cytoplasmSat: 0.1,
  ciliaSat: 0.08,
  granuleSat: 0.1,
  nucleusSatMul: 0.25,
  foodVacuoleHue: 38,
  cvHue: 170,
  vacuoleMaxFrac: 0.13,
  cvAnteriorS: 0.52,
  cvPosteriorS: 0.52,
  tension: 0.15,
  ciliaCount: 18,
  ciliaLength: 0.4,
  ciliaWave: 0.5,
  ciliaWaveSpeed: 1.6,
  growthAttack: 0.05,
  growthRelease: 0.012,
  baseRadiusPx: 17,
  driftSpeed: 0.08,
  idleSwimFrac: 0.3,
  bodyHeadingTau: 1.5,
  interiorHeadingTau: 5,
  idleDriftMin: 0.7,
  driftMargin: 30,
  idleMorphAmplitude: 0.16,
  idleMorphSpeed: 0.22,
  idleMorphPeriod: 7,
  idleMorphFloor: 0.3,
  growthSwell: 0,
  swimSpeedMaxFrac: 0.045,
  startleSensitivity: 2.8,
  startleDecay: 0.96,
  startleMaxPx: 5,
  startleBaselineRate: 0.08,
  enableSomaticCilia: true,
  somaticCiliaCount: 104,
  ciliaGrowthBoost: 0,
  ciliaCurl: 0.32,
  ciliaLengthVar: 0.35,
  enableCiliaOnContour: true,
  enableRigidMembrane: true,
  enableBodyProfile: true,
  bodyProfileType: "egg",
  bodyProfileTaper: 0.2,
  bodyAspect: 3,
  bodyVentralBend: 0.18,
  enableAffine: true,
  enableCiliaStructure: true,
  enableAxialSpin: true,
  axialSpinMax: 1,
  nucleusAlpha: 0.85,
  enableVacuoles: true,
  enableCVCanals: true,
  canalLenMul: 2.5,
  canalLineWidth: 1,
  canalAlphaMul: 0.25,
  enableOralGroove: true,
  oralGrooveDepth: 0.08,
  oralGrooveWidth: 0.8,
  cyclosisActivityBoost: 0.4,
  enableEctoplasm: true,
  ectoplasmFrac: 0.93,
  ectoplasmAlpha: 0.22,
  helicalAmplitude: 0.3,
  enableWallReorient: true,
  enableRotationalBrownian: true,
  rotationalDiffusion: 0.02,
  foodVacuoleSizeMul: 1.4,
  foodVacuoleLoopMaxAmp: 0.78,
  enableTrichocysts: false,
  trichocystCount: 30,
  trichocystLengthMul: 3,
  trichocystDecay: 3,
  trichocystLineWidth: 1.5,
  enableMetachronal: true,
  metachronalWavelength: 20,
  metachronalSpeed: 1.5,
  metachronalDepth: 0.35,
  ciliaBeatHz: 0.5,
  ciliaBeatHzActive: 0.9,
  caudalTuftLength: 1.2,
  nucleusIndent: 0.3,
  foodVacuoleSat: 0.25,
  enableCyclosis: true,
  cyclosisGranuleCount: 40,
  granuleSizePx: 1.6,
  enableOrganelles: true,
  foodVacuoleCount: 8,
  enableInteriorField: true,
  cyclosisPeriod: 65,
  enableAquarium: true,
  aquariumSeed: 2,
  aquariumAlpha: 0.68,
  aquariumActivityBoost: 1,
  diatomCount: 0,
  diatomAlpha: 0.16,
  diatomDriftSpeed: 0.35,
  euglenaCount: 1,
  euglenaSpeed: 0.25,
  euglenaSpeedActive: 0.5,
  euglenaScale: 2.4,
  euglenaFlagellumRateScale: 0.45,
  euglenaGravitaxis: 0.01,
  euglenaPhototaxis: 0,
  euglenaPhotoIntent: 0.55,
  euglenaMotorEnabled: true,
  euglenaLoiter: 0,
  euglenaWake: 0,
  euglenaRotDiffusion: 0,
  vorticellaCount: 1,
  vorticellaScale: 2.6,
  vorticellaAlongFrac: 0.35,
  vorticellaContractRate: 1.2,
} as const;

// duo_aquarium = the 2-hero counterpart: same Paramecium SoT, but Euglena uses
// its independent motor profile and omits all vorticella preview params.
const EXPECTED_DUO_AQUARIUM_PARAMS = {
  ...EXPECTED_DRIFTING_CONTOUR_PARAMS,
  aquariumSeed: 2,
  euglenaSpeed: 0.29,
  euglenaSpeedActive: 0.62,
  euglenaScale: 2.7,
  euglenaFlagellumRateScale: 0.55,
  euglenaGravitaxis: 0.02,
  euglenaPhototaxis: 0,
  euglenaPhotoIntent: 0.8,
  euglenaMotorEnabled: true,
  euglenaLoiter: 0,
  euglenaWake: 0,
  euglenaRotDiffusion: 0,
  vorticellaCount: 0,
  vorticellaScale: undefined,
  vorticellaAlongFrac: undefined,
  vorticellaContractRate: undefined,
} as const;

const EXPECTED_PARAMECIUM_SOLO_PARAMS = {
  baseHue: 50,
  noiseScale: 0.9,
  octaves: 4,
  lacunarity: 2.3,
  gain: 0.55,
  timeScale: 0.3,
  membraneAmplitude: 0.35,
  energyDrive: 0.8,
  push: 3,
  sharpness: 4,
  intentDrift: 0.08,
  idle: 0.1,
  levelGain: 0.7,
  hueSpread: 8,
  shimmerSpeed: 0.04,
  hueBoost: 4,
  fillAlpha: 0.12,
  fillAlphaActive: 0.45,
  membraneSat: 0.12,
  membraneLightness: 0.75,
  membraneLightnessActive: 0.88,
  cytoplasmSat: 0.1,
  ciliaSat: 0.08,
  granuleSat: 0.1,
  nucleusSatMul: 0.25,
  foodVacuoleHue: 38,
  cvHue: 170,
  vacuoleMaxFrac: 0.13,
  cvAnteriorS: 0.52,
  cvPosteriorS: 0.52,
  tension: 0.15,
  ciliaCount: 18,
  ciliaLength: 0.4,
  ciliaWave: 0.5,
  ciliaWaveSpeed: 1.6,
  growthAttack: 0.05,
  growthRelease: 0.012,
  baseRadiusPx: 17,
  driftSpeed: 0.08,
  idleSwimFrac: 0.3,
  bodyHeadingTau: 1.5,
  interiorHeadingTau: 5,
  idleDriftMin: 0.7,
  driftMargin: 30,
  idleMorphAmplitude: 0.16,
  idleMorphSpeed: 0.22,
  idleMorphPeriod: 7,
  idleMorphFloor: 0.3,
  growthSwell: 0,
  swimSpeedMaxFrac: 0.045,
  startleSensitivity: 2.8,
  startleDecay: 0.96,
  startleMaxPx: 5,
  startleBaselineRate: 0.08,
  enableSomaticCilia: true,
  somaticCiliaCount: 104,
  ciliaGrowthBoost: 0,
  ciliaCurl: 0.32,
  ciliaLengthVar: 0.35,
  enableCiliaOnContour: true,
  enableRigidMembrane: true,
  enableBodyProfile: true,
  bodyProfileType: "egg",
  bodyProfileTaper: 0.2,
  bodyAspect: 3,
  bodyVentralBend: 0.18,
  enableAffine: true,
  enableCiliaStructure: true,
  enableAxialSpin: true,
  axialSpinMax: 1,
  nucleusAlpha: 0.85,
  enableVacuoles: true,
  enableCVCanals: true,
  canalLenMul: 2.5,
  canalLineWidth: 1,
  canalAlphaMul: 0.25,
  enableOralGroove: true,
  oralGrooveDepth: 0.08,
  oralGrooveWidth: 0.8,
  cyclosisActivityBoost: 0.4,
  enableEctoplasm: true,
  ectoplasmFrac: 0.93,
  ectoplasmAlpha: 0.22,
  helicalAmplitude: 0.3,
  enableWallReorient: true,
  enableRotationalBrownian: true,
  rotationalDiffusion: 0.02,
  foodVacuoleSizeMul: 1.4,
  foodVacuoleLoopMaxAmp: 0.78,
  enableTrichocysts: false,
  trichocystCount: 30,
  trichocystLengthMul: 3,
  trichocystDecay: 3,
  trichocystLineWidth: 1.5,
  enableMetachronal: true,
  metachronalWavelength: 20,
  metachronalSpeed: 1.5,
  metachronalDepth: 0.35,
  ciliaBeatHz: 0.5,
  ciliaBeatHzActive: 0.9,
  caudalTuftLength: 1.2,
  nucleusIndent: 0.3,
  foodVacuoleSat: 0.25,
  enableCyclosis: true,
  cyclosisGranuleCount: 40,
  granuleSizePx: 1.6,
  enableOrganelles: true,
  foodVacuoleCount: 8,
  enableInteriorField: true,
  cyclosisPeriod: 65,
  enableAquarium: false,
} as const;

function fakeApi(params: Record<string, unknown> = {}): ThemeApi {
  return {
    apiVersion: THEME_API_VERSION,
    params,
    size: { width: 240, height: 80 },
    onState: () => () => {},
    actions: { cancel: () => {} },
  };
}

type ParityTheme = "drifting_contour" | "paramecium_solo" | "duo_aquarium";

async function importTheme(themeName: ParityTheme): Promise<ThemeModule> {
  if (themeName === "drifting_contour") {
    return import("../drifting_contour");
  }
  if (themeName === "duo_aquarium") {
    return import("../duo_aquarium");
  }
  return import("../paramecium_solo");
}

async function mountTheme(themeName: ParityTheme, params: Record<string, unknown> = {}) {
  const rendererSpy = vi.mocked(createCellRenderer);
  rendererSpy.mockClear();
  const theme = await importTheme(themeName);
  const container = document.createElement("div");
  const instance = theme.mount(container, fakeApi(params));
  const options = rendererSpy.mock.calls[0]?.[1];
  instance.unmount();
  expect(options).toBeDefined();
  return { baseHue: options!.baseHue, ...options!.params };
}

describe("paramecium theme merged params parity", () => {
  it("freezes drifting_contour merged params from source mount", async () => {
    await expect(mountTheme("drifting_contour")).resolves.toEqual(EXPECTED_DRIFTING_CONTOUR_PARAMS);
  });

  it("freezes paramecium_solo merged params from source mount", async () => {
    await expect(mountTheme("paramecium_solo")).resolves.toEqual(EXPECTED_PARAMECIUM_SOLO_PARAMS);
  });

  it("freezes duo_aquarium merged params from source mount", async () => {
    await expect(mountTheme("duo_aquarium")).resolves.toEqual(EXPECTED_DUO_AQUARIUM_PARAMS);
  });

  it("keeps user params last so drifting_contour overrides can disable the motor", async () => {
    await expect(mountTheme("drifting_contour", {
      euglenaMotorEnabled: false,
      euglenaPhototaxis: 0.7,
      euglenaRotDiffusion: 0.2,
      euglenaLoiter: 1.1,
      euglenaWake: 10,
      euglenaScale: 99,
      fillAlpha: 0.99,
    })).resolves.toMatchObject({
      euglenaMotorEnabled: false,
      euglenaPhototaxis: 0.7,
      euglenaRotDiffusion: 0.2,
      euglenaLoiter: 1.1,
      euglenaWake: 10,
      euglenaScale: 99,
      fillAlpha: 0.99,
    });
  });

  it("keeps duo user params last so overrides can disable the motor", async () => {
    await expect(mountTheme("duo_aquarium", {
      euglenaMotorEnabled: false,
      euglenaPhototaxis: 0.7,
      euglenaRotDiffusion: 0.2,
      euglenaLoiter: 1.1,
      euglenaWake: 10,
    })).resolves.toMatchObject({
      euglenaMotorEnabled: false,
      euglenaPhototaxis: 0.7,
      euglenaRotDiffusion: 0.2,
      euglenaLoiter: 1.1,
      euglenaWake: 10,
    });
  });
});
