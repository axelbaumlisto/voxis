import { describe, expect, it, expectTypeOf } from "vitest";
import * as cell from "../cell";
import * as supportedCell from "../cell/public";
import type {
  CellOptions,
  CellParams,
  CellPersistState,
  CellPreset,
  CiliaMotion,
  InteriorCtx,
  WanderState,
} from "../cell";
import type {
  CellOptions as SupportedCellOptions,
  CellParams as SupportedCellParams,
  CellPreset as SupportedCellPreset,
} from "../cell/public";

type PublicTypeManifest = {
  params: CellParams;
  options: CellOptions;
  ciliaMotion: CiliaMotion;
  interiorCtx: InteriorCtx;
  persistState: CellPersistState;
  preset: CellPreset;
  wanderState: WanderState;
};

type SupportedPublicTypeManifest = {
  params: SupportedCellParams;
  options: SupportedCellOptions;
  preset: SupportedCellPreset;
};

const SUPPORTED_RUNTIME_EXPORT_KEYS = [
  "CELL_DEFAULTS",
  "createCellRenderer",
  "resolveCellPreset",
] as const;

const AQUARIUM_COUNT_DEFAULTS = ["diatomCount", "euglenaCount", "vorticellaCount"] as const;

const RUNTIME_EXPORT_KEYS = [
  "CELL_DEFAULTS",
  "TAU",
  "advanceAxialSpinPhase",
  "advanceCiliaBeatCycles",
  "advanceCyclosisPhase",
  "advectFoodVacuole",
  "advectGranule",
  "advectMote",
  "affineSqueezePoints",
  "applyOralGroove",
  "axialSpin",
  "bandLimitDeform",
  "bodyHalfWidth",
  "bodyHeadingStep",
  "bodyProfileArea",
  "bodyProfileAreaScale",
  "bodyProfileDeform",
  "bodyProfilePoint",
  "buildCellContour",
  "buildProfilePts",
  "buildTargetDeformation",
  "catmullRom",
  "catmullRomOpen",
  "cellActivity",
  "cellDrift",
  "cellEnergy",
  "cellPersistKey",
  "cellRadius",
  "cellReach",
  "ciliaBeatHzEff",
  "ciliaBeatPhase",
  "ciliaBeatPhaseAtCycle",
  "ciliaEndpoints",
  "ciliaPath",
  "ciliaStrokeAngle",
  "ciliaStructureMod",
  "contractileVacuole",
  "contractileVacuolePair",
  "createCellRenderer",
  "cyclosisField",
  "cyclosisLoopPoint",
  "cyclosisLoopPointAtPhase",
  "dipoleFlowAt",
  "driftActivation",
  "effectiveCyclosisPeriod",
  "fbm",
  "foodVacuoleSize",
  "helicalOffset",
  "idleMorph",
  "integrateDeformPipeline",
  "integrateDeformation",
  "interiorPoint",
  "interpProfileRadius",
  "iridescentHue",
  "lowpassRadii",
  "membraneMaxRadius",
  "metachronalIndex",
  "micronucleusTransform",
  "noise2D",
  "normalizeAreaDeform",
  "nucleusTransform",
  "parseCellState",
  "perimeterCiliaCount",
  "profileCDFInv",
  "prolateAspect",
  "pseudopodOffset",
  "resolveBaseRadius",
  "resolveCellPreset",
  "restoreSeed",
  "rotationalBrownianStep",
  "sampleBinLevel",
  "sanitizeBins",
  "sanitizeFinite",
  "sanitizeUnit",
  "saturateTargetDeform",
  "sedimentationBias",
  "seedFoodVacuoles",
  "seedGranules",
  "seedInteriorFoodVacuoles",
  "seedInteriorGranules",
  "seedMotes",
  "serializeCellState",
  "smoothEnergy",
  "smoothstep",
  "somaticCiliaParams",
  "startleBurstSpeed",
  "startleHeadingKick",
  "startleOffset",
  "strokeAxisStrength",
  "swimSpeed",
  "wallReorientHeading",
  "wanderPoseFromState",
  "wanderStep",
] as const;

describe("cell public API", () => {
  it("keeps the runtime value export manifest stable", () => {
    expect(Object.keys(cell).sort()).toEqual(RUNTIME_EXPORT_KEYS);
  });

  it("keeps current public cilia defaults stable", () => {
    expect(cell.CELL_DEFAULTS.ciliaCount).toBe(18);
    expect(cell.CELL_DEFAULTS.ciliaLength).toBe(0.45);
  });

  it("keeps aquarium defaults gated off and invisible", () => {
    expect(cell.CELL_DEFAULTS.enableAquarium ?? false).toBe(false);
    for (const key of AQUARIUM_COUNT_DEFAULTS) {
      expect(cell.CELL_DEFAULTS[key]).toBe(0);
    }
  });

  it("does not export aquarium internals from runtime entrypoints", () => {
    expect(Object.keys(cell).some((key) => key.toLowerCase().includes("aquarium"))).toBe(false);
    expect(Object.keys(supportedCell).some((key) => key.toLowerCase().includes("aquarium"))).toBe(false);
  });

  it("keeps key public types exported", () => {
    expectTypeOf<PublicTypeManifest>().toMatchTypeOf<{
      params: CellParams;
      options: CellOptions;
      ciliaMotion: CiliaMotion;
      interiorCtx: InteriorCtx;
      persistState: CellPersistState;
      preset: CellPreset;
      wanderState: WanderState;
    }>();
  });

  it("exposes a narrow supported runtime entrypoint", () => {
    expect(Object.keys(supportedCell).sort()).toEqual(SUPPORTED_RUNTIME_EXPORT_KEYS);
    expect(supportedCell.createCellRenderer).toBe(cell.createCellRenderer);
    expect(supportedCell.CELL_DEFAULTS).toBe(cell.CELL_DEFAULTS);
    expect(supportedCell.resolveCellPreset).toBe(cell.resolveCellPreset);
    expect("ciliaBeatHzEff" in supportedCell).toBe(false);
    expect("iridescentHue" in supportedCell).toBe(false);
    expect("testing" in supportedCell).toBe(false);
  });

  it("keeps key supported entrypoint types exported", () => {
    expectTypeOf<SupportedPublicTypeManifest>().toMatchTypeOf<{
      params: CellParams;
      options: CellOptions;
      preset: CellPreset;
    }>();
  });
});
