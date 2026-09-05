import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decodeURLState,
  deletePreset,
  encodeURLState,
  readPanelState,
  readPresets,
  readState,
  savePreset,
  writePanelState,
  writeState,
} from '../src/dev/tweaks/persistence';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => {
      m.delete(k);
    },
    setItem: (k, v) => {
      m.set(k, String(v));
    },
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
});

describe('live state', () => {
  it('round-trips through localStorage under a versioned envelope', () => {
    writeState('k', { a: 1, c: '#3a7bd5' });
    expect(readState('k')).toEqual({ a: 1, c: '#3a7bd5' });
    expect(JSON.parse(localStorage.getItem('k')!)).toEqual({ v: 1, values: { a: 1, c: '#3a7bd5' } });
  });

  it('falls back to empty on missing, malformed, or mis-versioned payloads', () => {
    expect(readState('missing')).toEqual({});
    localStorage.setItem('garbage', '{not json');
    expect(readState('garbage')).toEqual({});
    localStorage.setItem('old', JSON.stringify({ v: 0, values: { a: 1 } }));
    expect(readState('old')).toEqual({});
    localStorage.setItem('array', JSON.stringify([1, 2]));
    expect(readState('array')).toEqual({});
  });
});

describe('panel state', () => {
  it('stores position and collapsed under a sibling key', () => {
    writePanelState('k', { left: 10, top: 20, collapsed: true });
    expect(readPanelState('k')).toEqual({ left: 10, top: 20, collapsed: true });
    expect(localStorage.getItem('k:panel')).not.toBeNull();
    expect(readPanelState('nope')).toEqual({});
  });
});

describe('presets', () => {
  it('saves, lists, and deletes named maps', () => {
    savePreset('k', 'warm', { a: 1 });
    savePreset('k', 'cool', { a: 2 });
    expect(readPresets('k')).toEqual({ warm: { a: 1 }, cool: { a: 2 } });
    deletePreset('k', 'warm');
    expect(readPresets('k')).toEqual({ cool: { a: 2 } });
  });
});

describe('URL state', () => {
  it('round-trips a diff through base64', () => {
    const diff = { bloom: 0.12, rim: '#2fbf71', on: true, band: [0.2, 0.8] };
    expect(decodeURLState(encodeURLState(diff))).toEqual(diff);
  });

  it('returns null for absent, undecodable, or non-object payloads', () => {
    expect(decodeURLState(null)).toBeNull();
    expect(decodeURLState('')).toBeNull();
    expect(decodeURLState('%%not-base64%%')).toBeNull();
    expect(decodeURLState(btoa('[1,2]'))).toBeNull();
    expect(decodeURLState(btoa('"str"'))).toBeNull();
  });
});
