import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { msdfText } from '../src/text/msdf';

vi.mock('troika-three-text', () => ({
  Text: class {
    sync(callback?: () => void): void {
      callback?.();
    }
    dispose(): void {}
  },
}));

type Call = { url: string; init: RequestInit | undefined };
const calls: Call[] = [];
const respond = (status: number) => ({ ok: status >= 200 && status < 300, status }) as Response;

/** HEAD answers `headStatus`, the fallback GET answers `getStatus`. */
const serve = (headStatus: number, getStatus: number) => {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return respond(init?.method === 'HEAD' ? headStatus : getStatus);
  });
};

beforeEach(() => {
  calls.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('msdfText font preflight', () => {
  it('falls back to GET on any non-ok HEAD, not just 405 and 501', async () => {
    serve(403, 200);
    await msdfText({ text: 'hi', font: '/fonts/display.ttf' });

    expect(calls).toHaveLength(2);
    expect(calls[0].init?.method).toBe('HEAD');
    expect(calls[1].init?.method).toBeUndefined();
  });

  it('sends no Range header, which would make the fallback a preflighted request', async () => {
    serve(405, 200);
    await msdfText({ text: 'hi', font: '/fonts/display.ttf' });

    expect(calls[1].init?.headers).toBeUndefined();
  });

  it('aborts the fallback GET once the response head lands', async () => {
    serve(500, 200);
    await msdfText({ text: 'hi', font: '/fonts/display.ttf' });

    expect(calls[1].init?.signal?.aborted).toBe(true);
  });

  it('rejects with the fallback status when the font is genuinely unreachable', async () => {
    serve(405, 404);
    await expect(msdfText({ text: 'hi', font: '/fonts/missing.ttf' })).rejects.toThrow(/404/);
  });

  it('skips the fallback entirely when HEAD is ok', async () => {
    serve(200, 200);
    await msdfText({ text: 'hi', font: '/fonts/display.ttf' });

    expect(calls).toHaveLength(1);
  });
});
