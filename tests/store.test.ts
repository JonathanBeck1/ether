import { describe, expect, it } from 'vitest';
import { Store } from '../src/dev/tweaks/Store';
import type { TweakValue } from '../src/dev/tweaks/types';

describe('Store', () => {
  it('registers defaults and starts clean', () => {
    const s = new Store();
    s.register('a', 1, 0.1);
    expect(s.get('a')).toBe(1);
    expect(s.isDirty('a')).toBe(false);
    expect(s.diff()).toEqual({});
  });

  it('treats numeric drift within half a step as clean', () => {
    const s = new Store();
    s.register('a', 1, 0.1);
    s.commit('a', 1.04);
    expect(s.isDirty('a')).toBe(false);
    s.commit('a', 1.2);
    expect(s.isDirty('a')).toBe(true);
    expect(s.changedPaths()).toEqual(['a']);
    expect(s.diff()).toEqual({ a: 1.2 });
  });

  it('compares colors case-insensitively', () => {
    const s = new Store();
    s.register('c', '#3A7BD5');
    s.commit('c', '#3a7bd5');
    expect(s.isDirty('c')).toBe(false);
    s.commit('c', '#2fbf71');
    expect(s.isDirty('c')).toBe(true);
  });

  it('emits to subscribers on live and committed writes until unsubscribed', () => {
    const s = new Store();
    s.register('a', 0);
    const seen: [string, unknown][] = [];
    const off = s.subscribe((p, v) => seen.push([p, v]));
    s.setLive('a', 1);
    s.commit('a', 2);
    off();
    s.commit('a', 3);
    expect(seen).toEqual([
      ['a', 1],
      ['a', 2],
    ]);
  });

  it('restore ignores unknown paths and resets the rest to defaults', () => {
    const s = new Store();
    s.register('a', 1);
    s.register('b', 2);
    s.commit('a', 5);
    s.commit('b', 6);
    s.restore({ a: 9, unknown: 1 });
    expect(s.snapshot()).toEqual({ a: 9, b: 2 });
  });

  it('restore keeps only values shaped like the default', () => {
    const s = new Store();
    s.register('n', 1);
    s.register('c', '#ffffff');
    s.register('v', [0, 0]);
    s.register('w', [0, 0]);

    // wrong primitive, wrong arity, non-numeric element
    s.restore({ n: 'nope', c: 2, v: [1], w: [1, 'x'] as unknown as TweakValue });
    expect(s.snapshot()).toEqual({ n: 1, c: '#ffffff', v: [0, 0], w: [0, 0] });

    s.restore({ n: 4, v: [2, 3] });
    expect(s.snapshot()).toEqual({ n: 4, c: '#ffffff', v: [2, 3], w: [0, 0] });
  });

  it('undo/redo replay one snapshot per committed gesture', () => {
    const s = new Store();
    s.register('a', 0);
    s.beginUndoCapture();
    s.setLive('a', 3);
    s.commit('a', 5);
    s.pushUndo();
    s.beginUndoCapture();
    s.commit('a', 8);
    s.pushUndo();

    expect(s.get('a')).toBe(8);
    s.undo();
    expect(s.get('a')).toBe(5);
    s.undo();
    expect(s.get('a')).toBe(0);
    s.undo(); // stack exhausted — no-op
    expect(s.get('a')).toBe(0);
    s.redo();
    expect(s.get('a')).toBe(5);
    s.redo();
    expect(s.get('a')).toBe(8);
  });

  it('drops an abandoned capture so the next gesture cannot undo the undo', () => {
    const s = new Store();
    s.register('a', 0);
    s.beginUndoCapture();
    s.commit('a', 5);
    s.pushUndo();

    s.beginUndoCapture(); // sub-threshold click: cancelled, never committed
    s.undo();
    expect(s.get('a')).toBe(0);

    s.beginUndoCapture();
    s.commit('a', 7);
    s.pushUndo();
    s.undo();
    expect(s.get('a')).toBe(0);
  });

  it('a new gesture clears the redo stack', () => {
    const s = new Store();
    s.register('a', 0);
    s.beginUndoCapture();
    s.commit('a', 1);
    s.pushUndo();
    s.undo();
    expect(s.get('a')).toBe(0);
    s.beginUndoCapture();
    s.commit('a', 2);
    s.pushUndo();
    s.redo(); // nothing to redo
    expect(s.get('a')).toBe(2);
  });
});
