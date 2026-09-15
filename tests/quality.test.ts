import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gpu = vi.hoisted(() => ({ tier: 3, fps: 240 as number | undefined, fail: false, probes: 0 }));

vi.mock('detect-gpu', () => ({
  getGPUTier: async () => {
    gpu.probes += 1;
    if (gpu.fail) throw new Error('WebGL probe failed');
    return { tier: gpu.tier, fps: gpu.fps };
  },
}));

const load = async () => {
  vi.resetModules();
  return import('../src/quality/quality');
};

const browser = (opts: { hover?: boolean; reducedMotion?: boolean } = {}) => {
  const answers: Record<string, boolean> = {
    '(hover: hover)': opts.hover ?? true,
    '(prefers-reduced-motion: reduce)': opts.reducedMotion ?? false,
  };
  vi.stubGlobal('window', { matchMedia: (query: string) => ({ matches: answers[query] ?? false }) });
};

beforeEach(() => {
  gpu.tier = 3;
  gpu.fps = 240;
  gpu.fail = false;
  gpu.probes = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('detectQuality tiers', () => {
  it('gives a top-tier GPU the full HIGH profile', async () => {
    browser();
    gpu.tier = 3;
    const { detectQuality } = await load();
    const q = await detectQuality();
    expect(q.tier).toBe('HIGH');
    expect(q.dprCap).toBe(2);
    expect(q.msaaSamples).toBe(4);
    expect(q.enableSmoothScroll).toBe(true);
  });

  it('gives a mid GPU 2x composer MSAA and the same DPR cap as LOW', async () => {
    browser();
    gpu.tier = 2;
    const { detectQuality } = await load();
    const q = await detectQuality();
    expect(q.tier).toBe('MID');
    expect(q.dprCap).toBe(1.5);
    expect(q.msaaSamples).toBe(2);
    expect(q.enableSmoothScroll).toBe(true);
  });

  it('drops LOW to native scroll and no composer MSAA', async () => {
    browser();
    gpu.tier = 0;
    const { detectQuality } = await load();
    const q = await detectQuality();
    expect(q.tier).toBe('LOW');
    expect(q.dprCap).toBe(1.5);
    expect(q.msaaSamples).toBe(0);
    expect(q.enableSmoothScroll).toBe(false);
  });

  it('splits tier 1 by pointer: a phone lands LOW, a trackpad lands MID', async () => {
    gpu.tier = 1;
    browser({ hover: false });
    const touch = await (await load()).detectQuality();
    expect(touch.tier).toBe('LOW');

    browser({ hover: true });
    const desktop = await (await load()).detectQuality();
    expect(desktop.tier).toBe('MID');
  });

  it('keeps postfx, dither and context-MSAA-off on every tier', async () => {
    for (const tier of [0, 1, 2, 3]) {
      gpu.tier = tier;
      browser();
      const q = await (await load()).detectQuality();
      expect(q.enablePostFX).toBe(true);
      expect(q.enableDither).toBe(true);
      expect(q.antialias).toBe(false);
    }
  });

  it('reports the raw benchmark score, and 0 when detect-gpu has none', async () => {
    browser();
    gpu.fps = 173;
    expect((await (await load()).detectQuality()).rawScore).toBe(173);
    gpu.fps = undefined;
    expect((await (await load()).detectQuality()).rawScore).toBe(0);
  });
});

describe('detectQuality fallbacks', () => {
  it('assumes LOW instead of rejecting when the GPU probe throws', async () => {
    browser();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    gpu.fail = true;
    const q = await (await load()).detectQuality();
    expect(q.tier).toBe('LOW');
    expect(q.rawScore).toBe(0);
  });

  it('resolves with no window at all, so an SSR import cannot crash a build', async () => {
    gpu.tier = 3;
    const q = await (await load()).detectQuality();
    expect(q.tier).toBe('HIGH');
    expect(q.reducedMotion).toBe(false);
  });
});

describe('detectQuality reduced motion', () => {
  it('downgrades exactly one tier, never two', async () => {
    gpu.tier = 3;
    browser({ reducedMotion: true });
    const high = await (await load()).detectQuality();
    expect(high.tier).toBe('MID');
    expect(high.msaaSamples).toBe(2);
    expect(high.enableSmoothScroll).toBe(true);
    expect(high.reducedMotion).toBe(true);

    gpu.tier = 2;
    browser({ reducedMotion: true });
    expect((await (await load()).detectQuality()).tier).toBe('LOW');

    gpu.tier = 0;
    browser({ reducedMotion: true });
    expect((await (await load()).detectQuality()).tier).toBe('LOW');
  });
});

describe('getQuality', () => {
  it('is null until detection has run, then mirrors the resolved profile', async () => {
    browser();
    const { detectQuality, getQuality } = await load();
    expect(getQuality()).toBeNull();
    const q = await detectQuality();
    expect(getQuality()).toBe(q);
  });

  it('probes the GPU once and hands every later caller the same profile', async () => {
    browser();
    const { detectQuality } = await load();
    const first = await detectQuality();
    const second = await detectQuality();
    expect(second).toBe(first);
    expect(gpu.probes).toBe(1);
  });
});
