import { describe, it, expect } from "vitest";
import { makeSpectrum, SCENARIOS, getScenario } from "../scenarios";

describe("makeSpectrum", () => {
  it("returns 32 bins in [0,1]", () => {
    const bins = makeSpectrum(0.8, 5);
    expect(bins).toHaveLength(32);
    for (const b of bins) {
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
    }
  });
  it("scales with level (louder → larger average)", () => {
    const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    expect(avg(makeSpectrum(0.9, 0))).toBeGreaterThan(avg(makeSpectrum(0.1, 0)));
  });
});

describe("scenarios", () => {
  it("exposes speech-growth, startle, idle-morph, steady", () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(ids).toEqual(
      expect.arrayContaining(["speech_growth", "startle_burst", "idle_morph", "steady_speech"]),
    );
  });
  it("each scenario yields valid ThemeState across its frames", () => {
    for (const sc of SCENARIOS) {
      for (const f of [0, Math.floor(sc.frames / 2), sc.frames - 1]) {
        const s = sc.at(f);
        expect(["idle", "recording", "transcribing", "error"]).toContain(s.mode);
        expect(s.audioLevel).toBeGreaterThanOrEqual(0);
        expect(s.audioLevel).toBeLessThanOrEqual(1);
        expect(s.spectrumBins).toHaveLength(32);
      }
    }
  });
  it("speech_growth: recording with rising-then-loud audio, ends in silence", () => {
    const sc = getScenario("speech_growth")!;
    expect(sc.at(0).mode).toBe("recording");
    const mid = sc.at(Math.floor(sc.frames * 0.5));
    expect(mid.audioLevel).toBeGreaterThan(0.3);
    expect(sc.at(sc.frames - 1).audioLevel).toBeCloseTo(0, 1); // trails into silence
  });
  it("startle_burst: a sudden spike frame far above its neighbours", () => {
    const sc = getScenario("startle_burst")!;
    let maxJump = 0;
    for (let f = 1; f < sc.frames; f++) {
      maxJump = Math.max(maxJump, sc.at(f).audioLevel - sc.at(f - 1).audioLevel);
    }
    expect(maxJump).toBeGreaterThan(0.5); // a real sharp onset
  });
  it("idle_morph: stays in idle/silence so the resting morph shows", () => {
    const sc = getScenario("idle_morph")!;
    for (const f of [0, sc.frames - 1]) {
      expect(sc.at(f).mode).toBe("idle");
      expect(sc.at(f).audioLevel).toBeCloseTo(0, 2);
    }
  });
  it("getScenario returns undefined for unknown id", () => {
    expect(getScenario("nope")).toBeUndefined();
  });
});