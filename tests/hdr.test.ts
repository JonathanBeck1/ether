import { describe, expect, it, vi } from 'vitest';

// three and its HDR loaders are stubbed: this asserts what `dispose()` frees,
// which needs no GL context.
const stubs = vi.hoisted(() => {
  const target = { texture: { dispose: vi.fn() }, dispose: vi.fn() };
  const generator = { fromEquirectangular: vi.fn(() => target), dispose: vi.fn() };
  const texture = { mapping: 0, dispose: vi.fn() };
  return { target, generator, texture };
});

vi.mock('three', () => ({
  EquirectangularReflectionMapping: 303,
  PMREMGenerator: class {
    fromEquirectangular = stubs.generator.fromEquirectangular;
    dispose = stubs.generator.dispose;
  },
}));

vi.mock('three/examples/jsm/loaders/HDRLoader.js', () => ({
  HDRLoader: class {
    loadAsync = () => Promise.resolve(stubs.texture);
  },
}));

// As three ships it since r180: HDRLoader plus a warning on every construction.
vi.mock('three/examples/jsm/loaders/RGBELoader.js', async () => {
  const { HDRLoader } = await import('three/examples/jsm/loaders/HDRLoader.js');
  return {
    RGBELoader: class extends HDRLoader {
      constructor() {
        console.warn('RGBELoader has been deprecated. Please use HDRLoader instead.');
        super();
      }
    },
  };
});

const { loadHDR } = await import('../src/loaders/hdr');

describe('loadHDR', () => {
  it('loads through HDRLoader, so three logs no deprecation warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await loadHDR('/env.hdr');

    expect(warn).not.toHaveBeenCalled();
    expect(result.texture).toBe(stubs.texture);
    expect(result.texture.mapping).toBe(303);
    expect(result.envMap).toBeUndefined();
    warn.mockRestore();
  });

  it('disposes the PMREM render target and the generator, not just the env texture', async () => {
    const renderer = {} as never;
    const result = await loadHDR('/env.hdr', { renderer });

    expect(stubs.generator.fromEquirectangular).toHaveBeenCalledWith(stubs.texture);
    expect(result.envMap).toBe(stubs.target.texture);

    result.dispose();
    // The cubeUV target owns the framebuffer; three never marks its texture
    // initialised, so disposing that alone frees nothing.
    expect(stubs.target.dispose).toHaveBeenCalledTimes(1);
    expect(stubs.generator.dispose).toHaveBeenCalledTimes(1);
    expect(stubs.texture.dispose).toHaveBeenCalledTimes(1);
  });
});
