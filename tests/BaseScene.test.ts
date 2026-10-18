// @vitest-environment jsdom
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import * as THREE from 'three';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import type Lenis from 'lenis';
import type { ScrollBridge } from '../src/scroll/scrollBridge';
import { BaseScene, type Trackable } from '../src/core/BaseScene';

class TestScene extends BaseScene {
  add<T extends Trackable>(d: T): T {
    return this.track(d);
  }
  on(target: EventTarget, type: string, handler: EventListener, options?: AddEventListenerOptions): void {
    this.listen(target, type, handler, options);
  }
  onKeydown(handler: (event: KeyboardEvent) => void): void {
    this.listen(document, 'keydown', handler);
  }
  async enterTransition(): Promise<void> {}
  async exitTransition(): Promise<void> {}
  tick(): void {}
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BaseScene.track', () => {
  it('returns what it was given, typed as given', () => {
    const scene = new TestScene();
    const geometry = new THREE.BoxGeometry();
    const tracked = scene.add(geometry);
    expect(tracked).toBe(geometry);
    expectTypeOf(tracked).toEqualTypeOf<THREE.BoxGeometry>();
  });

  it('accepts the library types it is meant for', () => {
    expectTypeOf<gsap.core.Tween>().toExtend<Trackable>();
    expectTypeOf<gsap.core.Timeline>().toExtend<Trackable>();
    expectTypeOf<ScrollTrigger>().toExtend<Trackable>();
    expectTypeOf<gsap.Context>().toExtend<Trackable>();
    expectTypeOf<gsap.MatchMedia>().toExtend<Trackable>();
    expectTypeOf<ScrollBridge>().toExtend<Trackable>();
    expectTypeOf<Lenis>().toExtend<Trackable>();
    expectTypeOf<ResizeObserver>().toExtend<Trackable>();
    expectTypeOf<IntersectionObserver>().toExtend<Trackable>();
    expectTypeOf<MutationObserver>().toExtend<Trackable>();
    expectTypeOf<THREE.WebGLRenderTarget>().toExtend<Trackable>();
  });

  it('stops a real GSAP tween', async () => {
    const scene = new TestScene();
    const target = { x: 0 };
    scene.add(gsap.to(target, { x: 1, duration: 10, ease: 'none' }));
    const frame = () => new Promise((resolve) => setTimeout(resolve, 30)).then(() => gsap.ticker.tick());
    await frame();
    const moved = target.x;
    expect(moved).toBeGreaterThan(0);
    scene.dispose();
    await frame();
    expect(target.x).toBe(moved);
  });

