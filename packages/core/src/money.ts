/**
 * Money is always an integer number of euro cents. Never use floats for amounts.
 */
export type Cents = number;

/** Parses an Italian-formatted amount ("1.234,00", "-42", "450,5") into cents. Returns null if invalid. */
export function parseEuro(input: string): Cents | null {
  const s = input
    .trim()
    .replace(/\s|€/g, '')
    .replace(/[−–]/g, '-');
  const m = /^([+-]?)(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const units = Number((m[2] ?? '0').replace(/\./g, ''));
  const decimals = Number(((m[3] ?? '') + '00').slice(0, 2));
  const cents = units * 100 + decimals;
  return cents === 0 ? 0 : sign * cents;
}

/**
 * Formats cents the Italian way: 123400 → "1.234,00 €".
 * Negative amounts use a true minus sign (U+2212) so they stay unambiguous without color.
 */
export function formatEuro(cents: Cents, opts: { symbol?: boolean; plus?: boolean } = {}): string {
  if (!Number.isInteger(cents)) throw new TypeError(`amount must be integer cents, got ${cents}`);
  const { symbol = true, plus = false } = opts;
  const abs = Math.abs(cents);
  const units = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const dec = (abs % 100).toString().padStart(2, '0');
  const sign = cents < 0 ? '−' : plus && cents > 0 ? '+' : '';
  return `${sign}${units},${dec}${symbol ? ' €' : ''}`;
}
