import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as THREE from 'three';
import { SceneManager } from '../src/core/SceneManager';
import type { RuntimeDiagnostics, Scene } from '../src/core/types';
import type { QualityProfile } from '../src/quality/quality';

// render() mirrors three r184: frame++ always, then the autoReset reset,
// then the draw lands in calls/triangles.
vi.mock('three', () => ({
  SRGBColorSpace: 'srgb',
  NoToneMapping: 0,
  WebGLRenderer: class {
    readonly domElement: unknown;
    outputColorSpace = '';
    toneMapping = 0;
    info = {
      autoReset: true,
      render: { frame: 0, calls: 0, triangles: 0 },
      memory: { geometries: 0, textures: 0 },
      programs: [] as unknown[],
      reset() {
        this.render.calls = 0;
        this.render.triangles = 0;
      },
    };
    constructor(parameters: { canvas: unknown }) {
      this.domElement = parameters.canvas;
    }
    setPixelRatio(): void {}
    getPixelRatio(): number {
      return 1;
    }
    setSize(): void {}
    render(): void {
      this.info.render.frame++;
      if (this.info.autoReset) this.info.reset();
      this.info.render.calls++;
      this.info.render.triangles += 2;
    }
    dispose(): void {}
  },
}));

let nextFrame: ((now: number) => void) | null = null;

