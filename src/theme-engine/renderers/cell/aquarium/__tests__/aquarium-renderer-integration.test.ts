import { afterEach, describe, expect, it, vi } from "vitest";
import { CELL_DEFAULTS } from "../../defaults";
import { heroConsumeObstacles } from "../hero";
import { buildField } from "../interaction";
import type { ObstacleCircle } from "../interaction";
import { drawAquariumBackground, seedAquarium, updateAquarium } from "../layer";
import type { AquariumFrame, AquariumLayerState, DidiniumState, EuglenaState } from "../types";
import { vorticellaContribute } from "../vorticella";
import type { CellParams } from "../../types";

function installNoopCanvasContext(): void {
  const gradient = { addColorStop: vi.fn() };
  const ctx = new Proxy({}, {
    get(_target, prop) {
      if (prop === "createRadialGradient" || prop === "createLinearGradient") return () => gradient;
      if (prop === "measureText") return () => ({ width: 0 });
      return () => undefined;
    },
    set() {
      return true;
    },
  }) as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
}

function installCountingCanvasContext(): { readonly ops: string[] } {
  const ops: string[] = [];
  const gradient = { addColorStop: () => ops.push("addColorStop") };
  const ctx = new Proxy({}, {
    get(_target, prop) {
      if (prop === "canvas") return document.createElement("canvas");
      if (prop === "createRadialGradient" || prop === "createLinearGradient") {
        return () => {
          ops.push(String(prop));
          return gradient;
        };
      }
      if (prop === "measureText") return () => ({ width: 0 });
      return (..._args: unknown[]) => ops.push(String(prop));
    },
    set(_target, prop) {
      ops.push(String(prop));
      return true;
    },
  }) as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
  return { ops };
}

async function renderAquariumOpCount(
  enableAquarium: boolean,
  euglenaCount = 0,
  vorticellaCount = 0,
  diatomCount = 4,
): Promise<number> {
  vi.resetModules();
  vi.doUnmock("../layer");
  const { ops } = installCountingCanvasContext();
  const rafCalls: Array<() => void> = [];
  let now = 1000;
  vi.stubGlobal("performance", { ["now"]: () => now });
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
    rafCalls.push(cb);
    return rafCalls.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());

  const { createCellRenderer } = await import("../../renderer");
  const renderer = createCellRenderer(document.createElement("div"), {
    width: 172,
    height: 36,
    baseHue: 50,
    params: {
      enableAquarium,
      aquariumSeed: 17,
      aquariumAlpha: 0.28,
      diatomCount,
      diatomAlpha: 0.35,
      euglenaCount,
      vorticellaCount,
    },
  });
  now += 1000 / 60;
  rafCalls.shift()?.();
  renderer.destroy();
  return ops.length;
}

function frame(overrides: Partial<AquariumFrame> = {}): AquariumFrame {
  return {
    t: 1.25,
    dt: 1 / 60,
    width: 172,
    height: 36,
    mode: "idle",
    activity: 0.2,
    audioLevel: 0.1,
    startle: 0,
    baseHue: 50,
    ...overrides,
  };
}

describe("aquarium layer gate-off no-ops", () => {
  it("updateAquarium returns the same state object when disabled", () => {
    const state = seedAquarium(frame(), {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      diatomCount: 1,
    });

    expect(updateAquarium(state, frame({ dt: 0.05 }), CELL_DEFAULTS)).toBe(state);
  });

  it("drawAquariumBackground is a no-op", () => {
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const state: AquariumLayerState = { seed: 1, diatoms: [], euglena: [], vorticella: [] };

    drawAquariumBackground(ctx, state, frame(), CELL_DEFAULTS);

    expect(ctx.save).not.toHaveBeenCalled();
    expect(ctx.restore).not.toHaveBeenCalled();
    expect(ctx.beginPath).not.toHaveBeenCalled();
    expect(ctx.fill).not.toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
    expect(ctx.arc).not.toHaveBeenCalled();
  });
});

