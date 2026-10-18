// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SceneManager } from '../src/core/SceneManager';
import type { RuntimeDiagnostics } from '../src/core/types';
import { Stats } from '../src/dev/Stats';

function diagnostics(): RuntimeDiagnostics {
  return {
    scene: {
      phase: 'active',
      route: '/',
      fallback: false,
      target: null,
      id: 1,
      entered: true,
      failures: 0,
      lastError: null,
    },
    performance: { frames: 120, fps: 58.6, cpuMs: 1.24 },
    rendering: {
      skipped: null,
      renderCalls: 3,
      drawCalls: 7,
      triangles: 12840,
      geometries: 4,
      textures: 5,
      programs: 3,
      dpr: 1.5,
      contextLost: false,
    },
    postFX: { enabled: true, msaa: 0, passes: ['RenderPass', 'EffectPass'] },
    quality: {
      tier: 'MID',
      rawScore: 0,
      dprCap: 1.5,
      antialias: false,
      enablePostFX: true,
      enableDither: true,
      msaaSamples: 0,
      enableSmoothScroll: false,
      reducedMotion: false,
    },
  };
}

function fakeManager(d: RuntimeDiagnostics) {
  const getDiagnostics = vi.fn(() => d);
  const manager = {
    getDiagnostics,
    renderer: { domElement: { width: 1500, height: 900 } },
  } as unknown as SceneManager;
  return { manager, getDiagnostics };
}

function rows(): Record<string, string> {
  const root = document.querySelector('[data-kit-stats]')!;
  return Object.fromEntries(
    [...root.children].map((row) => [row.children[0].textContent, row.children[1].textContent ?? '']),
  );
}

let nextFrame: ((now: number) => void) | null = null;

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: (now: number) => void) => {
    nextFrame = callback;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    nextFrame = null;
  });
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('Stats', () => {
  it('fills every row from getDiagnostics() on mount', () => {
    const { manager } = fakeManager(diagnostics());
    new Stats(manager).mount();
    expect(rows()).toEqual({
      FPS: '59',
      CPU: '1.2',
      TIER: 'MID',
      DPR: '1.50×',
      FX: 'Render+Effect',
      CALLS: '7',
      TRIS: '12840',
      VIEW: '1500×900',
    });
  });

  it('reports the composer actually running, not quality intent', () => {
    const d = diagnostics();
    d.postFX = { enabled: false, msaa: null, passes: [] };
    const { manager } = fakeManager(d);
    new Stats(manager).mount();
    expect(rows().FX).toBe('OFF');
  });

  it('shows -- while the loop has no closed fps window', () => {
    const d = diagnostics();
    d.performance = { frames: 3, fps: null, cpuMs: null };
    const { manager } = fakeManager(d);
    new Stats(manager).mount();
    expect(rows().FPS).toBe('--');
    expect(rows().CPU).toBe('--');
  });

  it('re-reads diagnostics on the ~500 ms overlay tick', () => {
    const d = diagnostics();
    const { manager, getDiagnostics } = fakeManager(d);
    const start = performance.now();
    new Stats(manager).mount();
    expect(getDiagnostics).toHaveBeenCalledTimes(1);

    d.rendering.drawCalls = 2;
    nextFrame!(start + 100);
    expect(getDiagnostics).toHaveBeenCalledTimes(1);
    nextFrame!(start + 600);
    expect(getDiagnostics).toHaveBeenCalledTimes(2);
    expect(rows().CALLS).toBe('2');
  });
});
