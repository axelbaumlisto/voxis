// src/theme-engine/builtin/__tests__/drifting-contour-params.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_PATH = join(process.cwd(), "src/theme-engine/builtin/drifting_contour/index.ts");
const BUNDLE_PATH = join(process.cwd(), "src-tauri/themes/drifting_contour/theme.js");

const CRITICAL_PARAMS = {
  baseHue: 50,
  fillAlpha: 0.12,
  fillAlphaActive: 0.45,
  membraneSat: 0.12,
  cytoplasmSat: 0.10,
  ciliaSat: 0.08,
  granuleSat: 0.10,
  enableSomaticCilia: true,
  somaticCiliaCount: 104,
  ciliaGrowthBoost: 0.0,
  enableTrichocysts: false,
  swimSpeedMaxFrac: 0.045,
  idleSwimFrac: 0.30,
  idleDriftMin: 0.70,
  bodyHeadingTau: 1.5,
  interiorHeadingTau: 5.0,
  cyclosisPeriod: 65,
  cyclosisActivityBoost: 0.4,
  cyclosisGranuleCount: 40,
  foodVacuoleSizeMul: 1.4,
  foodVacuoleLoopMaxAmp: 0.78,
  foodVacuoleCount: 8,
  vacuoleMaxFrac: 0.13,
  cvAnteriorS: 0.52,
  cvPosteriorS: 0.52,
  canalAlphaMul: 0.25,
  enableAquarium: true,
  aquariumSeed: 5,
  aquariumAlpha: 0.68,
  aquariumActivityBoost: 0.25,
  diatomCount: 0,
  diatomAlpha: 0.16,
  diatomDriftSpeed: 0.35,
  euglenaCount: 1,
  euglenaSpeed: 0.15,
  euglenaSpeedActive: 0.30,
  // (euglena_drift retuned separately; drifting_contour companion unchanged here)
  euglenaScale: 6.45,
  vorticellaCount: 0,
} as const;

type CriticalParamName = keyof typeof CRITICAL_PARAMS;
type CriticalParamValue = (typeof CRITICAL_PARAMS)[CriticalParamName];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readSourceMountBody(): string {
  const source = readFileSync(SOURCE_PATH, "utf8");
  const start = source.indexOf("export function mount");
  const end = source.indexOf("const unsubscribe", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

function readBundleMountBody(): string {
  const source = readFileSync(BUNDLE_PATH, "utf8");
  const marker = "// src/theme-engine/builtin/drifting_contour/index.ts";
  const markerStart = source.indexOf(marker);
  const start = source.indexOf("function mount", markerStart);
  const end = source.indexOf("const unsubscribe", start);
  expect(markerStart).toBeGreaterThanOrEqual(0);
  expect(start).toBeGreaterThan(markerStart);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

function readSourceMountBlock(): string {
  const body = readSourceMountBody();
  const end = body.indexOf("...userParams");
  expect(end).toBeGreaterThanOrEqual(0);
  return body.slice(0, end);
}

function readBundleMountBlock(): string {
  const body = readBundleMountBody();
  const end = body.indexOf("...userParams");
  expect(end).toBeGreaterThanOrEqual(0);
  return body.slice(0, end);
}

function readParam(block: string, name: CriticalParamName): CriticalParamValue {
  const match = block.match(new RegExp(`\\b${escapeRegExp(name)}\\s*:\\s*(true|false|-?\\d+(?:\\.\\d+)?)\\b`));
  expect(match, `Expected ${name} to be present in mount params`).not.toBeNull();

  const literal = match![1];
  if (literal === "true") return true;
  if (literal === "false") return false;
  return Number(literal);
}

function expectCriticalParams(block: string): void {
  for (const [name, expected] of Object.entries(CRITICAL_PARAMS) as Array<[CriticalParamName, CriticalParamValue]>) {
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

function expectNoVorticellaPreviewParams(block: string): void {
  expect(block).not.toMatch(/\bvorticella(?:ContractRate|ContractRateActive|Scale)\s*:/i);
}

describe("drifting_contour v1.0 critical params", () => {
  it("freezes approved source theme params", () => {
    expectCriticalParams(readSourceMountBlock());
  });

  it("freezes approved built bundle mount params", () => {
    expectCriticalParams(readBundleMountBlock());
  });

  it("opts source theme into Phase 5B one-Euglena aquarium preview", () => {
    expectNoVorticellaPreviewParams(readSourceMountBlock());
  });

  it("opts built bundle into Phase 5B one-Euglena aquarium preview", () => {
    expectNoVorticellaPreviewParams(readBundleMountBlock());
  });

  it("keeps source theme params before user params so user overrides win", () => {
    expectUserParamsLast(readSourceMountBody());
  });

  it("keeps built bundle theme params before user params so user overrides win", () => {
    expectUserParamsLast(readBundleMountBody());
  });
});
