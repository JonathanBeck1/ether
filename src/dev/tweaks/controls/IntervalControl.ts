import type { IntervalDescriptor } from '../types';
import { BaseControl, humanize } from './BaseControl';
import { el } from '../dom';
import { formatNumber } from '../format';
import { attachScrub } from '../scrub';

type Side = 0 | 1; // 0 = lo thumb, 1 = hi thumb

/**
 * A min/max band on one track. The fill is the gradient slice between the two
 * thumbs (position-true, anchored to the full track like the slider). Either
 * thumb drags via pointer capture, nudges via arrow keys when focused, and
 * scrubs via its own readout. The thumbs can't cross — each is clamped against
 * the other, so the value stays a valid [lo, hi].
 */
export class IntervalControl extends BaseControl<number[]> {
  private readonly cfg: IntervalDescriptor;
  private lo = 0;
  private hi = 0;

  private slider!: HTMLElement;
  private track!: HTMLElement;
  private fill!: HTMLElement;
  private thumbs!: [HTMLElement, HTMLElement];
  private readouts!: [HTMLElement, HTMLElement];
  private dragging: Side | null = null;
  private scrubDetach: Array<() => void> = [];

  constructor(desc: IntervalDescriptor) {
    super(desc, desc.step);
    this.cfg = desc;
    [this.lo, this.hi] = this.capturedDefault as [number, number];
  }

  protected buildWidget(): void {
    this.slider = el('div', {
      class: 'tw-slider tw-interval',
      attrs: { 'aria-label': this.cfg.label ?? humanize(this.cfg.path) },
    });
    this.track = el('div', { class: 'tw-slider-track' });
    this.fill = el('div', { class: 'tw-slider-fill' });
    const aria = { tabindex: '0', role: 'slider', 'aria-valuemin': String(this.cfg.min), 'aria-valuemax': String(this.cfg.max) };
    const loThumb = el('div', { class: 'tw-thumb', attrs: aria });
    const hiThumb = el('div', { class: 'tw-thumb', attrs: aria });
    this.thumbs = [loThumb, hiThumb];
    this.track.appendChild(this.fill);
    this.track.appendChild(loThumb);
    this.track.appendChild(hiThumb);
    this.slider.appendChild(this.track);

    const loReadout = el('span', { class: 'tw-readout' });
    const hiReadout = el('span', { class: 'tw-readout' });
    this.readouts = [loReadout, hiReadout];

    const readoutCol = el('div', { class: 'tw-interval-readouts' });
    readoutCol.appendChild(loReadout);
    readoutCol.appendChild(hiReadout);

    this.widget.appendChild(this.slider);
    this.widget.appendChild(readoutCol);

    // Track drag — pointer-captured, picks the nearer thumb on down.
    this.on(this.slider, 'pointerdown', this.onTrackDown as EventListener);
    this.on(this.slider, 'pointermove', this.onTrackMove as EventListener);
    this.on(this.slider, 'pointerup', this.onTrackUp as EventListener);

    // Arrow-key nudge per focused thumb.
    this.on(loThumb, 'keydown', ((e: KeyboardEvent) => this.onKey(e, 0)) as EventListener);
    this.on(hiThumb, 'keydown', ((e: KeyboardEvent) => this.onKey(e, 1)) as EventListener);

    this.on(this.widget, 'dblclick', () => this.reset());

    // Each readout scrubs its own side.
    ([0, 1] as Side[]).forEach((side) => {
      this.scrubDetach.push(
        attachScrub(this.readouts[side], {
          step: this.cfg.step,
          min: this.cfg.min,
          max: this.cfg.max,
          getValue: () => (side === 0 ? this.lo : this.hi),
          onStart: () => this.beginEdit(),
          onScrub: (v) => {
            this.setSide(side, v);
            this.ctx.live(this.read());
          },
          onEnd: () => this.commitEdit(this.read()),
        }),
      );
    });
  }

  protected refreshWidget(value: number[]): void {
    const [lo, hi] = value as [number, number];
    this.lo = this.clampQuantize(lo);
    this.hi = this.clampQuantize(hi);
    if (this.hi < this.lo) this.hi = this.lo;
    this.paint();
  }

  protected readWidget(): number[] {
    return this.read();
  }

  destroy(): void {
    for (const d of this.scrubDetach) d();
    this.scrubDetach = [];
    super.destroy();
  }

