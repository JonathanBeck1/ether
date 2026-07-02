import type { SliderDescriptor } from '../types';
import { BaseControl, humanize } from './BaseControl';
import { el } from '../dom';
import { formatNumber } from '../format';
import { attachScrub } from '../scrub';

/**
 * The signature slider. Five interactions: track drag, readout drag-scrub,
 * arrow-key nudge, double-click reset, click-to-type. Fill is position-true —
 * the gradient is anchored to the full track width (background-size) so the
 * color under the thumb is correct, never a stretched 2-stop.
 */
export class SliderControl extends BaseControl<number> {
  private readonly cfg: SliderDescriptor;
  private value = 0;

  private slider!: HTMLElement;
  private track!: HTMLElement;
  private fill!: HTMLElement;
  private thumb!: HTMLElement;
  private readout!: HTMLElement;
  private input: HTMLInputElement | null = null;

  private scrubDetach: (() => void) | null = null;

  constructor(desc: SliderDescriptor) {
    super(desc, desc.step);
    this.cfg = desc;
    this.value = this.capturedDefault;
  }

  protected buildWidget(): void {
    this.slider = el('div', {
      class: 'tw-slider',
      attrs: {
        tabindex: '0',
        role: 'slider',
        'aria-label': this.cfg.label ?? humanize(this.cfg.path),
        'aria-valuemin': String(this.cfg.min),
        'aria-valuemax': String(this.cfg.max),
      },
    });
    this.track = el('div', { class: 'tw-slider-track' });
    this.fill = el('div', { class: 'tw-slider-fill' });
    this.thumb = el('div', { class: 'tw-thumb' });
    this.track.appendChild(this.fill);
    this.track.appendChild(this.thumb);
    this.slider.appendChild(this.track);

    this.readout = el('span', { class: 'tw-readout', attrs: { tabindex: '0' } });

    this.widget.appendChild(this.slider);
    this.widget.appendChild(this.readout);

    // (a) track drag — pointer-captured, clientX → value
    this.on(this.slider, 'pointerdown', this.onTrackDown as EventListener);
    this.on(this.slider, 'pointermove', this.onTrackMove as EventListener);
    this.on(this.slider, 'pointerup', this.onTrackUp as EventListener);

    // (c) arrow-key nudge — both the track and the readout are focusable
    this.on(this.slider, 'keydown', this.onKeyDown as EventListener);
    this.on(this.readout, 'keydown', this.onKeyDown as EventListener);

    // (d) double-click anywhere on the widget → reset
    this.on(this.widget, 'dblclick', () => this.reset());

    // (b) drag-scrub the readout + (e) click-to-type guard
    this.scrubDetach = attachScrub(this.readout, {
      step: this.cfg.step,
      min: this.cfg.min,
      max: this.cfg.max,
      getValue: () => this.value,
      onStart: () => this.beginEdit(),
      onScrub: (v) => {
        this.set(v);
        this.ctx.live(v);
      },
      onEnd: () => this.commitEdit(this.value),
      onCancel: () => this.cancelEdit(),
      onClick: () => this.openInput(),
    });
  }

  protected refreshWidget(value: number): void {
    this.set(value);
  }

  protected readWidget(): number {
    return this.value;
  }

  destroy(): void {
    this.scrubDetach?.();
    this.scrubDetach = null;
    super.destroy();
  }

  // ── internals ─────────────────────────────────────────────────────

  /** Update internal value + DOM. Never fires live/commit. */
  private set(v: number): void {
    this.value = this.clampQuantize(v);
    this.paint();
  }

  private clampQuantize(v: number): number {
    const { min, max, step } = this.cfg;
    const q = Math.round((v - min) / step) * step + min;
    return Math.max(min, Math.min(max, q));
  }

  private paint(): void {
    const { min, max, step } = this.cfg;
    const t = max > min ? (this.value - min) / (max - min) : 0;
    const pct = `${t * 100}%`;
    this.fill.style.width = pct;
    this.thumb.style.left = pct;
    // Position-true fill: anchor the gradient to the full track width so the
    // color under the thumb is real, not a stretched 2-stop.
    const w = this.track.offsetWidth;
    if (w) this.fill.style.backgroundSize = `${w}px 100%`;
    this.slider.setAttribute('aria-valuenow', String(this.value));
    if (!this.input) this.readout.textContent = this.format(this.value, step);
  }

  private format(v: number, step: number): string {
    return this.cfg.format ? this.cfg.format(v) : formatNumber(v, step);
  }

  // (a) Track drag --------------------------------------------------------

  private onTrackDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.tw-readout')) return; // readout owns its own gestures
    e.preventDefault();
    this.slider.setPointerCapture(e.pointerId);
    this.slider.classList.add('tw-grabbing');
    this.beginEdit();
    this.applyFromClientX(e.clientX);
  };

  private onTrackMove = (e: PointerEvent): void => {
    if (!this.slider.hasPointerCapture(e.pointerId)) return;
    this.applyFromClientX(e.clientX);
  };

  private onTrackUp = (e: PointerEvent): void => {
    if (!this.slider.hasPointerCapture(e.pointerId)) return;
    this.slider.releasePointerCapture(e.pointerId);
    this.slider.classList.remove('tw-grabbing');
    this.commitEdit(this.value);
  };

  private applyFromClientX(clientX: number): void {
    const rect = this.track.getBoundingClientRect();
    const { min, max } = this.cfg;
    const t = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    const next = this.clampQuantize(min + Math.max(0, Math.min(1, t)) * (max - min));
    this.set(next);
    this.ctx.live(next);
  };

  // (c) Arrow-key nudge ---------------------------------------------------

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.input) return; // click-to-type input owns arrow/Home/End while open
    const { min, max, step } = this.cfg;
    const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        next = this.value + step * mult;
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
        next = this.value - step * mult;
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
    this.set(next);
    this.ctx.live(this.value);
    this.commitEdit(this.value);
  };

  // (e) Click-to-type -----------------------------------------------------

  private openInput(): void {
    if (this.input) return;
    const input = el('input', {
      class: 'tw-input',
      attrs: { type: 'text', inputmode: 'decimal' },
    });
    input.value = this.format(this.value, this.cfg.step);
    this.readout.textContent = '';
    this.readout.appendChild(input);
    this.input = input;
    input.focus();
    input.select();

    this.on(input, 'keydown', ((ev: KeyboardEvent) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        this.commitInput(input.value);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        this.closeInput();
      }
    }) as EventListener);
    this.on(input, 'blur', () => this.commitInput(input.value));
  }

  private commitInput(raw: string): void {
    if (!this.input) return; // Escape already closed it — don't double-commit on the trailing blur
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      this.beginEdit();
      this.set(parsed);
      this.ctx.live(this.value);
      this.commitEdit(this.value);
    }
    this.closeInput();
  }

  private closeInput(): void {
    if (!this.input) return;
    this.input.remove();
    this.input = null;
    this.paint();
  }
}
