// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { SliderControl } from '../src/dev/tweaks/controls/SliderControl';
import { Store } from '../src/dev/tweaks/Store';
import type { ControlContext, TweakValue } from '../src/dev/tweaks/types';

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
});
