import type { SelectDescriptor } from '../types';
import { BaseControl } from './BaseControl';
import { el } from '../dom';

/**
 * Discrete enum control. ≤4 options render as segmented pills (the whole set is
 * visible, one tap to switch); >4 options collapse to a bespoke (non-native)
 * dropdown so the panel's mono identity holds. Either way a change is one
 * discrete edit: beginEdit → live → commit.
 */
export class SelectControl extends BaseControl<string | number> {
  private value: string | number;
  private readonly labels: string[];
  private readonly values: Array<string | number>;

  // Pills mode.
  private pills: HTMLButtonElement[] = [];
  // Dropdown mode.
  private trigger: HTMLButtonElement | null = null;
  private list: HTMLElement | null = null;
  private open = false;

  constructor(desc: SelectDescriptor) {
    super(desc, 0);
    this.labels = Object.keys(desc.options);
    this.values = this.labels.map((k) => desc.options[k]);
    this.value = this.capturedDefault;
  }

  protected buildWidget(): void {
    if (this.values.length <= 4) this.buildPills();
    else this.buildDropdown();
  }

  protected refreshWidget(value: string | number): void {
    this.value = value;
    this.paint();
  }

  protected readWidget(): string | number {
    return this.value;
  }

  // ── Pills (≤4) ──────────────────────────────────────────────────────

  private buildPills(): void {
    const group = el('div', { class: 'tw-segments', attrs: { role: 'radiogroup' } });
    this.labels.forEach((label, i) => {
      const pill = el('button', {
        class: 'tw-segment',
        text: label,
        attrs: { type: 'button', role: 'radio' },
      });
      this.on(pill, 'click', () => this.choose(this.values[i]));
      this.pills.push(pill);
      group.appendChild(pill);
    });
    this.widget.appendChild(group);
  }

  // ── Dropdown (>4) ───────────────────────────────────────────────────

  private buildDropdown(): void {
    const menu = el('div', { class: 'tw-select' });
    this.trigger = el('button', { class: 'tw-select-trigger', attrs: { type: 'button', 'aria-haspopup': 'listbox' } });
    this.list = el('div', { class: 'tw-select-list', attrs: { role: 'listbox' } });

    this.labels.forEach((label, i) => {
      const opt = el('button', { class: 'tw-select-option', text: label, attrs: { type: 'button', role: 'option' } });
      this.on(opt, 'click', () => {
        this.choose(this.values[i]);
        this.closeList();
      });
      this.list!.appendChild(opt);
    });

    this.on(this.trigger, 'click', () => (this.open ? this.closeList() : this.openList()));
    // Outside-click dismiss — registered once (gated by this.open) so reopening
    // never grows the ledger; destroy() removes it via super.
    this.on(document, 'pointerdown', this.onDocDown as EventListener);
    menu.appendChild(this.trigger);
    menu.appendChild(this.list);
    this.widget.appendChild(menu);
  }

  private openList(): void {
    if (!this.list) return;
    this.open = true;
    this.list.classList.add('tw-open');
  }

  private closeList(): void {
    if (!this.list) return;
    this.open = false;
    this.list.classList.remove('tw-open');
  }

  private onDocDown = (e: PointerEvent): void => {
    if (this.open && !this.el.contains(e.target as Node)) this.closeList();
  };

  // ── Shared edit path ────────────────────────────────────────────────

  private choose(v: string | number): void {
    if (v === this.value) return;
    this.value = v;
    this.paint();
    this.beginEdit();
    this.ctx.live(v);
    this.commitEdit(v);
  }

  private paint(): void {
    const idx = this.values.indexOf(this.value);
    for (let i = 0; i < this.pills.length; i++) {
      const on = i === idx;
      this.pills[i].classList.toggle('tw-on', on);
      this.pills[i].setAttribute('aria-checked', String(on));
    }
    if (this.trigger) this.trigger.textContent = idx >= 0 ? this.labels[idx] : String(this.value);
  }
}
