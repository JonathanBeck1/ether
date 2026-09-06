import { describe, expect, it } from 'vitest';
import { createProgress } from '../src/loaders/progress';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('createProgress', () => {
  it('starts at 0 and reaches 1 when everything tracked has settled', async () => {
    const progress = createProgress();
    expect(progress.value).toBe(0);
    const a = deferred<string>();
    const b = deferred<string>();
    progress.track(a.promise);
    progress.track(b.promise);
    expect(progress.value).toBe(0);
    a.resolve('a');
    await tick();
    expect(progress.value).toBe(0.5);
    b.resolve('b');
    await tick();
    expect(progress.value).toBe(1);
  });

  it('weights items so a hero model outweighs its textures', async () => {
    const progress = createProgress();
    const model = deferred<void>();
    const texture = deferred<void>();
    progress.track(model.promise, 3);
    progress.track(texture.promise, 1);
    texture.resolve();
    await tick();
    expect(progress.value).toBe(0.25);
    model.resolve();
    await tick();
    expect(progress.value).toBe(1);
  });

  it('returns the same promise and settles on rejection too', async () => {
    const progress = createProgress();
    const failing = deferred<void>();
    const tracked = progress.track(failing.promise);
    expect(tracked).toBe(failing.promise);
    failing.reject(new Error('404'));
    await expect(tracked).rejects.toThrow('404');
    expect(progress.value).toBe(1);
  });

  it('notifies listeners on every change and honours unsubscribe', async () => {
    const progress = createProgress();
    const seen: number[] = [];
    const off = progress.onChange((v) => seen.push(v));
    const a = deferred<void>();
    progress.track(a.promise, 2);
    a.resolve();
    await tick();
    const b = deferred<void>();
    progress.track(b.promise, 2);
    off();
    b.resolve();
    await tick();
    expect(seen).toEqual([0, 1, 0.5]);
    expect(progress.value).toBe(1);
  });
});
