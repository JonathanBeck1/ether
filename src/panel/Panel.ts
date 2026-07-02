import * as THREE from 'three';

/**
 * aether/panel — small dedicated WebGL viewports ("control screens")
 * embedded in DOM-driven pages, independent of the persistent-canvas
 * SceneManager. Each panel owns a tiny renderer + rAF loop and renders
 * ONLY while its canvas intersects the viewport.
 *
 * Design constraints (from the /web rocket-line spec + perf budget):
 *   - Hard concurrency cap: at most MAX_ACTIVE panels render at once.
 *     A panel that becomes visible while the cap is full waits, and is
 *     promoted the moment a running panel scrolls away — scroll order
 *     stays correct without a scheduler.
 *   - DPR capped (default 1.5). Context MSAA is ON by default: unlike
 *     the hero composer pipeline, panels render straight to the canvas
 *     framebuffer, so context antialiasing actually reaches the screen.
 *   - No postprocessing composer. Panel materials carry their own
 *     identity (custom shader + inline dither) — a bloom chain in a
 *     300px viewport is cost without wattage.
 *   - Boot ramp: first activation steps the pixel ratio through chunky
 *     fractions with `image-rendering: pixelated`, resolving to crisp —
 *     the pixel-world "screen powering on" read, done with REAL renders
 *     (no snapshot blits). Reduced motion skips straight to crisp.
 */

export interface PanelScene {
  scene: THREE.Scene;
  camera: THREE.Camera;
  /** Per-frame update while the panel is running. */
  tick(time: number, deltaTime: number): void;
  /** Release scene resources (geometry/material/textures). */
  dispose(): void;
}

export type PanelSceneFactory = (
  renderer: THREE.WebGLRenderer,
  size: { width: number; height: number },
) => PanelScene;

export interface PanelOptions {
  /** Pixel-ratio cap. Panels are accents, not heroes. Default 1.5. */
  dprCap?: number;
  /**
   * Render-resolution multiplier (default 1). Below 1 the buffer renders
   * small and the canvas upscales it — with `image-rendering: pixelated`
   * kept on, the feed reads as chunky pixels (a diegetic low-res monitor)
   * instead of a smooth render floating in a pixel world.
   */
  resolutionScale?: number;
  /** Skip the boot ramp and never animate DPR (default false). */
  reducedMotion?: boolean;
  /** Boot ramp DPR fractions of the target, coarsest first. */
  bootSteps?: number[];
  /** ms between boot steps. Default 140. */
  bootStepMs?: number;
  /** Canvas clear color. Default near-black to match the dark screens. */
  clearColor?: number;
}

export interface PanelHandle {
  /** True while this panel holds one of the MAX_ACTIVE render slots. */
  readonly running: boolean;
  /** Stop observing + rendering and release all GPU resources. */
  dispose(): void;
}

const MAX_ACTIVE = 2;
const DEFAULT_BOOT_STEPS = [0.06, 0.12, 0.25, 0.5, 1];

/** Panels currently holding a render slot. */
const active = new Set<PanelImpl>();
/** Panels that are intersecting but waiting for a slot, FIFO. */
const waiting: PanelImpl[] = [];

function promoteWaiting(): void {
  while (active.size < MAX_ACTIVE && waiting.length > 0) {
    const next = waiting.shift()!;
    if (next.disposed || !next.intersecting) continue;
    next.start();
  }
}

class PanelImpl implements PanelHandle {
  readonly canvas: HTMLCanvasElement;
  intersecting = false;
  disposed = false;
  private renderer: THREE.WebGLRenderer | null = null;
  private sceneHooks: PanelScene | null = null;
  private readonly factory: PanelSceneFactory;
  private readonly opts: Required<PanelOptions>;
  private rafHandle = 0;
  private lastTime = 0;
  private booted = false;
  private io: IntersectionObserver | null = null;
  private ro: ResizeObserver | null = null;
  private readonly onLost = (e: Event): void => {
    e.preventDefault();
    this.stop(); // context gone — release the slot; IO re-entry restarts us
  };

