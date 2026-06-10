// src/theme-engine/renderers/pill.ts
/**
 * createPillRenderer — vanilla-DOM port of HandyPill.tsx + HandyBars.tsx.
 *
 * Layout: 172×36 grid (auto 1fr auto) → icon | middle | cancel.
 * 9 compact bars with power-curve height + opacity smoothing.
 * Self-contained SVG icons (Microphone, Transcription, Cancel) inlined.
 * No React, no RAF: update() is pushed on every spectrum event.
 *
 * SRP: only DOM rendering of the Handy pill; smoothing math delegated to smoothing.ts.
 */
import { createSmoother } from "./smoothing";
import type { ThemeState } from "../contract";
import type { Renderer } from "./types";

export interface PillPalette {
  icon_color: string;
  bar_color: string;
  bar_glow: string;
  shadow: string;
  transcribing_text: string;
  cancel_hover_bg: string;
}

export interface PillAnimation {
  /** Exponential smoothing factor. Default 0.3. */
  smoothing_alpha?: number;
  /** Power-curve exponent for bar height. Default 0.7 (from DEFAULT_HANDY_THEME in src/themes/handy.ts). */
  power_curve?: number;
  /** Peak-hold decay rate. Default 1.0 (no peak hold). */
  peak_decay?: number;
}

export interface PillOptions {
  palette: PillPalette;
  animation?: PillAnimation;
  onCancel: () => void;
  labels?: { transcribing?: string; error?: string };
}

// ── constants (ported from HandyBars.tsx) ──

const MAX_HEIGHT = 20;
const BAR_WIDTH = 6;
const GAP = 3;
const MIN_PX = 4;
const MIN_OPACITY = 0.2;
const OPACITY_GAIN = 1.7;
const BAR_COUNT = 9;

// ── SVG icon markup (inlined from src/components/icons, fill="currentColor") ──

