import type { SceneManager } from '../core/SceneManager';

/**
 * Lightweight perf + diagnostics overlay.
 *
 * Shows FPS (rolling 500ms average), frame time (ms), GPU tier, DPR,
 * composer presence, and the WebGL renderer string in a corner panel.
 * Built specifically to be useful on a phone — large enough to read at
 * arm's length, contains all the info you need to diagnose mobile
 * rendering issues without opening DevTools.
 *
 * Use:
 *
 *   import { Stats } from '@taketwo/kit/dev';
 *   // Anywhere after initSceneRouter() resolves:
 *   const manager = await initSceneRouter(canvas, factory);
 *   if (new URL(location.href).searchParams.has('stats')) {
 *     new Stats(manager).mount();
 *   }
 *
 * `?stats` is the convention but the caller picks any trigger.
 *
 * Self-contained: no CSS file dependency, no external lib, no styling
 * leak into the host page (uses inline styles on its own root element
 * with a high z-index). Removes cleanly on `unmount()`.
 *
 * Cost: one extra `requestAnimationFrame` callback + a few DOM
 * `textContent` writes twice per second. Negligible. Safe to ship in
 * production gated by the URL param.
 */
export class Stats {
  private readonly manager: SceneManager;
  private readonly root: HTMLElement;
  private readonly fpsEl: HTMLSpanElement;
  private readonly msEl: HTMLSpanElement;
  private readonly tierEl: HTMLSpanElement;
  private readonly dprEl: HTMLSpanElement;
  private readonly composerEl: HTMLSpanElement;
  private readonly viewportEl: HTMLSpanElement;

  private rafId = 0;
  private frameCount = 0;
  private lastSampleTime = 0;
  private readonly tickBound: (now: number) => void;
  private readonly resizeBound: () => void;
  private mounted = false;

  constructor(manager: SceneManager) {
    this.manager = manager;

    // Build the panel DOM imperatively. Tiny footprint — no template
    // strings, no innerHTML, no XSS surface.
    const root = document.createElement('div');
    Object.assign(root.style, {
      position: 'fixed',
      top: '12px',
      right: '12px',
      zIndex: '99999',
      padding: '10px 12px',
      background: 'rgba(5, 6, 10, 0.78)',
      backdropFilter: 'blur(8px)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: '6px',
      color: '#fff',
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: '11px',
      lineHeight: '1.5',
      letterSpacing: '0.04em',
      pointerEvents: 'none',
      userSelect: 'none',
      minWidth: '160px',
    } as Partial<CSSStyleDeclaration>);
    root.setAttribute('data-kit-stats', '');

    const row = (label: string): { row: HTMLDivElement; value: HTMLSpanElement } => {
      const r = document.createElement('div');
      Object.assign(r.style, { display: 'flex', justifyContent: 'space-between', gap: '10px' });
      const lab = document.createElement('span');
      lab.textContent = label;
      lab.style.opacity = '0.5';
      const val = document.createElement('span');
      val.style.color = '#59ffe2';
      r.appendChild(lab);
      r.appendChild(val);
      return { row: r, value: val };
    };

    const { row: fpsR, value: fpsV } = row('FPS');
    const { row: msR, value: msV } = row('MS');
    const { row: tierR, value: tierV } = row('TIER');
    const { row: dprR, value: dprV } = row('DPR');
    const { row: composerR, value: composerV } = row('FX');
    const { row: viewportR, value: viewportV } = row('VIEW');

    this.fpsEl = fpsV;
    this.msEl = msV;
    this.tierEl = tierV;
    this.dprEl = dprV;
    this.composerEl = composerV;
    this.viewportEl = viewportV;

    root.appendChild(fpsR);
    root.appendChild(msR);
    root.appendChild(tierR);
    root.appendChild(dprR);
    root.appendChild(composerR);
    root.appendChild(viewportR);

    this.root = root;

    this.tickBound = this.tick.bind(this);
    this.resizeBound = this.refreshStatic.bind(this);
  }

  /** Mount into the document (defaults to <body>). Returns self for chain. */
  mount(parent: HTMLElement = document.body): this {
    if (this.mounted) return this;
    parent.appendChild(this.root);
    this.refreshStatic();
    window.addEventListener('resize', this.resizeBound);
    this.lastSampleTime = performance.now();
    this.frameCount = 0;
    this.rafId = requestAnimationFrame(this.tickBound);
    this.mounted = true;
    return this;
  }

  /** Remove from DOM and stop the rAF. */
  unmount(): void {
    if (!this.mounted) return;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.resizeBound);
    this.root.remove();
    this.mounted = false;
  }

  /** Static-ish fields refreshed on mount + resize. */
  private refreshStatic(): void {
    const q = this.manager.quality;
    const r = this.manager.renderer;
    this.tierEl.textContent = q.tier;
    this.dprEl.textContent = `${r.getPixelRatio().toFixed(2)}×`;
    this.composerEl.textContent = q.enablePostFX
      ? q.enableDither
        ? 'BLOOM+DTH'
        : 'BLOOM'
      : 'OFF';
    this.viewportEl.textContent = `${window.innerWidth}×${window.innerHeight}`;
  }

  private tick(now: number): void {
    this.frameCount++;
    const delta = now - this.lastSampleTime;
    // Sample every ~500ms — fast enough to feel live, slow enough
    // that the textContent writes don't dominate.
    if (delta >= 500) {
      const fps = (this.frameCount * 1000) / delta;
      const ms = delta / this.frameCount;
      this.fpsEl.textContent = fps.toFixed(0);
      // Colour-code FPS: green ≥55, amber 30–54, red <30.
      this.fpsEl.style.color =
        fps >= 55 ? '#59ffe2' : fps >= 30 ? '#ff7d4e' : '#ff3a3a';
      this.msEl.textContent = ms.toFixed(1);
      this.frameCount = 0;
      this.lastSampleTime = now;
      // Refresh DPR + viewport too in case Vite HMR or browser
      // events changed them without firing 'resize'.
      this.refreshStatic();
    }
    this.rafId = requestAnimationFrame(this.tickBound);
  }
}
