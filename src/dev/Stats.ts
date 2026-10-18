import type { SceneManager } from '../core/SceneManager';

/**
 * Lightweight perf + diagnostics overlay.
 *
 * Shows what `manager.getDiagnostics()` reports: loop FPS and CPU ms
 * per tick, GPU tier, applied DPR, the live composer's enabled passes,
 * last-frame draw calls and triangles, plus the canvas drawing-buffer
 * size, in a corner panel.
 * Built specifically to be useful on a phone — large enough to read at
 * arm's length, contains all the info you need to diagnose mobile
 * rendering issues without opening DevTools.
 *
 * Use:
 *
 *   import { Stats } from 'ether/dev';
 *   // Anywhere after initSceneRouter() resolves:
 *   const manager = await initSceneRouter(canvas, routes);
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
 * Cost: one extra `requestAnimationFrame` callback, plus one
 * `getDiagnostics()` call and a few DOM `textContent` writes twice per
 * second. Negligible. Safe to ship in production gated by the URL param.
 */
export class Stats {
  private readonly manager: SceneManager;
  private readonly root: HTMLElement;
  private readonly fpsEl: HTMLSpanElement;
  private readonly cpuEl: HTMLSpanElement;
  private readonly tierEl: HTMLSpanElement;
  private readonly dprEl: HTMLSpanElement;
  private readonly composerEl: HTMLSpanElement;
  private readonly callsEl: HTMLSpanElement;
  private readonly trisEl: HTMLSpanElement;
  private readonly viewportEl: HTMLSpanElement;

  private rafId = 0;
  private lastSampleTime = 0;
  private readonly tickBound: (now: number) => void;
  private mounted = false;
  /**
   * Custom rows added via addRow(). Sampled every overlay tick
   * (~500ms — same cadence as FPS) so a misbehaving sampler can't
   * dominate the frame.
   */
  private readonly customRows: Array<{
    sampler: () => string;
    el: HTMLSpanElement;
  }> = [];
  private buildRow!: (label: string) => { row: HTMLDivElement; value: HTMLSpanElement };

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
      val.style.color = '#fff';
      r.appendChild(lab);
      r.appendChild(val);
      return { row: r, value: val };
    };
    // Expose the row builder so addRow() can use the same styling.
    this.buildRow = row;

    const { row: fpsR, value: fpsV } = row('FPS');
    const { row: cpuR, value: cpuV } = row('CPU');
    const { row: tierR, value: tierV } = row('TIER');
    const { row: dprR, value: dprV } = row('DPR');
    const { row: composerR, value: composerV } = row('FX');
    const { row: callsR, value: callsV } = row('CALLS');
    const { row: trisR, value: trisV } = row('TRIS');
    const { row: viewportR, value: viewportV } = row('VIEW');

    this.fpsEl = fpsV;
    this.cpuEl = cpuV;
    this.tierEl = tierV;
    this.dprEl = dprV;
    this.composerEl = composerV;
    this.callsEl = callsV;
    this.trisEl = trisV;
    this.viewportEl = viewportV;

    root.appendChild(fpsR);
    root.appendChild(cpuR);
    root.appendChild(tierR);
    root.appendChild(dprR);
    root.appendChild(composerR);
    root.appendChild(callsR);
    root.appendChild(trisR);
    root.appendChild(viewportR);

    this.root = root;

    this.tickBound = this.tick.bind(this);
  }

  /** Mount into the document (defaults to <body>). Returns self for chain. */
  mount(parent: HTMLElement = document.body): this {
    if (this.mounted) return this;
    parent.appendChild(this.root);
    this.refresh();
    this.lastSampleTime = performance.now();
    this.rafId = requestAnimationFrame(this.tickBound);
    this.mounted = true;
    return this;
  }

  /**
   * Append a custom diagnostic row. The sampler is called every
   * overlay tick (~2 Hz) and its return value is set as the row's
   * text content. Use for plumbing site-specific state into the
   * overlay without coupling the kit to your scene types.
   *
   *   stats.addRow('DRIFT', () => motion.driftQuat.w.toFixed(3));
   *   stats.addRow('SNAPS', () => snapCounter.toString());
   *
   * Safe to call before or after `mount()`.
   */
  addRow(label: string, sampler: () => string): this {
    const { row, value } = this.buildRow(label);
    this.customRows.push({ sampler, el: value });
    this.root.appendChild(row);
    return this;
  }

  /** Remove from DOM and stop the rAF. */
  unmount(): void {
    if (!this.mounted) return;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.root.remove();
    this.mounted = false;
  }

  private refresh(): void {
    const d = this.manager.getDiagnostics();
    const { fps, cpuMs } = d.performance;
    this.fpsEl.textContent = fps === null ? '--' : fps.toFixed(0);
    // Colour-code FPS: green ≥55, amber 30–54, red <30.
    this.fpsEl.style.color =
      fps === null ? '#fff' : fps >= 55 ? '#4ade80' : fps >= 30 ? '#fbbf24' : '#f87171';
    this.cpuEl.textContent = cpuMs === null ? '--' : cpuMs.toFixed(1);
    this.tierEl.textContent = d.quality.tier;
    this.dprEl.textContent = `${d.rendering.dpr.toFixed(2)}×`;
    this.composerEl.textContent = d.postFX.enabled
      ? d.postFX.passes.map((name) => name.replace(/Pass$/, '')).join('+')
      : 'OFF';
    this.callsEl.textContent = String(d.rendering.drawCalls);
    this.trisEl.textContent = String(d.rendering.triangles);
    const canvas = this.manager.renderer.domElement;
    this.viewportEl.textContent = `${canvas.width}×${canvas.height}`;
  }

  private tick(now: number): void {
    // Sample every ~500ms — fast enough to feel live, slow enough
    // that the textContent writes don't dominate.
    if (now - this.lastSampleTime >= 500) {
      this.lastSampleTime = now;
      this.refresh();
      // Sample all custom diagnostic rows.
      for (const r of this.customRows) {
        try {
          r.el.textContent = r.sampler();
        } catch (err) {
          r.el.textContent = '!err';
          if (typeof console !== 'undefined') console.warn('[kit/dev/Stats] custom row sampler threw:', err);
        }
      }
    }
    this.rafId = requestAnimationFrame(this.tickBound);
  }
}