function micSvg(): string {
  return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M17.1562 10.2C17.1562 8.83247 16.613 7.52099 15.646 6.554C14.679 5.58702 13.3675 5.04375 12 5.04375C10.6325 5.04375 9.32099 5.58702 8.354 6.554C7.38702 7.52099 6.84375 8.83247 6.84375 10.2C6.84375 11.1586 6.99743 11.7554 7.18689 12.1629C7.37547 12.5685 7.62633 12.848 7.94019 13.1553C8.23392 13.443 8.67357 13.8299 8.99524 14.3488C9.34195 14.9081 9.54381 15.5869 9.54382 16.4999C9.54382 17.1513 9.80245 17.7762 10.2631 18.2369C10.7237 18.6975 11.3486 18.9561 12 18.9561C12.7207 18.9561 13.268 18.6453 13.7494 18.0625C14.0462 17.7033 14.5781 17.6526 14.9374 17.9494C15.2967 18.2461 15.3473 18.7781 15.0505 19.1374C14.3214 20.0201 13.3283 20.6436 12 20.6436C10.901 20.6436 9.84705 20.2071 9.06995 19.43C8.29287 18.6529 7.85632 17.5989 7.85632 16.4999C7.85631 15.8572 7.72032 15.4953 7.56079 15.238C7.37622 14.9402 7.14072 14.7342 6.75952 14.3609C6.39843 14.0073 5.97449 13.5575 5.65686 12.8744C5.34008 12.1931 5.15625 11.3413 5.15625 10.2C5.15625 8.38492 5.87744 6.64434 7.16089 5.36089C8.44434 4.07743 10.1849 3.35625 12 3.35625C13.8151 3.35625 15.5557 4.07743 16.8391 5.36089C18.1226 6.64434 18.8438 8.38492 18.8438 10.2C18.8437 10.666 18.466 11.0437 18 11.0437C17.534 11.0437 17.1563 10.666 17.1562 10.2Z" fill="currentColor"/>
    <path d="M14.1562 10.2C14.1562 9.62812 13.9289 9.07984 13.5245 8.67546C13.1454 8.29636 12.6399 8.07275 12.1069 8.04631L12 8.04375C11.4281 8.04375 10.8798 8.27109 10.4755 8.67546C10.0711 9.07984 9.84375 9.62812 9.84375 10.2C9.84375 10.666 9.46599 11.0437 9 11.0437C8.53401 11.0437 8.15625 10.666 8.15625 10.2C8.15625 9.18057 8.56114 8.20282 9.28198 7.48198C10.0028 6.76114 10.9806 6.35625 12 6.35625L12.1904 6.36101C13.1405 6.4081 14.0422 6.80615 14.718 7.48198C15.4389 8.20282 15.8438 9.18057 15.8438 10.2C15.8438 11.4145 15.2126 12.223 14.7751 12.8063C14.3126 13.423 14.0438 13.8146 14.0438 14.4001C14.0438 14.4785 14.0697 14.555 14.1174 14.6172C14.1652 14.6795 14.2321 14.7244 14.3079 14.7447C14.3836 14.7649 14.4639 14.7597 14.5364 14.7297C14.6088 14.6996 14.6693 14.6464 14.7085 14.5784C14.9413 14.1748 15.4573 14.0363 15.861 14.269C16.2646 14.5018 16.4032 15.0178 16.1704 15.4214C15.9456 15.8113 15.5984 16.1163 15.1827 16.2886C14.767 16.4609 14.3057 16.4911 13.871 16.3747C13.4363 16.2582 13.0521 16.0015 12.7782 15.6445C12.5043 15.2874 12.3562 14.8497 12.3563 14.3997C12.3564 13.1854 12.9875 12.377 13.4249 11.7937C13.8875 11.177 14.1562 10.7855 14.1562 10.2Z" fill="currentColor"/>
  </svg>`;
}

function transcriptionSvg(): string {
  return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M8.99996 11.85C9.74164 11.85 10.4666 12.07 11.0833 12.4821C11.7 12.8941 12.1809 13.4796 12.4647 14.1648C12.7485 14.85 12.8225 15.6043 12.6778 16.3317C12.5331 17.0591 12.1761 17.7273 11.6517 18.2517C11.1273 18.7762 10.459 19.1331 9.73165 19.2779C9.00422 19.4226 8.25 19.3486 7.56478 19.0647C6.87958 18.7809 6.29409 18.3 5.88204 17.6834C5.46998 17.0667 5.24996 16.3417 5.24996 15.6V15.0954C5.24996 14.6812 5.58575 14.3454 5.99996 14.3454C6.41417 14.3454 6.74996 14.6812 6.74996 15.0954V15.6C6.74996 16.0449 6.88183 16.4799 7.12899 16.8499C7.37622 17.2199 7.72786 17.5083 8.139 17.6786C8.55013 17.8489 9.0026 17.8936 9.43905 17.8068C9.87545 17.72 10.2761 17.5055 10.5908 17.1908C10.9054 16.8762 11.1199 16.4755 11.2067 16.0391C11.2936 15.6026 11.2489 15.1502 11.0786 14.739C10.9083 14.3279 10.6198 13.9763 10.2498 13.729C9.87987 13.4819 9.44489 13.35 8.99996 13.35C8.58575 13.35 8.24996 13.0142 8.24996 12.6C8.24996 12.1858 8.58575 11.85 8.99996 11.85Z" fill="currentColor"/>
    <path d="M15 11.85C15.4142 11.85 15.75 12.1858 15.75 12.6C15.75 13.0142 15.4142 13.35 15 13.35C14.555 13.35 14.1201 13.4819 13.7501 13.729C13.3801 13.9763 13.0916 14.3279 12.9213 14.739C12.7511 15.1502 12.7064 15.6026 12.7932 16.0391C12.88 16.4755 13.0945 16.8762 13.4091 17.1908C13.7238 17.5055 14.1245 17.72 14.5609 17.8068C14.9973 17.8936 15.4498 17.8489 15.8609 17.6786C16.2721 17.5083 16.6237 17.2199 16.8709 16.8499C17.1181 16.4799 17.25 16.0449 17.25 15.6V15.0954C17.25 14.6812 17.5857 14.3454 18 14.3454C18.4142 14.3454 18.75 14.6812 18.75 15.0954V15.6C18.75 16.3417 18.5299 17.0667 18.1179 17.6834C17.7058 18.3 17.1203 18.7809 16.4351 19.0647C15.7499 19.3486 14.9957 19.4226 14.2683 19.2779C13.5409 19.1331 12.8726 18.7762 12.3482 18.2517C11.8238 17.7273 11.4668 17.0591 11.3221 16.3317C11.1774 15.6043 11.2514 14.85 11.5352 14.1648C11.8191 13.4796 12.2999 12.8941 12.9166 12.4821C13.5333 12.07 14.2583 11.85 15 11.85Z" fill="currentColor"/>
    <path d="M11.2498 15.5999V7.8C11.2498 7.20332 11.0129 6.63113 10.591 6.20918C10.169 5.78723 9.59655 5.55 8.99981 5.55C8.40313 5.55004 7.83091 5.78726 7.40899 6.20918C6.98709 6.63113 6.74981 7.2033 6.74981 7.8V8.30464C6.74981 8.62274 6.54921 8.90641 6.2492 9.01216C5.61476 9.23582 5.07998 9.67683 4.73932 10.2569C4.39869 10.837 4.27406 11.5187 4.38775 12.1817C4.5015 12.8448 4.84623 13.4464 5.36078 13.8798C5.87528 14.3132 6.52647 14.5506 7.19915 14.55H7.80011C8.21426 14.5501 8.55011 14.8858 8.55011 15.3C8.55011 15.7142 8.21426 16.0499 7.80011 16.05H7.19989C6.17333 16.0507 5.17951 15.6885 4.39434 15.0272C3.60898 14.3657 3.08297 13.4475 2.90936 12.4355C2.73575 11.4234 2.92586 10.3825 3.44586 9.49702C3.87347 8.76895 4.50162 8.18474 5.24981 7.81026V7.8C5.24981 6.80544 5.64518 5.85153 6.34845 5.14827C7.05166 4.44511 8.00536 4.05004 8.99981 4.05C9.99434 4.05 10.9483 4.44506 11.6515 5.14827C12.3548 5.85153 12.7498 6.80544 12.7498 7.8V15.5999C12.7498 16.0141 12.414 16.3499 11.9998 16.3499C11.5857 16.3498 11.2498 16.0141 11.2498 15.5999Z" fill="currentColor"/>
    <path d="M11.2498 7.8C11.2498 6.80544 11.645 5.85153 12.3482 5.14827C13.0515 4.44501 14.0054 4.05 15 4.05C15.9945 4.05 16.9484 4.44501 17.6517 5.14827C18.355 5.85153 18.75 6.80544 18.75 7.8V7.81026C19.4982 8.18475 20.1266 8.76886 20.5543 9.49702C21.0743 10.3825 21.264 11.4234 21.0904 12.4355C20.9168 13.4475 20.3908 14.3657 19.6054 15.0272C18.8202 15.6885 17.8265 16.0504 16.7999 16.0496L16.2 16.05C15.7858 16.05 15.45 15.7142 15.45 15.3C15.45 14.8858 15.7858 14.55 16.2 14.55H16.8006C17.4734 14.5506 18.1248 14.3132 18.6394 13.8798C19.1539 13.4464 19.4983 12.8448 19.612 12.1817C19.7257 11.5187 19.6014 10.837 19.2608 10.2569C18.9201 9.6768 18.3851 9.23581 17.7506 9.01216C17.4506 8.9064 17.25 8.62273 17.25 8.30464V7.8C17.25 7.20327 17.0127 6.63114 16.5908 6.20918C16.1688 5.78723 15.5967 5.55 15 5.55C14.4032 5.55 13.8311 5.78723 13.4091 6.20918C12.9872 6.63114 12.7498 7.20327 12.7498 7.8C12.7498 8.21422 12.4142 8.55 12 8.55C11.5857 8.55 11.2498 8.21422 11.2498 7.8Z" fill="currentColor"/>
    <path d="M14.25 8.69993V8.4C14.25 7.98579 14.5857 7.65 15 7.65C15.4142 7.65 15.75 7.98579 15.75 8.4V8.69993C15.75 9.05797 15.8923 9.40147 16.1455 9.65464C16.3986 9.90773 16.7419 10.0501 17.0998 10.0501H17.4001C17.8143 10.0502 18.1501 10.386 18.1501 10.8001C18.15 11.2142 17.8142 11.5501 17.4001 11.5501H17.0998C16.344 11.5501 15.619 11.2496 15.0846 10.7152C14.5501 10.1807 14.25 9.45574 14.25 8.69993Z" fill="currentColor"/>
    <path d="M8.25011 8.69993V8.4C8.25011 7.98579 8.58589 7.65 9.00011 7.65C9.41425 7.65008 9.75011 7.98584 9.75011 8.4V8.69993C9.75011 9.4558 9.44962 10.1807 8.91514 10.7152C8.38067 11.2497 7.65575 11.5501 6.89989 11.5501H6.59996C6.18579 11.5501 5.85004 11.2143 5.84996 10.8001C5.84996 10.3859 6.18575 10.0501 6.59996 10.0501H6.89989C7.25793 10.0501 7.60142 9.90782 7.8546 9.65464C8.10777 9.40147 8.25011 9.05797 8.25011 8.69993Z" fill="currentColor"/>
  </svg>`;
}

