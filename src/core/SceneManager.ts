import * as THREE from 'three';
import type { Scene } from './types';
import type { QualityProfile } from '../quality/quality';

type SceneFactory = (renderer: THREE.WebGLRenderer, route?: string) => Scene;

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
  readonly quality: QualityProfile;
  private scenes = new Map<string, SceneFactory>();
  private _activeScene: Scene | null = null;
  private currentRoute: string | null = null;
  private pendingRoute: string | null = null;
  private transitioning = false;
  private forceNext = false;
  private lastTime = 0;
  private running = false;
  private rafHandle = 0;
  private resizeObserver: ResizeObserver | null = null;
  private resizeDebounceTimer = 0;
  private lastResizeW = 0;
  private lastResizeH = 0;
  private contextLost = false;
  /** Set by destroy(); cancels any in-flight transition so a disposed
   *  manager can't construct a zombie scene on a dead render loop. */
  private destroyed = false;
  private readonly tickBound: (now: number) => void;
  private readonly handleResizeBound: () => void;
  private readonly handleContextLostBound: (e: Event) => void;
  private readonly handleContextRestoredBound: () => void;

  constructor(canvas: HTMLCanvasElement, quality: QualityProfile) {
    this.quality = quality;
    // preserveDrawingBuffer is OFF for production (default false) — has a
    // small per-frame perf cost. Flip to true temporarily if you need to
    // grab the canvas via canvas.toDataURL / drawImage for screenshot QA;
    // remember to flip it back before shipping.
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      // Context MSAA is dead weight whenever a composer runs (every tier
      // now) — post-processing renders into textures that bypass the
      // canvas framebuffer. Real edge AA comes from the composer's
      // msaaSamples; quality.antialias is false across the board.
      antialias: quality.antialias,
      alpha: false,
      // 'low-power' on LOW: trades raw perf for thermal headroom on
      // long-running mobile sessions where the device throttles us anyway.
      powerPreference: quality.tier === 'LOW' ? 'low-power' : 'high-performance',
    });
    // postprocessing v6's EffectComposer reads outputColorSpace from the renderer
    // and applies sRGB encoding in its OutputPass. Tone mapping is NOT auto-applied
    // — we use an LDR composer (no HalfFloatType) so values clip at 1.0 naturally,
    // which keeps bloom contained without a separate ToneMappingEffect pass.
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.dprCap));
    // Size the drawing buffer to the canvas's CSS box, and NEVER write
    // inline styles (`updateStyle: false`): the stylesheet owns the box
    // (100lvh fixed overlay). The default updateStyle pinned an inline
    // pixel height over the CSS, so the iOS URL bar collapsing grew the
    // viewport while the canvas stayed boot-sized — a permanent black
    // band at the bottom — and the ResizeObserver below watched a box
    // that could no longer change.
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    this.lastResizeW = canvas.clientWidth;
    this.lastResizeH = canvas.clientHeight;

    this.tickBound = this.tick.bind(this);
    this.handleResizeBound = this.handleResize.bind(this);
    this.handleContextLostBound = this.handleContextLost.bind(this);
    this.handleContextRestoredBound = this.handleContextRestored.bind(this);

    // ResizeObserver on the canvas wrapper — fires on actual element-size
    // changes, NOT on every window.resize event the way the old listener
    // did. On iOS Safari, scroll-direction changes collapse/expand the URL
    // bar which would previously trigger a full renderer.setSize + composer
    // resize on every direction reversal. With RO we still get those height
    // changes, but the debounce coalesces the bouncy intermediate values
    // into one final resize when the URL bar settles.
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.handleResizeBound);
      this.resizeObserver.observe(canvas);
    } else {
      // Pre-ES2020 fallback (Safari 13.0 and earlier). Don't bother
      // debouncing — these browsers are too rare and old to optimize for.
      window.addEventListener('resize', this.handleResizeBound);
    }

    // iOS Safari WILL drop the WebGL context under memory pressure (multiple
    // tabs, OS pressure, switching apps with the tab open). Without a
    // handler, the canvas turns into a permanent white rectangle until
    // page reload. We catch it, stop the rAF, mark the body so CSS can
    // show a fallback poster, and try to recover when/if the context
    // comes back.
    canvas.addEventListener('webglcontextlost', this.handleContextLostBound, false);
    canvas.addEventListener('webglcontextrestored', this.handleContextRestoredBound, false);
  }

  registerScene(routeName: string, factory: SceneFactory): void {
    this.scenes.set(routeName, factory);
  }

  /** The scene currently rendering, or null mid-transition / before first activation. */
  get activeScene(): Scene | null {
    return this._activeScene;
  }

  /**
   * Latest-wins transition queue. Calling this while a transition is in
   * flight retargets it — the loop picks up the newest route once the
   * current hop settles, so rapid A→B→A converges on the last URL Astro
   * settled on. Same-route calls are no-ops UNLESS `force` is set:
   * Astro runs a full body swap even for same-path link clicks, which
   * detaches every DOM node the live scene's ScrollTriggers hold — the
   * router forces a real exit→enter so the fresh scene re-couples to
   * the fresh DOM.
   *
   * Hop order: exit old → dispose old → construct + preload next →
   * activate → enter. The exit runs FIRST so scene resource lifetimes
   * (Lenis bridge, ScrollTriggers, pointer listeners — created in scene
   * constructors) are strictly disjoint. Enter is NOT awaited by the
   * queue: a navigation during a long intro interrupts it via dispose
   * (scenes kill their intro timelines there).
   */
  async transitionTo(
    routeName: string,
    options: { force?: boolean } = {},
  ): Promise<void> {
    if (this.destroyed) return;
    this.pendingRoute = routeName;
    if (options.force) this.forceNext = true;
    if (this.transitioning) return;
    this.transitioning = true;
    try {
      while (
        !this.destroyed &&
        this.pendingRoute !== null &&
        (this.forceNext || this.pendingRoute !== this.currentRoute)
      ) {
        const target = this.pendingRoute;
        this.pendingRoute = null;
        this.forceNext = false;
        await this.runTransition(target);
      }
    } finally {
      this.transitioning = false;
    }
  }

  private async runTransition(routeName: string): Promise<void> {
    // Exact route, else the '*' fallback (registered for 404 / unmatched
    // routes so they get a backdrop instead of a black canvas).
    const factory = this.scenes.get(routeName) ?? this.scenes.get('*');
    if (!factory) {
      // No exact route and no fallback registered: keep whatever is
      // rendering (mid-session nav) or stay dark (cold load on one).
      console.warn(`[SceneManager] No scene registered for: ${routeName}`);
      return;
    }
    // Same-world navigation: when the destination resolves to the SAME
    // factory that built the active scene and the scene opts in via
    // retarget(), keep it alive — the scene plays its own continuous
    // transition across the DOM swap instead of exit/dispose/rebuild.
    // Only when the route actually CHANGES: a same-path nav (logo click on
    // home) full-swaps the DOM without changing routes, and its scene must
    // rebuild to re-couple — a kept scene would hold triggers on detached
    // nodes. Cross-route retarget owns its own re-coupling by contract.
    const currentFactory =
      this.currentRoute !== null
        ? this.scenes.get(this.currentRoute) ?? this.scenes.get('*')
        : null;
    if (
      this._activeScene &&
      routeName !== this.currentRoute &&
      factory === currentFactory &&
      this._activeScene.retarget
    ) {
      this.currentRoute = routeName;
      this._activeScene.retarget(routeName);
      return;
    }
    if (this._activeScene) {
      await this._activeScene.exitTransition();
      this._activeScene.dispose();
      this._activeScene = null;
    }
    if (this.destroyed) return; // manager torn down mid-exit — don't build a zombie
    const next = factory(this.renderer, routeName);
    // Sync the fresh scene to the canvas's CSS box before it renders.
    // BaseScene seeds camera.aspect from window.inner*, which diverges
    // from the canvas box whenever mobile browser chrome is in play —
    // without this, a scene constructed mid-session (URL bar collapsed)
    // renders at the wrong aspect until the next resize event.
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w > 0 && h > 0) {
      next.camera.aspect = w / h;
      next.camera.updateProjectionMatrix();
      next.composer?.setSize(w, h);
      // Same trio the resize handler fires — the scene's own responsive
      // tuning (portrait bumps, hero re-fit) must also seed from the
      // canvas box, not the window it read in its constructor.
      next.onResize?.(w, h);
    }
    if (next.preload) await next.preload();
    if (this.destroyed) { next.dispose(); return; }
    this._activeScene = next;
    this.currentRoute = routeName;
    next.enterTransition().catch((err) => {
      console.error(
        `[SceneManager] enterTransition failed for ${routeName}:`,
        err,
      );
    });
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

    if (this._activeScene) {
      // Scene tick runs even while the context is lost: it's CPU-side math
      // (drift lerps, uniform values) AND it pumps the scene's ScrollBridge
      // raf. Skipping it froze Lenis-owned scrolling entirely on context
      // loss — a lost context became an unscrollable page, not just a blank
      // canvas. Only the GPU render calls are skipped (they'd no-op and
      // spam console errors on a dead context).
      this._activeScene.tick(now / 1000, deltaTime);
      // domElement.width guard: a route swap can CSS-hide the canvas
      // (e.g. /web parks it) while the OUTGOING scene's exit fade is
      // still rendering — drawing into the zero-size framebuffer spams
      // GL_INVALID_FRAMEBUFFER_OPERATION every frame of the fade.
      if (
        !this.contextLost &&
        this._activeScene.renders !== false &&
        this.renderer.domElement.width > 0
      ) {
        if (this._activeScene.composer) {
          this._activeScene.composer.render(deltaTime);
        } else {
          this.renderer.render(this._activeScene.scene, this._activeScene.camera);
        }
      }
    }
    this.rafHandle = requestAnimationFrame(this.tickBound);
  }

  /**
   * Debounced resize. iOS URL bar collapse spams height changes for ~300ms;
   * a 150ms debounce catches the settled value without grinding the renderer
   * resizing 8 times per direction change. We also short-circuit when the
   * size hasn't actually changed (RO can re-fire with identical dims after
   * style mutations).
   */
  private handleResize(): void {
    if (this.resizeDebounceTimer) {
      clearTimeout(this.resizeDebounceTimer);
    }
    this.resizeDebounceTimer = window.setTimeout(() => {
      // The canvas's CSS box is the source of truth (the observer
      // watches it; the stylesheet drives it) — window.inner* diverges
      // from it whenever mobile browser chrome is in play.
      const canvas = this.renderer.domElement;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === this.lastResizeW && h === this.lastResizeH) return;
      this.lastResizeW = w;
      this.lastResizeH = h;
      this.renderer.setSize(w, h, false);
      if (this._activeScene) {
        this._activeScene.camera.aspect = w / h;
        this._activeScene.camera.updateProjectionMatrix();
        this._activeScene.composer?.setSize(w, h);
        this._activeScene.onResize?.(w, h);
      }
    }, 150);
  }

  private handleContextLost(e: Event): void {
    // Required to make `webglcontextrestored` fire — without preventDefault
    // the browser treats the context as permanently dead.
    e.preventDefault();
    this.contextLost = true;
    document.body.setAttribute('data-webgl-lost', '');
    console.warn('[SceneManager] WebGL context lost — pausing render loop.');
  }

  private handleContextRestored(): void {
    this.contextLost = false;
    document.body.removeAttribute('data-webgl-lost');
    console.warn('[SceneManager] WebGL context restored — resuming.');
    // three.js auto-rebuilds GPU resources on next render once the context
    // is back. We don't need to do anything else here.
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
    this.destroyed = true; // cancels any in-flight transitionTo drain
    this.running = false;
    if (this.rafHandle) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = 0;
    }
    if (this.resizeDebounceTimer) {
      clearTimeout(this.resizeDebounceTimer);
      this.resizeDebounceTimer = 0;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    window.removeEventListener('resize', this.handleResizeBound);
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('webglcontextlost', this.handleContextLostBound);
    canvas.removeEventListener('webglcontextrestored', this.handleContextRestoredBound);
    this._activeScene?.dispose();
    this._activeScene = null;
    this.renderer.dispose();
  }
}