vi.stubGlobal(
  'ResizeObserver',
  class {
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
vi.stubGlobal('document', { body: { setAttribute() {}, removeAttribute() {} } });
vi.stubGlobal('requestAnimationFrame', (callback: (now: number) => void) => {
  nextFrame = callback;
  return 1;
});
vi.stubGlobal('cancelAnimationFrame', () => {
  nextFrame = null;
});

const QUALITY: QualityProfile = {
  tier: 'MID',
  rawScore: 0,
  dprCap: 1.5,
  antialias: false,
  enablePostFX: true,
  enableDither: true,
  msaaSamples: 0,
  enableSmoothScroll: false,
  reducedMotion: false,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function gate() {
  let open!: () => void;
  let fail!: (err: Error) => void;
  const promise = new Promise<void>((resolve, reject) => {
    open = resolve;
    fail = reject;
  });
  return { promise, open, fail };
}

interface Options {
  preload?: () => Promise<void>;
  exit?: () => Promise<void>;
  enter?: () => Promise<void>;
  renders?: boolean;
  composer?: Scene['composer'];
  retargetable?: boolean;
  tick?: () => void;
}

class FakeScene implements Scene {
  readonly scene = {} as THREE.Scene;
  readonly camera = {
    aspect: 0,
    updateProjectionMatrix() {},
  } as unknown as THREE.PerspectiveCamera;
  renders?: boolean;
  composer?: Scene['composer'];
  retarget?: (route: string) => void;

  constructor(private readonly options: Options = {}) {
    this.renders = options.renders;
    this.composer = options.composer;
    if (options.retargetable) this.retarget = () => {};
  }

  async preload(): Promise<void> {
    await this.options.preload?.();
  }
  async enterTransition(): Promise<void> {
    await this.options.enter?.();
  }
  async exitTransition(): Promise<void> {
    await this.options.exit?.();
  }
  tick(): void {
    this.options.tick?.();
  }
  dispose(): void {}
}

const PASSES = [
  { name: 'RenderPass', enabled: true },
  { name: 'EffectPass', enabled: true },
];

// Structural stand-in for an EffectComposer: one renderer.render() per pass.
function composer(
  renderer: THREE.WebGLRenderer,
  { renders = 3, passes = PASSES, multisampling = 0 } = {},
): Scene['composer'] {
  return {
    passes,
    multisampling,
    setSize() {},
    render() {
      for (let i = 0; i < renders; i++) renderer.render({} as THREE.Scene, {} as THREE.Camera);
    },
  } as unknown as Scene['composer'];
}

function createManager() {
  const listeners = new Map<string, (e: unknown) => void>();
  const canvas = {
    width: 1000,
    height: 500,
    clientWidth: 1000,
    clientHeight: 500,
    addEventListener: (type: string, fn: (e: unknown) => void) => void listeners.set(type, fn),
    removeEventListener: () => {},
  };
  const manager = new SceneManager(canvas as unknown as HTMLCanvasElement, QUALITY);
  const fire = (type: string) => listeners.get(type)?.({ preventDefault() {} });
  return { canvas, manager, fire };
}

function frame(now: number): void {
  const callback = nextFrame!;
  nextFrame = null;
  callback(now);
}

// Every leaf null | boolean | string | finite number, in plain objects and
// arrays only, and a JSON round trip that changes nothing.
function jsonSafe(value: unknown): boolean {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(jsonSafe);
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.values(value as object).every(jsonSafe);
  }
  return false;
}

function diag(manager: SceneManager): RuntimeDiagnostics {
  const d = manager.getDiagnostics();
  expect(jsonSafe(d)).toBe(true);
  expect(JSON.parse(JSON.stringify(d))).toStrictEqual(d);
  return d;
}

describe('SceneManager.getDiagnostics', () => {
  beforeEach(() => {
    nextFrame = null;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports an empty, idle manager before anything runs', () => {
    const { manager } = createManager();
    const d = diag(manager);
    expect(d.scene).toEqual({
      phase: 'empty',
      route: null,
      fallback: false,
      target: null,
      id: null,
      entered: false,
      failures: 0,
      lastError: null,
    });
    expect(d.performance).toEqual({ frames: 0, fps: null, cpuMs: null });
    expect(d.rendering.skipped).toBe('no-scene');
    expect(d.rendering.renderCalls).toBe(0);
    expect(d.rendering.drawCalls).toBe(0);
    expect(d.postFX).toEqual({ enabled: false, msaa: null, passes: [] });
  });

  it('tracks a cold hop through loading, activation and the settled enter', async () => {
    const { manager } = createManager();
    const preload = gate();
    const enter = gate();
    manager.registerScene('/a', () => new FakeScene({ preload: () => preload.promise, enter: () => enter.promise }));

    const hop = manager.transitionTo('/a');
    await sleep(0);
    let d = diag(manager);
    expect(d.scene).toMatchObject({ phase: 'loading', target: '/a', route: null, id: null });

    preload.open();
    await hop;
    d = diag(manager);
    expect(d.scene).toMatchObject({ phase: 'active', route: '/a', fallback: false, id: 1, target: null, entered: false });

    enter.open();
    await sleep(0);
    expect(diag(manager).scene.entered).toBe(true);
  });

  it('reports exiting and loading with the departed route during a hop', async () => {
    const { manager } = createManager();
    const exit = gate();
    const preload = gate();
    manager.registerScene('/a', () => new FakeScene({ exit: () => exit.promise }));
    manager.registerScene('/b', () => new FakeScene({ preload: () => preload.promise }));
    await manager.transitionTo('/a');

    const hop = manager.transitionTo('/b');
    await sleep(0);
    expect(diag(manager).scene).toMatchObject({ phase: 'exiting', route: '/a', id: 1, target: '/b' });

    exit.open();
    await sleep(0);
    expect(diag(manager).scene).toMatchObject({ phase: 'loading', route: '/a', id: null, target: '/b' });

    preload.open();
    await hop;
    expect(diag(manager).scene).toMatchObject({ phase: 'active', route: '/b', id: 2 });
  });

  it('never reports a route dropped by latest-wins', async () => {
    const { manager } = createManager();
    const exitA = gate();
    const preloadB = gate();
    const preloadD = gate();
    let builtC = 0;
    manager.registerScene('/a', () => new FakeScene({ exit: () => exitA.promise }));
    manager.registerScene('/b', () => new FakeScene({ preload: () => preloadB.promise }));
    manager.registerScene('/c', () => {
      builtC++;
      return new FakeScene();
    });
    manager.registerScene('/d', () => new FakeScene({ preload: () => preloadD.promise }));
    await manager.transitionTo('/a');

    const snapshots: RuntimeDiagnostics[] = [];
    const hop = manager.transitionTo('/b');
    await sleep(0);
    void manager.transitionTo('/c');
    void manager.transitionTo('/d');
    snapshots.push(diag(manager));
    expect(snapshots[0].scene.target).toBe('/b');

    exitA.open();
    await sleep(0);
    snapshots.push(diag(manager));
    preloadB.open();
    await sleep(0);
    snapshots.push(diag(manager));
    preloadD.open();
    await hop;
    snapshots.push(diag(manager));

    for (const d of snapshots) {
      expect(d.scene.route).not.toBe('/c');
      expect(d.scene.target).not.toBe('/c');
    }
    expect(builtC).toBe(0);
    expect(snapshots.at(-1)!.scene).toMatchObject({ phase: 'active', route: '/d', target: null });
  });

  it('keeps id and entered across retarget()', async () => {
    const { manager } = createManager();
    const factory = () => new FakeScene({ retargetable: true });
    manager.registerScene('/c1', factory);
    manager.registerScene('/c2', factory);
    await manager.transitionTo('/c1');
    await sleep(0);
    const before = diag(manager).scene;
    expect(before.entered).toBe(true);

    await manager.transitionTo('/c2');
    const after = diag(manager).scene;
    expect(after).toMatchObject({ phase: 'active', route: '/c2', id: before.id, entered: true });
  });

  it("flags a '*' match as fallback and keeps the real path", async () => {
    const { manager } = createManager();
    manager.registerScene('*', () => new FakeScene());
    await manager.transitionTo('/nope');
    expect(diag(manager).scene).toMatchObject({ route: '/nope', fallback: true });

    manager.registerScene('/x', () => new FakeScene());
    await manager.transitionTo('/x');
    expect(diag(manager).scene).toMatchObject({ route: '/x', fallback: false });
  });

  it('counts hop and enter failures, not an unrouted warning', async () => {
    const { manager } = createManager();
    manager.registerScene('/boom', () => {
      throw new Error('factory failed');
    });
    manager.registerScene('/a', () => new FakeScene({ enter: () => Promise.reject(new Error('enter failed')) }));

    await manager.transitionTo('/boom');
    let d = diag(manager);
    expect(d.scene).toMatchObject({ failures: 1, phase: 'empty', route: null, id: null });
    expect(d.scene.lastError).toBe('/boom: factory failed');

    await manager.transitionTo('/a');
    await sleep(0);
    d = diag(manager);
    expect(d.scene).toMatchObject({ failures: 2, phase: 'active', entered: true, lastError: '/a: enter failed' });

    await manager.transitionTo('/unrouted');
    expect(diag(manager).scene).toMatchObject({ failures: 2, route: '/a', id: d.scene.id, phase: 'active' });
  });

  it("does not let an interrupted intro flag the next scene as entered", async () => {
    const { manager } = createManager();
    const enterA = gate();
    const enterB = gate();
    manager.registerScene('/a', () => new FakeScene({ enter: () => enterA.promise }));
    manager.registerScene('/b', () => new FakeScene({ enter: () => enterB.promise }));
    await manager.transitionTo('/a');
    await manager.transitionTo('/b');

    enterA.open();
    await sleep(0);
    expect(diag(manager).scene).toMatchObject({ route: '/b', entered: false });

    enterB.open();
    await sleep(0);
    expect(diag(manager).scene.entered).toBe(true);
  });

  it('reads destroyed through a held reference without throwing', async () => {
    const { manager } = createManager();
    manager.registerScene('/a', () => new FakeScene());
    await manager.transitionTo('/a');
    manager.destroy();
    expect(diag(manager).scene).toMatchObject({ phase: 'destroyed', id: null, entered: false });
  });

  it("reports the live composer's enabled passes and requested msaa", async () => {
    const { manager } = createManager();
    const passes = [...PASSES, { name: 'X', enabled: false }];
    manager.registerScene('/a', (r) => new FakeScene({ composer: composer(r, { passes, multisampling: 2 }) }));
    await manager.transitionTo('/a');
    expect(diag(manager).postFX).toEqual({ enabled: true, msaa: 2, passes: ['RenderPass', 'EffectPass'] });
  });

  it('copies the quality profile', () => {
    const { manager } = createManager();
    const { quality } = diag(manager);
    expect(quality).toEqual(manager.quality);
    expect(quality).not.toBe(manager.quality);
  });

  it('counts whole-frame renders and draws per tick, not cumulatively', async () => {
    const { manager } = createManager();
    manager.registerScene('/a', (r) => new FakeScene({ composer: composer(r) }));
    await manager.transitionTo('/a');
    manager.start();

    frame(16);
    let d = diag(manager);
    expect(d.rendering).toMatchObject({ renderCalls: 3, drawCalls: 3, triangles: 6, skipped: null });
    expect(manager.renderer.info.autoReset).toBe(true);
    expect(manager.renderer.info.render.calls).toBe(3);

    frame(32);
    d = diag(manager);
    expect(d.rendering).toMatchObject({ renderCalls: 3, drawCalls: 3, triangles: 6 });
  });

  it("leaves a caller's own autoReset = false accumulating", async () => {
    const { manager } = createManager();
    manager.registerScene('/a', (r) => new FakeScene({ composer: composer(r) }));
    await manager.transitionTo('/a');
    const info = manager.renderer.info;
    info.autoReset = false;
    info.render.calls = 100;
    manager.start();

    frame(16);
    expect(diag(manager).rendering.drawCalls).toBe(3);
    expect(info.render.calls).toBe(103);
    expect(info.autoReset).toBe(false);
  });

  it('names why a tick issued no render', async () => {
    const idle = createManager();
    idle.manager.start();
    frame(16);
    expect(diag(idle.manager).rendering.skipped).toBe('no-scene');
    idle.manager.destroy();

    const { canvas, manager, fire } = createManager();
    const scene = new FakeScene({ renders: false });
    manager.registerScene('/a', () => scene);
    await manager.transitionTo('/a');
    manager.start();

    frame(16);
    let d = diag(manager);
    expect(d.rendering).toMatchObject({ skipped: 'renders-false', drawCalls: 0 });
    expect(d.performance.frames).toBe(1);

    scene.renders = true;
    canvas.width = 0;
    frame(32);
    expect(diag(manager).rendering).toMatchObject({ skipped: 'zero-size', renderCalls: 0, drawCalls: 0 });

    canvas.width = 1000;
    fire('webglcontextlost');
    frame(48);
    d = diag(manager);
    expect(d.rendering).toMatchObject({
      skipped: 'context-lost',
      contextLost: true,
      renderCalls: 0,
      drawCalls: 0,
    });
    expect(d.performance.frames).toBe(3);
  });

  it('samples fps and cpu time over closed windows, and drops gaps', async () => {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const { manager } = createManager();
    manager.registerScene(
      '/a',
      (r) => new FakeScene({ composer: composer(r), tick: () => void (clock += 2) }),
    );
    await manager.transitionTo('/a');
    manager.start();
    const tickAt = (t: number) => {
      clock = t;
      frame(t);
    };

    for (let i = 1; i <= 40; i++) tickAt(i * 16.667);
    let d = diag(manager);
    expect(d.performance.frames).toBe(40);
    expect(d.performance.fps).toBeGreaterThanOrEqual(59);
    expect(d.performance.fps).toBeLessThanOrEqual(61);
    expect(d.performance.cpuMs).toBeCloseTo(2);

    const resumed = clock + 5000;
    tickAt(resumed);
    d = diag(manager);
    expect(d.performance).toEqual({ frames: 41, fps: null, cpuMs: null });

    for (let i = 1; i <= 30; i++) tickAt(resumed + i * 16.667);
    d = diag(manager);
    expect(d.performance.fps).toBeCloseTo(60, 0);
    expect(d.performance.cpuMs).toBeCloseTo(2);
  });
});
