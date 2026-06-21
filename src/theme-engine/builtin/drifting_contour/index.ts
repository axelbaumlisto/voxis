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
      fillAlpha: 0.12,               // idle — ghost-dim (was 0.18)
      fillAlphaActive: 0.45,         // recording — clearly present (was 0.35)
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
      vacuoleMaxFrac: 0.13,           // smaller CVs (was default 0.18)
      cvAnteriorS: 0.52,              // slightly inward from cortex (was 0.62)
      cvPosteriorS: 0.52,             // slightly inward from cortex (was 0.62)
      tension: 0.15,
      // cilia ("усы"), startle ("шарахается"), growth ("растёт как живая")
      ciliaCount: 18,
      ciliaLength: 0.4,
      ciliaWave: 0.5,
      ciliaWaveSpeed: 1.6,
      growthAttack: 0.05,
      growthRelease: 0.012,
      baseRadiusPx: 17,
      driftSpeed: 0.08,              // visible glide (v3.5 approved)
      idleSwimFrac: 0.30,            // 30% of peak swim at idle (v3.5 approved)
      bodyHeadingTau: 1.5,             // slow heading response
      interiorHeadingTau: 5.0,          // interior organelles lag behind body turns
      idleDriftMin: 0.70,            // visible wander (v3.5 approved)
      driftMargin: 30,
      idleMorphAmplitude: 0.16,
      idleMorphSpeed: 0.22,
      idleMorphPeriod: 7,
      idleMorphFloor: 0.3,
      growthSwell: 0.0,               // Paramecium does NOT inflate on activation (was 0.2)
      swimSpeedMaxFrac: 0.045,         // calmer recording swim (was 0.07)         // prevent canvas escape (was 0.10/0.06)
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
      axialSpinMax: 1.0,             // ~0.16 rev/s — very gentle roll, interior stable (was 3)
      nucleusAlpha: 0.85,            // nucleus must be visible interior anchor (was 0.72)
      enableVacuoles: true,          // two asynchronous contractile vacuoles (Commit 26)
      enableCVCanals: true,          // radial canal star shape on CVs (v3.6)
      canalLenMul: 2.5,              // longer canals into cytoplasm (was 2.0)
      canalLineWidth: 1.0,           // thicker canal lines (was 0.5px)
      canalAlphaMul: 0.25,           // subtle canals (was 0.5)
      enableOralGroove: true,         // ventral concavity — Paramecium's defining feature
      oralGrooveDepth: 0.08,          // 8% inward — visible slipper indent (was 4%)
      oralGrooveWidth: 0.8,            // wider angular extent (was 0.5)
      cyclosisActivityBoost: 0.4,     // cyclosis 40% faster at full activity
      enableEctoplasm: true,          // cortex/endoplasm boundary line
      ectoplasmFrac: 0.93,            // thin cortex at 93% radius (real: 92-96%)
      ectoplasmAlpha: 0.22,           // brighter thin rim (was 0.15)
      helicalAmplitude: 0.3,           // sinusoidal lateral wobble (helical swimming)
      enableWallReorient: true,         // ciliate avoidance reaction at walls (not specular)
      enableRotationalBrownian: true,    // subtle heading jitter at rest (D_r ≈ 0.02 rad²/s)
      rotationalDiffusion: 0.02,         // measured for P. caudatum ~20°C
      foodVacuoleSizeMul: 1.4,         // food vacuoles distinct but not wall-stuck (was 1.8)
      foodVacuoleLoopMaxAmp: 0.78,      // keep large vacuoles off the pellicle
      enableTrichocysts: false,        // dormant: avoid long radial "whiskers" during recording
      trichocystCount: 30,             // number of crystalline needles
      trichocystLengthMul: 3.0,        // needle length = 3× cilia length
      trichocystDecay: 3.0,            // ~1.8s visible (was 1.0 = 5.3s permanent whiskers)
      trichocystLineWidth: 1.5,        // thick needles (was 1.0px)
      enableMetachronal: true,          // traveling metachronal wave on cilia
      metachronalWavelength: 20,        // wavelength in cilia count
      metachronalSpeed: 1.5,            // gentle wave (was 4.0 = frantic)
      metachronalDepth: 0.35,           // subtle wave [0.65, 1.0] (was 0.6 = jumpy)
      ciliaBeatHz: 0.5,                 // slower idle beat (was 0.9)
      ciliaBeatHzActive: 0.9,           // calmer recording beat (was 1.6)
      caudalTuftLength: 1.2,            // shorter posterior tuft (default 1.7)
      nucleusIndent: 0.3,               // kidney-shaped macronucleus concavity
      foodVacuoleSat: 0.25,             // warmer amber food vacuoles (was 0.10)
      enableCyclosis: true,          // cytoplasmic streaming + granules (Commit 27)
      cyclosisGranuleCount: 40,      // fewer = less visible reshuffling on rotation
      granuleSizePx: 1.6,            // smaller = subtler interior
      enableOrganelles: true,        // food vacuoles + micronucleus (Commit 28)
      foodVacuoleCount: 8,           // fewer large vacuoles (was 10)
      // === v3.3 INTERIOR FIELD (Commit 32a-e) — organelles in body coords,
      // distributed through the elongated body + circulating on the cyclosis
      // loop to the poles, coupled to the deforming wall. Fixes "органеллы все
      // в центре". interiorPoint distributes via the profile, so the legacy
      // disc granuleMaxRadiusFrac/foodVacuoleMaxRadiusFrac no longer apply.
      enableInteriorField: true,     // body-coord interior (not the central disc)
      cyclosisPeriod: 65,            // slower cyclosis — equatorial granules <3px/0.5s (was 38)
      // === Micro-aquarium Phase 5B visibility boost — one readable Euglena, behind hero. ===
      enableAquarium: true,
      aquariumSeed: 5,
      aquariumAlpha: 0.68,
      aquariumActivityBoost: 0.25,
      diatomCount: 0,
      diatomAlpha: 0.16,
      diatomDriftSpeed: 0.35,
      euglenaCount: 1,
      euglenaSpeed: 0.15,        // body-lengths/sec (idle) — gentle companion drift
      euglenaSpeedActive: 0.30,  // body-lengths/sec (recording)
      euglenaScale: 2.8,         // companion ~0.4x the paramecium length (correct scale)
      vorticellaCount: 0,
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
