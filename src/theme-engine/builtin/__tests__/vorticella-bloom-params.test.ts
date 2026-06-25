import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createCellRenderer } from "../../renderers/cell";
import { THEME_API_VERSION, type ThemeApi } from "../../contract";

vi.mock("../../renderers/cell", () => ({
  createCellRenderer: vi.fn(() => ({ update() {}, destroy() {} })),
}));

const EXPECTED_VORTICELLA_BLOOM_PARAMS = {
  enableHero: false,
  enableAquarium: true,
  aquariumSeed: 3,
  aquariumAlpha: 0.92,
  aquariumActivityBoost: 0.6,
  diatomCount: 0,
  euglenaCount: 0,
  vorticellaCount: 1,
  vorticellaContractRate: 1.2,
  vorticellaScale: 1.8,
} as const;

const SOURCE = join(process.cwd(), "src/theme-engine/builtin/vorticella_bloom/index.ts");
const BUNDLE = join(process.cwd(), "src-tauri/themes/vorticella_bloom/theme.js");
const BUNDLE_MARKER = "// src/theme-engine/builtin/vorticella_bloom/index.ts";

function fakeApi(params: Record<string, unknown> = {}): ThemeApi {
  return {
    apiVersion: THEME_API_VERSION,
    params,
    size: { width: 320, height: 160 },
    onState: () => () => {},
    actions: { cancel: () => {} },
  };
}

async function mountVorticellaBloom(params: Record<string, unknown> = {}) {
  const rendererSpy = vi.mocked(createCellRenderer);
  rendererSpy.mockClear();
  const theme = await import("../vorticella_bloom");
  const container = document.createElement("div");
  const instance = theme.mount(container, fakeApi(params));
  const options = rendererSpy.mock.calls[0]?.[1];
  instance.unmount();
  expect(options).toBeDefined();
  return options!;
}

function mountBlock(path: string, marker?: string): string {
  const text = readFileSync(path, "utf8");
  const startAt = marker ? text.indexOf(marker) : 0;
  expect(startAt).toBeGreaterThanOrEqual(0);
  const start = text.indexOf("function mount", startAt);
  const spread = text.indexOf("...userParams", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(spread).toBeGreaterThan(start);
  return text.slice(start, spread + "...userParams".length);
}

describe("vorticella_bloom theme params", () => {
  it("passes the accepted solo Vorticella params to createCellRenderer", async () => {
    const options = await mountVorticellaBloom();

    expect(options.baseHue).toBe(50);
    expect(options.width).toBe(320);
    expect(options.height).toBe(160);
    expect(options.params).toMatchObject(EXPECTED_VORTICELLA_BLOOM_PARAMS);
  });

  it("keeps user params last so overrides win", async () => {
    const options = await mountVorticellaBloom({
      vorticellaScale: 2.4,
      vorticellaContractRate: 0.8,
      aquariumSeed: 99,
    });

    expect(options.params).toMatchObject({
      vorticellaScale: 2.4,
      vorticellaContractRate: 0.8,
      aquariumSeed: 99,
    });
  });

  it("keeps source and generated bundle mount params in sync", () => {
    for (const [path, marker] of [[SOURCE, undefined], [BUNDLE, BUNDLE_MARKER]] as const) {
      const block = mountBlock(path, marker);
      for (const [key, value] of Object.entries(EXPECTED_VORTICELLA_BLOOM_PARAMS)) {
        expect(block).toContain(`${key}: ${String(value)}`);
      }
      expect(block.indexOf("vorticellaScale: 1.8")).toBeLessThan(block.indexOf("...userParams"));
    }
  });
});
