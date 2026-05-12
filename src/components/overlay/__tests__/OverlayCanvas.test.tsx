/**
 * Tests for OverlayCanvas dispatcher.
 *
 * Verifies the family/mode switch correctly picks the underlying renderer
 * without mutating the source spectrum components.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

// Stub OrganicRing — canvas + RAF aren't relevant for dispatcher tests.
vi.mock("../OrganicRing", () => ({
  default: (props: { color: string }) => (
    <div data-testid="organic-ring" data-color={props.color} />
  ),
}));

// Stub spectrum components with identifiable DOM markers.
vi.mock("../../spectrum/IdleSpectrum", () => ({
  default: () => <div data-testid="idle-spectrum" />,
}));
vi.mock("../../spectrum/RecordingSpectrum", () => ({
  default: ({ bins, useGradient }: { bins: number[]; useGradient: boolean }) => (
    <div
      data-testid="recording-spectrum"
      data-bin-count={bins.length}
      data-gradient={String(useGradient)}
    />
  ),
}));
vi.mock("../../spectrum/TranscribingSpectrum", () => ({
  default: ({ pulsePhase }: { pulsePhase: number }) => (
    <div data-testid="transcribing-spectrum" data-pulse={pulsePhase} />
  ),
}));
vi.mock("../../spectrum/ErrorSpectrum", () => ({
  default: () => <div data-testid="error-spectrum" />,
}));

import OverlayCanvas from "../OverlayCanvas";
import type { OverlaySnapshot } from "../../../hooks/useOverlayState";
import type { OverlayThemeData } from "../../../bindings";

function snapshot(overrides: Partial<OverlaySnapshot> = {}): OverlaySnapshot {
  return {
    mode: "idle",
    audioLevel: 0,
    spectrumBins: new Array<number>(32).fill(0.1),
    themeId: "winamp_classic",
    ...overrides,
  };
}

function barsTheme(): OverlayThemeData {
  return {
    id: "winamp_classic",
    name: "Winamp Classic",
    family: "bars",
    colors: {
      use_gradient: true,
      gradient_bottom: "#299400",
      gradient_middle: "#d6b521",
      gradient_top: "#ef3110",
      recording: "#ef3110",
      transcribing: "#29ce10",
      idle: "#299400",
    },
    organic_ring: null,
  };
}

function organicTheme(): OverlayThemeData {
  return {
    id: "living_reed",
    name: "Living Reed",
    family: "organic_ring",
    colors: {
      use_gradient: true,
      gradient_bottom: "#3a6841",
      gradient_middle: "#7cc287",
      gradient_top: "#c4eac8",
      recording: "#7cc287",
      transcribing: "#4caf50",
      idle: "#3a6841",
    },
    organic_ring: {
      shape: {
        gap_degrees: 42,
        base_thickness: 7.2,
        taper: 0.7,
        roundness: 0.9,
        active_zones: 3,
      },
      motion: {
        idle_breathing: 0.1,
        speech_responsiveness: 0.92,
        drift: 0.38,
        settle_speed: 0.6,
      },
    },
  };
}

afterEach(() => cleanup());

describe("OverlayCanvas", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders IdleSpectrum when theme is null (graceful default)", () => {
    const { getByTestId } = render(
      <OverlayCanvas snapshot={snapshot()} theme={null} />,
    );
    expect(getByTestId("idle-spectrum")).toBeTruthy();
  });

  it("renders IdleSpectrum for bars family + idle mode", () => {
    const { getByTestId } = render(
      <OverlayCanvas snapshot={snapshot({ mode: "idle" })} theme={barsTheme()} />,
    );
    expect(getByTestId("idle-spectrum")).toBeTruthy();
  });

  it("renders RecordingSpectrum with spectrumBins for bars + recording", () => {
    const { getByTestId } = render(
      <OverlayCanvas
        snapshot={snapshot({ mode: "recording" })}
        theme={barsTheme()}
      />,
    );
    const node = getByTestId("recording-spectrum");
    expect(node.getAttribute("data-bin-count")).toBe("32");
    expect(node.getAttribute("data-gradient")).toBe("true");
  });

  it("renders TranscribingSpectrum for bars + transcribing", () => {
    const { getByTestId } = render(
      <OverlayCanvas
        snapshot={snapshot({ mode: "transcribing" })}
        theme={barsTheme()}
      />,
    );
    expect(getByTestId("transcribing-spectrum")).toBeTruthy();
  });

  it("renders ErrorSpectrum for bars + error", () => {
    const { getByTestId } = render(
      <OverlayCanvas snapshot={snapshot({ mode: "error" })} theme={barsTheme()} />,
    );
    expect(getByTestId("error-spectrum")).toBeTruthy();
  });

  it("renders OrganicRing for organic_ring family", () => {
    const { getByTestId } = render(
      <OverlayCanvas
        snapshot={snapshot({ mode: "recording" })}
        theme={organicTheme()}
      />,
    );
    expect(getByTestId("organic-ring")).toBeTruthy();
  });

  it("passes mode-appropriate color from theme.colors to OrganicRing", () => {
    const { getByTestId, rerender } = render(
      <OverlayCanvas
        snapshot={snapshot({ mode: "recording" })}
        theme={organicTheme()}
      />,
    );
    expect(getByTestId("organic-ring").getAttribute("data-color")).toBe("#7cc287");

    rerender(
      <OverlayCanvas
        snapshot={snapshot({ mode: "idle" })}
        theme={organicTheme()}
      />,
    );
    expect(getByTestId("organic-ring").getAttribute("data-color")).toBe("#3a6841");
  });

  it("falls back to IdleSpectrum when family=organic_ring but organic_ring data is null", () => {
    const malformed: OverlayThemeData = {
      ...organicTheme(),
      organic_ring: null,
    };
    const { getByTestId } = render(
      <OverlayCanvas
        snapshot={snapshot({ mode: "recording" })}
        theme={malformed}
      />,
    );
    expect(getByTestId("idle-spectrum")).toBeTruthy();
  });
});