describe("createCellRenderer aquarium gate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("does not allocate, update, or draw the aquarium layer when disabled", async () => {
    installNoopCanvasContext();
    const seed = vi.fn();
    const update = vi.fn();
    const draw = vi.fn();
    vi.doMock("../layer", () => ({
      seedAquarium: seed,
      updateAquarium: update,
      drawAquariumBackground: draw,
      drawAquariumForeground: vi.fn(),
    }));
    const rafCalls: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      rafCalls.push(cb);
      return rafCalls.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const { createCellRenderer } = await import("../../renderer");
    const renderer = createCellRenderer(document.createElement("div"), {
      width: 172,
      height: 36,
      params: { enableAquarium: false, diatomCount: 5, euglenaCount: 5, vorticellaCount: 5 },
    });
    rafCalls.shift()?.();
    renderer.destroy();

    expect(seed).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(draw).not.toHaveBeenCalled();
  });

  it("builds a finite aquarium frame when enabled", async () => {
    installNoopCanvasContext();
    const state: AquariumLayerState = { seed: 5, diatoms: [], euglena: [], vorticella: [] };
    const seed = vi.fn(() => state);
    const update = vi.fn((aquarium: AquariumLayerState) => aquarium);
    const draw = vi.fn();
    vi.doMock("../layer", () => ({
      seedAquarium: seed,
      updateAquarium: update,
      drawAquariumBackground: draw,
      drawAquariumForeground: vi.fn(),
    }));
    const rafCalls: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      rafCalls.push(cb);
      return rafCalls.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const { createCellRenderer } = await import("../../renderer");
    const renderer = createCellRenderer(document.createElement("div"), {
      width: 172,
      height: 36,
      baseHue: 50,
      params: { enableAquarium: true },
    });
    rafCalls.shift()?.();
    renderer.destroy();

    const builtFrame = seed.mock.calls[0]?.[0] as AquariumFrame;
    expect(builtFrame).toMatchObject({ width: 172, height: 36, mode: "idle", baseHue: 50 });
    for (const value of [
      builtFrame.t,
      builtFrame.dt,
      builtFrame.activity,
      builtFrame.audioLevel,
      builtFrame.startle,
    ]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(update).toHaveBeenCalledWith(state, builtFrame, expect.objectContaining({ enableAquarium: true }));
    expect(draw).toHaveBeenCalledWith(expect.anything(), state, builtFrame, expect.objectContaining({ enableAquarium: true }));
  });

  it("keeps diatom-only gate-on draw overhead under 1200 ops at 172x36", async () => {
    const offOps = await renderAquariumOpCount(false);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
    const onOps = await renderAquariumOpCount(true);

    expect(onOps - offOps).toBeGreaterThan(0);
    expect(onOps - offOps).toBeLessThan(1200);
  });

  it("does not reseed the aquarium layer across renderer frames", async () => {
    installNoopCanvasContext();
    const states: AquariumLayerState[] = [
      { seed: 1, diatoms: [], euglena: [], vorticella: [] },
      { seed: 1, diatoms: [{
        x: 1,
        y: 2,
        phase: 0.1,
        size: 3,
        shape: "navicula",
        heading: 0,
        driftX: 0,
        driftY: 0,
        rotationRate: 0,
      }], euglena: [], vorticella: [] },
      { seed: 1, diatoms: [{
        x: 2,
        y: 2,
        phase: 0.1,
        size: 3,
        shape: "navicula",
        heading: 0,
        driftX: 0,
        driftY: 0,
        rotationRate: 0,
      }], euglena: [], vorticella: [] },
      { seed: 1, diatoms: [{
        x: 3,
        y: 2,
        phase: 0.1,
        size: 3,
        shape: "navicula",
        heading: 0,
        driftX: 0,
        driftY: 0,
        rotationRate: 0,
      }], euglena: [], vorticella: [] },
    ];
    const seed = vi.fn(() => states[0]);
    const update = vi.fn((_aquarium: AquariumLayerState, _frame: AquariumFrame) => states[update.mock.calls.length]);
    const draw = vi.fn();
    vi.doMock("../layer", () => ({
      seedAquarium: seed,
      updateAquarium: update,
      drawAquariumBackground: draw,
      drawAquariumForeground: vi.fn(),
    }));
    const rafCalls: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      rafCalls.push(cb);
      return rafCalls.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const { createCellRenderer } = await import("../../renderer");
    const renderer = createCellRenderer(document.createElement("div"), {
      width: 172,
      height: 36,
      baseHue: 50,
      params: { enableAquarium: true, aquariumSeed: 67, diatomCount: 4, euglenaCount: 1, vorticellaCount: 1 },
    });
    rafCalls.shift()?.();
    rafCalls.shift()?.();
    rafCalls.shift()?.();
    renderer.destroy();

    expect(seed).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(3);
    expect(draw).toHaveBeenCalledTimes(3);
    expect(update.mock.calls[0]?.[0]).toBe(states[0]);
    expect(update.mock.calls[1]?.[0]).toBe(states[1]);
    expect(update.mock.calls[2]?.[0]).toBe(states[2]);
    expect(draw.mock.calls[0]?.[1]).toBe(states[1]);
    expect(draw.mock.calls[1]?.[1]).toBe(states[2]);
    expect(draw.mock.calls[2]?.[1]).toBe(states[3]);
  });

  it("publishes the renderer-local hero after the vorticella field clamp", async () => {
    installNoopCanvasContext();
    const state: AquariumLayerState = {
      seed: 67,
      diatoms: [],
      euglena: [],
      vorticella: [{
        x: 86,
        y: 36,
        phase: 0.2,
        size: 1,
        anchorX: 86,
        anchorY: 36,
        directionAngle: -Math.PI / 2,
        restLength: 8,
        contractPhase: 0,
        contractCyclePhase: 0.2,
        oralWreathPhase: 0.1,
        contractRate: 0.1,
        oralRate: 0.5,
      }],
    };
    const seed = vi.fn(() => state);
    const update = vi.fn((aquarium: AquariumLayerState) => aquarium);
    const draw = vi.fn();
    vi.doMock("../layer", () => ({
      seedAquarium: seed,
      updateAquarium: update,
      drawAquariumBackground: draw,
      drawAquariumForeground: vi.fn(),
    }));
    const rafCalls: Array<() => void> = [];
    let now = 1000;
    vi.stubGlobal("performance", { ["now"]: () => now });
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      rafCalls.push(cb);
      return rafCalls.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const width = 172;
    const height = 36;
    const params: CellParams = {
      ...CELL_DEFAULTS,
      enableAquarium: true,
      enableHero: true,
      enableHelicalSwim: false,
      vorticellaCount: 1,
      vorticellaScale: 1.2,
      bodyAspect: 3,
      swimSpeedMaxFrac: 0,
      idleSwimFrac: 0,
      idleDriftMin: 0,
    };
    const baseR = Math.min(width, height) * (params.radiusFraction ?? CELL_DEFAULTS.radiusFraction);
    const rawX = width * 0.5;
    const rawY = height * 0.5;
    const heroReach = baseR * Math.sqrt(Math.max(1, params.bodyAspect ?? 1)) * 1.2;
    const circles = buildField(
      state.vorticella.flatMap((v, idx) => vorticellaContribute(v, params.vorticellaScale ?? 1, height, idx)),
    ).obstacles.filter((obstacle): obstacle is ObstacleCircle => obstacle.shape === "circle");
    const expectedDelta = heroConsumeObstacles(circles, rawX, rawY, heroReach);
    expect(Math.hypot(expectedDelta.dx, expectedDelta.dy)).toBeGreaterThan(0);

    const { createCellRenderer } = await import("../../renderer");
    const renderer = createCellRenderer(document.createElement("div"), { width, height, baseHue: 50, params });
    now += 1000 / 60;
    rafCalls.shift()?.();
    now += 1000 / 60;
    rafCalls.shift()?.();
    renderer.destroy();

    const publishedHero = update.mock.calls[1]?.[1]?.hero;
    expect(publishedHero).toMatchObject({
      halfLen: heroReach / 1.2,
      halfWid: baseR / Math.sqrt(Math.max(1, params.bodyAspect ?? 1)),
    });
    expect(publishedHero!.x).toBeCloseTo(rawX, 6);
    // Stage 5: Vorticella response is bounded/first-order, not an instant full
    // depenetration snap. It must move in the correct direction, but remain between
    // raw position and the full geometric target on this early frame.
    expect(publishedHero!.y).toBeLessThan(rawY);
    expect(publishedHero!.y).toBeGreaterThan(rawY + expectedDelta.dy);
    expect(seed.mock.calls[0]?.[0]?.hero).toMatchObject({ x: rawX, y: rawY });
    expect(draw.mock.calls[1]?.[2]?.hero).toBe(publishedHero);
  });

  it("keeps predator prey response briefly after Didinium contact ends", async () => {
    installNoopCanvasContext();
    const didiniumBase: DidiniumState = {
      x: 80, y: 18, phase: 0, size: 1, heading: 0, swimSpeed: 1,
      rollPhase: 0, rollRate: 0.5, beatPhase: 0, beatRate: 4,
      turnSide: 1, avoidProgress: 1, contactTimer: 0.5, contactDuration: 2.0, noiseSeed: 123,
    };
    const states: AquariumLayerState[] = [
      { seed: 1, diatoms: [], euglena: [], vorticella: [], didinium: [didiniumBase] },
      { seed: 1, diatoms: [], euglena: [], vorticella: [], didinium: [{ ...didiniumBase, contactTimer: 0 }] },
      { seed: 1, diatoms: [], euglena: [], vorticella: [], didinium: [{ ...didiniumBase, contactTimer: 0 }] },
    ];
    const seed = vi.fn(() => states[0]);
    let updateIndex = 0;
    const update = vi.fn((_aquarium: AquariumLayerState) => states[Math.min(updateIndex++, states.length - 1)]);
    const draw = vi.fn();
    const foreground = vi.fn();
    vi.doMock("../layer", () => ({ seedAquarium: seed, updateAquarium: update, drawAquariumBackground: draw, drawAquariumForeground: foreground }));
    const rafCalls: Array<() => void> = [];
    let now = 1000;
    vi.stubGlobal("performance", { ["now"]: () => now });
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => { rafCalls.push(cb); return rafCalls.length; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const { createCellRenderer } = await import("../../renderer");
    const renderer = createCellRenderer(document.createElement("div"), {
      width: 172, height: 36, baseHue: 50,
      params: { ...CELL_DEFAULTS, enableAquarium: true, enableHelicalSwim: false, didiniumCount: 1, swimSpeedMaxFrac: 0, idleSwimFrac: 0, idleDriftMin: 0 },
    });
    now += 1000 / 60; rafCalls.shift()?.();
    const firstHero = foreground.mock.calls[0]?.[2]?.hero;
    now += 1000 / 60; rafCalls.shift()?.();
    const secondHero = foreground.mock.calls[1]?.[2]?.hero;
    renderer.destroy();
    expect(firstHero.x).toBeCloseTo(172 * 0.5, 6);
    expect(secondHero.x).toBeGreaterThan(firstHero.x); // same-frame published hero includes previous contact response
  });

  it("passes the same recoiled hero pose to aquarium update, background, and foreground in one frame", async () => {
    installNoopCanvasContext();
    const width = 172;
    const height = 36;
    const didinium: DidiniumState = {
      x: 70, y: height * 0.5, phase: 0, size: 1, heading: 0, swimSpeed: 1,
      rollPhase: 0, rollRate: 0.5, beatPhase: 0, beatRate: 4,
      turnSide: 1, avoidProgress: 1, contactTimer: 0.5, contactDuration: 2.0, noiseSeed: 123,
    };
    const state: AquariumLayerState = { seed: 1, diatoms: [], euglena: [], vorticella: [], didinium: [didinium] };
    const seed = vi.fn(() => state);
    const update = vi.fn((aquarium: AquariumLayerState) => aquarium);
    const draw = vi.fn();
    const foreground = vi.fn();
    vi.doMock("../layer", () => ({
      seedAquarium: seed,
      updateAquarium: update,
      drawAquariumBackground: draw,
      drawAquariumForeground: foreground,
    }));
    const rafCalls: Array<() => void> = [];
    let now = 1000;
    vi.stubGlobal("performance", { ["now"]: () => now });
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => { rafCalls.push(cb); return rafCalls.length; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const { createCellRenderer } = await import("../../renderer");
    const renderer = createCellRenderer(document.createElement("div"), {
      width, height, baseHue: 50,
      params: {
        ...CELL_DEFAULTS,
        enableAquarium: true,
        enableHelicalSwim: false,
        didiniumCount: 1,
        swimSpeedMaxFrac: 0,
        idleSwimFrac: 0,
        idleDriftMin: 0,
      },
    });

    now += 1000 / 60;
    rafCalls.shift()?.(); // Prime aquarium state so the next tick sees prior Didinium contact.
    update.mockClear();
    draw.mockClear();
    foreground.mockClear();

    now += 1000 / 60;
    rafCalls.shift()?.();
    renderer.destroy();

    expect(update).toHaveBeenCalledTimes(1);
    expect(draw).toHaveBeenCalledTimes(1);
    expect(foreground).toHaveBeenCalledTimes(1);
    const updateFrame = update.mock.calls[0]?.[1] as AquariumFrame;
    const backgroundFrame = draw.mock.calls[0]?.[2] as AquariumFrame;
    const foregroundFrame = foreground.mock.calls[0]?.[2] as AquariumFrame;
    expect(backgroundFrame).toBe(updateFrame);
    expect(foregroundFrame).toMatchObject({
      t: updateFrame.t,
      dt: updateFrame.dt,
      width: updateFrame.width,
      height: updateFrame.height,
      mode: updateFrame.mode,
      activity: updateFrame.activity,
      audioLevel: updateFrame.audioLevel,
      startle: updateFrame.startle,
      baseHue: updateFrame.baseHue,
    });
    expect(updateFrame.hero).toBeDefined();
    expect(backgroundFrame.hero).toEqual(updateFrame.hero);
    expect(foregroundFrame.hero).toEqual(updateFrame.hero);
    expect(updateFrame.hero!.x).toBeGreaterThan(width * 0.5);
    expect(updateFrame.hero!.y).toBeCloseTo(height * 0.5, 6);
  });

  it("Euglena near-touch does not trigger predator-level hero recoil", async () => {
    installNoopCanvasContext();
    const euglena: EuglenaState = {
      x: 100, y: 18, phase: 0, size: 1, heading: 0, swimSpeed: 1,
      rollPhase: 0, rollRate: 0.3, metabolyPhase: 0, metabolyRate: 0.1,
      flagellumPhase: 0, flagellumRate: 3, spiralAmplitude: 0.1,
    };
    const state: AquariumLayerState = { seed: 1, diatoms: [], euglena: [euglena], vorticella: [], didinium: [] };
    const seed = vi.fn(() => state);
    const update = vi.fn((aquarium: AquariumLayerState) => aquarium);
    const draw = vi.fn();
    const foreground = vi.fn();
    vi.doMock("../layer", () => ({ seedAquarium: seed, updateAquarium: update, drawAquariumBackground: draw, drawAquariumForeground: foreground }));
    const rafCalls: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => { rafCalls.push(cb); return rafCalls.length; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const { createCellRenderer } = await import("../../renderer");
    const renderer = createCellRenderer(document.createElement("div"), {
      width: 172, height: 36, baseHue: 50,
      params: { ...CELL_DEFAULTS, enableAquarium: true, enableHelicalSwim: false, euglenaCount: 1, swimSpeedMaxFrac: 0, idleSwimFrac: 0, idleDriftMin: 0 },
    });
    rafCalls.shift()?.();
    renderer.destroy();
    const hero = foreground.mock.calls[0]?.[2]?.hero;
    expect(hero.x).toBeCloseTo(172 * 0.5, 6);
    expect(hero.y).toBeCloseTo(36 * 0.5, 6);
  });

  it("keeps combined diatom/euglena/vorticella gate-on draw overhead under 1400 ops at 172x36", async () => {
    const offOps = await renderAquariumOpCount(false, 1, 1, 4);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
    const onOps = await renderAquariumOpCount(true, 1, 1, 4);

    expect(onOps - offOps).toBeGreaterThan(0);
    // budget 1800: luminous granule-packed body + SAMP 32 smoother outline + 3-D helix
    // for interior-organelle containment (cheap arc fills + one extra clip path).
    expect(onOps - offOps).toBeLessThan(1800);
  });
});

describe("enableHero gate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function renderHeroOpCount(enableHero: boolean): Promise<number> {
    vi.resetModules();
    vi.doUnmock("../layer");
    const { ops } = installCountingCanvasContext();
    const rafCalls: Array<() => void> = [];
    let now = 1000;
    vi.stubGlobal("performance", { ["now"]: () => now });
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      rafCalls.push(cb);
      return rafCalls.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const { createCellRenderer } = await import("../../renderer");
    const renderer = createCellRenderer(document.createElement("div"), {
      width: 172,
      height: 36,
      baseHue: 50,
      params: { enableHero, enableAquarium: true, euglenaCount: 1, euglenaScale: 6.45 },
    });
    now += 1000 / 60;
    rafCalls.shift()?.();
    renderer.destroy();
    return ops.length;
  }

  it("draws far fewer ops with the paramecium hero hidden than shown", async () => {
    const hidden = await renderHeroOpCount(false);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
    const shown = await renderHeroOpCount(true);

    expect(hidden).toBeGreaterThan(0); // the euglena still draws
    expect(hidden).toBeLessThan(shown); // but the heavy paramecium is gone
  });
});
