import { describe, expect, it, vi } from "vitest";
import { createCellRenderer } from "../../renderers/cell";
import { THEME_API_VERSION, type ThemeApi } from "../../contract";

vi.mock("../../renderers/cell", () => ({
  createCellRenderer: vi.fn(() => ({ update() {}, destroy() {} })),
}));

const EXPECTED_ALL_AQUARIUM_CRITICAL_PARAMS = {
  radiusFraction: 0.19,
  enableAquarium: true,
  aquariumSeed: 13,
  euglenaSpeed: 0.34,
  euglenaSpeedActive: 0.65,
  euglenaFlagellumRateScale: 0.45,
  euglenaLoiter: 0,
  euglenaWake: 0.12,
  euglenaPhototaxis: 0,
  euglenaPhotoIntent: 2.4,
  euglenaGravitaxis: 0.03,
  vorticellaAlongFrac: 0.30,
  vorticellaScale: 1.12,
  didiniumSpeed: 1.55,
  didiniumSpeedActive: 2.2,
  didiniumScale: 1.60,
} as const;

function fakeApi(params: Record<string, unknown> = {}): ThemeApi {
  return {
    apiVersion: THEME_API_VERSION,
    params,
    size: { width: 340, height: 170 },
    onState: () => () => {},
    actions: { cancel: () => {} },
  };
}

async function mountAllAquarium(params: Record<string, unknown> = {}) {
  const rendererSpy = vi.mocked(createCellRenderer);
  rendererSpy.mockClear();
  const theme = await import("../all_aquarium");
  const container = document.createElement("div");
  const instance = theme.mount(container, fakeApi(params));
  const options = rendererSpy.mock.calls[0]?.[1];
  instance.unmount();
  expect(options).toBeDefined();
  return options!;
}

describe("all_aquarium source mount params", () => {
  it("passes the accepted critical aquarium params to createCellRenderer", async () => {
    const options = await mountAllAquarium();

    expect(options.baseHue).toBe(50);
    expect(options.width).toBe(340);
    expect(options.height).toBe(170);
    expect(options.params).toMatchObject(EXPECTED_ALL_AQUARIUM_CRITICAL_PARAMS);
  });

  it("keeps user params last so overrides win", async () => {
    const options = await mountAllAquarium({
      radiusFraction: 0.25,
      aquariumSeed: 99,
      euglenaSpeed: 0.5,
      euglenaSpeedActive: 0.9,
      euglenaFlagellumRateScale: 0.7,
      euglenaLoiter: 0.75,
      euglenaWake: 0.8,
      euglenaPhototaxis: 0.9,
      euglenaPhotoIntent: 0.2,
      euglenaGravitaxis: 0.4,
      vorticellaAlongFrac: 0.6,
      vorticellaScale: 2.4,
      didiniumSpeed: 3.1,
      didiniumSpeedActive: 4.2,
      didiniumScale: 2.8,
    });

    expect(options.params).toMatchObject({
      radiusFraction: 0.25,
      aquariumSeed: 99,
      euglenaSpeed: 0.5,
      euglenaSpeedActive: 0.9,
      euglenaFlagellumRateScale: 0.7,
      euglenaLoiter: 0.75,
      euglenaWake: 0.8,
      euglenaPhototaxis: 0.9,
      euglenaPhotoIntent: 0.2,
      euglenaGravitaxis: 0.4,
      vorticellaAlongFrac: 0.6,
      vorticellaScale: 2.4,
      didiniumSpeed: 3.1,
      didiniumSpeedActive: 4.2,
      didiniumScale: 2.8,
    });
  });
});
