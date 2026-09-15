import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, applyTokens, buildFontFace, resolveTheme } from '../src/dev/tweaks/tokens';

function shellRoot() {
  const written = new Map<string, string>();
  const el = { style: { setProperty: (name: string, value: string) => void written.set(name, value) } };
  return { el: el as unknown as HTMLElement, written };
}

describe('resolveTheme', () => {
  it('merges a partial theme over the neutral defaults', () => {
    const theme = resolveTheme({ primary: '#2fbf71', swatches: ['#2fbf71'] });
    expect(theme.primary).toBe('#2fbf71');
    expect(theme.swatches).toEqual(['#2fbf71']);
    expect(theme.text).toBe(DEFAULT_THEME.text);
    expect(theme.radius).toBe(DEFAULT_THEME.radius);
  });

  it('returns a fresh object so two panels never share one theme', () => {
    const theme = resolveTheme();
    expect(theme).toEqual(DEFAULT_THEME);
    theme.primary = '#c0392b';
    expect(DEFAULT_THEME.primary).toBe('#6e9fff');
    expect(resolveTheme().primary).toBe('#6e9fff');
  });
});

describe('applyTokens', () => {
  it('writes every theme key as a --tw- custom property, kebab-cased', () => {
    const { el, written } = shellRoot();
    applyTokens(el, resolveTheme({ primary: '#2fbf71' }));
    expect(written.get('--tw-primary')).toBe('#2fbf71');
    expect(written.get('--tw-font-mono')).toBe(DEFAULT_THEME.fontMono);
    expect(written.get('--tw-on-accent')).toBe(DEFAULT_THEME.onAccent);
    expect(written.get('--tw-hairline')).toBe(DEFAULT_THEME.hairline);
  });

  it('mirrors the groove and accent aliases the scoped CSS reads', () => {
    const { el, written } = shellRoot();
    const theme = resolveTheme({ primary: '#2fbf71', hairline: 'rgba(0,0,0,0.2)' });
    applyTokens(el, theme);
    expect(written.get('--tw-accent')).toBe('#2fbf71');
    expect(written.get('--tw-groove')).toBe('rgba(0,0,0,0.2)');
  });

  it('writes nothing but --tw- properties, and never the swatch list', () => {
    const { el, written } = shellRoot();
    applyTokens(el, resolveTheme({ swatches: ['#2fbf71', '#6e9fff'] }));
    expect([...written.keys()].every((name) => name.startsWith('--tw-'))).toBe(true);
    expect(written.has('--tw-swatches')).toBe(false);
  });
});

describe('buildFontFace', () => {
  it('emits nothing by default or when the host opts out, so no visitor hits a third-party CDN', () => {
    expect(buildFontFace()).toBe('');
    expect(buildFontFace(false)).toBe('');
  });

  it('uses the host-served URLs verbatim and adds no others', () => {
    const css = buildFontFace({ w400: '/fonts/mono-400.woff2', w500: '/fonts/mono-500.woff2' });
    expect(css.match(/@font-face/g)).toHaveLength(2);
    expect(css).toContain("url('/fonts/mono-400.woff2') format('woff2')");
    expect(css).toContain("url('/fonts/mono-500.woff2') format('woff2')");
    expect(css).toContain('font-weight: 400;');
    expect(css).toContain('font-weight: 500;');
    expect(css.match(/font-display: swap;/g)).toHaveLength(2);
    expect(css).not.toContain('jsdelivr');
  });
});
