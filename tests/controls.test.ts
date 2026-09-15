// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { SliderControl } from '../src/dev/tweaks/controls/SliderControl';
import { VectorControl } from '../src/dev/tweaks/controls/VectorControl';
import { SelectControl } from '../src/dev/tweaks/controls/SelectControl';
import { Store } from '../src/dev/tweaks/Store';
import type { ControlContext, TweakValue } from '../src/dev/tweaks/types';

// jsdom implements neither half of the pointer-capture API the drag paths use.
const captured = new Set<number>();
Object.assign(Element.prototype, {
  setPointerCapture(id: number) { captured.add(id); },
  releasePointerCapture(id: number) { captured.delete(id); },
  hasPointerCapture(id: number) { return captured.has(id); },
});

/** The wiring Registry gives every control, over a real Store. */
function mountSlider() {
  const store = new Store();
  store.register('x', 1, 1);
  let live = 1;

  const control = new SliderControl({
    path: 'x',
    min: 0,
    max: 5,
    step: 1,
    get: () => live,
    set: (v) => { live = v; },
    default: 1,
    export: null,
  });
  const ctx: ControlContext = {
    accent: '#fff',
    swatches: [],
    beginEdit: () => store.beginUndoCapture(),
    live: (v: TweakValue) => { live = v as number; store.setLive('x', v); },
    commit: (v: TweakValue) => { live = v as number; store.commit('x', v); store.pushUndo(); },
  };
  control.mount(ctx);
  return { store, control };
}

function mountVector() {
  const store = new Store();
  store.register('v', [0, 0], 1);
  let live: number[] = [0, 0];

  const control = new VectorControl({
    path: 'v',
    min: -2,
    max: 2,
    step: 1,
    axes: 2,
    get: () => live,
    set: (v) => { live = v; },
    default: [0, 0],
    export: null,
  });
  const ctx: ControlContext = {
    accent: '#fff',
    swatches: [],
    beginEdit: () => store.beginUndoCapture(),
    live: (v: TweakValue) => { live = v as number[]; store.setLive('v', v); },
    commit: (v: TweakValue) => { live = v as number[]; store.commit('v', v); store.pushUndo(); },
  };
  control.mount(ctx);
  return { store, control };
}

function mountSelect() {
  const store = new Store();
  store.register('s', 'a');
  let live: string | number = 'a';

  const control = new SelectControl({
    path: 's',
    options: { A: 'a', B: 'b', C: 'c', D: 'd', E: 'e' }, // >4 => dropdown, not pills
    get: () => live,
    set: (v) => { live = v; },
    default: 'a',
    export: null,
  });
  const ctx: ControlContext = {
    accent: '#fff',
    swatches: [],
    beginEdit: () => store.beginUndoCapture(),
    live: (v: TweakValue) => { live = v as string; store.setLive('s', v); },
    commit: (v: TweakValue) => { live = v as string; store.commit('s', v); store.pushUndo(); },
  };
  control.mount(ctx);
  return { store, control };
}

describe('SliderControl', () => {
  it('makes reset undoable', () => {
    const { store, control } = mountSlider();

    // A real gesture: End jumps the slider to max.
    control.el.querySelector('.tw-slider')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(store.get('x')).toBe(5);

    control.el.querySelector('.tw-widget')!
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(store.get('x')).toBe(1);

    store.undo();
    expect(store.get('x')).toBe(5);
  });

  it('pushes one undo entry for a held arrow key', () => {
    const { store, control } = mountSlider();
    const slider = control.el.querySelector('.tw-slider')!;
    const press = (repeat: boolean): boolean =>
      slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', repeat, bubbles: true }));

    press(false); // 1 -> 2, a discrete press commits on its own
    press(true); // 3
    press(true); // 4
    press(true); // 5
    slider.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowUp', bubbles: true }));
    expect(store.get('x')).toBe(5);

    store.undo();
    expect(store.get('x')).toBe(2); // the whole repeat run is one entry
    store.undo();
    expect(store.get('x')).toBe(1);
  });

  it('ends the drag on pointercancel', () => {
    const { control } = mountSlider();
    const slider = control.el.querySelector('.tw-slider')!;

    slider.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 1, bubbles: true }));
    expect(control.isEditing).toBe(true);
    expect(slider.classList.contains('tw-grabbing')).toBe(true);

    slider.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }));
    expect(control.isEditing).toBe(false);
    expect(slider.classList.contains('tw-grabbing')).toBe(false);
  });
});

describe('VectorControl', () => {
  it('reaches the pad handle by keyboard and nudges each axis', () => {
    const { store, control } = mountVector();
    const handle = control.el.querySelector('.tw-xy-handle')!;
    expect(handle.getAttribute('tabindex')).toBe('0');

    const press = (key: string): boolean =>
      handle.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

    press('ArrowRight');
    expect(store.get('v')).toEqual([1, 0]);
    press('ArrowUp');
    expect(store.get('v')).toEqual([1, 1]);
    press('ArrowLeft');
    press('ArrowDown');
    expect(store.get('v')).toEqual([0, 0]);
  });
});

describe('SelectControl', () => {
  it('closes the dropdown on Escape from the list and tracks aria state', () => {
    const { control } = mountSelect();
    const trigger = control.el.querySelector('.tw-select-trigger') as HTMLElement;
    const list = control.el.querySelector('.tw-select-list')!;
    const options = list.querySelectorAll('.tw-select-option');

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    expect(options[1].getAttribute('aria-selected')).toBe('false');

    trigger.click();
    expect(list.classList.contains('tw-open')).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    // Focus sits on an option once the list is open, so Escape never reaches
    // the trigger — it has to be caught on the list.
    options[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(list.classList.contains('tw-open')).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});
