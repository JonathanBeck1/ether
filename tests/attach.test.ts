// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { attachSceneManager, type SceneRoutes } from '../src/core/attach';
import type { Scene } from '../src/core/types';

const managers = vi.hoisted(() => [] as { destroyed: number }[]);

vi.mock('../src/core/SceneManager', () => ({
  SceneManager: class {
    readonly log = { destroyed: 0 };
    constructor() {
      managers.push(this.log);
    }
    registerScene(): void {}
    start(): void {}
    async transitionTo(): Promise<void> {}
    destroy(): void {
      this.log.destroyed += 1;
    }
  },
}));

vi.mock('../src/quality/quality', () => ({
  detectQuality: async () => ({ tier: 'HIGH' }),
}));

const routes: SceneRoutes = { '/': () => ({}) as unknown as Scene };

beforeEach(() => {
  managers.length = 0;
});

describe('attachSceneManager displacement', () => {
  it('unbinds the attachment it displaces, so HMR reboots do not stack listeners', async () => {
    const canvas = document.createElement('canvas');
    const unbind = vi.fn();

    const first = await attachSceneManager(canvas, routes, { bind: () => unbind });
    const second = await attachSceneManager(canvas, routes, {});

    expect(unbind).toHaveBeenCalledTimes(1);
    expect(managers.map((m) => m.destroyed)).toEqual([1, 0]);
    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(true);
  });

  it('leaves the unbind of an already-detached attachment alone', async () => {
    const canvas = document.createElement('canvas');
    const unbind = vi.fn();

    const attachment = await attachSceneManager(canvas, routes, { bind: () => unbind });
    attachment.detach();
    await attachSceneManager(canvas, routes, {});

    expect(unbind).toHaveBeenCalledTimes(1);
    expect(managers.map((m) => m.destroyed)).toEqual([1, 0]);
  });

  it('keeps destroying the displaced manager when its unbind throws', async () => {
    const canvas = document.createElement('canvas');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await attachSceneManager(canvas, routes, {
      bind: () => () => {
        throw new Error('adapter teardown blew up');
      },
    });
    await attachSceneManager(canvas, routes, {});

    expect(managers.map((m) => m.destroyed)).toEqual([1, 0]);
    warn.mockRestore();
  });
});
