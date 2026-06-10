// src/theme-engine/renderers/smoothing.ts
function createSmoother({ size, alpha, peakDecay }) {
  const a = Math.max(0, Math.min(1, alpha));
  const decay = Math.max(0, Math.min(1, peakDecay));
  let smoothed = new Array(size).fill(0);
  let peak = new Array(size).fill(0);
  return {
    push(input) {
      smoothed = smoothed.map((prev, i) => {
        const target = i < input.length ? Number(input[i]) || 0 : 0;
        return prev * (1 - a) + target * a;
      });
      if (decay >= 1) {
        peak = smoothed.slice();
        return smoothed.slice();
      }
      peak = peak.map((p, i) => Math.max(p * decay, smoothed[i]));
      return smoothed.map((s, i) => Math.max(s, peak[i]));
    }
  };
}

// src/theme-engine/renderers/bars.ts
var DEFAULT_BAR_COUNT = 16;
var DEFAULT_MAX_HEIGHT = 32;
var DEFAULT_GAP = 1;
var DEFAULT_PEAK_DECAY = 0.96;
var DEFAULT_SMOOTHING_ALPHA = 0.3;
var MIN_HEIGHT_PX = 2;
var PEAK_HEIGHT_PX = 2;
function barHeight(v, maxHeight) {
  const clamped = Math.max(0, Math.min(1, v));
  const range = Math.max(0, maxHeight - MIN_HEIGHT_PX);
  return Math.min(maxHeight, MIN_HEIGHT_PX + Math.pow(clamped, 0.7) * range);
}
function gradientCss(g) {
  return `linear-gradient(to top, ${g.bottom} 0%, ${g.middle} 50%, ${g.top} 100%)`;
}
function resample(src, count) {
  return new Array(count).fill(0).map((_, i) => {
    if (src.length === 0)
      return 0;
    const srcIdx = Math.min(src.length - 1, Math.floor(i / count * src.length));
    return src[srcIdx] ?? 0;
  });
}
function createBarsRenderer(container, opts) {
  const barCount = opts.barCount ?? DEFAULT_BAR_COUNT;
  const maxHeight = opts.maxHeight ?? DEFAULT_MAX_HEIGHT;
  const gap = opts.gap ?? DEFAULT_GAP;
  const peakDecay = opts.peakDecay ?? DEFAULT_PEAK_DECAY;
  const smoothingAlpha = opts.smoothingAlpha ?? DEFAULT_SMOOTHING_ALPHA;
  const smoother = createSmoother({ size: barCount, alpha: smoothingAlpha, peakDecay: 1 });
  const peaks = new Array(barCount).fill(0);
  const bg = gradientCss(opts.gradient);
  const root = document.createElement("div");
  root.className = "classic-bars";
  Object.assign(root.style, {
    display: "flex",
    alignItems: "end",
    justifyContent: "space-between",
    width: "100%",
    height: `${maxHeight + 4}px`,
    gap: `${gap}px`,
    overflow: "hidden"
  });
  const barEls = [];
  const peakEls = [];
  for (let i = 0;i < barCount; i++) {
    const col = document.createElement("div");
    col.className = "classic-bar-col";
    Object.assign(col.style, {
      position: "relative",
      flex: "1 1 0",
      minWidth: "2px",
      height: `${maxHeight}px`,
      display: "flex",
      alignItems: "end"
    });
    const bar = document.createElement("div");
    bar.className = "classic-bar";
    Object.assign(bar.style, {
      width: "100%",
      maxHeight: `${maxHeight}px`,
      minHeight: `${MIN_HEIGHT_PX}px`,
      height: `${MIN_HEIGHT_PX}px`,
      background: bg,
      borderRadius: "1px",
      transition: "height 60ms ease-out, opacity 120ms ease-out"
    });
    const peak = document.createElement("div");
    peak.className = "classic-bar-peak";
    Object.assign(peak.style, {
      position: "absolute",
      bottom: "0px",
      left: "0",
      right: "0",
      height: `${PEAK_HEIGHT_PX}px`,
      background: opts.gradient.top,
      borderRadius: "1px",
      pointerEvents: "none",
      display: "none"
    });
    col.appendChild(bar);
    col.appendChild(peak);
    root.appendChild(col);
    barEls.push(bar);
    peakEls.push(peak);
  }
  container.appendChild(root);
  return {
    update(state) {
      const resampled = resample(state.spectrumBins ?? [], barCount);
      const heights = smoother.push(resampled);
      for (let i = 0;i < barCount; i++) {
        const v = heights[i] ?? 0;
        const barPx = barHeight(v, maxHeight);
        barEls[i].style.height = `${barPx}px`;
        const prev = peaks[i];
        peaks[i] = v >= prev ? v : prev * peakDecay;
        const peakPx = barHeight(peaks[i], maxHeight);
        const showPeak = peakDecay > 0 && peakPx > barPx + 1;
        peakEls[i].style.display = showPeak ? "block" : "none";
        if (showPeak) {
          peakEls[i].style.bottom = `${peakPx}px`;
        }
      }
    },
    destroy() {
      container.innerHTML = "";
    }
  };
}

// src/theme-engine/builtin/dark/index.ts
function mount(container, api) {
  const renderer = createBarsRenderer(container, {
    gradient: { bottom: "#7c4dff", middle: "#9c6dff", top: "#b388ff" },
    barCount: 16
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