  constructor(canvas: HTMLCanvasElement, factory: PanelSceneFactory, opts: PanelOptions) {
    this.canvas = canvas;
    this.factory = factory;
    this.opts = {
      dprCap: opts.dprCap ?? 1.5,
      resolutionScale: opts.resolutionScale ?? 1,
      reducedMotion: opts.reducedMotion ?? false,
      bootSteps: opts.bootSteps ?? DEFAULT_BOOT_STEPS,
      bootStepMs: opts.bootStepMs ?? 140,
      clearColor: opts.clearColor ?? 0x05060a,
    };

    canvas.addEventListener('webglcontextlost', this.onLost, false);

    this.io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          this.intersecting = e.isIntersecting;
          if (e.isIntersecting) this.requestStart();
          else this.stop();
        }
      },
      { rootMargin: '12% 0px' },
    );
    this.io.observe(canvas);
  }

  get running(): boolean {
    return active.has(this);
  }

  private requestStart(): void {
    if (this.disposed || this.running) return;
    if (active.size >= MAX_ACTIVE) {
      if (!waiting.includes(this)) waiting.push(this);
      return;
    }
    this.start();
  }

  start(): void {
    if (this.disposed || this.running) return;
    active.add(this);

    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true, // no composer: context MSAA reaches the screen here
        alpha: false,
        powerPreference: 'low-power', // accents, not heroes — thermals win
      });
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.NoToneMapping;
      this.renderer.setClearColor(this.opts.clearColor);
      this.applySize(1);
      this.sceneHooks = this.factory(this.renderer, {
        width: this.canvas.clientWidth,
        height: this.canvas.clientHeight,
      });
      this.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.applySize()) : null;
      this.ro?.observe(this.canvas);
    }

    if (!this.booted) {
      this.booted = true;
      if (!this.opts.reducedMotion) this.runBootRamp();
    }

    this.lastTime = performance.now();
    this.rafHandle = requestAnimationFrame(this.tick);
  }

  private stop(): void {
    const idx = waiting.indexOf(this);
    if (idx !== -1) waiting.splice(idx, 1);
    if (!active.delete(this)) return;
    cancelAnimationFrame(this.rafHandle);
    this.rafHandle = 0;
    promoteWaiting();
  }

  /** Boot ramp: step DPR from chunky to crisp with pixelated upscaling —
   *  real renders at tiny buffer sizes, resolved by the final step. */
  private runBootRamp(): void {
    const steps = this.opts.bootSteps;
    this.canvas.style.imageRendering = 'pixelated';
    steps.forEach((fraction, i) => {
      window.setTimeout(() => {
        if (this.disposed || !this.renderer) return;
        this.applySize(fraction);
        // A sub-1 resolutionScale keeps pixelated upscaling permanently —
        // the chunky feed IS the look; only full-res panels resolve smooth.
        if (i === steps.length - 1 && this.opts.resolutionScale >= 1) {
          this.canvas.style.imageRendering = '';
        }
      }, i * this.opts.bootStepMs);
    });
  }

  private applySize(dprFraction = 1): void {
    if (!this.renderer) return;
    const dpr =
      Math.min(window.devicePixelRatio, this.opts.dprCap) *
      this.opts.resolutionScale *
      dprFraction;
    this.renderer.setPixelRatio(Math.max(dpr, 0.02));
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight, false);
  }

  private readonly tick = (now: number): void => {
    if (this.disposed || !this.running) return;
    const dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (this.sceneHooks && this.renderer) {
      this.sceneHooks.tick(now / 1000, dt);
      this.renderer.render(this.sceneHooks.scene, this.sceneHooks.camera);
    }
    this.rafHandle = requestAnimationFrame(this.tick);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.io?.disconnect();
    this.io = null;
    this.ro?.disconnect();
    this.ro = null;
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.sceneHooks?.dispose();
    this.sceneHooks = null;
    this.renderer?.dispose();
    this.renderer = null;
    promoteWaiting();
  }
}

/**
 * Mount a live panel on `canvas`. The factory runs lazily on first
 * visibility — an offscreen panel costs nothing but the observer.
 */
export function createPanel(
  canvas: HTMLCanvasElement,
  factory: PanelSceneFactory,
  options: PanelOptions = {},
): PanelHandle {
  return new PanelImpl(canvas, factory, options);
}
