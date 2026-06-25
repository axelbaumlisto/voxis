import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createCellRenderer } from "../../renderers/cell";
import { THEME_API_VERSION, type ThemeApi } from "../../contract";

vi.mock("../../renderers/cell", () => ({
  createCellRenderer: vi.fn(() => ({ update() {}, destroy() {} })),
}));

const THEME_PATH = {
  source: join(process.cwd(), "src/theme-engine/builtin/euglena_drift/index.ts"),
  bundle: join(process.cwd(), "src-tauri/themes/euglena_drift/theme.js"),
  marker: "// src/theme-engine/builtin/euglena_drift/index.ts",
} as const;

const EXPECTED_EUGLENA_DRIFT_CRITICAL_PARAMS = {
  enableHero: false,
  enableAquarium: true,
  aquariumSeed: 17,
  aquariumAlpha: 1.0,
  aquariumActivityBoost: 0.6,
  diatomCount: 0,
  euglenaCount: 1,
  euglenaSpeed: 0.19,
  euglenaSpeedActive: 0.54,
  euglenaScale: 4.05,
  euglenaFlagellumRateScale: 0.45,
  euglenaGravitaxis: 0.02,
  euglenaPhototaxis: 0,
  euglenaPhotoIntent: 1.2,
  euglenaMotorEnabled: true,
  euglenaLoiter: 0,
  euglenaWake: 0,
  euglenaRotDiffusion: 0,
  vorticellaCount: 0,
} as const;

type ParamValue = boolean | number;

function fakeApi(params: Record<string, unknown> = {}): ThemeApi {
  return {
    apiVersion: THEME_API_VERSION,
    params,
    size: { width: 320, height: 160 },
    onState: () => () => {},
    actions: { cancel: () => {} },
  };
}

async function mountEuglenaDrift(params: Record<string, unknown> = {}) {
  const rendererSpy = vi.mocked(createCellRenderer);
  rendererSpy.mockClear();
  const theme = await import("../euglena_drift");
  const container = document.createElement("div");
  const instance = theme.mount(container, fakeApi(params));
  const options = rendererSpy.mock.calls[0]?.[1];
  instance.unmount();
  expect(options).toBeDefined();
  return options!;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readSourceMountBody(): string {
  const source = readFileSync(THEME_PATH.source, "utf8");
  const start = source.indexOf("export function mount");
  const end = source.indexOf("const unsubscribe", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

function readBundleMountBody(): string {
  const source = readFileSync(THEME_PATH.bundle, "utf8");
  const markerStart = source.indexOf(THEME_PATH.marker);
  const start = source.indexOf("function mount", markerStart);
  const end = source.indexOf("const unsubscribe", start);
  expect(markerStart).toBeGreaterThanOrEqual(0);
  expect(start).toBeGreaterThan(markerStart);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

function readMountBlock(body: string): string {
  const end = body.indexOf("...userParams");
  expect(end).toBeGreaterThanOrEqual(0);
  return body.slice(0, end);
}

function readParam(block: string, name: string): ParamValue {
  const match = block.match(new RegExp(`\\b${escapeRegExp(name)}\\s*:\\s*(true|false|-?\\d+(?:\\.\\d+)?)\\b`));
  expect(match, `Expected ${name} to be present in params block`).not.toBeNull();

  const literal = match![1];
  if (literal === "true") return true;
  if (literal === "false") return false;
  return Number(literal);
}

function expectParams(block: string, params: Record<string, ParamValue>): void {
  for (const [name, expected] of Object.entries(params)) {
    expect(readParam(block, name), name).toBe(expected);
  }
}

function expectUserParamsLast(body: string): void {
  const paramsStart = body.indexOf("params: {");
  const userParams = body.indexOf("...userParams", paramsStart);
  const paramsEnd = body.indexOf("}", userParams);
  expect(paramsStart).toBeGreaterThanOrEqual(0);
  expect(userParams).toBeGreaterThan(paramsStart);
  expect(paramsEnd).toBeGreaterThan(userParams);
  expect(body.slice(userParams + "...userParams".length, paramsEnd)).not.toMatch(/\w+\s*:/);
}

describe("euglena_drift source and bundle params", () => {
  it("passes the solo motor profile to createCellRenderer", async () => {
    const options = await mountEuglenaDrift();

    expect(options.baseHue).toBe(50);
    expect(options.width).toBe(320);
    expect(options.height).toBe(160);
    expect(options.params).toMatchObject(EXPECTED_EUGLENA_DRIFT_CRITICAL_PARAMS);
  });

  it("keeps user params last so overrides can disable the motor", async () => {
    const options = await mountEuglenaDrift({
      euglenaMotorEnabled: false,
      euglenaPhototaxis: 0.7,
      euglenaRotDiffusion: 0.2,
      euglenaLoiter: 1.1,
      euglenaWake: 10,
    });

    expect(options.params).toMatchObject({
      euglenaMotorEnabled: false,
      euglenaPhototaxis: 0.7,
      euglenaRotDiffusion: 0.2,
      euglenaLoiter: 1.1,
      euglenaWake: 10,
    });
  });

  it("keeps source mount params inline and user params last", () => {
    const body = readSourceMountBody();
    expectParams(readMountBlock(body), EXPECTED_EUGLENA_DRIFT_CRITICAL_PARAMS);
    expectUserParamsLast(body);
  });

  it("keeps generated bundle mount params inline and user params last", () => {
    const body = readBundleMountBody();
    expectParams(readMountBlock(body), EXPECTED_EUGLENA_DRIFT_CRITICAL_PARAMS);
    expectUserParamsLast(body);
  });
});
