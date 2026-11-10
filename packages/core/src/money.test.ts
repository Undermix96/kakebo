import { describe, expect, it } from 'vitest';
import { formatEuro, parseEuro } from './money.ts';

describe('formatEuro', () => {
  it('formats Italian style with thousands separator', () => {
    expect(formatEuro(123400)).toBe('1.234,00 €');
    expect(formatEuro(4250)).toBe('42,50 €');
    expect(formatEuro(0)).toBe('0,00 €');
  });
  it('uses a real minus sign for negatives', () => {
    expect(formatEuro(-98765)).toBe('−987,65 €');
  });
  it('can show a plus sign and omit the symbol', () => {
    expect(formatEuro(81200, { plus: true, symbol: false })).toBe('+812,00');
  });
  it('rejects non-integer cents', () => {
    expect(() => formatEuro(1107.98)).toThrow(TypeError);
  });
});

describe('parseEuro', () => {
  it.each([
    ['1.234,00', 123400],
    ['1234', 123400],
    ['450,5', 45050],
    ['-42', -4200],
    ['−42,00 €', -4200],
    ['0,00', 0],
  ])('%s → %i', (input, cents) => {
    expect(parseEuro(input)).toBe(cents);
  });
  it.each(['', 'abc', '1,234', '12.34', '1.52,00'])('rejects "%s"', (input) => {
    expect(parseEuro(input)).toBeNull();
  });
  it('round-trips with formatEuro', () => {
    for (const c of [0, 1, 99, 100, 123400, -98765, 123456789]) {
      expect(parseEuro(formatEuro(c))).toBe(c);
    }
  });
});
