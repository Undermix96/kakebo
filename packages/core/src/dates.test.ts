import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  dateInMonth,
  daysBetween,
  fromEpochDay,
  isISODate,
  todayInRome,
  toEpochDay,
} from './dates.ts';

describe('dates', () => {
  it('validates ISO dates', () => {
    expect(isISODate('2026-11-10')).toBe(true);
    expect(isISODate('2028-02-29')).toBe(true);
    expect(isISODate('2026-02-29')).toBe(false);
    expect(isISODate('2026-13-01')).toBe(false);
    expect(isISODate('2026-1-01')).toBe(false);
  });

  it('clamps missing days to the end of the month', () => {
    expect(dateInMonth('2026-11', 31)).toBe('2026-11-30');
    expect(dateInMonth('2026-02', 30)).toBe('2026-02-28');
    expect(dateInMonth('2028-02', 30)).toBe('2028-02-29');
    expect(dateInMonth('2026-12', 31)).toBe('2026-12-31');
  });

  it('adds months across years', () => {
    expect(addMonths('2026-11', 1)).toBe('2026-12');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-05', -17)).toBe('2024-12');
  });

  it('does day arithmetic without time zones', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30'); // DST change in Europe
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(daysBetween('2026-11-09', '2026-12-10')).toBe(31);
    expect(toEpochDay('1970-01-01')).toBe(0);
  });

  it('round-trips epoch days and agrees with UTC Date', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100_000, max: 200_000 }), (n) => {
        const iso = fromEpochDay(n);
        expect(toEpochDay(iso)).toBe(n);
        expect(iso).toBe(new Date(n * 86_400_000).toISOString().slice(0, 10));
      }),
    );
  });

  it("gives today's date in Rome regardless of the host time zone", () => {
    // 23:30 UTC on 9 Nov = 00:30 on 10 Nov in Rome (CET, UTC+1)
    expect(todayInRome(new Date('2026-11-09T23:30:00Z'))).toBe('2026-11-10');
    // 22:30 UTC on 9 Jul = 00:30 on 10 Jul in Rome (CEST, UTC+2)
    expect(todayInRome(new Date('2026-07-09T22:30:00Z'))).toBe('2026-07-10');
  });
});
