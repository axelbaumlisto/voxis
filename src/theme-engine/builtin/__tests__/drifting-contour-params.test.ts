// src/theme-engine/builtin/__tests__/drifting-contour-params.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PARAMECIUM_BASE_HUE, PARAMECIUM_CELL_PARAMS } from "../_shared/paramecium";

const THEME_PATHS = {
  drifting_contour: {
    source: join(process.cwd(), "src/theme-engine/builtin/drifting_contour/index.ts"),
    bundle: join(process.cwd(), "src-tauri/themes/drifting_contour/theme.js"),
    marker: "// src/theme-engine/builtin/drifting_contour/index.ts",
  },
  paramecium_solo: {
    source: join(process.cwd(), "src/theme-engine/builtin/paramecium_solo/index.ts"),
    bundle: join(process.cwd(), "src-tauri/themes/paramecium_solo/theme.js"),
    marker: "// src/theme-engine/builtin/paramecium_solo/index.ts",
  },
} as const;

type ThemeName = keyof typeof THEME_PATHS;

const BASE_CRITICAL = {
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
} as const;

const AQUARIUM_CRITICAL = {
  enableAquarium: true,
  aquariumSeed: 17,
  aquariumAlpha: 0.68,
  aquariumActivityBoost: 1.0,
  diatomCount: 0,
  diatomAlpha: 0.16,
  diatomDriftSpeed: 0.35,
  euglenaCount: 1,
  euglenaSpeed: 0.20,
  euglenaSpeedActive: 1.5,
  euglenaScale: 2.8,
  euglenaGravitaxis: 0.2,
  euglenaPhototaxis: 0.6,
  euglenaRotDiffusion: 0.12,
  vorticellaCount: 0,
} as const;

type ParamValue = boolean | number;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sourceText(theme: ThemeName): string {
  return readFileSync(THEME_PATHS[theme].source, "utf8");
}

function bundleText(theme: ThemeName): string {
  return readFileSync(THEME_PATHS[theme].bundle, "utf8");
}

function readSourceMountBody(theme: ThemeName): string {
  const source = sourceText(theme);
  const start = source.indexOf("export function mount");
  const end = source.indexOf("const unsubscribe", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

function readBundleMountBody(theme: ThemeName): string {
  const source = bundleText(theme);
  const markerStart = source.indexOf(THEME_PATHS[theme].marker);
  const start = source.indexOf("function mount", markerStart);
  const end = source.indexOf("const unsubscribe", start);
  expect(markerStart).toBeGreaterThanOrEqual(0);
  expect(start).toBeGreaterThan(markerStart);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

function readSourceMountBlock(theme: ThemeName): string {
  const body = readSourceMountBody(theme);
  const end = body.indexOf("...userParams");
  expect(end).toBeGreaterThanOrEqual(0);
  return body.slice(0, end);
}

function readBundleMountBlock(theme: ThemeName): string {
  const body = readBundleMountBody(theme);
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

function expectNoVorticellaPreviewParams(block: string): void {
  // duo theme only — vorticella is a separate theme (vorticella_bloom)
  expect(block).not.toMatch(/\bvorticella(?:Scale|AlongFrac|ContractRate|ContractRateActive)\s*:/i);
}

function expectSharedSpreadBeforeUserParams(body: string): void {
  const sharedSpread = body.indexOf("...PARAMECIUM_CELL_PARAMS");
  const userParams = body.indexOf("...userParams");
  expect(sharedSpread).toBeGreaterThanOrEqual(0);
  expect(userParams).toBeGreaterThan(sharedSpread);
}

function sliceBundledVarObject(source: string, varName: string): string {
  const match = new RegExp(`(?:var|const|let)\\s+${escapeRegExp(varName)}\\s*=\\s*{`).exec(source);
  expect(match, `Expected bundled ${varName} object`).not.toBeNull();

  const open = match!.index + match![0].lastIndexOf("{");
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  throw new Error(`Unclosed bundled ${varName} object`);
}

function readBundledNumberVar(source: string, varName: string): number {
  const match = new RegExp(`(?:var|const|let)\\s+${escapeRegExp(varName)}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)\\b`).exec(source);
  expect(match, `Expected bundled ${varName} number`).not.toBeNull();
  return Number(match![1]);
}

describe("drifting_contour v1.0 critical params", () => {
  it("freezes the shared paramecium SoT critical values", () => {
    expect(PARAMECIUM_BASE_HUE).toBe(50);
    expect(PARAMECIUM_CELL_PARAMS).toMatchObject(BASE_CRITICAL);
    expect(Object.keys(PARAMECIUM_CELL_PARAMS).filter((key) => /^vorticella/i.test(key))).toEqual([]);
  });

  it("keeps source themes spreading the shared SoT before user params", () => {
    for (const theme of Object.keys(THEME_PATHS) as ThemeName[]) {
      const body = readSourceMountBody(theme);
      expectSharedSpreadBeforeUserParams(body);
      expectUserParamsLast(body);
    }
  });

  it("keeps built bundle themes spreading the shared SoT before user params", () => {
    for (const theme of Object.keys(THEME_PATHS) as ThemeName[]) {
      const body = readBundleMountBody(theme);
      expectSharedSpreadBeforeUserParams(body);
      expectUserParamsLast(body);
    }
  });

  it("freezes drifting_contour source aquarium params inline", () => {
    expectParams(readSourceMountBlock("drifting_contour"), AQUARIUM_CRITICAL);
  });

  it("freezes drifting_contour built bundle aquarium params inline", () => {
    expectParams(readBundleMountBlock("drifting_contour"), AQUARIUM_CRITICAL);
  });

  it("freezes built bundle shared SoT critical values statically", () => {
    for (const theme of Object.keys(THEME_PATHS) as ThemeName[]) {
      const bundle = bundleText(theme);
      expect(readBundledNumberVar(bundle, "PARAMECIUM_BASE_HUE")).toBe(50);
      expectParams(sliceBundledVarObject(bundle, "PARAMECIUM_CELL_PARAMS"), BASE_CRITICAL);
    }
  });

  it("keeps the duo theme free of vorticella preview params", () => {
    expectNoVorticellaPreviewParams(readSourceMountBlock("drifting_contour"));
  });

  it("keeps the built bundle duo free of vorticella preview params", () => {
    const bundle = bundleText("drifting_contour");
    expectNoVorticellaPreviewParams(sliceBundledVarObject(bundle, "PARAMECIUM_CELL_PARAMS"));
    expectNoVorticellaPreviewParams(readBundleMountBlock("drifting_contour"));
  });
});
