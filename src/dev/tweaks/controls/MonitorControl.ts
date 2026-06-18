import type { MonitorDescriptor } from '../types';
import { BaseControl } from './BaseControl';
import { el } from '../dom';
import { formatNumber } from '../format';

const SAMPLES = 60;
const SVG_NS = 'http://www.w3.org/2000/svg';
const SPARK_W = 96;
const SPARK_H = 18;

/**
 * Read-only live readout + sparkline. No set/live/commit path — the shell's
 * read-back loop calls refresh(value) on drift, which pushes a sample and
 * repaints the number. The Registry registers it non-editable (no commit,
 * no persist, no reset, not dirty).
 */
export class MonitorControl extends BaseControl<number> {
  private readonly cfg: MonitorDescriptor;
  private value = 0;
  private readonly history: number[] = [];

  private numberEl!: HTMLElement;
  private poly!: SVGPolylineElement;

  constructor(desc: MonitorDescriptor) {
    super(desc, 0);
    this.cfg = desc;
  }

  protected buildWidget(): void {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'tw-spark');
    svg.setAttribute('viewBox', `0 0 ${SPARK_W} ${SPARK_H}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    this.poly = document.createElementNS(SVG_NS, 'polyline');
    this.poly.setAttribute('class', 'tw-spark-line');
    svg.appendChild(this.poly);

    this.numberEl = el('span', { class: 'tw-readout tw-monitor' });

    this.widget.appendChild(svg);
    this.widget.appendChild(this.numberEl);
  }

  /** A new external sample → push to the ring, repaint number + sparkline. */
  protected refreshWidget(value: number): void {
    this.value = value;
    this.history.push(value);
    if (this.history.length > SAMPLES) this.history.shift();
    this.paint();
  }

  protected readWidget(): number {
    return this.value;
  }

  // Read-only: never dirty, reset is a no-op (no underlying writable slot).
  isDirty(): boolean {
    return false;
  }

  reset(): void {
    /* read-only — nothing to reset */
  }

  private paint(): void {
    const unit = this.cfg.unit ? ` ${this.cfg.unit}` : '';
    this.numberEl.textContent = this.fmt(this.value) + unit;

    const n = this.history.length;
    if (n < 2) {
      this.poly.setAttribute('points', '');
      return;
    }
    let min = Infinity;
    let max = -Infinity;
    for (const v of this.history) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const span = max - min || 1;
    const pts: string[] = [];
    for (let i = 0; i < n; i++) {
      const x = (i / (SAMPLES - 1)) * SPARK_W;
      const y = SPARK_H - ((this.history[i] - min) / span) * SPARK_H;
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    this.poly.setAttribute('points', pts.join(' '));
  }

  private fmt(v: number): string {
    return this.cfg.format ? this.cfg.format(v) : formatNumber(v, v === Math.round(v) ? 1 : 0.01);
  }
}
