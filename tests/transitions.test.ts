import { describe, expect, it, vi } from 'vitest';
import type * as THREE from 'three';
import { SceneManager } from '../src/core/SceneManager';
import type { Scene } from '../src/core/types';
import type { QualityProfile } from '../src/quality/quality';

// The renderer is the only part of a hop that needs a GPU, and nothing
// here draws — stub it so the real transition logic runs under node.
vi.mock('three', () => ({
  SRGBColorSpace: 'srgb',
  NoToneMapping: 0,
  WebGLRenderer: class {
    readonly domElement: unknown;
    outputColorSpace = '';
    toneMapping = 0;
    constructor(parameters: { canvas: unknown }) {
      this.domElement = parameters.canvas;
    }
    setPixelRatio(): void {}
    setSize(): void {}
    dispose(): void {}
  },
}));

let fireResizeObserver: (() => void) | null = null;

vi.stubGlobal(
  'ResizeObserver',
  class {
    constructor(callback: () => void) {
      fireResizeObserver = callback;
    }
    observe(): void {}
    disconnect(): void {}
  },
);
vi.stubGlobal('window', {
  devicePixelRatio: 1,
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  addEventListener: () => {},
  removeEventListener: () => {},
});

// Only the knobs the manager reads off a profile.
const QUALITY = { tier: 'MID', dprCap: 1.5, antialias: false } as QualityProfile;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Hooks {
  preload?: () => Promise<void>;
  exit?: () => Promise<void>;
}

class FakeScene implements Scene {
  readonly scene = {} as THREE.Scene;
  readonly camera = {
    aspect: 0,
    updateProjectionMatrix() {},
  } as unknown as THREE.PerspectiveCamera;
  disposed = 0;
  resizes: Array<[number, number]> = [];
  composerSizes: unknown[][] = [];
  readonly composer = {
    setSize: (...args: unknown[]) => void this.composerSizes.push(args),
  } as unknown as Scene['composer'];

  constructor(
    readonly name: string,
    private readonly hooks: Hooks = {},
  ) {}

  async preload(): Promise<void> {
    await this.hooks.preload?.();
  }
  async enterTransition(): Promise<void> {}
  async exitTransition(): Promise<void> {
    await this.hooks.exit?.();
  }
  tick(): void {}
  onResize(width: number, height: number): void {
    this.resizes.push([width, height]);
  }
  dispose(): void {
    this.disposed++;
  }
}

function createManager() {
  const canvas = {
    clientWidth: 1000,
    clientHeight: 500,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const manager = new SceneManager(canvas as unknown as HTMLCanvasElement, QUALITY);
  return { canvas, manager };
}

const activeName = (manager: SceneManager) => (manager.activeScene as FakeScene | null)?.name ?? null;

describe('SceneManager transitions', () => {
  it('disposes the outgoing scene when its exitTransition rejects, and stays navigable', async () => {
    const { manager } = createManager();
    const a = new FakeScene('A', { exit: () => Promise.reject(new Error('exit failed')) });
    const b = new FakeScene('B');
    manager.registerScene('/a', () => a);
    manager.registerScene('/b', () => b);

    await manager.transitionTo('/a');
    await expect(manager.transitionTo('/b')).rejects.toThrow('exit failed');
    expect(a.disposed).toBe(1);
    expect(manager.activeScene).toBe(null);

    await manager.transitionTo('/b');
    expect(activeName(manager)).toBe('B');
  });

  it('clears the route when a factory throws, so the working route can be re-entered', async () => {
    const { manager } = createManager();
    const a = new FakeScene('A');
    manager.registerScene('/a', () => a);
    manager.registerScene('/bad', () => {
      throw new Error('factory failed');
    });

    await manager.transitionTo('/a');
    await expect(manager.transitionTo('/bad')).rejects.toThrow('factory failed');
    expect(manager.activeScene).toBe(null);

    await manager.transitionTo('/a');
    expect(activeName(manager)).toBe('A');
  });

  it('clears the route when preload() throws, so the working route can be re-entered', async () => {
    const { manager } = createManager();
    const a = new FakeScene('A');
    manager.registerScene('/a', () => a);
    manager.registerScene(
      '/bad',
      () => new FakeScene('BAD', { preload: () => Promise.reject(new Error('preload failed')) }),
    );

    await manager.transitionTo('/a');
    await expect(manager.transitionTo('/bad')).rejects.toThrow('preload failed');
    expect(manager.activeScene).toBe(null);

    await manager.transitionTo('/a');
    expect(activeName(manager)).toBe('A');
  });

  it('applies a resize that lands during preload() to the scene that goes live', async () => {
    const { canvas, manager } = createManager();
    let releasePreload!: () => void;
    const gate = new Promise<void>((resolve) => {
      releasePreload = resolve;
    });
    const a = new FakeScene('A');
    const b = new FakeScene('B', { preload: () => gate });
    manager.registerScene('/a', () => a);
    manager.registerScene('/b', () => b);

    await manager.transitionTo('/a');
    const hop = manager.transitionTo('/b');
    await sleep(10); // B is constructed, sized, and parked in preload()

    canvas.clientWidth = 800;
    canvas.clientHeight = 800;
    fireResizeObserver?.();
    await sleep(200); // past the handler's 150ms debounce

    releasePreload();
    await hop;

    expect(b.camera.aspect).toBe(1);
    expect(b.resizes.at(-1)).toEqual([800, 800]);
    // updateStyle false — the engine never writes inline canvas styles.
    expect(b.composerSizes.at(-1)).toEqual([800, 800, false]);
  });
});
