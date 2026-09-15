import { describe, expect, it, vi } from 'vitest';

// three and the RGBE loader are stubbed: this asserts what `dispose()` frees,
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

vi.mock('three/examples/jsm/loaders/RGBELoader.js', () => ({
  RGBELoader: class {
    loadAsync = () => Promise.resolve(stubs.texture);
  },
}));

const { loadHDR } = await import('../src/loaders/hdr');

describe('loadHDR', () => {
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