  // ── internals ─────────────────────────────────────────────────────

  private read(): [number, number] {
    return [this.lo, this.hi];
  }

  private clampQuantize(v: number): number {
    const { min, max, step } = this.cfg;
    const q = Math.round((v - min) / step) * step + min;
    return Math.max(min, Math.min(max, q));
  }

  /** Move one side, clamped so the thumbs never cross. Never fires live/commit. */
  private setSide(side: Side, v: number): void {
    const q = this.clampQuantize(v);
    if (side === 0) this.lo = Math.min(q, this.hi);
    else this.hi = Math.max(q, this.lo);
    this.paint();
  }

  private paint(): void {
    const { min, max } = this.cfg;
    const span = max - min || 1;
    const tLo = (this.lo - min) / span;
    const tHi = (this.hi - min) / span;
    this.thumbs[0].style.left = `${tLo * 100}%`;
    this.thumbs[1].style.left = `${tHi * 100}%`;
    this.fill.style.left = `${tLo * 100}%`;
    this.fill.style.width = `${(tHi - tLo) * 100}%`;
    // Position-true fill: anchor the gradient to the full track + shift it left
    // so the color under each thumb matches a single-thumb slider.
    const w = this.track.offsetWidth;
    if (w) {
      this.fill.style.backgroundSize = `${w}px 100%`;
      this.fill.style.backgroundPosition = `${-tLo * w}px 0`;
    }
    this.readouts[0].textContent = this.format(this.lo);
    this.readouts[1].textContent = this.format(this.hi);
    this.thumbs[0].setAttribute('aria-valuenow', String(this.lo));
    this.thumbs[1].setAttribute('aria-valuenow', String(this.hi));
    this.thumbs[0].setAttribute('aria-valuetext', this.format(this.lo));
    this.thumbs[1].setAttribute('aria-valuetext', this.format(this.hi));
  }

  private format(v: number): string {
    return this.cfg.format ? this.cfg.format(v) : formatNumber(v, this.cfg.step);
  }

  // ── Track drag ─────────────────────────────────────────────────────

  private onTrackDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.tw-readout')) return; // readouts own their gestures
    e.preventDefault();
    this.slider.setPointerCapture(e.pointerId);
    this.slider.classList.add('tw-grabbing');
    this.dragging = this.nearerSide(e.clientX);
    this.beginEdit();
    this.applyFromClientX(e.clientX);
  };

  private onTrackMove = (e: PointerEvent): void => {
    if (this.dragging === null || !this.slider.hasPointerCapture(e.pointerId)) return;
    this.applyFromClientX(e.clientX);
  };

  private onTrackUp = (e: PointerEvent): void => {
    if (!this.slider.hasPointerCapture(e.pointerId)) return;
    this.slider.releasePointerCapture(e.pointerId);
    this.slider.classList.remove('tw-grabbing');
    this.dragging = null;
    this.commitEdit(this.read());
  };

  private nearerSide(clientX: number): Side {
    const rect = this.track.getBoundingClientRect();
    const { min, max } = this.cfg;
    const t = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    const v = min + t * (max - min);
    // Collapsed band (lo === hi): pick by which way the pointer pulls so the
    // band can re-open in either direction from a track drag.
    if (this.lo === this.hi) return v >= this.lo ? 1 : 0;
    return Math.abs(v - this.lo) <= Math.abs(v - this.hi) ? 0 : 1;
  }

  private applyFromClientX(clientX: number): void {
    if (this.dragging === null) return;
    const rect = this.track.getBoundingClientRect();
    const { min, max } = this.cfg;
    const t = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    this.setSide(this.dragging, min + Math.max(0, Math.min(1, t)) * (max - min));
    this.ctx.live(this.read());
  }

  // ── Arrow-key nudge ────────────────────────────────────────────────

  private onKey(e: KeyboardEvent, side: Side): void {
    const { min, max, step } = this.cfg;
    const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
    const cur = side === 0 ? this.lo : this.hi;
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        next = cur + step * mult;
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
        next = cur - step * mult;
        break;
      case 'Home':
        next = min;
        break;
      case 'End':
        next = max;
        break;
      default:
        return;
    }
    e.preventDefault();
    this.beginEdit();
    this.setSide(side, next);
    this.ctx.live(this.read());
    this.commitEdit(this.read());
  }
}
