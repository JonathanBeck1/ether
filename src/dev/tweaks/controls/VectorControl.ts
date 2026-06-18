import type { VectorDescriptor } from '../types';
import { BaseControl } from './BaseControl';
import { el } from '../dom';
import { formatNumber } from '../format';
import { attachScrub } from '../scrub';

const PAD = 96; // XY pad edge (px)

/**
 * 2D (XY pad) or 3D (XY pad + z slider) vector. The pad handle drags in the
 * square (x → horizontal, y → vertical with screen-up = +y); two scrub readouts
 * give precise per-axis entry; the optional z renders as a third readout-scrub
 * row. Every edit funnels through setAxis() → live; commit on release.
 */
export class VectorControl extends BaseControl<number[]> {
  private readonly cfg: VectorDescriptor;
  private vals: number[] = [];

  private pad!: HTMLElement;
  private handle!: HTMLElement;
  private readouts: HTMLElement[] = [];
  private scrubDetach: Array<() => void> = [];

  constructor(desc: VectorDescriptor) {
    super(desc, desc.step);
    this.cfg = desc;
    this.vals = (this.capturedDefault as number[]).slice();
  }

  protected buildWidget(): void {
    const wrap = el('div', { class: 'tw-vector' });

    // XY pad.
    this.pad = el('div', { class: 'tw-xy', style: { width: `${PAD}px`, height: `${PAD}px` } });
    this.handle = el('div', {
      class: 'tw-xy-handle',
      attrs: { role: 'slider', 'aria-valuemin': String(this.cfg.min), 'aria-valuemax': String(this.cfg.max) },
    });
    this.pad.appendChild(this.handle);

    // Per-axis readout-scrub rows (x, y, and z when axes === 3).
    const labels = ['x', 'y', 'z'];
    const fields = el('div', { class: 'tw-vector-fields' });
    for (let i = 0; i < this.cfg.axes; i++) {
      const row = el('div', { class: 'tw-vector-field' });
      row.appendChild(el('span', { class: 'tw-axis-tag', text: labels[i] }));
      const readout = el('span', { class: 'tw-readout' });
      this.readouts.push(readout);
      row.appendChild(readout);
      fields.appendChild(row);
    }

    wrap.appendChild(this.pad);
    wrap.appendChild(fields);
    this.widget.appendChild(wrap);

    // Pad drag — pointer-captured, x = horizontal, y = vertical (screen-up = +).
    this.on(this.pad, 'pointerdown', this.onPadDown as EventListener);
    this.on(this.pad, 'pointermove', this.onPadMove as EventListener);
    this.on(this.pad, 'pointerup', this.onPadUp as EventListener);
    this.on(this.widget, 'dblclick', () => this.reset());

    for (let i = 0; i < this.cfg.axes; i++) {
      this.scrubDetach.push(
        attachScrub(this.readouts[i], {
          step: this.cfg.step,
          min: this.cfg.min,
          max: this.cfg.max,
          getValue: () => this.vals[i],
          onStart: () => this.beginEdit(),
          onScrub: (v) => {
            this.setAxis(i, v);
            this.ctx.live(this.vals.slice());
          },
          onEnd: () => this.commitEdit(this.vals.slice()),
        }),
      );
    }
  }

  protected refreshWidget(value: number[]): void {
    for (let i = 0; i < this.cfg.axes; i++) this.vals[i] = this.clampQuantize(value[i] ?? this.vals[i]);
    this.paint();
  }

  protected readWidget(): number[] {
    return this.vals.slice();
  }

  destroy(): void {
    for (const d of this.scrubDetach) d();
    this.scrubDetach = [];
    super.destroy();
  }

  // ── internals ─────────────────────────────────────────────────────

  private clampQuantize(v: number): number {
    const { min, max, step } = this.cfg;
    const q = Math.round((v - min) / step) * step + min;
    return Math.max(min, Math.min(max, q));
  }

  /** Set one axis. Never fires live/commit. */
  private setAxis(i: number, v: number): void {
    this.vals[i] = this.clampQuantize(v);
    this.paint();
  }

  private norm(v: number): number {
    const { min, max } = this.cfg;
    return max > min ? (v - min) / (max - min) : 0;
  }

  private paint(): void {
    this.handle.style.left = `${this.norm(this.vals[0]) * 100}%`;
    this.handle.style.top = `${(1 - this.norm(this.vals[1])) * 100}%`;
    for (let i = 0; i < this.cfg.axes; i++) {
      this.readouts[i].textContent = this.fmt(this.vals[i]);
    }
    this.handle.setAttribute('aria-valuenow', String(this.vals[0]));
    this.handle.setAttribute('aria-valuetext', this.vals.slice(0, this.cfg.axes).map((v) => this.fmt(v)).join(', '));
  }

  private fmt(v: number): string {
    return this.cfg.format ? this.cfg.format(v) : formatNumber(v, this.cfg.step);
  }

  // ── XY pad drag ────────────────────────────────────────────────────

  private onPadDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    this.pad.setPointerCapture(e.pointerId);
    this.pad.classList.add('tw-grabbing');
    this.beginEdit();
    this.applyFromPointer(e);
  };

  private onPadMove = (e: PointerEvent): void => {
    if (!this.pad.hasPointerCapture(e.pointerId)) return;
    this.applyFromPointer(e);
  };

  private onPadUp = (e: PointerEvent): void => {
    if (!this.pad.hasPointerCapture(e.pointerId)) return;
    this.pad.releasePointerCapture(e.pointerId);
    this.pad.classList.remove('tw-grabbing');
    this.commitEdit(this.vals.slice());
  };

  private applyFromPointer(e: PointerEvent): void {
    const rect = this.pad.getBoundingClientRect();
    const { min, max } = this.cfg;
    const tx = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
    const ty = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0;
    this.setAxis(0, min + Math.max(0, Math.min(1, tx)) * (max - min));
    this.setAxis(1, min + Math.max(0, Math.min(1, 1 - ty)) * (max - min));
    this.ctx.live(this.vals.slice());
  }
}
