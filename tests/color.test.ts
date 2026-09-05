import { describe, expect, it } from 'vitest';
import { hexNormalize, hexToHsv, hexToRgb, hsvToHex, rgbToHex, rgbToHsv } from '../src/dev/tweaks/color';

describe('hexNormalize', () => {
  it('accepts six hex digits with or without the hash, lowercased and trimmed', () => {
    expect(hexNormalize('#3A7BD5')).toBe('#3a7bd5');
    expect(hexNormalize('2fbf71')).toBe('#2fbf71');
    expect(hexNormalize('  #c0392b ')).toBe('#c0392b');
  });

  it('rejects anything that is not exactly six hex digits', () => {
    expect(hexNormalize('#fff')).toBeNull();
    expect(hexNormalize('#12345g')).toBeNull();
    expect(hexNormalize('#1234567')).toBeNull();
    expect(hexNormalize('')).toBeNull();
  });
});

describe('rgb <-> hex', () => {
  it('round-trips', () => {
    expect(hexToRgb('#c0392b')).toEqual({ r: 192, g: 57, b: 43 });
    expect(rgbToHex(hexToRgb('#3a7bd5'))).toBe('#3a7bd5');
  });

  it('clamps and rounds channels on the way to hex', () => {
    expect(rgbToHex({ r: 300, g: -5, b: 127.6 })).toBe('#ff0080');
  });
});

describe('hsv', () => {
  it('maps the primaries to their hue angles', () => {
    expect(rgbToHsv({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 1, v: 1 });
    expect(rgbToHsv({ r: 0, g: 255, b: 0 })).toEqual({ h: 120, s: 1, v: 1 });
    expect(rgbToHsv({ r: 0, g: 0, b: 255 })).toEqual({ h: 240, s: 1, v: 1 });
  });

  it('treats greys as unsaturated and black as zero value', () => {
    expect(rgbToHsv({ r: 128, g: 128, b: 128 }).s).toBe(0);
    expect(rgbToHsv({ r: 0, g: 0, b: 0 })).toEqual({ h: 0, s: 0, v: 0 });
  });

  it('round-trips through hex', () => {
    for (const hex of ['#3a7bd5', '#2fbf71', '#c0392b', '#101418', '#ffffff', '#000000']) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
  });
});
