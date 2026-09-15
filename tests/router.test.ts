import { describe, expect, it } from 'vitest';
import { normalizeRoute } from '../src/core/attach';

describe('normalizeRoute', () => {
  it('drops trailing slashes so dev and static-build URLs share a scene', () => {
    expect(normalizeRoute('/web/')).toBe('/web');
    expect(normalizeRoute('/web')).toBe('/web');
    expect(normalizeRoute('/work/slug/')).toBe('/work/slug');
  });

  it('keeps the root as root', () => {
    expect(normalizeRoute('/')).toBe('/');
    expect(normalizeRoute('///')).toBe('/');
  });

  it('leaves percent-encoded segments alone so an encoded route still matches', () => {
    expect(normalizeRoute('/work/caf%C3%A9/')).toBe('/work/caf%C3%A9');
    expect(normalizeRoute('/work/a%2Fb')).toBe('/work/a%2Fb');
  });

  it('is idempotent — route keys and navigation targets both pass through it', () => {
    for (const path of ['/', '///', '/web/', '/work/slug//', '/work/caf%C3%A9/']) {
      const once = normalizeRoute(path);
      expect(normalizeRoute(once)).toBe(once);
    }
  });
});
