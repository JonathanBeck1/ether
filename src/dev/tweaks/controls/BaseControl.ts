import type { BaseDescriptor, Control, ControlContext, TweakValue } from '../types';
import { el } from '../dom';
import { hexNormalize } from '../color';

/**
 * Row scaffold + listener ledger + default capture + dirty/reset/destroy
 * plumbing shared by every control. Subclasses implement ONLY the value
 * widget: buildWidget / refreshWidget / readWidget.
 *
 * No listener is ever added outside on() — destroy() iterates the ledger and
 * removes all of them (the Stats tickBound/resizeBound discipline, generalized).
 */
export abstract class BaseControl<T extends TweakValue> implements Control {
  readonly path: string;
  readonly el: HTMLElement;

  protected readonly desc: BaseDescriptor<T>;
  protected ctx!: ControlContext;
  protected readonly widget: HTMLElement;

  /** Default for dirty/reset/export. A2: non-gated captures the LIVE get();
   *  gated (enabledUntil) uses the descriptor's explicit default. */
  protected readonly capturedDefault: T;

  /** Numeric dirty tolerance is ±step/2 for sliders; 0 otherwise. */
  protected readonly step: number;

  private editing = false;
  private listeners: Array<[EventTarget, string, EventListener]> = [];
  private destroyed = false;

  /** Read-only rows (monitors) skip the reset button entirely — there's no
   *  writable slot to reset, so the affordance would be a no-op. */
  protected readonly readOnly: boolean;

  private readonly labelEl: HTMLElement;
  private readonly dotEl: HTMLElement;
  private readonly resetEl: HTMLButtonElement | null;

  constructor(desc: BaseDescriptor<T>, step = 0, readOnly = false) {
    this.desc = desc;
    this.path = desc.path;
    this.step = step;
    this.readOnly = readOnly;
    this.capturedDefault = desc.enabledUntil ? desc.default : desc.get();

    const row = el('div', { class: 'tw-row' });
    this.labelEl = el('span', { class: 'tw-label', text: desc.label ?? humanize(desc.path) });
    this.dotEl = el('span', { class: 'tw-dot' });
    this.widget = el('div', { class: 'tw-widget' });
    this.resetEl = readOnly ? null : el('button', { class: 'tw-reset', text: '↺', attrs: { type: 'button', 'aria-label': 'Reset' } });

    row.appendChild(this.labelEl);
    row.appendChild(this.dotEl);
    row.appendChild(this.widget);
    if (this.resetEl) row.appendChild(this.resetEl);
    this.el = row;
  }

  get isEditing(): boolean {
    return this.editing;
  }

  get accent(): string {
    return this.ctx.accent;
  }

  mount(ctx: ControlContext): void {
    this.ctx = ctx;
    this.buildWidget();
    if (this.resetEl) this.on(this.resetEl, 'click', () => this.reset());
    this.refresh(this.getValue());
  }

  destroy(): void {
    if (this.destroyed) return;
    for (const [target, type, handler] of this.listeners) target.removeEventListener(type, handler);
    this.listeners = [];
    if (document.pointerLockElement) document.exitPointerLock();
    this.destroyed = true;
  }

  refresh(value: TweakValue): void {
    this.refreshWidget(value as T);
    this.updateDirty();
  }

  getValue(): TweakValue {
    return this.readWidget();
  }

  setValue(value: TweakValue): void {
    this.refreshWidget(value as T);
    this.updateDirty();
  }

  isDirty(): boolean {
    const cur = this.readWidget();
    const def = this.capturedDefault;
    if (typeof cur === 'number' && typeof def === 'number') return Math.abs(cur - def) > this.step / 2;
    if (typeof cur === 'string' && typeof def === 'string') {
      return (hexNormalize(cur) ?? cur.toLowerCase()) !== (hexNormalize(def) ?? def.toLowerCase());
    }
    if (Array.isArray(cur) && Array.isArray(def)) {
      if (cur.length !== def.length) return true;
      return cur.some((n, i) => Math.abs(n - (def[i] as number)) > this.step / 2);
    }
    return cur !== def;
  }

  reset(): void {
    // A3: override-guarded params un-pin (responsive behavior returns) instead
    // of writing the default into the slot. The scene returns to its live value,
    // which equals the live-captured default → not dirty.
    if (this.desc.onReset) {
      this.desc.onReset();
      this.ctx.commit(this.capturedDefault);
      this.refreshWidget(this.capturedDefault);
      this.updateDirty();
      return;
    }
    this.setValue(this.capturedDefault);
    this.ctx.live(this.capturedDefault);
    this.ctx.commit(this.capturedDefault);
  }

  // ── For subclasses ─────────────────────────────────────────────────

  /** Build the value widget into this.widget + attach listeners (via on() only). */
  protected abstract buildWidget(): void;
  /** Re-read external truth into the widget. MUST NOT fire live/commit. */
  protected abstract refreshWidget(value: T): void;
  /** Current widget value. */
  protected abstract readWidget(): T;

  protected on(target: EventTarget, type: string, handler: EventListener): void {
    target.addEventListener(type, handler);
    this.listeners.push([target, type, handler]);
  }

  protected beginEdit(): void {
    this.editing = true;
    this.ctx.beginEdit();
  }

  protected commitEdit(value: T): void {
    this.editing = false;
    this.ctx.commit(value);
    this.updateDirty();
  }

  protected updateDirty(): void {
    this.el.classList.toggle('tw-dirty', this.isDirty());
  }
}

export function humanize(path: string): string {
  return path
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}
