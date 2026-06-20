// src/theme-engine/builtin/drifting_contour/index.ts
/**
 * Living Cell — organic membrane visualization.
 *
 * The cell deforms with multi-octave FBM noise for a lumpy, biological
 * outline; amoeboid pseudopods protrude in slowly drifting directions that
 * intensify with voice activity; an iridescent hue shimmer travels around
 * the contour over a warm amber base (#d9a865, hue ≈ 34°).
 *
 * The membrane has a translucent filled cytoplasm and a brighter stroked
 * outline rendered with a closed Catmull-Rom spline for smoothness.
 *
 * During silence the cell breathes subtly (idle energy). During recording
 * it becomes visibly active with larger deformations and stronger shimmer.
 */
import { createCellRenderer } from "../../renderers/cell";
import type { ThemeApi, ThemeInstance } from "../../contract";

export function mount(container: HTMLElement, api: ThemeApi): ThemeInstance {
  const userParams = (api.params && typeof api.params === "object" ? api.params : {}) as Record<string, unknown>;

  const renderer = createCellRenderer(container, {
    width: api.size.width,
    height: api.size.height,
    baseHue: 50, // warm neutral (DIC darkfield) — bio panel r3 (was 55/34)
    params: {
      noiseScale: 0.9,
      octaves: 4,
      lacunarity: 2.3,
      gain: 0.55,
      timeScale: 0.3,
      membraneAmplitude: 0.35,
      energyDrive: 0.8,
      push: 3.0,
      sharpness: 4,
      intentDrift: 0.08,
      idle: 0.10,
      levelGain: 0.7,
      hueSpread: 8,                  // minimal iridescence — pellicle is NOT a soap bubble (was 40)
      shimmerSpeed: 0.04,              // barely perceptible hue drift (was 0.5)
      hueBoost: 4,                     // less audio hue shift (was 20)
      fillAlpha: 0.18,               // idle — nearly clear cytoplasm
      fillAlphaActive: 0.35,         // recording — brightens with voice (DIC contrast)
      // === DIC-authentic colour palette (bio panel r3) ===
      membraneSat: 0.12,             // silvery refractile edge (was 0.85/0.55)
      membraneLightness: 0.75,       // idle — silver
      membraneLightnessActive: 0.88, // recording — brighter membrane
      cytoplasmSat: 0.10,            // nearly colourless cytoplasm wash
      ciliaSat: 0.08,                // transparent protein — barely visible
      granuleSat: 0.10,              // refractile silver dots
      nucleusSatMul: 0.25,           // gray chromatin mass (was 0.35)
      foodVacuoleHue: 38,            // amber-brown — the ONLY warm element (ingested food)
      cvHue: 170,                    // pale cyan — clear water vesicle
      tension: 0.15,
      // cilia ("усы"), startle ("шарахается"), growth ("растёт как живая")
      ciliaCount: 18,
      ciliaLength: 0.4,
      ciliaWave: 0.5,
      ciliaWaveSpeed: 1.6,
      growthAttack: 0.05,
      growthRelease: 0.012,
      baseRadiusPx: 17,
      driftSpeed: 0.08,              // resting cell still glides visibly (was 0.03)
      idleSwimFrac: 0.30,            // 30% of peak swim even at idle — cell always drifts
      idleDriftMin: 0.70,            // wander position 70% visible even in idle
      driftMargin: 30,
      idleMorphAmplitude: 0.16,
      idleMorphSpeed: 0.22,
      idleMorphPeriod: 7,
      idleMorphFloor: 0.3,
      growthSwell: 0.0,               // Paramecium does NOT inflate on activation (was 0.2)
      swimSpeedMaxFrac: 0.07,         // prevent canvas escape (was 0.10/0.06)
      startleSensitivity: 2.8,        // trigger startle more easily (was 2.2)
      startleDecay: 0.96,             // ~0.5s avoidance reaction (was 0.86 = 0.08s)
      startleMaxPx: 5,                // sharper avoid reaction (was 4)
      startleBaselineRate: 0.08,
      // === Authentic Paramecium (v3.2-final) — BIOLOGY-APPROVED default look. ===
      // Reviewer (biology validator) approved these in lieu of user A/B:
      // /tmp/ado_biology_final2.md (shape 4, ciliature 4, interior 4, motion 4).
      // The cell renderer's own gates stay OFF by default (GATES_OFF golden
      // frozen); the authentic organism lives here in the theme config.
      enableSomaticCilia: true,      // short dense somatic cilia (Commit 22)
      somaticCiliaCount: 104,        // denser fringe (biology: velvet pile, not spokes)
      ciliaGrowthBoost: 0.0,          // cilia length is FIXED (was 0.08) — beat FREQUENCY changes, not length
      ciliaCurl: 0.32,               // lower wave amplitude => rowing comb not free flagella
      ciliaLengthVar: 0.35,          // less length scatter => even comb
      enableCiliaOnContour: true,    // anchor on the real contour (Commit 21)
      enableRigidMembrane: true,     // smooth firm contour, no FBM wobble (Commit 29)
      enableBodyProfile: true,       // authentic asymmetric slipper (Commit 31)
      bodyProfileType: "egg",        // biology-validated egg (not piriform teardrop)
      bodyProfileTaper: 0.20,        // widest point ~0.42L (morphology biologist: 0.42-0.48)
      bodyAspect: 3,                 // ~3:1 aurelia slipper
      bodyVentralBend: 0.18,         // more legible banana curve at display scale
      enableAffine: true,            // forced k=1 when profile on (no double-elongate)
      enableCiliaStructure: true,    // oral-groove dip + caudal tuft (Commit 23)
      enableAxialSpin: true,         // spin about long axis while swimming (Commit 24)
      axialSpinMax: 7,               // ~1.1 rev/s — calmer, closer to bio ~1 rev/s (was 10)
      nucleusAlpha: 0.72,            // denser nucleus visible as anchor (was 0.55)
      enableVacuoles: true,          // two asynchronous contractile vacuoles (Commit 26)
      enableCVCanals: true,          // radial canal star shape on CVs (v3.6)
      enableCyclosis: true,          // cytoplasmic streaming + granules (Commit 27)
      cyclosisGranuleCount: 52,      // pack the cytoplasm (biologist polish: crammed)
      granuleSizePx: 1.6,            // a touch brighter/bigger so they read
      enableOrganelles: true,        // food vacuoles + micronucleus (Commit 28)
      foodVacuoleCount: 10,          // more food vacuoles filling the body
      // === v3.3 INTERIOR FIELD (Commit 32a-e) — organelles in body coords,
      // distributed through the elongated body + circulating on the cyclosis
      // loop to the poles, coupled to the deforming wall. Fixes "органеллы все
      // в центре". interiorPoint distributes via the profile, so the legacy
      // disc granuleMaxRadiusFrac/foodVacuoleMaxRadiusFrac no longer apply.
      enableInteriorField: true,     // body-coord interior (not the central disc)
      cyclosisPeriod: 38,            // back to bio range 30-60s (was 26)
      ...userParams,
    },
  });
  const unsubscribe = api.onState((s) => renderer.update(s));
  return {
    unmount() {
      unsubscribe();
      renderer.destroy();
    },
  };
}
