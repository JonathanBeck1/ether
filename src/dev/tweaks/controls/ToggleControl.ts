import type { ToggleDescriptor } from '../types';
import { BaseControl } from './BaseControl';
import { el } from '../dom';

/**
 * Sliding pill toggle. A click is a discrete edit:
 * beginEdit() → live(v) → commitEdit(v). The ~180ms knob ease lives in tokens.
 */
export class ToggleControl extends BaseControl<boolean> {
  private value = false;
  private pill!: HTMLButtonElement;

  constructor(desc: ToggleDescriptor) {
    super(desc, 0);
    this.value = this.capturedDefault;
  }

  protected buildWidget(): void {
    this.pill = el('button', { class: 'tw-toggle', attrs: { type: 'button', role: 'switch' } });
    this.pill.appendChild(el('span', { class: 'tw-toggle-knob' }));
    this.widget.appendChild(this.pill);
    this.on(this.pill, 'click', () => this.flip());
  }

  protected refreshWidget(value: boolean): void {
    this.value = value;
    this.paint();
  }

  protected readWidget(): boolean {
    return this.value;
  }

  private flip(): void {
    const next = !this.value;
    this.value = next;
    this.paint();
    this.beginEdit();
    this.ctx.live(next);
    this.commitEdit(next);
  }

  private paint(): void {
    this.pill.classList.toggle('tw-on', this.value);
    this.pill.setAttribute('aria-checked', String(this.value));
  }
}