  it.each(['dispose', 'kill', 'destroy', 'disconnect', 'revert'] as const)('calls %s()', (method) => {
    const scene = new TestScene();
    const fn = vi.fn();
    const d = { [method]: fn } as unknown as Trackable;
    scene.add(d);
    expect(fn).not.toHaveBeenCalled();
    scene.dispose();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.contexts[0]).toBe(d);
  });

  it('calls a plain teardown function', () => {
    const scene = new TestScene();
    const fn = vi.fn();
    scene.add(fn);
    scene.dispose();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('kills rather than reverts a value that has both, as GSAP animations and triggers do', () => {
    const scene = new TestScene();
    const kill = vi.fn();
    const revert = vi.fn();
    scene.add({ kill, revert });
    scene.dispose();
    expect(kill).toHaveBeenCalledTimes(1);
    expect(revert).not.toHaveBeenCalled();
  });

  it('skips a gsap.context cleanup when tracked directly, runs it when tracked as revert', () => {
    const scene = new TestScene();
    const killed = vi.fn();
    const reverted = vi.fn();
    scene.add(gsap.context(() => killed));
    const ctx = gsap.context(() => reverted);
    scene.add(() => ctx.revert());
    scene.dispose();
    expect(killed).not.toHaveBeenCalled();
    expect(reverted).toHaveBeenCalledTimes(1);
  });

  it('prefers dispose() over the other methods', () => {
    const scene = new TestScene();
    const dispose = vi.fn();
    const destroy = vi.fn();
    scene.add({ dispose, destroy });
    scene.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(destroy).not.toHaveBeenCalled();
  });

  it('tears down in reverse registration order, then the composer', () => {
    const scene = new TestScene();
    const order: string[] = [];
    scene.add({ dispose: () => order.push('geometry') });
    scene.add({ kill: () => order.push('tween') });
    scene.add({ disconnect: () => order.push('observer') });
    scene.add(() => order.push('fn'));
    scene.composer = { dispose: () => order.push('composer') } as unknown as BaseScene['composer'];
    scene.dispose();
    expect(order).toEqual(['fn', 'observer', 'tween', 'geometry', 'composer']);
  });

  it('keeps going past a throwing teardown, disposes the composer, then throws that error', () => {
    const scene = new TestScene();
    const first = vi.fn();
    const last = vi.fn();
    const composer = vi.fn();
    const a = new Error('a');
    scene.add(first);
    scene.add(() => {
      throw a;
    });
    scene.add(last);
    scene.composer = { dispose: composer } as unknown as BaseScene['composer'];
    expect(() => scene.dispose()).toThrow(a);
    expect(first).toHaveBeenCalledTimes(1);
    expect(last).toHaveBeenCalledTimes(1);
    expect(composer).toHaveBeenCalledTimes(1);
  });

  it('throws an AggregateError with every error when several teardowns throw', () => {
    const scene = new TestScene();
    const composer = vi.fn();
    const a = new Error('a');
    const b = new Error('b');
    scene.add(() => {
      throw a;
    });
    scene.add({
      destroy: () => {
        throw b;
      },
    });
    scene.composer = { dispose: composer } as unknown as BaseScene['composer'];
    let thrown: unknown;
    try {
      scene.dispose();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors).toEqual([b, a]);
    expect((thrown as AggregateError).message).toBe('2 teardowns threw');
    expect(composer).toHaveBeenCalledTimes(1);
  });

  it('runs each teardown once when dispose() is called twice', () => {
    const scene = new TestScene();
    const fn = vi.fn();
    const kill = vi.fn();
    scene.add(fn);
    scene.add({ kill });
    scene.add(() => {
      throw new Error('once');
    });
    expect(() => scene.dispose()).toThrow('once');
    expect(() => scene.dispose()).not.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledTimes(1);
  });
});

describe('BaseScene.listen', () => {
  it('adds the listener and removes it on dispose()', () => {
    const scene = new TestScene();
    const target = new EventTarget();
    const handler = vi.fn();
    scene.on(target, 'ping', handler);
    target.dispatchEvent(new Event('ping'));
    expect(handler).toHaveBeenCalledTimes(1);
    scene.dispose();
    target.dispatchEvent(new Event('ping'));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('types the event from the target and type', () => {
    const scene = new TestScene();
    const keys: string[] = [];
    scene.onKeydown((event) => keys.push(event.key));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    scene.dispose();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b' }));
    expect(keys).toEqual(['a']);
  });

  it('removes a capture listener with the options it was added with', () => {
    const scene = new TestScene();
    const remove = vi.spyOn(window, 'removeEventListener');
    const handler = vi.fn();
    const options = { capture: true, passive: true };
    scene.on(window, 'resize', handler, options);
    scene.dispose();
    expect(remove).toHaveBeenCalledWith('resize', handler, options);
    window.dispatchEvent(new Event('resize'));
    expect(handler).not.toHaveBeenCalled();
  });

  it('removes listeners in reverse order with the rest of the tracked teardowns', () => {
    const scene = new TestScene();
    const order: string[] = [];
    const target = new EventTarget();
    vi.spyOn(target, 'removeEventListener').mockImplementation(() => order.push('listener'));
    scene.add(() => order.push('first'));
    scene.on(target, 'ping', () => {});
    scene.add(() => order.push('last'));
    scene.dispose();
    expect(order).toEqual(['last', 'listener', 'first']);
  });
});
