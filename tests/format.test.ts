import { describe, expect, it } from 'vitest';
import { decimals, formatNumber, numberToLiteral } from '../src/dev/tweaks/format';

describe('decimals', () => {
  it('derives display precision from the step', () => {
    expect(decimals(1)).toBe(0);
    expect(decimals(0.1)).toBe(1);
    expect(decimals(0.05)).toBe(2);
    expect(decimals(0.001)).toBe(3);
  });

  it('falls back to integers for non-positive steps', () => {
    expect(decimals(0)).toBe(0);
    expect(decimals(-1)).toBe(0);
  });
});

describe('formatNumber / numberToLiteral', () => {
  it('formats at step precision', () => {
    expect(formatNumber(0.1 + 0.2, 0.1)).toBe('0.3');
    expect(formatNumber(2, 0.5)).toBe('2.0');
  });

  it('emits the shortest literal that survives the step', () => {
    expect(numberToLiteral(0.1 + 0.2, 0.01)).toBe('0.3');
    expect(numberToLiteral(2, 0.5)).toBe('2');
    expect(numberToLiteral(1.23456, 0.001)).toBe('1.235');
  });
});
