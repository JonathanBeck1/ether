import { describe, expect, it } from 'vitest';
import { normalizeRoute } from '../src/astro/router';

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
});
