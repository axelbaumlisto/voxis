// src/theme-engine/renderers/ringGeometry.ts
var TAU = Math.PI * 2;
function organicBaseRadius(width, height) {
  return Math.min(width, height) * 0.34;
}
function applyRingGap(angle, gapDegrees) {
  const halfGapRad = gapDegrees * Math.PI / 180 / 2;
  return Math.abs(angle) < halfGapRad;
}
function ringStateEnergy(mode, speechEnergy, animationTime, motion) {
  switch (mode) {
    case "idle":
      return motion.idle_breathing * (1 + Math.sin(animationTime * 0.8) * 0.25);
    case "recording": {
      const v = motion.idle_breathing + speechEnergy * motion.speech_responsiveness * 1.18;
      return Math.max(0, Math.min(1, v));
    }
    case "transcribing": {
      const v = motion.idle_breathing * 0.72 + speechEnergy * 0.12;
      return Math.max(0, Math.min(1, v));
    }
    case "error":
      return motion.idle_breathing;
  }
}
function ringOscillation(angle, bins, animationTime, stateEnergy, activeZones, drift) {
  const len = bins.length;
  const normalized = ((angle + Math.PI / 2) % TAU + TAU) % TAU / TAU;
  const idx = len === 0 ? 0 : Math.min(Math.floor(normalized * len), len - 1);
  const level = len === 0 ? 0 : bins[idx];
  let wave = 0;
  const zones = Math.max(1, activeZones);
  for (let zone = 0;zone < zones; zone++) {
    const phase = animationTime * (0.4 + zone * 0.17) + zone * 1.3;
    wave += Math.sin(normalized * TAU * (zone + 1) + phase);
  }
  wave /= zones;
  const v = wave * (0.35 + level * 0.65) * (stateEnergy + drift * 0.2);
  return Math.max(-1, Math.min(1, v));
}
function ringStrokeWidth(angle, shape) {
  const normalized = ((angle + Math.PI / 2) % TAU + TAU) % TAU / TAU;
  const taperWave = Math.pow(Math.sin(normalized * TAU) * 0.5 + 0.5, 1 + shape.taper);
  return Math.max(1, shape.base_thickness * (0.45 + taperWave * 0.55));
}
function buildRingPoints(width, height, bins, animationTime, speechEnergy, theme, mode) {
  const sampleCount = 120;
  const cx = width / 2;
  const cy = height / 2;
  const baseRadius = organicBaseRadius(width, height);
  const stateEnergy = ringStateEnergy(mode, speechEnergy, animationTime, theme.motion);
  const out = [];
  for (let i = 0;i < sampleCount; i++) {
    const angle = -Math.PI / 2 + i / sampleCount * TAU;
    if (applyRingGap(angle, theme.shape.gap_degrees))
      continue;
    const oscillation = ringOscillation(angle, bins, animationTime, stateEnergy, theme.shape.active_zones, theme.motion.drift);
    const pulseMultiplier = mode === "transcribing" ? 1 + Math.sin(animationTime * 4.2) * 0.12 : 1;
    const radius = Math.max(baseRadius * 0.6, baseRadius * pulseMultiplier * (1 + oscillation * 0.51));
    out.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  return out;
}

// src/theme-engine/renderers/ring.ts
function createRingRenderer(container, opts) {
  const { shape, motion, color, width, height } = opts;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.style.display = "block";
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  let latestState = {
    mode: "idle",
    audioLevel: 0,
    spectrumBins: new Array(32).fill(0)
  };
  const startedAt = performance.now();
  const cx = width / 2;
  const cy = height / 2;
  let rafId = null;
  const tick = () => {
    const t = (performance.now() - startedAt) / 1000;
    const s = latestState;
    if (ctx) {
      ctx.clearRect(0, 0, width, height);
      const points = buildRingPoints(width, height, s.spectrumBins, t, s.audioLevel, { shape, motion }, s.mode);
      if (points.length >= 2) {
        ctx.strokeStyle = color;
        ctx.lineCap = "round";
        for (let i = 0;i < points.length - 1; i++) {
          const [x1, y1] = points[i];
          const [x2, y2] = points[i + 1];
          const midAngle = Math.atan2((y1 + y2) / 2 - cy, (x1 + x2) / 2 - cx);
          ctx.lineWidth = ringStrokeWidth(midAngle, shape);
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
      }
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
  return {
    update(state) {
      latestState = state;
    },
    destroy() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      container.innerHTML = "";
    }
  };
}

// src/theme-engine/builtin/living_reed/index.ts
function mount(container, api) {
  const renderer = createRingRenderer(container, {
    shape: {
      gap_degrees: 42,
      base_thickness: 7.2,
      taper: 0.7,
      roundness: 0.9,
      active_zones: 3
    },
    motion: {
      idle_breathing: 0.1,
      speech_responsiveness: 0.92,
      drift: 0.38,
      settle_speed: 0.6
    },
    color: "#7cc287",
    width: api.size.width,
    height: api.size.height
  });
  const unsubscribe = api.onState((s) => renderer.update(s));
  return {
    unmount() {
      unsubscribe();
      renderer.destroy();
    }
  };
}
export {
  mount
};