function cancelSvg(): string {
  return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="m14.293 8.29297c.3905-.39052 1.0235-.39052 1.414 0s.3905 1.02354 0 1.41406l-5.99998 5.99997c-.39053.3906-1.02354.3906-1.41407 0-.39052-.3905-.39052-1.0235 0-1.414z" fill="currentColor"/>
    <path d="m8.29295 8.29297c.39053-.39052 1.02354-.39052 1.41407 0l5.99998 6.00003c.3905.3905.3905 1.0235 0 1.414-.3905.3906-1.0235.3906-1.414 0l-6.00005-5.99997c-.39052-.39052-.39052-1.02354 0-1.41406z" fill="currentColor"/>
    <path d="m20 12c0-4.41828-3.5817-8-8-8-4.41828 0-8 3.58172-8 8 0 4.4183 3.58172 8 8 8 4.4183 0 8-3.5817 8-8zm2 0c0 5.5228-4.4772 10-10 10-5.52285 0-10-4.4772-10-10 0-5.52285 4.47715-10 10-10 5.5228 0 10 4.47715 10 10z" fill="currentColor" opacity="0.4"/>
  </svg>`;
}

// ── bar math (ported from HandyBars.tsx) ──

function barHeightPx(v: number, power: number): number {
  const clamped = Math.max(0, Math.min(1, v));
  const range = Math.max(0, MAX_HEIGHT - MIN_PX);
  return Math.min(MAX_HEIGHT, MIN_PX + Math.pow(clamped, power) * range);
}

function barOpacity(v: number): number {
  const clamped = Math.max(0, Math.min(1, v));
  return Math.max(MIN_OPACITY, Math.min(1, clamped * OPACITY_GAIN));
}

/**
 * Nearest-neighbour resampling from source bins to barCount.
 * Intentional deviation from the React port: useSmoothBars truncated to the
 * FIRST 9 of 32 spectrum bins; here we sample across the full spectrum so
 * the 9 bars represent the whole frequency range (better visuals).
 */
function resampleToBars(bins: number[], count: number = BAR_COUNT): number[] {
  if (bins.length === 0) return new Array(count).fill(0);
  return new Array(count).fill(0).map((_, i) => {
    const srcIdx = Math.min(bins.length - 1, Math.floor((i / count) * bins.length));
    return bins[srcIdx] ?? 0;
  });
}

// ── scoped CSS generation ──

let pillIdCounter = 0;

function generateScopedCSS(scopeClass: string, palette: PillPalette): string {
  const chb = palette.cancel_hover_bg;
  const tt = palette.transcribing_text;
  const shadow = palette.shadow;
  return `
.${scopeClass} .pill-cancel-btn {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border: none;
  padding: 0;
  transition: background-color 150ms ease-out, transform 100ms ease-out;
  flex-shrink: 0;
}
.${scopeClass} .pill-cancel-btn:hover {
  background: ${chb};
  transform: scale(1.05);
}
.${scopeClass} .pill-cancel-btn:active {
  transform: scale(0.95);
}
@keyframes ${scopeClass}-pulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}
.${scopeClass} .pill-transcribing-text {
  color: ${tt};
  font-size: 12px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  animation: ${scopeClass}-pulse 1500ms infinite ease-in-out;
  text-shadow: 0 1px 2px ${shadow};
}
`;
}

// ── public API ──

export function createPillRenderer(container: HTMLElement, opts: PillOptions): Renderer {
  const p = opts.palette;
  const labels = opts.labels ?? {};
  const transcribingLabel = labels.transcribing ?? "Transcribing\u2026";
  const errorLabel = labels.error ?? "Error";
  const alpha = opts.animation?.smoothing_alpha ?? 0.3;
  const powerCurve = opts.animation?.power_curve ?? 0.7;
  const peakDecay = opts.animation?.peak_decay ?? 1.0;

  const scopeClass = `pill-scope-${++pillIdCounter}`;

  const smoother = createSmoother({ size: BAR_COUNT, alpha, peakDecay });

  // Inject scoped <style> for hover/keyframes
  const styleEl = document.createElement("style");
  styleEl.setAttribute("data-pill-scope", scopeClass);
  styleEl.textContent = generateScopedCSS(scopeClass, p);
  document.head.appendChild(styleEl);

  // Container grid layout (inline styles)
  Object.assign(container.style, {
    display: "grid",
    gridTemplateColumns: "auto 1fr auto",
    alignItems: "center",
    width: "172px",
    height: "36px",
    padding: "6px",
    boxSizing: "border-box",
    background: "transparent",
    borderRadius: "18px",
  });
  container.classList.add(scopeClass);

  let currentMode: ThemeState["mode"] | null = null;
  let barEls: HTMLElement[] = [];

  /** Full rebuild of left/middle/right slots. Called on mode change. */
  function rebuildDOM(mode: ThemeState["mode"]): void {
    // Clear children (container styles preserved)
    container.innerHTML = "";
    barEls = [];

    // ── left slot (icon) ──
    const leftEl = document.createElement("div");
    Object.assign(leftEl.style, {
      display: "flex",
      alignItems: "center",
      filter: `drop-shadow(0 1px 2px ${p.shadow})`,
    });
    leftEl.style.color = p.icon_color;
    if (mode === "recording") {
      leftEl.innerHTML = micSvg();
    } else {
      leftEl.innerHTML = transcriptionSvg();
    }
    container.appendChild(leftEl);

    // ── middle slot ──
    const middleEl = document.createElement("div");
    Object.assign(middleEl.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      filter: `drop-shadow(0 1px 2px ${p.shadow})`,
    });
    container.appendChild(middleEl);

    if (mode === "recording") {
      // 9-bar flex container
      const barsContainer = document.createElement("div");
      Object.assign(barsContainer.style, {
        display: "flex",
        alignItems: "end",
        justifyContent: "center",
        gap: `${GAP}px`,
        height: `${MAX_HEIGHT + 4}px`,
        overflow: "hidden",
      });
      for (let i = 0; i < BAR_COUNT; i++) {
        const bar = document.createElement("div");
        bar.className = "pill-bar";
        Object.assign(bar.style, {
          width: `${BAR_WIDTH}px`,
          background: p.bar_color,
          maxHeight: `${MAX_HEIGHT}px`,
          minHeight: `${MIN_PX}px`,
          height: `${MIN_PX}px`,
          opacity: `${MIN_OPACITY}`,
          borderRadius: "2px",
          boxShadow: `0 0 4px ${p.bar_glow}`,
          transition: "height 60ms ease-out, opacity 120ms ease-out",
        });
        barsContainer.appendChild(bar);
        barEls.push(bar);
      }
      middleEl.appendChild(barsContainer);
    } else if (mode === "transcribing") {
      const span = document.createElement("span");
      span.className = "pill-transcribing-text";
      span.textContent = transcribingLabel;
      middleEl.appendChild(span);
    } else if (mode === "error") {
      const span = document.createElement("span");
      span.className = "pill-transcribing-text";
      span.textContent = errorLabel;
      middleEl.appendChild(span);
    }
    // idle: empty middle slot

    // ── right slot ──
    const rightEl = document.createElement("div");
    Object.assign(rightEl.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "flex-end",
      filter: `drop-shadow(0 1px 2px ${p.shadow})`,
    });
    container.appendChild(rightEl);

    if (mode === "recording") {
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "pill-cancel-btn";
      cancelBtn.setAttribute("data-action", "cancel");
      cancelBtn.setAttribute("aria-label", "Cancel recording");
      cancelBtn.style.color = p.icon_color;
      cancelBtn.innerHTML = cancelSvg();
      cancelBtn.addEventListener("click", opts.onCancel);
      rightEl.appendChild(cancelBtn);
    }
  }

  return {
    update(state: ThemeState): void {
      const mode = state.mode;
      if (mode !== currentMode) {
        currentMode = mode;
        rebuildDOM(mode);
      }
      if (mode === "recording" && barEls.length > 0) {
        const resampled = resampleToBars(state.spectrumBins);
        const smoothed = smoother.push(resampled);
        for (let i = 0; i < barEls.length; i++) {
          const v = smoothed[i] ?? 0;
          barEls[i].style.height = `${barHeightPx(v, powerCurve)}px`;
          barEls[i].style.opacity = `${barOpacity(v)}`;
        }
      }
    },
    destroy(): void {
      if (styleEl.parentNode) {
        styleEl.parentNode.removeChild(styleEl);
      }
      // Undo every mutation we made on the caller's container so it can
      // be reused by another renderer (review REV-002).
      container.classList.remove(scopeClass);
      container.removeAttribute("style");
      container.innerHTML = "";
    },
  };
}
