// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getGPUTier = vi.fn();
vi.mock('detect-gpu', () => ({ getGPUTier: (opts: unknown) => getGPUTier(opts) }));

beforeEach(() => {
  // jsdom ships no matchMedia; the module reads reduced-motion and hover.
  window.matchMedia = ((media: string) => ({ media, matches: false })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  getGPUTier.mockReset();
  vi.resetModules();
});

describe('detectQuality', () => {
  it('probes once for concurrent callers, through the configured benchmarks URL', async () => {
    getGPUTier.mockResolvedValue({ tier: 3, type: 'BENCHMARK', fps: 240 });
    const { configureQuality, detectQuality } = await import('../src/quality/quality');

    configureQuality({ benchmarksURL: '/gpu-benchmarks' });
    const [a, b] = await Promise.all([detectQuality(), detectQuality()]);

    expect(getGPUTier).toHaveBeenCalledTimes(1);
    expect(getGPUTier).toHaveBeenCalledWith({ benchmarksURL: '/gpu-benchmarks' });
    expect(a).toBe(b);
    expect(a.tier).toBe('HIGH');
  });

  it('gives up on a hanging probe and takes the fallback tier', async () => {
    getGPUTier.mockReturnValue(new Promise(() => {}));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { configureQuality, detectQuality } = await import('../src/quality/quality');

    configureQuality({ timeoutMs: 5 });
    // Fallback is tier 1, which the pointer split turns into LOW without a mouse.
    expect((await detectQuality()).tier).toBe('LOW');
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
