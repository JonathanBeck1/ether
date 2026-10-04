import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { msdfText } from '../src/text/msdf';

const troika = vi.hoisted(() => ({ callsBack: true, disposed: 0 }));

vi.mock('troika-three-text', () => ({
  Text: class {
    sync(callback?: () => void): void {
      if (troika.callsBack) callback?.();
    }
    dispose(): void {
      troika.disposed++;
    }
  },
}));

type Call = { url: string; init: RequestInit | undefined };
const calls: Call[] = [];
const stream = { cancelled: false };
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const TTF = [0, 1, 0, 0];

/** Every fetch answers `status` with `body` as its bytes. */
const serve = (status: number, body: number[] = TTF, type = 'font/ttf') => {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ 'content-type': type }),
      // Two bytes per chunk, so the head arrives split.
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          for (let i = 0; i < body.length; i += 2) {
            controller.enqueue(new Uint8Array(body.slice(i, i + 2)));
          }
          controller.close();
        },
        cancel() {
          stream.cancelled = true;
        },
      }),
    } as Response;
  });
};

beforeEach(() => {
  calls.length = 0;
  troika.callsBack = true;
  troika.disposed = 0;
  stream.cancelled = false;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('msdfText font preflight', () => {
  it('asks for the first four bytes in one GET', async () => {
    serve(206);
    await msdfText({ text: 'hi', font: '/fonts/display.ttf' });

    expect(calls).toHaveLength(1);
    expect(calls[0].init?.method).toBeUndefined();
    expect(calls[0].init?.headers).toEqual({ Range: 'bytes=0-3' });
  });

  it('reads only the head when the server ignores Range', async () => {
    serve(200, [...ascii('OTTO'), ...ascii('<!doctype html>')]);
    await expect(msdfText({ text: 'hi', font: '/fonts/display.otf' })).resolves.toBeDefined();
    expect(stream.cancelled).toBe(true);
  });

  it.each([
    ['TrueType', TTF],
    ['CFF', ascii('OTTO')],
    ['Apple TrueType', ascii('true')],
    ['TrueType collection', ascii('ttcf')],
    ['woff', ascii('wOFF')],
  ])('accepts a %s font', async (_, magic) => {
    serve(206, magic);
    await expect(msdfText({ text: 'hi', font: '/fonts/display' })).resolves.toBeDefined();
  });

  it('rejects with the status when the font is unreachable', async () => {
    serve(404);
    await expect(msdfText({ text: 'hi', font: '/fonts/missing.ttf' })).rejects.toThrow(/404/);
  });

  it('rejects a woff2, which troika cannot parse', async () => {
    serve(206, ascii('wOF2'), 'font/woff2');
    await expect(msdfText({ text: 'hi', font: '/fonts/display.woff2' })).rejects.toThrow(
      /woff2.*\.ttf, \.otf or \.woff/,
    );
  });

  it('rejects a page served in place of the font, naming its content type', async () => {
    serve(200, ascii('<!doctype html>'), 'text/html');
    await expect(msdfText({ text: 'hi', font: '/fonts/typo.ttf' })).rejects.toThrow(
      /\/fonts\/typo\.ttf is not a font \(text\/html\)/,
    );
  });
});

describe('msdfText settling', () => {
  it('rejects after timeoutMs when troika never calls back, and frees the mesh', async () => {
    serve(206);
    troika.callsBack = false;
    await expect(
      msdfText({ text: 'hi', font: '/fonts/display.ttf', timeoutMs: 10 }),
    ).rejects.toThrow(/\/fonts\/display\.ttf not ready after 10ms.*cdn\.jsdelivr\.net/);
    expect(troika.disposed).toBe(1);
  });

  it.each([Infinity, 3e9])('waits when timeoutMs is %s, past the setTimeout range', async (timeoutMs) => {
    serve(206);
    troika.callsBack = false;
    const call = msdfText({ text: 'hi', font: '/fonts/display.ttf', timeoutMs });
    const state = await Promise.race([
      call.then(
        () => 'resolved',
        () => 'rejected',
      ),
      new Promise((r) => setTimeout(() => r('pending'), 50)),
    ]);
    expect(state).toBe('pending');
  });
});
