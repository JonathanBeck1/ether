import * as THREE from 'three';
import type { Scene } from './BaseScene';

type SceneFactory = (renderer: THREE.WebGLRenderer) => Scene;

/**
 * Owns the renderer, the render loop, and per-route Scene instances.
 *
 * IMPORTANT: destroy() must FULLY tear this down — cancel rAF, remove
 * listeners, dispose the active scene, dispose the renderer, and force the
 * WebGL context to release. If anything is left dangling, a re-init (e.g.
 * Astro client-side navigation that re-runs the inline script) will end up
 * with TWO render loops drawing into the same persistent canvas, which
 * presents as ghost-doubled letters and frame-to-frame jitter.
 */
export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  private scenes = new Map<string, SceneFactory>();
  private activeScene: Scene | null = null;
  private lastTime = 0;
  private running = false;
  private rafHandle = 0;
  private readonly tickBound: (now: number) => void;
  private readonly handleResizeBound: () => void;

  constructor(canvas: HTMLCanvasElement) {
    // preserveDrawingBuffer is OFF for production (default false) — has a
    // small per-frame perf cost. Flip to true temporarily if you need to
    // grab the canvas via canvas.toDataURL / drawImage for screenshot QA;
    // remember to flip it back before shipping.
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    // postprocessing v6's EffectComposer reads outputColorSpace from the renderer
    // and applies sRGB encoding in its OutputPass. Tone mapping is NOT auto-applied
    // — we use an LDR composer (no HalfFloatType) so values clip at 1.0 naturally,
    // which keeps bloom contained without a separate ToneMappingEffect pass.
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.tickBound = this.tick.bind(this);
    this.handleResizeBound = this.handleResize.bind(this);
    window.addEventListener('resize', this.handleResizeBound);
  }

  registerScene(routeName: string, factory: SceneFactory): void {
    this.scenes.set(routeName, factory);
  }

  async transitionTo(routeName: string): Promise<void> {
    const factory = this.scenes.get(routeName);
    if (!factory) {
      console.warn(`[SceneManager] No scene registered for: ${routeName}`);
      return;
    }
    const next = factory(this.renderer);
    if (next.preload) await next.preload();

    if (this.activeScene) {
      await this.activeScene.exitTransition();
      this.activeScene.dispose();
    }
    this.activeScene = next;
    await this.activeScene.enterTransition();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.rafHandle = requestAnimationFrame(this.tickBound);
  }

  private tick(now: number): void {
    if (!this.running) return;
    const deltaTime = (now - this.lastTime) / 1000;
    this.lastTime = now;

    if (this.activeScene) {
      this.activeScene.tick(now / 1000, deltaTime);
      if (this.activeScene.composer) {
        this.activeScene.composer.render(deltaTime);
      } else {
        this.renderer.render(this.activeScene.scene, this.activeScene.camera);
      }
    }
    this.rafHandle = requestAnimationFrame(this.tickBound);
  }

  private handleResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    if (this.activeScene) {
      this.activeScene.camera.aspect = w / h;
      this.activeScene.camera.updateProjectionMatrix();
      this.activeScene.composer?.setSize(w, h);
      this.activeScene.onResize?.(w, h);
    }
  }

  /**
   * Fully tears down. Call before letting this instance go out of scope —
   * a half-disposed manager keeps a rAF loop and resize listener alive,
   * which means a re-init on the same canvas would have TWO render loops
   * writing into one framebuffer (ghost letters + frame-to-frame jitter).
   *
   * NOTE: we deliberately do NOT call renderer.forceContextLoss(). On
   * Astro client-side navigations the canvas (and its WebGL context)
   * persist via transition:persist; the next WebGLRenderer constructor
   * needs a live context to attach to. dispose() is enough — it releases
   * three.js's internal GPU resources without killing the GL context.
   */
  destroy(): void {
    this.running = false;
    if (this.rafHandle) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = 0;
    }
    window.removeEventListener('resize', this.handleResizeBound);
    this.activeScene?.dispose();
    this.activeScene = null;
    this.renderer.dispose();
  }
}
