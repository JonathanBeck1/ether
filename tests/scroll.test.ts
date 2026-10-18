import { afterEach, describe, expect, it, vi } from 'vitest';

const registerPlugin = vi.fn();
const update = vi.fn();
const create = vi.fn();
const lenises: MockLenis[] = [];

class MockLenis {
  readonly handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  readonly options: unknown;
  raf = vi.fn();
  scrollTo = vi.fn();
  destroy = vi.fn();
  constructor(options?: unknown) {
    this.options = options;
    lenises.push(this);
  }
  on(event: string, handler: (...args: unknown[]) => void) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }
  emit(event: string, ...args: unknown[]) {
    for (const handler of this.handlers.get(event) ?? []) handler(...args);
  }
}

vi.mock('gsap', () => ({ default: { registerPlugin } }));
vi.mock('gsap/ScrollTrigger', () => ({ ScrollTrigger: { update, create } }));
vi.mock('lenis', () => ({ default: MockLenis }));

afterEach(() => {
  registerPlugin.mockReset();
  update.mockReset();
  create.mockReset();
  lenises.length = 0;
  vi.resetModules();
});

const load = () => import('../src/scroll');

describe('ScrollBridge', () => {
  it('registers ScrollTrigger once across bridges and progress triggers', async () => {
    create.mockReturnValue({ kill() {} });
    const { ScrollBridge, createScrollProgress } = await load();
    const { ScrollTrigger } = await import('gsap/ScrollTrigger');

    new ScrollBridge();
    new ScrollBridge();
    createScrollProgress(() => {}, { end: '+=100%' });

    expect(registerPlugin).toHaveBeenCalledOnce();
    expect(registerPlugin).toHaveBeenCalledWith(ScrollTrigger);
  });

  it('forwards options to Lenis and feeds its scroll events to ScrollTrigger.update', async () => {
    const { ScrollBridge } = await load();
    const options = { duration: 1.2, syncTouch: true };

    const bridge = new ScrollBridge(options);

    expect(bridge.lenis).toBe(lenises[0]);
    expect(lenises[0].options).toBe(options);
    lenises[0].emit('scroll', lenises[0]);
    expect(update).toHaveBeenCalledOnce();
  });

  it('only advances Lenis when raf() is pumped, in milliseconds', async () => {
    const { ScrollBridge } = await load();

    const bridge = new ScrollBridge();
    expect(bridge.lenis.raf).not.toHaveBeenCalled();

    bridge.raf(1.5);
    bridge.raf(0.016);
    expect(lenises[0].raf.mock.calls).toEqual([[1500], [16]]);
  });

  it('forwards scrollTo', async () => {
    const { ScrollBridge } = await load();
    const bridge = new ScrollBridge();

    bridge.scrollTo(0, { immediate: true });

    expect(lenises[0].scrollTo).toHaveBeenCalledWith(0, { immediate: true });
  });

  it('destroy() destroys Lenis', async () => {
    const { ScrollBridge } = await load();
    const bridge = new ScrollBridge();

    bridge.destroy();

    expect(lenises[0].destroy).toHaveBeenCalledOnce();
  });
});

describe('createScrollProgress', () => {
  it('registers ScrollTrigger, creates a full-page trigger by default and reports raw progress', async () => {
    const trigger = { progress: 0, kill: vi.fn() };
    create.mockReturnValue(trigger);
    const { createScrollProgress } = await load();
    const { ScrollTrigger } = await import('gsap/ScrollTrigger');
    const seen: number[] = [];

    const handle = createScrollProgress((p) => seen.push(p), { end: '+=60%' });

    expect(registerPlugin).toHaveBeenCalledOnce();
    expect(registerPlugin).toHaveBeenCalledWith(ScrollTrigger);
    expect(handle.trigger).toBe(trigger);
    const config = create.mock.calls[0][0];
    expect(config).toMatchObject({ trigger: 'body', start: 'top top', end: '+=60%', scrub: undefined });
    config.onUpdate({ progress: 0.25 });
    config.onUpdate({ progress: 1 });
    expect(seen).toEqual([0.25, 1]);
  });

  it('passes trigger, start and scrub through', async () => {
    create.mockReturnValue({ kill() {} });
    const { createScrollProgress } = await load();

    createScrollProgress(() => {}, { trigger: '#hero', start: 'top center', end: 800, scrub: true });

    expect(create.mock.calls[0][0]).toMatchObject({
      trigger: '#hero',
      start: 'top center',
      end: 800,
      scrub: true,
    });
  });

  it('kill() kills the underlying trigger', async () => {
    const trigger = { kill: vi.fn() };
    create.mockReturnValue(trigger);
    const { createScrollProgress } = await load();

    createScrollProgress(() => {}, { end: '+=100%' }).kill();

    expect(trigger.kill).toHaveBeenCalledOnce();
  });
});
