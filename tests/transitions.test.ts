import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  dispose?: () => void;
}

class FakeScene implements Scene {
  readonly scene = {} as THREE.Scene;
  readonly camera = {
    aspect: 0,
    updateProjectionMatrix() {},
  } as unknown as THREE.PerspectiveCamera;
  disposed = 0;
  entered = 0;
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
  async enterTransition(): Promise<void> {
    this.entered++;
  }
  async exitTransition(): Promise<void> {
    await this.hooks.exit?.();
  }
  tick(): void {}
  onResize(width: number, height: number): void {
    this.resizes.push([width, height]);
  }
  dispose(): void {
    this.disposed++;
    this.hooks.dispose?.();
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

function latch() {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { gate, open };
}

describe('SceneManager transitions', () => {
  let errors: unknown[][] = [];
  beforeEach(() => {
    errors = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void errors.push(args));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('disposes the outgoing scene when its exitTransition rejects, and stays navigable', async () => {
    const { manager } = createManager();
    const a = new FakeScene('A', { exit: () => Promise.reject(new Error('exit failed')) });
    const b = new FakeScene('B');
    manager.registerScene('/a', () => a);
    manager.registerScene('/b', () => b);

    await manager.transitionTo('/a');
    await manager.transitionTo('/b');
    expect(errors.at(-1)?.[0]).toBe('[SceneManager] transition failed for /b:');
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
    await manager.transitionTo('/bad');
    expect(errors.at(-1)?.[0]).toBe('[SceneManager] transition failed for /bad:');
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
    await manager.transitionTo('/bad');
    expect(errors.at(-1)?.[0]).toBe('[SceneManager] transition failed for /bad:');
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

  it('skips building a hop overtaken during the exit, even back to the departed route', async () => {
    const { manager } = createManager();
    const exit = latch();
    const scenes: FakeScene[] = [];
    manager.registerScene('/a', () => {
      const a = new FakeScene('A', { exit: () => exit.gate });
      scenes.push(a);
      return a;
    });
    const buildB = vi.fn(() => new FakeScene('B'));
    manager.registerScene('/b', buildB);

    await manager.transitionTo('/a');
    const hop = manager.transitionTo('/b');
    await sleep(10); // A is parked in exitTransition()
    void manager.transitionTo('/a');
    exit.open();
    await hop;

    expect(buildB).not.toHaveBeenCalled();
    expect(scenes.map((a) => a.disposed)).toEqual([1, 0]);
    expect(manager.activeScene).toBe(scenes[1]);
    await manager.transitionTo('/a'); // the route settled on /a, so this is a no-op
    expect(scenes).toHaveLength(2);
  });

  it('disposes a scene overtaken during preload() without activating it', async () => {
    const { manager } = createManager();
    const preload = latch();
    const a = new FakeScene('A');
    const b = new FakeScene('B', { preload: () => preload.gate });
    const c = new FakeScene('C');
    manager.registerScene('/a', () => a);
    manager.registerScene('/b', () => b);
    manager.registerScene('/c', () => c);

    await manager.transitionTo('/a');
    const hop = manager.transitionTo('/b');
    await sleep(10); // B is constructed and parked in preload()
    void manager.transitionTo('/c');
    preload.open();
    await hop;

    expect(b.disposed).toBe(1);
    expect(b.entered).toBe(0);
    expect(activeName(manager)).toBe('C');
    expect(c.entered).toBe(1);
  });

  it('still rebuilds when a forced same-route navigation lands mid-hop', async () => {
    const { manager } = createManager();
    const preload = latch();
    const built: FakeScene[] = [];
    manager.registerScene('/a', () => new FakeScene('A'));
    manager.registerScene('/b', () => {
      const b = new FakeScene('B', built.length === 0 ? { preload: () => preload.gate } : {});
      built.push(b);
      return b;
    });

    await manager.transitionTo('/a');
    const hop = manager.transitionTo('/b');
    await sleep(10); // the first B is parked in preload()
    void manager.transitionTo('/b', { force: true });
    preload.open();
    await hop;

    expect(built).toHaveLength(2);
    expect(built[0].entered).toBe(1);
    expect(built[0].disposed).toBe(1);
    expect(manager.activeScene).toBe(built[1]);
    expect(built[1].disposed).toBe(0);
  });

  it('lets a hop finish when an unforced same-route navigation lands mid-preload', async () => {
    const { manager } = createManager();
    const preload = latch();
    const buildB = vi.fn(() => new FakeScene('B', { preload: () => preload.gate }));
    manager.registerScene('/a', () => new FakeScene('A'));
    manager.registerScene('/b', buildB);

    await manager.transitionTo('/a');
    const hop = manager.transitionTo('/b');
    await sleep(10); // B is parked in preload()
    void manager.transitionTo('/b');
    preload.open();
    await hop;

    expect(buildB).toHaveBeenCalledTimes(1);
    expect(activeName(manager)).toBe('B');
  });

  it('activates and retargets a shared-factory scene overtaken mid-preload', async () => {
    const { manager } = createManager();
    const preload = latch();
    const built: Array<FakeScene & { retargets: string[] }> = [];
    const world = () => {
      const w = Object.assign(new FakeScene('W', { preload: () => preload.gate }), {
        retargets: [] as string[],
        retarget(route: string) {
          w.retargets.push(route);
        },
      });
      built.push(w);
      return w;
    };
    manager.registerScene('/park', () => new FakeScene('P'));
    manager.registerScene('/work', world);
    manager.registerScene('/contact', world);

    await manager.transitionTo('/park');
    const hop = manager.transitionTo('/work');
    await sleep(10); // W is parked in preload()
    void manager.transitionTo('/contact');
    preload.open();
    await hop;

    expect(built).toHaveLength(1);
    expect(built[0].disposed).toBe(0);
    expect(built[0].retargets).toEqual(['/contact']);
    expect(manager.activeScene).toBe(built[0]);
  });

  it('keeps the overtaken scene when the newer route has no scene and no fallback', async () => {
    const { manager } = createManager();
    const exit = latch();
    manager.registerScene('/a', () => new FakeScene('A', { exit: () => exit.gate }));
    manager.registerScene('/b', () => new FakeScene('B'));

    await manager.transitionTo('/a');
    const hop = manager.transitionTo('/b');
    await sleep(10); // A is parked in exitTransition()
    void manager.transitionTo('/missing');
    exit.open();
    await hop;

    expect(activeName(manager)).toBe('B');
  });

  it('drains a route queued during a hop that throws', async () => {
    const { manager } = createManager();
    let failPreload!: (err: Error) => void;
    const gate = new Promise<void>((_, reject) => {
      failPreload = reject;
    });
    const bad = new FakeScene('BAD', { preload: () => gate });
    const c = new FakeScene('C');
    manager.registerScene('/bad', () => bad);
    manager.registerScene('/c', () => c);

    const hop = manager.transitionTo('/bad');
    await sleep(10); // BAD is constructed and parked in the failing preload()
    void manager.transitionTo('/c'); // queued behind the doomed hop
    failPreload(new Error('preload failed'));
    await hop;

    expect(errors.at(-1)?.[0]).toBe('[SceneManager] transition failed for /bad:');
    expect(activeName(manager)).toBe('C');
  });

  it('disposes the half-built scene when preload() throws', async () => {
    const { manager } = createManager();
    const bad = new FakeScene('BAD', { preload: () => Promise.reject(new Error('preload failed')) });
    manager.registerScene('/bad', () => bad);

    await manager.transitionTo('/bad');

    expect(bad.disposed).toBe(1);
    expect(manager.activeScene).toBe(null);
  });

  it('does not dispose the outgoing scene twice when its dispose() throws', async () => {
    const { manager } = createManager();
    const a = new FakeScene('A', {
      dispose: () => {
        throw new Error('dispose failed');
      },
    });
    const b = new FakeScene('B');
    manager.registerScene('/a', () => a);
    manager.registerScene('/b', () => b);

    await manager.transitionTo('/a');
    await manager.transitionTo('/b');

    expect(a.disposed).toBe(1);
    expect(errors.at(-1)?.[0]).toBe('[SceneManager] transition failed for /b:');
  });

  it('disposes the outgoing scene once when the manager is destroyed during its exit', async () => {
    const { manager } = createManager();
    const exit = latch();
    const a = new FakeScene('A', { exit: () => exit.gate });
    const buildB = vi.fn(() => new FakeScene('B'));
    manager.registerScene('/a', () => a);
    manager.registerScene('/b', buildB);

    await manager.transitionTo('/a');
    const hop = manager.transitionTo('/b');
    await sleep(10); // A is parked in exitTransition()
    manager.destroy();
    exit.open();
    await hop;

    expect(a.disposed).toBe(1);
    expect(buildB).not.toHaveBeenCalled();
  });

  it('disposes a scene once when the manager is destroyed during its preload() and dispose() throws', async () => {
    const { manager } = createManager();
    const preload = latch();
    const b = new FakeScene('B', {
      preload: () => preload.gate,
      dispose: () => {
        throw new Error('dispose failed');
      },
    });
    manager.registerScene('/b', () => b);

    const hop = manager.transitionTo('/b');
    await sleep(10); // B is parked in preload()
    manager.destroy();
    preload.open();
    await hop;

    expect(b.disposed).toBe(1);
    expect(b.entered).toBe(0);
    expect(errors.at(-1)?.[0]).toBe('[SceneManager] transition failed for /b:');
  });
});
