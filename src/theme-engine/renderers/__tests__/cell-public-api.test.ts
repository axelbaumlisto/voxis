import { describe, expect, it, expectTypeOf } from "vitest";
import * as cell from "../cell";
import type {
  CellOptions,
  CellParams,
  CellPersistState,
  CellPreset,
  CiliaMotion,
  InteriorCtx,
  WanderState,
} from "../cell";

type PublicTypeManifest = {
  params: CellParams;
  options: CellOptions;
  ciliaMotion: CiliaMotion;
  interiorCtx: InteriorCtx;
  persistState: CellPersistState;
  preset: CellPreset;
  wanderState: WanderState;
};

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
});
